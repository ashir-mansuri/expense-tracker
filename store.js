// Data layer: everything is kept in localStorage on this device only.
export const STORAGE_KEY = 'expense-tracker.v1';
export const CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CLP', name: 'Chilean Peso' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'ILS', name: 'Israeli Shekel' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'TWD', name: 'New Taiwan Dollar' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'ZAR', name: 'South African Rand' },
];
export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const DEFAULT_INCOME = ['Salary', 'Freelance', 'Business', 'Investments', 'Gifts received', 'Refunds', 'Other income'];
export const DEFAULT_EXPENSE = [
  'Rent', 'Groceries', 'Food & Dining', 'Transport', 'Fuel', 'Utilities', 'Phone & Internet', 'Health',
  'Insurance', 'Shopping', 'Entertainment', 'Subscriptions', 'Travel', 'Education', 'Family',
  'Gifts & Donations', 'Fees & Charges', 'Cash Withdrawal', 'Other',
];

// First-launch currency, guessed from the phone's language/region. The person can change it any time.
const REGION_CURRENCY = {
  AE: 'AED', AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY', CZ: 'CZK', DK: 'DKK',
  GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', JP: 'JPY', KR: 'KRW', MX: 'MXN',
  NO: 'NOK', NZ: 'NZD', PL: 'PLN', SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', TW: 'TWD',
  US: 'USD', ZA: 'ZAR',
  AT: 'EUR', BE: 'EUR', DE: 'EUR', ES: 'EUR', FI: 'EUR', FR: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR',
  NL: 'EUR', PT: 'EUR',
};
export function guessCurrency() {
  try {
    const region = new Intl.Locale(navigator.language || 'en-US').maximize().region;
    return REGION_CURRENCY[region] || 'USD';
  } catch { return 'USD'; }
}

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export function todayISO() {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function defaultState() {
  let order = 0;
  const categories = [];
  for (const name of DEFAULT_INCOME) categories.push({ id: uid(), name, type: 'Income', sortOrder: order++, budget: 0, budgetCurrency: 'EUR' });
  for (const name of DEFAULT_EXPENSE) categories.push({ id: uid(), name, type: 'Expense', sortOrder: order++, budget: 0, budgetCurrency: 'EUR' });
  return {
    version: 1,
    transactions: [],
    categories,
    rules: [],
    settings: {
      currency: guessCurrency(),
      pinHash: null,
      reportsEnabled: false,
      reportDay: 1,
      lastExport: null,
      lastBackupPrompt: null,
      reportsSeen: [],
    },
  };
}

class Store {
  constructor() {
    this.state = this.load();
    this.listeners = new Set();
    this.saveTimer = null;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        transactions: parsed.transactions || [],
        categories: parsed.categories && parsed.categories.length ? parsed.categories : base.categories,
        rules: parsed.rules || [],
      };
    } catch (e) {
      console.error('Could not read saved data', e);
      return defaultState();
    }
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        console.error('Could not save', e);
        alert('Saving failed. Your phone may be out of storage, or Safari is in private mode.');
      }
    }, 50);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  commit() {
    this.persist();
    for (const fn of this.listeners) fn(this.state);
  }

  // ---- settings
  get settings() { return this.state.settings; }
  setSetting(key, value) { this.state.settings[key] = value; this.commit(); }

  // ---- transactions
  get transactions() { return this.state.transactions; }

  addTransaction(t) {
    const item = { id: uid(), createdAt: Date.now(), desc: '', ...t };
    this.state.transactions.push(item);
    this.commit();
    return item;
  }

  updateTransaction(id, changes) {
    const item = this.state.transactions.find((t) => t.id === id);
    if (!item) return;
    Object.assign(item, changes);
    this.commit();
  }

  deleteTransaction(id) {
    this.state.transactions = this.state.transactions.filter((t) => t.id !== id);
    this.commit();
  }

  eraseAllTransactions() {
    this.state.transactions = [];
    this.commit();
  }

  // ---- categories
  get categories() { return [...this.state.categories].sort((a, b) => a.sortOrder - b.sortOrder); }

  categoryNames(type) { return this.categories.filter((c) => c.type === type).map((c) => c.name); }

  addCategory({ name, type, budget = 0, budgetCurrency = 'EUR' }) {
    const sortOrder = Math.max(-1, ...this.state.categories.map((c) => c.sortOrder)) + 1;
    const cat = { id: uid(), name, type, sortOrder, budget, budgetCurrency };
    this.state.categories.push(cat);
    this.commit();
    return cat;
  }

  updateCategory(id, changes) {
    const cat = this.state.categories.find((c) => c.id === id);
    if (!cat) return;
    if (changes.name && changes.name !== cat.name) {
      for (const t of this.state.transactions) if (t.type === cat.type && t.category === cat.name) t.category = changes.name;
      for (const r of this.state.rules) if (r.type === cat.type && r.category === cat.name) r.category = changes.name;
    }
    Object.assign(cat, changes);
    this.commit();
  }

  deleteCategory(id) {
    this.state.categories = this.state.categories.filter((c) => c.id !== id);
    this.commit();
  }

  ensureCategory(name, type) {
    const exists = this.state.categories.some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
    if (!exists && name) this.addCategory({ name, type });
  }

  // ---- recurring rules
  get rules() { return this.state.rules; }

  addRule(rule) {
    const item = { id: uid(), occurrences: 0, active: true, createdAt: Date.now(), ...rule };
    this.state.rules.push(item);
    this.commit();
    return item;
  }

  updateRule(id, changes) {
    const r = this.state.rules.find((x) => x.id === id);
    if (!r) return;
    Object.assign(r, changes);
    this.commit();
  }

  deleteRule(id) {
    this.state.rules = this.state.rules.filter((r) => r.id !== id);
    this.commit();
  }

  // ---- bulk insert with duplicate protection (same logic as the iOS app)
  signature(t) {
    const cents = Math.round(t.amount * 100);
    return [t.date, t.type, t.category.toLowerCase(), cents, t.currency, (t.desc || '').toLowerCase()].join('|');
  }

  insertRows(rows, defaultCurrency) {
    const counts = new Map();
    for (const t of this.state.transactions) {
      const k = this.signature(t);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let added = 0;
    let duplicates = 0;
    const base = Date.now();
    rows.forEach((row, i) => {
      const t = { ...row, currency: row.currency || defaultCurrency };
      const k = this.signature(t);
      const remaining = counts.get(k) || 0;
      if (remaining > 0) {
        counts.set(k, remaining - 1);
        duplicates += 1;
        return;
      }
      this.state.transactions.push({ id: uid(), createdAt: base + i, ...t });
      this.ensureCategoryQuiet(t.category, t.type);
      added += 1;
    });
    this.commit();
    return { added, duplicates };
  }

  ensureCategoryQuiet(name, type) {
    const exists = this.state.categories.some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
    if (!exists && name) {
      const sortOrder = Math.max(-1, ...this.state.categories.map((c) => c.sortOrder)) + 1;
      this.state.categories.push({ id: uid(), name, type, sortOrder, budget: 0, budgetCurrency: 'EUR' });
    }
  }

  // ---- backup
  exportBackup() {
    return JSON.stringify({ app: 'Expense Tracker', version: 1, exportedAt: new Date().toISOString(), ...this.state }, null, 2);
  }

  restoreBackup(json) {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.transactions)) throw new Error('Not an Expense Tracker backup.');
    const out = { transactions: 0, categories: 0, rules: 0 };
    for (const c of parsed.categories || []) {
      const exists = this.state.categories.some((x) => x.type === c.type && x.name.toLowerCase() === c.name.toLowerCase());
      if (!exists) { this.state.categories.push({ ...c, id: c.id || uid() }); out.categories += 1; }
    }
    const ids = new Set(this.state.transactions.map((t) => t.id));
    const rows = parsed.transactions.filter((t) => !ids.has(t.id));
    const result = this.insertRows(rows, this.settings.currency);
    out.transactions = result.added;
    const ruleIds = new Set(this.state.rules.map((r) => r.id));
    for (const r of parsed.rules || []) {
      if (!ruleIds.has(r.id)) { this.state.rules.push(r); out.rules += 1; }
    }
    this.commit();
    return out;
  }
}

