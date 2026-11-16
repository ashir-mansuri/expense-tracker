// Pure calculations over the ledger: month summaries, insights, sentences.
import { parseISODate, nextDue, toISODate } from './store.js';
import { normalise } from './categorize.js';

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

// prevSpent: Map of category → last month's spending, used when unspent budget rolls over.
export function budgets(categories, expenses, currency, prevSpent = null) {
  const spent = new Map(expenses.map((e) => [e.name, e.total]));
  return categories
    .filter((c) => c.type === 'Expense' && c.budget > 0 && c.budgetCurrency === currency)
    .map((c) => {
      const s = spent.get(c.name) || 0;
      const carried = prevSpent ? Math.max(0, c.budget - (prevSpent.get(c.name) || 0)) : 0;
      const limit = c.budget + carried;
      return { name: c.name, limit, base: c.budget, carried, spent: s, ratio: s / limit, remaining: limit - s };
    })
    .sort((a, b) => (a.ratio === b.ratio ? a.name.localeCompare(b.name) : b.ratio - a.ratio));
}

function spentByCategory(items, key) {
  const m = new Map();
  for (const t of items) if (t.type === 'Expense' && inMonth(t, key)) m.set(t.category, (m.get(t.category) || 0) + t.amount);
  return m;
}

// Average monthly spending over the previous `n` months that have any data.
function averagePrevious(items, key, n = 3) {
  const totals = totalsByMonth(items);
  let cursor = prevKey(key), sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    const v = totals.get(keyStr(cursor));
    if (v && (v.income || v.expense)) { sum += v.expense; count += 1; }
    cursor = prevKey(cursor);
  }
  return count ? { average: sum / count, months: count } : null;
}

// Where the month is heading, and what is safe to spend per day until it ends.
export function forecast(items, key, budgetList, now = new Date()) {
  if (!keyEq(key, currentKey())) return null;
  const dim = daysInMonth(key), day = Math.max(now.getDate(), 1), daysLeft = dim - day;
  const spent = items.filter((t) => t.type === 'Expense' && inMonth(t, key)).reduce((a, t) => a + t.amount, 0);
  const prev = averagePrevious(items, key);
  const pace = (spent / day) * dim;
  // early in the month the pace is noisy, so lean on the recent average until ~10 days are in
  const w = Math.min(day / 10, 1);
  const projected = prev ? pace * w + prev.average * (1 - w) : pace;
  let reference = null, basis = null;
  if (budgetList.length) { reference = budgetList.reduce((a, b) => a + b.limit, 0); basis = 'budgets'; }
  else if (prev) { reference = prev.average; basis = 'average'; }
  const spentInRef = basis === 'budgets' ? budgetList.reduce((a, b) => a + b.spent, 0) : spent;
  const safePerDay = reference !== null && daysLeft > 0 ? Math.max(0, (reference - spentInRef) / daysLeft) : null;
  return { spent, projected, daysLeft, reference, basis, safePerDay, overReference: reference !== null && projected > reference };
}

// Things worth a second look this month: a category far above its usual level, or one very large payment.
export function alerts(items, key, limit = 3) {
  const out = [];
  const now = spentByCategory(items, key);
  const monthTotal = [...now.values()].reduce((a, b) => a + b, 0);
  // baseline per category = mean over the previous 3 months that had spending in that category
  const base = new Map();
  let cursor = prevKey(key);
  for (let i = 0; i < 3; i++) {
    for (const [name, v] of spentByCategory(items, cursor)) { const b = base.get(name) || { sum: 0, n: 0 }; b.sum += v; b.n += 1; base.set(name, b); }
    cursor = prevKey(cursor);
  }
  for (const [name, v] of now) {
    const b = base.get(name);
    if (!b || b.n < 2) continue;
    const mean = b.sum / b.n;
    if (v >= mean * 1.5 && v - mean >= Math.max(monthTotal * 0.04, 1)) out.push({ kind: 'category', name, now: v, usual: mean, impact: v - mean });
  }
  // a single payment ≥ 3× the usual size for its category (needs some history)
  const samples = new Map();
  for (const t of items) if (t.type === 'Expense' && !inMonth(t, key)) { if (!samples.has(t.category)) samples.set(t.category, []); samples.get(t.category).push(t.amount); }
  for (const t of items) {
    if (t.type !== 'Expense' || !inMonth(t, key)) continue;
    const arr = samples.get(t.category);
    if (!arr || arr.length < 5) continue;
    const sorted = [...arr].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    if (t.amount >= median * 3 && t.amount >= Math.max(monthTotal * 0.05, 1)) out.push({ kind: 'large', tx: t, usual: median, impact: t.amount - median });
  }
  return out.sort((a, b) => b.impact - a.impact).slice(0, limit);
}

