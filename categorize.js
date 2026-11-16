// Guesses a category for a description: first from the person's own history, then from a keyword list.

// Words that banks add around the real merchant name. They carry no meaning for categorising.
const NOISE = new Set([
  'sepa', 'lastschrift', 'ueberweisung', 'überweisung', 'kartenzahlung', 'girocard', 'visa', 'mastercard', 'debit', 'credit',
  'card', 'karte', 'pos', 'upi', 'imps', 'neft', 'rtgs', 'ach', 'ref', 'txn', 'trx', 'transaction', 'payment', 'zahlung',
  'purchase', 'online', 'ecom', 'ecommerce', 'the', 'and', 'und', 'gmbh', 'ltd', 'llc', 'inc', 'pvt', 'co', 'kg', 'ag',
  'mandat', 'mandate', 'glaeubiger', 'gläubiger', 'eref', 'mref', 'cred', 'svwz', 'end', 'to', 'from', 'via', 'for', 'at',
  'www', 'com', 'de', 'in', 'us', 'auth', 'code', 'id', 'no', 'nr', 'bill', 'invoice', 'rechnung', 'dankeschoen', 'danke',
]);

export function normalise(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^a-zäöüßéèáàíóúñç&' ]+/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE.has(w))
    .join(' ')
    .trim();
}

export function tokens(desc) {
  return normalise(desc).split(' ').filter((w) => w.length >= 3);
}

