import { store, processRecurring, parseCSV, exportCSV, todayISO, toISODate, parseISODate, CURRENCIES, nextDue, stepDate } from './store.js';
import * as A from './analytics.js';
import * as C from './charts.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (v, code = cur()) => A.fmtMoney(v, code);
const signed = (v, code = cur()) => A.fmtSigned(v, code);
const cur = () => store.settings.currency;
const ledger = () => store.transactions.filter((t) => t.currency === cur());

const ui = {
  tab: 'dashboard',
  month: A.currentKey(),
  insightsMonth: A.currentKey(),
  slide: '',
  pendingCategory: null,
  tx: { search: '', type: 'All', category: '' },
  locked: false,
  pickedInitial: false,
  pickedInsightsInitial: false,
  report: null,
};

// ---------- helpers
function dialog({ title = '', message = '', buttons = [] }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="alertdialog">${title ? `<h3>${esc(title)}</h3>` : ''}<p>${esc(message)}</p><div class="modal-actions">${buttons.map((b, i) => `<button class="${b.danger ? 'danger' : b.primary ? 'primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
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

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2800);
}

// After an import, show the currency the data is actually in if the current one has nothing to show.
function adoptCurrency() {
  if (store.transactions.some((t) => t.currency === cur())) return;
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

function monthNav(key, scope) {
  return `<div class="month-nav reveal">
    <button class="arrow" data-action="step" data-scope="${scope}" data-delta="-1" aria-label="Previous month"><span>${icon('chevL')}</span></button>
    <div class="title"><span>${esc(A.keyTitle(key))}</span>${icon('chevD')}
      <input type="month" value="${A.keyStr(key)}" data-action="pick-month" data-scope="${scope}" aria-label="Choose month"></div>
    <button class="arrow" data-action="step" data-scope="${scope}" data-delta="1" aria-label="Next month"><span>${icon('chevR')}</span></button>
  </div>`;
}

function tileHTML(t) {
  return `<div class="tile"><div class="ic-wrap ${t.tint}">${icon(t.icon)}</div><div class="val num ${t.tint === 'good' ? 'good' : ''}">${esc(t.value)}</div><div class="lbl">${esc(t.label)}</div></div>`;
}

function catRow(item, clickable) {
  const color = C.slotColor(item.slot);
  const inner = `<div class="line"><span class="ic-wrap" style="background:${color}22;color:${color}">${icon(A.iconFor(item.name))}</span>
      <span class="name">${esc(item.name)}</span><span class="amt num">${money(item.total)}</span></div>
    <div class="bar" style="height:4px"><div class="bar-fill" style="width:${(item.share * 100).toFixed(1)}%;background:${color}"></div></div>`;
  return clickable ? `<button class="cat-row" data-action="show-category" data-category="${esc(item.name)}">${inner}</button>` : `<div class="cat-row">${inner}</div>`;
}

function breakdownCard(title, totals, total) {
  const slices = A.slices(totals);
  const legend = totals.slice(0, 4).map((t) => `<div class="l"><span class="dot" style="background:${C.slotColor(t.slot)}"></span><span class="n">${esc(t.name)}</span><span class="p num">${A.fmtPct(t.share)}</span></div>`).join('');
  const rows = totals.slice(0, 5).map((t) => catRow(t, true)).join('');
  const more = totals.length > 5 ? `<button class="link-btn" data-action="show-category-all">Show all ${totals.length} in Transactions</button>` : '';
  return `<section class="card reveal"><div class="card-head"><h2>${esc(title)}</h2><span class="meta">${totals.length} ${totals.length === 1 ? 'category' : 'categories'}</span></div>
    <div class="donut-row">${C.donut(slices, { centerTop: 'Total', centerMain: money(total) })}<div class="legend">${legend}</div></div>
    <div class="divider"></div><div class="cat-list">${rows}</div>${more}</section>`;
}

function budgetCard(budgets) {
  const spent = budgets.reduce((a, b) => a + b.spent, 0), limit = budgets.reduce((a, b) => a + b.limit, 0);
  const rows = budgets.map((b) => {
    const fill = b.ratio >= 1 ? 'warn' : b.ratio >= 0.8 ? 'silver' : 'gold';
    const color = b.ratio >= 1 ? 'var(--warn)' : b.ratio >= 0.8 ? 'var(--silver)' : 'var(--gold)';
    return `<div class="budget"><div class="line"><span style="color:${color}">${icon(A.iconFor(b.name))}</span><span class="name">${esc(b.name)}</span><span class="amt num">${money(b.spent)} / ${money(b.limit)}</span></div>
      ${C.bar(b.ratio, { fill, height: 8 })}<div class="sub"><span>${A.fmtPct(b.ratio)} used</span><span>${b.remaining >= 0 ? money(b.remaining) + ' left' : money(-b.remaining) + ' over'}</span></div></div>`;
  }).join('');
  return `<section class="card reveal"><div class="card-head"><h2>Budgets</h2><span class="meta num">${money(spent)} of ${money(limit)}</span></div>${rows}</section>`;
}

// ---------- Dashboard
function renderDashboard() {
  pickInitialMonth();
  const items = ledger();
  const ins = A.insights(items, store.categories, ui.month, cur());
  const s = ins.summary;
  const quick = A.quickAddItems(items);
  const other = store.transactions.length - items.length;
  const positive = s.balance >= 0;
  const spentShare = s.income > 0 ? Math.min(s.expense / s.income, 1) : s.expense > 0 ? 1 : 0;
  const note = s.count === 0 ? 'Nothing recorded yet' : s.income <= 0 ? 'No income recorded' : `${A.fmtPct(s.expense / s.income)} of income spent`;

  const hero = `<section class="hero reveal" data-swipe="month"><div class="glow"></div>
    <div class="row"><span class="month">${esc(A.keyTitle(ui.month))}</span><span class="badge ${positive ? 'ok' : 'over'}">${positive ? 'Left over' : 'Overspent'}</span></div>
    <div class="balance num">${signed(s.balance)}</div><div class="note">${esc(note)}</div>
    <div class="spent">${C.bar(spentShare, { fill: positive ? 'gold' : 'warn', height: 5 })}</div>
    <div class="figures">
      <div class="figure"><span class="ic-wrap gold">${icon('arrowIn')}</span><div><div class="lbl">Income</div><div class="val gold num">${money(s.income)}</div></div></div>
      <div class="figure"><span class="ic-wrap silver">${icon('arrowOut')}</span><div><div class="lbl">Expense</div><div class="val silver num">${money(s.expense)}</div></div></div>
    </div></section>`;

  const tiles = ins.tiles.length ? `<div class="strip reveal">${ins.tiles.map(tileHTML).join('')}</div>` : '';
  const teaser = s.count ? `<button class="card teaser reveal" data-action="go" data-tab="insights"><span class="ic-wrap">${icon('sparkles')}</span><div class="grow"><p>${esc(ins.sentences[0])}</p><div class="more">Read the full summary</div></div><span class="chev">${icon('chevR')}</span></button>` : '';
  const quickHTML = quick.length ? `<div class="reveal"><div class="strip-label">Quick add</div><div class="strip">${quick.map((q) => `<button class="chip ${q.type === 'Income' ? 'income' : ''}" data-action="quick-add" data-id="${q.id}">${icon(A.iconFor(q.category))}<span><div class="t">${esc(q.desc || q.category)}</div><div class="a num">${money(q.amount, q.currency)}</div></span></button>`).join('')}</div></div>` : '';
  const budgets = ins.budgets.length ? budgetCard(ins.budgets) : '';

  let body = '';
  if (s.count === 0) {
    body = `<section class="card reveal"><div class="empty">${icon('tray')}<h3>${items.length ? `Nothing recorded in ${esc(A.keyTitle(ui.month))}` : `No ${esc(cur())} transactions yet`}</h3>
      <p>${items.length ? 'Tap + to add a transaction, or swipe the card to another month.' : 'Add your first transaction, or import your Excel data as CSV under Settings.'}</p>
      <button class="btn primary" data-action="add">Add transaction</button></div></section>`;
  } else {
    body = (s.expenseByCategory.length ? breakdownCard('Expenses', s.expenseByCategory, s.expense) : '')
      + `<section class="card reveal"><h2 style="margin-bottom:16px">Cash flow</h2>
          <div class="budget"><div class="line"><span class="name muted">Income</span><span class="amt num gold">${money(s.income)}</span></div>${C.bar(s.income / Math.max(s.income, s.expense, 1), { fill: 'gold', height: 10 })}</div>
          <div class="budget" style="margin-top:14px"><div class="line"><span class="name muted">Expense</span><span class="amt num silver">${money(s.expense)}</span></div>${C.bar(s.expense / Math.max(s.income, s.expense, 1), { fill: 'silver', height: 10 })}</div></section>`
      + (s.incomeByCategory.length ? breakdownCard('Income', s.incomeByCategory, s.income) : '');
  }
  const tr = A.trend(items, ui.month);
  const net = tr.reduce((a, p) => a + p.balance, 0);
  const trendHTML = items.length ? `<section class="card reveal"><div class="card-head"><h2>Last 6 months</h2><span class="meta num ${net >= 0 ? 'gold' : 'warn'}">Net ${signed(net)}</span></div>${C.columns(tr, { formatY: C.compact })}<div class="legend-inline"><span class="li">Income</span><span class="le">Expense</span></div></section>` : '';
  const otherNote = other ? `<p class="footer-note">Showing ${esc(cur())} only. ${other} more transactions are kept in other currencies; switch with the ${esc(cur())} button at the top.</p>` : '';

  return topbar('Dashboard', currencyBtn(), addBtn()) + `<div class="screen">${monthNav(ui.month, 'dash')}<div class="stack ${ui.slide}" style="gap:18px">${hero}${tiles}${teaser}${quickHTML}${budgets}${body}${trendHTML}${otherNote}</div></div>`;
}

function topbar(title, left = '', right = '') {
  return `<header class="topbar"><div class="left">${left}</div><h1>${esc(title)}</h1><div class="right">${right}</div></header>`;
}
function currencyBtn() {
  const opts = CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === cur() ? 'selected' : ''}>${c.name} (${c.code})</option>`).join('');
  return `<div class="select-wrap pill-btn">${esc(cur())}<select data-action="set-currency" aria-label="Currency">${opts}</select></div>`;
}
function addBtn() { return `<button class="pill-btn icon-only" data-action="add" aria-label="Add transaction">${icon('plus')}</button>`; }

// ---------- Insights
function renderInsights() {
  pickInitialMonth();
  const items = ledger();
  const key = ui.insightsMonth;
  const ins = A.insights(items, store.categories, key, cur());
  const s = ins.summary;
  const rate = ins.savingsRate;
  const summaryCard = `<section class="card gold-edge reveal"><div class="card-head" style="align-items:flex-start"><div><div class="silver" style="font-size:15px">${esc(A.keyTitle(key))}</div><h2 style="font-size:22px;font-family:var(--font-round)">In brief</h2></div>
      ${C.ring(rate, { text: s.income > 0 ? A.fmtPct(rate) : '–' })}</div>
    <ul class="sentences">${ins.sentences.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;

  let detail = '';
  if (s.count > 0) {
    const busiest = ins.weekdays.reduce((a, b) => (b.average > a.average ? b : a), ins.weekdays[0]);
    detail += `<section class="card reveal"><div class="card-head"><h2>Daily spending</h2><span class="meta gold num">Avg ${money(ins.perDay)}</span></div>${C.dailyBars(ins.daily, ins.perDay, { formatY: C.compact })}<p class="caption">Gold bars are days with more than twice the average.</p></section>`;
    detail += `<section class="card reveal"><div class="card-head"><h2>By weekday</h2><span class="meta">${busiest.average > 0 ? esc(A.WEEKDAYS[busiest.weekday]) + 's cost most' : ''}</span></div>${C.weekdayBars(ins.weekdays, { formatY: C.compact })}<p class="caption">Average spent on each weekday this month.</p></section>`;
    if (ins.movers.length) {
      detail += `<section class="card reveal"><div class="card-head"><h2>Biggest changes</h2><span class="meta">vs ${esc(A.keyShort(A.prevKey(key)))}</span></div>` + ins.movers.map((m) => `<button class="mover" data-action="show-category" data-category="${esc(m.name)}"><span class="ic-wrap ${m.change > 0 ? 'up' : 'down'}">${icon(m.change > 0 ? 'up' : 'down')}</span><div class="txt"><div class="n">${esc(m.name)}</div><div class="s num">${money(m.before)} → ${money(m.now)}</div></div><span class="chg num ${m.change > 0 ? 'warn' : 'gold'}">${signed(m.change)}</span>${icon('chevR', 'muted')}</button>`).join('') + '</section>';
    }
  }
  const positive = ins.balanceTrend.filter((p) => p.balance > 0).length;
  const trendCard = `<section class="card reveal"><div class="card-head"><h2>Left over, by month</h2><span class="meta ${ins.streak >= 2 ? 'gold' : ''}">${ins.streak >= 2 ? icon('flame') + ' ' + ins.streak + ' month streak' : positive + ' of 6 positive'}</span></div>${C.balanceBars(ins.balanceTrend, { format: C.compact })}</section>`;

  const seen = store.settings.reportsSeen || [];
  const reportCard = `<section class="card reveal"><div class="card-head"><h2>Monthly report</h2><button class="link-btn" style="width:auto" data-action="go" data-tab="settings">Settings</button></div>
    <div class="row" style="padding:0;border:0"><span class="ic-wrap income">${icon('doc')}</span><div class="txt"><div class="t">${esc(A.keyTitle(key))} report</div><div class="s">${s.count ? 'Totals, summary, categories, budgets, trend, largest expenses' : 'No data for this month'}</div></div></div>
    <button class="btn secondary block mt" data-action="open-report" data-key="${A.keyStr(key)}" ${s.count ? '' : 'disabled'}>${icon('doc')} View report (PDF / print)</button>
    <p class="caption">${reportScheduleText()}</p></section>`;

  return topbar('Insights', '', '') + `<div class="screen">${monthNav(key, 'ins')}<div class="stack ${ui.slide}" style="gap:18px">${summaryCard}${detail}${trendCard}${reportCard}</div></div>`;
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

// ---------- Transactions
function renderTransactions() {
  const items = ledger();
  const f = ui.tx;
  const q = f.search.trim().toLowerCase();
  const visible = items.filter((t) => {
    if (f.type === 'Income' && t.type !== 'Income') return false;
    if (f.type === 'Expense' && t.type !== 'Expense') return false;
    if (f.category && t.category !== f.category) return false;
    if (!q) return true;
    return (t.desc || '').toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.amount.toFixed(2).startsWith(q.replace(',', '.'));
  });
  const groups = new Map();
  for (const t of visible) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const days = [...groups.keys()].sort().reverse();
  const totals = visible.reduce((a, t) => { if (t.type === 'Income') a.i += t.amount; else a.e += t.amount; return a; }, { i: 0, e: 0 });
  const names = [...new Set(items.map((t) => t.category))].sort();
  const catOpts = `<option value="">All categories</option>` + names.map((n) => `<option value="${esc(n)}" ${n === f.category ? 'selected' : ''}>${esc(n)}</option>`).join('');

  const seg = `<div class="seg">${['All', 'Income', 'Expense'].map((v) => `<button class="${f.type === v ? 'on' : ''}" data-action="tx-type" data-value="${v}">${v}</button>`).join('')}</div>`;
  const tools = `<div class="toolbar-row"><label class="search">${icon('search')}<input type="search" placeholder="Search description, category or amount" value="${esc(f.search)}" data-action="tx-search" autocomplete="off"></label>
    <div class="select-wrap pill-btn icon-only ${f.category ? '' : ''}" style="color:${f.category ? 'var(--gold)' : 'var(--silver)'}">${icon('filter')}<select data-action="tx-category" aria-label="Filter by category">${catOpts}</select></div></div>`;
  const summary = `<p class="footer-note">${visible.length} ${visible.length === 1 ? 'transaction' : 'transactions'} · In ${money(totals.i)} · Out ${money(totals.e)}${f.category ? ` · <button data-action="tx-clear-category" class="gold">Clear filter: ${esc(f.category)}</button>` : ''}</p>`;

  let list = '';
  if (!days.length) {
    list = `<section class="card"><div class="empty">${icon(items.length ? 'search' : 'tray')}<h3>${items.length ? 'No matches' : 'No transactions yet'}</h3><p>${items.length ? 'Try a different search or filter.' : `Tap + to add your first ${esc(cur())} transaction.`}</p></div></section>`;
  } else {
    list = days.map((d) => {
      const rows = groups.get(d).sort((a, b) => b.createdAt - a.createdAt);
      const net = rows.reduce((a, t) => a + (t.type === 'Income' ? t.amount : -t.amount), 0);
      return `<div><div class="section-title"><span>${esc(A.fmtDayFull(d))}</span><span class="num">${signed(net)}</span></div><div class="rows">${rows.map(txRow).join('')}</div></div>`;
    }).join('');
  }
  return topbar('Transactions', currencyBtn(), addBtn()) + `<div class="screen">${seg}${tools}${summary}<div class="list">${list}</div></div>`;
}

function txRow(t) {
  const income = t.type === 'Income';
  return `<button class="row" data-action="edit" data-id="${t.id}"><span class="ic-wrap ${income ? 'income' : 'expense'}">${icon(A.iconFor(t.category))}</span>
    <div class="txt"><div class="t">${esc(t.desc || t.category)}</div><div class="s">${esc(t.category)}</div></div>
    <span class="amt num ${income ? 'income' : ''}">${income ? '+' : '−'}${money(t.amount, t.currency)}</span></button>`;
}

// ---------- Categories
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
    return `<div><div class="section-title"><span>${type}</span></div><div class="rows">${rows || '<div class="row muted">No categories</div>'}</div></div>`;
  };
  return topbar('Categories', '', `<button class="pill-btn icon-only" data-action="add-category" aria-label="Add category">${icon('plus')}</button>`)
    + `<div class="screen"><div class="list">${section('Expense')}${section('Income')}</div><p class="footer-note">The number is how many transactions use the category. Tap one to rename it, set a monthly budget, or delete it.</p></div>`;
}

// ---------- Settings
function renderSettings() {
  const st = store.settings;
  const counts = CURRENCIES.map((c) => ({ c, n: store.transactions.filter((t) => t.currency === c.code).length })).filter((x) => x.n > 0);
  const activeRules = store.rules.filter((r) => r.active).length;
  const curOpts = CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === cur() ? 'selected' : ''}>${c.name} (${c.code})</option>`).join('');
  const dayOpts = Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === st.reportDay ? 'selected' : ''}>${ordinal(d)}</option>`).join('');
  const lastExport = st.lastExport ? new Date(st.lastExport).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'never';

  const rules = store.rules.length ? store.rules.map((r) => `<div class="row"><span class="ic-wrap ${r.type === 'Income' ? 'income' : 'expense'}">${icon(A.iconFor(r.category))}</span>
      <div class="txt"><div class="t">${esc(r.desc || r.category)}</div><div class="s">${esc(r.category)} · ${money(r.amount, r.currency)} · ${r.frequency} · ${r.active ? 'next ' + esc(A.fmtDay(nextDue(r))) : 'paused'}</div></div>
      <button class="pill-btn" data-action="toggle-rule" data-id="${r.id}" style="color:${r.active ? 'var(--silver)' : 'var(--gold)'}">${r.active ? 'Pause' : 'Resume'}</button>
      <button class="pill-btn icon-only" data-action="delete-rule" data-id="${r.id}" aria-label="Delete rule" style="color:var(--warn)">${icon('trash')}</button></div>`).join('')
    : `<div class="row muted">No recurring transactions. Choose Repeat when adding rent, salary or a subscription.</div>`;

  return topbar('Settings') + `<div class="screen"><div class="list">
    <div><div class="section-title"><span>Currency</span></div><div class="rows">
      <label class="row setting">${icon('swap')}<span class="grow">Currency</span><select data-action="set-currency">${curOpts}</select></label></div>
      <p class="footer-note">Every transaction remembers its own currency and amounts are never converted. The dashboard shows the currency chosen here.</p></div>

    <div><div class="section-title"><span>Automation</span></div><div class="rows">
      <label class="row setting">${icon('doc')}<span class="grow">Monthly report reminder</span><input type="checkbox" data-action="toggle-reports" ${st.reportsEnabled ? 'checked' : ''}></label>
      ${st.reportsEnabled ? `<label class="row setting">${icon('calendar')}<span class="grow">Remind me on the</span><select data-action="set-report-day">${dayOpts}</select></label>` : ''}
    </div><p class="footer-note">${reportScheduleText()}</p></div>

    <div><div class="section-title"><span>Recurring transactions</span><span>${activeRules} active</span></div><div class="rows">${rules}</div>
      <p class="footer-note">Due entries are added when you open the app. Resuming a paused rule restarts it one period from today.</p></div>

    <div><div class="section-title"><span>Security</span></div><div class="rows">
      <label class="row setting">${icon('lock')}<span class="grow">Require a PIN to open</span><input type="checkbox" data-action="toggle-pin" ${st.pinHash ? 'checked' : ''}></label></div>
      <p class="footer-note">A 4–6 digit code asked every time the app opens. There is no way to recover a forgotten PIN; you would have to clear the app's data.</p></div>

    <div><div class="section-title"><span>Data</span></div><div class="rows">
      <button class="row setting" data-action="export-csv">${icon('share')}<span class="grow">Export to CSV</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="import-csv">${icon('arrowIn')}<span class="grow">Import from CSV (Excel sheet)</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="export-backup">${icon('doc')}<span class="grow">Save full backup</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting" data-action="import-backup">${icon('refresh')}<span class="grow">Restore from backup</span><span class="value">${icon('chevR')}</span></button>
      <button class="row setting danger" data-action="erase">${icon('trash')}<span class="grow">Erase all transactions</span></button></div>
      <p class="footer-note">Last export: ${lastExport}. Your data lives only in this browser on this phone — clearing Safari's website data deletes it, so save a backup to Files or iCloud Drive regularly. Import skips entries that are already here.</p>
      <input type="file" id="file-csv" accept=".csv,text/csv,text/plain" class="hidden"><input type="file" id="file-json" accept=".json,application/json" class="hidden"></div>

    <div><div class="section-title"><span>About</span></div><div class="rows">
      ${counts.map((x) => `<div class="row setting"><span class="grow">${x.c.code} transactions</span><span class="value num">${x.n}</span></div>`).join('')}
      <div class="row setting"><span class="grow">All transactions</span><span class="value num">${store.transactions.length}</span></div>
      <div class="row setting"><span class="grow">Version</span><span class="value">1.0 (web)</span></div></div>
      <p class="footer-note">Everything is stored on this device only. Nothing is sent anywhere.</p></div>
  </div></div>`;
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

// ---------- Report (printable)
function renderReport(key) {
  const items = ledger();
  const ins = A.insights(items, store.categories, key, cur());
  const s = ins.summary;
  const m = (v) => money(v);
  const catTable = (title, totals, total) => `<h3>${title}</h3><table>${totals.map((t) => `<tr><td style="width:40%">${esc(t.name)}</td><td><div class="rbar"><div style="width:${(t.share * 100).toFixed(1)}%"></div></div></td><td class="m" style="width:44px;text-align:right">${A.fmtPct(t.share)}</td><td class="r" style="width:100px">${m(t.total)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td></td><td class="r">${m(total)}</td></tr></table>`;
  const largest = items.filter((t) => A.inMonth(t, key) && t.type === 'Expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  const link = location.href.split('#')[0] + '#report-' + A.keyStr(key);
  const actions = standalone
    ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">${icon('share')} Open in Safari to save as PDF</a>`
    : `<button class="btn primary" data-action="print-report">${icon('share')} Share / Save as PDF</button>`;
  return `<div class="report-wrap"><div class="report-actions"><button class="btn secondary" data-action="close-report">${icon('x')} Close</button>${actions}</div>
  <div class="report">
    <div class="eyebrow">Expense Tracker</div><h1>${esc(A.keyTitle(key))}</h1><div class="meta">Monthly report · ${esc(cur())} · generated ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
    <div class="totals"><div><div class="l">Income</div><div class="v gold">${m(s.income)}</div></div><div><div class="l">Expense</div><div class="v slate">${m(s.expense)}</div></div><div><div class="l">${s.balance >= 0 ? 'Left over' : 'Overspent'}</div><div class="v ${s.balance >= 0 ? 'gold' : 'red'}">${signed(s.balance)}</div></div><div><div class="l">Transactions</div><div class="v">${s.count}</div></div></div>
    <h3>Summary</h3><p>${esc(ins.sentences.join(' '))}</p>
    ${s.expenseByCategory.length ? catTable('Expenses by category', s.expenseByCategory, s.expense) : ''}
    ${s.incomeByCategory.length ? catTable('Income by category', s.incomeByCategory, s.income) : ''}
    ${ins.budgets.length ? `<h3>Budgets</h3><table>${ins.budgets.map((b) => `<tr><td style="width:40%">${esc(b.name)}</td><td class="m">${m(b.spent)} of ${m(b.limit)}</td><td class="r ${b.ratio > 1 ? 'red' : 'gold'}">${b.ratio > 1 ? 'Over by ' + m(-b.remaining) : 'Within budget'}</td></tr>`).join('')}</table>` : ''}
    <h3>Balance, last six months</h3><table>${ins.balanceTrend.map((p) => `<tr><td>${esc(A.keyTitle(p.key))}</td><td class="m">in ${m(p.income)} · out ${m(p.expense)}</td><td class="r ${p.balance >= 0 ? 'gold' : 'red'}">${signed(p.balance)}</td></tr>`).join('')}</table>
    <h3>Largest expenses</h3><table>${largest.map((t) => `<tr><td class="m" style="width:60px">${esc(A.fmtDay(t.date))}</td><td>${esc(t.desc || t.category)}</td><td class="m">${esc(t.category)}</td><td class="r">${m(t.amount)}</td></tr>`).join('')}</table>
    <p class="meta" style="margin-top:16px">Amounts are in ${esc(cur())}. Transactions in other currencies are not included.</p>
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
  setTimeout(() => { $('#sheet-backdrop').classList.add('hidden'); $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; sheetState = null; }, 320);
}

function txForm({ tx = null, prefill = null, defaultRepeat = '' } = {}) {
  const editing = !!tx;
  const type = tx?.type || prefill?.type || 'Expense';
  const v = {
    type, amount: tx ? tx.amount.toFixed(2) : prefill ? prefill.amount.toFixed(2) : '', category: tx?.category || prefill?.category || '',
    date: tx?.date || todayISO(), desc: tx?.desc || prefill?.desc || '', currency: tx?.currency || prefill?.currency || cur(), repeat: defaultRepeat,
  };
  sheetState = { kind: 'tx', id: tx?.id || null, values: v };
  renderTxForm();
}

function renderTxForm() {
  const st = sheetState;
  const v = st.values;
  const editing = !!st.id;
  const names = store.categoryNames(v.type);
  if (!v.category || (!names.includes(v.category))) { if (names.includes(v.category)) {} else if (!v.category) v.category = names[0] || ''; }
  const catList = names.includes(v.category) || !v.category ? names : [...names, v.category];
  const suggestions = suggestionsFor(v);
  const html = `<div class="sheet-head"><button class="cancel" data-action="sheet-cancel">Cancel</button><h2>${editing ? 'Edit transaction' : 'New transaction'}</h2><button class="save" data-action="sheet-save" ${canSaveTx(v) ? '' : 'disabled'}>Save</button></div>
  <div class="sheet-body">
    <div class="seg">${['Expense', 'Income'].map((t) => `<button class="${v.type === t ? 'on' : ''}" data-action="f-type" data-value="${t}">${t}</button>`).join('')}</div>
    <div class="field"><label>Amount</label><div class="control"><input class="amount num" inputmode="decimal" placeholder="0.00" value="${esc(v.amount)}" data-field="amount" ${editing ? '' : 'autofocus'}>
      <select data-field="currency" aria-label="Currency" style="flex:0 0 auto">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === v.currency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div></div>
    <div class="field"><label>Category</label><div class="control">${icon('tag')}<select data-field="category">${catList.length ? catList.map((n) => `<option value="${esc(n)}" ${n === v.category ? 'selected' : ''}>${esc(n)}</option>`).join('') : '<option value="">No categories — add one in Categories</option>'}</select>${icon('chevD')}</div></div>
    <div class="field"><label>Date</label><div class="control">${icon('calendar')}<input type="date" value="${v.date}" data-field="date"></div></div>
    <div class="field"><label>Description (optional)</label><div class="control"><input value="${esc(v.desc)}" data-field="desc" placeholder="What was it?" autocomplete="off"></div>
      ${suggestions.length ? `<div class="suggest">${suggestions.map((s) => `<button data-action="f-suggest" data-value="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>
    ${editing ? '' : `<div class="field"><label>Repeat</label><div class="control">${icon('refresh')}<select data-field="repeat"><option value="" ${!v.repeat ? 'selected' : ''}>Never</option><option value="Weekly" ${v.repeat === 'Weekly' ? 'selected' : ''}>Weekly</option><option value="Monthly" ${v.repeat === 'Monthly' ? 'selected' : ''}>Monthly</option></select>${icon('chevD')}</div>
      <div class="hint">${v.repeat ? `Recorded on the chosen date, then added automatically every ${v.repeat === 'Weekly' ? 'week' : 'month'}. Manage it under Settings.` : 'Choose Weekly or Monthly for things like rent, salary or subscriptions.'}</div></div>`}
    ${editing ? `<button class="btn secondary block" data-action="f-repeat-today">${icon('refresh')} Add again for today</button><button class="btn danger block" data-action="f-delete">Delete transaction</button>` : ''}
  </div>`;
  if ($('#sheet').classList.contains('hidden')) openSheet(html, st); else { $('#sheet').innerHTML = `<div class="grab"></div>${html}`; }
}

function canSaveTx(v) { const a = parseFloat(String(v.amount).replace(',', '.')); return a > 0 && !!v.category && !!v.date; }

function suggestionsFor(v) {
  if (!v.category) return [];
  const counts = new Map();
  for (const t of store.transactions) if (t.category === v.category && t.type === v.type && t.desc) counts.set(t.desc, (counts.get(t.desc) || 0) + 1);
  const typed = (v.desc || '').trim().toLowerCase();
  return [...counts.entries()].filter(([d]) => d.toLowerCase() !== typed && (!typed || d.toLowerCase().includes(typed)))
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1])).slice(0, 6).map(([d]) => d);
}

function saveTx() {
  const st = sheetState; const v = st.values;
  const amount = parseFloat(String(v.amount).replace(',', '.'));
  if (!(amount > 0) || !v.category) return;
  const data = { type: v.type, amount, category: v.category, date: v.date, desc: (v.desc || '').trim(), currency: v.currency };
  if (st.id) store.updateTransaction(st.id, data);
  else {
    store.addTransaction(data);
    if (v.repeat) store.addRule({ type: v.type, category: v.category, amount, desc: data.desc, currency: v.currency, frequency: v.repeat, startDate: v.date });
  }
  const warning = budgetWarning(data, st.id);
  closeSheet();
  toast(warning || (st.id ? 'Saved' : 'Added ' + money(amount, v.currency)));
}

function budgetWarning(data, excludeId) {
  if (data.type !== 'Expense') return null;
  const cat = store.categories.find((c) => c.type === 'Expense' && c.name === data.category && c.budget > 0 && c.budgetCurrency === data.currency);
  if (!cat) return null;
  const key = A.keyOf(data.date);
  // the saved transaction is already in the store, so sum everything in that month and category
  const sum = store.transactions
    .filter((t) => t.type === 'Expense' && t.category === data.category && t.currency === data.currency && A.inMonth(t, key))
    .reduce((a, t) => a + t.amount, 0);
  if (sum > cat.budget) return `${data.category} is over budget by ${money(sum - cat.budget, data.currency)}`;
  if (sum >= cat.budget * 0.9) return `${data.category}: ${money(cat.budget - sum, data.currency)} of this month's budget left`;
  return null;
}

function categoryForm(cat = null) {
  const v = { name: cat?.name || '', type: cat?.type || 'Expense', budget: cat && cat.budget > 0 ? cat.budget.toFixed(2) : '', budgetCurrency: cat?.budgetCurrency || cur() };
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
  if ($('#sheet').classList.contains('hidden')) openSheet(html, st); else $('#sheet').innerHTML = `<div class="grab"></div>${html}`;
}
function saveCategory() {
  const st = sheetState, v = st.values;
  const name = v.name.trim(); if (!name) return;
  const budget = v.type === 'Expense' ? (parseFloat(String(v.budget).replace(',', '.')) || 0) : 0;
  if (st.id) store.updateCategory(st.id, { name, budget, budgetCurrency: v.budgetCurrency });
  else store.addCategory({ name, type: v.type, budget, budgetCurrency: v.budgetCurrency });
  closeSheet(); toast('Saved');
}

// ---------- PIN lock
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('et-pin:' + text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let pinEntry = '';
let pinMode = null; // 'unlock' | 'set' | 'confirm' | 'disable'
let pinFirst = '';

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
    const h = await sha(pinEntry);
    if (h === store.settings.pinHash) {
      if (pinMode === 'disable') { store.setSetting('pinHash', null); toast('PIN removed'); }
      hideLock(); render();
    } else if (pinEntry.length === 6) {
      $('#pin-err').textContent = 'Wrong PIN'; pinEntry = ''; renderDots();
    }
  }
}

// ---------- events
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
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
  else if (a === 'show-category') { ui.tx = { search: '', type: 'All', category: btn.dataset.category }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); }
  else if (a === 'show-category-all') { ui.tx = { search: '', type: 'Expense', category: '' }; ui.tab = 'transactions'; render(); window.scrollTo(0, 0); }
  else if (a === 'tx-type') { ui.tx.type = btn.dataset.value; render(); }
  else if (a === 'tx-clear-category') { ui.tx.category = ''; render(); }
  else if (a === 'add-category') categoryForm();
  else if (a === 'edit-category') { const c = store.categories.find((x) => x.id === btn.dataset.id); if (c) categoryForm(c); }
  else if (a === 'sheet-cancel') closeSheet();
  else if (a === 'sheet-save') { if (sheetState?.kind === 'tx') saveTx(); else if (sheetState?.kind === 'cat') saveCategory(); }
  else if (a === 'f-type') { const v = sheetState.values; if (v.type !== btn.dataset.value) { v.type = btn.dataset.value; v.category = store.categoryNames(v.type)[0] || ''; } renderTxForm(); }
  else if (a === 'f-ctype') { sheetState.values.type = btn.dataset.value; renderCategoryForm(); }
  else if (a === 'f-suggest') { sheetState.values.desc = btn.dataset.value; renderTxForm(); }
  else if (a === 'f-delete') { if (await ask('Delete this transaction?')) { store.deleteTransaction(sheetState.id); closeSheet(); toast('Deleted'); } }
  else if (a === 'f-repeat-today') { const t = store.transactions.find((x) => x.id === sheetState.id); if (t) { store.addTransaction({ type: t.type, category: t.category, amount: t.amount, desc: t.desc, currency: t.currency, date: todayISO() }); closeSheet(); toast('Added again for today'); } }
  else if (a === 'f-delete-category') { const c = store.categories.find((x) => x.id === sheetState.id); if (c && await ask(`Transactions already filed under "${c.name}" keep the name. You just won't be able to pick it for new ones.`, { title: 'Delete this category?' })) { store.deleteCategory(c.id); closeSheet(); toast('Deleted'); } }
  else if (a === 'toggle-rule') { const r = store.rules.find((x) => x.id === btn.dataset.id); if (r) { if (r.active) store.updateRule(r.id, { active: false }); else store.updateRule(r.id, { active: true, startDate: todayISO(), occurrences: 0 }); } }
  else if (a === 'delete-rule') { if (await ask('Transactions already added are kept.', { title: 'Delete this recurring rule?' })) store.deleteRule(btn.dataset.id); }
  else if (a === 'export-csv') download(`ExpenseTracker-${todayISO()}.csv`, exportCSV(store.transactions), 'text/csv');
  else if (a === 'export-backup') download(`ExpenseTracker-backup-${todayISO()}.json`, store.exportBackup(), 'application/json');
  else if (a === 'import-csv') $('#file-csv').click();
  else if (a === 'import-backup') $('#file-json').click();
  else if (a === 'erase') { if (await ask('Every transaction, in every currency, is removed from this phone. Categories are kept. This cannot be undone.', { title: 'Erase all transactions?', confirmText: 'Erase' })) { store.eraseAllTransactions(); toast('All transactions erased'); } }
  else if (a === 'open-report') { ui.report = btn.dataset.key; render(); }
  else if (a === 'close-report') { ui.report = null; if (location.hash) history.replaceState(null, '', location.pathname); render(); }
  else if (a === 'print-report') window.print();
  else if (a === 'dismiss-report-banner') { const seen = store.settings.reportsSeen || []; seen.push(btn.dataset.key); store.setSetting('reportsSeen', seen); }
  else if (a === 'open-report-banner') { const seen = store.settings.reportsSeen || []; seen.push(btn.dataset.key); store.state.settings.reportsSeen = seen; const [y, m] = btn.dataset.key.split('-').map(Number); ui.insightsMonth = { year: y, month: m }; ui.report = btn.dataset.key; store.commit(); }
  else if (a === 'dismiss-backup-banner') store.setSetting('lastBackupPrompt', Date.now());
  else if (a === 'pin') await pinPress(btn.dataset.value);
  else if (a === 'pin-back') { pinEntry = pinEntry.slice(0, -1); renderDots(); }
  else if (a === 'pin-cancel') { if (pinMode !== 'unlock') { hideLock(); render(); } }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.field && sheetState) {
    sheetState.values[el.dataset.field] = el.value;
    if (el.dataset.field === 'desc') { /* refresh suggestions without losing focus */ const box = el.closest('.field').querySelector('.suggest'); const s = suggestionsFor(sheetState.values); if (box) box.innerHTML = s.map((x) => `<button data-action="f-suggest" data-value="${esc(x)}">${esc(x)}</button>`).join(''); }
    const save = $('#sheet .save');
    if (save) save.disabled = sheetState.kind === 'tx' ? !canSaveTx(sheetState.values) : !(sheetState.values.name || '').trim();
  }
  if (el.dataset.action === 'tx-search') { ui.tx.search = el.value; renderList(); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const a = el.dataset.action;
  if (el.dataset.field && sheetState) {
    sheetState.values[el.dataset.field] = el.value;
    if (['category', 'repeat', 'currency'].includes(el.dataset.field) && sheetState.kind === 'tx') renderTxForm();
  }
  if (a === 'set-currency') { store.setSetting('currency', el.value); }
  else if (a === 'pick-month') { const [y, m] = el.value.split('-').map(Number); if (y && m) { if (el.dataset.scope === 'ins') ui.insightsMonth = { year: y, month: m }; else ui.month = { year: y, month: m }; render(); } }
  else if (a === 'tx-category') { ui.tx.category = el.value; render(); }
  else if (a === 'toggle-reports') { store.setSetting('reportsEnabled', el.checked); }
  else if (a === 'set-report-day') { store.setSetting('reportDay', +el.value); }
  else if (a === 'toggle-pin') {
    if (el.checked) { setPinFlow(); } else { showLock('disable', 'Enter your PIN to turn it off'); }
  }
  else if (el.id === 'file-csv' && el.files[0]) {
    const text = await readFile(el.files[0]); el.value = '';
    const parsed = parseCSV(text);
    if (!parsed.foundHeader) { await notify('No transactions found. The file needs a header row with at least Date and Amount columns.', 'Import'); return; }
    const r = store.insertRows(parsed.rows, cur());
    adoptCurrency(); ui.pickedInitial = false; render();
    await notify(`Added ${r.added} transactions.${r.duplicates ? ` ${r.duplicates} were already here.` : ''}${parsed.skipped ? ` ${parsed.skipped} rows could not be read.` : ''}`, 'Import');
  }
  else if (el.id === 'file-json' && el.files[0]) {
    const text = await readFile(el.files[0]); el.value = '';
    try { const r = store.restoreBackup(text); adoptCurrency(); ui.pickedInitial = false; render(); await notify(`Restored ${r.transactions} transactions, ${r.categories} categories and ${r.rules} recurring rules.`, 'Restore'); }
    catch (err) { await notify(err.message || 'That file is not an Expense Tracker backup.', 'Restore'); }
  }
});