export const store = new Store();

// ---- Recurring rules: add what is due, up to today.
export function stepDate(iso, frequency, n) {
  const d = parseISODate(iso);
  if (frequency === 'Weekly') d.setDate(d.getDate() + 7 * n);
  else {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  return toISODate(d);
}

export function nextDue(rule) {
  return stepDate(rule.startDate, rule.frequency, rule.occurrences + 1);
}

export function processRecurring() {
  const today = todayISO();
  let added = 0;
  for (const rule of store.state.rules) {
    if (!rule.active) continue;
    let guard = 0;
    while (nextDue(rule) <= today && guard < 240) {
      const date = nextDue(rule);
      store.state.transactions.push({
        id: uid(), createdAt: Date.now(), date, type: rule.type, category: rule.category,
        amount: rule.amount, desc: rule.desc || '', currency: rule.currency,
      });
      rule.occurrences += 1;
      added += 1;
      guard += 1;
    }
  }
  if (added) store.commit();
  return added;
}

// ---- CSV
const DATE_FORMATS = [
  /^(\d{4})-(\d{1,2})-(\d{1,2})$/,           // yyyy-mm-dd
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/,       // m/d/yyyy (US, as Excel exports)
  /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/,       // d.m.yyyy
  /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/,         // d-m-yyyy
];

export function parseDate(text) {
  const token = (text || '').trim().split(/[ T]/)[0];
  let m;
  if ((m = token.match(DATE_FORMATS[0]))) return build(+m[1], +m[2], +m[3]);
  if ((m = token.match(DATE_FORMATS[1]))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) [a, b] = [b, a];
    return build(y, a, b);
  }
  if ((m = token.match(DATE_FORMATS[2])) || (m = token.match(DATE_FORMATS[3]))) return build(+m[3], +m[2], +m[1]);
  return null;
  function build(y, mo, d) {
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
}

export function parseAmount(text) {
  let cleaned = (text || '').replace(/[^0-9.,-]/g, '');
  if (!cleaned) return null;
  const hasDot = cleaned.includes('.');
  const hasComma = cleaned.includes(',');
  if (hasDot && hasComma) {
    if (cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',')) cleaned = cleaned.replace(/,/g, '');
    else cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    const parts = cleaned.split(',');
    if (parts.length === 2 && parts[1].length <= 2) cleaned = cleaned.replace(',', '.');
    else cleaned = cleaned.replace(/,/g, '');
  }
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseCSV(text) {
  let content = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(content);
  const table = parseTable(content, delimiter);
  const result = { rows: [], skipped: 0, foundHeader: false };
  let headerIndex = -1;
  let names = [];
  for (let i = 0; i < table.length; i++) {
    const lowered = table[i].map((c) => c.trim().toLowerCase());
    if (lowered.includes('date') && lowered.includes('amount')) { headerIndex = i; names = lowered; break; }
  }
  if (headerIndex < 0) return result;
  result.foundHeader = true;
  const col = (n) => names.indexOf(n);
  const dateC = col('date'), amountC = col('amount'), typeC = col('type'), catC = col('category'), curC = col('currency');
  const descC = names.findIndex((n) => ['description', 'desc', 'note', 'notes'].includes(n));
  const val = (row, c) => (c >= 0 && c < row.length ? row[c].trim() : '');
  for (const row of table.slice(headerIndex + 1)) {
    if (row.every((c) => !c.trim())) continue;
    const date = parseDate(val(row, dateC));
    const amountText = val(row, amountC);
    const raw = parseAmount(amountText);
    if (!date || raw === null || raw === 0) { result.skipped += 1; continue; }
    const type = val(row, typeC).toLowerCase().startsWith('inc') ? 'Income' : 'Expense';
    let category = val(row, catC) || 'Other';
    let currency = val(row, curC).toUpperCase();
    if (!CURRENCY_CODES.includes(currency)) {
      currency = amountText.includes('€') ? 'EUR' : amountText.includes('₹') ? 'INR' : amountText.includes('CA$') ? 'CAD' : amountText.includes('$') ? 'USD' : null;
    }
    result.rows.push({ date, type, category, amount: Math.abs(raw), currency, desc: val(row, descC) });
  }
  return result;
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 15);
  const line = lines.find((l) => l.toLowerCase().includes('date')) || lines[0] || '';
  let best = ',', bestCount = 0;
  for (const c of [',', ';', '\t']) {
    const count = line.split(c).length - 1;
    if (count > bestCount) { best = c; bestCount = count; }
  }
  return best;
}

function parseTable(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function exportCSV(transactions) {
  const esc = (s) => (/[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const sorted = [...transactions].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  const lines = ['Date,Type,Category,Amount,Currency,Description'];
  for (const t of sorted) lines.push([t.date, t.type, esc(t.category), t.amount.toFixed(2), t.currency, esc(t.desc || '')].join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
