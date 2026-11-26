// FACP Wiring Lab service worker: keeps the app usable offline
const CACHE = 'facp-lab-14a7a28102';
const FILES = ["./", "index.html", "wiring.html", "manifest.webmanifest", "fonts/fonts.css", "fonts/ibm-plex-sans-thai-thai-400-normal.woff2", "fonts/ibm-plex-sans-thai-latin-400-normal.woff2", "fonts/ibm-plex-sans-thai-thai-500-normal.woff2", "fonts/ibm-plex-sans-thai-latin-500-normal.woff2", "fonts/ibm-plex-sans-thai-thai-600-normal.woff2", "fonts/ibm-plex-sans-thai-latin-600-normal.woff2", "fonts/ibm-plex-sans-thai-thai-700-normal.woff2", "fonts/ibm-plex-sans-thai-latin-700-normal.woff2", "fonts/ibm-plex-mono-latin-400-normal.woff2", "fonts/ibm-plex-mono-latin-500-normal.woff2", "fonts/ibm-plex-mono-latin-600-normal.woff2", "fonts/vt323-latin-400-normal.woff2", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('facp-lab-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') {   // network first so updates arrive, cached copy when offline
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); if (res.ok) caches.open(CACHE).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r, {ignoreSearch:true}).then(m => m || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(r, {ignoreSearch:true}).then(m => m || fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
});
