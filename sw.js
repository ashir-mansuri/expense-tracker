
// Offline support: cache the app shell, serve it first, refresh in the background.
const VERSION = 'et-v11';
const SHELL = [
  './', './index.html', './app.css', './app.js', './store.js', './analytics.js', './charts.js', './icons.js', './categorize.js', './quick.js', './entry.js', './owed.js', './importui.js', './statement.js', './reader.js', './sheets.js', './rates.js', './receipts.js', './xlsx.js', './schema.js', './vault.js', './prepaint.js',
  './display-500.woff', './display-700.woff', './inter-400.woff', './inter-500.woff', './inter-600.woff', './inter-700.woff', './jetbrains-mono-400.woff', './jetbrains-mono-700.woff',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
];
 
// Files are fetched fresh when a new version is installed, so a copy the browser kept for a few minutes can never be mixed in.
const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL.map(fresh)).then(() => cache.addAll(['./pdf.min.mjs', './pdf.worker.min.mjs'].map(fresh)).catch(() => {}))).then(() => self.skipWaiting()));
});
 
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
 
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
 
