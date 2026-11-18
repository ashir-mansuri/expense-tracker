import { seal, open as openBytes } from './vault.js';
// Receipt photos live in IndexedDB (localStorage is too small for images). Keyed by transaction id.
const DB = 'expense-tracker';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('No IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('receipts'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('receipts', mode);
    const req = fn(tx.objectStore('receipts'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// When the person locks their saved data with a passphrase, receipt photos are locked with the same key.
let rkey = null;
export const setReceiptKey = (key) => { rkey = key; };
const bytesOf = (blob) => new Response(blob).arrayBuffer().then((b) => new Uint8Array(b));

async function wrap(blob) {
  if (!rkey) return blob;
  const { iv, data } = await seal(rkey, await bytesOf(blob));
  return { locked: 1, type: blob.type || 'image/jpeg', iv, data };
}
async function unwrap(v) {
  if (!v) return null;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return v;
  if (v.locked && rkey) {
    try { return new Blob([await openBytes(rkey, v.iv, v.data)], { type: v.type }); } catch { return null; }
  }
  return null;
}

export const putReceipt = async (id, blob) => { const v = await wrap(blob); return run('readwrite', (s) => s.put(v, id)); };
export const getReceipt = (id) => run('readonly', (s) => s.get(id)).then(unwrap).catch(() => null);
export const clearReceipts = () => run('readwrite', (s) => s.clear()).catch(() => null);

// Locks every photo with `toKey`, or (with null) turns them back into plain photos. Safe to stop half way: both kinds stay readable.
export async function convertReceipts(toKey) {
  const from = rkey;
  if (toKey) rkey = toKey;
  const ids = await receiptIds();
  for (const id of ids) {
    const raw = await run('readonly', (s) => s.get(id));
    if (toKey) {
      if (!(raw instanceof Blob)) continue;
      const v = await wrap(raw);
      await run('readwrite', (s) => s.put(v, id));
    } else {
      if (raw instanceof Blob) continue;
      const blob = await unwrap(raw);
      if (blob) await run('readwrite', (s) => s.put(blob, id));
    }
  }
  if (!toKey) rkey = null;
  return from;
}
export const deleteReceipt = (id) => run('readwrite', (s) => s.delete(id)).catch(() => null);
export const receiptIds = () => run('readonly', (s) => s.getAllKeys()).catch(() => []);

// Shrinks a photo so a receipt costs ~100 KB instead of several MB.
export function shrinkImage(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo')); };
    img.src = url;
  });
}

export const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

// Turns "data:image/jpeg;base64,..." back into a photo without asking the network layer, which the security policy keeps closed.
export async function dataURLToBlob(dataURL) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataURL));
  if (!m) throw new Error('That photo could not be read.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// For backups: { txId: dataURL }
export async function exportReceipts(ids) {
  const out = {};
  for (const id of ids) {
    const blob = await getReceipt(id);
    if (blob) out[id] = await blobToDataURL(blob);
  }
  return out;
}

export async function importReceipts(map) {
  let n = 0;
  for (const [id, dataURL] of Object.entries(map || {})) {
    try { await putReceipt(id, await dataURLToBlob(dataURL)); n += 1; } catch { /* skip a bad one */ }
  }
  return n;
}
