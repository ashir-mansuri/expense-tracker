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

export const putReceipt = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const getReceipt = (id) => run('readonly', (s) => s.get(id)).catch(() => null);
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

export async function dataURLToBlob(dataURL) {
  const res = await fetch(dataURL);
  return res.blob();
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
