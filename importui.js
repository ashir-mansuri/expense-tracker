// The statement import: one full-screen flow.
//   choose a file (or paste) → I read it → I check it against the bank's own running balance →
//   you tell me what the names I don't know are (once) → everything is added as one import you can undo.
import { store, parseCSV, guessCurrency, CURRENCIES } from './store.js';
import * as A from './analytics.js';
import { icon } from './icons.js';
import { readFileInput, readPasted } from './reader.js';
import { analyse, isOwnExport, markDuplicates } from './statement.js';
import { buildIndex, categorise } from './categorize.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ACCEPT = '.xls,.xlsx,.csv,.tsv,.txt,.pdf,.html,.htm,.xml,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let hooks = { done() {}, toast() {} };
let st = null;
let wired = false;

export function initImport(h) { hooks = { ...hooks, ...h }; }

// ---------------------------------------------------------------- open / close
export function openImport() {
  const flow = $('#flow');
  if (!flow) return;
  if (!wired) wire(flow);
  st = fresh();
  shell(flow);
  paint(true);
  flow.classList.remove('hidden');
  document.body.classList.add('flow-open');
  requestAnimationFrame(() => flow.classList.add('show'));
}

export function closeImport() {
  const flow = $('#flow');
  if (!flow) return;
  flow.classList.remove('show');
  document.body.classList.remove('flow-open');
  setTimeout(() => { if (!flow.classList.contains('show')) { flow.classList.add('hidden'); $('.flow-body', flow).innerHTML = ''; st = null; } }, 360);
}

function fresh() {
  return {
    step: 'start', busy: '', fileName: '', pending: null, wrong: false, pasted: '',
    result: null, rows: [], currency: store.settings.currency, currencyFound: false, account: '',
    open: new Set(), taught: new Map(), leaveRest: false, showDups: false, index: null,
    cols: null, problem: '', own: null,
  };
}

function shell(flow) {
  if ($('.flow-body', flow)) return;
  flow.innerHTML = `<div class="flow-head"><button data-f="back" aria-label="Back"></button><h2></h2><span></span></div>
    <div class="flow-body"></div><div class="flow-foot hidden"></div>
    <input type="file" id="flow-file" class="hidden" accept="${ACCEPT}">`;
}

function wire(flow) {
  wired = true;
  flow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b || !st) return;
    safely(() => act(b.dataset.f, b, e));
  });
  flow.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'flow-file') { const file = el.files[0]; el.value = ''; if (file) readFile(file); return; }
    if (el.dataset.f && st) safely(() => change(el.dataset.f, el));
  });
  flow.addEventListener('input', (e) => {
    if (!st || !e.target.classList.contains('paste')) return;
    st.pasted = e.target.value;
    const go = $('[data-f="paste"]', flow); if (go) go.disabled = !st.pasted.trim();
  });
}

// ---------------------------------------------------------------- reading
async function readFile(file, password = null) {
  st.fileName = file.name; st.pending = file; st.wrong = false;
  go('busy', 'Reading your statement…');
  try {
    const read = await readFileInput(file, { password });
    ingest(read);
  } catch (err) {
    if (err && err.needsPassword) { st.wrong = !!err.wrong; go('password'); return; }
    console.error('Could not read file', err);
    fail(friendly(err));
  }
}

function readText(text) {
  st.fileName = 'Pasted text'; st.pending = null;
  go('busy', 'Reading…');
  setTimeout(() => {
    try { ingest(readPasted(text)); } catch (err) { console.error('Could not read text', err); fail(friendly(err, 'I could not read that text. Paste the rows exactly as they appear in your banking app or statement. Nothing was added.')); }
  }, 30);
}

function fail(message) { st.problem = message; go('problem'); }

const GENERIC = 'I could not read this file. It may be damaged, or laid out in a way I do not know yet. Nothing was added. If your bank offers an Excel or CSV version of the statement, try that one.';
// Messages written for people are kept. Anything else (a coding error inside the reader) becomes a plain sentence.
const friendly = (err, fallback = GENERIC) => (err && err.name === 'Error' && typeof err.message === 'string' && err.message.length > 5 && err.message.length < 400 ? err.message : fallback);
function oops(err) {
  console.error('Import problem', err);
  if (st) { st.adding = false; fail(friendly(err, 'Something went wrong while handling this file. Nothing was added. Go back and try again.')); }
}
// Every tap and every change inside the import runs under this, so a surprise can never leave the screen stuck.
function safely(fn) {
  try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(oops); } catch (err) { oops(err); }
}