// Keyword → category name. Only used when the category exists in the person's list.
// Income keywords are marked with type Income.
const KEYWORDS = [
  // income
  ['salary', 'Salary', 'Income'], ['gehalt', 'Salary', 'Income'], ['lohn', 'Salary', 'Income'], ['payroll', 'Salary', 'Income'], ['wages', 'Salary', 'Income'],
  ['freelance', 'Freelance', 'Income'], ['upwork', 'Freelance', 'Income'], ['fiverr', 'Freelance', 'Income'], ['honorar', 'Freelance', 'Income'],
  ['dividend', 'Investments', 'Income'], ['interest', 'Investments', 'Income'], ['zinsen', 'Investments', 'Income'],
  ['refund', 'Refunds', 'Income'], ['erstattung', 'Refunds', 'Income'], ['rückerstattung', 'Refunds', 'Income'], ['reversal', 'Refunds', 'Income'], ['cashback', 'Refunds', 'Income'],
  // groceries
  ['lidl', 'Groceries'], ['aldi', 'Groceries'], ['rewe', 'Groceries'], ['edeka', 'Groceries'], ['penny', 'Groceries'], ['netto', 'Groceries'], ['kaufland', 'Groceries'],
  ['tesco', 'Groceries'], ['sainsbury', 'Groceries'], ['walmart', 'Groceries'], ['costco', 'Groceries'], ['carrefour', 'Groceries'], ['dmart', 'Groceries'],
  ['bigbasket', 'Groceries'], ['blinkit', 'Groceries'], ['zepto', 'Groceries'], ['instamart', 'Groceries'], ['grofers', 'Groceries'], ['reliance fresh', 'Groceries'],
  ['supermarkt', 'Groceries'], ['supermarket', 'Groceries'], ['grocer', 'Groceries'], ['kirana', 'Groceries'], ['bakery', 'Groceries'], ['bäcker', 'Groceries'],
  // food & dining
  ['swiggy', 'Food & Dining'], ['zomato', 'Food & Dining'], ['lieferando', 'Food & Dining'], ['deliveroo', 'Food & Dining'], ['doordash', 'Food & Dining'], ['uber eats', 'Food & Dining'],
  ['mcdonald', 'Food & Dining'], ['burger king', 'Food & Dining'], ['kfc', 'Food & Dining'], ['subway', 'Food & Dining'], ['domino', 'Food & Dining'], ['pizza', 'Food & Dining'],
  ['starbucks', 'Food & Dining'], ['cafe', 'Food & Dining'], ['café', 'Food & Dining'], ['coffee', 'Food & Dining'], ['restaurant', 'Food & Dining'], ['imbiss', 'Food & Dining'],
  ['döner', 'Food & Dining'], ['doner', 'Food & Dining'], ['kebab', 'Food & Dining'], ['dhaba', 'Food & Dining'], ['canteen', 'Food & Dining'], ['mensa', 'Food & Dining'],
  ['bar', 'Food & Dining'], ['bistro', 'Food & Dining'], ['hotel', 'Travel'],
  // transport
  ['uber', 'Transport'], ['ola', 'Transport'], ['rapido', 'Transport'], ['bolt', 'Transport'], ['lyft', 'Transport'], ['taxi', 'Transport'],
  ['deutsche bahn', 'Transport'], ['db vertrieb', 'Transport'], ['db fernverkehr', 'Transport'], ['hvv', 'Transport'], ['bvg', 'Transport'], ['mvg', 'Transport'],
  ['irctc', 'Transport'], ['redbus', 'Transport'], ['metro', 'Transport'], ['bahn', 'Transport'], ['bus', 'Transport'], ['parking', 'Transport'], ['parken', 'Transport'],
  ['toll', 'Transport'], ['fastag', 'Transport'],
  // fuel
  ['shell', 'Fuel'], ['aral', 'Fuel'], ['esso', 'Fuel'], ['bp', 'Fuel'], ['hpcl', 'Fuel'], ['bpcl', 'Fuel'], ['indian oil', 'Fuel'], ['iocl', 'Fuel'],
  ['petrol', 'Fuel'], ['tankstelle', 'Fuel'], ['fuel', 'Fuel'], ['diesel', 'Fuel'],
  // utilities
  ['vattenfall', 'Utilities'], ['eon', 'Utilities'], ['stadtwerke', 'Utilities'], ['strom', 'Utilities'], ['electric', 'Utilities'],
  ['water', 'Utilities'], ['wasser', 'Utilities'], ['gas', 'Utilities'], ['torrent power', 'Utilities'], ['mgvcl', 'Utilities'], ['dgvcl', 'Utilities'], ['ugvcl', 'Utilities'],
  ['pgvcl', 'Utilities'], ['bescom', 'Utilities'], ['tata power', 'Utilities'], ['adani electricity', 'Utilities'], ['rundfunk', 'Utilities'], ['ard zdf', 'Utilities'],
  // phone & internet
  ['vodafone', 'Phone & Internet'], ['telekom', 'Phone & Internet'], ['o2', 'Phone & Internet'], ['congstar', 'Phone & Internet'],
  ['jio', 'Phone & Internet'], ['airtel', 'Phone & Internet'], ['bsnl', 'Phone & Internet'], ['mobile', 'Phone & Internet'],
  ['internet', 'Phone & Internet'], ['broadband', 'Phone & Internet'], ['wifi', 'Phone & Internet'], ['recharge', 'Phone & Internet'],
  // health
  ['apotheke', 'Health'], ['pharmacy', 'Health'], ['chemist', 'Health'], ['apollo', 'Health'], ['medplus', 'Health'], ['hospital', 'Health'], ['clinic', 'Health'],
  ['doctor', 'Health'], ['arzt', 'Health'], ['dental', 'Health'], ['zahn', 'Health'], ['pharm', 'Health'], ['medical', 'Health'], ['lab', 'Health'],
  // insurance
  ['insurance', 'Insurance'], ['versicherung', 'Insurance'], ['allianz', 'Insurance'], ['tk', 'Insurance'], ['techniker', 'Insurance'], ['aok', 'Insurance'],
  ['barmer', 'Insurance'], ['lic', 'Insurance'], ['hdfc ergo', 'Insurance'], ['icici lombard', 'Insurance'], ['policy', 'Insurance'],
  // shopping
  ['amazon', 'Shopping'], ['flipkart', 'Shopping'], ['myntra', 'Shopping'], ['ajio', 'Shopping'], ['meesho', 'Shopping'], ['ikea', 'Shopping'], ['zara', 'Shopping'],
  ['decathlon', 'Shopping'], ['saturn', 'Shopping'], ['media markt', 'Shopping'], ['mediamarkt', 'Shopping'], ['apple store', 'Shopping'],
  ['dm', 'Shopping'], ['rossmann', 'Shopping'], ['müller', 'Shopping'], ['primark', 'Shopping'], ['nykaa', 'Shopping'], ['croma', 'Shopping'], ['ebay', 'Shopping'],
  // entertainment
  ['cinema', 'Entertainment'], ['kino', 'Entertainment'], ['pvr', 'Entertainment'], ['inox', 'Entertainment'], ['bookmyshow', 'Entertainment'], ['steam', 'Entertainment'],
  ['playstation', 'Entertainment'], ['xbox', 'Entertainment'], ['nintendo', 'Entertainment'], ['concert', 'Entertainment'], ['theatre', 'Entertainment'], ['theater', 'Entertainment'],
  // subscriptions
  ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'], ['prime video', 'Subscriptions'], ['amazon prime', 'Subscriptions'], ['disney', 'Subscriptions'],
  ['hotstar', 'Subscriptions'], ['youtube', 'Subscriptions'], ['apple com bill', 'Subscriptions'], ['icloud', 'Subscriptions'], ['google one', 'Subscriptions'],
  ['chatgpt', 'Subscriptions'], ['openai', 'Subscriptions'], ['claude', 'Subscriptions'], ['anthropic', 'Subscriptions'], ['microsoft 365', 'Subscriptions'], ['adobe', 'Subscriptions'],
  ['dropbox', 'Subscriptions'], ['gym', 'Subscriptions'], ['fitness', 'Subscriptions'], ['cult fit', 'Subscriptions'], ['subscription', 'Subscriptions'], ['abo', 'Subscriptions'],
  // travel
  ['airline', 'Travel'], ['lufthansa', 'Travel'], ['indigo', 'Travel'], ['air india', 'Travel'], ['ryanair', 'Travel'], ['easyjet', 'Travel'], ['emirates', 'Travel'],
  ['booking com', 'Travel'], ['airbnb', 'Travel'], ['makemytrip', 'Travel'], ['goibibo', 'Travel'], ['expedia', 'Travel'], ['flight', 'Travel'], ['flug', 'Travel'],
  ['hostel', 'Travel'], ['oyo', 'Travel'], ['trivago', 'Travel'],
  // education
  ['udemy', 'Education'], ['coursera', 'Education'], ['university', 'Education'], ['universität', 'Education'], ['school', 'Education'], ['college', 'Education'],
  ['tuition', 'Education'], ['semester', 'Education'], ['course', 'Education'], ['book', 'Education'], ['buch', 'Education'],
  // rent
  ['miete', 'Rent'], ['rent', 'Rent'], ['landlord', 'Rent'], ['vermieter', 'Rent'], ['wohnung', 'Rent'], ['housing', 'Rent'], ['pg', 'Rent'],
  // family / gifts / donations
  ['donation', 'Gifts & Donations'], ['spende', 'Gifts & Donations'], ['charity', 'Gifts & Donations'], ['temple', 'Gifts & Donations'], ['mosque', 'Gifts & Donations'],
  ['church', 'Gifts & Donations'], ['gift', 'Gifts & Donations'], ['geschenk', 'Gifts & Donations'],
  ['family', 'Family'], ['familie', 'Family'], ['mom', 'Family'], ['dad', 'Family'], ['papa', 'Family'], ['mummy', 'Family'],
  // fees
  ['fee', 'Fees & Charges'], ['gebühr', 'Fees & Charges'], ['gebuehr', 'Fees & Charges'], ['charges', 'Fees & Charges'], ['entgelt', 'Fees & Charges'], ['gst', 'Fees & Charges'],
  ['kontoführung', 'Fees & Charges'], ['service charge', 'Fees & Charges'], ['penalty', 'Fees & Charges'], ['late payment', 'Fees & Charges'],
  // cash
  ['atm', 'Cash Withdrawal'], ['withdrawal', 'Cash Withdrawal'], ['bargeld', 'Cash Withdrawal'], ['geldautomat', 'Cash Withdrawal'], ['cash', 'Cash Withdrawal'],
];

