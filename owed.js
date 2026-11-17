// Who owes me: small helpers with no screen code. A debt is { id, person, amount, currency, date, note, txId, paid: [{date, amount, txId?}] }.
const r2 = (n) => Math.round(n * 100) / 100;

export const personKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏऀ-ॿ઀-૿ ]+/gi, ' ').replace(/\s+/g, ' ').trim();
export const paidOf = (d) => r2((d.paid || []).reduce((a, p) => a + (+p.amount || 0), 0));
export const leftOf = (d) => Math.max(0, r2(d.amount - paidOf(d)));
export const isOpen = (d) => leftOf(d) > 0.004;

// Everyone with something outstanding, biggest first. `name` keeps the spelling used the first time.
export function groupPeople(owed) {
  const map = new Map();
  for (const d of owed) {
    const key = personKey(d.person);
    if (!key) continue;
    let g = map.get(key);
    if (!g) { g = { key, name: d.person, open: [], settled: [], totals: {} }; map.set(key, g); }
    if (isOpen(d)) { g.open.push(d); g.totals[d.currency] = r2((g.totals[d.currency] || 0) + leftOf(d)); }
    else g.settled.push(d);
  }
  const byDate = (a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1);
  const all = [...map.values()];
  for (const g of all) { g.open.sort(byDate); g.settled.sort((a, b) => byDate(b, a)); }
  const size = (g) => Object.values(g.totals).reduce((a, v) => a + v, 0);
  return all.filter((g) => g.open.length).sort((a, b) => size(b) - size(a));
}

export function totalsByCurrency(owed) {
  const t = {};
  for (const d of owed) if (isOpen(d)) t[d.currency] = r2((t[d.currency] || 0) + leftOf(d));
  return t;
}

// "Ravi" typed when the list says "Ravi Kumar" (or the other way round) is the same person, unless it is ambiguous.
export function resolvePerson(owed, person) {
  const key = personKey(person);
  const keys = [...new Set(owed.filter(isOpen).map((d) => personKey(d.person)))];
  if (keys.includes(key)) return key;
  const first = key.split(' ')[0];
  const byFirst = keys.filter((k) => k.split(' ')[0] === first);
  return byFirst.length === 1 ? byFirst[0] : key;
}

// How a payment is shared out: the oldest debt first, same currency only.
export function repayPlan(owed, person, amount, currency) {
  const key = resolvePerson(owed, person);
  const debts = owed.filter((d) => personKey(d.person) === key && isOpen(d) && (!currency || d.currency === currency))
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  let rest = r2(amount);
  const parts = [];
  for (const d of debts) {
    if (rest <= 0.004) break;
    const take = Math.min(rest, leftOf(d));
    parts.push({ id: d.id, take: r2(take) });
    rest = r2(rest - take);
  }
  return { parts, leftover: Math.max(0, rest), outstanding: r2(debts.reduce((a, d) => a + leftOf(d), 0)) };
}

// Money that came in with a person's name on it after they borrowed: probably the repayment.
export function suggestRepayments(owed, transactions) {
  const used = new Set();
  for (const d of owed) for (const p of d.paid || []) if (p.txId) used.add(p.txId);
  const out = [];
  for (const g of groupPeople(owed)) {
    const first = g.key.split(' ').find((w) => w.length >= 3);
    if (!first) continue;
    const word = new RegExp(`(^| )${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
    for (const cur of Object.keys(g.totals)) {
      const debts = g.open.filter((d) => d.currency === cur);
      const since = debts.reduce((m, d) => (d.date < m ? d.date : m), '9999-12-31');
      const left = g.totals[cur];
      for (const t of transactions) {
        if (t.type !== 'Income' || t.currency !== cur || used.has(t.id) || t.date < since) continue;
        if (t.amount > left + 0.01) continue;
        if (!word.test(personKey(t.desc))) continue;
        out.push({ key: g.key, name: g.name, tx: t });
      }
    }
  }
  return out;
}

// A polite message to send.
export function reminderText(name, debts, fmt) {
  const first = String(name).split(' ')[0];
  if (debts.length === 1) {
    const d = debts[0];
    return `Hi ${first}, a small reminder about ${fmt(leftOf(d), d.currency)}${d.note ? ` for ${d.note}` : ''}. Thanks!`;
  }
  const sums = {};
  for (const d of debts) sums[d.currency] = r2((sums[d.currency] || 0) + leftOf(d));
  const total = Object.entries(sums).map(([c, v]) => fmt(v, c)).join(' + ');
  return `Hi ${first}, a small reminder about the ${total} I paid for us (${debts.length} things). Thanks!`;
}