function csvText(rows) {
  const cell = (c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

function ingest(read) {
  // a file saved from this very app (CSV or Excel export): rows already have type and category
  for (const sh of read.sheets) {
    const at = sh.rows.slice(0, 15).findIndex((r) => isOwnExport(r));
    if (at >= 0) {
      const parsed = parseCSV(csvText(sh.rows.slice(at)));
      if (parsed.rows.length) {
        const { fresh: rows, duplicates } = store.dedupeRows(parsed.rows.map((r) => ({ ...r, currency: r.currency || store.settings.currency })));
        st.own = { rows, duplicates, skipped: parsed.skipped, total: parsed.rows.length };
        go('own'); return;
      }
    }
  }
  const fallback = guessCurrency();
  let best = null, failure = null;
  for (const sh of read.sheets) {
    if (!sh.rows.length) continue;
    const r = analyse(sh.rows, { defaultCurrency: fallback, region: navigator.language, hint: sh.hint || '' });
    if (r.ok) { if (!best || r.rows.length > best.rows.length) best = r; }
    else if (!failure || (r.mapping && !failure.mapping)) failure = r;
  }
  if (best && !best.confident) { openColumns(best, 'There are no column titles I recognise, so I made a guess. Please check it, once, before anything is added.'); return; }
  if (best) { start(best); return; }
  if (failure && failure.mapping && failure.table) { openColumns(failure, failure.reason); return; }
  fail((failure && failure.reason) || 'I could not find any transactions in this file. If it is a PDF made from a photo, download the Excel or CSV version from your bank instead.');
}

function start(res) {
  st.result = res;
  st.currency = res.currency || guessCurrency();
  st.currencyFound = res.currencyFound;
  st.account = '';
  st.index = buildIndex(store.transactions, store.merchants);
  st.rows = res.rows.map((r) => ({ ...r, currency: st.currency, on: true, touched: false }));
  st.rows.forEach((r) => classify(r));
  refreshDuplicates();
  st.open = new Set(); st.taught = new Map(); st.leaveRest = false; st.showDups = st.rows.some((r) => r.dup === 'maybe'); // look-alikes are shown open, so nothing is left out unseen
  go('review');
}

function classify(r) {
  let c = categorise(r, st.index, store.categories);
  // money coming back from a shop or app I know as a place you spend is a refund
  if (r.type === 'Income' && (!c || c.weak) && r.kind !== 'interest') {
    const asSpend = categorise({ ...r, type: 'Expense' }, st.index, store.categories);
    const refunds = store.categoryNames('Income').find((n) => /refund/i.test(n));
    if (asSpend && !asSpend.weak && asSpend.source !== 'kind' && refunds) c = { category: refunds, source: 'refund', weak: false };
  }
  if (c) { r.category = c.category; r.source = c.source; r.weak = !!c.weak; }
  else { r.category = fallbackCategory(r.type); r.source = null; r.weak = false; }
}

function fallbackCategory(type) {
  const names = store.categoryNames(type);
  return names.find((n) => /^other$/i.test(n)) || names.find((n) => /^other/i.test(n)) || names[names.length - 1] || 'Other';
}

function refreshDuplicates() {
  markDuplicates(st.rows, store.transactions);
  for (const r of st.rows) if (!r.touched) r.on = !r.dup;
}

// ---------------------------------------------------------------- the columns screen (when I could not tell)
function openColumns(res, why = '') {
  const m = { ...(res.mapping || {}) };
  const table = res.table || st.result?.table || [];
  const width = Math.max(1, ...table.slice(0, 200).map((r) => r.length));
  let headerIndex = typeof res.headerIndex === 'number' ? res.headerIndex : -1;
  if (headerIndex < -1) headerIndex = -1;
  st.cols = { table, map: m, width, headerIndex, dayFirst: res.dayFirst ?? null, currency: res.currency || st.currency || guessCurrency(), why };
  go('columns');
}

const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
function colOptions(c, field, allowNone) {
  const rows = c.table.slice(c.headerIndex + 1, c.headerIndex + 40);
  const head = c.table[c.headerIndex] || [];
  const opts = [];
  for (let i = 0; i < c.width; i++) {
    const sample = rows.map((r) => String(r[i] ?? '').trim()).find(Boolean) || '';
    const title = String(head[i] ?? '').trim();
    const label = `${colLetter(i)}${title ? ' · ' + title : ''}${sample ? ' — ' + sample.slice(0, 22) : ''}`;
    opts.push(`<option value="${i}" ${c.map[field] === i ? 'selected' : ''}>${esc(label)}</option>`);
  }
  return `<select data-f="map" data-k="${field}">${allowNone ? `<option value="-1" ${c.map[field] < 0 ? 'selected' : ''}>Not in this file</option>` : ''}${opts.join('')}</select>`;
}

function applyColumns() {
  const c = st.cols;
  const m = { date: -1, valueDate: -1, time: -1, desc: -1, amount: -1, debit: -1, credit: -1, drcr: -1, balance: -1, currency: -1, category: -1, ...c.map };
  const dateLike = /\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}|^\d{1,2}[ \-][A-Za-z]{3}/;
  const first = c.table.findIndex((r) => dateLike.test(String(r[m.date] ?? '').trim()));
  const forced = { ...m, headerIndex: Math.max(-1, first - 1), currency: c.currency };
  if (c.dayFirst !== null) forced.dayFirst = c.dayFirst;
  const res = analyse(c.table, { defaultCurrency: c.currency, region: navigator.language, mapping: forced, hint: '' });
  if (!res.ok) { c.why = res.reason; paint(false); return; }
  res.currency = c.currency; res.currencyFound = true;
  start(res);
}

// ---------------------------------------------------------------- actions
function go(step, busy = '') {
  st.step = step; st.busy = busy;
  paint(true);
}

function act(a, el) {
  if (a === 'back') {
    if (st.step === 'columns' && st.result) { go('review'); return; }
    if (['columns', 'problem', 'password', 'own'].includes(st.step)) { go('start'); return; }
    if (st.step === 'review') { askLeave(); return; }
    closeImport(); return;
  }
  if (a === 'pick') { $('#flow-file').click(); return; }
  if (a === 'paste') { if (st.pasted.trim()) readText(st.pasted); return; }
  if (a === 'again') { go('start'); return; }
  if (a === 'unlock') { const v = $('#flow-pass')?.value || ''; if (v && st.pending) readFile(st.pending, v); return; }
  if (a === 'columns') { openColumns({ ...st.result, mapping: st.result.mapping, table: st.result.table }); return; }
  if (a === 'use-columns') { applyColumns(); return; }
  if (a === 'toggle') { const id = el.dataset.g; st.open.has(id) ? st.open.delete(id) : st.open.add(id); paint(false); return; }
  if (a === 'row') { const r = st.rows[+el.dataset.i]; if (r) { r.on = !r.on; r.touched = true; paint(false); } return; }
  if (a === 'flip') { const r = st.rows[+el.dataset.i]; if (r) { r.type = r.type === 'Income' ? 'Expense' : 'Income'; r.typeSrc = 'you'; classify(r); paint(false); } return; }
  if (a === 'flip-all') { for (const r of st.rows) { r.type = r.type === 'Income' ? 'Expense' : 'Income'; r.typeSrc = 'you'; classify(r); } st.result.summary.typeGuessed = false; paint(false); return; }
  if (a === 'leave-rest') { st.leaveRest = true; paint(false); return; }
  if (a === 'dups') { st.showDups = !st.showDups; paint(false); return; }
  if (a === 'commit') { commit(); return; }
  if (a === 'commit-own') { commitOwn(); return; }
}

function change(f, el) {
  if (f === 'currency') {
    st.currency = el.value; st.currencyFound = true;
    for (const r of st.rows) r.currency = st.currency;
    if (st.account && !store.accounts.some((x) => x.id === st.account && x.currency === st.currency)) st.account = '';
    refreshDuplicates(); paint(false);
  } else if (f === 'account') { st.account = el.value; paint(false); }
  else if (f === 'gcat') {
    const g = groups().all.find((x) => x.id === el.dataset.g);
    if (!g) return;
    for (const r of g.rows) { r.category = el.value; r.source = 'you'; r.weak = false; }
    st.taught.set(g.id, { key: g.key, type: g.type, category: el.value });
    paint(false);
  } else if (f === 'rcat') {
    const r = st.rows[+el.dataset.i]; if (!r) return;
    r.category = el.value; r.source = 'you'; r.weak = false; paint(false);
  } else if (f === 'map') {
    st.cols.map[el.dataset.k] = +el.value; paint(false);
  } else if (f === 'ccurrency') { st.cols.currency = el.value; }
  else if (f === 'dayfirst') { st.cols.dayFirst = el.value === '' ? null : el.value === 'day'; }
}

async function askLeave() {
  if (hooks.confirmLeave) { if (!(await hooks.confirmLeave())) return; }
  closeImport();
}

async function commit() {
  const on = st.rows.filter((r) => r.on);
  if (!on.length || st.adding) return;
  // The bank's own running balance disagrees with some rows: the person must say they have looked.
  const sum0 = st.result && st.result.summary;
  if (sum0 && sum0.status === 'partial' && hooks.confirmMismatch) {
    st.adding = true;
    let go = false;
    try { go = await hooks.confirmMismatch(sum0.bad); } finally { st.adding = false; }
    if (!go || !st.rows.length) return;
  }
  st.adding = true; // from here the import is finished in one go, so a second tap cannot add it twice
  for (const t of st.taught.values()) if (on.some((r) => r.key === t.key && r.type === t.type)) store.learnMerchant(t.key, t.type, t.category);
  const rows = on.sort((a, b) => (a.date === b.date ? (a.time || '') < (b.time || '') ? -1 : 1 : a.date < b.date ? -1 : 1)).map((r) => {
    const t = { date: r.date, type: r.type, category: r.category, amount: r.amount, currency: st.currency, desc: r.desc };
    if (r.time) t.time = r.time;
    if (r.ref) t.ref = r.ref;
    if (r.raw) t.raw = r.raw.slice(0, 160);
    if (st.account) t.account = st.account;
    return t;
  });
  const sum = (type) => Math.round(rows.filter((x) => x.type === type).reduce((a, x) => a + x.amount, 0) * 100) / 100;
  const from = rows[0].date, to = rows[rows.length - 1].date;
  const id = store.addBatch(rows, { name: st.fileName || 'Pasted text', from, to, currency: st.currency, expense: sum('Expense'), income: sum('Income') });
  const done = { id, count: rows.length, currency: st.currency, from, to, taught: st.taught.size };
  closeImport();
  hooks.done(done);
}

function commitOwn() {
  const o = st.own;
  if (!o || !o.rows.length) return;
  const rows = o.rows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const from = rows[0].date, to = rows[rows.length - 1].date;
  const cur = rows.map((r) => r.currency)[0] || store.settings.currency;
  const id = store.addBatch(rows, { name: st.fileName || 'Saved file', from, to, currency: cur });
  closeImport();
  hooks.done({ id, count: rows.length, currency: cur, from, to, taught: 0, duplicates: o.duplicates });
}

// ---------------------------------------------------------------- grouping
function groups() {
  const map = new Map();
  for (const r of st.rows) {
    if (r.dup) continue;
    const id = `${r.type}|${r.key}`;
    let g = map.get(id);
    if (!g) { g = { id, key: r.key, type: r.type, name: r.name || r.desc || 'Unnamed', rows: [], total: 0 }; map.set(id, g); }
    g.rows.push(r);
  }
  const all = [...map.values()];
  for (const g of all) {
    g.total = g.rows.reduce((a, r) => a + r.amount, 0);
    const counts = new Map();
    for (const r of g.rows) counts.set(r.category, (counts.get(r.category) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    g.cat = sorted[0][0];
    g.differ = g.rows.length - sorted[0][1];
    const top = g.rows.find((r) => r.category === g.cat);
    g.source = g.rows.every((r) => r.source === top.source) ? top.source : top.source;
    g.unsure = !st.leaveRest && g.rows.every((r) => !r.source || r.weak);
    g.bad = g.rows.filter((r) => r.check === 'bad').length;
    g.from = g.rows.reduce((a, r) => (r.date < a ? r.date : a), g.rows[0].date);
    g.to = g.rows.reduce((a, r) => (r.date > a ? r.date : a), g.rows[0].date);
  }
  const byTotal = (a, b) => b.total - a.total;
  return {
    all,
    unsure: all.filter((g) => g.unsure).sort(byTotal),
    out: all.filter((g) => !g.unsure && g.type === 'Expense').sort(byTotal),
    in: all.filter((g) => !g.unsure && g.type === 'Income').sort(byTotal),
  };
}

// ---------------------------------------------------------------- painting
const money = (v, code = st.currency) => A.fmtMoney(v, code);
const range = (from, to) => (from.slice(0, 4) === to.slice(0, 4) ? `${A.fmtDay(from)} – ${A.fmtDay(to)} ${to.slice(0, 4)}` : `${A.fmtDay(from)} ${from.slice(0, 4)} – ${A.fmtDay(to)} ${to.slice(0, 4)}`);
const catOptions = (type, current) => {
  const names = store.categoryNames(type);
  const list = names.includes(current) ? names : [current, ...names];
  return list.map((n) => `<option value="${esc(n)}" ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('');
};

function paint(resetScroll) {
  const flow = $('#flow'); if (!flow || !st) return;
  const body = $('.flow-body', flow), foot = $('.flow-foot', flow), head = $('.flow-head', flow);
  const y = resetScroll ? 0 : body.scrollTop;
  const view = VIEWS[st.step]();
  $('h2', head).textContent = view.title;
  const back = $('[data-f="back"]', head);
  back.textContent = view.back || 'Cancel';
  body.innerHTML = view.body;
  if (view.foot) { foot.innerHTML = view.foot; foot.classList.remove('hidden'); } else { foot.innerHTML = ''; foot.classList.add('hidden'); }
  body.scrollTop = y;
  if (st.step === 'password') setTimeout(() => $('#flow-pass')?.focus(), 80);
}

const VIEWS = {
  start() {
    return {
      title: 'Add transactions',
      body: `<div class="start">
        <h3>Add a bank statement</h3>
        <p>Choose the file you downloaded from your bank. I read it on this phone, nothing is uploaded, and I check it against your bank's own balance so nothing is missed or counted twice.</p>
        <button class="drop" data-f="pick">${icon('import')}<b>Choose a file</b><span>Excel, CSV or PDF</span></button>
        <div class="or">or paste the text</div>
        <textarea class="paste" rows="4" placeholder="Paste rows copied from your bank's website or a PDF">${esc(st.pasted)}</textarea>
        <button class="btn secondary block" style="margin-top:10px" data-f="paste" ${st.pasted.trim() ? '' : 'disabled'}>Read pasted text</button>
        <details class="how"><summary>Where do I find the file?</summary>
          <p>In your bank's app or website open <b>Account statement</b>, choose the dates you want (several months at once is fine) and download it as <b>Excel</b> or <b>CSV</b>. A PDF from the bank works too, as long as it is not a photo.</p>
          <p>You can add statements one after another, from different banks or accounts. Anything already in your list is recognised and left out.</p></details>
      </div>`,
    };
  },

  busy() {
    return { title: 'Add transactions', back: 'Cancel', body: `<div class="busy"><div class="spin"></div><p>${esc(st.busy)}</p></div>` };
  },

  password() {
    return {
      title: 'Locked file', back: 'Back',
      body: `<div class="start"><h3>This file has a password</h3>
        <p>Banks often lock statements with a password such as your date of birth or customer ID. Type it below. It is only used to open the file on this phone.</p>
        ${st.wrong ? '<div class="problem" style="margin-top:14px"><b>That password did not work.</b> Check it and try again.</div>' : ''}
        <div class="field" style="margin-top:16px"><label>Password</label><div class="control"><input id="flow-pass" type="password" autocomplete="off" autocapitalize="off"></div></div></div>`,
      foot: `<button class="btn primary block" data-f="unlock">Open file</button>`,
    };
  },

  problem() {
    return {
      title: 'Add transactions', back: 'Back',
      body: `<div class="start"><h3>I could not use that file</h3><div class="problem" style="margin-top:14px">${esc(st.problem)}</div>
        <p style="margin-top:14px">Nothing was added. You can try another file, or paste the rows as text instead.</p></div>`,
      foot: `<button class="btn primary block" data-f="again">Try another file</button>`,
    };
  },

  own() {
    const o = st.own;
    return {
      title: 'Saved file', back: 'Back',
      body: `<div class="start"><h3>${o.rows.length ? `${o.rows.length} new ${o.rows.length === 1 ? 'transaction' : 'transactions'}` : 'Nothing new in this file'}</h3>
        <p>This file was saved from Expense Tracker, so every row already has its type and category.${o.duplicates ? ` ${o.duplicates} ${o.duplicates === 1 ? 'is' : 'are'} already in your list and will be skipped.` : ''}${o.skipped ? ` ${o.skipped} rows could not be read.` : ''}</p></div>`,
      foot: `<button class="btn primary block" data-f="commit-own" ${o.rows.length ? '' : 'disabled'}>Add ${o.rows.length} ${o.rows.length === 1 ? 'transaction' : 'transactions'}</button>`,
    };
  },

  columns() {
    const c = st.cols;
    const twoCol = c.map.debit >= 0 || c.map.credit >= 0;
    const ready = c.map.date >= 0 && (c.map.amount >= 0 || c.map.debit >= 0 || c.map.credit >= 0);
    const field = (label, key, none = true) => `<div class="field"><label>${label}</label><div class="control">${colOptions(c, key, none)}${icon('chevD')}</div></div>`;
    return {
      title: 'Check the columns', back: st.result ? 'Back' : 'Cancel',
      body: `<div class="start"><h3>Which column is which?</h3>
        <p>${esc(c.why || 'I could not be sure from the titles. Pick the columns below. Your file has these columns:')}</p></div>
        <div class="cols" style="display:flex;flex-direction:column;gap:14px">
          ${field('Date', 'date', false)}
          ${field('Description', 'desc')}
          ${field('Money out (debit)', 'debit')}
          ${field('Money in (credit)', 'credit')}
          ${twoCol ? '' : field('Amount (one column, spending as minus)', 'amount')}
          ${field('Balance after each row (optional)', 'balance')}
          <div class="field"><label>Dates are written</label><div class="control"><select data-f="dayfirst"><option value="" ${c.dayFirst === null ? 'selected' : ''}>Work it out for me</option><option value="day" ${c.dayFirst === true ? 'selected' : ''}>Day first (31/12/2026)</option><option value="month" ${c.dayFirst === false ? 'selected' : ''}>Month first (12/31/2026)</option></select>${icon('chevD')}</div></div>
          <div class="field"><label>Currency of this file</label><div class="control"><select data-f="ccurrency">${CURRENCIES.map((x) => `<option value="${x.code}" ${x.code === c.currency ? 'selected' : ''}>${x.code} · ${esc(x.name)}</option>`).join('')}</select>${icon('chevD')}</div></div>
        </div>`,
      foot: `<button class="btn primary block" data-f="use-columns" ${ready ? '' : 'disabled'}>Use these columns</button>`,
    };
  },

  review() {
    const res = st.result, s = res.summary;
    const on = st.rows.filter((r) => r.on);
    const out = on.filter((r) => r.type === 'Expense').reduce((a, r) => a + r.amount, 0);
    const inc = on.filter((r) => r.type === 'Income').reduce((a, r) => a + r.amount, 0);
    const g = groups();
    const dups = st.rows.filter((r) => r.dup);
    const accounts = store.accounts.filter((a) => a.currency === st.currency);

    let verdict;
    if (s.status === 'verified') verdict = `<div class="check ok">${icon('check')}<span><b>Matches your bank.</b> Every row follows from the running balance${s.opening !== null && s.closing !== null ? ` (${money(s.opening)} to ${money(s.closing)})` : ''}, so nothing is missing or misread.</span></div>`;
    else if (s.status === 'partial') verdict = `<div class="check warn">${icon('flag')}<span><b>${s.bad} ${s.bad === 1 ? 'row does' : 'rows do'} not add up</b> with the balance column. They are marked below. Compare them with your statement before adding.</span></div>`;
    else verdict = `<div class="check">${icon('gauge')}<span>This file has no balance column, so I cannot check the totals. Compare the two figures above with your statement.</span></div>`;

    const notes = [];
    if (!st.currencyFound) notes.push(`<div class="check warn">${icon('globe')}<span>The file does not say which currency it is in. I assumed <b>${esc(st.currency)}</b>. Change it above if that is wrong.</span></div>`);
    if (!res.confident) notes.push(`<div class="check warn">${icon('search')}<span>I found no column titles and guessed which column is which. Look at the figures above, or check the columns.</span></div>`);
    if (s.typeGuessed) notes.push(`<div class="check warn">${icon('swap')}<span>This file does not say which rows are money in and which are money out, so I guessed. Open a name and tap <b>In/Out</b> to fix a row, or <button class="a-inline" data-f="flip-all">swap all</button>.</span></div>`);

    const head = `<div class="assist">
      <div class="a-hello">${icon('sparkles', 'ic-sm')} Here is what I found</div>
      <div class="a-count">${on.length === st.rows.length ? st.rows.length : `${on.length} of ${st.rows.length}`} ${st.rows.length === 1 ? 'transaction' : 'transactions'}</div>
      <div class="a-range">${esc(range(s.from, s.to))}</div>
      <div class="a-figs"><div><span class="lbl">Money out</span><span class="val num">${money(out)}</span></div><div><span class="lbl">Money in</span><span class="val num pos">${money(inc)}</span></div></div>
      ${verdict}${notes.join('')}
      <div class="a-set">
        <label class="select-wrap pill-btn">${esc(st.currency)} ${icon('chevD', 'ic-sm')}<select data-f="currency" aria-label="Currency of this statement">${CURRENCIES.map((x) => `<option value="${x.code}" ${x.code === st.currency ? 'selected' : ''}>${x.code} · ${esc(x.name)}</option>`).join('')}</select></label>
        ${accounts.length ? `<label class="select-wrap pill-btn">${icon('card', 'ic-sm')} ${esc(accounts.find((a) => a.id === st.account)?.name || 'No account')} ${icon('chevD', 'ic-sm')}<select data-f="account" aria-label="Account"><option value="">No account</option>${accounts.map((a) => `<option value="${a.id}" ${a.id === st.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      <button class="a-link" data-f="columns">Check the columns</button>
    </div>`;

    const teach = g.unsure.length ? `<div class="teach">${icon('sparkles')}<div><p><b>${g.unsure.length} ${g.unsure.length === 1 ? 'name is' : 'names are'} new to me.</b> Choose what each one is and I will remember it, so next time it sorts itself.</p><button data-f="leave-rest">Leave the rest as ${esc(fallbackCategory('Expense'))}</button></div></div>` : '';

    const section = (title, list) => list.length ? `<section><div class="group-head"><h3>${title}</h3><span>${list.length}</span></div><div class="groups">${list.map(groupHTML).join('')}</div></section>` : '';
    const looseDups = dups.filter((r) => r.dup === 'maybe').length;
    const dupHTML = dups.length ? `<section><button class="group-head dup-head" data-f="dups"><h3>${looseDups ? 'Possible repeats' : 'Already in your list'}</h3><span>${dups.filter((r) => r.on).length ? dups.filter((r) => r.on).length + ' will be added again · ' : ''}${dups.length} ${st.showDups ? icon('chevD', 'ic-sm') : icon('chevR', 'ic-sm')}</span></button>
      ${st.showDups ? `<div class="groups"><div class="group"><p class="caption" style="margin:0 0 6px">Left out because they look like something you already have. <b>Same reference</b> is the very same payment. <b>Same day and amount</b> only means they look alike, so tick it if it is a different payment.</p><div class="gitems" style="margin:0;border:0">${dups.map((r) => itemHTML(r, true)).join('')}</div></div></div>` : ''}</section>` : '';

    return {
      title: 'Review', back: 'Cancel',
      body: `${head}${teach}${section('New names', g.unsure)}${section('Money out', g.out)}${section('Money in', g.in)}${dupHTML}`,
      foot: `<button class="btn primary block" data-f="commit" ${on.length ? '' : 'disabled'}>Add ${on.length} ${on.length === 1 ? 'transaction' : 'transactions'}</button><div class="sub">Stays on this phone. You can undo the whole import afterwards.</div>`,
    };
  },
};

function groupHTML(g) {
  const open = st.open.has(g.id);
  const letter = (g.name.match(/[A-Za-z0-9]/) || ['•'])[0].toUpperCase();
  const dates = g.from === g.to ? A.fmtDay(g.from) : `${A.fmtDay(g.from)} – ${A.fmtDay(g.to)}`;
  const sub = `${g.rows.length} ${g.rows.length === 1 ? 'payment' : 'payments'} · ${dates}`;
  const warn = g.bad ? ` · <span style="color:var(--amber)">${g.bad} to check</span>` : '';
  const src = g.source === 'taught' ? 'you taught me' : g.source === 'history' ? 'as before' : g.source === 'refund' ? 'money back' : '';
  return `<div class="group ${g.unsure ? 'unsure' : ''}">
    <button class="group-main" data-f="toggle" data-g="${esc(g.id)}" aria-expanded="${open}"><span class="avatar">${esc(letter)}</span>
      <span class="gtxt"><span class="gname">${esc(g.name)}</span><span class="gsub">${sub}${warn}</span></span>
      <span class="gamt num ${g.type === 'Income' ? 'in' : ''}">${g.type === 'Income' ? '+' : ''}${money(g.total)}</span></button>
    <label class="gcat"><span>${esc(g.cat)}${g.differ ? ` <i>+${g.differ} differ</i>` : ''}</span>${icon('chevD')}${src ? `<em class="src">${src}</em>` : ''}<select data-f="gcat" data-g="${esc(g.id)}" aria-label="Category for ${esc(g.name)}">${catOptions(g.type, g.cat)}</select></label>
    ${open ? `<div class="gitems">${g.rows.map((r) => itemHTML(r, false)).join('')}</div>` : ''}
  </div>`;
}

function itemHTML(r, dupView) {
  const flip = st.result.summary.typeGuessed || r.typeSrc === 'guess' || r.typeSrc === 'you';
  const raw = r.raw && r.raw !== r.desc ? `<div class="gi-raw">${esc(r.raw.slice(0, 140))}</div>` : '';
  const bad = r.check === 'bad' ? `<span class="gi-bad" title="Does not match the balance">${icon('flag', 'ic-sm')}</span>` : '';
  return `<div class="gitem ${r.on ? '' : 'off'}">
    <button class="tick ${r.on ? 'on' : ''}" data-f="row" data-i="${r.i}" role="checkbox" aria-checked="${r.on}" aria-label="Include this row">${icon('check')}</button>
    <div class="gi-txt"><div class="gi-d">${bad}${esc(A.fmtDay(r.date))}${r.time ? ' · ' + esc(r.time) : ''}${dupView ? ` · ${esc(r.desc)}` : ''}${r.dup === 'maybe' ? ' · same day and amount' : r.dup === 'likely' ? ' · same day, amount and name' : r.dup === 'same' ? ' · same reference' : ''}</div>${raw}
      ${dupView ? '' : `<label class="gi-cat">${esc(r.category)}<select data-f="rcat" data-i="${r.i}" aria-label="Category">${catOptions(r.type, r.category)}</select></label>`}</div>
    <div class="gi-right"><span class="gi-amt num ${r.type === 'Income' ? 'in' : ''}">${r.type === 'Income' ? '+' : ''}${money(r.amount)}</span>${flip && !dupView ? `<button class="gi-flip" data-f="flip" data-i="${r.i}">${r.type === 'Income' ? 'In' : 'Out'} ⇄</button>` : ''}</div>
  </div>`;
}
