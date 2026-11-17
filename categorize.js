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
  ['jio', 'Phone & Internet'], ['airtel', 'Phone & Internet'], ['bharti', 'Phone & Internet'], ['vi', 'Phone & Internet'], ['vodafone idea', 'Phone & Internet'], ['bsnl', 'Phone & Internet'], ['mobile', 'Phone & Internet'],
  ['internet', 'Phone & Internet'], ['broadband', 'Phone & Internet'], ['wifi', 'Phone & Internet'], ['recharge', 'Phone & Internet'],
  // health
  ['apotheke', 'Health'], ['pharmacy', 'Health'], ['chemist', 'Health'], ['apollo', 'Health'], ['medplus', 'Health'], ['hospital', 'Health'], ['clinic', 'Health'],
  ['doctor', 'Health'], ['arzt', 'Health'], ['dental', 'Health'], ['zahn', 'Health'], ['pharm', 'Health'], ['medical', 'Health'], ['lab', 'Health'],
  // insurance
  ['insurance', 'Insurance'], ['versicherung', 'Insurance'], ['allianz', 'Insurance'], ['tk', 'Insurance'], ['techniker', 'Insurance'], ['aok', 'Insurance'],
  ['barmer', 'Insurance'], ['lic', 'Insurance'], ['hdfc ergo', 'Insurance'], ['icici lombard', 'Insurance'], ['policy', 'Insurance'],
  // shopping
  ['zudio', 'Shopping'], ['trends', 'Shopping'], ['lifestyle', 'Shopping'], ['pantaloons', 'Shopping'], ['reliance digital', 'Shopping'], ['amazon', 'Shopping'], ['flipkart', 'Shopping'], ['myntra', 'Shopping'], ['ajio', 'Shopping'], ['meesho', 'Shopping'], ['ikea', 'Shopping'], ['zara', 'Shopping'],
  ['decathlon', 'Shopping'], ['saturn', 'Shopping'], ['media markt', 'Shopping'], ['mediamarkt', 'Shopping'], ['apple store', 'Shopping'],
  ['dm', 'Shopping'], ['rossmann', 'Shopping'], ['müller', 'Shopping'], ['primark', 'Shopping'], ['nykaa', 'Shopping'], ['croma', 'Shopping'], ['ebay', 'Shopping'],
  // entertainment
  ['cinema', 'Entertainment'], ['kino', 'Entertainment'], ['pvr', 'Entertainment'], ['inox', 'Entertainment'], ['bookmyshow', 'Entertainment'], ['steam', 'Entertainment'],
  ['playstation', 'Entertainment'], ['xbox', 'Entertainment'], ['nintendo', 'Entertainment'], ['concert', 'Entertainment'], ['theatre', 'Entertainment'], ['theater', 'Entertainment'],
  // subscriptions
  ['netflix', 'Subscriptions'], ['spotify', 'Subscriptions'], ['prime video', 'Subscriptions'], ['amazon prime', 'Subscriptions'], ['disney', 'Subscriptions'],
  ['apple medi', 'Subscriptions'], ['apple media', 'Subscriptions'], ['appleservices', 'Subscriptions'], ['hotstar', 'Subscriptions'], ['youtube', 'Subscriptions'], ['apple com bill', 'Subscriptions'], ['icloud', 'Subscriptions'], ['google one', 'Subscriptions'],
  ['chatgpt', 'Subscriptions'], ['openai', 'Subscriptions'], ['claude', 'Subscriptions'], ['anthropic', 'Subscriptions'], ['microsoft 365', 'Subscriptions'], ['adobe', 'Subscriptions'],
  ['dropbox', 'Subscriptions'], ['gym', 'Subscriptions'], ['fitness', 'Subscriptions'], ['cult fit', 'Subscriptions'], ['subscription', 'Subscriptions'], ['abo', 'Subscriptions'],
  // Canada
  ['tim hortons', 'Food & Dining'], ['timmies', 'Food & Dining'], ['a&w', 'Food & Dining'], ['harveys', 'Food & Dining'], ['second cup', 'Food & Dining'], ['pizza pizza', 'Food & Dining'],
  ['skipthedishes', 'Food & Dining'], ['skip the dishes', 'Food & Dining'], ['loblaws', 'Groceries'], ['no frills', 'Groceries'], ['nofrills', 'Groceries'], ['freshco', 'Groceries'],
  ['sobeys', 'Groceries'], ['food basics', 'Groceries'], ['farm boy', 'Groceries'], ['superstore', 'Groceries'], ['save-on-foods', 'Groceries'], ['fortinos', 'Groceries'], ['zehrs', 'Groceries'],
  ['t&t supermarket', 'Groceries'], ['shoppers drug mart', 'Health'], ['rexall', 'Health'], ['london drugs', 'Health'], ['pharmasave', 'Health'], ['jean coutu', 'Health'],
  ['presto', 'Transport'], ['ttc', 'Transport'], ['go transit', 'Transport'], ['translink', 'Transport'], ['oc transpo', 'Transport'], ['via rail', 'Transport'],
  ['petro-canada', 'Fuel'], ['petro canada', 'Fuel'], ['husky', 'Fuel'], ['ultramar', 'Fuel'], ['pioneer', 'Fuel'],
  ['rogers', 'Phone & Internet'], ['telus', 'Phone & Internet'], ['fido', 'Phone & Internet'], ['koodo', 'Phone & Internet'], ['freedom mobile', 'Phone & Internet'], ['virgin plus', 'Phone & Internet'],
  ['public mobile', 'Phone & Internet'], ['bell canada', 'Phone & Internet'], ['bell mobility', 'Phone & Internet'],
  ['hydro one', 'Utilities'], ['toronto hydro', 'Utilities'], ['bc hydro', 'Utilities'], ['hydro-quebec', 'Utilities'], ['enbridge', 'Utilities'], ['fortisbc', 'Utilities'], ['enmax', 'Utilities'], ['epcor', 'Utilities'],
  ['canadian tire', 'Shopping'], ['winners', 'Shopping'], ['homesense', 'Shopping'], ['marshalls', 'Shopping'], ['dollarama', 'Shopping'], ['best buy', 'Shopping'], ['staples', 'Shopping'], ['ikea', 'Shopping'], ['indigo', 'Shopping'],
  ['sun life', 'Insurance'], ['manulife', 'Insurance'], ['desjardins', 'Insurance'], ['intact', 'Insurance'],
  ['abm', 'Cash Withdrawal'], ['monthly account fee', 'Fees & Charges'], ['overdraft', 'Fees & Charges'], ['nsf fee', 'Fees & Charges'], ['payroll', 'Income'], ['direct deposit', 'Income'],
  // everyday words, as people type them
  ['chai', 'Food & Dining'], ['tea', 'Food & Dining'], ['lunch', 'Food & Dining'], ['dinner', 'Food & Dining'], ['breakfast', 'Food & Dining'], ['snack', 'Food & Dining'], ['snacks', 'Food & Dining'],
  ['samosa', 'Food & Dining'], ['biryani', 'Food & Dining'], ['pizza', 'Food & Dining'], ['burger', 'Food & Dining'], ['thali', 'Food & Dining'], ['meal', 'Food & Dining'], ['tiffin', 'Food & Dining'],
  ['juice', 'Food & Dining'], ['lassi', 'Food & Dining'], ['dosa', 'Food & Dining'], ['idli', 'Food & Dining'], ['vada pav', 'Food & Dining'], ['pav bhaji', 'Food & Dining'], ['ice cream', 'Food & Dining'],
  ['bakery', 'Food & Dining'], ['canteen', 'Food & Dining'], ['dhaba', 'Food & Dining'], ['maggi', 'Food & Dining'], ['momos', 'Food & Dining'], ['sandwich', 'Food & Dining'], ['chaat', 'Food & Dining'],
  ['pani puri', 'Food & Dining'], ['cold drink', 'Food & Dining'], ['eating out', 'Food & Dining'], ['takeaway', 'Food & Dining'],
  ['grocery', 'Groceries'], ['groceries', 'Groceries'], ['vegetables', 'Groceries'], ['veggies', 'Groceries'], ['sabzi', 'Groceries'], ['sabji', 'Groceries'], ['fruits', 'Groceries'], ['milk', 'Groceries'],
  ['kirana', 'Groceries'], ['dairy', 'Groceries'], ['eggs', 'Groceries'],
  ['auto', 'Transport'], ['rickshaw', 'Transport'], ['cab', 'Transport'], ['taxi', 'Transport'], ['parking', 'Transport'], ['toll', 'Transport'], ['bike taxi', 'Transport'], ['train ticket', 'Transport'], ['bus ticket', 'Transport'],
  ['cng', 'Fuel'], ['electricity', 'Utilities'], ['light bill', 'Utilities'], ['current bill', 'Utilities'], ['water bill', 'Utilities'], ['gas bill', 'Utilities'], ['lpg', 'Utilities'], ['cylinder', 'Utilities'],
  ['data pack', 'Phone & Internet'], ['postpaid', 'Phone & Internet'], ['prepaid', 'Phone & Internet'],
  ['medicine', 'Health'], ['medicines', 'Health'], ['checkup', 'Health'], ['physio', 'Health'],
  ['clothes', 'Shopping'], ['shoes', 'Shopping'], ['shirt', 'Shopping'], ['jeans', 'Shopping'], ['dress', 'Shopping'],
  ['movie', 'Entertainment'], ['movies', 'Entertainment'], ['film', 'Entertainment'], ['outing', 'Entertainment'],
  ['tuition', 'Education'], ['stationery', 'Education'], ['exam fee', 'Education'], ['gift', 'Gifts & Donations'], ['donation', 'Gifts & Donations'], ['charity', 'Gifts & Donations'],
  ['fine', 'Fees & Charges'], ['penalty', 'Fees & Charges'], ['late fee', 'Fees & Charges'],
  // travel
  ['airline', 'Travel'], ['lufthansa', 'Travel'], ['indigo', 'Travel'], ['air india', 'Travel'], ['ryanair', 'Travel'], ['easyjet', 'Travel'], ['emirates', 'Travel'],
  ['booking com', 'Travel'], ['airbnb', 'Travel'], ['makemytrip', 'Travel'], ['goibibo', 'Travel'], ['expedia', 'Travel'], ['flight', 'Travel'], ['flug', 'Travel'],
  ['hostel', 'Travel'], ['holiday', 'Travel'], ['holidays', 'Travel'], ['tours', 'Travel'], ['travels', 'Travel'], ['kerala hol', 'Travel'], ['oyo', 'Travel'], ['trivago', 'Travel'],
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

