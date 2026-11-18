// Checks a backup file before anything from it is allowed into the app.
// Rows that are damaged are left out (and counted), nothing from the file is trusted as it is.
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ROWS = 300000;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (x, max) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const money = (x) => { const n = num(x); return n !== null && n > 0 && n <= 1e12 ? Math.round(n * 100) / 100 : null; };
const code = (x) => (typeof x === 'string' && /^[A-Za-z]{3}$/.test(x) ? x.toUpperCase() : null);
const idOf = (x) => (typeof x === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(x) ? x : null);

export function validISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

// Extra fields a row may carry: plain short text, numbers or true/false, nothing nested.
function extras(src, into, known) {
  for (const [k, v] of Object.entries(src)) {
    if (known.has(k) || DANGEROUS.has(k) || k.length > 40) continue;
    if (typeof v === 'string') into[k] = str(v, 300);
    else if (typeof v === 'boolean') into[k] = v;
    else if (num(v) !== null) into[k] = v;
  }
  return into;
}

function transaction(t, newId) {
  if (!isObj(t)) return null;
  const type = t.type === 'Expense' || t.type === 'Income' ? t.type : null;
  const amount = money(t.amount), currency = code(t.currency), date = t.date;
  const category = str(t.category, 80);
  if (!type || amount === null || !currency || !validISODate(date) || !category || !category.trim()) return null;
  const out = { id: idOf(t.id) || newId(), type, category: category.trim(), amount, currency, date, desc: str(t.desc ?? '', 300) ?? '' };
  if (num(t.createdAt) !== null) out.createdAt = t.createdAt;
  if (typeof t.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t.time)) out.time = t.time;
  for (const k of ['ref', 'raw', 'account', 'batch', 'origCurrency']) if (typeof t[k] === 'string' && t[k]) out[k] = str(t[k], k === 'raw' ? 300 : 80);
  if (money(t.origAmount) !== null) out.origAmount = t.origAmount;
  if (Array.isArray(t.tags)) out.tags = t.tags.filter((x) => typeof x === 'string').slice(0, 20).map((x) => str(x, 40)).filter(Boolean);
  return extras(t, out, new Set(Object.keys(out).concat(['tags', 'time', 'ref', 'raw', 'account', 'batch', 'origAmount', 'origCurrency', 'createdAt'])));
}

function category(c) {
  if (!isObj(c)) return null;
  const name = str(c.name, 80), type = c.type === 'Expense' || c.type === 'Income' ? c.type : null;
  if (!name || !name.trim() || !type) return null;
  return { id: idOf(c.id), name: name.trim(), type, sortOrder: num(c.sortOrder) ?? 0, budget: num(c.budget) !== null && c.budget >= 0 && c.budget <= 1e12 ? c.budget : 0, budgetCurrency: code(c.budgetCurrency) || 'EUR' };
}

function rule(r) {
  if (!isObj(r)) return null;
  const amount = money(r.amount), currency = code(r.currency), cat = str(r.category, 80);
  if ((r.type !== 'Expense' && r.type !== 'Income') || amount === null || !currency || !cat || !validISODate(r.startDate)) return null;
  if (r.frequency !== 'Weekly' && r.frequency !== 'Monthly') return null;
  const occ = Number.isInteger(r.occurrences) && r.occurrences >= 0 && r.occurrences < 100000 ? r.occurrences : 0;
  return { id: idOf(r.id), type: r.type, category: cat, amount, currency, desc: str(r.desc ?? '', 300) ?? '', frequency: r.frequency, startDate: r.startDate, occurrences: occ, active: r.active !== false, createdAt: num(r.createdAt) ?? 0 };
}

function account(a) {
  if (!isObj(a)) return null;
  const name = str(a.name, 60), currency = code(a.currency), id = idOf(a.id);
  if (!name || !name.trim() || !currency || !id) return null;
  return { id, name: name.trim(), opening: num(a.opening) ?? 0, currency, createdAt: num(a.createdAt) ?? 0 };
}

