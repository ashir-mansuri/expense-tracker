// Passphrase protection with the browser's own cryptography (Web Crypto): AES-256-GCM, key made with PBKDF2-SHA-256.
// Nothing here is sent anywhere. A forgotten passphrase cannot be recovered by anyone.
const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const available = () => !!(globalThis.crypto && crypto.subtle && crypto.getRandomValues);

export function toB64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}
export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Encrypts bytes with a key that is already made. A fresh random number (iv) is used every time.
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv, data };
}
export async function open(key, iv, data) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
}

// ---- text in a small envelope (used for protected backups and for the data kept on the phone)
export async function sealText(text, passphrase) {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt);
  const { iv, data } = await seal(key, enc.encode(text));
  return { encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

export async function openText(envelope, passphrase) {
  const key = await deriveKey(passphrase, fromB64(envelope.salt), envelope.iter);
  return openTextWithKey(envelope, key);
}

export async function sealTextWithKey(text, key, salt, iter = ITERATIONS) {
  const { iv, data } = await seal(key, enc.encode(text));
  return { encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

export async function openTextWithKey(envelope, key) {
  try {
    return dec.decode(await open(key, fromB64(envelope.iv), fromB64(envelope.data)));
  } catch {
    const e = new Error('Wrong password.');
    e.wrong = true;
    throw e;
  }
}

export function looksEncrypted(x) {
  return !!(x && typeof x === 'object' && x.encrypted === true && typeof x.salt === 'string' && typeof x.iv === 'string' && typeof x.data === 'string' && Number.isInteger(x.iter) && x.iter >= 100000 && x.iter <= 5000000);
}

export const ITER = ITERATIONS;
