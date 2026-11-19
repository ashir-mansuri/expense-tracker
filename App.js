import { store, processRecurring, exportCSV, todayISO, CURRENCIES, nextDue, uid, stepDate } from './store.js';
import * as A from './analytics.js';
import * as C from './charts.js';
import { icon } from './icons.js';
import { buildIndex, suggest } from './categorize.js';
import { initImport, openImport } from './importui.js';
import { refreshRates, convert, canConvert, hasRates } from './rates.js';
import { putReceipt, getReceipt, deleteReceipt, shrinkImage, exportReceipts, importReceipts, receiptIds, setReceiptKey, convertReceipts, clearReceipts } from './receipts.js';
import { buildWorkbook, excelDate } from './xlsx.js';
import { initEntry, entryHTML } from './entry.js';
import { sealText, openText, looksEncrypted, available as vaultAvailable } from './vault.js';
import { groupPeople, totalsByCurrency, repayPlan, suggestRepayments, reminderText, leftOf, paidOf, personKey } from './owed.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (v, code = cur()) => A.fmtMoney(v, code);
const signed = (v, code = cur()) => A.fmtSigned(v, code);
const home = () => store.settings.homeCurrency;
const showAll = () => !!(store.settings.showAll && home() && hasRates());
const cur = () => (showAll() ? home() : store.settings.currency);
const num = (v) => parseFloat(String(v ?? '').replace(',', '.'));

// The transactions the screens work with: one currency, or everything converted into the home currency.
function ledger() {
  if (!showAll()) return store.transactions.filter((t) => t.currency === cur());
  const to = home();
  const out = [];
  for (const t of store.transactions) {
    if (t.currency === to) { out.push(t); continue; }
    const v = convert(t.amount, t.currency, to);
    if (v !== null) out.push({ ...t, amount: v, currency: to, origAmount: t.amount, origCurrency: t.currency });
  }
  return out;
}
// Categories with budgets expressed in the currency on screen.
function categoriesForView() {
  if (!showAll()) return store.categories;
  const to = home();
  return store.categories.map((c) => {
    if (!c.budget || c.budgetCurrency === to) return c;
    const v = convert(c.budget, c.budgetCurrency, to);
    return v === null ? c : { ...c, budget: v, budgetCurrency: to };
  });
}
const insightsFor = (items, key) => A.insights(items, categoriesForView(), key, cur(), new Date(), { rollover: store.settings.budgetRollover });

const ui = {
  tab: 'dashboard',
  month: A.currentKey(),
  insightsMonth: A.currentKey(),
  slide: '',
  tx: { search: '', type: 'All', category: '', day: '' },
  locked: false,
  pickedInitial: false,
  report: null,
  year: null,
};

// ---------- helpers
function dialog({ title = '', message = '', buttons = [], stack = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="alertdialog">${title ? `<h3>${esc(title)}</h3>` : ''}<p>${esc(message)}</p><div class="modal-actions${stack ? ' stack' : ''}">${buttons.map((b, i) => `<button class="${b.danger ? 'danger' : b.primary ? 'primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b && e.target !== wrap) return;
      const value = b ? buttons[+b.dataset.i].value : false;
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 200);
      resolve(value);
    });
  });
}
const notify = (message, title = '') => dialog({ title, message, buttons: [{ label: 'OK', value: true, primary: true }] });
const ask = (message, { title = '', confirmText = 'Delete', danger = true } = {}) =>
  dialog({ title, message, buttons: [{ label: 'Cancel', value: false }, { label: confirmText, value: true, danger, primary: !danger }] });

// Asks for a password inside a small dialog. `check` may refuse it (returning a message), and the dialog stays open so the person can try again.
function askPassword({ title, message, confirmText = 'Continue', again = false, check = null }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    const field = (id, ph, ac) => `<input type="password" id="${id}" placeholder="${ph}" autocomplete="${ac}" autocapitalize="off" autocorrect="off" spellcheck="false">`;
    wrap.innerHTML = `<div class="modal" role="dialog"><h3>${esc(title)}</h3><p>${esc(message)}</p>
      ${field('pw1', 'Password', again ? 'new-password' : 'current-password')}${again ? field('pw2', 'Type it again', 'new-password') : ''}
      <p class="modal-err" id="pw-err" role="alert"></p>
      <div class="modal-actions"><button data-i="0">Cancel</button><button class="primary" data-i="1">${esc(confirmText)}</button></div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => { wrap.classList.add('show'); wrap.querySelector('#pw1').focus(); });
    const err = wrap.querySelector('#pw-err');
    const close = (v) => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 200); resolve(v); };
    let busy = false;
    const submit = async () => {
      if (busy) return;
      const a = wrap.querySelector('#pw1').value;
      if (again) {
        if (a.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
        if (a !== wrap.querySelector('#pw2').value) { err.textContent = 'The two passwords are not the same.'; return; }
      } else if (!a) { err.textContent = 'Type the password.'; return; }
      busy = true; err.textContent = 'Checking…';
      const go = wrap.querySelector('button.primary'); go.disabled = true;
      await new Promise((r) => setTimeout(r, 30)); // let the screen show "Checking…" before the heavy work starts
      const problem = check ? await check(a) : null;
      busy = false; go.disabled = false;
      if (problem) { err.textContent = problem; wrap.querySelector('#pw1').select(); return; }
      close(a);
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b && b.dataset.i === '1') submit();
      else if ((b && b.dataset.i === '0') || e.target === wrap) { if (!busy) close(null); }
    });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

// Anything that opens a sheet, a dialog or the import screen first clears an old message, so "Undo" never sits on top of its buttons.
const OPENERS = new Set(['add', 'edit', 'import-open', 'import-backup', 'export-backup', 'export-csv', 'export-xlsx', 'erase', 'add-owed', 'edit-owed', 'repay-open', 'add-goal', 'edit-goal', 'add-account', 'edit-account', 'add-category', 'edit-category', 'add-transfer', 'view-transfer', 'make-rule', 'toggle-pin', 'toggle-encrypt']);
function hideToast() { clearTimeout(toast.t); toast.fn = null; $('#toast').classList.remove('show'); }

function toast(text, action = null) {
  const el = $('#toast');
  el.innerHTML = esc(text) + (action ? ` <button data-action="toast-action">${esc(action.label)}</button>` : '');
  el.classList.toggle('actionable', !!action);
  toast.fn = action ? action.fn : null;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.classList.remove('show'); toast.fn = null; }, action ? 9000 : 2800);
}

