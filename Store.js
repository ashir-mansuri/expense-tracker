// Data layer: everything is kept in localStorage on this device only.
import { repayPlan } from './owed.js';
import { cleanBackup } from './schema.js';
import { available as vaultAvailable, deriveKey, newSalt, sealTextWithKey, openTextWithKey, fromB64, looksEncrypted, ITER } from './vault.js';
export const STORAGE_KEY = 'expense-tracker.v1';
export const ENC_KEY = 'expense-tracker.v1.enc';       // the same data, locked with a passphrase (only when the person turns that on)
export const DAMAGED_KEY = 'expense-tracker.v1.damaged'; // a copy of saved data that could not be read
export const PREFS_KEY = 'expense-tracker.prefs';       // look and theme only, so the screen has the right colours before it unlocks
const ARRAY_KEYS = ['transactions', 'categories', 'rules', 'accounts', 'transfers', 'goals', 'imports', 'owed'];
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

let idCounter = 0;
export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  // older browsers: build a proper random id from the secure random source, never from the clock alone
  const b = new Uint8Array(16);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  idCounter += 1;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.slice(0, 35) + (idCounter & 0xf).toString(16);
}

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
    version: 2,
    transactions: [],
    categories,
    rules: [],
    accounts: [],
    transfers: [],
    goals: [],
    imports: [],              // one entry per bank-statement import, so a whole import can be undone
    merchants: {},            // names the person has taught the app: "name|Expense" → category
    owed: [],                 // money other people owe me: { person, amount, currency, date, note, txId, paid: [] }
    settings: {
      currency: guessCurrency(),
      homeCurrency: null,     // show everything converted into this currency (null = off)
      showAll: false,         // dashboard shows all currencies converted into homeCurrency
      rates: null,            // { base: 'USD', date, rates: { EUR: 0.92, ... } }
      budgetRollover: false,  // unspent budget carries into next month
      lastAccount: null,
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
    this.listeners = new Set();
    this.saveTimer = null;
    this.dirty = false;
    this.sealed = false;   // saved data is locked with a passphrase and has not been opened yet
    this.vault = null;     // { key, salt, iter } while the passphrase is on and unlocked
    this.blocked = false;  // saving is paused so unreadable saved data is never overwritten
    this.recovery = null;  // set when unreadable saved data had to be put aside
    this.writing = null;
    this.again = false;
    this.state = this.load();
  }

  get encrypted() { return this.sealed || !!this.vault; }

  fromParsed(parsed) {
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      transactions: parsed.transactions || [],
      categories: parsed.categories && parsed.categories.length ? parsed.categories : base.categories,
      rules: parsed.rules || [],
      accounts: parsed.accounts || [],
      transfers: parsed.transfers || [],
      goals: parsed.goals || [],
      imports: parsed.imports || [],
      merchants: parsed.merchants || {},
      owed: parsed.owed || [],
    };
  }

  // Saved data that cannot be understood is kept as a separate copy before anything new is written over it.
  setAside(raw, why) {
    console.error('Could not read saved data', why);
    let kept = false;
    try { localStorage.setItem(DAMAGED_KEY, JSON.stringify({ at: Date.now(), saved: false, raw })); kept = true; } catch { /* no room for a copy */ }
    this.recovery = { at: Date.now(), kept };
    if (!kept) this.blocked = true; // nothing is written, so the original stays exactly as it is
    return defaultState();
  }

  load() {
    let raw = null, enc = null;
    try { raw = localStorage.getItem(STORAGE_KEY); enc = localStorage.getItem(ENC_KEY); } catch (e) { console.error('Storage is not available', e); return defaultState(); }
    if (!raw && enc) { this.sealed = true; return defaultState(); }
    if (!raw) return defaultState();
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return this.setAside(raw, e); }
    const okShape = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ARRAY_KEYS.every((k) => parsed[k] === undefined || Array.isArray(parsed[k]));
    if (!okShape) return this.setAside(raw, new Error('unexpected shape'));
    return this.fromParsed(parsed);
  }

  // the unreadable copy, for saving to a file
  damagedCopy() {
    try {
      const d = JSON.parse(localStorage.getItem(DAMAGED_KEY) || 'null');
      if (d && typeof d.raw === 'string') return d.raw;
    } catch { /* fall through */ }
    try { return this.blocked ? localStorage.getItem(STORAGE_KEY) : null; } catch { return null; }
  }
  markDamagedSaved() {
    try { const d = JSON.parse(localStorage.getItem(DAMAGED_KEY) || 'null'); if (d) { d.saved = true; localStorage.setItem(DAMAGED_KEY, JSON.stringify(d)); } } catch { /* ignore */ }
    this.recovery = null;
  }
  clearDamaged() { try { localStorage.removeItem(DAMAGED_KEY); } catch { /* ignore */ } this.recovery = null; }
  // later launches: the copy is still there and has not been saved yet
  checkDamagedLeftover() {
    if (this.recovery) return;
    try { const d = JSON.parse(localStorage.getItem(DAMAGED_KEY) || 'null'); if (d && !d.saved) this.recovery = { at: d.at, kept: true }; } catch { /* ignore */ }
  }
  startFresh() { // only used when the copy could not be made; the person has saved the data to a file first
    this.blocked = false; this.recovery = null; this.state = defaultState(); this.commit();
  }

  persist() {
    if (this.sealed || this.blocked) return;
    if (this.vault) { this.writeEncrypted(); return; } // locked data is written straight away, so nothing waits to be lost
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 50);
  }

  // Writes anything still waiting. Called when the page is hidden, closed or sent to the background.
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.sealed || this.blocked) return;
    if (this.vault) { if (this.dirty) { this.dirty = false; this.writeEncrypted(); } return; }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.writePrefs();
    } catch (e) {
      console.error('Could not save', e);
      alert('Saving failed. Your phone may be out of storage, or Safari is in private mode.');
    }
  }

  writePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ look: this.state.settings.look || null, theme: this.state.settings.theme || null })); } catch { /* not important */ }
  }

  writeEncrypted() {
    if (this.writing) { this.again = true; return this.writing; }
    this.writing = (async () => {
      do {
        this.again = false;
        const env = await sealTextWithKey(JSON.stringify(this.state), this.vault.key, this.vault.salt, this.vault.iter);
        localStorage.setItem(ENC_KEY, JSON.stringify(env));
        this.writePrefs();
      } while (this.again && this.vault);
    })().catch((e) => {
      console.error('Could not save', e);
      alert('Saving failed. Your phone may be out of storage, or Safari is in private mode.');
    }).finally(() => { this.writing = null; });
    return this.writing;
  }

  // ---- passphrase protection of the data kept on this phone (optional)
  async unlock(passphrase) {
    const env = JSON.parse(localStorage.getItem(ENC_KEY));
    if (!looksEncrypted(env)) throw new Error('The locked data on this phone is damaged.');
    const salt = fromB64(env.salt);
    const key = await deriveKey(passphrase, salt, env.iter);
    const text = await openTextWithKey(env, key); // throws "wrong" when the passphrase is not right
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('The locked data on this phone is damaged.'); }
    this.state = this.fromParsed(parsed);
    this.vault = { key, salt, iter: env.iter };
    this.sealed = false;
    for (const fn of this.listeners) fn(this.state);
    return this.vault.key;
  }

  async enableEncryption(passphrase) {
    if (!vaultAvailable()) throw new Error('This browser cannot protect data with a passphrase.');
    clearTimeout(this.saveTimer); this.dirty = false;
    const salt = newSalt();
    const key = await deriveKey(passphrase, salt);
    const text = JSON.stringify(this.state);
    const env = await sealTextWithKey(text, key, salt, ITER);
    if ((await openTextWithKey(env, key)) !== text) throw new Error('Could not lock the data.'); // proven before the plain copy goes away
    localStorage.setItem(ENC_KEY, JSON.stringify(env));
    localStorage.removeItem(STORAGE_KEY);
    this.vault = { key, salt, iter: ITER };
    this.writePrefs();
    return key;
  }

  async disableEncryption() {
    if (this.writing) await this.writing;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    localStorage.removeItem(ENC_KEY);
    this.vault = null;
    this.dirty = false;
  }

  // The person chose to give up the passphrase data and start again.
  eraseLocked() {
    try { localStorage.removeItem(ENC_KEY); } catch { /* ignore */ }
    this.sealed = false; this.vault = null; this.state = defaultState();
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
    const item = this.state.transactions.find((t) => t.id === id) || null;
    this.state.transactions = this.state.transactions.filter((t) => t.id !== id);
    this.commit();
    return item;
  }

  restoreTransaction(item) {
    if (!item || this.state.transactions.some((t) => t.id === item.id)) return;
    this.state.transactions.push(item);
    this.commit();
  }

  // ---- accounts (wallets) and transfers between them
  get accounts() { return this.state.accounts; }
  addAccount({ name, opening = 0, currency }) {
    const a = { id: uid(), name, opening, currency, createdAt: Date.now() };
    this.state.accounts.push(a); this.commit(); return a;
  }
  updateAccount(id, changes) { const a = this.state.accounts.find((x) => x.id === id); if (a) { Object.assign(a, changes); this.commit(); } }
  deleteAccount(id) {
    this.state.accounts = this.state.accounts.filter((a) => a.id !== id);
    this.state.transfers = this.state.transfers.filter((t) => t.from !== id && t.to !== id);
    for (const t of this.state.transactions) if (t.account === id) delete t.account;
    this.commit();
  }
  get transfers() { return this.state.transfers; }
  addTransfer({ date, from, to, amount, currency, note = '' }) {
    const t = { id: uid(), date, from, to, amount, currency, note, createdAt: Date.now() };
    this.state.transfers.push(t); this.commit(); return t;
  }
  deleteTransfer(id) { this.state.transfers = this.state.transfers.filter((t) => t.id !== id); this.commit(); }
  accountBalance(id) {
    const a = this.state.accounts.find((x) => x.id === id);
    if (!a) return 0;
    let bal = a.opening || 0;
    for (const t of this.state.transactions) if (t.account === id && t.currency === a.currency) bal += t.type === 'Income' ? t.amount : -t.amount;
    for (const t of this.state.transfers) { if (t.from === id) bal -= t.amount; if (t.to === id) bal += t.amount; }
    return bal;
  }

  // ---- savings goals
  get goals() { return this.state.goals; }
  addGoal({ name, target, currency, deadline = null, startDate, opening = 0, income = [] }) {
    const g = { id: uid(), name, target, currency, deadline, startDate, opening, income, createdAt: Date.now() };
    this.state.goals.push(g); this.commit(); return g;
  }
  updateGoal(id, changes) { const g = this.state.goals.find((x) => x.id === id); if (g) { Object.assign(g, changes); this.commit(); } }
  deleteGoal(id) { this.state.goals = this.state.goals.filter((g) => g.id !== id); this.commit(); }

  eraseAllTransactions() {
    this.state.transactions = [];
    this.state.imports = [];
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

  // Splits rows into new ones and ones already here (same day, type, category, amount, currency and text).
  dedupeRows(rows) {
    const counts = new Map();
    for (const t of this.state.transactions) { const k = this.signature(t); counts.set(k, (counts.get(k) || 0) + 1); }
    const fresh = [];
    let duplicates = 0;
    for (const r of rows) {
      const k = this.signature(r);
      const left = counts.get(k) || 0;
      if (left > 0) { counts.set(k, left - 1); duplicates += 1; } else fresh.push(r);
    }
    return { fresh, duplicates };
  }

  // Adds a whole statement at once. Every row remembers which import it came from.
  addBatch(rows, meta = {}) {
    const id = uid();
    const base = Date.now();
    rows.forEach((row, i) => {
      this.state.transactions.push({ id: uid(), createdAt: base + i, ...row, batch: id });
      this.ensureCategoryQuiet(row.category, row.type);
    });
    this.state.imports.unshift({ id, at: base, count: rows.length, ...meta });
    this.state.imports = this.state.imports.slice(0, 30);
    this.commit();
    return id;
  }

  undoImport(id) {
    const before = this.state.transactions.length;
    this.state.transactions = this.state.transactions.filter((t) => t.batch !== id);
    this.state.imports = this.state.imports.filter((x) => x.id !== id);
    this.commit();
    return before - this.state.transactions.length;
  }

  // ---- money other people owe me
  paidBackCategory() { this.ensureCategory('Paid back', 'Income'); return 'Paid back'; }
  get owed() { return this.state.owed; }
  addOwed({ person, amount, currency, date, note = '', txId = null }) {
    const d = { id: uid(), createdAt: Date.now(), person: String(person).trim(), amount: Math.round(amount * 100) / 100, currency, date, note: String(note || '').trim(), txId, paid: [] };
    this.state.owed.push(d);
    this.commit();
    return d;
  }
  updateOwed(id, changes) { const d = this.state.owed.find((x) => x.id === id); if (d) { Object.assign(d, changes); this.commit(); } }
  deleteOwed(id) { const d = this.state.owed.find((x) => x.id === id) || null; this.state.owed = this.state.owed.filter((x) => x.id !== id); this.commit(); return d; }
  restoreOwed(d) { if (d && !this.state.owed.some((x) => x.id === d.id)) { this.state.owed.push(d); this.commit(); } }
  // Someone paid me back: marks off their oldest debts first. Returns what changed, so it can be undone.
  repay(person, amount, { date, currency = null, txId = null } = {}) {
    const plan = repayPlan(this.state.owed, person, amount, currency);
    const before = {};
    for (const part of plan.parts) {
      const d = this.state.owed.find((x) => x.id === part.id);
      before[d.id] = JSON.parse(JSON.stringify(d.paid || []));
      d.paid = [...(d.paid || []), { date, amount: part.take, ...(txId ? { txId } : {}) }];
    }
    if (plan.parts.length) this.commit();
    return { applied: Math.round((amount - plan.leftover) * 100) / 100, leftover: plan.leftover, before };
  }
  undoRepay(before) {
    for (const [id, paid] of Object.entries(before || {})) { const d = this.state.owed.find((x) => x.id === id); if (d) d.paid = paid; }
    this.commit();
  }

  get imports() { return this.state.imports; }
  get merchants() { return this.state.merchants; }
  learnMerchant(key, type, category) {
    if (!key) return;
    this.state.merchants[`${key}|${type}`] = category;
  }

  ensureCategoryQuiet(name, type) {
    const exists = this.state.categories.some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
    if (!exists && name) {
      const sortOrder = Math.max(-1, ...this.state.categories.map((c) => c.sortOrder)) + 1;
      this.state.categories.push({ id: uid(), name, type, sortOrder, budget: 0, budgetCurrency: 'EUR' });
    }
  }

  // ---- backup
  exportBackup(receipts = {}) {
    // the PIN lock stays on the phone it was set on, so it is left out of the file
    const settings = { ...this.state.settings, pinHash: null };
    return JSON.stringify({ app: 'Expense Tracker', version: 2, exportedAt: new Date().toISOString(), ...this.state, settings, receipts }, null, 2);
  }

  restoreBackup(json) {
    let parsed;
    try { parsed = JSON.parse(json); } catch { throw new Error('This file could not be read. Choose a backup that was saved from this app.'); }
    const { data, total } = cleanBackup(parsed, uid); // damaged rows are left out here, before anything is merged
    const out = { transactions: 0, categories: 0, rules: 0, skipped: total };
    for (const c of data.categories) {
      const exists = this.state.categories.some((x) => x.type === c.type && x.name.toLowerCase() === c.name.toLowerCase());
      if (!exists) { this.state.categories.push(c); out.categories += 1; }
    }
    const ids = new Set(this.state.transactions.map((t) => t.id));
    const rows = data.transactions.filter((t) => !ids.has(t.id));
    const result = this.insertRows(rows, this.settings.currency);
    out.transactions = result.added;
    const ruleIds = new Set(this.state.rules.map((r) => r.id));
    for (const r of data.rules) {
      if (!ruleIds.has(r.id)) { this.state.rules.push(r); out.rules += 1; }
    }
    for (const [k, v] of Object.entries(data.merchants)) if (!Object.prototype.hasOwnProperty.call(this.state.merchants, k)) this.state.merchants[k] = v;
    for (const key of ['accounts', 'transfers', 'goals', 'owed']) {
      if (!this.state[key]) this.state[key] = [];
      const have = new Set(this.state[key].map((x) => x.id));
      for (const x of data[key]) if (!have.has(x.id)) this.state[key].push(x);
    }
    this.commit();
    out.receipts = data.receipts;
    return out;
  }
}

