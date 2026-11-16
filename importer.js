// Reads any bank statement or spreadsheet export (CSV): finds the header row, guesses which column is which,
// and turns rows into transactions. The person can correct the guesses before anything is saved.
import { detectDelimiter, parseTable, parseDate, parseTime, parseAmount, CURRENCY_CODES } from './store.js';

const FIELD_WORDS = {
  date: ['date', 'datum', 'buchungstag', 'buchungsdatum', 'valuta', 'wertstellung', 'transaction date', 'txn date', 'value date', 'posted', 'booking date', 'fecha', 'tran date'],
  time: ['time', 'uhrzeit', 'zeit', 'transaction time', 'txn time'],
  desc: ['description', 'desc', 'narration', 'particulars', 'details', 'verwendungszweck', 'buchungstext', 'beschreibung', 'remarks', 'memo', 'payee', 'name', 'merchant', 'text', 'transaction details', 'empfänger', 'auftraggeber', 'beguenstigter', 'begünstigter', 'zahlungsempfänger', 'remark', 'note', 'notes', 'transaction remarks'],
  amount: ['amount', 'betrag', 'umsatz', 'value', 'sum', 'transaction amount', 'amount (inr)', 'amount (eur)', 'importe', 'montant', 'amt'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'withdrawal amt', 'withdrawal amount', 'money out', 'paid out', 'out', 'soll', 'ausgang', 'lastschrift', 'dr', 'debit amount', 'debit amt', 'withdrawal amt.', 'withdrawal (dr)', 'debit (dr)', 'spent'],
  credit: ['credit', 'deposit', 'deposits', 'deposit amt', 'deposit amount', 'money in', 'paid in', 'in', 'haben', 'eingang', 'gutschrift', 'cr', 'credit amount', 'credit amt', 'deposit amt.', 'deposit (cr)', 'credit (cr)', 'received'],
  drcr: ['dr/cr', 'cr/dr', 'type', 'dr / cr', 'transaction type', 'txn type', 'debit/credit', 'credit/debit', 'd/c', 'soll/haben', 'art'],
  category: ['category', 'kategorie', 'categoria'],
  currency: ['currency', 'währung', 'waehrung', 'ccy', 'cur'],
  balance: ['balance', 'saldo', 'closing balance', 'running balance', 'available balance', 'kontostand'],
};

const clean = (s) => (s || '').toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.:*]+$/g, '').trim();

export function readStatement(text) {
  const content = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(content);
  const table = parseTable(content, delimiter).map((r) => r.map((c) => c.trim()));
  const headerIndex = findHeader(table);
  if (headerIndex < 0) return null;
  const headers = table[headerIndex].map((h, i) => h || `Column ${i + 1}`);
  const rows = table.slice(headerIndex + 1).filter((r) => r.some((c) => c));
  const mapping = guessMapping(headers, rows);
  // with one amount column and no minus signs anywhere, the numbers are almost certainly all expenses (card statements)
  const hasNegative = mapping.amount >= 0 && rows.some((r) => /-/.test((r[mapping.amount] || '').trim()) && (parseAmount(r[mapping.amount]) || 0) < 0);
  const signMeansExpense = mapping.amount < 0 || mapping.drcr >= 0 || hasNegative;
  return { headers, rows, mapping, dayFirst: guessDayFirst(rows, mapping.date), signMeansExpense };
}

// The header is the first row with 2+ non-empty cells that is followed by rows containing a date.
function findHeader(table) {
  for (let i = 0; i < Math.min(table.length, 60); i++) {
    const row = table[i];
    const filled = row.filter((c) => c).length;
    if (filled < 2) continue;
    const words = row.map(clean);
    const looksLikeHeader = words.some((w) => FIELD_WORDS.date.includes(w) || FIELD_WORDS.amount.includes(w) || FIELD_WORDS.debit.includes(w) || FIELD_WORDS.desc.includes(w));
    const nextHasDate = table.slice(i + 1, i + 6).some((r) => r.some((c) => parseDate(c)));
    if (looksLikeHeader && nextHasDate) return i;
  }
  // no recognisable header: if data rows have dates, treat the first row as the header anyway
  for (let i = 0; i < Math.min(table.length, 60); i++) if (table[i].some((c) => parseDate(c))) return Math.max(i - 1, 0);
  return -1;
}