function findCategory(categories, name, type) {
  const n = name.toLowerCase();
  return categories.find((c) => c.type === type && c.name.toLowerCase() === n)
    || categories.find((c) => c.type === type && (c.name.toLowerCase().includes(n.split(' ')[0]) || n.includes(c.name.toLowerCase())));
}

// Index of the person's own history, built once per call site.
export function buildIndex(transactions) {
  const exact = new Map();   // normalised description → stats
  const byToken = new Map(); // token → Map(category|type → count)
  for (const t of transactions) {
    const key = normalise(t.desc);
    if (!key) continue;
    const ck = `${t.category}|${t.type}`;
    let e = exact.get(key);
    if (!e) { e = { counts: new Map(), amounts: [], last: null }; exact.set(key, e); }
    e.counts.set(ck, (e.counts.get(ck) || 0) + 1);
    e.amounts.push(t.amount);
    if (!e.last || t.date > e.last.date) e.last = t;
    for (const w of key.split(' ')) {
      if (w.length < 3) continue;
      let m = byToken.get(w);
      if (!m) { m = new Map(); byToken.set(w, m); }
      m.set(ck, (m.get(ck) || 0) + 1);
    }
  }
  return { exact, byToken };
}

const best = (entries) => [...entries].sort((a, b) => b[1] - a[1])[0];

// Returns { category, type, amount, source } or null. `source` is 'history', 'similar' or 'keyword'.
export function suggest(desc, index, categories, { type = null } = {}) {
  const key = normalise(desc);
  if (!key) return null;
  const typeOk = (ck) => !type || ck.endsWith('|' + type);

  const e = index.exact.get(key);
  if (e) {
    const hit = best([...e.counts.entries()].filter(([ck]) => typeOk(ck)));
    if (hit) {
      const [category, t] = hit[0].split('|');
      // a usual amount only when the last few entries agree
      const recent = e.amounts.slice(-3);
      const amount = recent.length >= 2 && recent.every((a) => Math.abs(a - recent[0]) < 0.005) ? recent[0] : null;
      return { category, type: t, amount, source: 'history' };
    }
  }

  // partial match: score categories by the tokens they share with past descriptions
  const score = new Map();
  for (const w of key.split(' ')) {
    const m = index.byToken.get(w);
    if (!m || w.length < 3) continue;
    if (m.size > 4) continue; // a word that appears under many categories says nothing
    for (const [ck, n] of m) if (typeOk(ck)) score.set(ck, (score.get(ck) || 0) + n);
  }
  const hit = best(score.entries());
  if (hit && hit[1] >= 1) {
    const [category, t] = hit[0].split('|');
    return { category, type: t, amount: null, source: 'similar' };
  }

  // keyword list, mapped onto the person's own category names. Whole words only, so "ola" never matches "cola".
  const padded = ' ' + (desc || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim() + ' ';
  for (const [kw, name, kType = 'Expense'] of KEYWORDS) {
    if (type && kType !== type) continue;
    if (!padded.includes(' ' + kw + ' ')) continue;
    const cat = findCategory(categories, name, kType);
    if (cat) return { category: cat.name, type: kType, amount: null, source: 'keyword' };
  }
  return null;
}
