// Turns a few typed words ("250 chai", "paid 1,200 electricity yesterday") or a pasted bank SMS into transactions.
// Plain rules only: nothing is sent anywhere, no AI service, no key needed.
import { parseTime, todayISO, CURRENCY_CODES } from './store.js';
import { categorise, normalise } from './categorize.js';
import { titleCase } from './statement.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\\.?';
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DOLLAR_FAMILY = ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'];

const monthNum = (w) => MONTHS[w.toLowerCase().slice(0, 4)] ?? MONTHS[w.toLowerCase().slice(0, 3)];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return iso(d); };
const validDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
const cleanSpaces = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:\-–—]+|[\s,.;:\-–—]+$/g, '').trim();
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function dollarCurrency(ctx) { return DOLLAR_FAMILY.includes(ctx.currency) ? ctx.currency : 'USD'; }
function currencyFromWord(w, ctx) {
  const t = String(w || '').toLowerCase().replace(/\.$/, '');
  if (!t) return null;
  if (['₹', 'rs', 'inr', 'rupee', 'rupees'].includes(t)) return 'INR';
  if (['€', 'eur', 'euro', 'euros'].includes(t)) return 'EUR';
  if (t === '£') return 'GBP';
  if (['$', 'dollar', 'dollars', 'bucks'].includes(t)) return dollarCurrency(ctx);
  const up = t.toUpperCase();
  return CURRENCY_CODES.includes(up) ? up : null;
}

// ------------------------------------------------------------------ dates in a sentence

