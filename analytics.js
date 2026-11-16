// Pure calculations over the ledger: month summaries, insights, sentences.
import { parseISODate } from './store.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const COLOURED_LIMIT = 6;

export const keyOf = (iso) => ({ year: +iso.slice(0, 4), month: +iso.slice(5, 7) });
export const keyEq = (a, b) => a.year === b.year && a.month === b.month;
export const keyStr = (k) => `${k.year}-${String(k.month).padStart(2, '0')}`;
export const keyTitle = (k) => `${MONTHS[k.month - 1]} ${k.year}`;
export const keyShort = (k) => MONTHS_SHORT[k.month - 1];
export const prevKey = (k) => (k.month === 1 ? { year: k.year - 1, month: 12 } : { year: k.year, month: k.month - 1 });
export const nextKey = (k) => (k.month === 12 ? { year: k.year + 1, month: 1 } : { year: k.year, month: k.month + 1 });
export const currentKey = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
export const daysInMonth = (k) => new Date(k.year, k.month, 0).getDate();
export const inMonth = (t, k) => t.date.startsWith(keyStr(k));

export function fmtMoney(amount, code) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}
export function fmtSigned(amount, code) {
  const text = fmtMoney(Math.abs(amount), code);
  if (amount > 0.004) return '+' + text;
  if (amount < -0.004) return '−' + text;
  return text;
}
export const fmtPct = (x) => `${Math.round(x * 100)}%`;
export const fmtDay = (iso) => parseISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
export const fmtDayFull = (iso) => parseISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function sortedNames(map) {
  return [...map.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : b[1] - a[1])).map((e) => e[0]);
}

export function rank(monthMap, allTimeMap, total) {
  const slots = new Map();
  sortedNames(allTimeMap).slice(0, COLOURED_LIMIT).forEach((n, i) => slots.set(n, i));
  return sortedNames(monthMap).map((name) => {
    const amount = monthMap.get(name);
    return { name, total: amount, share: total > 0 ? amount / total : 0, slot: slots.has(name) ? slots.get(name) : null };
  });
}

export function slices(totals) {
  const out = [];
  let rest = 0;
  for (const t of totals) {
    if (t.slot !== null) out.push({ name: t.name, total: t.total, slot: t.slot });
    else rest += t.total;
  }
  if (rest > 0) out.push({ name: 'Other categories', total: rest, slot: null });
  return out;
}

export function summary(items, key) {
  const prev = prevKey(key);
  const incomeAll = new Map(), expenseAll = new Map(), incomeMonth = new Map(), expenseMonth = new Map();
  const s = { income: 0, expense: 0, count: 0, previousIncome: 0, previousExpense: 0, largestExpense: null };
  for (const t of items) {
    const isIncome = t.type === 'Income';
    const all = isIncome ? incomeAll : expenseAll;
    all.set(t.category, (all.get(t.category) || 0) + t.amount);
    if (inMonth(t, prev)) { if (isIncome) s.previousIncome += t.amount; else s.previousExpense += t.amount; }
    if (!inMonth(t, key)) continue;
    s.count += 1;
    if (isIncome) { s.income += t.amount; incomeMonth.set(t.category, (incomeMonth.get(t.category) || 0) + t.amount); }
    else {
      s.expense += t.amount; expenseMonth.set(t.category, (expenseMonth.get(t.category) || 0) + t.amount);
      if (!s.largestExpense || t.amount > s.largestExpense.amount) s.largestExpense = t;
    }
  }
  s.balance = s.income - s.expense;
  s.incomeByCategory = rank(incomeMonth, incomeAll, s.income);
  s.expenseByCategory = rank(expenseMonth, expenseAll, s.expense);
  return s;
}

export function totalsByMonth(items) {
  const map = new Map();
  for (const t of items) {
    const k = keyStr(keyOf(t.date));
    const v = map.get(k) || { income: 0, expense: 0 };
    if (t.type === 'Income') v.income += t.amount; else v.expense += t.amount;
    map.set(k, v);
  }
  return map;
}

