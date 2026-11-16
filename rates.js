// Daily exchange rates, fetched when online and kept in settings so conversion also works offline.
import { store } from './store.js';

const SOURCES = [
  { url: 'https://open.er-api.com/v6/latest/USD', pick: (j) => (j && j.result === 'success' && j.rates ? j.rates : null) },
  { url: 'https://api.frankfurter.app/latest?from=USD', pick: (j) => (j && j.rates ? { USD: 1, ...j.rates } : null) },
];

export function hasRates() { return !!(store.settings.rates && store.settings.rates.rates); }

export function ratesAge() {
  const r = store.settings.rates;
  return r && r.fetchedAt ? Date.now() - r.fetchedAt : Infinity;
}

export async function refreshRates(force = false) {
  if (!navigator.onLine) return false;
  if (!force && ratesAge() < 20 * 3600 * 1000) return false;
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { cache: 'no-store' });
      if (!res.ok) continue;
      const rates = src.pick(await res.json());
      if (!rates) continue;
      store.setSetting('rates', { base: 'USD', rates, fetchedAt: Date.now(), date: new Date().toISOString().slice(0, 10) });
      return true;
    } catch { /* try the next source */ }
  }
  return false;
}

export function convert(amount, from, to) {
  if (from === to) return amount;
  const r = store.settings.rates && store.settings.rates.rates;
  if (!r || !r[from] || !r[to]) return null;
  return (amount / r[from]) * r[to];
}

export function canConvert(from, to) {
  if (from === to) return true;
  const r = store.settings.rates && store.settings.rates.rates;
  return !!(r && r[from] && r[to]);
}