// Finds "yesterday", "on Friday", "12 Nov", "12/11" … returns the date and the text without it.
export function takeDate(text, ctx) {
  const today = ctx.today || todayISO();
  let t = text, m;
  const cut = (re) => { t = t.replace(re, ' '); };
  if ((m = t.match(/\bday before yesterday\b/i))) { cut(/\bday before yesterday\b/i); return { date: addDays(today, -2), text: t }; }
  if ((m = t.match(/\b(\d{1,2})\s+days?\s+ago\b/i)) && +m[1] <= 366) { t = t.replace(m[0], ' '); return { date: addDays(today, -+m[1]), text: t }; }
  if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)) && validDate(+m[1], +m[2], +m[3])) { t = t.replace(m[0], ' '); return { date: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, text: t }; }
  if ((m = t.match(/\b(yesterday|yday|last night)\b/i))) { cut(/\b(yesterday|yday|last night)\b/i); return { date: addDays(today, -1), text: t }; }
  if ((m = t.match(/\b(today|tonight|this morning|this evening|this afternoon)\b/i))) { cut(/\b(today|tonight|this morning|this evening|this afternoon)\b/i); return { date: today, text: t }; }
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}(?:,?\\s+(\\d{4}))?\\b`, 'i');
  const md = new RegExp(`\\b${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
  const build = (day, mon, year) => {
    const ty = fromISO(today).getFullYear();
    let y = year ? +year : ty;
    if (!validDate(y, mon, day)) return null;
    let s = `${y}-${pad(mon)}-${pad(day)}`;
    if (!year && s > addDays(today, 7)) { y -= 1; if (!validDate(y, mon, day)) return null; s = `${y}-${pad(mon)}-${pad(day)}`; }
    return s;
  };
  if ((m = t.match(dm))) { const d = build(+m[1], monthNum(m[2]), m[3]); if (d) { t = t.replace(dm, ' '); return { date: d, text: t }; } }
  if ((m = t.match(md))) { const d = build(+m[2], monthNum(m[1]), m[3]); if (d) { t = t.replace(md, ' '); return { date: d, text: t }; } }
  const nth = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i;
  if ((m = t.match(nth))) {
    // "on the 25th": the latest such day that is not in the future
    const now = fromISO(today); let y = now.getFullYear(), mo = now.getMonth() + 1; const day = +m[1];
    if (day > now.getDate()) { mo -= 1; if (mo < 1) { mo = 12; y -= 1; } }
    if (validDate(y, mo, day)) { t = t.replace(nth, ' '); return { date: `${y}-${pad(mo)}-${pad(day)}`, text: t }; }
  }
  const slash = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/;
  if ((m = t.match(slash))) {
    let a = +m[1], b = +m[2], y = m[3] ? +m[3] : null;
    if (y !== null && y < 100) y += 2000;
    const dayFirst = ctx.dayFirst !== false;
    let day = dayFirst ? a : b, mon = dayFirst ? b : a;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    const d = (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) ? build(day, mon, y) : null;
    if (d) { t = t.replace(slash, ' '); return { date: d, text: t }; }
  }
  const dow = /\b(?:(last|on|this)\s+(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?|(sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i;
  if ((m = t.match(dow))) {
    const target = DOW[(m[2] || m[3]).toLowerCase().slice(0, 3)];
    const now = fromISO(today).getDay();
    let diff = (now - target + 7) % 7;
    if (diff === 0 && m[1] && m[1].toLowerCase() === 'last') diff = 7;
    t = t.replace(dow, ' ');
    return { date: addDays(today, -diff), text: t };
  }
  return { date: null, text: t };
}

// ------------------------------------------------------------------ a typed sentence

const AMOUNT_RE = /(^|[^A-Za-z0-9.,])(?:(₹|rs\.?|inr|€|eur|\$|usd|cad|gbp|£|aud|nzd|chf|aed|sgd)\s*)?(\+?)(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(k|lakhs?|lacs?)\b)?(?:\s*(rs\.?|rupees?|inr|euros?|eur|usd|cad|gbp|aud|dollars?|bucks)\b)?/gi;

function findAmount(text, ctx) {
  const found = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    let v = parseFloat(m[4].replace(/,/g, ''));
    if (!Number.isFinite(v) || v <= 0) continue;
    const mult = m[5] ? (m[5].toLowerCase() === 'k' ? 1000 : 100000) : 1;
    v = Math.round(v * mult * 100) / 100;
    const word = m[2] || m[6] || '';
    const lead = m[1].length;
    found.push({ value: v, currency: currencyFromWord(word, ctx), marked: !!word, plus: m[3] === '+', start: m.index + lead, end: m.index + m[0].length, whole: m[0].slice(lead) });
  }
  if (!found.length) return null;
  let pick = found.find((f) => f.marked);
  if (!pick) {
    pick = found[0];
    // "2 tea 40": the small first number is a count
    if (found.length > 1 && Number.isInteger(pick.value) && pick.value < 10 && found.slice(1).some((f) => f.value >= 10)) pick = found.slice(1).find((f) => f.value >= 10);
  }
  return pick;
}

const INCOME_WORDS = /\b(got|received|recieved|earned|salary|credited|refund(?:ed)?|income|bonus|cashback|reimbursed|reimbursement|interest|dividend|stipend|honorarium|paid me|gave me|sent me)\b/i;
const INCOME_STRIP = /\b(got|received|recieved|earned|credited|paid me|gave me|sent me|income)\b/gi;
const FILLER = /\b(paid|pay|paying|spent|spend|spending|for|on|to|at|the|a|an|my|rs|rupees?|bought|buy|purchased|got|gave|give|of|from|via|using|by|upi|gpay|phonepe|paytm|cash|card|just|only|about|around|approx|approximately|was|were|is|it|me|i|we|today|yesterday|please|add)\b/gi;

const PRONOUN = /^(?:i|me|we|us|you|he|him|she|her|they|them|someone|somebody|everyone|friend|my|mine|the|a)$/i;
function peopleFrom(text) {
  return text.split(/\s*(?:,|&|\band\b|\+)\s*/i).map((x) => cleanSpaces(cleanSpaces(x).replace(/^(to|with|from|by)\s+/i, '').replace(/\s+(on|at|for|in|by|of|since)$/i, ''))).filter((x) => /[A-Za-z]/.test(x) && x.split(' ').length <= 3 && !PRONOUN.test(x));
}
const nice = (s) => cleanSpaces(s).replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function parseOne(chunk, ctx, date) {
  let text = chunk.trim();
  if (!text) return null;
  const when = takeDate(text, ctx);
  text = when.text;
  const tm = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  let time;
  if (tm) { time = parseTime(tm[0].replace(/^at\s+/i, '')) || undefined; text = text.replace(tm[0], ' '); }
  const amt = findAmount(text, ctx);
  if (!amt) return null;
  const rest = (text.slice(0, amt.start) + ' ' + text.slice(amt.end)).replace(/\s+/g, ' ');
  const item = {
    source: 'sentence', kind: 'tx', type: 'Expense', amount: amt.value, currency: amt.currency || ctx.currency,
    date: when.date || date || ctx.today || todayISO(), time, name: '', note: '', ref: null, raw: '', owe: [], repay: null, lentTo: null,
  };
  let words = rest;

  // money I owe somebody else is not tracked, and must never land under "who owes me"
  if (/\b(?:i|we)\s+owe\b|^\s*owe\s|\bowe\s+(?!me\b|us\b)[a-z]/i.test(rest)) return { ...item, kind: 'skip', why: 'owe' };
  // "borrowed 500 from Ravi": money came in to me
  let m = words.match(/^\s*(?:i\s+|we\s+)?borrowed\b.*?\bfrom\s+(.+)$/i);
  if (m && peopleFrom(m[1]).length === 1) { item.type = 'Income'; item.name = `Borrowed from ${nice(peopleFrom(m[1])[0])}`; item.unsure = true; return item; }
  // somebody paid me back
  m = words.match(/^\s*(.+?)\s+(?:paid|gave|gives|returned|sent|repaid|settled)(?:\s+me)?\s*(?:back)?\s*$/i)
    || words.match(/\bback\s+from\s+(.+)$/i) || words.match(/^\s*(.+?)\s+(?:returned|repaid|settled)\b/i);
  if (m && /\b(back|returned|repaid|settled)\b/i.test(rest) && peopleFrom(m[1]).length === 1) {
    item.kind = 'repay'; item.type = 'Income'; item.repay = { person: nice(peopleFrom(m[1])[0]) };
    return item;
  }
  // "Ravi owes me 300": ledger only, no transaction
  if ((m = words.match(/^\s*(.+?)\s+owes?\b/i)) && peopleFrom(m[1]).length === 1) {
    item.kind = 'debt'; item.owe = [{ person: nice(peopleFrom(m[1])[0]), amount: item.amount }]; item.name = 'Owed';
    return item;
  }
  if (/\bowes?\s+(?:me|us)\b/i.test(rest)) return { ...item, kind: 'skip', why: 'name' };
  // lent money
  if ((m = words.match(/\b(?:lent|loaned|lend|loan)(?:\s+to)?\s+(.+)$/i)) || (m = words.match(/^\s*(.+?)\s+borrowed\b/i))) {
    const who = peopleFrom(m[1]);
    if (who.length === 1) {
      const person = nice(who[0]);
      item.lentTo = person; item.owe = [{ person, amount: item.amount }]; item.name = `Lent to ${person}`;
      return item;
    }
    if (!who.length) return { ...item, kind: 'skip', why: 'name' };
  }
  // split a bill
  if ((m = words.match(/^(.*?)\bsplit\b(.*?)\bwith\s+(.+)$/i))) {
    const who = peopleFrom(m[3]);
    if (who.length) {
      const share = Math.round((item.amount / (who.length + 1)) * 100) / 100;
      item.owe = who.map((p) => ({ person: nice(p), amount: share }));
      words = m[1] + ' ' + m[2];
    }
  }
  if (INCOME_WORDS.test(rest) || amt.plus) {
    item.type = 'Income';
    if (/\bsalary\b/i.test(rest)) item.name = 'Salary';
  }
  if (!item.name) {
    const name = cleanSpaces(words.replace(INCOME_STRIP, ' ').replace(FILLER, ' ').replace(/\/-/g, ' ').replace(/\bsplit\b/gi, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' '));
    item.name = name ? (name.split(' ').length <= 4 ? nice(name) : capFirst(name)) : '';
  }
  return item;
}

// Pieces of one sentence that are really several ("250 chai, 100 auto")
function pairs(line) {
  if (/[,&+]|\band\b|\b(?:lent|loan|split|owes?|back|borrowed|yesterday|today|ago|on|last|at|from|with|for|paid|am|pm)\b/i.test(line)) return null;
  const AM = /(?:₹|rs\.?\s*|\$)?\d[\d,]*(?:\.\d+)?k?/gi;
  const nums = [...line.matchAll(AM)];
  if (nums.length < 2) return null;
  const words = line.replace(AM, ' ').trim();
  if (!/^[A-Za-z][A-Za-z' ]*$/.test(words)) return null;
  const startsWithAmount = nums[0].index === 0 || /^\s*(?:₹|rs|\$)/i.test(line) && nums[0].index <= 3;
  const endsWithAmount = nums[nums.length - 1].index + nums[nums.length - 1][0].length >= line.trim().length;
  if (startsWithAmount === endsWithAmount) return null; // "2 tea 40" is ambiguous: leave it alone
  const cuts = startsWithAmount ? nums.slice(1).map((n) => n.index) : nums.slice(0, -1).map((n) => n.index + n[0].length);
  const out = []; let from = 0;
  for (const c of cuts) { out.push(line.slice(from, c).trim()); from = c; }
  out.push(line.slice(from).trim());
  return out.every((p) => (p.match(AM) || []).length === 1 && /[A-Za-z]/.test(p)) ? out : null;
}

function chunks(text, ctx) {
  const lines = text.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const when = takeDate(line, ctx);
    const pr = pairs(when.text.trim());
    if (pr) { out.push(...pr); if (when.date) out.date = when.date; continue; }
    const bits = line.replace(/(\d),(?=\d)/g, '$1\u0001').split(/(,|\s+&\s+|\s+\band\b\s+|\s\+\s)/i).map((x) => x.replace(/\u0001/g, ','));
    const merged = [];
    for (let i = 0; i < bits.length; i += 2) {
      const piece = bits[i].trim();
      if (!piece) continue;
      if (/\d/.test(takeDate(piece, ctx).text) || !merged.length) merged.push(piece);
      else merged[merged.length - 1] += (bits[i - 1] || ' ') + piece; // "with Ravi and Meena" stays whole
    }
    out.push(...merged);
  }
  return out;
}

export function parseSentence(text, ctx) {
  const parts = chunks(text, ctx);
  // one date spoken anywhere ("yesterday: 250 chai, 100 auto") covers the pieces that name none
  let shared = parts.date || null;
  if (!shared) for (const p of parts) { const d = takeDate(p, ctx).date; if (d) { shared = d; break; } }
  const items = [];
  for (const p of parts) { const it = parseOne(p, ctx, shared); if (it && it.kind !== 'skip') items.push(it); else if (it) items.skipped = it.why || 'owe'; }
  return items;
}

// ------------------------------------------------------------------ a pasted bank message

const DEBIT_RE = /\b(debited|debit|spent|withdrawn|withdrawal|purchase|purchased|paid|sent|deducted|charged|payment of|transferred)\b/i;
const CREDIT_RE = /\b(credited|credit|received|deposited|deposit|refund(?:ed)?|reversed|reversal|cashback)\b/i;
const BANKY = /(a\/c|acct|account|\bcard\b|\bupi\b|\bvpa\b|\bbank\b|avl\.? ?bal|available bal|\bbal\b|\bref\b|\brrn\b|e-?transfer|\bneft\b|\bimps\b|\brtgs\b|\batm\b|\bbalance\b|\binterac\b)/i;
const SMS_AMOUNT = /(?:(?:rs\.?|inr|₹|usd|cad|eur|gbp|aud|us\$|ca\$|c\$|\$|€|£)\s*)(\d[\d,]*(?:\.\d{1,2})?)|\b(?:debited|credited|spent|paid|sent|received|withdrawn|charged)\s*(?:for|by|with|of|:)?\s*(\d[\d,]*(?:\.\d{1,2})?)\b/gi;

export function looksLikeBankMessage(text) {
  const t = String(text || '');
  if (!/\d/.test(t) || !(DEBIT_RE.test(t) || CREDIT_RE.test(t))) return false;
  if (!BANKY.test(t)) return false;
  return /(?:rs\.?|inr|₹|\$|€|£|cad|usd|debited|credited)\s*[\d]/i.test(t) || /\bdebited\b|\bcredited\b/i.test(t);
}

function splitMessages(text) {
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => looksLikeBankMessage(l))) return lines;
  return [text.trim()];
}

function vpaName(handle) {
  const local = handle.split('@')[0].replace(/[0-9._\-]+/g, ' ').trim();
  return /[A-Za-z]{3}/.test(local) ? titleCase(local.replace(/\s+/g, ' ')) : '';
}

function smsDate(text, ctx) {
  let m;
  if ((m = text.match(new RegExp(`\\b(\\d{1,2})[-/ ]?${MON_RE}[-/ ,]*(\\d{2,4})\\b`, 'i')))) {
    const mon = monthNum(m[2]);
    let y = +m[3]; if (y < 100) y += 2000;
    if (mon && validDate(y, mon, +m[1])) return `${y}-${pad(mon)}-${pad(+m[1])}`;
  }
  if ((m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)) && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = text.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/))) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    const dayFirst = ctx.dayFirst !== false;
    let day = dayFirst ? a : b, mon = dayFirst ? b : a;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];
    if (validDate(y, mon, day)) return `${y}-${pad(mon)}-${pad(day)}`;
  }
  if ((m = text.match(new RegExp(`\\b${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i')))) {
    const mon = monthNum(m[1]);
    if (mon && validDate(+m[3], mon, +m[2])) return `${m[3]}-${pad(mon)}-${pad(+m[2])}`;
  }
  return null;
}

function smsPayee(t, type) {
  const stop = '(?=\\s+(?:on|ref\\w*|upi|via|not you|if you|call|avl|available|bal|balance|info|from|using|dated|date|for|of|with|was)\\b|\\s*\\(|\\s*[.,;:]\\s|\\s*[.,;:]?$)';
  const name = '([A-Za-z][A-Za-z0-9 .&\'*#\\-]{1,40}?)';
  let m;
  // e-Transfers
  if ((m = t.match(new RegExp(`e-?\\s?transfer\\s+(?:from|to)\\s+${name}${stop}`, 'i')))) return { name: m[1], kind: 'etransfer' };
  if (type === 'Income' && (m = t.match(new RegExp(`\\bfrom\\s+${name}${stop}`, 'i'))) && !/\ba\/c|acct|account/i.test(m[1])) return { name: m[1] };
  // UPI handle, sometimes followed by the person's name
  if ((m = t.match(/\b(?:to|from|by)\s+(?:VPA\s+)?([\w.\-]+@[\w]+)\s*(?:\(?\s*([A-Z][A-Za-z .'-]{2,30}?)\s*\)?)?(?=\s+(?:on|ref|upi)\b|\s*\(|[.,;]|$)/i))) {
    const label = m[2] && !/^(upi|ref|on)$/i.test(m[2].trim()) ? m[2] : vpaName(m[1]);
    if (label) return { name: label, kind: 'upi' };
    return { name: 'UPI payment', kind: 'upi' };
  }
  // "; NAME credited" (ICICI debit alerts)
  if ((m = t.match(/[;:]\s*([A-Za-z][A-Za-z0-9 .&'-]{1,40}?)\s+credited\b/i)) && !/\ba\/c|acct|account|bank/i.test(m[1])) return { name: m[1] };
  // card spends: "at SWIGGY"
  if ((m = t.match(new RegExp(`\\bat\\s+${name}${stop}`, 'i')))) return { name: m[1], kind: 'card' };
  // "trf to NAME", "To NAME On ..."
  if ((m = t.match(new RegExp(`\\b(?:trf to|transfer to|to)\\s+(?!a\\/c|acct|account|vpa|your)${name}${stop}`, 'i')))) return { name: m[1] };
  if (type === 'Income' && (m = t.match(new RegExp(`\\bby\\s+(?!a\\/c|acct|account)${name}${stop}`, 'i')))) return { name: m[1] };
  if ((m = t.match(/\bInfo[:\-\s]+(?:UPI\/)?(?:[A-Z]+\/)?(?:\d+\/)?([A-Za-z][A-Za-z0-9 .&'\/-]{2,40}?)(?:\.|\s+Avl|\s+Bal|$)/i))) return { name: m[1].split('/').filter((x) => /[A-Za-z]{3}/.test(x)).pop() || m[1] };
  return null;
}

function parseMessage(msg, ctx) {
  const t = msg.replace(/\s+/g, ' ').trim();
  if (!looksLikeBankMessage(t)) return null;
  // direction: whichever of the two kinds of word comes first
  const d = t.search(DEBIT_RE), c = t.search(CREDIT_RE);
  let type = d >= 0 && (c < 0 || d < c) ? 'Expense' : 'Income';
  if (d < 0 && c < 0) return null;
  // amount: the first sum that is not a balance or a limit
  let amount = null, currency = null;
  for (const m of t.matchAll(SMS_AMOUNT)) {
    const before = t.slice(Math.max(0, m.index - 22), m.index);
    if (/(avl|avail|available|bal|balance|limit|outstanding|due)[^a-z]{0,10}$/i.test(before)) continue;
    const v = parseFloat((m[1] || m[2]).replace(/,/g, ''));
    if (!(v > 0)) continue;
    amount = Math.round(v * 100) / 100;
    const sym = (m[0].match(/^(rs\.?|inr|₹|usd|cad|eur|gbp|aud|us\$|ca\$|c\$|\$|€|£)/i) || [])[1];
    currency = sym ? (/^ca\$|^c\$/i.test(sym) ? 'CAD' : /^us\$/i.test(sym) ? 'USD' : currencyFromWord(sym, ctx)) : null;
    break;
  }
  if (!amount) return null;
  const ref = (t.match(/(?:ref(?:erence)?(?:\s*(?:no|number|#))?\.?|upi(?:\s*ref(?:\s*no)?)?|rrn|txn\s*(?:id|no)?)\s*[:.\-#]?\s*(\d{9,14})\b/i) || t.match(/(?:^|\D)(\d{12})(?!\d)/) || [])[1] || null;
  const date = smsDate(t, ctx) || ctx.today || todayISO();
  const tm = t.match(/\b(\d{1,2}:\d{2})(?::\d{2})?\b/);
  const payee = smsPayee(t, type);
  const cash = /\b(atm|abm|cash withdrawal|cash wdl)\b/i.test(t) && type === 'Expense';
  let name = payee ? cleanSpaces(payee.name.replace(/\b(ref\w*|upi|on)\b.*$/i, '').replace(/\s?#\s?\d+/g, '').replace(/\d{6,}.*$/, '')) : '';
  if (cash) name = 'Cash withdrawal';
  if (/\bbank\b/i.test(name) && /\b(a\/c|acct)\b/i.test(t) && !cash) name = '';
  if (!name) name = /\bupi\b/i.test(t) ? 'UPI payment' : type === 'Income' ? 'Money received' : 'Payment';
  name = /[a-z]/.test(name) && /[A-Z]/.test(name) && !/^[A-Z .&'-]+$/.test(name) ? name : titleCase(name);
  return {
    source: 'sms', kind: 'tx', type, amount, currency: currency || ctx.currency, date, time: tm ? parseTime(tm[1]) || undefined : undefined,
    name: capFirst(name), note: '', ref, raw: t.slice(0, 160), owe: [], repay: null, lentTo: null, cashKind: cash,
  };
}

export function parseMessages(text, ctx) {
  const items = [];
  for (const m of splitMessages(text)) { const it = parseMessage(m, ctx); if (it) items.push(it); }
  return items;
}

// ------------------------------------------------------------------ entry point

function fallbackCategory(categories, type) {
  const of = categories.filter((c) => c.type === type);
  return (of.find((c) => /^other/i.test(c.name)) || of[of.length - 1] || {}).name || '';
}

// Reads whatever was typed or pasted. Gives back rows ready to preview: each knows its category, and whether the guess is a sure one.
export function readText(text, ctx) {
  const t = String(text || '').trim();
  if (!t) return { kind: 'empty', items: [] };
  const sms = looksLikeBankMessage(t);
  if (!sms && (t.length > 140 || /\botp\b|one.?time password|\bcvv\b/i.test(t))) return { kind: 'sentence', items: [] };
  const items = sms ? parseMessages(t, ctx) : parseSentence(t, ctx);
  if (!sms && !items.length && items.skipped === 'owe') return { kind: 'sentence', items: [], hint: 'Money you owe to others is not tracked here. Who owes me is for money others owe you.' };
  if (!sms && !items.length && items.skipped === 'name') return { kind: 'sentence', items: [], hint: 'Say who it is, for example “lent Ravi 500” or “Ravi owes me 300”.' };
  const use = items.length || !sms ? items : parseSentence(t, ctx);
  for (const it of use) {
    if (it.kind !== 'tx') continue;
    const row = { name: it.name, key: normalise(it.name), note: it.note, kind: it.cashKind ? 'cash' : it.kind === 'tx' && it.source === 'sms' && it.name === 'Cash withdrawal' ? 'cash' : 'other', type: it.type };
    let c = null;
    if (it.name && !it.lentTo) c = categorise(row, ctx.index, ctx.categories);
    if (c && ctx.categories.some((x) => x.type === it.type && x.name === c.category)) { it.category = c.category; it.unsure = !!c.weak; it.source2 = c.source; }
    else { it.category = fallbackCategory(ctx.categories, it.type); it.unsure = !it.lentTo; }
    it.key = row.key;
  }
  // an amount that rounds to nothing, or is far too big to be money, is a misread
  const sane = (n) => n >= 0.01 && n <= 1e9;
  const clean = use.filter((it) => sane(it.amount) && (it.owe || []).every((o) => sane(o.amount)));
  return { kind: sms && clean.length ? 'sms' : 'sentence', items: clean };
}