function transfer(t) {
  if (!isObj(t)) return null;
  const id = idOf(t.id), from = idOf(t.from), to = idOf(t.to), amount = money(t.amount), currency = code(t.currency);
  if (!id || !from || !to || amount === null || !currency || !validISODate(t.date)) return null;
  return { id, date: t.date, from, to, amount, currency, note: str(t.note ?? '', 200) ?? '', createdAt: num(t.createdAt) ?? 0 };
}

function goal(g) {
  if (!isObj(g)) return null;
  const id = idOf(g.id), name = str(g.name, 80), target = money(g.target), currency = code(g.currency);
  if (!id || !name || !name.trim() || target === null || !currency) return null;
  return { id, name: name.trim(), target, currency, deadline: validISODate(g.deadline) ? g.deadline : null, startDate: validISODate(g.startDate) ? g.startDate : null, createdAt: num(g.createdAt) ?? 0 };
}

function owedItem(d) {
  if (!isObj(d)) return null;
  const id = idOf(d.id), person = str(d.person, 60), amount = money(d.amount), currency = code(d.currency);
  if (!id || !person || !person.trim() || amount === null || !currency || !validISODate(d.date)) return null;
  const paid = (Array.isArray(d.paid) ? d.paid : []).filter((p) => isObj(p) && money(p.amount) !== null && validISODate(p.date)).slice(0, 500)
    .map((p) => ({ date: p.date, amount: money(p.amount), ...(idOf(p.txId) ? { txId: p.txId } : {}) }));
  return { id, createdAt: num(d.createdAt) ?? 0, person: person.trim(), amount, currency, date: d.date, note: str(d.note ?? '', 200) ?? '', txId: idOf(d.txId), paid };
}

function list(arr, fn, counts, key, max = MAX_ROWS) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr.slice(0, max)) { const y = fn(x); if (y) out.push(y); else counts[key] += 1; }
  if (arr.length > max) counts[key] += arr.length - max;
  return out;
}

function receiptMap(r) {
  const out = {};
  if (!isObj(r)) return out;
  for (const [k, v] of Object.entries(r)) {
    if (DANGEROUS.has(k) || !idOf(k)) continue;
    if (typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 8e6) out[k] = v;
  }
  return out;
}

// Returns clean data and how many rows had to be left out. Throws a plain-language error when the file is not a backup at all.
export function cleanBackup(parsed, newId) {
  if (!isObj(parsed) || !Array.isArray(parsed.transactions)) throw new Error('This file is not an Expense Tracker backup.');
  if (parsed.transactions.length > MAX_ROWS) throw new Error('This backup is too large to be real. Nothing was restored.');
  const skipped = { transactions: 0, categories: 0, rules: 0, accounts: 0, transfers: 0, goals: 0, owed: 0 };
  const data = {
    transactions: list(parsed.transactions, (t) => transaction(t, newId), skipped, 'transactions'),
    categories: list(parsed.categories, category, skipped, 'categories', 2000),
    rules: list(parsed.rules, rule, skipped, 'rules', 2000),
    accounts: list(parsed.accounts, account, skipped, 'accounts', 500),
    transfers: list(parsed.transfers, transfer, skipped, 'transfers', 50000),
    goals: list(parsed.goals, goal, skipped, 'goals', 500),
    owed: list(parsed.owed, owedItem, skipped, 'owed', 20000),
    merchants: {},
    receipts: receiptMap(parsed.receipts),
  };
  for (const r of data.rules) if (!r.id) r.id = newId();
  for (const c of data.categories) if (!c.id) c.id = newId();
  if (isObj(parsed.merchants)) {
    for (const [k, v] of Object.entries(parsed.merchants)) {
      if (DANGEROUS.has(k) || k.length > 120 || typeof v !== 'string' || v.length > 80) continue;
      data.merchants[k] = v;
    }
  }
  const total = Object.values(skipped).reduce((a, n) => a + n, 0);
  return { data, skipped, total };
}
