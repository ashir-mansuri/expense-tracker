// The "Add by typing" card on Home: type a few words or paste a bank SMS, see what was understood, tap Add.
import { store, todayISO } from './store.js';
import { icon } from './icons.js';
import { fmtMoney, fmtDay } from './analytics.js';
import { buildIndex } from './categorize.js';
import { readText } from './quick.js';
import { markDuplicates } from './statement.js';
import { repayPlan } from './owed.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (sel, root = document) => root.querySelector(sel);

let draft = '';
let items = [];
let kind = 'empty';
let hint = '';
let hooks = { toast: () => {}, edit: () => {} };
let idx = null, idxKey = '';
let timer = null;
const chosen = new Map(); // category picked by hand, kept while the words are edited

const dollarFirst = () => ['USD', 'CAD'].includes(store.settings.currency);

function index() {
  const key = `${store.transactions.length}:${Object.keys(store.merchants).length}`;
  if (!idx || key !== idxKey) { idx = buildIndex(store.transactions, store.merchants); idxKey = key; }
  return idx;
}

function context() {
  return { today: todayISO(), currency: store.settings.currency, dayFirst: !dollarFirst(), categories: store.categories, index: index() };
}

function parse() {
  const r = readText(draft, context());
  kind = r.kind;
  hint = r.hint || '';
  items = r.items;
  if (kind === 'sms') {
    const rows = items.filter((i) => i.kind === 'tx');
    markDuplicates(rows, store.transactions);
    const seen = new Set();
    for (const it of rows) {
      if (!it.ref) continue;
      const k = `${it.currency}|${it.type}|${Math.round(it.amount * 100)}|${it.ref}`;
      if (seen.has(k) && !it.dup) it.dup = 'twice'; // the same message pasted twice
      seen.add(k);
    }
    for (const it of rows) if (it.dup) { it.off = true; it.dupNote = it.dup === 'same' ? 'Already in your list' : it.dup === 'twice' ? 'Same message as one above' : 'Looks like one you already have'; }
  }
  for (const it of items) {
    const pick = it.kind === 'tx' && it.key ? chosen.get(`${it.type}|${it.key}`) : null;
    if (pick && store.categoryNames(it.type).includes(pick)) { it.category = pick; it.unsure = false; it.touched = true; }
  }
  for (const it of items) {
    if (it.kind !== 'repay') continue;
    const plan = repayPlan(store.owed, it.repay.person, it.amount, it.currency);
    it.outstanding = plan.outstanding; it.leftover = plan.leftover;
    if (!plan.parts.length) { it.off = true; it.locked = true; it.problem = `${it.repay.person} does not owe you anything yet.`; }
  }
}

function dayLabel(date) {
  const today = todayISO();
  if (date === today) return 'Today';
  const y = new Date(today + 'T00:00'); y.setDate(y.getDate() - 1);
  if (date === `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`) return 'Yesterday';
  return fmtDay(date) + (date.slice(0, 4) !== today.slice(0, 4) ? ' ' + date.slice(0, 4) : '');
}