export function trend(items, key, months = 6) {
  const totals = totalsByMonth(items);
  const keys = [];
  let cursor = key;
  for (let i = 0; i < months; i++) { keys.unshift(cursor); cursor = prevKey(cursor); }
  return keys.map((k) => { const v = totals.get(keyStr(k)) || { income: 0, expense: 0 }; return { key: k, label: keyShort(k), income: v.income, expense: v.expense, balance: v.income - v.expense }; });
}

export function positiveStreak(items, key) {
  const totals = totalsByMonth(items);
  let count = 0, cursor = key;
  for (;;) {
    const v = totals.get(keyStr(cursor));
    if (!v || (v.income === 0 && v.expense === 0)) break;
    if (v.income - v.expense >= 0) { count += 1; cursor = prevKey(cursor); } else break;
  }
  return count;
}

export function budgets(categories, expenses, currency) {
  const spent = new Map(expenses.map((e) => [e.name, e.total]));
  return categories
    .filter((c) => c.type === 'Expense' && c.budget > 0 && c.budgetCurrency === currency)
    .map((c) => { const s = spent.get(c.name) || 0; return { name: c.name, limit: c.budget, spent: s, ratio: s / c.budget, remaining: c.budget - s }; })
    .sort((a, b) => (a.ratio === b.ratio ? a.name.localeCompare(b.name) : b.ratio - a.ratio));
}

export function quickAddItems(items, limit = 6) {
  const recent = [...items].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 200);
  const counts = new Map(), samples = new Map(), latest = new Map();
  for (const t of recent) {
    const k = [t.type, t.category.toLowerCase(), (t.desc || '').toLowerCase(), Math.round(t.amount * 100), t.currency].join('|');
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!samples.has(k)) { samples.set(k, t); latest.set(k, t.date); }
  }
  return [...counts.entries()].filter(([, c]) => c >= 2)
    .sort((a, b) => (a[1] === b[1] ? (latest.get(a[0]) < latest.get(b[0]) ? 1 : -1) : b[1] - a[1]))
    .slice(0, limit).map(([k]) => samples.get(k));
}

export function weekdayAverages(items, key, daysCounted) {
  const totals = new Array(7).fill(0), occurrences = new Array(7).fill(0);
  for (const t of items) if (t.type === 'Expense' && inMonth(t, key)) totals[parseISODate(t.date).getDay()] += t.amount;
  for (let d = 1; d <= Math.max(daysCounted, 1); d++) occurrences[new Date(key.year, key.month - 1, d).getDay()] += 1;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((w) => ({ weekday: w, name: WEEKDAYS_SHORT[w], average: totals[w] / Math.max(occurrences[w], 1) }));
}

export function dailyTotals(items, key) {
  const n = daysInMonth(key);
  const totals = new Array(n + 1).fill(0);
  for (const t of items) if (t.type === 'Expense' && inMonth(t, key)) totals[+t.date.slice(8, 10)] += t.amount;
  return Array.from({ length: n }, (_, i) => ({ day: i + 1, total: totals[i + 1] }));
}

export function movers(current, items, prev, limit = 5) {
  const before = new Map();
  for (const t of items) if (t.type === 'Expense' && inMonth(t, prev)) before.set(t.category, (before.get(t.category) || 0) + t.amount);
  const now = new Map(current.map((c) => [c.name, c.total]));
  const names = new Set([...before.keys(), ...now.keys()]);
  return [...names].map((name) => ({ name, now: now.get(name) || 0, before: before.get(name) || 0 }))
    .map((m) => ({ ...m, change: m.now - m.before }))
    .filter((m) => Math.abs(m.change) >= 0.005)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, limit);
}