function setPinFlow() {
  // two-step: enter, then confirm. Implemented with a tiny state machine on the lock screen.
  showLock('set', 'Choose a 4–6 digit PIN');
  let first = '';
  const handler = async (e) => {
    const b = e.target.closest('[data-action="pin"]'); const done = e.target.closest('[data-action="pin-done"]');
    if (!b && !done) return;
    e.stopImmediatePropagation();
    if (b) { if (pinEntry.length < 6) { pinEntry += b.dataset.value; renderDots(); } if (pinEntry.length >= 4) $('#pin-done')?.classList.remove('hidden'); }
    if (done) {
      if (!first) { first = pinEntry; pinEntry = ''; $('#lock h2').textContent = 'Enter it again'; renderDots(); $('#pin-done').classList.add('hidden'); }
      else if (first === pinEntry) { store.setSetting('pinHash', await sha(first)); document.removeEventListener('click', handler, true); hideLock(); toast('PIN set'); render(); }
      else { $('#pin-err').textContent = 'The PINs did not match'; first = ''; pinEntry = ''; $('#lock h2').textContent = 'Choose a 4–6 digit PIN'; renderDots(); }
    }
  };
  document.addEventListener('click', handler, true);
  const cancel = $('#lock [data-action="pin-cancel"]');
  cancel.addEventListener('click', () => { document.removeEventListener('click', handler, true); render(); }, { once: true });
  $('#lock .keypad').insertAdjacentHTML('afterend', `<button id="pin-done" class="btn primary hidden" data-action="pin-done">Use this PIN</button>`);
}

function readFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); }); }

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  store.setSetting('lastExport', Date.now());
  toast('Use "Save to Files" to keep it in iCloud Drive');
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
    out += `<div class="banner">${icon('shield')}<div class="txt">It's been a while since your last backup. Save one to Files or iCloud Drive.</div><button data-action="go" data-tab="settings">Backup</button><button class="muted" data-action="dismiss-backup-banner">${icon('x')}</button></div>`;
  }
  return out;
}

// ---------- render
function renderList() {
  // re-render only the list part of Transactions to keep the search box focused
  const screen = $('#app .screen');
  if (!screen || ui.tab !== 'transactions') return;
  const temp = document.createElement('div'); temp.innerHTML = renderTransactions();
  const newList = temp.querySelector('.list'), newNote = temp.querySelector('.footer-note');
  screen.querySelector('.list').replaceWith(newList);
  screen.querySelector('.footer-note').replaceWith(newNote);
}

function render() {
  const app = $('#app');
  if (ui.report) { app.innerHTML = renderReport({ year: +ui.report.slice(0, 4), month: +ui.report.slice(5, 7) }); $('#tabbar').classList.add('hidden'); return; }
  $('#tabbar').classList.remove('hidden');
  const screens = { dashboard: renderDashboard, insights: renderInsights, transactions: renderTransactions, categories: renderCategories, settings: renderSettings };
  let html = screens[ui.tab]();
  const b = banners();
  if (b) html = html.replace('<div class="screen">', `<div class="screen"><div class="stack">${b}</div>`);
  app.innerHTML = html;
  for (const t of $('#tabbar').querySelectorAll('button')) t.classList.toggle('on', t.dataset.tab === ui.tab);
}