// Keywords that are often something else ("hotel" can be a restaurant, "lab" a school). Suggestions from these are marked "check".
const WEAK = new Set(['hotel', 'bar', 'bus', 'lab', 'pg', 'dm', 'tk', 'abo', 'mobile', 'book', 'course', 'cash', 'gas', 'water', 'metro', 'ola', 'bolt', 'fee', 'gym', 'vi', 'trends', 'bp', 'doctor', 'family']);

// What the payer typed as the UPI note ("Food", "Rent", …) → a category name.
const NOTE_HINTS = [
  [/\b(food|lunch|dinner|breakfast|snacks?|tea|coffee|chai|meal|biryani|pizza)\b/i, 'Food & Dining'],
  [/\b(family|home|house|ghar|mom|dad|mummy|papa|brother|sister|wife|husband|expenses)\b/i, 'Family'],
  [/\b(rent|room)\b/i, 'Rent'],
  [/\b(grocer\w*|vegetables?|fruits?|milk|kirana)\b/i, 'Groceries'],
  [/\b(petrol|diesel|fuel)\b/i, 'Fuel'],
  [/\b(bill|bills|electricity|light bill|water|gas)\b/i, 'Utilities'],
  [/\b(recharge|mobile|internet|wifi|broadband)\b/i, 'Phone & Internet'],
  [/\b(medicine|medical|doctor|hospital|health)\b/i, 'Health'],
  [/\b(travel|ticket|trip|flight|train|bus)\b/i, 'Travel'],
  [/\b(gift|donation|charity|zakat|sadaqa)\b/i, 'Gifts & Donations'],
  [/\b(fees?|school|tuition|college|course|books?)\b/i, 'Education'],
  [/\b(shopping|clothes|dress)\b/i, 'Shopping'],
];