function guessMapping(headers, rows) {
  const words = headers.map(clean);
  const m = { date: -1, time: -1, desc: -1, amount: -1, debit: -1, credit: -1, drcr: -1, category: -1, currency: -1, balance: -1 };
  const used = new Set();
  const headerWords = words.map((w) => w.split(' '));
  const pick = (field) => {
    // keywords are listed in order of preference; an exact header match wins, then a header containing the keyword's words
    let idx = -1;
    for (const k of FIELD_WORDS[field]) {
      idx = words.findIndex((w, i) => !used.has(i) && w === k);
      if (idx >= 0) break;
    }
    if (idx < 0) {
      for (const k of FIELD_WORDS[field]) {
        if (k.length < 4) continue;
        const kw = k.split(' ');
        idx = words.findIndex((w, i) => !used.has(i) && kw.every((x) => headerWords[i].includes(x)) && !(field !== 'date' && /\b(date|datum)\b/.test(w)));
        if (idx >= 0) break;
      }
    }
    if (idx >= 0) { m[field] = idx; used.add(idx); }
  };
  for (const f of ['date', 'time', 'drcr', 'debit', 'credit', 'balance', 'category', 'currency', 'desc']) pick(f);
  if (m.debit < 0 || m.credit < 0) pick('amount');
  if (m.drcr >= 0 && !rows.slice(0, 20).some((r) => /^(dr|cr|debit|credit|soll|haben|d|c)$/i.test(r[m.drcr] || ''))) { used.delete(m.drcr); m.drcr = -1; }
  // fall back to looking at the data itself
  if (m.date < 0) m.date = headers.findIndex((_, i) => !used.has(i) && rows.slice(0, 10).filter((r) => parseDate(r[i])).length >= 3);
  if (m.amount < 0 && m.debit < 0 && m.credit < 0) {
    const numeric = headers.map((_, i) => !used.has(i) && i !== m.date && rows.slice(0, 20).filter((r) => r[i] && parseAmount(r[i]) !== null).length >= 3);
    const candidates = numeric.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
    if (candidates.length === 1) m.amount = candidates[0];
    else if (candidates.length >= 2) { m.debit = candidates[0]; m.credit = candidates[1]; }
  }
  if (m.desc < 0) {
    // the text column with the longest average content
    let bestI = -1, bestLen = 0;
    headers.forEach((_, i) => {
      if (used.has(i) || i === m.date || i === m.amount || i === m.debit || i === m.credit) return;
      const len = rows.slice(0, 20).reduce((a, r) => a + ((r[i] || '').replace(/[0-9.,-]/g, '').length), 0);
      if (len > bestLen) { bestLen = len; bestI = i; }
    });
    m.desc = bestI;
  }
  return m;
}

function guessDayFirst(rows, dateCol) {
  if (dateCol < 0) return true;
  let dayFirst = null;
  for (const r of rows.slice(0, 200)) {
    const mm = (r[dateCol] || '').match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (!mm) continue;
    if (+mm[1] > 12) return true;
    if (+mm[2] > 12) dayFirst = false;
  }
  if (dayFirst !== null) return dayFirst;
  try { return new Intl.Locale(navigator.language || 'en-GB').maximize().region !== 'US'; } catch { return true; }
}

const isDebitWord = (s) => /^(dr|d|debit|soll|withdrawal|out|lastschrift|belastung|debited)\b/i.test(s || '');
const isCreditWord = (s) => /^(cr|c|credit|haben|deposit|in|gutschrift|credited)\b/i.test(s || '');