function adoptCurrency() {
  if (store.transactions.some((t) => t.currency === store.settings.currency)) return;
  const counts = {};
  for (const t of store.transactions) counts[t.currency] = (counts[t.currency] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (best) store.setSetting('currency', best[0]);
}

function pickInitialMonth() {
  if (ui.pickedInitial) return;
  ui.pickedInitial = true;
  const items = ledger();
  const now = A.currentKey();
  if (items.some((t) => A.inMonth(t, now))) return;
  const latest = items.map((t) => t.date).sort().pop();
  if (latest) { ui.month = A.keyOf(latest); ui.insightsMonth = { ...ui.month }; }
}

// ---------- shared pieces
function monthNav(key, scope) {
  return `<div class="month-nav">
    <button class="arrow" data-action="step" data-scope="${scope}" data-delta="-1" aria-label="Previous month"><span>${icon('chevL')}</span></button>
    <div class="title"><span>${esc(A.keyTitle(key))}</span>${icon('chevD')}
      <input type="month" value="${A.keyStr(key)}" data-action="pick-month" data-scope="${scope}" aria-label="Choose month"></div>
    <button class="arrow" data-action="step" data-scope="${scope}" data-delta="1" aria-label="Next month"><span>${icon('chevR')}</span></button>
  </div>`;
}

// iPhone and iPad word things differently from Android (Safari, Files and iCloud Drive versus the browser, Downloads and a cloud drive).
const onIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const LOOKS = ['indigo', 'gold', 'cobalt', 'obsidian'];
const lookOf = () => (LOOKS.includes(store.settings.look) ? store.settings.look : 'indigo');
const isObsidian = () => lookOf() === 'obsidian';
// the two newer looks share the "Exp Tracker" title and the Total balance card
const isPremium = () => lookOf() === 'cobalt' || lookOf() === 'obsidian';

// The dark band at the top of every screen: title, actions and (on Home) the month and its headline figure.
function mast(title, { left = '', actions = '', nav = '', hero = '', swipe = false } = {}) {
  if (isPremium() && title === 'Expenses') title = 'Exp Tracker';
  return `<header class="mast" ${swipe ? 'data-swipe="month"' : ''}><div class="mast-top">${left}<h1>${esc(title)}</h1><div class="mast-actions">${actions}</div></div>${nav}${hero}</header>`;
}
function currencyBtn() {
  const all = home() && hasRates() ? `<option value="ALL" ${showAll() ? 'selected' : ''}>All currencies, in ${home()}</option>` : '';
  const opts = CURRENCIES.map((c) => `<option value="${c.code}" ${!showAll() && c.code === cur() ? 'selected' : ''}>${c.name} (${c.code})</option>`).join('');
  return `<div class="select-wrap pill-btn ${showAll() ? 'gold' : ''}">${showAll() ? 'All · ' + esc(home()) : esc(cur())}<select data-action="set-currency" aria-label="Currency">${all}${opts}</select></div>`;
}
const importBtn = () => `<button class="pill-btn icon-only" data-action="import-open" aria-label="Add a bank statement">${icon('import')}</button>`;

function tileHTML(t) {
  return `<div class="tile"><div class="val num ${t.tint === 'good' ? 'good' : t.tint === 'bad' ? 'bad' : ''}">${esc(t.value)}</div><div class="lbl">${esc(t.label)}</div></div>`;
}

// A category with its colour, amount and a thin share bar.
function catRow(item, clickable) {
  const color = C.slotColor(item.slot);
  const inner = `<div class="line"><span class="ic-wrap">${icon(A.iconFor(item.name))}</span>
      <span class="name">${esc(item.name)}</span><span class="amt num">${money(item.total)}</span></div>
    <div class="bar" style="height:4px"><div class="bar-fill" style="width:${(item.share * 100).toFixed(1)}%;background:var(--tint)"></div></div>`;
  return clickable ? `<button class="cat-row" style="--tint:${color}" data-action="show-category" data-category="${esc(item.name)}">${inner}</button>` : `<div class="cat-row" style="--tint:${color}">${inner}</div>`;
}

function breakdownCard(title, totals, { limit = 6, showAllAction = 'show-category-all' } = {}) {
  const rows = totals.slice(0, limit).map((t) => catRow(t, true)).join('');
  const more = totals.length > limit ? `<button class="link-btn" data-action="${showAllAction}">Show all ${totals.length}</button>` : '';
  return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><span class="meta">${totals.length} ${totals.length === 1 ? 'category' : 'categories'}</span></div>
    <div class="cat-list">${rows}</div>${more}</section>`;
}

function budgetCard(budgets) {
  const spent = budgets.reduce((a, b) => a + b.spent, 0), limit = budgets.reduce((a, b) => a + b.limit, 0);
  const rows = budgets.map((b) => {
    const fill = b.ratio >= 1 ? 'warn' : b.ratio >= 0.8 ? 'silver' : 'gold';
    const color = b.ratio >= 1 ? 'var(--bad)' : b.ratio >= 0.8 ? 'var(--ink-2)' : 'var(--accent)';
    const carried = b.carried > 0 ? ` · incl. ${money(b.carried)} carried over` : '';
    return `<div class="budget"><div class="line"><span style="color:${color}">${icon(A.iconFor(b.name))}</span><span class="name">${esc(b.name)}</span><span class="amt num">${money(b.spent)} / ${money(b.limit)}</span></div>
      ${C.bar(b.ratio, { fill, height: 8 })}<div class="sub"><span>${A.fmtPct(b.ratio)} used${carried}</span><span>${b.remaining >= 0 ? money(b.remaining) + ' left' : money(-b.remaining) + ' over'}</span></div></div>`;
  }).join('');
  return `<section class="card"><div class="card-head"><h2>Budgets</h2><span class="meta num">${money(spent)} of ${money(limit)}</span></div>${rows}</section>`;
}

function alertsCard(alerts) {
  if (!alerts.length) return '';
  const rows = alerts.map((a) => a.kind === 'category'
    ? `<button class="mover" data-action="show-category" data-category="${esc(a.name)}"><span class="ic-wrap up">${icon('up')}</span><div class="txt"><div class="n">${esc(a.name)} is ${esc(A.fmtPct(a.now / a.usual - 1))} above usual</div><div class="s">${money(a.now)} this month · usually about ${money(a.usual)}</div></div>${icon('chevR')}</button>`
    : `<button class="mover" data-action="edit" data-id="${a.tx.id}"><span class="ic-wrap up">${icon('up')}</span><div class="txt"><div class="n">Large payment: ${esc(a.tx.desc || a.tx.category)}</div><div class="s">${money(a.tx.amount)} on ${esc(A.fmtDay(a.tx.date))} · ${esc(a.tx.category)} is usually about ${money(a.usual)}</div></div>${icon('chevR')}</button>`).join('');
  return `<section class="card"><div class="card-head"><h2>Worth a look</h2><span class="meta">${alerts.length === 1 ? '1 thing' : alerts.length + ' things'}</span></div>${rows}</section>`;
}

function billsCard() {
  const bills = A.upcomingBills(store.rules).filter((b) => showAll() ? canConvert(b.rule.currency, cur()) : b.rule.currency === cur());
  if (!bills.length) return '';
  const amt = (r) => (showAll() ? convert(r.amount, r.currency, cur()) : r.amount);
  const out = bills.filter((b) => b.rule.type === 'Expense').reduce((a, b) => a + amt(b.rule), 0);
  const rows = bills.slice(0, 5).map((b) => `<div class="line-item"><span class="ic-wrap ${b.rule.type === 'Income' ? 'income' : 'expense'}">${icon(A.iconFor(b.rule.category))}</span><div class="txt"><div class="t">${esc(b.rule.desc || b.rule.category)}</div><div class="s">${b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : `In ${b.inDays} days`} · ${esc(A.fmtDay(b.due))}</div></div><span class="amt num ${b.rule.type === 'Income' ? 'pos' : ''}">${b.rule.type === 'Income' ? '+' : '−'}${money(amt(b.rule))}</span></div>`).join('');
  const balance = store.accounts.length ? totalAccountBalance() : null;
  const after = balance !== null && out > 0 ? `<p class="caption">Accounts after these bills: ${money(balance - out)}</p>` : '';
  return `<section class="card"><div class="card-head"><h2>Next 14 days</h2><span class="meta num">${out > 0 ? money(out) + ' due' : ''}</span></div>${rows}${after}</section>`;
}

function totalAccountBalance() {
  let total = 0;
  for (const a of store.accounts) {
    const bal = store.accountBalance(a.id);
    const v = a.currency === cur() ? bal : showAll() ? convert(bal, a.currency, cur()) : null;
    if (v !== null) total += v;
  }
  return total;
}

function goalsCard() {
  if (!store.goals.length) return '';
  const list = A.goalProgress(store.goals, store.transactions);
  const rows = list.map((g) => `<button class="goal" data-action="edit-goal" data-id="${g.id}"><div class="line"><span class="name">${esc(g.name)}</span><span class="amt num">${money(g.saved, g.currency)} <span class="muted">of ${money(g.target, g.currency)}</span></span></div>
    ${C.bar(g.progress, { fill: g.status === 'behind' ? 'silver' : 'gold', height: 8 })}<div class="sub"><span>${A.fmtPct(g.progress)}${g.deadline ? ' · by ' + esc(A.fmtDay(g.deadline)) + ' ' + g.deadline.slice(0, 4) : ''}</span><span class="${g.status === 'behind' ? 'warn' : g.status === 'done' ? 'pos' : ''}">${esc(g.detail)}</span></div></button>`).join('');
  return `<section class="card"><div class="card-head"><h2>Savings goals</h2><button class="link-btn" style="width:auto" data-action="add-goal">Add</button></div>${rows}</section>`;
}

function accountsCard() {
  if (!store.accounts.length) return '';
  const rows = store.accounts.map((a) => { const bal = store.accountBalance(a.id); return `<button class="line-item" data-action="edit-account" data-id="${a.id}"><span class="ic-wrap neutral">${icon('card')}</span><div class="txt"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.currency)}</div></div><span class="amt num ${bal < 0 ? 'warn' : ''}">${money(bal, a.currency)}</span></button>`; }).join('');
  return `<section class="card"><div class="card-head"><h2>Accounts</h2><button class="link-btn" style="width:auto" data-action="add-transfer" ${store.accounts.length < 2 ? 'disabled' : ''}>Transfer</button></div>${rows}</section>`;
}

// ---------- Home
// The headline figure drops the cents once it is big, so it always fits on one line.
function heroMoney(v) {
  const big = Math.abs(v) >= 1000;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur(), maximumFractionDigits: big ? 0 : 2, minimumFractionDigits: big ? 0 : 2 }).format(v); } catch { return money(v); }
}

// The Obsidian headline figure is monospaced, so its width is predictable: shrink it until it fits inside its card.
// Obsidian sets amounts in a fixed-width font, which leaves a wide gap around commas and dots; in the big figure they are drawn tighter
const heroText = (t) => (isObsidian() ? esc(t).replace(/[,.]/g, '<span class="sep">$&</span>') : esc(t));
function heroFit(text, max) {
  const room = Math.max(160, ($('#app')?.clientWidth || window.innerWidth) - 80);
  return Math.max(20, Math.min(max, Math.floor(room / (text.length * 0.6))));
}

function heroHTML(s) {
  const text = heroMoney(s.expense);
  const size = text.length <= 8 ? 46 : text.length <= 10 ? 40 : text.length <= 12 ? 35 : 30;
  const slices = A.slices(s.expenseByCategory);
  const total = slices.reduce((a, x) => a + x.total, 0);
  const segs = total > 0 ? slices.map((sl) => (sl.slot === null
    ? `<span class="seg" style="flex:${sl.total.toFixed(2)} 1 0;background:${C.slotColor(null)}" title="Other categories"></span>`
    : `<button class="seg" data-action="show-category" data-category="${esc(sl.name)}" style="flex:${sl.total.toFixed(2)} 1 0;background:${C.slotColor(sl.slot)}" aria-label="${esc(sl.name)}"></button>`)).join('') : '';
  const legend = slices.slice(0, 4).map((sl) => `<${sl.slot === null ? 'span' : 'button data-action="show-category" data-category="' + esc(sl.name) + '"'} class="lg"><span class="dot" style="background:${C.slotColor(sl.slot)}"></span>${esc(sl.name)} <b class="num">${A.fmtPct(sl.total / total)}</b></${sl.slot === null ? 'span' : 'button'}>`).join('');
  const sub = s.count === 0 ? '<span>Nothing recorded this month</span>'
    : s.income > 0 ? `<span>${money(s.income)} came in</span><span class="${s.balance >= 0 ? 'good' : 'over'}">${s.balance >= 0 ? money(s.balance) + ' left' : money(-s.balance) + ' over'}</span>`
      : '<span>No income recorded</span>';
  const bar = `${total > 0 ? `<div class="monthbar grow" role="img" aria-label="Spending by category">${segs}</div>` : ''}${legend ? `<div class="monthbar-legend">${legend}</div>` : ''}`;
  if (isPremium() && s.count > 0 && s.income > 0) {
    // Total balance: what came in minus what went out this month, with the two parts underneath
    const bt = heroMoney(s.balance);
    const bs = isObsidian() ? heroFit(bt, 40) : bt.length <= 8 ? 40 : bt.length <= 10 ? 34 : bt.length <= 12 ? 30 : 25;
    return `<div class="hero"><div class="hero-label">Total balance</div>
      <div class="hero-figure num ${s.balance < 0 ? 'neg' : ''}" style="font-size:${bs}px">${heroText(bt)}</div>
      <div class="hero-stats"><div><span class="lbl">Income</span><span class="val num in">+${esc(money(s.income))}</span></div><div><span class="lbl">Spent</span><span class="val num out">−${esc(money(s.expense))}</span></div></div>
      ${bar}</div>`;
  }
  const fs = isObsidian() ? heroFit(text, 38) : isPremium() ? Math.round(size * 0.82) : size;
  return `<div class="hero"><div class="hero-label">Total spent</div>
    <div class="hero-figure num" style="font-size:${fs}px">${heroText(text)}</div><div class="hero-sub">${sub}</div>
    ${bar}</div>`;
}

function owedTeaser() {
  const groups = groupPeople(store.owed);
  if (!groups.length) return '';
  const total = Object.entries(totalsByCurrency(store.owed)).map(([c, v]) => money(v, c)).join(' + ');
  const first = (g) => g.name.split(' ')[0];
  const who = groups.length === 1 ? first(groups[0]) : groups.length === 2 ? `${first(groups[0])} and ${first(groups[1])}` : `${first(groups[0])}, ${first(groups[1])} and ${groups.length - 2} more`;
  return `<button class="card teaser" data-action="go" data-tab="owed"><span class="ic-wrap">${icon('people')}</span><div class="grow"><p>${esc(who)} ${groups.length === 1 ? 'owes' : 'owe'} you ${esc(total)}</p><div class="more">Who owes me</div></div><span class="chev">${icon('chevR')}</span></button>`;
}

function renderDashboard() {
  pickInitialMonth();
  const items = ledger();
  const ins = insightsFor(items, ui.month);
  const s = ins.summary;
  const quick = A.quickAddItems(items);
  const other = store.transactions.length - items.length;

  const tiles = ins.tiles.length ? `<div class="strip">${ins.tiles.map(tileHTML).join('')}</div>` : '';
  const teaser = s.count ? `<button class="card teaser" data-action="go" data-tab="insights"><span class="ic-wrap">${icon('sparkles')}</span><div class="grow"><p>${esc(ins.sentences[0])}</p><div class="more">Read the full summary</div></div><span class="chev">${icon('chevR')}</span></button>` : '';
  const quickHTML = quick.length ? `<div><div class="strip-label">Quick add</div><div class="strip">${quick.map((q) => `<button class="chip ${q.type === 'Income' ? 'income' : ''}" data-action="quick-add" data-id="${q.id}">${icon(A.iconFor(q.category))}<span><div class="t">${esc(q.desc || q.category)}</div><div class="a num">${money(q.origAmount ?? q.amount, q.origCurrency ?? q.currency)}</div></span></button>`).join('')}</div></div>` : '';
  const budgets = ins.budgets.length ? budgetCard(ins.budgets) : '';

  let body = '';
  if (store.transactions.length === 0) {
    body = `<section class="card"><div class="empty">${icon('tray')}<h3>Start with your bank statement</h3>
      <p>Choose the Excel, CSV or PDF statement from your bank. I sort it into categories and check it against your balance, so nothing is missed or counted twice.</p>
      <button class="btn primary block" data-action="import-open">Add a bank statement</button><button class="btn secondary block" data-action="add">Add one by hand</button></div></section>`;
  } else if (s.count === 0) {
    body = `<section class="card"><div class="empty">${icon('tray')}<h3>${items.length ? `Nothing recorded in ${esc(A.keyTitle(ui.month))}` : `No ${esc(cur())} transactions yet`}</h3>
      <p>${items.length ? 'Choose another month with the arrows above, or add something.' : 'Add a transaction, or import a statement in this currency.'}</p>
      <button class="btn primary" data-action="add">Add transaction</button></div></section>`;
  } else {
    body = (s.expenseByCategory.length ? breakdownCard('Where it went', s.expenseByCategory) : '')
      + (s.incomeByCategory.length ? breakdownCard('Money in', s.incomeByCategory, { limit: 4, showAllAction: 'show-income-all' }) : '');
  }
  const tr = A.trend(items, ui.month);
  const net = tr.reduce((a, p) => a + p.balance, 0);
  const trendHTML = items.length ? `<section class="card"><div class="card-head"><h2>Last 6 months</h2><span class="meta num ${net >= 0 ? 'pos' : 'warn'}">Net ${signed(net)}</span></div>${C.columns(tr, { formatY: C.compact })}<div class="legend-inline"><span class="li">Money in</span><span class="le">Spent</span></div></section>` : '';
  const otherNote = showAll()
    ? `<p class="footer-note">All currencies converted into ${esc(cur())} at the latest rates (${esc(store.settings.rates.date)}).${other ? ` ${other} transactions could not be converted.` : ''}</p>`
    : other ? `<p class="footer-note">Showing ${esc(cur())} only. ${other} more transactions are kept in other currencies; switch with the ${esc(cur())} button at the top.</p>` : '';

  return mast('Expenses', { actions: importBtn() + currencyBtn(), nav: monthNav(ui.month, 'dash'), hero: heroHTML(s), swipe: true })
    + `<div class="screen"><div class="stack ${ui.slide}">${entryHTML()}${alertsCard(ins.alerts)}${teaser}${owedTeaser()}${tiles}${quickHTML}${body}${budgets}${billsCard()}${goalsCard()}${accountsCard()}${trendHTML}${otherNote}</div></div>`;
}

// ---------- Insights
function renderInsights() {
  pickInitialMonth();
  const items = ledger();
  const key = ui.insightsMonth;
  const ins = insightsFor(items, key);
  const s = ins.summary;
  const rate = ins.savingsRate;
  const summaryCard = `<section class="card gold-edge"><div class="card-head" style="align-items:flex-start"><div><div class="muted" style="font-size:14px">${esc(A.keyTitle(key))}</div><h2 style="font-size:22px">In brief</h2></div>
      ${C.ring(rate, { text: s.income > 0 ? A.fmtPct(rate) : '–' })}</div>
    <ul class="sentences">${ins.sentences.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;

  let detail = '';
  if (s.count > 0) {
    const busiest = ins.weekdays.reduce((a, b) => (b.average > a.average ? b : a), ins.weekdays[0]);
    detail += `<section class="card"><div class="card-head"><h2>Spending calendar</h2><span class="meta num">Avg ${money(ins.perDay)}/day</span></div>${C.heatmap(ins.daily, key)}<p class="caption">Darker means more spent. Tap a day to see its transactions.</p></section>`;
    detail += `<section class="card"><div class="card-head"><h2>By weekday</h2><span class="meta">${busiest.average > 0 ? esc(A.WEEKDAYS[busiest.weekday]) + 's cost most' : ''}</span></div>${C.weekdayBars(ins.weekdays, { formatY: C.compact })}<p class="caption">Average spent on each weekday this month.</p></section>`;
    if (ins.movers.length) {
      detail += `<section class="card"><div class="card-head"><h2>Biggest changes</h2><span class="meta">vs ${esc(A.keyShort(A.prevKey(key)))}</span></div>` + ins.movers.map((m) => `<button class="mover" data-action="show-category" data-category="${esc(m.name)}"><span class="ic-wrap ${m.change > 0 ? 'up' : 'down'}">${icon(m.change > 0 ? 'up' : 'down')}</span><div class="txt"><div class="n">${esc(m.name)}</div><div class="s num">${money(m.before)} → ${money(m.now)}</div></div><span class="chg num ${m.change > 0 ? 'warn' : 'pos'}">${signed(m.change)}</span>${icon('chevR')}</button>`).join('') + '</section>';
    }
  }
  const positive = ins.balanceTrend.filter((p) => p.balance > 0).length;
  const trendCard = `<section class="card"><div class="card-head"><h2>Left over, by month</h2><span class="meta ${ins.streak >= 2 ? 'pos' : ''}">${ins.streak >= 2 ? icon('flame', 'ic-sm') + ' ' + ins.streak + ' month streak' : positive + ' of 6 positive'}</span></div>${C.balanceBars(ins.balanceTrend, { format: C.compact })}</section>`;

  const subs = A.subscriptions(items, store.rules);
  const subsCard = subs.length ? `<section class="card"><div class="card-head"><h2>Repeating payments</h2><span class="meta num">${money(subs.reduce((a, x) => a + x.monthly, 0))}/month</span></div>
    ${subs.slice(0, 8).map((x) => `<div class="line-item"><span class="ic-wrap expense">${icon(A.iconFor(x.category))}</span><div class="txt"><div class="t">${esc(x.desc)}</div><div class="s">${money(x.amount, x.currency)} · ${x.frequency.toLowerCase()} · seen ${x.count}× · last ${esc(A.fmtDay(x.lastDate))}</div></div>
      ${x.hasRule ? `<span class="pill-btn muted">${icon('check')}</span>` : x.frequency === 'Yearly' ? '' : `<button class="pill-btn gold" data-action="make-rule" data-desc="${esc(x.desc)}" data-category="${esc(x.category)}" data-amount="${x.amount}" data-currency="${x.currency}" data-frequency="${x.frequency}" data-last="${x.lastDate}">Automate</button>`}</div>`).join('')}
    <p class="caption">Found by looking for the same amount coming back at a steady rhythm. Automate adds it as a recurring rule so it is recorded for you.</p></section>` : '';

  const years = A.yearsWithData(items);
  const yearCard = years.length ? `<section class="card"><div class="card-head"><h2>Year in review</h2></div><div class="year-row">${years.slice(0, 4).map((y) => `<button class="btn secondary" data-action="open-year" data-year="${y}">${y}</button>`).join('')}</div></section>` : '';

  const reportCard = `<section class="card"><div class="card-head"><h2>Monthly report</h2><button class="link-btn" style="width:auto" data-action="go" data-tab="settings">Settings</button></div>
    <div class="row" style="padding:0;border:0"><span class="ic-wrap income">${icon('doc')}</span><div class="txt"><div class="t">${esc(A.keyTitle(key))} report</div><div class="s">${s.count ? 'Totals, summary, categories, budgets, trend, largest expenses' : 'No data for this month'}</div></div></div>
    <button class="btn secondary block mt" data-action="open-report" data-key="${A.keyStr(key)}" ${s.count ? '' : 'disabled'}>${icon('doc')} View report (PDF / print)</button>
    <p class="caption">${reportScheduleText()}</p></section>`;

  return mast('Insights', { actions: currencyBtn(), nav: monthNav(key, 'ins') })
    + `<div class="screen"><div class="stack ${ui.slide}">${summaryCard}${detail}${trendCard}${subsCard}${yearCard}${reportCard}</div></div>`;
}

function reportScheduleText() {
  const st = store.settings;
  if (!st.reportsEnabled) return 'Monthly report reminders are off. Turn them on in Settings to be reminded on a day you choose.';
  const d = new Date();
  const k = A.currentKey();
  const due = d.getDate() >= st.reportDay;
  const covers = due ? A.keyTitle(k) : A.keyTitle(A.prevKey(k));
  const next = due ? `${A.MONTHS_SHORT[k.month % 12]} ${st.reportDay}` : `${A.MONTHS_SHORT[k.month - 1]} ${st.reportDay}`;
  return `Next reminder: ${next}, for the ${covers} report. It appears when you open the app.`;
}

// ---------- Activity (all transactions)
function renderTransactions() {
  const items = ledger();
  const f = ui.tx;
  const q = f.search.trim().toLowerCase();
  const tagQ = q.startsWith('#') ? q.slice(1) : null;
  const visible = items.filter((t) => {
    if (f.type === 'Income' && t.type !== 'Income') return false;
    if (f.type === 'Expense' && t.type !== 'Expense') return false;
    if (f.category && t.category !== f.category) return false;
    if (f.day && t.date !== f.day) return false;
    if (!q) return true;
    const tags = (t.tags || []).map((x) => x.toLowerCase());
    if (tagQ !== null) return tags.some((x) => x.includes(tagQ));
    return (t.desc || '').toLowerCase().includes(q) || (t.raw || '').toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || tags.some((x) => x.includes(q)) || t.amount.toFixed(2).startsWith(q.replace(',', '.'));
  });
  const groups = new Map();
  for (const t of visible) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  // transfers between accounts show in the list too (not counted in totals)
  if (f.type === 'All' && !f.category && !q) {
    for (const tr of store.transfers) {
      if (tr.currency !== cur() && !showAll()) continue;
      if (f.day && tr.date !== f.day) continue;
      if (!groups.has(tr.date)) groups.set(tr.date, []);
      groups.get(tr.date).push({ ...tr, transfer: true });
    }
  }
  const days = [...groups.keys()].sort().reverse();
  const totals = visible.reduce((a, t) => { if (t.type === 'Income') a.i += t.amount; else a.e += t.amount; return a; }, { i: 0, e: 0 });
  const names = [...new Set(items.map((t) => t.category))].sort();
  const catOpts = `<option value="">All categories</option>` + names.map((n) => `<option value="${esc(n)}" ${n === f.category ? 'selected' : ''}>${esc(n)}</option>`).join('');

  const seg = `<div class="seg">${['All', 'Income', 'Expense'].map((v) => `<button class="${f.type === v ? 'on' : ''}" data-action="tx-type" data-value="${v}">${v === 'Income' ? 'Money in' : v === 'Expense' ? 'Money out' : 'All'}</button>`).join('')}</div>`;
  const tools = `<div class="toolbar-row"><label class="search">${icon('search')}<input type="search" placeholder="Search name, #tag, category or amount" value="${esc(f.search)}" data-action="tx-search" autocomplete="off"></label>
    <div class="select-wrap pill-btn icon-only" style="height:42px;width:42px;border-radius:14px;color:${f.category ? 'var(--accent)' : 'var(--ink-2)'}">${icon('filter')}<select data-action="tx-category" aria-label="Filter by category">${catOpts}</select></div></div>`;
  const filters = (f.category ? ` · <button data-action="tx-clear-category" class="gold">Clear: ${esc(f.category)}</button>` : '') + (f.day ? ` · <button data-action="tx-clear-day" class="gold">Clear: ${esc(A.fmtDay(f.day))}</button>` : '');
  const summary = `<p class="footer-note">${visible.length} ${visible.length === 1 ? 'transaction' : 'transactions'} · In ${money(totals.i)} · Out ${money(totals.e)}${filters}</p>`;

  let list = '';
  if (!days.length) {
    list = `<section class="card"><div class="empty">${icon(items.length ? 'search' : 'tray')}<h3>${items.length ? 'No matches' : 'No transactions yet'}</h3><p>${items.length ? 'Try a different search or filter.' : `Tap + to add your first ${esc(cur())} transaction, or add a bank statement.`}</p>${items.length ? '' : '<button class="btn primary" data-action="import-open">Add a bank statement</button>'}</div></section>`;
  } else {
    list = days.map((d) => {
      const rows = groups.get(d).sort((a, b) => ((b.time || '') === (a.time || '') ? b.createdAt - a.createdAt : (b.time || '') < (a.time || '') ? -1 : 1));
      const net = rows.filter((t) => !t.transfer).reduce((a, t) => a + (t.type === 'Income' ? t.amount : -t.amount), 0);
      return `<div class="day"><div class="section-title"><span>${esc(A.fmtDayFull(d))}</span><span class="num">${signed(net)}</span></div><div class="rows">${rows.map((t) => (t.transfer ? transferRow(t) : txRow(t))).join('')}</div></div>`;
    }).join('');
  }
  return mast('Activity', { actions: importBtn() + currencyBtn() }) + `<div class="screen">${seg}${tools}${summary}<div class="list">${list}</div></div>`;
}