export const store = new Store();
store.checkDamagedLeftover();

// Whatever is still waiting to be saved is written as the page is hidden or closed.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => store.flush());
  window.addEventListener('beforeunload', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
}

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

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, mrz: 3, mär: 3, mai: 5, okt: 10, dez: 12 };

// dayFirst: how to read 03/04/2025 when both readings are possible (true = 3 April, as in India and Germany).
export function parseDate(text, dayFirst = true) {
  const raw = (text || '').trim();
  const token = raw.split(/[ T]/)[0];
  let m;
  if ((m = raw.match(/^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/))) return build(+m[1], +m[2], +m[3]); // 20260304 (BMO and others)
  if ((m = token.match(DATE_FORMATS[0]))) return build(+m[1], +m[2], +m[3]);
  if ((m = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/))) return build(+m[1], +m[2], +m[3]);
  if ((m = token.match(DATE_FORMATS[1])) || (m = token.match(DATE_FORMATS[3]))) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return build(y, b, a);
    if (b > 12 && a <= 12) return build(y, a, b);
    return dayFirst ? build(y, b, a) : build(y, a, b);
  }
  if ((m = token.match(DATE_FORMATS[2]))) return build(+m[3], +m[2], +m[1]);
  // 16 Nov 2026 / 16-Nov-26 / 16. November 2026 / Nov 16, 2026 / November 16 2026
  const words = raw.replace(/,/g, ' ').replace(/\./g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 3) {
    const mi = words.findIndex((w) => MONTH_NAMES[w.slice(0, 4).toLowerCase()] !== undefined || MONTH_NAMES[w.slice(0, 3).toLowerCase()] !== undefined);
    if (mi >= 0) {
      const mo = MONTH_NAMES[words[mi].slice(0, 4).toLowerCase()] ?? MONTH_NAMES[words[mi].slice(0, 3).toLowerCase()];
      const nums = words.filter((w, i) => i !== mi && /^\d{1,4}$/.test(w)).map(Number);
      if (nums.length >= 2) {
        const y = nums.find((n) => n > 31) ?? nums[1];
        const d = nums.find((n) => n <= 31);
        if (d) return build(y, mo, d);
      }
    }
  }
  return null;
  function build(y, mo, d) {
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
}