// Turns the rows into transactions using the (possibly corrected) mapping.
// `signMeansExpense`: when there is a single amount column, negative = expense (true) or positive = expense (false).
export function extractRows(statement, mapping, { defaultCurrency, dayFirst = statement.dayFirst, signMeansExpense = true } = {}) {
  const out = { rows: [], skipped: 0 };
  const m = mapping;
  const cell = (r, i) => (i >= 0 && i < r.length ? r[i] : '');
  for (const r of statement.rows) {
    const dateCell = cell(r, m.date);
    const date = parseDate(dateCell, dayFirst);
    if (!date) { out.skipped += 1; continue; }
    let amount = null, type = null;
    if (m.debit >= 0 || m.credit >= 0) {
      const d = parseAmount(cell(r, m.debit)), c = parseAmount(cell(r, m.credit));
      if (d && Math.abs(d) > 0) { amount = Math.abs(d); type = 'Expense'; }
      else if (c && Math.abs(c) > 0) { amount = Math.abs(c); type = 'Income'; }
    }
    if (amount === null && m.amount >= 0) {
      const text = cell(r, m.amount);
      const raw = parseAmount(text);
      if (raw !== null && raw !== 0) {
        amount = Math.abs(raw);
        if (m.drcr >= 0) type = isCreditWord(cell(r, m.drcr)) ? 'Income' : isDebitWord(cell(r, m.drcr)) ? 'Expense' : null;
        if (!type && /\b(cr|credit)\b/i.test(text)) type = 'Income';
        if (!type && /\b(dr|debit)\b/i.test(text)) type = 'Expense';
        if (!type) type = (raw < 0) === signMeansExpense ? 'Expense' : 'Income';
      }
    }
    if (amount === null) { out.skipped += 1; continue; }
    const rawDesc = cell(r, m.desc);
    const desc = tidyDesc(rawDesc);
    const time = parseTime(cell(r, m.time)) || parseTime(dateCell.replace(/^\S+/, '')) || timeInText(rawDesc);
    let currency = cell(r, m.currency).toUpperCase().trim();
    if (!CURRENCY_CODES.includes(currency)) currency = defaultCurrency;
    const category = cell(r, m.category).trim();
    const row = { date, type, amount, currency, desc, category: category || '' };
    if (time) row.time = time;
    out.rows.push(row);
  }
  // most statements list newest first; keep them in date order
  out.rows.sort((a, b) => (a.date === b.date ? (a.time || '') < (b.time || '') ? -1 : 1 : a.date < b.date ? -1 : 1));
  return out;
}

function timeInText(text) {
  const m = (text || '').match(/(?:^|[^0-9])(\d{1,2}:\d{2})(?::\d{2})?(?![0-9])/);
  return m ? parseTime(m[1]) : null;
}

// Bank text is full of reference numbers and codes. Keep the words a person would recognise.
export function tidyDesc(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/g, ' ').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
  t = t.replace(/\b(EREF|MREF|CRED|SVWZ|KREF|DEBT|ABWA|ABWE|IBAN|BIC)[:+]\S*/gi, ' ');
  t = t.replace(/\bDebitk\.?\s?\d*/gi, ' ').replace(/\b\d{4}-\d{2}\b/g, ' ');
  const parts = t.split(/\s*\/+\s*|\s*\|\s*/).map((p) => p.trim()).filter((p) => {
    if (!p) return false;
    if (/^[0-9.,:\- ]+$/.test(p)) return false;            // pure numbers / references
    if (/@/.test(p)) return false;                           // UPI ids, emails
    if (/^(UPI|IMPS|NEFT|RTGS|POS|DR|CR|SEPA|ECOM|TXN|REF|MANDAT|MANDATE|ORDER|PAYMENT|PAYMENTS)$/i.test(p)) return false;
    if (p.length <= 2 && !/^[A-Za-z]{2}$/.test(p)) return false;
    return true;
  });
  let out = (parts.length ? parts.join(' · ') : t).replace(/\s+/g, ' ').trim();
  out = out.replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{8,}\b/g, '').replace(/\s+·\s*·/g, ' ·').replace(/\s{2,}/g, ' ').replace(/^·\s*|\s*·$/g, '').trim();
  // SHOUTING → Title Case, but leave short codes (DE, HVV, UPI) alone
  out = out.replace(/\b[A-ZÄÖÜ]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  return out || (text || '').trim();
}

// Our own export: Date, Type, Category, Amount, Currency, Description (…and optional Time, Tags)
export function isOwnExport(headers) {
  const w = headers.map(clean);
  return w.includes('date') && w.includes('amount') && w.includes('type') && w.includes('category') && w.includes('currency');
}
