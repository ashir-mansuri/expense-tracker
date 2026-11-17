// Reads Excel files straight from the phone, with no libraries and no upload:
//   • old Excel files (.xls, the format most Indian banks still hand out)
//   • modern Excel files (.xlsx)
// Both come back as plain rows of text: string[][].

const u8 = (b, o) => b[o];
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const END = 0xFFFFFFFB; // sector numbers above this are markers (end of chain, free sector, …)

const widest = (grid) => { let w = 0; for (let i = 0; i < grid.length; i++) if (grid[i] && grid[i].length > w) w = grid[i].length; return w; };

// ---------------------------------------------------------------- numbers and dates

export function numberText(n) {
  if (Number.isInteger(n)) return String(n);
  return String(+n.toPrecision(15));
}

function serialToDate(serial, date1904) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  return new Date(epoch + ms);
}

export function dateText(serial, date1904 = false) {
  const d = serialToDate(serial, date1904);
  const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), day = String(d.getUTCDate()).padStart(2, '0');
  const frac = serial - Math.floor(serial);
  let out = `${y}-${m}-${day}`;
  if (frac > 0.0001) out += ` ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code) {
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').replace(/_./g, '').replace(/\*./g, '');
  if (/^general$/i.test(stripped.trim())) return false;
  return /[dmyhs]/i.test(stripped) && !/^[#0.,%\s?$€₹-]+$/.test(stripped);
}

// ---------------------------------------------------------------- .xls (OLE container + BIFF8)

function readContainer(bytes) {
  const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (bytes.length < 512 || !sig.every((v, i) => bytes[i] === v)) throw new Error('This is not an Excel (.xls) file.');
  const secSize = 1 << u16(bytes, 0x1E);
  const miniSize = 1 << u16(bytes, 0x20);
  const dirStart = u32(bytes, 0x30), cutoff = u32(bytes, 0x38);
  const miniStart = u32(bytes, 0x3C), difStart = u32(bytes, 0x44), nDif = u32(bytes, 0x48);
  const sectorOff = (s) => (s + 1) * secSize;

  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = u32(bytes, 0x4C + i * 4); if (s <= END) fatSectors.push(s); }
  let d = difStart;
  for (let i = 0; i < nDif && d <= END; i++) {
    const off = sectorOff(d);
    for (let j = 0; j < secSize / 4 - 1; j++) { const s = u32(bytes, off + j * 4); if (s <= END) fatSectors.push(s); }
    d = u32(bytes, off + secSize - 4);
  }
  const fat = [];
  for (const s of fatSectors) { const off = sectorOff(s); for (let j = 0; j < secSize / 4; j++) fat.push(u32(bytes, off + j * 4)); }

  const chain = (start, table) => {
    const out = []; const seen = new Set(); let s = start;
    while (s <= END && !seen.has(s) && s < table.length) { seen.add(s); out.push(s); s = table[s]; }
    return out;
  };
  const readFat = (start, size) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(bytes.subarray(sectorOff(s), sectorOff(s) + secSize), i * secSize));
    return size == null ? out : out.subarray(0, size);
  };

  const dir = readFat(dirStart);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = u16(dir, o + 0x40);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(u16(dir, o + i * 2));
    entries.push({ name, type: u8(dir, o + 0x42), start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const root = entries[0];
  let mini = null, miniFat = null;
  const stream = (name) => {
    const e = entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    if (e.size >= cutoff) return readFat(e.start, e.size);
    if (!mini) {
      mini = readFat(root.start, root.size);
      const t = readFat(miniStart);
      miniFat = []; for (let i = 0; i + 4 <= t.length; i += 4) miniFat.push(u32(t, i));
    }
    const secs = chain(e.start, miniFat);
    const out = new Uint8Array(secs.length * miniSize);
    secs.forEach((s, i) => out.set(mini.subarray(s * miniSize, s * miniSize + miniSize), i * miniSize));
    return out.subarray(0, e.size);
  };
  return { stream };
}

function* records(b, start = 0) {
  let p = start;
  while (p + 4 <= b.length) {
    const id = u16(b, p), len = u16(b, p + 2);
    yield { id, off: p + 4, len };
    p += 4 + len;
  }
}

// Text inside a BIFF record: [length][flags][characters]. Returns { text, end }.
function biffString(b, off, cchBytes) {
  const cch = cchBytes === 2 ? u16(b, off) : b[off];
  let p = off + cchBytes;
  const flags = b[p++];
  const wide = flags & 1, rich = flags & 8, ext = flags & 4;
  let runs = 0, extLen = 0;
  if (rich) { runs = u16(b, p); p += 2; }
  if (ext) { extLen = u32(b, p); p += 4; }
  let s = '';
  if (wide) { for (let i = 0; i < cch; i++) s += String.fromCharCode(u16(b, p + i * 2)); p += cch * 2; }
  else { for (let i = 0; i < cch; i++) s += String.fromCharCode(b[p + i]); p += cch; }
  p += runs * 4 + extLen;
  return { text: s, end: p };
}

// The shared string table can continue into following CONTINUE records, and a string may be cut in the middle of its characters.
function sharedStrings(chunks) {
  const out = [];
  if (!chunks.length) return out;
  const unique = u32(chunks[0], 4);
  let ci = 0, p = 8;
  const byte = () => { while (ci < chunks.length && p >= chunks[ci].length) { ci++; p = 0; } return ci < chunks.length ? chunks[ci][p++] : 0; };
  const skip = (n) => { while (n > 0 && ci < chunks.length) { if (p >= chunks[ci].length) { ci++; p = 0; continue; } const t = Math.min(n, chunks[ci].length - p); p += t; n -= t; } };
  for (let i = 0; i < unique && ci < chunks.length; i++) {
    const cch = byte() | (byte() << 8);
    const flags = byte();
    let wide = flags & 1;
    const runs = flags & 8 ? byte() | (byte() << 8) : 0;
    const extLen = flags & 4 ? (byte() | (byte() << 8) | (byte() << 16) | (byte() << 24)) >>> 0 : 0;
    let s = '', left = cch;
    while (left > 0 && ci < chunks.length) {
      if (p >= chunks[ci].length) { ci++; p = 0; if (ci >= chunks.length) break; wide = chunks[ci][p++] & 1; continue; }
      const per = wide ? 2 : 1;
      const take = Math.min(left, Math.floor((chunks[ci].length - p) / per));
      if (take <= 0) { p = chunks[ci].length; continue; }
      for (let k = 0; k < take; k++) s += String.fromCharCode(wide ? u16(chunks[ci], p + k * 2) : chunks[ci][p + k]);
      p += take * per; left -= take;
    }
    skip(runs * 4 + extLen);
    out.push(s);
  }
  return out;
}

function rkValue(v) {
  let n;
  if (v & 2) n = (v | 0) >> 2;
  else { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true); n = dv.getFloat64(0, true); }
  return v & 1 ? n / 100 : n;
}

export function readXls(bytes) {
  const wb = readContainer(bytes).stream('Workbook') || readContainer(bytes).stream('Book');
  if (!wb) throw new Error('Could not find the spreadsheet inside this file.');
  if (u16(wb, 0) !== 0x0809) throw new Error('Unrecognised Excel file.');
  if (u16(wb, 4) === 0 && u16(wb, 2) < 8) throw new Error('This is a very old Excel file. Open it in Numbers or Excel, save as .xlsx, and try again.');

  // workbook-level information
  let date1904 = false;
  const sheets = [];
  const xfFormat = [];
  const formats = new Map();
  let sstChunks = [], inSst = false;
  for (const r of records(wb)) {
    if (r.id === 0x003C && inSst) { sstChunks.push(wb.subarray(r.off, r.off + r.len)); continue; }
    inSst = false;
    if (r.id === 0x002F) throw new Error('This Excel file is password-protected. Open it, save a copy without a password, and try again.');
    if (r.id === 0x0022) date1904 = u16(wb, r.off) === 1;
    else if (r.id === 0x0085) {
      const type = wb[r.off + 5];
      const nm = biffString(wb, r.off + 6, 1);
      sheets.push({ offset: u32(wb, r.off), type, name: nm.text, hidden: wb[r.off + 4] });
    } else if (r.id === 0x00FC) { sstChunks = [wb.subarray(r.off, r.off + r.len)]; inSst = true; }
    else if (r.id === 0x00E0) xfFormat.push(u16(wb, r.off + 2));
    else if (r.id === 0x041E) formats.set(u16(wb, r.off), biffString(wb, r.off + 2, 2).text);
    else if (r.id === 0x000A) break;
  }
  const strings = sharedStrings(sstChunks);
  const isDateXf = (xf) => {
    const f = xfFormat[xf];
    if (f === undefined) return false;
    return formats.has(f) ? isDateFormatCode(formats.get(f)) : BUILTIN_DATE_FORMATS.has(f);
  };

  const out = [];
  for (const sh of sheets) {
    if (sh.type !== 0) continue;                      // worksheets only (no charts)
    const grid = [];
    const put = (row, col, text) => { (grid[row] || (grid[row] = []))[col] = text; };
    let formulaCell = null;
    let first = true;
    for (const r of records(wb, sh.offset)) {
      if (first) { first = false; if (r.id !== 0x0809) break; continue; }
      if (r.id === 0x000A) break;
      const row = u16(wb, r.off), col = u16(wb, r.off + 2);
      switch (r.id) {
        case 0x00FD: put(row, col, strings[u32(wb, r.off + 6)] ?? ''); break;                           // text from the shared table
        case 0x0204: put(row, col, biffString(wb, r.off + 6, 2).text); break;                           // text stored in the cell
        case 0x0203: { const n = new DataView(wb.buffer, wb.byteOffset + r.off + 6, 8).getFloat64(0, true); put(row, col, isDateXf(u16(wb, r.off + 4)) ? dateText(n, date1904) : numberText(n)); break; }
        case 0x027E: { const n = rkValue(u32(wb, r.off + 6)); put(row, col, isDateXf(u16(wb, r.off + 4)) ? dateText(n, date1904) : numberText(n)); break; }
        case 0x00BD: {                                                                                    // a run of numbers
          const last = u16(wb, r.off + r.len - 2);
          for (let c = col, p = r.off + 4; c <= last; c++, p += 6) { const n = rkValue(u32(wb, p + 2)); put(row, c, isDateXf(u16(wb, p)) ? dateText(n, date1904) : numberText(n)); }
          break;
        }
        case 0x0006: {                                                                                    // formula: keep its result
          const isText = u16(wb, r.off + 12) === 0xFFFF && wb[r.off + 6] === 0;
          if (isText) formulaCell = { row, col };
          else if (u16(wb, r.off + 12) !== 0xFFFF) { const n = new DataView(wb.buffer, wb.byteOffset + r.off + 6, 8).getFloat64(0, true); put(row, col, isDateXf(u16(wb, r.off + 4)) ? dateText(n, date1904) : numberText(n)); }
          break;
        }
        case 0x0207: if (formulaCell) { put(formulaCell.row, formulaCell.col, biffString(wb, r.off, 2).text); formulaCell = null; } break;
        default: break;
      }
    }
    const width = widest(grid);
    const rows = [];
    for (let i = 0; i < grid.length; i++) { const r = grid[i] || []; rows.push(Array.from({ length: width }, (_, c) => (r[c] === undefined ? '' : String(r[c])))); }
    out.push({ name: sh.name, rows });
  }
  return out;
}

// ---------------------------------------------------------------- .xlsx (zip of XML files)

async function inflateRaw(u8arr) {
  const stream = new Blob([u8arr]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65600); i--) if (u32(bytes, i) === 0x06054B50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014B50) break;
    const method = u16(bytes, p + 10), compSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    files.set(name, { method, data: bytes.subarray(dataStart, dataStart + compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (n) => files.has(n),
    names: () => [...files.keys()],
    async text(n) {
      const f = files.get(n);
      if (!f) return null;
      const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
      return new TextDecoder().decode(raw);
    },
  };
}

const xmlDecode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
});
const attr = (s, name) => { const m = s.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? xmlDecode(m[1]) : null; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const textOf = (xml) => { let s = ''; for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += m[1]; return xmlDecode(s); };

export async function readXlsx(bytes) {
  const zip = await unzip(bytes);
  const book = await zip.text('xl/workbook.xml');
  if (!book) throw new Error('This is not an Excel (.xlsx) file.');
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) target.set(attr(m[0], 'Id'), attr(m[0], 'Target'));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(book);

  const sst = [];
  const sstXml = await zip.text('xl/sharedStrings.xml');
  if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));

  const styles = (await zip.text('xl/styles.xml')) || '';
  const custom = new Map();
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom.set(+attr(m[0], 'numFmtId'), attr(m[0], 'formatCode'));
  const xfIsDate = [];
  const cellXfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (cellXfs) for (const m of cellXfs[1].matchAll(/<xf\b[^>]*>/g)) {
    const id = +attr(m[0], 'numFmtId');
    xfIsDate.push(custom.has(id) ? isDateFormatCode(custom.get(id)) : BUILTIN_DATE_FORMATS.has(id));
  }

  const out = [];
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id');
    let path = target.get(rid) || '';
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const xml = await zip.text(path);
    if (!xml) continue;
    const grid = [];
    for (const rowM of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = (attr(rowM[1], 'r') ? +attr(rowM[1], 'r') : grid.length + 1) - 1;
      if (!rowM[2]) continue;
      let nextCol = 0;
      for (const c of rowM[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r');
        const col = ref ? colIndex(ref) : nextCol;
        nextCol = col + 1;
        const t = attr(c[1], 't'), s = attr(c[1], 's');
        const body = c[2] || '';
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let text = '';
        if (t === 's') text = sst[+v] ?? '';
        else if (t === 'inlineStr') text = textOf(body);
        else if (t === 'str' || t === 'e') text = v === undefined ? '' : xmlDecode(v);
        else if (t === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined && v !== '') {
          const n = Number(v);
          text = s !== null && xfIsDate[+s] && Number.isFinite(n) ? dateText(n, date1904) : Number.isFinite(n) ? numberText(n) : xmlDecode(v);
        }
        if (text !== '') (grid[rowNo] || (grid[rowNo] = []))[col] = text;
      }
    }
    const width = widest(grid);
    const rows = [];
    for (let i = 0; i < grid.length; i++) { const r = grid[i] || []; rows.push(Array.from({ length: width }, (_, c) => (r[c] === undefined ? '' : String(r[c])))); }
    out.push({ name, rows });
  }
  return out;
}