function itemHTML(it, i) {
  const out = it.type === 'Expense';
  const names = store.categoryNames(it.type);
  const catList = names.includes(it.category) || !it.category ? names : [...names, it.category];
  const pill = it.kind === 'tx'
    ? `<span class="select-wrap e-cat ${it.unsure ? 'check' : ''}">${esc(it.category || 'Choose')}${icon('chevD', 'ic-sm')}<select data-e="cat" data-i="${i}" aria-label="Category">${catList.map((n) => `<option value="${esc(n)}" ${n === it.category ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></span>`
    : '';
  const notes = [];
  if (it.kind === 'debt') notes.push(`${esc(it.owe[0].person)} owes you ${fmtMoney(it.owe[0].amount, it.currency)}. Nothing is added to your spending.`);
  else if (it.kind === 'repay') notes.push(it.problem ? esc(it.problem) : `Marks off what ${esc(it.repay.person)} owes you and adds it to Money in${it.leftover > 0.004 ? `. ${fmtMoney(it.leftover, it.currency)} more than they owed is left out` : ` (${fmtMoney(it.outstanding, it.currency)} outstanding)`}`);
  else for (const o of it.owe || []) notes.push(`${esc(o.person)} owes you ${fmtMoney(o.amount, it.currency)}`);
  if (it.dupNote) notes.push(esc(it.dupNote));
  const title = it.kind === 'repay' ? `${esc(it.repay.person)} paid you back` : it.kind === 'debt' ? `${esc(it.owe[0].person)} owes you` : esc(it.name || (out ? 'Spending' : 'Money in'));
  const amt = it.kind === 'tx' ? `<span class="e-amt ${out ? '' : 'in'}">${out ? '−' : '+'}${fmtMoney(it.amount, it.currency)}</span>` : `<span class="e-amt">${fmtMoney(it.amount, it.currency)}</span>`;
  return `<div class="e-item ${it.off ? 'off' : ''}">
    <div class="e-main">
      <div class="e-top"><span class="e-name">${title}</span>${amt}</div>
      <div class="e-sub">${pill}${pill ? '<span class="dot-sep"></span>' : ''}<span>${esc(dayLabel(it.date))}</span></div>
      ${notes.length ? `<div class="e-note ${it.problem ? 'bad' : ''}">${notes.join('<br>')}</div>` : ''}
    </div>
    ${it.dupNote && !it.locked ? `<button class="e-link" data-e="force" data-i="${i}">${it.off ? 'Add anyway' : 'Skip'}</button>` : ''}
    <button class="e-x" data-e="drop" data-i="${i}" aria-label="Remove">${icon('x')}</button>
  </div>`;
}

function previewHTML() {
  if (!draft.trim()) return `<div class="e-hint">${icon('mic', 'ic-sm')} Tap the microphone on your keyboard to speak.</div>`;
  if (!items.length) return `<div class="e-hint">${esc(hint || 'I could not find an amount. Try “250 chai” or paste the message from your bank.')}</div>`;
  const active = items.filter((i) => !i.off);
  const label = active.length === 0 ? 'Nothing to add'
    : active.length === 1 ? (active[0].kind === 'repay' ? 'Mark as paid back' : active[0].kind === 'debt' ? 'Add to Who owes me' : `Add ${fmtMoney(active[0].amount, active[0].currency)}`)
      : `Add ${active.length} entries`;
  const single = items.length === 1 && items[0].kind === 'tx';
  return `<div class="e-list">${items.map(itemHTML).join('')}</div>
    <div class="e-actions"><button class="btn primary" data-e="add" ${active.length ? '' : 'disabled'}>${esc(label)}</button>
    ${single ? `<button class="btn secondary" data-e="more">More details</button>` : ''}</div>`;
}

export function entryHTML() {
  if (draft) parse();
  return `<section class="card entry" id="entry"><div class="card-head"><h2>Add by typing</h2>${draft ? `<button class="link-btn" style="width:auto" data-e="clear">Clear</button>` : ''}</div>
    <textarea id="entry-text" rows="1" placeholder="Type “250 chai” or paste a bank SMS" aria-label="Add by typing or pasting" autocapitalize="sentences" autocomplete="off" spellcheck="false">${esc(draft)}</textarea>
    <div id="entry-preview">${previewHTML()}</div></section>`;
}

function repaint() {
  const box = $('#entry-preview'); if (box) box.innerHTML = previewHTML();
  const head = $('#entry .card-head'); if (head) head.innerHTML = `<h2>Add by typing</h2>${draft ? `<button class="link-btn" style="width:auto" data-e="clear">Clear</button>` : ''}`;
}

function grow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 180) + 'px'; }

function reset() { chosen.clear(); draft = ''; items = []; kind = 'empty'; const t = $('#entry-text'); if (t) { t.value = ''; grow(t); } repaint(); }

function addAll() {
  const active = items.filter((i) => !i.off);
  if (!active.length) return;
  const addedTx = [], addedOwed = [], repays = [];
  const accounts = store.accounts;
  const last = store.settings.lastAccount;
  let text = '';
  draft = ''; items = []; chosen.clear(); // the card empties itself while the rows are saved
  for (const it of active) {
    if (it.kind === 'tx') {
      const acc = last && accounts.find((a) => a.id === last && a.currency === it.currency) ? last : undefined;
      const tx = store.addTransaction({ type: it.type, category: it.category, amount: it.amount, currency: it.currency, date: it.date, desc: it.name || '', time: it.time || undefined, ref: it.ref || undefined, raw: it.raw || undefined, account: acc });
      addedTx.push(tx.id);
      for (const o of it.owe || []) addedOwed.push(store.addOwed({ person: o.person, amount: o.amount, currency: it.currency, date: it.date, note: it.lentTo ? '' : it.name, txId: tx.id }).id);
      if (it.touched && it.key) store.learnMerchant(it.key, it.type, it.category);
    } else if (it.kind === 'debt') {
      for (const o of it.owe) addedOwed.push(store.addOwed({ person: o.person, amount: o.amount, currency: it.currency, date: it.date, note: '' }).id);
    } else if (it.kind === 'repay') {
      // the money really came in, so it is also recorded under Money in; this cancels out what was lent
      const plan = repayPlan(store.owed, it.repay.person, it.amount, it.currency);
      const got = Math.round((it.amount - plan.leftover) * 100) / 100;
      if (got <= 0) continue;
      const tx = store.addTransaction({ type: 'Income', category: store.paidBackCategory(), amount: got, currency: it.currency, date: it.date, desc: `Paid back by ${it.repay.person}` });
      addedTx.push(tx.id);
      repays.push(store.repay(it.repay.person, got, { date: it.date, currency: it.currency, txId: tx.id }));
    }
  }
  const one = active.length === 1 ? active[0] : null;
  if (one && one.kind === 'tx') text = `Added ${fmtMoney(one.amount, one.currency)}${one.name ? ' · ' + one.name : ''}`;
  else if (one && one.kind === 'repay') text = `${one.repay.person} paid back ${fmtMoney(repays[0]?.applied ?? one.amount, one.currency)}`;
  else if (one && one.kind === 'debt') text = `${one.owe[0].person} owes you ${fmtMoney(one.amount, one.currency)}`;
  else text = `Added ${active.length} entries`;
  hooks.toast(text, {
    label: 'Undo',
    fn: () => {
      for (const id of addedOwed) store.deleteOwed(id);
      for (const r of repays) store.undoRepay(r.before);
      for (const id of addedTx) store.deleteTransaction(id);
      hooks.toast('Removed');
    },
  });
  const t = $('#entry-text'); if (t) { t.value = ''; grow(t); }
  repaint();
}

export function initEntry(h) {
  hooks = { ...hooks, ...h };
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'entry-text') return;
    draft = e.target.value;
    grow(e.target);
    clearTimeout(timer);
    timer = setTimeout(() => { parse(); repaint(); }, 120);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id !== 'entry-text' || e.key !== 'Enter' || e.shiftKey) return;
    if (kind === 'sms' || /\n/.test(e.target.value)) return; // pasted messages keep their line breaks
    e.preventDefault();
    clearTimeout(timer); draft = e.target.value; parse(); repaint(); addAll();
  });
  document.addEventListener('focusin', (e) => { if (e.target.id === 'entry-text') grow(e.target); });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.e !== 'cat') return;
    const it = items[+el.dataset.i]; if (!it) return;
    it.category = el.value; it.unsure = false; it.touched = true;
    if (it.key) chosen.set(`${it.type}|${it.key}`, el.value);
    const pill = el.closest('.e-cat'); if (pill) { pill.classList.remove('check'); pill.firstChild.textContent = el.value; }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-e]');
    if (!b || b.tagName === 'SELECT') return;
    const a = b.dataset.e, i = +b.dataset.i;
    if (a === 'add') addAll();
    else if (a === 'clear') reset();
    else if (a === 'drop') { items.splice(i, 1); if (!items.length) { draft = ''; const t = $('#entry-text'); if (t) { t.value = ''; grow(t); } } repaint(); }
    else if (a === 'force') { if (items[i]) { items[i].off = !items[i].off; repaint(); } }
    else if (a === 'more') {
      const it = items[0]; if (!it) return;
      const last = store.settings.lastAccount;
      const prefill = { keepDate: true, time: it.time || '', account: last && store.accounts.some((a) => a.id === last) ? last : '', type: it.type, amount: it.amount, desc: it.name, category: it.category, currency: it.currency, date: it.date, owe: it.owe && it.owe[0] ? { person: it.owe[0].person, amount: String(it.owe[0].amount.toFixed(2)) } : null };
      reset();
      hooks.edit(prefill);
    }
  });
}