store.subscribe(() => { if (!sheetState) render(); else { /* keep sheet; refresh underlying later */ } });

function openFromHash() {
  const m = location.hash.match(/^#report-(\d{4})-(\d{2})$/);
  if (m) { ui.report = `${m[1]}-${m[2]}`; ui.insightsMonth = { year: +m[1], month: +m[2] }; ui.tab = 'insights'; return true; }
  return false;
}

function init() {
  // The backup reminder starts counting from the first launch, not from the beginning of time.
  if (!store.settings.lastBackupPrompt) store.state.settings.lastBackupPrompt = Date.now();
  const added = processRecurring();
  if (added) setTimeout(() => toast(`${added} recurring ${added === 1 ? 'transaction' : 'transactions'} added`), 600);
  $('#tabbar').innerHTML = [['dashboard', 'pie', 'Dashboard'], ['insights', 'sparkles', 'Insights'], ['transactions', 'list', 'Transactions'], ['categories', 'grid', 'Categories'], ['settings', 'gear', 'Settings']]
    .map(([t, i, l]) => `<button data-action="go" data-tab="${t}" class="${t === ui.tab ? 'on' : ''}">${icon(i)}<span>${l}</span></button>`).join('');
  openFromHash();
  render();
  window.addEventListener('hashchange', () => { if (openFromHash()) render(); });
  if (store.settings.pinHash) { ui.locked = true; showLock('unlock', 'Enter your PIN'); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { const n = processRecurring(); if (n) toast(`${n} recurring added`); if (store.settings.pinHash && !ui.locked && pinMode === null) { /* re-lock when coming back after a while */ if (Date.now() - (init.hidAt || 0) > 60000) { ui.locked = true; showLock('unlock', 'Enter your PIN'); } } }
    else init.hidAt = Date.now();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init();