export function insights(items, categories, key, currency, now = new Date()) {
  const s = summary(items, key);
  const isCurrent = keyEq(key, currentKey());
  const dim = daysInMonth(key);
  const daysCounted = isCurrent ? Math.max(now.getDate(), 1) : dim;
  const result = {
    key, summary: s, isCurrentMonth: isCurrent, daysCounted, daysInMonth: dim,
    perDay: daysCounted > 0 ? s.expense / daysCounted : 0,
    projectedExpense: isCurrent && daysCounted > 0 ? (s.expense / daysCounted) * dim : s.expense,
    savingsRate: s.income > 0 ? Math.max(Math.min(s.balance / s.income, 1), -1) : 0,
    weekdays: weekdayAverages(items, key, daysCounted),
    daily: dailyTotals(items, key),
    movers: movers(s.expenseByCategory, items, prevKey(key)),
    balanceTrend: trend(items, key),
    streak: positiveStreak(items, key),
    budgets: budgets(categories, s.expenseByCategory, currency),
  };
  result.sentences = sentences(result, currency);
  result.tiles = tiles(result, currency);
  return result;
}

export function sentences(ins, currency) {
  const s = ins.summary;
  const money = (v) => fmtMoney(v, currency);
  const pct = (v) => fmtPct(Math.abs(v));
  const title = keyTitle(ins.key);
  const lines = [];
  if (s.count === 0) return [`Nothing was recorded in ${title}.`];

  if (s.income > 0 && s.balance >= 0) lines.push(`In ${title} you earned ${money(s.income)} and spent ${money(s.expense)}, keeping ${money(s.balance)} (${pct(ins.savingsRate)} of income).`);
  else if (s.income > 0) lines.push(`In ${title} you spent ${money(s.expense)} against ${money(s.income)} of income, overspending by ${money(-s.balance)}.`);
  else lines.push(`In ${title} you spent ${money(s.expense)} with no income recorded.`);

  const prevShort = keyShort(prevKey(ins.key));
  if (s.previousExpense > 0) {
    const change = (s.expense - s.previousExpense) / s.previousExpense;
    if (Math.abs(change) < 0.03) lines.push(`Spending was about the same as ${prevShort}.`);
    else if (change > 0) lines.push(`That is ${pct(change)} more spending than ${prevShort} (${money(s.previousExpense)}).`);
    else lines.push(`That is ${pct(change)} less spending than ${prevShort} (${money(s.previousExpense)}).`);
  }

  const top = s.expenseByCategory.slice(0, 2);
  if (top[0]) {
    let line = `${top[0].name} was the biggest category at ${pct(top[0].share)} (${money(top[0].total)})`;
    if (top[1]) line += `, followed by ${top[1].name} at ${pct(top[1].share)}`;
    lines.push(line + '.');
  }

  if (s.largestExpense) {
    const l = s.largestExpense;
    lines.push(`The largest single expense was ${l.desc || l.category}, ${money(l.amount)} on ${fmtDay(l.date)}.`);
  }

  if (ins.isCurrentMonth && ins.daysCounted < ins.daysInMonth) lines.push(`You are spending about ${money(ins.perDay)} a day; at this pace the month ends near ${money(ins.projectedExpense)}.`);
  else {
    const busiest = ins.weekdays.reduce((a, b) => (b.average > a.average ? b : a), ins.weekdays[0]);
    if (busiest && busiest.average > 0) lines.push(`You spent about ${money(ins.perDay)} a day, most of it on ${WEEKDAYS[busiest.weekday]}s.`);
  }

  if (ins.budgets.length) {
    const over = ins.budgets.filter((b) => b.ratio > 1);
    if (!over.length) lines.push(`All ${ins.budgets.length} budgets stayed within their limits.`);
    else lines.push(`Over budget: ${over.slice(0, 2).map((b) => b.name).join(' and ')}${over.length > 2 ? ` and ${over.length - 2} more` : ''}.`);
  }

  if (ins.streak >= 2) lines.push(`This is month ${ins.streak} in a row with money left over.`);

  const mover = ins.movers[0];
  if (mover && Math.abs(mover.change) >= Math.max(s.expense * 0.05, 1)) {
    lines.push(mover.change > 0 ? `${mover.name} rose the most, up ${money(mover.change)} from last month.` : `${mover.name} fell the most, down ${money(-mover.change)} from last month.`);
  }
  return lines;
}