function txRow(t) {
  const income = t.type === 'Income';
  const bits = [t.category];
  if (t.time) bits.push(t.time);
  if (t.group) bits.push('split');
  if (t.origCurrency) bits.push(money(t.origAmount, t.origCurrency));
  const tags = (t.tags || []).map((x) => `<span class="tagchip">#${esc(x)}</span>`).join('');
  return `<button class="row" data-action="edit" data-id="${t.id}"><span class="ic-wrap ${income ? 'income' : 'expense'}">${icon(A.iconFor(t.category))}</span>
    <div class="txt"><div class="t">${esc(t.desc || t.category)}${t.receipt ? ` <span class="muted">${icon('camera', 'ic-sm')}</span>` : ''}</div><div class="s">${esc(bits.join(' · '))}${tags ? ' ' + tags : ''}</div></div>
    <span class="amt num ${income ? 'income' : ''}">${income ? '+' : '−'}${money(t.amount, t.currency)}</span></button>`;
}
function transferRow(t) {
  const name = (id) => (store.accounts.find((a) => a.id === id) || { name: '?' }).name;
  return `<button class="row" data-action="view-transfer" data-id="${t.id}"><span class="ic-wrap neutral">${icon('swap')}</span>
    <div class="txt"><div class="t">${esc(name(t.from))} → ${esc(name(t.to))}</div><div class="s">Transfer${t.note ? ' · ' + esc(t.note) : ''}</div></div>
    <span class="amt num muted">${money(t.amount, t.currency)}</span></button>`;
}

// ---------- Categories (opened from More)
function renderCategories() {
  const counts = new Map();
  for (const t of store.transactions) { const k = t.type + '|' + t.category; counts.set(k, (counts.get(k) || 0) + 1); }
  const section = (type) => {
    const rows = store.categories.filter((c) => c.type === type).map((c) => {
      const n = counts.get(type + '|' + c.name) || 0;
      return `<button class="row" data-action="edit-category" data-id="${c.id}"><span class="ic-wrap ${type === 'Income' ? 'income' : 'expense'}">${icon(A.iconFor(c.name))}</span>
        <div class="txt"><div class="t">${esc(c.name)}</div>${c.budget > 0 ? `<div class="s">Budget ${money(c.budget, c.budgetCurrency)} / month</div>` : ''}</div>
        ${n ? `<span class="count">${n}</span>` : ''}${icon('chevR', 'chev')}</button>`;
    }).join('');
    return `<div><div class="section-title"><span>${type === 'Income' ? 'Money in' : 'Money out'}</span></div><div class="rows">${rows || '<div class="row muted">No categories</div>'}</div></div>`;
  };
  return mast('Categories', { left: `<button class="pill-btn icon-only" data-action="go" data-tab="settings" aria-label="Back to More">${icon('chevL')}</button>`, actions: `<button class="pill-btn icon-only" data-action="add-category" aria-label="Add category">${icon('plus')}</button>` })
    + `<div class="screen"><div class="list">${section('Expense')}${section('Income')}</div><p class="footer-note">The number is how many transactions use the category. Tap one to rename it, set a monthly budget, or delete it.</p></div>`;
}

// ---------- Who owes me
function dayText(iso) { return A.fmtDay(iso) + (iso.slice(0, 4) !== todayISO().slice(0, 4) ? ' ' + iso.slice(0, 4) : ''); }

function renderOwed() {
  const groups = groupPeople(store.owed);
  const totals = totalsByCurrency(store.owed);
  const ignore = store.settings.owedIgnore || [];
  const sugg = suggestRepayments(store.owed, store.transactions).filter((x) => !ignore.includes(x.tx.id)).slice(0, 3);
  const entries = Object.entries(totals);
  const figure = entries.length ? entries.map(([c, v]) => heroMoney2(v, c)).join(' + ') : heroMoney2(0, store.settings.currency);
  const size = figure.length <= 8 ? 46 : figure.length <= 10 ? 40 : figure.length <= 12 ? 35 : 28;
  const hero = `<div class="hero"><div class="hero-label">Still owed to you</div><div class="hero-figure num" style="font-size:${size}px">${esc(figure)}</div>
    <div class="hero-sub"><span>${groups.length ? `${groups.length} ${groups.length === 1 ? 'person' : 'people'}` : 'Nobody owes you anything'}</span></div></div>`;

  const suggHTML = sugg.map((x) => `<div class="card owe-sugg"><span class="ic-wrap">${icon('sparkles')}</span><div class="grow"><p>${esc(x.name)} sent you ${money(x.tx.amount, x.tx.currency)} on ${esc(dayText(x.tx.date))}. Is this paying you back?</p>
      <div class="owe-sugg-actions"><button class="btn primary sm" data-action="owed-accept" data-tx="${x.tx.id}" data-key="${esc(x.key)}">Yes, mark as paid</button><button class="btn secondary sm" data-action="owed-ignore" data-tx="${x.tx.id}">No</button></div></div></div>`).join('');

  const people = groups.map((g) => {
    const rows = g.open.map((d) => {
      const paid = paidOf(d);
      return `<button class="row" data-action="edit-owed" data-id="${d.id}"><div class="txt"><div class="t">${esc(d.note || 'Money you paid for them')}</div><div class="s">${esc(dayText(d.date))}${paid > 0 ? ` · ${money(d.amount, d.currency)} in all, ${money(paid, d.currency)} paid` : ''}</div></div><span class="value num">${money(leftOf(d), d.currency)}</span></button>`;
    }).join('');
    const sum = Object.entries(g.totals).map(([c, v]) => money(v, c)).join(' + ');
    return `<section class="card owe-card"><div class="card-head"><h2>${esc(g.name)}</h2><span class="meta num strong">${esc(sum)}</span></div><div class="rows flush">${rows}</div>
      <div class="owe-actions"><button class="btn primary" data-action="repay-open" data-key="${esc(g.key)}">Paid back</button><button class="btn secondary" data-action="remind" data-key="${esc(g.key)}">Remind</button></div></section>`;
  }).join('');

  const settled = store.owed.filter((d) => leftOf(d) <= 0.004).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const settledHTML = settled.length ? `<div><div class="section-title"><span>Paid back</span></div><div class="rows">${settled.map((d) => `<button class="row" data-action="edit-owed" data-id="${d.id}"><span class="ic-wrap income">${icon('check')}</span><div class="txt"><div class="t">${esc(d.person)}${d.note ? ' · ' + esc(d.note) : ''}</div><div class="s">${esc(dayText(d.date))}</div></div><span class="value num">${money(d.amount, d.currency)}</span></button>`).join('')}</div></div>` : '';

  const empty = !groups.length ? `<section class="card"><div class="empty">${icon('people')}<h3>Nobody owes you anything</h3>
    <p>On Home, type “lent Ravi 500” or “split dinner 1200 with Ravi and Meena”. Or add one here.</p><button class="btn primary" data-action="add-owed">Add what someone owes</button></div></section>` : '';

  return mast('Who owes me', { left: `<button class="pill-btn icon-only" data-action="go" data-tab="settings" aria-label="Back to More">${icon('chevL')}</button>`, actions: `<button class="pill-btn icon-only" data-action="add-owed" aria-label="Add">${icon('plus')}</button>`, hero })
    + `<div class="screen"><div class="stack">${suggHTML}${people}${empty}${settledHTML}</div>${groups.length ? `<p class="footer-note">Tap a line to change it. “Paid back” also adds the money to Money in, so what you spent and what came back cancel out.</p>` : ''}</div>`;
}

function heroMoney2(v, code) {
  const big = Math.abs(v) >= 1000;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: big ? 0 : 2, minimumFractionDigits: big ? 0 : 2 }).format(v); } catch { return money(v, code); }
}

const knownPeople = () => groupPeople(store.owed).map((g) => g.name).concat([...new Set(store.owed.filter((d) => leftOf(d) <= 0.004).map((d) => d.person))].filter((n) => !groupPeople(store.owed).some((g) => g.key === personKey(n)))).slice(0, 8);

function personChips(current) {
  const names = knownPeople().filter((n) => personKey(n) !== personKey(current));
  return names.length ? `<div class="suggest">${names.map((n) => `<button data-action="f-person" data-value="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : '';
}