// Index of the person's own history (and what they have taught the app), built once per call site.
export function buildIndex(transactions, learned = {}) {
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
  return { exact, byToken, learned: new Map(Object.entries(learned || {})) };
}

const best = (entries) => [...entries].sort((a, b) => b[1] - a[1])[0];

function fromHistory(desc, index, type) {
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
  return null;
}

// keyword list, mapped onto the person's own category names. Whole words only, so "ola" never matches "cola".
function fromKeywords(text, categories, type) {
  const padded = ' ' + (text || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim() + ' ';
  for (const [kw, name, kType = 'Expense'] of KEYWORDS) {
    if (type && kType !== type) continue;
    if (!padded.includes(' ' + kw + ' ')) continue;
    const cat = findCategory(categories, name, kType);
    if (cat) return { category: cat.name, type: kType, amount: null, source: 'keyword', weak: WEAK.has(kw) };
  }
  return null;
}

// Returns { category, type, amount, source } or null. `source` is 'history', 'similar' or 'keyword'.
export function suggest(desc, index, categories, { type = null } = {}) {
  return fromHistory(desc, index, type) || fromKeywords(desc, categories, type);
}

export const learnKey = (key, type) => `${key}|${type}`;

// Everything we know about one statement line. `row` comes from statement.js (name, note, kind, key, type).
// Order of trust: what you taught me → your own history → the type of payment → the note the payer typed → the keyword list.
export function categorise(row, index, categories) {
  const type = row.type;
  const taught = index.learned.get(learnKey(row.key, type));
  if (taught && categories.some((c) => c.type === type && c.name === taught)) return { category: taught, type, source: 'taught' };
  const hist = fromHistory(row.name, index, type);
  if (hist && categories.some((c) => c.type === type && c.name === hist.category)) return hist;
  if (row.kind === 'cash' && type === 'Expense') { const c = findCategory(categories, 'Cash Withdrawal', type); if (c) return { category: c.name, type, source: 'kind' }; }
  if (row.kind === 'charge' && type === 'Expense') { const c = findCategory(categories, 'Fees & Charges', type); if (c) return { category: c.name, type, source: 'kind' }; }
  if (row.kind === 'interest' && type === 'Income') { const c = findCategory(categories, 'Investments', type) || findCategory(categories, 'Interest', type); if (c) return { category: c.name, type, source: 'kind' }; }
  if (row.note && type === 'Expense') {
    for (const [re, name] of NOTE_HINTS) {
      if (re.test(row.note)) { const c = findCategory(categories, name, type); if (c) return { category: c.name, type, source: 'note' }; }
    }
  }
  const kw = fromKeywords(`${row.name} ${row.note || ''}`, categories, type);
  if (kw) return kw;
  return null;
}