export function tiles(ins, currency) {
  const s = ins.summary;
  if (s.count === 0) return [];
  const out = [{ icon: 'calendar', value: fmtMoney(ins.perDay, currency), label: 'Spent per day', tint: 'neutral' }];
  if (ins.isCurrentMonth && ins.daysCounted < ins.daysInMonth) {
    out.push({ icon: 'gauge', value: fmtMoney(ins.projectedExpense, currency), label: 'On pace for this month', tint: s.income > 0 && ins.projectedExpense > s.income ? 'bad' : 'neutral' });
  }
  if (ins.streak >= 2) out.push({ icon: 'flame', value: `${ins.streak} months`, label: 'Streak with money left', tint: 'good' });
  if (s.previousExpense > 0) {
    const change = (s.expense - s.previousExpense) / s.previousExpense;
    const flat = Math.abs(change) <= 0.005;
    out.push({ icon: flat ? 'equal' : change > 0 ? 'up' : 'down', value: flat ? 'Same' : (change > 0 ? '+' : '−') + fmtPct(Math.abs(change)), label: 'vs last month', tint: flat ? 'neutral' : change > 0 ? 'bad' : 'good' });
  }
  const top = s.expenseByCategory[0];
  if (top) out.push({ icon: 'tag', value: top.name, label: `${fmtPct(top.share)} of spending`, tint: 'neutral' });
  if (s.largestExpense) out.push({ icon: 'up', value: fmtMoney(s.largestExpense.amount, currency), label: `Largest: ${s.largestExpense.desc || s.largestExpense.category}`, tint: 'neutral' });
  if (s.income > 0) { const kept = Math.max(s.balance, 0) / s.income; out.push({ icon: 'leaf', value: fmtPct(kept), label: 'of income kept', tint: kept > 0 ? 'good' : 'bad' }); }
  out.push({ icon: 'list', value: String(s.count), label: s.count === 1 ? 'transaction' : 'transactions', tint: 'neutral' });
  return out;
}

// Icon name for a category from words in its name (mirrors the iOS version).
const ICON_TABLE = [
  ['rent', 'home'], ['mortgage', 'home'], ['insurance', 'shield'], ['radio', 'radio'], ['tele', 'phone'],
  ['phone', 'phone'], ['internet', 'phone'], ['grocer', 'cart'], ['vending', 'cup'], ['coffee', 'cup'],
  ['food', 'food'], ['dining', 'food'], ['restaurant', 'food'], ['entertain', 'game'], ['subscription', 'play'],
  ['international', 'globe'], ['transfer', 'swap'], ['instal', 'card'], ['fees', 'card'], ['charges', 'card'],
  ['utilit', 'bolt'], ['electric', 'bolt'], ['airplane', 'plane'], ['flight', 'plane'], ['travel', 'plane'],
  ['ticket', 'train'], ['transport', 'car'], ['taxi', 'car'], ['fuel', 'fuel'], ['petrol', 'fuel'],
  ['withdraw', 'cash'], ['cash', 'cash'], ['purchase', 'bag'], ['shopping', 'bag'], ['charity', 'heart'],
  ['donation', 'heart'], ['gift', 'gift'], ['office', 'briefcase'], ['salary', 'briefcase'], ['freelance', 'briefcase'],
  ['business', 'briefcase'], ['invest', 'up'], ['family', 'people'], ['paid back', 'undo'], ['refund', 'undo'],
  ['health', 'shield'], ['medical', 'shield'], ['education', 'book'], ['school', 'book'], ['course', 'book'],
  ['other', 'dots'],
];
export function iconFor(name) {
  const n = (name || '').toLowerCase();
  for (const [k, v] of ICON_TABLE) if (n.includes(k)) return v;
  return 'tag';
}