function owedForm(d = null) {
  const v = { person: d?.person || '', amount: d ? String(d.amount) : '', currency: d?.currency || store.settings.currency, date: d?.date || todayISO(), note: d?.note || '' };
  sheetState = { kind: 'owed', id: d?.id || null, values: v };
  renderOwedForm();
}
const canSaveOwed = (v) => v.person.trim() && num(v.amount) > 0 && v.date;
function renderOwedForm() {
  const st = sheetState, v = st.values, editing = !!st.id;
  const d = editing ? store.owed.find((x) => x.id === st.id) : null;
  const paid = d ? paidOf(d) : 0;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit' : 'Someone owes me'}</h2><button class="save" data-action="sheet-save" ${canSaveOwed(v) ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>Who</label><div class="control">${icon('people')}<input value="${esc(v.person)}" data-field="person" placeholder="Name" autocomplete="off" ${editing ? '' : 'autofocus'}></div>${personChips(v.person)}</div>
    <div class="field"><label>Amount</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0.00" value="${esc(v.amount)}" data-field="amount"><select data-field="currency" aria-label="Currency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.currency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div>
      ${paid > 0 ? `<div class="hint">${money(paid, v.currency)} of this has been paid back already.</div>` : ''}</div>
    <div class="field"><label>For (optional)</label><div class="control"><input value="${esc(v.note)}" data-field="note" placeholder="e.g. Dinner, Movie tickets" autocomplete="off"></div></div>
    <div class="field"><label>Date</label><div class="control">${icon('calendar')}<input type="date" value="${v.date}" data-field="date"></div>
      ${editing ? '' : '<div class="hint">This only adds to Who owes me. To record the spending too, add it as a transaction and choose “Someone owes me for this”.</div>'}</div>
    ${editing ? `<button class="btn danger block" data-action="f-delete-owed">Delete</button>` : ''}
  </div>`;
  paintSheet(html, st);
}
function saveOwed() {
  const st = sheetState, v = st.values;
  if (!canSaveOwed(v)) return;
  const data = { person: v.person.trim(), amount: Math.round(num(v.amount) * 100) / 100, currency: v.currency, date: v.date, note: v.note.trim() };
  if (st.id) store.updateOwed(st.id, data); else store.addOwed(data);
  closeSheet(); toast('Saved');
}

function repayForm(key) {
  const g = groupPeople(store.owed).find((x) => x.key === key);
  if (!g) return;
  const codes = Object.keys(g.totals);
  const currency = codes.includes(store.settings.currency) ? store.settings.currency : codes[0];
  sheetState = { kind: 'repay', id: null, values: { person: g.name, amount: String(g.totals[currency]), currency, date: todayISO(), record: true }, codes };
  renderRepayForm();
}
function repayHint(v) {
  const a = num(v.amount);
  const plan = repayPlan(store.owed, v.person, a > 0 ? a : 0, v.currency);
  if (!(a > 0)) return '';
  if (plan.leftover > 0.004) return `That is ${money(plan.leftover, v.currency)} more than ${v.person.split(' ')[0]} owes. Only ${money(plan.outstanding, v.currency)} is counted.`;
  const left = Math.round((plan.outstanding - a) * 100) / 100;
  return left > 0.004 ? `${money(left, v.currency)} will still be owed.` : 'This settles everything.';
}
function renderRepayForm() {
  const st = sheetState, v = st.values;
  const ok = num(v.amount) > 0;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${esc(v.person)} paid back</h2><button class="save" data-action="sheet-save" ${ok ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>How much</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0.00" value="${esc(v.amount)}" data-field="amount" autofocus>
      ${st.codes.length > 1 ? `<select data-field="currency" aria-label="Currency" style="flex:0 0 auto">${st.codes.map((c) => `<option value="${c}" ${c === v.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>` : `<span class="unit">${esc(v.currency)}</span>`}</div>
      <div class="hint" id="repay-hint">${esc(repayHint(v))}</div></div>
    <div class="field"><label>Date</label><div class="control">${icon('calendar')}<input type="date" value="${v.date}" data-field="date"></div></div>
    <label class="row setting plain">${icon('plus')}<span class="grow">Also add to Money in</span><input type="checkbox" data-action="f-record" ${v.record ? 'checked' : ''}></label>
    <div class="hint">Leave this on unless the payment is already in your list, for example from a bank statement.</div>
  </div>`;
  paintSheet(html, st);
}
function recordRepayment(person, amount, currency, date, { record = true, txId = null } = {}) {
  const plan = repayPlan(store.owed, person, amount, currency);
  const got = Math.round((amount - plan.leftover) * 100) / 100;
  if (!(got > 0)) return null;
  let id = txId;
  let created = null;
  if (!id && record) { created = store.addTransaction({ type: 'Income', category: store.paidBackCategory(), amount: got, currency, date, desc: `Paid back by ${person}` }); id = created.id; }
  const r = store.repay(person, got, { date, currency, txId: id });
  return { ...r, got, createdTx: created ? created.id : null };
}
function saveRepay() {
  const v = sheetState.values;
  const amount = num(v.amount);
  if (!(amount > 0)) return;
  const r = recordRepayment(v.person, amount, v.currency, v.date, { record: v.record });
  closeSheet();
  if (!r) { toast('Nothing to mark off'); return; }
  toast(`${v.person.split(' ')[0]} paid back ${money(r.got, v.currency)}`, { label: 'Undo', fn: () => { store.undoRepay(r.before); if (r.createdTx) store.deleteTransaction(r.createdTx); toast('Undone'); } });
}

async function remind(key) {
  const g = groupPeople(store.owed).find((x) => x.key === key);
  if (!g) return;
  const text = reminderText(g.name, g.open, (v, c) => money(v, c));
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Message copied. Paste it into WhatsApp or Messages.'); }
  catch { await notify(text, 'Copy this message'); }
}

// ---------- More (settings)
function renderSettings() {
  const st = store.settings;
  const counts = CURRENCIES.map((c) => ({ c, n: store.transactions.filter((t) => t.currency === c.code).length })).filter((x) => x.n > 0);
  const activeRules = store.rules.filter((r) => r.active).length;
  const curOpts = CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === st.currency ? 'selected' : ''}>${c.code}</option>`).join('');
  const homeOpts = `<option value="" ${!st.homeCurrency ? 'selected' : ''}>Off</option>` + CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === st.homeCurrency ? 'selected' : ''}>${c.code}</option>`).join('');
  const dayOpts = Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === st.reportDay ? 'selected' : ''}>${ordinal(d)}</option>`).join('');
  const lastExport = st.lastExport ? new Date(st.lastExport).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'never';
  const ratesNote = !st.homeCurrency ? 'Pick a home currency to see all your money in one currency. Rates download automatically when you are online.'
    : hasRates() ? `Rates from ${st.rates.date}. Choose "All currencies" from the currency button at the top of Home.` : 'Rates have not downloaded yet — open the app while online.';

  const rules = store.rules.length ? store.rules.map((r) => `<div class="row"><span class="ic-wrap ${r.type === 'Income' ? 'income' : 'expense'}">${icon(A.iconFor(r.category))}</span>
      <div class="txt"><div class="t">${esc(r.desc || r.category)}</div><div class="s">${esc(r.category)} · ${money(r.amount, r.currency)} · ${r.frequency} · ${r.active ? 'next ' + esc(A.fmtDay(nextDue(r))) : 'paused'}</div></div>
      <button class="pill-btn" data-action="toggle-rule" data-id="${r.id}" style="color:${r.active ? 'var(--ink-2)' : 'var(--accent)'}">${r.active ? 'Pause' : 'Resume'}</button>
      <button class="pill-btn icon-only" data-action="delete-rule" data-id="${r.id}" aria-label="Delete rule" style="color:var(--bad)">${icon('trash')}</button></div>`).join('')
    : `<div class="row muted">No recurring transactions. Choose Repeat when adding rent, salary or a subscription.</div>`;

  const accounts = store.accounts.map((a) => `<button class="row setting" data-action="edit-account" data-id="${a.id}">${icon('card')}<span class="grow">${esc(a.name)}</span><span class="value num">${money(store.accountBalance(a.id), a.currency)}</span></button>`).join('');
  const goals = A.goalProgress(store.goals, store.transactions).map((g) => `<button class="row setting" data-action="edit-goal" data-id="${g.id}">${icon('flag')}<span class="grow">${esc(g.name)}</span><span class="value num">${A.fmtPct(g.progress)}</span></button>`).join('');
  const imports = store.imports.slice(0, 6).map((im) => `<div class="row"><span class="ic-wrap neutral">${icon('doc')}</span>
      <div class="txt"><div class="t">${esc(im.name || 'Import')}</div><div class="s">${im.count} ${im.count === 1 ? 'transaction' : 'transactions'}${im.from ? ' · ' + esc(A.fmtDay(im.from)) + ' – ' + esc(A.fmtDay(im.to)) + ' ' + esc(im.to.slice(0, 4)) : ''} · added ${esc(new Date(im.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</div></div>
      <button class="pill-btn" data-action="undo-import" data-id="${im.id}" style="color:var(--bad)">Undo</button></div>`).join('');
  const taught = Object.keys(store.merchants).length;
  const theme = st.theme || 'auto';
  const look = lookOf();

  return mast('More', { actions: currencyBtn() }) + `<div class="screen"><div class="list">
    <div><div class="section-title"><span>Bank statements</span></div><div class="rows">
      <button class="row setting" data-action="import-open">${icon('import')}<span class="grow">Add a bank statement</span><span class="value">${icon('chevR')}</span></button>
      ${imports}</div>
      <p class="footer-note">${store.imports.length ? 'Undo removes everything that came from that import and nothing else. ' : ''}${taught ? `I have learned ${taught} ${taught === 1 ? 'name' : 'names'} from you. ` : ''}Excel, CSV and PDF statements work; rows already in your list are left out.</p></div>

    <div><div class="section-title"><span>Organise</span></div><div class="rows">
      <button class="row setting" data-action="go" data-tab="owed">${icon('people')}<span class="grow">Who owes me</span><span class="value num">${esc(Object.entries(totalsByCurrency(store.owed)).map(([c, v]) => money(v, c)).join(' + '))}</span>${icon('chevR', 'chev')}</button>
      <button class="row setting" data-action="go" data-tab="categories">${icon('grid')}<span class="grow">Categories and budgets</span><span class="value">${icon('chevR')}</span></button>
      <label class="row setting">${icon('swap')}<span class="grow">Currency</span><select data-action="set-currency-default">${curOpts}</select></label>
      <label class="row setting">${icon('globe')}<span class="grow">Home currency</span><select data-action="set-home">${homeOpts}</select></label></div>
      <p class="footer-note">${ratesNote}</p></div>

    <div><div class="section-title"><span>Accounts</span></div><div class="rows">${accounts}
      <button class="row setting" data-action="add-account">${icon('plus')}<span class="grow">Add account</span><span class="value">${icon('chevR')}</span></button></div>
      <p class="footer-note">Optional: Cash, Bank, Credit card… Pick an account when adding a transaction and the app keeps each balance. Transfers between accounts are on Home.</p></div>

    <div><div class="section-title"><span>Savings goals</span></div><div class="rows">${goals}
      <button class="row setting" data-action="add-goal">${icon('plus')}<span class="grow">Add goal</span><span class="value">${icon('chevR')}</span></button></div>
      <p class="footer-note">Progress is what you keep (income minus expenses) from the goal's start date, plus anything you marked as already saved. Open a goal to see its plan.</p></div>

    <div><div class="section-title"><span>Automation</span></div><div class="rows">
      <label class="row setting">${icon('doc')}<span class="grow">Monthly report reminder</span><input type="checkbox" data-action="toggle-reports" ${st.reportsEnabled ? 'checked' : ''}></label>
      ${st.reportsEnabled ? `<label class="row setting">${icon('calendar')}<span class="grow">Remind me on the</span><select data-action="set-report-day">${dayOpts}</select></label>` : ''}
      <label class="row setting">${icon('refresh')}<span class="grow">Carry unspent budget to next month</span><input type="checkbox" data-action="toggle-rollover" ${st.budgetRollover ? 'checked' : ''}></label>
    </div><p class="footer-note">${reportScheduleText()}</p></div>

    <div><div class="section-title"><span>Recurring transactions</span><span>${activeRules} active</span></div><div class="rows">${rules}</div>
      <p class="footer-note">Due entries are added when you open the app. Insights also spots repeating payments you have not automated yet.</p></div>

    <div><div class="section-title"><span>Appearance and security</span></div><div class="rows">
      <label class="row setting">${icon('palette')}<span class="grow">Colours</span><select data-action="set-look"><option value="indigo" ${look === 'indigo' ? 'selected' : ''}>Indigo (new)</option><option value="cobalt" ${look === 'cobalt' ? 'selected' : ''}>Alabaster & Cobalt</option><option value="obsidian" ${look === 'obsidian' ? 'selected' : ''}>Obsidian & Emerald</option><option value="gold" ${look === 'gold' ? 'selected' : ''}>Black and gold (classic)</option></select></label>
      ${look !== 'indigo' ? '' : `<label class="row setting">${icon('sparkles')}<span class="grow">Appearance</span><select data-action="set-theme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Match my phone</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option></select></label>`}
      <label class="row setting">${icon('lock')}<span class="grow">Require a PIN to open</span><input type="checkbox" data-action="toggle-pin" ${st.pinHash ? 'checked' : ''}></label>
      ${vaultAvailable() ? `<label class="row setting">${icon('shield')}<span class="grow">Lock saved data with a passphrase</span><input type="checkbox" data-action="toggle-encrypt" ${store.encrypted ? 'checked' : ''}></label>` : ''}</div>
      <p class="footer-note">The PIN is a screen lock: a 4–6 digit code asked when the app opens, and it cannot be recovered if forgotten. The passphrase goes further: it scrambles the data stored on this phone, receipt photos included, and you type it each time you open the app. If you forget it, nobody can get your data back, so keep a backup.</p></div>

    <div><div class="section-title"><span>Your data</span></div><div class="rows">
      <button class="row setting" data-action="export-xlsx">${icon('share')}<span class="grow">Export to Excel</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="export-csv">${icon('share')}<span class="grow">Export to CSV</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="export-backup">${icon('doc')}<span class="grow">Save full backup</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="import-backup">${icon('refresh')}<span class="grow">Restore from backup</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting danger" data-action="erase">${icon('trash')}<span class="grow">Erase all transactions</span></button></div>
      <p class="footer-note">Last export: ${lastExport}. Your data lives only in this browser on this phone — clearing ${onIOS ? "Safari's" : "your browser's"} website data deletes it, so save a backup to ${onIOS ? 'Files or iCloud Drive' : 'your Downloads folder or a cloud drive'} regularly.</p>
      <input type="file" id="file-json" accept=".json,application/json" class="hidden"></div>

    <div><div class="section-title"><span>About</span></div><div class="rows">
      ${counts.map((x) => `<div class="row setting"><span class="grow">${x.c.code} transactions</span><span class="value num">${x.n}</span></div>`).join('')}
      <div class="row setting"><span class="grow">All transactions</span><span class="value num">${store.transactions.length}</span></div>
      <div class="row setting"><span class="grow">Version</span><span class="value">3.6.1 (web)</span></div></div>
      <p class="footer-note">Everything is stored on this device only. Statements are read on this phone and never uploaded. The only request the app makes is for exchange rates, and only when a home currency is set.</p></div>
  </div></div>`;
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// ---------- Report (printable)
function reportActions(hash) {
  const standalone = window.navigator.standalone === true; // only an iPhone home-screen app cannot print; Android can
  const link = location.href.split('#')[0] + hash;
  return `<div class="report-actions"><button class="btn secondary" data-action="close-report">${icon('x')} Close</button>${standalone
    ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">${icon('share')} Open in Safari to save as PDF</a>`
    : `<button class="btn primary" data-action="print-report">${icon('share')} Share / Save as PDF</button>`}</div>`;
}

function renderReport(key) {
  const items = ledger();
  const ins = insightsFor(items, key);
  const s = ins.summary;
  const m = (v) => money(v);
  const catTable = (title, totals, total) => `<h3>${title}</h3><table>${totals.map((t) => `<tr><td style="width:40%">${esc(t.name)}</td><td><div class="rbar"><div style="width:${(t.share * 100).toFixed(1)}%"></div></div></td><td class="m" style="width:44px;text-align:right">${A.fmtPct(t.share)}</td><td class="r" style="width:100px">${m(t.total)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td></td><td class="r">${m(total)}</td></tr></table>`;
  const largest = items.filter((t) => A.inMonth(t, key) && t.type === 'Expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
  return `<div class="report-wrap">${reportActions('#report-' + A.keyStr(key))}
  <div class="report">
    <div class="eyebrow">Expense Tracker</div><h1>${esc(A.keyTitle(key))}</h1><div class="meta">Monthly report · ${esc(cur())} · generated ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
    <div class="totals"><div><div class="l">Income</div><div class="v gold">${m(s.income)}</div></div><div><div class="l">Expense</div><div class="v slate">${m(s.expense)}</div></div><div><div class="l">${s.balance >= 0 ? 'Left over' : 'Overspent'}</div><div class="v ${s.balance >= 0 ? 'gold' : 'red'}">${signed(s.balance)}</div></div><div><div class="l">Transactions</div><div class="v">${s.count}</div></div></div>
    <h3>Summary</h3><p>${esc(ins.sentences.join(' '))}</p>
    ${s.expenseByCategory.length ? catTable('Expenses by category', s.expenseByCategory, s.expense) : ''}
    ${s.incomeByCategory.length ? catTable('Income by category', s.incomeByCategory, s.income) : ''}
    ${ins.budgets.length ? `<h3>Budgets</h3><table>${ins.budgets.map((b) => `<tr><td style="width:40%">${esc(b.name)}</td><td class="m">${m(b.spent)} of ${m(b.limit)}</td><td class="r ${b.ratio > 1 ? 'red' : 'gold'}">${b.ratio > 1 ? 'Over by ' + m(-b.remaining) : 'Within budget'}</td></tr>`).join('')}</table>` : ''}
    <h3>Balance, last six months</h3><table>${ins.balanceTrend.map((p) => `<tr><td>${esc(A.keyTitle(p.key))}</td><td class="m">in ${m(p.income)} · out ${m(p.expense)}</td><td class="r ${p.balance >= 0 ? 'gold' : 'red'}">${signed(p.balance)}</td></tr>`).join('')}</table>
    <h3>Largest expenses</h3><table>${largest.map((t) => `<tr><td class="m" style="width:60px">${esc(A.fmtDay(t.date))}</td><td>${esc(t.desc || t.category)}</td><td class="m">${esc(t.category)}</td><td class="r">${m(t.amount)}</td></tr>`).join('')}</table>
    <p class="meta" style="margin-top:16px">Amounts are in ${esc(cur())}.${showAll() ? ' Other currencies were converted at the latest rates.' : ' Transactions in other currencies are not included.'}</p>
  </div></div>`;
}

function renderYear(year) {
  const items = ledger();
  const y = A.yearReview(items, year, categoriesForView());
  const m = (v) => money(v);
  const prev = y.previous;
  const delta = (a, b) => (b > 0 ? `${a >= b ? '+' : '−'}${A.fmtPct(Math.abs(a - b) / b)}` : '–');
  const chart = C.columns(y.months, { formatY: C.compact });
  return `<div class="report-wrap">${reportActions('#year-' + year)}
  <div class="report">
    <div class="eyebrow">Expense Tracker</div><h1>${year} in review</h1><div class="meta">${y.activeMonths} ${y.activeMonths === 1 ? 'month' : 'months'} with data · ${esc(cur())} · ${y.count} transactions</div>
    <div class="totals"><div><div class="l">Income</div><div class="v gold">${m(y.income)}</div></div><div><div class="l">Expense</div><div class="v slate">${m(y.expense)}</div></div><div><div class="l">${y.balance >= 0 ? 'Saved' : 'Overspent'}</div><div class="v ${y.balance >= 0 ? 'gold' : 'red'}">${signed(y.balance)}</div></div><div><div class="l">Savings rate</div><div class="v">${y.income > 0 ? A.fmtPct(y.savingsRate) : '–'}</div></div></div>
    <h3>Month by month</h3><div class="report-chart">${chart}</div>
    <table><tr><td>Average spent per month</td><td class="r">${m(y.averageExpense)}</td></tr>
      ${y.best ? `<tr><td>Best month</td><td class="r gold">${esc(A.keyTitle(y.best.key))} · ${signed(y.best.balance)}</td></tr>` : ''}
      ${y.worst && y.worst !== y.best ? `<tr><td>Toughest month</td><td class="r red">${esc(A.keyTitle(y.worst.key))} · ${signed(y.worst.balance)}</td></tr>` : ''}
      <tr><td>Months with money left over</td><td class="r">${y.positiveMonths} of ${y.activeMonths}</td></tr>
      ${y.largest ? `<tr><td>Largest expense</td><td class="r">${esc(y.largest.desc || y.largest.category)} · ${m(y.largest.amount)} (${esc(A.fmtDay(y.largest.date))})</td></tr>` : ''}</table>
    ${y.top.length ? `<h3>Where the money went</h3><table>${y.top.map((t) => `<tr><td style="width:40%">${esc(t.name)}</td><td><div class="rbar"><div style="width:${(t.share * 100).toFixed(1)}%"></div></div></td><td class="m" style="width:44px;text-align:right">${A.fmtPct(t.share)}</td><td class="r" style="width:100px">${m(t.total)}</td></tr>`).join('')}</table>` : ''}
    ${prev ? `<h3>Compared with ${year - 1}</h3><table><tr><td>Income</td><td class="m">${m(prev.income)} → ${m(y.income)}</td><td class="r">${delta(y.income, prev.income)}</td></tr><tr><td>Expense</td><td class="m">${m(prev.expense)} → ${m(y.expense)}</td><td class="r">${delta(y.expense, prev.expense)}</td></tr><tr><td>Saved</td><td class="m">${signed(prev.balance)} → ${signed(y.balance)}</td><td class="r"></td></tr></table>` : ''}
    <p class="meta" style="margin-top:16px">Amounts are in ${esc(cur())}.</p>
  </div></div>`;
}

// ---------- Sheets (forms)
let sheetState = null;

function openSheet(html, state = {}) {
  sheetState = state;
  $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheet-backdrop').classList.remove('hidden');
  $('#sheet').classList.remove('hidden');
  requestAnimationFrame(() => { $('#sheet-backdrop').classList.add('show'); $('#sheet').classList.add('show'); });
}
function closeSheet() {
  $('#sheet-backdrop').classList.remove('show'); $('#sheet').classList.remove('show');
  const wasOpen = !!sheetState;
  setTimeout(() => { $('#sheet-backdrop').classList.add('hidden'); $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; sheetState = null; }, 320);
  if (wasOpen) render(); // the screen underneath may have changed while the sheet was open
}
function paintSheet(html, st) {
  if ($('#sheet').classList.contains('hidden')) openSheet(html, st); else $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
}

// ---- transaction form
function txForm({ tx = null, prefill = null, defaultRepeat = '' } = {}) {
  const type = tx?.type || prefill?.type || 'Expense';
  const src = tx || prefill;
  const v = {
    type, amount: src ? (src.origAmount ?? src.amount).toFixed(2) : '', category: src?.category || '',
    date: tx?.date || (prefill?.keepDate ? prefill.date : todayISO()), time: tx?.time || (prefill?.keepDate ? prefill.time : '') || '', desc: src?.desc || '', currency: src ? (src.origCurrency || src.currency) : store.settings.currency, repeat: defaultRepeat,
    account: tx?.account || (prefill ? prefill.account : store.settings.lastAccount) || '', tags: (src?.tags || []).join(', '),
    splits: [], catTouched: !!src, auto: null,
    owe: !!prefill?.owe, owePerson: prefill?.owe?.person || '', oweAmount: prefill?.owe?.amount || '',
  };
  sheetState = { kind: 'tx', id: tx?.id || null, values: v, receipt: null, receiptChanged: false, hadReceipt: !!tx?.receipt, raw: tx?.raw || '' };
  renderTxForm();
  if (tx?.receipt) getReceipt(tx.id).then((blob) => { if (blob && sheetState && sheetState.id === tx.id) { sheetState.receipt = blob; paintReceipt(); } });
}

function renderTxForm() {
  const st = sheetState;
  const v = st.values;
  const editing = !!st.id;
  const names = store.categoryNames(v.type);
  if (!v.category || !names.includes(v.category)) { if (!v.category) v.category = names[0] || ''; }
  const catList = names.includes(v.category) || !v.category ? names : [...names, v.category];
  const suggestions = suggestionsFor(v);
  const accounts = store.accounts;
  const splitTotal = v.splits.reduce((a, s) => a + (num(s.amount) || 0), 0);
  const total = num(v.amount) || 0;
  const remaining = total - splitTotal;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit transaction' : 'New transaction'}</h2><button class="save" data-action="sheet-save" ${canSaveTx(v) ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="seg">${['Expense', 'Income'].map((t) => `<button class="${v.type === t ? 'on' : ''}" data-action="f-type" data-value="${t}">${t}</button>`).join('')}</div>
    <div class="field"><label>Amount</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0.00" value="${esc(v.amount)}" data-field="amount" ${editing ? '' : 'autofocus'}>
      <select data-field="currency" aria-label="Currency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.currency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div></div>
    <div class="field"><label>Description</label><div class="control"><input value="${esc(v.desc)}" data-field="desc" placeholder="What was it? e.g. Lidl, Rent, Uber" autocomplete="off"></div>
      ${suggestions.length ? `<div class="suggest">${suggestions.map((s) => `<button data-action="f-suggest" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>
    ${st.raw ? `<div class="field"><label>Your bank's wording</label><div class="rawbox">${esc(st.raw)}</div></div>` : ''}
    <div class="field"><label>Category</label><div class="control">${icon('tag')}<select data-field="category">${catList.length ? catList.map((n) => `<option value="${esc(n)}" ${n === v.category ? 'selected' : ''}>${esc(n)}</option>`).join('') : '<option value="">No categories — add one in Categories</option>'}</select>${icon('chevD')}</div>
      <div class="hint auto" id="auto-hint">${v.auto ? `${icon('sparkles', 'ic-sm')} Filled in from ${v.auto === 'keyword' ? 'the name' : 'your past entries'}` : ''}</div></div>
    ${!editing && v.type === 'Expense' ? (v.splits.length ? `<div class="field"><label>Split across categories</label>
      ${v.splits.map((s, i) => `<div class="control split"><select data-split="category" data-i="${i}">${names.map((n) => `<option value="${esc(n)}" ${n === s.category ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><input class="num" inputmode="decimal" placeholder="0.00" value="${esc(s.amount)}" data-split="amount" data-i="${i}" style="flex:0 0 96px;text-align:right"><button data-action="f-split-remove" data-i="${i}" aria-label="Remove part">${icon('x')}</button></div>`).join('')}
      <div class="hint ${Math.abs(remaining) > 0.004 ? 'warn' : ''}">${Math.abs(remaining) > 0.004 ? `${money(Math.abs(remaining), v.currency)} ${remaining > 0 ? 'still to assign' : 'too much'} — the parts must add up to the amount above` : 'Parts add up. The category above is ignored.'}</div>
      ${v.splits.length < 5 ? `<button class="link-btn" data-action="f-split-add">Add another part</button>` : ''}</div>`
      : `<button class="link-btn left" data-action="f-split-add">Split across categories</button>`) : ''}
    ${!editing && v.type === 'Expense' ? (v.owe ? `<div class="field"><label>Someone owes me for this</label><div class="control split">${icon('people')}<input value="${esc(v.owePerson)}" data-field="owePerson" placeholder="Who?" autocomplete="off"><input class="num" inputmode="decimal" placeholder="0.00" value="${esc(v.oweAmount)}" data-field="oweAmount" style="flex:0 0 96px;text-align:right"><button data-action="f-owe-remove" aria-label="Remove">${icon('x')}</button></div>${personChips(v.owePerson)}
      <div class="hint">${v.owePerson.trim() && num(v.oweAmount) > 0 ? `${esc(v.owePerson.trim().split(' ')[0])} will show under Who owes me, for ${money(num(v.oweAmount), v.currency)}.` : 'Enter the name and how much they owe you.'}</div></div>`
      : `<button class="link-btn left" data-action="f-owe-add">Someone owes me for this</button>`) : ''}
    <div class="field"><label>Date</label><div class="control">${icon('calendar')}<input type="date" value="${v.date}" data-field="date"><input type="time" value="${esc(v.time)}" data-field="time" aria-label="Time (optional)" style="flex:0 0 auto"></div></div>
    ${accounts.length ? `<div class="field"><label>Account</label><div class="control">${icon('card')}<select data-field="account"><option value="" ${!v.account ? 'selected' : ''}>No account</option>${accounts.map((a) => `<option value="${a.id}" ${a.id === v.account ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('')}</select>${icon('chevD')}</div></div>` : ''}
    <div class="field"><label>Tags (optional)</label><div class="control"><input value="${esc(v.tags)}" data-field="tags" placeholder="e.g. trip to Goa, work" autocomplete="off"></div></div>
    <div class="field"><label>Receipt (optional)</label><div id="receipt-box">${receiptHTML()}</div><input type="file" id="file-receipt" accept="image/*" class="hidden"></div>
    ${editing ? '' : `<div class="field"><label>Repeat</label><div class="control">${icon('refresh')}<select data-field="repeat"><option value="" ${!v.repeat ? 'selected' : ''}>Never</option><option value="Weekly" ${v.repeat === 'Weekly' ? 'selected' : ''}>Weekly</option><option value="Monthly" ${v.repeat === 'Monthly' ? 'selected' : ''}>Monthly</option></select>${icon('chevD')}</div>
      <div class="hint">${v.repeat ? `Recorded on the chosen date, then added automatically every ${v.repeat === 'Weekly' ? 'week' : 'month'}. Manage it under Settings.` : 'Choose Weekly or Monthly for things like rent, salary or subscriptions.'}</div></div>`}
    ${editing ? `<button class="btn secondary block" data-action="f-repeat-today">${icon('refresh')} Add again for today</button><button class="btn danger block" data-action="f-delete">Delete transaction</button>` : ''}
  </div>`;
  paintSheet(html, st);
}

function receiptHTML() {
  const st = sheetState;
  if (st.receipt) return `<div class="thumb-row"><img class="thumb" alt="Receipt" data-action="view-receipt"><button class="pill-btn" data-action="f-receipt-remove" style="color:var(--bad)">Remove</button></div>`;
  if (st.hadReceipt && !st.receiptChanged) return `<div class="hint">Loading photo…</div>`;
  return `<button class="btn secondary block" data-action="f-receipt-add">${icon('camera')} Add receipt photo</button>`;
}
function paintReceipt() {
  const box = $('#receipt-box'); if (!box) return;
  box.innerHTML = receiptHTML();
  const img = box.querySelector('img.thumb');
  if (img && sheetState.receipt) img.src = URL.createObjectURL(sheetState.receipt);
}

function canSaveTx(v) {
  const a = num(v.amount);
  if (!(a > 0) || !v.category || !v.date) return false;
  if (v.owe && !(v.owePerson.trim() && num(v.oweAmount) > 0)) return false;
  if (v.splits.length) {
    const sum = v.splits.reduce((x, s) => x + (num(s.amount) || 0), 0);
    if (Math.abs(sum - a) > 0.004 || v.splits.some((s) => !(num(s.amount) > 0) || !s.category)) return false;
  }
  return true;
}

function suggestionsFor(v) {
  if (!v.category) return [];
  const counts = new Map();
  for (const t of store.transactions) if (t.category === v.category && t.type === v.type && t.desc) counts.set(t.desc, (counts.get(t.desc) || 0) + 1);
  const typed = (v.desc || '').trim().toLowerCase();
  return [...counts.entries()].filter(([d]) => d.toLowerCase() !== typed && (!typed || d.toLowerCase().includes(typed)))
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1])).slice(0, 6).map(([d]) => d);
}

let catIndex = null;
const categoryIndex = () => catIndex || (catIndex = buildIndex(store.transactions));

// As the description is typed, fill in the category (and the usual amount) unless the person chose one already.
function autoFill(v) {
  if (v.catTouched) return;
  const s = suggest(v.desc, categoryIndex(), store.categories, { type: v.type });
  const sel = $('#sheet select[data-field="category"]');
  const hint = $('#auto-hint');
  if (!s || !store.categoryNames(v.type).includes(s.category)) { if (v.auto) { v.auto = null; if (hint) hint.innerHTML = ''; } return; }
  v.category = s.category; v.auto = s.source;
  if (sel) sel.value = s.category;
  if (hint) hint.innerHTML = `${icon('sparkles', 'ic-sm')} Filled in from ${s.source === 'keyword' ? 'the name' : 'your past entries'}`;
  const amt = $('#sheet input[data-field="amount"]');
  if (s.amount && !num(v.amount) && amt) { v.amount = s.amount.toFixed(2); amt.value = v.amount; }
  const save = $('#sheet .save'); if (save) save.disabled = !canSaveTx(v);
}

async function saveTx() {
  const st = sheetState; const v = st.values;
  const amount = num(v.amount);
  if (!canSaveTx(v)) return;
  const tags = v.tags.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean);
  const base = { type: v.type, category: v.category, date: v.date, desc: (v.desc || '').trim(), currency: v.currency, time: v.time || undefined, account: v.account || undefined, tags: tags.length ? tags : undefined };
  let saved;
  if (st.id) {
    const changes = { ...base, amount };
    if (st.receiptChanged) changes.receipt = !!st.receipt;
    store.updateTransaction(st.id, changes);
    saved = store.transactions.find((t) => t.id === st.id);
    if (st.receiptChanged) { if (st.receipt) await putReceipt(st.id, st.receipt); else await deleteReceipt(st.id); }
  } else if (v.splits.length) {
    const group = uid();
    for (const s of v.splits) saved = store.addTransaction({ ...base, category: s.category, amount: num(s.amount), group });
    if (st.receipt) { store.updateTransaction(saved.id, { receipt: true }); await putReceipt(saved.id, st.receipt); }
  } else {
    saved = store.addTransaction({ ...base, amount, receipt: st.receipt ? true : undefined });
    if (st.receipt) await putReceipt(saved.id, st.receipt);
    if (v.repeat) store.addRule({ type: v.type, category: v.category, amount, desc: base.desc, currency: v.currency, frequency: v.repeat, startDate: v.date });
  }
  if (!st.id && v.owe && v.owePerson.trim() && num(v.oweAmount) > 0 && saved) store.addOwed({ person: v.owePerson.trim(), amount: num(v.oweAmount), currency: v.currency, date: v.date, note: base.desc, txId: saved.id });
  if (v.account) store.state.settings.lastAccount = v.account;
  catIndex = null;
  const warning = budgetWarning({ ...base, amount });
  closeSheet();
  toast(warning || (st.id ? 'Saved' : 'Added ' + money(amount, v.currency)));
}

function budgetWarning(data) {
  if (data.type !== 'Expense') return null;
  const cat = store.categories.find((c) => c.type === 'Expense' && c.name === data.category && c.budget > 0 && c.budgetCurrency === data.currency);
  if (!cat) return null;
  const key = A.keyOf(data.date);
  const items = store.transactions.filter((t) => t.currency === data.currency);
  const prevSpent = store.settings.budgetRollover ? new Map(A.summary(items, A.prevKey(key)).expenseByCategory.map((e) => [e.name, e.total])) : null;
  const b = A.budgets([cat], A.summary(items, key).expenseByCategory, data.currency, prevSpent && prevSpent.size ? prevSpent : null)[0];
  if (!b) return null;
  if (b.ratio >= 1) return `${data.category} is over budget by ${money(-b.remaining, data.currency)}`;
  if (b.ratio >= 0.8) return `${data.category}: ${A.fmtPct(b.ratio)} of this month's budget used`;
  return null;
}

// ---- category form
function categoryForm(cat = null) {
  const v = { name: cat?.name || '', type: cat?.type || 'Expense', budget: cat && cat.budget > 0 ? cat.budget.toFixed(2) : '', budgetCurrency: cat && cat.budget > 0 && cat.budgetCurrency ? cat.budgetCurrency : store.settings.currency };
  sheetState = { kind: 'cat', id: cat?.id || null, values: v };
  renderCategoryForm();
}
function renderCategoryForm() {
  const st = sheetState, v = st.values, editing = !!st.id;
  const dup = store.categories.some((c) => c.id !== st.id && c.type === v.type && c.name.toLowerCase() === v.name.trim().toLowerCase());
  const used = editing ? store.transactions.filter((t) => t.type === v.type && t.category === store.categories.find((c) => c.id === st.id)?.name).length : 0;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit category' : 'New category'}</h2><button class="save" data-action="sheet-save" ${v.name.trim() && !dup ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>Name</label><div class="control"><input value="${esc(v.name)}" data-field="name" placeholder="Category name" ${editing ? '' : 'autofocus'}></div>${dup ? '<div class="hint warn">A category with this name already exists.</div>' : ''}</div>
    ${editing ? `<div class="field"><label>Type</label><div class="control"><span style="padding:12px 0">${v.type}</span></div><div class="hint">Renaming also updates the transactions that use this category.</div></div>`
      : `<div class="seg">${['Expense', 'Income'].map((t) => `<button class="${v.type === t ? 'on' : ''}" data-action="f-ctype" data-value="${t}">${t}</button>`).join('')}</div>`}
    ${v.type === 'Expense' ? `<div class="field"><label>Monthly budget</label><div class="control"><input class="num" inputmode="decimal" placeholder="No budget" value="${esc(v.budget)}" data-field="budget"><select data-field="budgetCurrency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.budgetCurrency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div>
      <div class="hint">The dashboard shows how much of this limit is used each month; silver at 80%, red when exceeded. Leave empty for no budget.</div></div>` : ''}
    ${editing ? `<button class="btn danger block" data-action="f-delete-category">Delete category${used ? ` (${used} transactions keep the name)` : ''}</button>` : ''}
  </div>`;
  paintSheet(html, st);
}
function saveCategory() {
  const st = sheetState, v = st.values;
  const name = v.name.trim(); if (!name) return;
  const budget = v.type === 'Expense' ? (num(v.budget) || 0) : 0;
  if (st.id) store.updateCategory(st.id, { name, budget, budgetCurrency: v.budgetCurrency });
  else store.addCategory({ name, type: v.type, budget, budgetCurrency: v.budgetCurrency });
  closeSheet(); toast('Saved');
}

// ---- account form
function accountForm(acc = null) {
  const v = { name: acc?.name || '', opening: acc ? String(acc.opening || 0) : '', currency: acc?.currency || store.settings.currency };
  sheetState = { kind: 'acc', id: acc?.id || null, values: v };
  renderAccountForm();
}
function renderAccountForm() {
  const st = sheetState, v = st.values, editing = !!st.id;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit account' : 'New account'}</h2><button class="save" data-action="sheet-save" ${v.name.trim() ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>Name</label><div class="control"><input value="${esc(v.name)}" data-field="name" placeholder="e.g. Cash, Bank, Credit card" ${editing ? '' : 'autofocus'}></div></div>
    <div class="field"><label>Starting balance</label><div class="control"><input class="num" inputmode="decimal" placeholder="0.00" value="${esc(v.opening)}" data-field="opening"><select data-field="currency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.currency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div>
      <div class="hint">What the account held before you started recording here. The balance then follows your transactions and transfers.</div></div>
    ${editing ? `<button class="btn danger block" data-action="f-delete-account">Delete account</button>` : ''}
  </div>`;
  paintSheet(html, st);
}
function saveAccount() {
  const st = sheetState, v = st.values;
  const name = v.name.trim(); if (!name) return;
  const data = { name, opening: num(v.opening) || 0, currency: v.currency };
  if (st.id) store.updateAccount(st.id, data); else store.addAccount(data);
  closeSheet(); toast('Saved');
}

// ---- transfer form
function transferForm() {
  const a = store.accounts;
  const v = { from: a[0]?.id || '', to: a[1]?.id || '', amount: '', date: todayISO(), note: '' };
  sheetState = { kind: 'transfer', id: null, values: v };
  renderTransferForm();
}
function renderTransferForm() {
  const st = sheetState, v = st.values;
  const from = store.accounts.find((a) => a.id === v.from);
  const opts = (sel) => store.accounts.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} (${a.currency})</option>`).join('');
  const ok = v.from && v.to && v.from !== v.to && num(v.amount) > 0;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>Transfer</h2><button class="save" data-action="sheet-save" ${ok ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>From</label><div class="control">${icon('card')}<select data-field="from">${opts(v.from)}</select>${icon('chevD')}</div></div>
    <div class="field"><label>To</label><div class="control">${icon('card')}<select data-field="to">${opts(v.to)}</select>${icon('chevD')}</div>${v.from && v.from === v.to ? '<div class="hint warn">Choose two different accounts.</div>' : ''}</div>
    <div class="field"><label>Amount${from ? ` (${from.currency})` : ''}</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0.00" value="${esc(v.amount)}" data-field="amount" autofocus></div></div>
    <div class="field"><label>Date</label><div class="control">${icon('calendar')}<input type="date" value="${v.date}" data-field="date"></div></div>
    <div class="field"><label>Note (optional)</label><div class="control"><input value="${esc(v.note)}" data-field="note" placeholder="e.g. ATM withdrawal"></div></div>
  </div>`;
  paintSheet(html, st);
}
function saveTransfer() {
  const v = sheetState.values;
  const from = store.accounts.find((a) => a.id === v.from);
  if (!from || !v.to || v.from === v.to || !(num(v.amount) > 0)) return;
  store.addTransfer({ date: v.date, from: v.from, to: v.to, amount: num(v.amount), currency: from.currency, note: v.note.trim() });
  closeSheet(); toast('Transfer saved');
}

// ---- goal form
function goalForm(goal = null) {
  const k = A.currentKey();
  const v = { name: goal?.name || '', target: goal ? String(goal.target) : '', currency: goal?.currency || store.settings.currency, deadline: goal?.deadline || '', startDate: goal?.startDate || `${A.keyStr(k)}-01`,
    opening: goal?.opening ? String(goal.opening) : '', income: (goal?.income || []).map((x) => ({ ...x })), incName: '', incAmount: '', incDate: todayISO(), incRepeat: 'Once' };
  sheetState = { kind: 'goal', id: goal?.id || null, values: v };
  renderGoalForm();
}
// The plan under the goal form: what to save and earn each month, and whether your income is enough. It updates as you type.
const GOAL_PLAN_FIELDS = new Set(['target', 'currency', 'startDate', 'deadline', 'opening']);
const monthsText = (m) => { const x = Math.round(m * 10) / 10; return `${x} ${x === 1 ? 'month' : 'months'}`; };
function goalDraft(v) { return { target: num(v.target), currency: v.currency, startDate: v.startDate, deadline: v.deadline || null, opening: num(v.opening) || 0, income: v.income }; }
function goalPlanHTML(v) {
  if (!(num(v.target) > 0) || !v.startDate) return `<p class="plan-empty">Fill in the target above. Your plan is worked out for you and shows up here.</p>`;
  const p = A.goalPlan(goalDraft(v), store.transactions, new Date());
  const m = (x) => money(x, v.currency);
  const row = (label, value, note = '') => `<div class="plan-row"><span>${label}</span><span class="num">${value}</span></div>${note ? `<div class="plan-note">${note}</div>` : ''}`;
  const verdict = (text, kind = '') => `<div class="plan-verdict ${kind}">${text}</div>`;
  if (p.remaining === 0) return verdict('Goal reached. What you have already saved covers it.', 'good');
  const rows = [row('Still to save', m(p.remaining))];
  if (p.hasDeadline && v.deadline < todayISO()) return rows.join('') + verdict('That deadline has passed. Pick a later date.', 'warn');
  if (p.hasDeadline) {
    rows.push(row('Time left', monthsText(p.monthsLeft)), row('Save each month', m(p.needSave)));
    if (p.hasHistory) rows.push(row('Earn each month', m(p.needEarn), `${m(p.needSave)} to save, plus about ${m(p.usualExpense)} you usually spend`));
  }
  if (p.hasHistory) {
    const src = p.sources.length > 1 ? p.sources.map((x) => `${esc(x.name)} ${m(x.perMonth)}`).join(' · ') : '';
    rows.push(row('You earn now', m(p.usualIncome), src), row('You spend now', m(p.usualExpense)));
  }
  if (p.hasDeadline && p.expectedCount) rows.push(row('Expected extra income', m(p.expectedInPeriod), `About ${m(p.expectedPerMonth)} a month on average`));
  let msg = '', kind = '';
  const known = p.hasHistory || p.expectedInPeriod > 0;
  if (p.hasDeadline) {
    if (!known) msg = 'Add a few months of entries and I will show whether your income is enough.';
    else if (p.enough) { msg = `Your income is enough. You would save about ${m(Math.max(p.projectedSave, 0))} a month and need ${m(p.needSave)}.`; kind = 'good'; }
    else {
      msg = `Short by ${m(p.gap)} a month${p.expectedInPeriod > 0 ? ', even with your expected income' : ''}. To close the gap, earn that much more each month or spend that much less.`;
      msg += p.finishISO ? ` At your current pace you reach it around ${A.fmtMonthYear(p.finishISO)}.` : ' At your current pace you would not reach it.';
      kind = 'warn';
    }
  } else if (p.finishISO) { msg = `At your usual pace you reach it around ${A.fmtMonthYear(p.finishISO)} (about ${monthsText(p.finishMonths)}).`; kind = 'good'; }
  else if (p.hasHistory) { msg = 'You are not saving each month yet, so there is no finish date. Add a deadline to see what you would need to save and earn.'; kind = 'warn'; }
  else msg = 'Add a few months of entries to see when you would reach it, or add a deadline.';
  return rows.join('') + verdict(msg, kind);
}
// A plan that cannot be worked out says so, instead of leaving old text on screen (for example when one app file on the site is an old copy).
function goalPlanSafe(v) {
  try { return goalPlanHTML(v); }
  catch (err) { console.error(err); return `<p class="plan-empty">The plan could not be worked out. Close the app completely and open it again. If this stays, one of the app files on the website is out of date.</p>`; }
}
function refreshGoalPlan() { const el = $('#goal-plan'); if (el && sheetState?.kind === 'goal') el.innerHTML = goalPlanSafe(sheetState.values); }
function goalIncomeHTML(v) {
  if (!v.income.length) return '';
  return v.income.map((x, i) => `<div class="inc-row"><div class="grow"><b>${esc(x.name)}</b><span class="muted"> · ${money(x.amount, v.currency)} · ${esc(A.fmtDay(x.date))} ${esc(x.date.slice(0, 4))} · ${x.repeat === 'Monthly' ? 'every month' : 'once'}</span></div><button class="inc-del" data-action="goal-inc-del" data-i="${i}" aria-label="Remove ${esc(x.name)}">${icon('x')}</button></div>`).join('');
}
// Adds what was typed in the "expected income" boxes as a line; returns false when there is nothing valid to add.
function addGoalIncome() {
  const v = sheetState?.values; if (!v) return false;
  const amount = num(v.incAmount);
  if (!(amount > 0) || !v.incDate || v.income.length >= 20) return false;
  v.income.push({ name: (v.incName || '').trim().slice(0, 60) || 'Expected income', amount, date: v.incDate, repeat: v.incRepeat === 'Monthly' ? 'Monthly' : 'Once' });
  v.incName = ''; v.incAmount = '';
  const list = $('#inc-list'); if (list) list.innerHTML = goalIncomeHTML(v);
  for (const f of ['incName', 'incAmount']) { const i = $(`#sheet [data-field="${f}"]`); if (i) i.value = ''; }
  refreshGoalPlan();
  return true;
}
function renderGoalForm() {
  const st = sheetState, v = st.values, editing = !!st.id;
  const ok = v.name.trim() && num(v.target) > 0 && v.startDate;
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit goal' : 'New savings goal'}</h2><button class="save" data-action="sheet-save" ${ok ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="field"><label>Name</label><div class="control"><input value="${esc(v.name)}" data-field="name" placeholder="e.g. Emergency fund, Trip to Japan" ${editing ? '' : 'autofocus'}></div></div>
    <div class="field"><label>Target</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0" value="${esc(v.target)}" data-field="target"><select data-field="currency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.currency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div></div>
    <div class="field"><label>Already saved (optional)</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0" value="${esc(v.opening)}" data-field="opening"></div><div class="hint">Money you already have for this goal, outside what this app has recorded.</div></div>
    <div class="field"><label>Counting from</label><div class="control">${icon('calendar')}<input type="date" value="${v.startDate}" data-field="startDate"></div><div class="hint">Everything you keep (income minus expenses) from this date counts towards the goal.</div></div>
    <div class="field"><label>Deadline (optional)</label><div class="control">${icon('flag')}<input type="date" value="${v.deadline}" data-field="deadline"></div>
      <div class="suggest periods" role="group" aria-label="Pick a period from today">${[3, 4, 6, 12].map((n) => `<button data-action="goal-period" data-months="${n}">${n} months</button>`).join('')}</div>
      <div class="hint">Pick a date, or a period counted from today.</div></div>
    <div class="field"><label>Your plan</label><div class="plan" id="goal-plan" role="status" aria-live="polite">${goalPlanSafe(v)}</div><div class="hint">Worked out for you from the boxes above. There is nothing to type here.</div></div>
    <div class="field"><label>Extra income you expect (optional)</label>
      <div id="inc-list">${goalIncomeHTML(v)}</div>
      <div class="inc-add">
        <div class="control"><input value="${esc(v.incName)}" data-field="incName" maxlength="60" placeholder="What is it? e.g. Bonus, new client"></div>
        <div class="inc-two"><div class="control"><input class="num" inputmode="decimal" placeholder="Amount" value="${esc(v.incAmount)}" data-field="incAmount"></div>
          <div class="control"><input type="date" value="${v.incDate}" data-field="incDate"></div></div>
        <div class="inc-two"><div class="control"><select data-field="incRepeat"><option value="Once" ${v.incRepeat === 'Once' ? 'selected' : ''}>Once</option><option value="Monthly" ${v.incRepeat === 'Monthly' ? 'selected' : ''}>Every month</option></select></div>
          <button class="btn secondary" data-action="goal-inc-add">${icon('plus')} Add</button></div>
      </div>
      <div class="hint">Your usual income is read from your last 3 months. Add only extra money you expect, like a bonus, a new client or a raise. It only feeds this plan and never changes your balance.</div></div>
    ${editing ? `<button class="btn danger block" data-action="f-delete-goal">Delete goal</button>` : ''}
  </div>`;
  paintSheet(html, st);
}
function saveGoal() {
  const st = sheetState, v = st.values;
  if (!(v.name.trim() && num(v.target) > 0 && v.startDate)) return;
  addGoalIncome(); // money typed in the boxes but not added with "Add" still counts
  const data = { name: v.name.trim(), target: num(v.target), currency: v.currency, deadline: v.deadline || null, startDate: v.startDate, opening: num(v.opening) > 0 ? num(v.opening) : 0, income: v.income };
  if (st.id) store.updateGoal(st.id, data); else store.addGoal(data);
  closeSheet(); toast('Saved');
}

// ---------- PIN lock
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('et-pin:' + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let pinEntry = '';
let pinMode = null; // 'unlock' | 'set' | 'confirm' | 'disable'

function showLock(mode, title) {
  pinMode = mode; pinEntry = '';
  const el = $('#lock');
  el.classList.remove('hidden');
  el.innerHTML = `${icon('lock')}<h2>${esc(title)}</h2><div class="dots" id="pin-dots"></div><div class="err" id="pin-err"></div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-action="pin" data-value="${n}">${n}</button>`).join('')}<button class="soft" data-action="pin-cancel">${mode === 'unlock' ? '' : 'Cancel'}</button><button data-action="pin" data-value="0">0</button><button class="soft" data-action="pin-back">${icon('x')}</button></div>`;
  renderDots();
}
function hideLock() { $('#lock').classList.add('hidden'); $('#lock').innerHTML = ''; pinMode = null; ui.locked = false; }
function renderDots() { $('#pin-dots').innerHTML = Array.from({ length: Math.max(4, pinEntry.length) }, (_, i) => `<span class="${i < pinEntry.length ? 'on' : ''}"></span>`).join(''); }
async function pinPress(d) {
  if (pinEntry.length >= 6) return;
  pinEntry += d; renderDots();
  if (pinEntry.length < 4) return;
  if (pinMode === 'unlock' || pinMode === 'disable') {
    const want = store.settings.pinLen || 0; // PINs set before v3 have no stored length
    if (want && pinEntry.length < want) return;
    const h = await sha(pinEntry);
    if (h === store.settings.pinHash) {
      if (pinMode === 'disable') { store.setSetting('pinHash', null); toast('PIN removed'); }
      hideLock(); render();
    } else if (pinEntry.length === (want || 6)) {
      $('#pin-err').textContent = 'Wrong PIN, try again'; pinEntry = ''; renderDots();
    }
  }
}

// ---------- receipt viewer
function viewReceipt(blob) {
  const v = document.createElement('div');
  v.className = 'viewer';
  const url = URL.createObjectURL(blob);
  v.innerHTML = `<img src="${url}" alt="Receipt"><button class="pill-btn" aria-label="Close">${icon('x')}</button>`;
  v.addEventListener('click', () => { v.remove(); URL.revokeObjectURL(url); });
  document.body.appendChild(v);
}

// ---------- events
document.addEventListener('click', async (e) => {
  const cell = e.target.closest('.hm-cell');
  if (cell) { const d = String(cell.dataset.day).padStart(2, '0'); ui.tx = { search: '', type: 'All', category: '', day: `${A.keyStr(ui.insightsMonth)}-${d}` }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (OPENERS.has(a)) hideToast();
  if (a === 'go') { ui.tab = btn.dataset.tab; render(); window.scrollTo(0, 0); }
  else if (a === 'step') {
    const delta = +btn.dataset.delta;
    const scope = btn.dataset.scope;
    const k = scope === 'ins' ? ui.insightsMonth : ui.month;
    const n = delta > 0 ? A.nextKey(k) : A.prevKey(k);
    if (scope === 'ins') ui.insightsMonth = n; else ui.month = n;
    ui.slide = delta > 0 ? 'slide-left' : 'slide-right';
    render(); setTimeout(() => { ui.slide = ''; }, 400);
  }
  else if (a === 'add') txForm();
  else if (a === 'quick-add') { const t = store.transactions.find((x) => x.id === btn.dataset.id); if (t) txForm({ prefill: t }); }
  else if (a === 'edit') { const t = store.transactions.find((x) => x.id === btn.dataset.id); if (t) txForm({ tx: t }); }
  else if (a === 'show-category') { ui.tx = { search: '', type: 'All', category: btn.dataset.category, day: '' }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); }
  else if (a === 'show-income-all') { ui.tx = { search: '', type: 'Income', category: '', day: '' }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); }
  else if (a === 'show-category-all') { ui.tx = { search: '', type: 'Expense', category: '', day: '' }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); }
  else if (a === 'tx-type') { ui.tx.type = btn.dataset.value; render(); }
  else if (a === 'tx-clear-category') { ui.tx.category = ''; render(); }
  else if (a === 'tx-clear-day') { ui.tx.day = ''; render(); }
  else if (a === 'add-category') categoryForm();
  else if (a === 'edit-category') { const c = store.categories.find((x) => x.id === btn.dataset.id); if (c) categoryForm(c); }
  else if (a === 'add-account') accountForm();
  else if (a === 'edit-account') { const c = store.accounts.find((x) => x.id === btn.dataset.id); if (c) accountForm(c); }
  else if (a === 'add-transfer') transferForm();
  else if (a === 'view-transfer') { const t = store.transfers.find((x) => x.id === btn.dataset.id); if (t && await ask('Both account balances go back to what they were.', { title: 'Delete this transfer?' })) { store.deleteTransfer(t.id); toast('Transfer deleted'); } }
  else if (a === 'add-owed') owedForm();
  else if (a === 'edit-owed') { const d = store.owed.find((x) => x.id === btn.dataset.id); if (d) owedForm(d); }
  else if (a === 'repay-open') repayForm(btn.dataset.key);
  else if (a === 'remind') await remind(btn.dataset.key);
  else if (a === 'owed-accept') {
    const t = store.transactions.find((x) => x.id === btn.dataset.tx);
    const g = groupPeople(store.owed).find((x) => x.key === btn.dataset.key);
    if (t && g) { const r = recordRepayment(g.name, t.amount, t.currency, t.date, { txId: t.id }); if (r) toast(`${g.name.split(' ')[0]} paid back ${money(r.got, t.currency)}`, { label: 'Undo', fn: () => { store.undoRepay(r.before); toast('Undone'); } }); }
  }
  else if (a === 'owed-ignore') { store.setSetting('owedIgnore', [...(store.settings.owedIgnore || []), btn.dataset.tx]); }
  else if (a === 'f-person') { const v = sheetState.values; if (sheetState.kind === 'owed') { v.person = btn.dataset.value; renderOwedForm(); } else if (sheetState.kind === 'tx') { v.owePerson = btn.dataset.value; renderTxForm(); } }
  else if (a === 'f-owe-add') { const v = sheetState.values; v.owe = true; if (!v.oweAmount) v.oweAmount = v.amount; renderTxForm(); }
  else if (a === 'f-owe-remove') { const v = sheetState.values; v.owe = false; v.owePerson = ''; v.oweAmount = ''; renderTxForm(); }
  else if (a === 'f-delete-owed') { if (await ask('This removes the line from Who owes me. It does not change your transactions.', { title: 'Delete this?' })) { const d = store.deleteOwed(sheetState.id); closeSheet(); toast('Deleted', { label: 'Undo', fn: () => { store.restoreOwed(d); toast('Restored'); } }); } }
  else if (a === 'add-goal') goalForm();
  else if (a === 'goal-period' && sheetState?.kind === 'goal') { const d = stepDate(todayISO(), 'Monthly', +btn.dataset.months); sheetState.values.deadline = d; const i = $('#sheet [data-field="deadline"]'); if (i) i.value = d; refreshGoalPlan(); }
  else if (a === 'goal-inc-add' && sheetState?.kind === 'goal') { if (!addGoalIncome()) toast('Enter an amount and a date first'); }
  else if (a === 'goal-inc-del' && sheetState?.kind === 'goal') { sheetState.values.income.splice(+btn.dataset.i, 1); const list = $('#inc-list'); if (list) list.innerHTML = goalIncomeHTML(sheetState.values); refreshGoalPlan(); }
  else if (a === 'edit-goal') { const g = store.goals.find((x) => x.id === btn.dataset.id); if (g) goalForm(g); }
  else if (a === 'sheet-cancel') closeSheet();
  else if (a === 'sheet-save') {
    const st = sheetState;
    if (!st || st.saving) return; // a second tap must not save twice
    st.saving = true;
    const k = st.kind;
    if (k === 'tx') await saveTx(); else if (k === 'cat') saveCategory(); else if (k === 'acc') saveAccount(); else if (k === 'transfer') saveTransfer(); else if (k === 'goal') saveGoal(); else if (k === 'owed') saveOwed(); else if (k === 'repay') saveRepay();
    if ($('#sheet').classList.contains('show')) st.saving = false; // nothing was saved, the sheet is still open
  }
  else if (a === 'f-type') { const v = sheetState.values; if (v.type !== btn.dataset.value) { v.type = btn.dataset.value; v.category = store.categoryNames(v.type)[0] || ''; v.splits = []; v.auto = null; v.catTouched = false; } renderTxForm(); autoFill(sheetState.values); }
  else if (a === 'f-ctype') { sheetState.values.type = btn.dataset.value; renderCategoryForm(); }
  else if (a === 'f-suggest') { sheetState.values.desc = btn.dataset.value; renderTxForm(); autoFill(sheetState.values); }
  else if (a === 'f-split-add') { const v = sheetState.values; if (!v.splits.length) v.splits.push({ category: v.category, amount: v.amount }); v.splits.push({ category: store.categoryNames(v.type)[0] || '', amount: '' }); renderTxForm(); }
  else if (a === 'f-split-remove') { const v = sheetState.values; v.splits.splice(+btn.dataset.i, 1); if (v.splits.length === 1) v.splits = []; renderTxForm(); }
  else if (a === 'f-receipt-add') $('#file-receipt').click();
  else if (a === 'f-receipt-remove') { sheetState.receipt = null; sheetState.receiptChanged = true; paintReceipt(); }
  else if (a === 'view-receipt') { if (sheetState?.receipt) viewReceipt(sheetState.receipt); }
  else if (a === 'f-delete') {
    if (await ask('Delete this transaction?')) {
      const id = sheetState.id;
      const item = store.deleteTransaction(id);
      closeSheet();
      toast('Deleted', { label: 'Undo', fn: () => { store.restoreTransaction(item); toast('Restored'); } });
      if (item?.receipt) setTimeout(() => { if (!store.transactions.some((t) => t.id === id)) deleteReceipt(id); }, 7000);
    }
  }
  else if (a === 'toast-action') { const fn = toast.fn; toast.fn = null; $('#toast').classList.remove('show'); if (fn) fn(); }
  else if (a === 'f-repeat-today') { const t = store.transactions.find((x) => x.id === sheetState.id); if (t) { store.addTransaction({ type: t.type, category: t.category, amount: t.amount, desc: t.desc, currency: t.currency, date: todayISO(), account: t.account, tags: t.tags }); closeSheet(); toast('Added again for today'); } }
  else if (a === 'f-delete-category') { const c = store.categories.find((x) => x.id === sheetState.id); if (c && await ask(`Transactions already filed under "${c.name}" keep the name. You just won't be able to pick it for new ones.`, { title: 'Delete this category?' })) { store.deleteCategory(c.id); closeSheet(); toast('Deleted'); } }
  else if (a === 'f-delete-account') { const c = store.accounts.find((x) => x.id === sheetState.id); if (c && await ask('Transactions keep their details; they just stop pointing at this account. Transfers to or from it are removed.', { title: `Delete ${c.name}?` })) { store.deleteAccount(c.id); closeSheet(); toast('Deleted'); } }
  else if (a === 'f-delete-goal') { if (await ask('Delete this goal?')) { store.deleteGoal(sheetState.id); closeSheet(); toast('Deleted'); } }
  else if (a === 'toggle-rule') { const r = store.rules.find((x) => x.id === btn.dataset.id); if (r) { if (r.active) store.updateRule(r.id, { active: false }); else store.updateRule(r.id, { active: true, startDate: todayISO(), occurrences: 0 }); } }
  else if (a === 'delete-rule') { if (await ask('Transactions already added are kept.', { title: 'Delete this recurring rule?' })) store.deleteRule(btn.dataset.id); }
  else if (a === 'make-rule') {
    const d = btn.dataset;
    // start one period after the last payment so nothing is recorded twice
    store.addRule({ type: 'Expense', category: d.category, amount: +d.amount, desc: d.desc, currency: d.currency, frequency: d.frequency, startDate: d.last });
    toast(`${d.desc} will be added ${d.frequency.toLowerCase()}`);
  }
  else if (a === 'export-csv') { if (await confirmPlain('spreadsheet')) download(`ExpenseTracker-${todayISO()}.csv`, exportCSV(store.transactions), 'text/csv'); }
  else if (a === 'export-xlsx') { if (await confirmPlain('Excel file')) download(`ExpenseTracker-${todayISO()}.xlsx`, buildExcel()); }
  else if (a === 'export-backup') await saveBackup();
  else if (a === 'save-damaged') {
    const raw = store.damagedCopy();
    if (!raw) { await notify('There is no damaged copy to save.', 'Saved data'); return; }
    download(`ExpenseTracker-damaged-copy-${todayISO()}.json`, raw, 'application/json');
    if (!store.blocked) store.markDamagedSaved();
    render();
  }
  else if (a === 'dismiss-damaged') { ui.hideRecovery = true; render(); }
  else if (a === 'start-fresh') {
    if (await ask('The app will start empty. The damaged data is replaced. Only do this after you saved a copy.', { title: 'Start fresh?', confirmText: 'Start fresh' })) { store.startFresh(); store.clearDamaged(); catIndex = null; render(); }
  }
  else if (a === 'import-open') openImport();
  else if (a === 'undo-import') {
    const im = store.imports.find((x) => x.id === btn.dataset.id);
    if (im && await ask(`This removes the ${im.count} transactions that came from this import, and nothing else. The names you taught me are kept.`, { title: 'Undo this import?', confirmText: 'Undo import' })) { const n = store.undoImport(im.id); catIndex = null; ui.pickedInitial = false; toast(`Removed ${n} transactions`); }
  }
  else if (a === 'import-backup') $('#file-json').click();
  else if (a === 'erase') { if (await ask('Every transaction, in every currency, is removed from this phone. Categories and Who owes me are kept. This cannot be undone.', { title: 'Erase all transactions?', confirmText: 'Erase' })) { store.eraseAllTransactions(); catIndex = null; toast('All transactions erased'); } }
  else if (a === 'open-report') { ui.report = btn.dataset.key; render(); window.scrollTo(0, 0); }
  else if (a === 'open-year') { ui.year = +btn.dataset.year; render(); window.scrollTo(0, 0); }
  else if (a === 'close-report') { ui.report = null; ui.year = null; if (location.hash) history.replaceState(null, '', location.pathname); render(); }
  else if (a === 'print-report') window.print();
  else if (a === 'dismiss-report-banner') { const seen = store.settings.reportsSeen || []; seen.push(btn.dataset.key); store.setSetting('reportsSeen', seen); }
  else if (a === 'open-report-banner') { const seen = store.settings.reportsSeen || []; seen.push(btn.dataset.key); store.state.settings.reportsSeen = seen; const [y, m] = btn.dataset.key.split('-').map(Number); ui.insightsMonth = { year: y, month: m }; ui.report = btn.dataset.key; store.commit(); }
  else if (a === 'dismiss-backup-banner') store.setSetting('lastBackupPrompt', Date.now());
  else if (a === 'pin') await pinPress(btn.dataset.value);
  else if (a === 'pin-back') { pinEntry = pinEntry.slice(0, -1); renderDots(); }
  else if (a === 'pin-cancel') { if (pinMode !== 'unlock') { hideLock(); render(); } }
});

let descTimer = null;
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.split && sheetState?.kind === 'tx') {
    const s = sheetState.values.splits[+el.dataset.i]; if (s) s[el.dataset.split] = el.value;
    const save = $('#sheet .save'); if (save) save.disabled = !canSaveTx(sheetState.values);
    const hint = el.closest('.field')?.querySelector('.hint');
    if (hint) { const v = sheetState.values; const rem = (num(v.amount) || 0) - v.splits.reduce((a, x) => a + (num(x.amount) || 0), 0); hint.className = 'hint' + (Math.abs(rem) > 0.004 ? ' warn' : ''); hint.textContent = Math.abs(rem) > 0.004 ? `${money(Math.abs(rem), v.currency)} ${rem > 0 ? 'still to assign' : 'too much'} — the parts must add up to the amount above` : 'Parts add up. The category above is ignored.'; }
    return;
  }
  if (el.dataset.field && sheetState) {
    sheetState.values[el.dataset.field] = el.value;
    if (el.dataset.field === 'desc' && sheetState.kind === 'tx') {
      const box = el.closest('.field').querySelector('.suggest'); const s = suggestionsFor(sheetState.values); if (box) box.innerHTML = s.map((x) => `<button data-action="f-suggest" data-value="${esc(x)}">${esc(x)}</button>`).join('');
      clearTimeout(descTimer); descTimer = setTimeout(() => { if (sheetState?.kind === 'tx') autoFill(sheetState.values); }, 250);
    }
    if (sheetState.kind === 'goal' && GOAL_PLAN_FIELDS.has(el.dataset.field)) refreshGoalPlan();
    const save = $('#sheet .save');
    if (save) {
      const k = sheetState.kind, v = sheetState.values;
      save.disabled = k === 'tx' ? !canSaveTx(v) : k === 'cat' || k === 'acc' ? !(v.name || '').trim() : k === 'goal' ? !(v.name.trim() && num(v.target) > 0 && v.startDate) : k === 'transfer' ? !(v.from && v.to && v.from !== v.to && num(v.amount) > 0) : k === 'owed' ? !canSaveOwed(v) : k === 'repay' ? !(num(v.amount) > 0) : save.disabled;
    }
  }
  if (sheetState?.kind === 'repay' && el.dataset.field === 'amount') { const h = $('#repay-hint'); if (h) h.textContent = repayHint(sheetState.values); }
  if (sheetState?.kind === 'tx' && (el.dataset.field === 'owePerson' || el.dataset.field === 'oweAmount')) { const h = el.closest('.field').querySelector('.hint'); const v = sheetState.values; if (h) h.textContent = v.owePerson.trim() && num(v.oweAmount) > 0 ? `${v.owePerson.trim().split(' ')[0]} will show under Who owes me, for ${money(num(v.oweAmount), v.currency)}.` : 'Enter the name and how much they owe you.'; }
  if (el.dataset.action === 'tx-search') { ui.tx.search = el.value; renderList(); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const a = el.dataset.action;
  if (el.dataset.split && sheetState?.kind === 'tx') { const s = sheetState.values.splits[+el.dataset.i]; if (s) s[el.dataset.split] = el.value; return; }
  if (el.dataset.field && sheetState) {
    sheetState.values[el.dataset.field] = el.value;
    const k = sheetState.kind;
    if (k === 'goal' && GOAL_PLAN_FIELDS.has(el.dataset.field)) refreshGoalPlan();
    if (k === 'tx') {
      if (el.dataset.field === 'category') { sheetState.values.catTouched = true; sheetState.values.auto = null; const h = $('#auto-hint'); if (h) h.innerHTML = ''; }
      if (['repeat', 'currency'].includes(el.dataset.field)) renderTxForm();
    }
    if (k === 'transfer' && ['from', 'to'].includes(el.dataset.field)) renderTransferForm();
    if (k === 'repay' && el.dataset.field === 'currency') { const g = groupPeople(store.owed).find((x) => personKey(x.name) === personKey(sheetState.values.person)); if (g && g.totals[el.value]) sheetState.values.amount = String(g.totals[el.value]); renderRepayForm(); }
  }
  if (a === 'set-currency') {
    if (el.value === 'ALL') store.setSetting('showAll', true);
    else { store.state.settings.showAll = false; store.setSetting('currency', el.value); }
    ui.pickedInitial = false;
  }
  else if (a === 'set-currency-default') store.setSetting('currency', el.value);
  else if (a === 'set-home') { store.state.settings.homeCurrency = el.value || null; if (!el.value) store.state.settings.showAll = false; store.commit(); if (el.value) refreshRates(true).then((ok) => { if (ok) render(); }); }
  else if (a === 'pick-month') { const [y, m] = el.value.split('-').map(Number); if (y && m) { if (el.dataset.scope === 'ins') ui.insightsMonth = { year: y, month: m }; else ui.month = { year: y, month: m }; render(); } }
  else if (a === 'tx-category') { ui.tx.category = el.value; render(); }
  else if (a === 'f-record') { if (sheetState) sheetState.values.record = el.checked; }
  else if (a === 'toggle-reports') store.setSetting('reportsEnabled', el.checked);
  else if (a === 'set-theme') { store.setSetting('theme', el.value); applyTheme(); }
  else if (a === 'set-look') { store.setSetting('look', LOOKS.includes(el.value) ? el.value : 'indigo'); applyTheme(); }
  else if (a === 'toggle-rollover') store.setSetting('budgetRollover', el.checked);
  else if (a === 'set-report-day') store.setSetting('reportDay', +el.value);
  else if (a === 'toggle-encrypt') { await toggleEncryption(el); }
  else if (a === 'toggle-pin') { if (el.checked) setPinFlow(); else showLock('disable', 'Enter your PIN to turn it off'); }
  else if (el.id === 'file-receipt' && el.files[0] && sheetState?.kind === 'tx') {
    const file = el.files[0]; el.value = '';
    try { sheetState.receipt = await shrinkImage(file); sheetState.receiptChanged = true; paintReceipt(); }
    catch (err) { await notify(err.message || 'Could not read the photo.', 'Receipt'); }
  }
  else if (el.id === 'file-json' && el.files[0]) {
    const raw = await readFile(el.files[0]); el.value = '';
    try {
      const text = await readBackupText(raw);
      if (text === null) return;
      const r = store.restoreBackup(text); catIndex = null; adoptCurrency(); ui.pickedInitial = false; render();
      const n = await importReceipts(r.receipts);
      const left = r.skipped ? ` ${r.skipped} damaged ${r.skipped === 1 ? 'row was' : 'rows were'} left out.` : '';
      const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
      await notify(`Restored ${pl(r.transactions, 'transaction', 'transactions')}, ${pl(r.categories, 'category', 'categories')} and ${pl(r.rules, 'recurring rule', 'recurring rules')}${n ? ` and ${pl(n, 'receipt photo', 'receipt photos')}` : ''}.${left}`, 'Restore');
    } catch (err) { await notify(err.message || 'That file is not an Expense Tracker backup.', 'Restore'); }
  }
});

async function toggleEncryption(el) {
  if (el.checked) {
    const ok = await ask('Your data on this phone will be scrambled with a passphrase you choose, and you will type it every time you open the app. If you forget it, nobody can get your data back, not even me. Save a backup first so you are never locked out of your own records.', { title: 'Lock your saved data?', confirmText: 'Choose a passphrase', danger: false });
    if (!ok) { render(); return; }
    let key = null;
    const pw = await askPassword({
      title: 'Choose a passphrase', message: 'At least 8 characters. Write it down somewhere safe.', confirmText: 'Lock my data', again: true,
      check: async (p) => { try { key = await store.enableEncryption(p); return null; } catch (e) { return e.message || 'Could not lock the data.'; } },
    });
    if (pw === null) { render(); return; }
    setReceiptKey(key);
    try { await convertReceipts(key); } catch (e) { console.error('Receipts not locked', e); await notify('Your data is locked, but some receipt photos could not be. They are still safe on this phone.', 'Passphrase'); }
    toast('Saved data is locked'); render();
  } else {
    if (!(await ask('The data on this phone will be stored in plain form again, as it was before. You will not be asked for the passphrase any more.', { title: 'Remove the passphrase?', confirmText: 'Remove it', danger: false }))) { render(); return; }
    await store.disableEncryption();
    try { await convertReceipts(null); } catch (e) { console.error('Receipts not unlocked', e); }
    toast('Passphrase removed'); render();
  }
}

// Shown before anything else when saved data is locked.
function passphraseGate() {
  return new Promise((resolve) => {
    const el = $('#lock');
    el.classList.remove('hidden');
    el.innerHTML = `${icon('lock')}<h2>Enter your passphrase</h2>
      <input id="gate-pw" class="gate-input" type="password" placeholder="Passphrase" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false">
      <div class="err" id="gate-err" role="alert"></div>
      <button class="btn primary" id="gate-go">Unlock</button>
      <button class="gate-forgot" id="gate-forgot">I forgot it</button>`;
    const pw = $('#gate-pw'), err = $('#gate-err'), go = $('#gate-go');
    pw.focus();
    let busy = false;
    const open = async () => {
      if (busy || !pw.value) return;
      busy = true; go.disabled = true; err.textContent = 'Unlocking…';
      await new Promise((r) => setTimeout(r, 30));
      try {
        const key = await store.unlock(pw.value);
        setReceiptKey(key);
        el.classList.add('hidden'); el.innerHTML = '';
        resolve();
      } catch (e) {
        busy = false; go.disabled = false;
        err.textContent = e && e.wrong ? 'That passphrase is not right.' : (e && e.message) || 'Could not unlock.';
        pw.select();
      }
    };
    go.addEventListener('click', open);
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    $('#gate-forgot').addEventListener('click', async () => {
      if (busy) return;
      const yes = await ask('A forgotten passphrase cannot be recovered by anyone. If you have a backup file, you can erase the locked data on this phone and restore the backup. This removes everything stored here, receipt photos included.', { title: 'Erase and start over?', confirmText: 'Erase everything here' });
      if (!yes) return;
      store.eraseLocked(); await clearReceipts();
      el.classList.add('hidden'); el.innerHTML = '';
      resolve();
    });
  });
}

function setPinFlow() {
  showLock('set', 'Choose a 4–6 digit PIN');
  let first = '';
  const handler = async (e) => {
    const b = e.target.closest('[data-action="pin"]'); const done = e.target.closest('[data-action="pin-done"]');
    if (!b && !done) return;
    e.stopImmediatePropagation();
    if (b) { if (pinEntry.length < 6) { pinEntry += b.dataset.value; renderDots(); } if (pinEntry.length >= 4) $('#pin-done')?.classList.remove('hidden'); }
    if (done) {
      if (!first) { first = pinEntry; pinEntry = ''; $('#lock h2').textContent = 'Enter it again'; renderDots(); $('#pin-done').classList.add('hidden'); }
      else if (first === pinEntry) { store.state.settings.pinLen = first.length; store.setSetting('pinHash', await sha(first)); document.removeEventListener('click', handler, true); hideLock(); toast('PIN set'); render(); }
      else { $('#pin-err').textContent = 'The PINs did not match'; first = ''; pinEntry = ''; $('#lock h2').textContent = 'Choose a 4–6 digit PIN'; renderDots(); }
    }
  };
  document.addEventListener('click', handler, true);
  const cancel = $('#lock [data-action="pin-cancel"]');
  cancel.addEventListener('click', () => { document.removeEventListener('click', handler, true); render(); }, { once: true });
  $('#lock .keypad').insertAdjacentHTML('afterend', `<button id="pin-done" class="btn primary hidden" data-action="pin-done">Use this PIN</button>`);
}

function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }

function buildExcel() {
  const accName = (id) => (store.accounts.find((a) => a.id === id) || {}).name || '';
  const sorted = [...store.transactions].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  const months = new Map();
  for (const t of sorted) {
    const k = t.date.slice(0, 7) + ' ' + t.currency;
    const v = months.get(k) || { month: t.date.slice(0, 7), currency: t.currency, income: 0, expense: 0, count: 0 };
    if (t.type === 'Income') v.income += t.amount; else v.expense += t.amount;
    v.count += 1; months.set(k, v);
  }
  const overview = [...months.values()].map((v) => [v.month, v.currency, v.income, v.expense, v.income - v.expense, v.count]);
  return buildWorkbook([
    { name: 'Overview', columns: [{ title: 'Month', width: 12 }, { title: 'Currency', width: 10 }, { title: 'Income', width: 14, style: 'money' }, { title: 'Expense', width: 14, style: 'money' }, { title: 'Left over', width: 14, style: 'money' }, { title: 'Transactions', width: 13, style: 'int' }], rows: overview },
    { name: 'Transactions', columns: [{ title: 'Date', width: 12, style: 'date' }, { title: 'Time', width: 8 }, { title: 'Type', width: 10 }, { title: 'Category', width: 20 }, { title: 'Amount', width: 13, style: 'money' }, { title: 'Currency', width: 10 }, { title: 'Description', width: 40 }, { title: 'Tags', width: 18 }, { title: 'Account', width: 14 }],
      rows: sorted.map((t) => [excelDate(t.date), t.time || '', t.type, t.category, t.amount, t.currency, t.desc || '', (t.tags || []).join(', '), accName(t.account)]) },
    { name: 'Categories', columns: [{ title: 'Category', width: 24 }, { title: 'Type', width: 10 }, { title: 'Monthly budget', width: 16, style: 'money' }, { title: 'Currency', width: 10 }], rows: store.categories.map((c) => [c.name, c.type, c.budget || '', c.budget ? c.budgetCurrency : '']) },
  ]);
}