// "14:35", "14:35:07", "2:35 pm", or a time inside a date-time cell → "14:35" or null
export function parseTime(text) {
  const m = (text || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = +m[1]; const min = +m[2];
  if (h > 23 || min > 59) return null;
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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
  const timeC = col('time'), tagsC = col('tags');
  const val = (row, c) => (c >= 0 && c < row.length ? row[c].trim() : '');
  for (const row of table.slice(headerIndex + 1)) {
    if (row.every((c) => !c.trim())) continue;
    const date = parseDate(val(row, dateC));
    const amountText = val(row, amountC);
    const raw = parseAmount(amountText);
    if (!date || raw === null || raw === 0) { result.skipped += 1; continue; }
    const type = val(row, typeC).toLowerCase().startsWith('inc') ? 'Income' : 'Expense';
    let category = csvUnsafe(val(row, catC)) || 'Other';
    let currency = val(row, curC).toUpperCase();
    if (!CURRENCY_CODES.includes(currency)) {
      currency = amountText.includes('€') ? 'EUR' : amountText.includes('₹') ? 'INR' : amountText.includes('CA$') ? 'CAD' : amountText.includes('$') ? 'USD' : null;
    }
    const row2 = { date, type, category, amount: Math.abs(raw), currency, desc: csvUnsafe(val(row, descC)) };
    const time = parseTime(val(row, timeC)); if (time) row2.time = time;
    const tags = val(row, tagsC).split(/[,;]/).map((x) => csvUnsafe(x.trim())).filter(Boolean); if (tags.length) row2.tags = tags;
    result.rows.push(row2);
  }
  return result;
}

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 15);
  const line = lines.find((l) => l.toLowerCase().includes('date')) || lines[0] || '';
  let best = ',', bestCount = 0;
  for (const c of [',', ';', '\t']) {
    const count = line.split(c).length - 1;
    if (count > bestCount) { best = c; bestCount = count; }
  }
  return best;
}

export function parseTable(text, delimiter) {
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

// Spreadsheet programs run text that starts with = + - @ as a formula. A leading apostrophe keeps it as plain text.
export const csvSafe = (s) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
// the reverse, for reading this app's own exports back in
export const csvUnsafe = (s) => (typeof s === 'string' && /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

export function exportCSV(transactions) {
  const esc = (v) => {
    const s = csvSafe(String(v ?? ''));
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const sorted = [...transactions].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  const lines = ['Date,Time,Type,Category,Amount,Currency,Description,Tags,Account'];
  const accName = (id) => (store.state.accounts.find((a) => a.id === id) || {}).name || '';
  for (const t of sorted) lines.push([t.date, t.time || '', t.type, esc(t.category), t.amount.toFixed(2), t.currency, esc(t.desc || ''), esc((t.tags || []).join(', ')), esc(accName(t.account))].join(','));
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
