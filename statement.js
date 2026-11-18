// Turns the rows of any bank statement (CSV, Excel, PDF text) into clean transactions.
//  1. finds the column titles and works out which column is what
//  2. glues wrapped narration lines back onto their transaction and skips totals / footers
//  3. checks every row against the statement's own running balance, so a misread amount or a missing line is caught
//  4. turns bank gibberish into a readable name ("UPI/ZOMATO/q123@ybl/…" → "Zomato")
import { parseDate, parseTime, parseAmount, CURRENCY_CODES } from './store.js';
import { normalise } from './categorize.js';

// ------------------------------------------------------------------ column titles

const clean = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß\/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const RULES = [
  ['drcr', /^(dr ?\/ ?cr|cr ?\/ ?dr|d ?\/ ?c|debit ?\/ ?credit|credit ?\/ ?debit|soll ?\/ ?haben|type|transaction type|txn type|tran type|art)$/],
  ['balance', /\bbalance\b|\bsaldo\b|kontostand|\bbal\b/],
  ['valueDate', /\b(value|val) ?(date|dt)\b|^valuta$|^wertstellung$/],
  ['time', /^(time|uhrzeit|zeit|(transaction|txn|tran) time)$/],
  ['date', /\bdate\b|\bdatum\b|buchungstag|\bdt\b|\bposted\b|\bposting\b|\bbooking\b|^fecha$/],
  ['debit', /\b(withdrawals?|debits?|dr|money out|paid out|spent|soll|lastschrift|ausgaben)\b/],
  ['credit', /\b(deposits?|credits?|cr|money in|paid in|received|haben|gutschrift|einnahmen|receipts?)\b/],
  ['amount', /^(amount|betrag|umsatz|value|sum|amt|importe|montant|transaction amount|txn amount)\b|^(cad|usd|eur|gbp|inr|aud|nzd|chf)\$?$/],
  ['currency', /^(currency|währung|waehrung|ccy|cur)$/],
  ['category', /^(category|kategorie|categoria)$/],
  ['desc', /\b(remarks?|narration|particulars|description|details|verwendungszweck|buchungstext|memo|payee|merchant|beschreibung|empfänger|auftraggeber|begünstigter|zahlungsempfänger|reference|notes?|text|name)\b/],
];
const FIELDS = ['date', 'valueDate', 'time', 'desc', 'desc2', 'amount', 'debit', 'credit', 'drcr', 'balance', 'currency', 'category'];

export function mapHeader(cells) {
  const m = Object.fromEntries(FIELDS.map((f) => [f, -1]));
  cells.forEach((c, i) => {
    const w = clean(c);
    if (!w) return;
    if (/^(description|details|memo|payee|narration|particulars)\s*(2|two|ii|b)$/.test(w)) { if (m.desc2 < 0) m.desc2 = i; return; }
    for (const [field, re] of RULES) {
      if (re.test(w)) { if (m[field] < 0) m[field] = i; return; }
    }
  });
  return m;
}

const dateLike = (s) => {
  const t = String(s ?? '').trim();
  if (!t || t.length > 32) return false;
  return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(t) || /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}/.test(t) || /^\d{1,2}[ \-.]+[A-Za-zäöü]{3,9}\.?[ \-,.]+\d{2,4}/.test(t) || /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}/.test(t);
};

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 120); i++) {
    const m = mapHeader(rows[i]);
    const money = m.amount >= 0 || m.debit >= 0 || m.credit >= 0;
    if (m.date < 0 || !money) continue;
    const hasDates = rows.slice(i + 1, i + 12).some((r) => dateLike(r[m.date]));
    if (hasDates) return { index: i, mapping: m };
  }
  return null;
}