// Spreadsheets cannot be locked from here, so the person is told before the file exists.
function confirmPlain(kind) {
  return ask(`This ${kind} is not protected. Anyone who gets it can read every amount and description. Keep it somewhere private, and do not send it to people you do not trust.`, { title: 'Save without a password?', confirmText: 'Save the file', danger: false });
}

async function saveBackup() {
  let how = 'protected';
  if (vaultAvailable()) {
    how = await dialog({
      title: 'Save a backup',
      message: 'A backup holds every amount, description and receipt photo. A plain file can be opened by anyone who gets it. A protected file needs a password that you choose. If you forget the password, nobody can open the file, including me.',
      stack: true,
      buttons: [{ label: 'Protect it with a password', value: 'protected', primary: true }, { label: 'Save a plain file', value: 'plain' }, { label: 'Cancel', value: false }],
    });
  } else {
    how = 'plain';
    if (!(await confirmPlain('backup'))) how = false;
  }
  if (!how) return;
  let pw = null;
  if (how === 'protected') {
    pw = await askPassword({ title: 'Choose a password', message: 'Write it down somewhere safe. It cannot be recovered.', confirmText: 'Save backup', again: true });
    if (!pw) return;
  }
  toast(pw ? 'Locking the backup…' : 'Preparing the backup…');
  const ids = await receiptIds();
  const receipts = await exportReceipts(ids);
  const json = store.exportBackup(receipts);
  if (!pw) { download(`ExpenseTracker-backup-${todayISO()}.json`, json, 'application/json'); return; }
  const envelope = await sealText(json, pw);
  download(`ExpenseTracker-backup-${todayISO()}-protected.json`, JSON.stringify({ app: 'Expense Tracker', ...envelope }), 'application/json');
}