// Payments that repeat with the same amount at a steady interval.
export function subscriptions(items, rules) {
  const groups = new Map();
  for (const t of items) {
    if (t.type !== 'Expense') continue;
    const k = normalise(t.desc) || ('#' + t.category.toLowerCase());
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const [, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    const amounts = sorted.map((t) => t.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const steady = sorted.filter((t) => Math.abs(t.amount - median) <= Math.max(median * 0.03, 0.5));
    if (steady.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < steady.length; i++) gaps.push((parseISODate(steady[i].date) - parseISODate(steady[i - 1].date)) / 86400000);
    gaps.sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    let frequency = null;
    if (gap >= 26 && gap <= 35) frequency = 'Monthly';
    else if (gap >= 6 && gap <= 8) frequency = 'Weekly';
    else if (gap >= 355 && gap <= 375) frequency = 'Yearly';
    if (!frequency) continue;
    const last = steady[steady.length - 1];
    const hasRule = rules.some((r) => r.active && r.type === 'Expense' && r.category === last.category && Math.abs(r.amount - median) <= Math.max(median * 0.03, 0.5) && r.currency === last.currency);
    const monthly = frequency === 'Monthly' ? median : frequency === 'Weekly' ? (median * 52) / 12 : median / 12;
    out.push({ desc: last.desc || last.category, category: last.category, amount: median, currency: last.currency, frequency, count: steady.length, lastDate: last.date, monthly, hasRule });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

// Progress towards each savings goal: what was kept (income − expenses) since the goal started.
export function goalProgress(goals, transactions, now = new Date()) {
  const todayKey = currentKey();
  return goals.map((g) => {
    const items = transactions.filter((t) => t.currency === g.currency && t.date >= g.startDate);
    const saved = items.reduce((a, t) => a + (t.type === 'Income' ? t.amount : -t.amount), 0);
    const progress = Math.max(0, Math.min(saved / g.target, 1));
    // typical monthly saving: last 3 full months with data
    const totals = totalsByMonth(transactions.filter((t) => t.currency === g.currency));
    let cursor = prevKey(todayKey), sum = 0, n = 0;
    for (let i = 0; i < 3; i++) { const v = totals.get(keyStr(cursor)); if (v && (v.income || v.expense)) { sum += v.income - v.expense; n += 1; } cursor = prevKey(cursor); }
    const perMonth = n ? sum / n : 0;
    const remaining = Math.max(g.target - saved, 0);
    let status = 'started', detail = '';
    if (remaining === 0) { status = 'done'; detail = 'Goal reached'; }
    else if (g.deadline) {
      const monthsLeft = Math.max((parseISODate(g.deadline) - now) / (30.44 * 86400000), 0.1);
      const needed = remaining / monthsLeft;
      status = perMonth >= needed ? 'on-track' : 'behind';
      detail = `${status === 'on-track' ? 'On track' : 'Behind'} · needs ${fmtMoney(needed, g.currency)}/month, saving ${fmtMoney(Math.max(perMonth, 0), g.currency)}`;
    } else if (perMonth > 0) {
      const months = Math.ceil(remaining / perMonth);
      status = 'on-track'; detail = `About ${months} ${months === 1 ? 'month' : 'months'} to go at ${fmtMoney(perMonth, g.currency)}/month`;
    } else detail = 'Add income and expenses to see a forecast';
    return { ...g, saved: Math.max(saved, 0), progress, remaining, perMonth, status, detail };
  });
}

// Recurring payments due in the next `days` days.
export function upcomingBills(rules, days = 14) {
  const today = toISODate(new Date());
  const limit = toISODate(new Date(Date.now() + days * 86400000));
  const out = [];
  for (const r of rules) {
    if (!r.active) continue;
    const due = nextDue(r);
    if (due >= today && due <= limit) out.push({ rule: r, due, inDays: Math.round((parseISODate(due) - parseISODate(today)) / 86400000) });
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

// A whole year at a glance.
export function yearReview(items, year, categories) {
  const months = Array.from({ length: 12 }, (_, i) => ({ key: { year, month: i + 1 }, label: MONTHS_SHORT[i], income: 0, expense: 0, balance: 0, count: 0 }));
  const cats = new Map(), catsAll = new Map(), prev = { income: 0, expense: 0, count: 0 };
  let largest = null;
  for (const t of items) {
    const y = +t.date.slice(0, 4);
    if (t.type === 'Expense') catsAll.set(t.category, (catsAll.get(t.category) || 0) + t.amount);
    if (y === year - 1) { prev.count += 1; if (t.type === 'Income') prev.income += t.amount; else prev.expense += t.amount; }
    if (y !== year) continue;
    const m = months[+t.date.slice(5, 7) - 1];
    m.count += 1;
    if (t.type === 'Income') m.income += t.amount;
    else { m.expense += t.amount; cats.set(t.category, (cats.get(t.category) || 0) + t.amount); if (!largest || t.amount > largest.amount) largest = t; }
  }
  for (const m of months) m.balance = m.income - m.expense;
  const income = months.reduce((a, m) => a + m.income, 0), expense = months.reduce((a, m) => a + m.expense, 0), count = months.reduce((a, m) => a + m.count, 0);
  const active = months.filter((m) => m.count > 0);
  const best = active.length ? active.reduce((a, m) => (m.balance > a.balance ? m : a), active[0]) : null;
  const worst = active.length ? active.reduce((a, m) => (m.balance < a.balance ? m : a), active[0]) : null;
  const top = rank(cats, catsAll, expense).slice(0, 8);
  return {
    year, months, income, expense, balance: income - expense, count, activeMonths: active.length,
    savingsRate: income > 0 ? (income - expense) / income : 0, averageExpense: active.length ? expense / active.length : 0,
    best, worst, top, largest, positiveMonths: active.filter((m) => m.balance >= 0).length,
    previous: prev.count ? { ...prev, balance: prev.income - prev.expense } : null,
  };
}

export function yearsWithData(items) {
  return [...new Set(items.map((t) => +t.date.slice(0, 4)))].sort((a, b) => b - a);
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

export function insights(items, categories, key, currency, now = new Date(), { rollover = false } = {}) {
  const s = summary(items, key);
  // unspent budget carries over only from a month that was actually tracked
  const prevSpent = rollover ? spentByCategory(items, prevKey(key)) : null;
  const budgetList = budgets(categories, s.expenseByCategory, currency, prevSpent && prevSpent.size ? prevSpent : null);
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
    budgets: budgetList,
    forecast: forecast(items, key, budgetList, now),
    alerts: alerts(items, key),
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

  if (ins.isCurrentMonth && ins.daysCounted < ins.daysInMonth) {
    const f = ins.forecast;
    let line = `You are spending about ${money(ins.perDay)} a day; the month is heading for about ${money(f ? f.projected : ins.projectedExpense)}`;
    if (f && f.safePerDay !== null) {
      if (f.safePerDay > 0) line += `, so ${money(f.safePerDay)} a day is safe to spend ${f.basis === 'budgets' ? 'within your budgets' : 'to match your usual month'}`;
      else line += `, already past ${f.basis === 'budgets' ? 'your budgets' : 'your usual month'} (${money(f.reference)})`;
    }
    lines.push(line + '.');
  }
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
  const out = [];
  const f = ins.forecast;
  if (f && ins.daysCounted < ins.daysInMonth) {
    out.push({ icon: 'gauge', value: fmtMoney(f.projected, currency), label: 'Month forecast', tint: f.overReference || (s.income > 0 && f.projected > s.income) ? 'bad' : 'neutral' });
    if (f.safePerDay !== null) out.push({ icon: 'leaf', value: fmtMoney(f.safePerDay, currency), label: `Safe to spend / day`, tint: f.safePerDay > 0 ? 'good' : 'bad' });
  }
  out.push({ icon: 'calendar', value: fmtMoney(ins.perDay, currency), label: 'Spent per day', tint: 'neutral' });
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
