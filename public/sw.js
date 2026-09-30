const CACHE = 'guida-v2';
const SHELL = ['/m.html', '/m.js', '/style.css', '/icon.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/report') || url.pathname.startsWith('/v/')) return;
  // API: rete prima, cache come ripiego (il testo dell'ultima visita resta leggibile offline)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  // Pagina del sito (/p/città/sito): serve la stessa shell
  if (url.pathname.startsWith('/p/')) {
    e.respondWith(fetch(req).catch(() => caches.match('/m.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