// Reads a backup file as text, asking for the password first when the file is protected.
async function readBackupText(text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { return text; } // restoreBackup explains an unreadable file
  if (!looksEncrypted(parsed)) return text;
  let opened = null;
  const pw = await askPassword({
    title: 'This backup has a password', message: 'Type the password you chose when you saved it.', confirmText: 'Open it',
    check: async (p) => { try { opened = await openText(parsed, p); return null; } catch (e) { return e.wrong ? 'That password is not right. Try again.' : 'This backup could not be opened.'; } },
  });
  return pw === null ? null : opened;
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  store.setSetting('lastExport', Date.now());
  toast(onIOS ? 'Use "Save to Files" to keep it in iCloud Drive' : 'Saved. Look in your Downloads folder');
}

// swipe on the hero to change month
let touch = null;
document.addEventListener('touchstart', (e) => { const h = e.target.closest('[data-swipe="month"]'); touch = h ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y; touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { ui.month = dx < 0 ? A.nextKey(ui.month) : A.prevKey(ui.month); ui.slide = dx < 0 ? 'slide-left' : 'slide-right'; render(); setTimeout(() => { ui.slide = ''; }, 400); }
}, { passive: true });

// ---------- banners
function banners() {
  const st = store.settings;
  let out = '';
  if (store.blocked) {
    out += `<div class="banner warn">${icon('shield')}<div class="txt">Your saved data could not be read, and there is no room to keep a copy. Nothing new is being saved, so the original stays untouched. Save a copy to a file first.</div><button data-action="save-damaged">Save a copy</button><button data-action="start-fresh">Start fresh</button></div>`;
  } else if (store.recovery && !ui.hideRecovery) {
    out += `<div class="banner warn">${icon('shield')}<div class="txt">Your saved data could not be read, so the app started empty. A copy of the damaged data was kept. Save it to a file in case it can be fixed.</div><button data-action="save-damaged">Save a copy</button><button class="muted" data-action="dismiss-damaged">${icon('x')}</button></div>`;
  }
  if (st.reportsEnabled) {
    const d = new Date();
    if (d.getDate() >= st.reportDay) {
      const key = A.prevKey(A.currentKey());
      const ks = A.keyStr(key);
      const hasData = ledger().some((t) => A.inMonth(t, key));
      if (hasData && !(st.reportsSeen || []).includes(ks)) out += `<div class="banner">${icon('doc')}<div class="txt">Your ${esc(A.keyTitle(key))} report is ready.</div><button data-action="open-report-banner" data-key="${ks}">View</button><button class="muted" data-action="dismiss-report-banner" data-key="${ks}">${icon('x')}</button></div>`;
    }
  }
  const days = 30 * 86400000;
  const last = Math.max(st.lastExport || 0, st.lastBackupPrompt || 0);
  if (store.transactions.length > 0 && Date.now() - last > days && (st.lastExport || store.transactions.length > 20)) {
    out += `<div class="banner">${icon('shield')}<div class="txt">It's been a while since your last backup. Save one to ${onIOS ? 'Files or iCloud Drive' : 'your Downloads folder or a cloud drive'}.</div><button data-action="go" data-tab="settings">Backup</button><button class="muted" data-action="dismiss-backup-banner">${icon('x')}</button></div>`;
  }
  return out;
}