// no recognisable titles: look at the data itself (used to pre-fill the "fix columns" screen)
function guessFromData(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.slice(0, 200);
  const m = Object.fromEntries(FIELDS.map((f) => [f, -1]));
  const stat = Array.from({ length: width }, (_, c) => {
    const cells = sample.map((r) => String(r[c] ?? '').trim()).filter(Boolean);
    const n = cells.length || 1;
    const idLike = cells.length >= 3 && cells.every((x) => /^\d+$/.test(x)) && (new Set(cells).size <= 2 || cells.every((x) => x.length >= 9));
    return {
      idLike,
      dates: cells.filter(dateLike).length / n,
      nums: cells.filter((x) => /^[-−(]?[₹€$£]?\s?[\d.,]+\s?(cr|dr)?\)?-?$/i.test(x) && /\d/.test(x) && !dateLike(x)).length / n,
      len: cells.reduce((a, x) => a + x.replace(/[\d.,\-\/ ]/g, '').length, 0) / n,
      count: cells.length,
    };
  });
  m.date = stat.findIndex((s) => s.dates >= 0.6 && s.count >= 2);
  const cellsOf = (c) => sample.map((r) => String(r[c] ?? '').trim());
  const dateRows = sample.filter((r) => m.date >= 0 && dateLike(String(r[m.date] ?? '').trim()));
  const val = (r, c) => amountOf(r[c]).v;
  const cands = stat.map((s, i) => (s.nums >= 0.6 && s.count >= 1 && !s.idLike && i !== m.date ? i : -1)).filter((i) => i >= 0);
  const numeric = cands.filter((i) => stat[i].count >= 2);
  // a running balance: each step equals the money on the row (either that row or the one before, depending on sort order)
  const looksLikeBalance = (col, others) => {
    let hit = 0, tot = 0;
    for (let i = 1; i < dateRows.length; i++) {
      const b1 = val(dateRows[i], col), b0 = val(dateRows[i - 1], col);
      if (b1 === null || b0 === null) continue;
      const d = Math.abs(b1 - b0); tot++;
      const match = (row) => others.some((o) => { const v = val(row, o); return v !== null && Math.abs(Math.abs(v) - d) < 0.011; });
      if (match(dateRows[i]) || match(dateRows[i - 1])) hit++;
    }
    return tot >= 2 && hit / tot >= 0.8;
  };
  // two columns that are never filled on the same row are money out and money in
  let pair = null;
  for (let x = 0; x < cands.length && !pair; x++) for (let y = x + 1; y < cands.length && !pair; y++) {
    const A = cands[x], B = cands[y];
    if (A > B) continue;
    let one = 0, both = 0, aOnly = 0, bOnly = 0;
    for (const r of dateRows) { const fa = val(r, A) !== null, fb = val(r, B) !== null; if (fa && fb) both++; else if (fa) { one++; aOnly++; } else if (fb) { one++; bOnly++; } }
    if (dateRows.length >= 3 && both === 0 && one / dateRows.length >= 0.9 && aOnly >= 1 && bOnly >= 1) pair = [A, B];
  }
  if (pair) {
    m.debit = pair[0]; m.credit = pair[1];
    const rest = cands.filter((c) => c > pair[1]);
    const bal = rest.find((c) => looksLikeBalance(c, pair)) ?? rest[rest.length - 1];
    if (bal !== undefined) m.balance = bal;
  } else if (numeric.length === 1) m.amount = numeric[0];
  else if (numeric.length === 2) {
    if (looksLikeBalance(numeric[1], [numeric[0]])) { m.amount = numeric[0]; m.balance = numeric[1]; }
    else { m.debit = numeric[0]; m.credit = numeric[1]; }
  } else if (numeric.length >= 3) { m.debit = numeric[numeric.length - 3]; m.credit = numeric[numeric.length - 2]; m.balance = numeric[numeric.length - 1]; }
  let best = -1, bestLen = 0;
  stat.forEach((s, i) => { if (i !== m.date && !cands.includes(i) && !s.idLike && s.len > bestLen) { best = i; bestLen = s.len; } });
  m.desc = best;
  return m;
}

// ------------------------------------------------------------------ amounts and dates

export function amountOf(cell) {
  let t = String(cell ?? '').trim().replace(/[−–]/g, '-');
  if (!t) return { v: null, tag: null };
  const tag = /(^|[\d\s)])(dr|debit)\.?\)?\s*$/i.test(t) || /^\(?(dr|debit)\b/i.test(t) ? 'dr'
    : /(^|[\d\s)])(cr|credit)\.?\)?\s*$/i.test(t) || /^\(?(cr|credit)\b/i.test(t) ? 'cr' : null;
  let neg = /^\(.*\d.*\)$/.test(t) && !/[a-z]/i.test(t.replace(/\(|\)/g, ''));
  if (/\d-$/.test(t)) neg = true;
  const v = parseAmount(t);
  if (v === null) return { v: null, tag };
  return { v: neg ? -Math.abs(v) : v, tag };
}

