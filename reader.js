// Opens whatever the bank gave you — Excel (.xls / .xlsx), CSV, a PDF, an HTML table, or text pasted from a PDF —
// and returns plain rows of text for statement.js to make sense of.
import { readXls, readXlsx } from './sheets.js';
import { parseTable, detectDelimiter } from './store.js';

const startsWith = (b, sig) => sig.every((v, i) => b[i] === v);

function decode(bytes) {
  if (startsWith(bytes, [0xFF, 0xFE])) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (startsWith(bytes, [0xFE, 0xFF])) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// Many banks save an "Excel" file that is really an HTML table or old XML spreadsheet.
function htmlRows(html) {
  const rows = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const td of tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) cells.push(decodeEntities(td[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}
function spreadsheetMLRows(xml) {
  const rows = [];
  for (const r of xml.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi)) {
    const cells = [];
    for (const c of r[1].matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
      const idx = (c[1].match(/(?:ss:)?Index="(\d+)"/i) || [])[1];
      if (idx) while (cells.length < +idx - 1) cells.push('');
      const d = (c[2] || '').match(/<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i);
      cells.push(d ? decodeEntities(d[1].replace(/<[^>]+>/g, '')).trim() : '');
    }
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------- text: delimited tables, or lines copied out of a PDF

const DATE_RE = '(?:\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[ \\-][A-Za-z]{3,9}\\.?[ \\-,]+\\d{2,4})';
const LINE_START = new RegExp(`^\\s*(?:\\d{1,4}[ .)]\\s+)?(${DATE_RE})(?=\\s|$)`);
const SECOND_DATE = new RegExp(`^\\s*(${DATE_RE})(?=\\s|$)`);
const TRAILING_AMOUNT = /(?:^|\s)(-?\(?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{1,2}\)?)\s*(cr|dr|CR|DR|Cr|Dr)?\s*$/;
const NOISE_LINE = /^(page\s+\d+|\d+\s+of\s+\d+|statement of account|account statement|continued|www\.|this is a computer|registered office|legends?)/i;

export function rowsFromText(text) {
  const clean = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = clean.split('\n');
  const filled = lines.filter((l) => l.trim());
  // delimited text (CSV / TSV)?
  const delimiter = detectDelimiter(clean);
  const table = parseTable(clean, delimiter);
  const wide = table.filter((r) => r.filter((c) => c.trim()).length >= 3).length;
  if (wide >= Math.max(3, filled.length * 0.4)) return table.map((r) => r.map((c) => c.trim()));
  return lineRows(filled);
}

// "18/08/2026 UPI/ZOMATO/… 410.00 2,018,408.35" and friends: a line that starts with a date begins a transaction;
// numbers at its end are the amounts; lines without a date continue the previous narration.
function lineRows(lines) {
  const records = [];
  let open = null;
  for (const raw of lines) {
    let line = raw.trim().replace(/\s{2,}/g, '  ');
    if (!line || NOISE_LINE.test(line)) continue;
    const m = line.match(LINE_START);
    if (m) {
      let rest = line.slice(line.indexOf(m[1]) + m[1].length).trim();
      const second = rest.match(SECOND_DATE);
      if (second) rest = rest.slice(second[0].length).trim();      // value date next to the transaction date
      open = { date: m[1], desc: '', amounts: [] };
      records.push(open);
      line = rest;
    } else if (!open) continue;
    // numbers at the end of the line
    let guard = 0;
    while (open.amounts.length < 3 && guard++ < 3) {
      const a = line.match(TRAILING_AMOUNT);
      if (!a) break;
      open.amounts.unshift(a[1] + (a[2] ? ' ' + a[2] : ''));
      line = line.slice(0, line.length - a[0].length).trim();
    }
    if (line) open.desc = open.desc ? `${open.desc} ${line}` : line;
  }
  const withMoney = records.filter((r) => r.amounts.length);
  if (!withMoney.length) return [];
  const count = (n) => withMoney.filter((r) => r.amounts.length === n).length;
  const three = count(3) >= count(2) && count(3) >= count(1) && count(3) > 0;
  const two = !three && count(2) >= count(1) && count(2) > 0;
  const head = three ? ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'] : two ? ['Date', 'Description', 'Amount', 'Balance'] : ['Date', 'Description', 'Amount'];
  const rows = [head];
  for (const r of withMoney) {
    const a = r.amounts;
    if (three) rows.push([r.date, r.desc, a[0] ?? '', a[1] ?? '', a[2] ?? '']);
    else if (two) rows.push([r.date, r.desc, a.length >= 2 ? a[a.length - 2] : a[0], a.length >= 2 ? a[a.length - 1] : '']);
    else rows.push([r.date, r.desc, a[a.length - 1]]);
  }
  return rows;
}

// ---------------------------------------------------------------- PDF

async function pdfText(bytes, password) {
  const pdfjs = await import('./pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
  let doc;
  try { doc = await pdfjs.getDocument({ data: bytes.slice(), password: password || undefined }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') { const err = new Error(e.code === 2 ? 'That password is not right.' : 'This PDF is locked with a password.'); err.needsPassword = true; err.wrong = e.code === 2; throw err; }
    throw new Error('I could not open this PDF.');
  }
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const words = items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 8 }));
    words.sort((a, b) => (Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x));
    let line = [], lineY = null;
    const flush = () => {
      if (!line.length) return;
      line.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const w of line) {
        if (end !== null) text += w.x - end > w.h * 0.9 ? '  ' : w.x - end > 0.5 ? ' ' : '';
        text += w.s; end = w.x + w.w;
      }
      out.push(text);
      line = [];
    };
    for (const w of words) {
      if (lineY !== null && Math.abs(w.y - lineY) > 2.5) { flush(); lineY = w.y; } else if (lineY === null) lineY = w.y;
      line.push(w);
    }
    flush();
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- public

// → { kind, sheets: [{ name, rows }] }   (throws an Error with a plain-language message)
export async function readBytes(bytes, name = '', { password = null } = {}) {
  if (startsWith(bytes, [0xD0, 0xCF, 0x11, 0xE0])) return { kind: 'xls', sheets: readXls(bytes) };
  if (startsWith(bytes, [0x50, 0x4B, 0x03, 0x04])) {
    const sheets = await readXlsx(bytes);
    if (!sheets.length) throw new Error('I could not find a spreadsheet inside this file.');
    return { kind: 'xlsx', sheets };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    const text = await pdfText(bytes, password);
    const rows = rowsFromText(text);
    if (!rows.length) throw new Error('This PDF has no text I can read (it may be a scanned picture). Try the Excel or CSV version from your bank.');
    return { kind: 'pdf', sheets: [{ name: 'PDF', rows, hint: text.slice(0, 4000) }] };
  }
  const text = decode(bytes);
  if (/^\s*<\?xml/.test(text) && /urn:schemas-microsoft-com:office:spreadsheet/.test(text)) return { kind: 'xml', sheets: [{ name: 'Sheet', rows: spreadsheetMLRows(text) }] };
  if (/<table\b/i.test(text)) return { kind: 'html', sheets: [{ name: 'Table', rows: htmlRows(text) }] };
  const rows = rowsFromText(text);
  return { kind: /\.tsv$/i.test(name) ? 'tsv' : 'text', sheets: [{ name: 'Text', rows, hint: text.slice(0, 4000) }] };
}

export async function readFileInput(file, opts) {
  return readBytes(new Uint8Array(await file.arrayBuffer()), file.name, opts);
}

export function readPasted(text) {
  return { kind: 'paste', sheets: [{ name: 'Pasted text', rows: rowsFromText(text), hint: text.slice(0, 4000) }] };
}