// ---------- render
function renderList() {
  const screen = $('#app .screen');
  if (!screen || ui.tab !== 'transactions') return;
  const temp = document.createElement('div'); temp.innerHTML = renderTransactions();
  const newList = temp.querySelector('.list'), newNote = temp.querySelector('.footer-note');
  screen.querySelector('.list').replaceWith(newList);
  screen.querySelector('.footer-note').replaceWith(newNote);
}

function render() {
  const app = $('#app');
  if (ui.report || ui.year) {
    app.innerHTML = ui.year ? renderYear(ui.year) : renderReport({ year: +ui.report.slice(0, 4), month: +ui.report.slice(5, 7) });
    $('#tabbar').classList.add('hidden'); return;
  }
  $('#tabbar').classList.remove('hidden');
  const screens = { dashboard: renderDashboard, insights: renderInsights, transactions: renderTransactions, categories: renderCategories, owed: renderOwed, settings: renderSettings };
  let html = screens[ui.tab]();
  const b = banners();
  if (b) html = html.replace('<div class="screen">', `<div class="screen"><div class="stack">${b}</div>`);
  const keep = document.activeElement && document.activeElement.id === 'entry-text' ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  app.innerHTML = html;
  if (keep) { const t = $('#entry-text'); if (t) { t.focus({ preventScroll: true }); try { t.setSelectionRange(keep.start, keep.end); } catch { /* not needed */ } } }
  const active = ui.tab === 'categories' || ui.tab === 'owed' ? 'settings' : ui.tab;
  for (const t of $('#tabbar').querySelectorAll('button[data-tabbtn]')) t.classList.toggle('on', t.dataset.tabbtn === active);
}

store.subscribe(() => { catIndex = null; if (!sheetState) render(); });

function applyTheme() {
  const t = store.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else document.documentElement.removeAttribute('data-theme');
  const look = lookOf();
  if (look !== 'indigo') document.documentElement.dataset.look = look; else document.documentElement.removeAttribute('data-look');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look === 'gold' ? '#141416' : look === 'cobalt' ? '#F8FAFC' : look === 'obsidian' ? '#0B0E11' : '#171E4A');
  // a light page needs dark clock and battery icons on an iPhone (read again the next time the app is opened)
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', look === 'cobalt' ? 'default' : 'black-translucent');
}

function openFromHash() {
  let m = location.hash.match(/^#report-(\d{4})-(\d{2})$/);
  if (m) { ui.report = `${m[1]}-${m[2]}`; ui.insightsMonth = { year: +m[1], month: +m[2] }; ui.tab = 'insights'; return true; }
  m = location.hash.match(/^#year-(\d{4})$/);
  if (m) { ui.year = +m[1]; ui.tab = 'insights'; return true; }
  return false;
}

function init() {
  if (!store.settings.lastBackupPrompt) store.state.settings.lastBackupPrompt = Date.now();
  const added = processRecurring();
  if (added) setTimeout(() => toast(`${added} recurring ${added === 1 ? 'transaction' : 'transactions'} added`), 600);
  const tab = (t, i, l) => `<button data-action="go" data-tab="${t}" data-tabbtn="${t}">${icon(i)}<span>${l}</span></button>`;
  $('#tabbar').innerHTML = tab('dashboard', 'home', 'Home') + tab('transactions', 'list', 'Activity')
    + `<button class="plus" data-action="add" aria-label="Add transaction"><span>${icon('plus')}</span></button>`
    + tab('insights', 'pie', 'Insights') + tab('settings', 'dots', 'More');
  applyTheme();
  initEntry({ toast, edit: (prefill) => txForm({ prefill }) });
  initImport({
    confirmLeave: () => ask('Nothing has been added yet.', { title: 'Leave without adding?', confirmText: 'Leave', danger: false }),
    confirmMismatch: (n) => ask(`${n} ${n === 1 ? 'row does' : 'rows do'} not add up with the balance column on your statement. An amount may be misread, or a row may be missing. Compare with your statement before you continue.`, { title: 'The totals do not match', confirmText: 'Add anyway', danger: false }),
    done: (r) => {
      catIndex = null;
      if (r.currency !== store.settings.currency || store.settings.showAll) { store.state.settings.showAll = false; store.setSetting('currency', r.currency); }
      ui.month = A.keyOf(r.to); ui.insightsMonth = A.keyOf(r.to); ui.pickedInitial = true;
      ui.tx = { search: '', type: 'All', category: '', day: '' }; ui.tab = 'dashboard';
      render(); window.scrollTo(0, 0);
      const extra = r.duplicates ? ` ${r.duplicates} already here, skipped.` : '';
      toast(`Added ${r.count} ${r.count === 1 ? 'transaction' : 'transactions'}.${extra}`, { label: 'Undo', fn: () => { const n = store.undoImport(r.id); catIndex = null; ui.pickedInitial = false; toast(`Removed ${n} transactions`); } });
    },
  });
  openFromHash();
  render();
  window.addEventListener('hashchange', () => { if (openFromHash()) render(); });
  if (store.settings.pinHash) { ui.locked = true; showLock('unlock', 'Enter your PIN'); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { const n = processRecurring(); if (n) toast(`${n} recurring added`); if (store.settings.pinHash && !ui.locked && pinMode === null) { if (Date.now() - (init.hidAt || 0) > 60000) { ui.locked = true; showLock('unlock', 'Enter your PIN'); } } }
    else init.hidAt = Date.now();
  });
  if (store.settings.homeCurrency) refreshRates().then((ok) => { if (ok && !sheetState) render(); });
  window.addEventListener('online', () => { if (store.settings.homeCurrency) refreshRates().then((ok) => { if (ok && !sheetState) render(); }); });
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('A new version is ready', { label: 'Reload', fn: () => location.reload() }); });
  }
}

(async () => { if (store.sealed) await passphraseGate(); init(); })();