function guessDayFirst(dateCells, localeRegion) {
  const parts = [];
  for (const c of dateCells) {
    const m = String(c ?? '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) parts.push([+m[1], +m[2]]);
  }
  if (!parts.length) return true;
  if (parts.some(([a]) => a > 12)) return true;
  if (parts.some(([, b]) => b > 12)) return false;
  // both readings possible: the one that keeps the list in date order is almost certainly right
  const inversions = (f) => {
    let dir = 0, bad = 0, prev = null;
    for (const [a, b] of parts) {
      const key = f ? b * 100 + a : a * 100 + b;
      if (prev !== null && key !== prev) { const d = key > prev ? 1 : -1; if (dir && d !== dir) bad++; dir = dir || d; }
      prev = key;
    }
    return bad;
  };
  const dayFirstBad = inversions(true), monthFirstBad = inversions(false);
  if (dayFirstBad !== monthFirstBad) return dayFirstBad < monthFirstBad;
  return localeRegion !== 'US';
}

function currencyOf(blocks) {
  const text = blocks.join(' \n ');
  const score = {};
  const bump = (c, n = 1) => { score[c] = (score[c] || 0) + n; };
  for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) if (CURRENCY_CODES.includes(m[1])) bump(m[1]);
  for (const m of text.matchAll(/₹|\bRs\.?(?=\s|\d)/g)) bump('INR', m[0] ? 1 : 0);
  for (const _ of text.matchAll(/€/g)) bump('EUR');
  for (const _ of text.matchAll(/£/g)) bump('GBP');
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

const round2 = (n) => Math.round(n * 100) / 100;
const SUMMARY_WORDS = /^(opening|closing|brought forward|carried forward|b\/f|c\/f|total|grand total|statement summary|balance (b\/f|c\/f|brought|carried))\b|\b(opening|closing) balance\b/i;

// ------------------------------------------------------------------ main entry

// rows: string[][]  →  { ok, rows, summary, notes, mapping, … }
export function analyse(table, { defaultCurrency = 'EUR', mapping: forced = null, region = null, hint = '' } = {}) {
  const rows = table.map((r) => r.map((c) => String(c ?? '').replace(/\u00a0/g, ' ').trim()));
  const found = forced ? { index: forced.headerIndex ?? findHeader(rows)?.index ?? 0, mapping: forced } : findHeader(rows);
  let mapping, headerIndex, confident = true;
  if (found) { mapping = found.mapping; headerIndex = found.index; }
  else {
    const first = rows.findIndex((r) => r.some(dateLike));
    if (first < 0) return { ok: false, reason: 'I could not find any dates in this file, so I cannot tell which lines are transactions.', rows: [], table: rows };
    mapping = guessFromData(rows.slice(first));
    headerIndex = first - 1;
    confident = false;
  }
  const m = mapping;
  const body = rows.slice(headerIndex + 1);
  if (m.date < 0 || (m.amount < 0 && m.debit < 0 && m.credit < 0)) {
    return { ok: false, reason: 'I could find the dates but not the amounts. Tell me which columns they are.', mapping: m, headerIndex, table: rows, rowsInTable: body.length, confident: false };
  }

  const cellAt = (r, i) => (i >= 0 && i < r.length ? r[i] : '');
  const dayFirst = forced?.dayFirst ?? guessDayFirst(body.map((r) => cellAt(r, m.date)).filter(dateLike), region);
  const headerBlock = [hint, ...rows.slice(0, headerIndex + 1).flat()];
  const currency = forced?.currency || currencyOf(headerBlock) || null;

  // ---- walk the rows
  const items = [];
  const skipped = [];
  let opening = null, closing = null;
  const headerWords = rows[headerIndex] ? rows[headerIndex].map(clean) : [];
  for (const r of body) {
    if (r.every((c) => !c)) continue;
    const dateCell = cellAt(r, m.date);
    const date = dateLike(dateCell) ? parseDate(dateCell, dayFirst) : null;
    const d = amountOf(cellAt(r, m.debit)), c = amountOf(cellAt(r, m.credit)), a = amountOf(cellAt(r, m.amount));
    const bal = amountOf(cellAt(r, m.balance));
    const descCell = [cellAt(r, m.desc), cellAt(r, m.desc2)].filter(Boolean).join(' ');
    const hasMoney = (d.v && d.v !== 0) || (c.v && c.v !== 0) || (a.v && a.v !== 0);

    // a repeated title row (statements from PDFs repeat it on every page)
    if (!date && headerWords.length && r.map(clean).filter((w, i) => w && w === headerWords[i]).length >= 2) continue;

    if (SUMMARY_WORDS.test(descCell) || (!date && SUMMARY_WORDS.test(r.find((x) => x) || ''))) {
      if (/opening|brought|b\/f/i.test(descCell + ' ' + (r.find((x) => x) || '')) && bal.v !== null) opening = bal.v;
      if (/closing|carried|c\/f/i.test(descCell + ' ' + (r.find((x) => x) || '')) && bal.v !== null) closing = bal.v;
      skipped.push({ reason: 'total', text: r.filter(Boolean).join(' ') });
      continue;
    }

    if (date && hasMoney) {
      const raw = descCell;
      let type = null, typeSrc = null, amount = null;
      if (m.debit >= 0 || m.credit >= 0) {
        const dv = d.v ? Math.abs(d.v) : 0, cv = c.v ? Math.abs(c.v) : 0;
        if (dv && !cv) { type = 'Expense'; amount = dv; typeSrc = 'columns'; }
        else if (cv && !dv) { type = 'Income'; amount = cv; typeSrc = 'columns'; }
        else if (dv && cv) { amount = Math.abs(cv - dv); type = cv > dv ? 'Income' : 'Expense'; typeSrc = 'columns'; }
      }
      if (amount === null && a.v) {
        amount = Math.abs(a.v);
        const word = cellAt(r, m.drcr);
        if (m.drcr >= 0 && /^(cr|c|credit|haben|income|deposit|gutschrift)\b/i.test(word)) { type = 'Income'; typeSrc = 'drcr'; }
        else if (m.drcr >= 0 && /^(dr|d|debit|soll|expense|withdrawal|lastschrift)\b/i.test(word)) { type = 'Expense'; typeSrc = 'drcr'; }
        else if (a.tag) { type = a.tag === 'cr' ? 'Income' : 'Expense'; typeSrc = 'drcr'; }
        else if (a.v < 0) { type = 'Expense'; typeSrc = 'sign'; }
      }
      if (amount === null) { skipped.push({ reason: 'no amount', text: r.filter(Boolean).join(' ') }); continue; }
      let time = parseTime(cellAt(r, m.time));
      if (!time && /\d:\d\d/.test(dateCell)) time = parseTime(dateCell);
      const curCell = cellAt(r, m.currency).toUpperCase();
      items.push({
        date, time, type, typeSrc, amount: round2(amount), raw, bal: bal.v, balTag: bal.tag,
        currency: CURRENCY_CODES.includes(curCell) ? curCell : null,
        category: cellAt(r, m.category) || '',
        negative: a.v !== null && a.v < 0,
      });
      continue;
    }

    // a wrapped narration line: only the description column has text
    const others = r.some((x, i) => x && i !== m.desc && (i === m.date || i === m.valueDate || i === m.debit || i === m.credit || i === m.amount || i === m.balance));
    if (!date && !hasMoney && descCell && !others && items.length) {
      const last = items[items.length - 1];
      last.raw = joinWrapped(last.raw, descCell);
      continue;
    }
    if (r.some(Boolean)) skipped.push({ reason: date ? 'no amount' : 'not a transaction', text: r.filter(Boolean).join(' ').slice(0, 80) });
  }
  if (!items.length) return { ok: false, reason: 'I found the columns but no transaction lines under them.', mapping: m, headerIndex, table: rows, confident: false };

  // ---- balance check: which way is the list sorted, and does every row follow from the one before?
  const hasBalance = items.filter((x) => x.bal !== null).length >= Math.max(2, items.length * 0.6);
  let ordered = items;
  let descending = false;
  if (hasBalance) {
    const score = (list) => {
      let ok = 0;
      for (let i = 1; i < list.length; i++) {
        const o = list[i - 1], n = list[i];
        if (o.bal === null || n.bal === null) continue;
        const delta = round2(n.bal - o.bal);
        if (Math.abs(Math.abs(delta) - n.amount) < 0.011 && (n.type === null || (delta >= 0) === (n.type === 'Income'))) ok++;
      }
      return ok;
    };
    const asc = score(items), desc = score([...items].reverse());
    descending = desc > asc || (desc === asc && items[0].date > items[items.length - 1].date);
    if (descending) ordered = [...items].reverse();
  } else if (items.length > 1 && items[0].date > items[items.length - 1].date) {
    ordered = [...items].reverse();
  }

  let verified = 0, bad = 0;
  ordered.forEach((it, i) => {
    it.check = 'none';
    if (!hasBalance || it.bal === null) return;
    if (i === 0) {
      it.check = 'first';
      if (it.type) opening = opening ?? round2(it.bal - (it.type === 'Income' ? it.amount : -it.amount));
      return;
    }
    const prev = ordered[i - 1];
    if (prev.bal === null) return;
    const delta = round2(it.bal - prev.bal);
    const fits = Math.abs(Math.abs(delta) - it.amount) < 0.011;
    if (fits && (it.type === null || (delta >= 0) === (it.type === 'Income'))) {
      it.check = 'ok'; verified++;
      if (it.type === null) { it.type = delta >= 0 ? 'Income' : 'Expense'; it.typeSrc = 'balance'; }
    } else { it.check = 'bad'; bad++; }
  });
  // anything still without a direction: negative numbers are spending; with no negatives at all, assume spending (card statements)
  const anyNegative = ordered.some((x) => x.negative);
  const guessed = ordered.some((x) => x.type === null);
  for (const it of ordered) if (it.type === null) { it.type = anyNegative ? 'Income' : 'Expense'; it.typeSrc = 'guess'; }
  if (closing === null && hasBalance) closing = ordered[ordered.length - 1].bal;

  // ---- readable names
  const dateFirst = ordered.map((x) => x.date);
  const out = ordered.map((it, i) => {
    const info = describe(it.raw, it.type);
    const row = {
      i, date: it.date, type: it.type, amount: it.amount, currency: it.currency || currency || defaultCurrency,
      desc: info.display, name: info.name, key: normalise(info.name) || normalise(it.raw) || 'unknown',
      note: info.note, kind: info.kind, raw: it.raw, check: it.check, typeSrc: it.typeSrc,
    };
    if (it.time) row.time = it.time;
    if (info.ref) row.ref = info.ref;
    else if (it.bal !== null) row.ref = `bal:${it.bal}`;
    if (it.category) row.fileCategory = it.category;
    return row;
  });
  out.sort((a, b) => (a.date === b.date ? (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : a.i - b.i : a.date < b.date ? -1 : 1));

  const sum = (t) => round2(out.filter((x) => x.type === t).reduce((a, x) => a + x.amount, 0));
  const status = !hasBalance ? 'unchecked' : bad === 0 ? 'verified' : 'partial';
  const summary = {
    count: out.length, from: dateFirst.reduce((a, b) => (a < b ? a : b)), to: dateFirst.reduce((a, b) => (a > b ? a : b)),
    expenses: sum('Expense'), income: sum('Income'), opening, closing,
    status, verified, bad, hasBalance, typeGuessed: guessed, descending,
  };
  const notes = [];
  if (!currency) notes.push('The statement does not say which currency it is in.');
  return { ok: true, rows: out, summary, notes, skipped, mapping: m, headerIndex, currency, currencyFound: !!currency, dayFirst, confident, table: rows };
}

// A narration that was wrapped onto the next line is usually cut in the middle of a word ("…/ICI" + "CI Bank/…").
function joinWrapped(a, b) {
  if (!a) return b;
  if ((a.match(/\//g) || []).length >= 2 && !/[\s\/]$/.test(a) && !/^[\s\/]/.test(b)) return a + b;
  return a + ' ' + b;
}

// ------------------------------------------------------------------ readable names

export const titleCase = (s) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (!letters) return t;
  const upper = letters === letters.toUpperCase(), lower = letters === letters.toLowerCase();
  if (!upper && !lower) return t;
  return t.toLowerCase().replace(/(^|[\s&.\-'(])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
};

const GENERIC_NOTE = /^(upi paymen\w*|payment (fr|fo)\w*|first paym\w*|execution|mandate re\w*|collect|upi|pay|payment|paid|sent|send money|upi mandate|autopay)$/i;
const BANK_WORD = /\b(bank|bnk|banking)\b|^(hdf|hdfc|icic|icici?|sbi|sbin|axis|utib|yes|yesb|kotak|kkbk|ibkl|idfb|punb|barb|cnrb|bkid|fbl|pty|ybl|ptsbi|okaxis|okicici|okhdfcbank|oksbi|apl|paytm)$/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const LONG_ID = /^(?=[A-Z0-9]*\d)[A-Z0-9]{10,}$/i;

function clip(s) {
  return s.replace(/\bTCS Rs[\d.]*/gi, '').replace(/\s+/g, ' ').replace(/^[\s\-:.,/]+|[\s\-:.,/]+$/g, '').trim();
}

export function describe(rawText, type = 'Expense') {
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  const out = { name: '', note: '', kind: 'other', ref: null, display: '' };
  const finish = () => {
    out.name = titleCase(clip(out.name));
    out.note = clip(out.note || '');
    out.display = out.note && out.note.toLowerCase() !== out.name.toLowerCase() ? `${out.name} · ${titleCase(out.note)}` : out.name;
    if (!out.display) { out.name = tidyDesc(raw); out.display = out.name; }
    return out;
  };
  const utr = raw.match(/(?:^|[^0-9])(\d{12})(?![0-9])/);
  if (utr) out.ref = utr[1];

  // UPI (every bank orders the pieces a little differently)
  if (/^UPI\b/i.test(raw)) {
    out.kind = 'upi';
    const parts = raw.split(/\s*\/\s*/);
    const generic = (p) => !p || /^(UPI|DR|CR|P2A|P2M|P2P|UPIAR|UPIAD)$/i.test(p) || /^\d+$/.test(p) || LONG_ID.test(p) || IFSC.test(p) || GENERIC_NOTE.test(p);
    if (parts.length >= 6 && /^\d{12}$/.test(parts[5] || '')) {
      // UPI / payee / UPI id / note / bank / reference / code   (ICICI)
      out.name = parts[1];
      const note = parts[3] || '';
      if (note && !GENERIC_NOTE.test(note)) out.note = note;
    } else if (parts.length >= 5 && /^(DR|CR)$/i.test(parts[1] || '') && /^\d{12}$/.test(parts[2] || '') && parts[3] && !generic(parts[3]) && !/@/.test(parts[3])) {
      // UPI / DR|CR / reference / payee / bank / UPI id / UPI   (SBI, HDFC, Axis …)
      out.name = parts[3];
    } else {
      const named = parts.filter((p) => !generic(p) && !/@/.test(p) && !BANK_WORD.test(p) && /[A-Za-z]{2}/.test(p));
      out.name = named[0] || parts.find((p) => !generic(p)) || '';
      if (named[1] && !/^[a-z0-9._-]+$/.test(named[1])) out.note = named[1];
    }
    return finish();
  }

  // Interac e-Transfer (Canada): the person is the useful part
  if (/^(interac\s+)?e-?\s?transfer\b/i.test(raw)) {
    if (/\bfee\b/i.test(raw)) { out.kind = 'charge'; out.name = 'Bank charges'; return finish(); }
    out.kind = 'etransfer';
    const rest = raw.replace(/^(interac\s+)?e-?\s?transfer\s*[-:]?\s*(sent|received|request|autodeposit|auto-deposit|auto deposit|from|to|cancelled|reclaim)?\s*[-:]?\s*(from|to)?\s*[-:]?\s*/i, '');
    out.name = rest.replace(/\b[A-Za-z0-9]{8,}\b$/, '').replace(/\s+\d{4,}.*$/, '').trim() || 'e-Transfer';
    return finish();
  }

  // cash from an ATM
  if (/^(NFS|ATM|ABM|VAT|MAT|ATW|CASH WDL|CASH WITHDRAWAL|EAW|NWD)\b|\b(ATM WDL|CASH WDL|ATM CASH|CASH WITHDRAWAL|ABM WITHDRAWAL)\b/i.test(raw)) {
    out.kind = 'cash';
    const parts = raw.split(/\s*\/\s*/);
    const place = parts.find((p, i) => i >= 2 && /^[A-Za-z][A-Za-z .]{3,}$/.test(p) && !LONG_ID.test(p));
    out.name = 'Cash withdrawal';
    out.note = place ? titleCase(place) : '';
    return finish();
  }

  // interest and bank charges
  if (/\bint\.?\s?pd\b|\binterest\b|\bint pd\b|zinsen/i.test(raw)) { out.kind = 'interest'; out.name = 'Interest'; out.ref = null; return finish(); }
  if (/\b(chrg|charges?|sms alert|annual fee|min bal|penalty|gst on|service tax)\b/i.test(raw) && !/^(UPI|NEFT|RTGS|IMPS)/i.test(raw)) {
    out.kind = 'charge'; out.name = 'Bank charges'; return finish();
  }

  // card payments at shops: MPS / POS / MSI / VPS / IPS / ECOM
  let m = raw.match(/^(MPS|POS|MSI|VPS|IPS|ECOM|PUR|DCARD|DC|CC)[\s\/]+(?:\d{4,6}X+\d{3,4}\s+)?([^\/]+)/i);
  if (m) {
    out.kind = 'card';
    out.name = m[2].replace(/\d{6,}.*$/, '');
    return finish();
  }

  // bank transfers: NEFT / RTGS / IMPS / INF / BIL
  m = raw.match(/^(NEFT|RTGS|IMPS|INF|INFT|BIL|BPAY|MMT)\b[\s:*\/-]*/i);
  if (m) {
    out.kind = m[1].toLowerCase();
    const pieces = raw.slice(m[0].length).split(/\s*[\/*-]\s*|:\s*/).map((p) => p.trim()).filter(Boolean);
    const useful = pieces.filter((p) => !IFSC.test(p) && !LONG_ID.test(p) && !/^\d+$/.test(p) && !BANK_WORD.test(p) && /[A-Za-z]{3}/.test(p));
    out.name = useful.find((p) => !/^\d{3,}[A-Za-z ]/.test(p)) || useful[0] || '';
    const noteRaw = pieces.find((p) => /^\d{3,4}[A-Za-z]/.test(p));
    if (noteRaw) out.note = noteRaw.replace(/^\d+/, '');
    return finish();
  }

  // cheque clearing
  m = raw.match(/^CLG\s*\/\s*([^\/]+)/i);
  if (m) { out.kind = 'cheque'; out.name = m[1]; out.note = type === 'Income' ? 'Cheque deposit' : 'Cheque'; return finish(); }

  // standing instructions: ACH / ECS / NACH / auto-debit
  m = raw.match(/^(ACH|ECS|NACH|SI|AUTOPAY|MANDATE)\b[\s\w]{0,3}[:\-\s]+(.+)$/i);
  if (m) {
    out.kind = 'autodebit';
    out.name = m[2].split(/\s*[\-\/]\s*(?=\d)/)[0];
    return finish();
  }

  out.name = tidyDesc(raw);
  return finish();
}

// Bank text is full of reference numbers and codes. Keep the words a person would recognise.
export function tidyDesc(text) {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/g, ' ').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
  t = t.replace(/\b(EREF|MREF|CRED|SVWZ|KREF|DEBT|ABWA|ABWE|IBAN|BIC)[:+]\S*/gi, ' ');
  t = t.replace(/\bDebitk\.?\s?\d*/gi, ' ').replace(/\b\d{4}-\d{2}\b/g, ' ');
  // shop branch numbers and the city/province tail Canadian cards add ("TIM HORTONS #1234 TORONTO ON")
  const PROV = '(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)';
  t = t.replace(/\s+#\s?\d+\b/g, ' ');
  t = t.replace(new RegExp(`\\s+(?:Richmond Hill|North York|New Westminster|Niagara Falls|St\\.? Catharines|Thunder Bay|Saint John|Red Deer|Quebec City|Mississauga|Scarborough|Etobicoke)\\s+${PROV}$`, 'i'), '');
  t = t.replace(new RegExp(`^(.{3,}?)\\s+[A-Za-z.'-]{3,}\\s+${PROV}$`, 'i'), (all, head) => (/\\b(pay|gift|top|log)$/i.test(head) ? all : head));
  t = t.replace(/\s{2,}/g, ' ').trim();
  const parts = t.split(/\s*\/+\s*|\s*\|\s*/).map((p) => p.trim()).filter((p) => {
    if (!p) return false;
    if (/^[0-9.,:\- ]+$/.test(p)) return false;
    if (/@/.test(p)) return false;
    if (/^(UPI|IMPS|NEFT|RTGS|POS|DR|CR|SEPA|ECOM|TXN|REF|MANDAT|MANDATE|ORDER|PAYMENT|PAYMENTS)$/i.test(p)) return false;
    if (p.length <= 2 && !/^[A-Za-z]{2}$/.test(p)) return false;
    return true;
  });
  let out = (parts.length ? parts.join(' · ') : t).replace(/\s+/g, ' ').trim();
  out = out.replace(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{8,}\b/g, '').replace(/\b\d{9,}\b/g, '').replace(/\s+·\s*·/g, ' ·').replace(/\s{2,}/g, ' ').replace(/^·\s*|\s*·$/g, '').trim();
  const ACRONYMS = new Set(['SBI', 'LIC', 'UPI', 'ATM', 'ABM', 'TTC', 'GST', 'HST', 'PST', 'CRA', 'BMO', 'RBC', 'TDS', 'EMI', 'SIP', 'USA', 'LLC', 'LLP', 'PVT', 'LTD', 'PNB', 'DMV', 'IRS', 'VAT', 'EUR', 'INR', 'CAD', 'USD']);
  if (!/[a-z]/.test(out)) out = out.replace(/\b[A-ZÄÖÜ]{3}\b/g, (w) => (ACRONYMS.has(w) ? w : w[0] + w.slice(1).toLowerCase()));
  out = out.replace(/\b[A-ZÄÖÜ]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase());
  return out || (text || '').trim();
}

// Our own export: Date, Type, Category, Amount, Currency, Description (…and optional Time, Tags)
export function isOwnExport(headers) {
  const w = headers.map(clean);
  return w.includes('date') && w.includes('amount') && w.includes('type') && w.includes('category') && w.includes('currency');
}

// ------------------------------------------------------------------ against what the person already has

// Marks rows that are already in the ledger.
//  'same'   the bank's reference number matches, the very same payment
//  'likely' no reference to compare, but same day, amount and direction and a shared word in the name
//  'maybe'  no reference to compare, same day, amount and direction only (perhaps typed in by hand)
// When both sides carry a reference and the references differ, they are two different payments, however alike they look.
const nameWords = (s) => new Set(String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
const shareWord = (a, b) => { const A = nameWords(a), B = nameWords(b); for (const w of A) if (B.has(w)) return true; return false; };

export function markDuplicates(rows, existing) {
  const cents = (x) => Math.round(x * 100);
  const used = new Set();
  const byRef = new Map(), byDay = new Map();
  for (const t of existing) {
    if (t.ref) { const k = `${t.currency}|${t.type}|${cents(t.amount)}|${t.ref}`; (byRef.get(k) || byRef.set(k, []).get(k)).push(t); }
    const k2 = `${t.date}|${t.currency}|${t.type}|${cents(t.amount)}`;
    (byDay.get(k2) || byDay.set(k2, []).get(k2)).push(t);
  }
  let exact = 0, likely = 0, possible = 0;
  for (const r of rows) r.dup = null;
  // the surest matches first, so a reference match is never used up by a looser one
  for (const r of rows) {
    if (!r.ref) continue;
    const list = byRef.get(`${r.currency}|${r.type}|${cents(r.amount)}|${r.ref}`) || [];
    const t = list.find((x) => !used.has(x));
    if (t) { used.add(t); r.dup = 'same'; exact++; }
  }
  for (const r of rows) {
    if (r.dup) continue;
    const list = (byDay.get(`${r.date}|${r.currency}|${r.type}|${cents(r.amount)}`) || []).filter((x) => !used.has(x) && !(x.ref && r.ref && x.ref !== r.ref));
    if (!list.length) continue;
    const named = list.find((x) => shareWord(x.desc, r.desc) || shareWord(x.desc, r.raw));
    const t = named || list[0];
    used.add(t);
    if (named) { r.dup = 'likely'; likely++; } else { r.dup = 'maybe'; possible++; }
  }
  return { exact, likely, possible };
}
