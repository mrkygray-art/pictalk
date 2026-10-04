// PicTalk service worker: keeps the app itself on the phone so it opens with no signal.
// Only caches PicTalk's own files. Firebase uploads/data always go straight to the network.
const CACHE = 'pictalk-shell-v1';

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch('/index.html', { cache: 'no-store' });
    const html = await res.clone().text();
    await cache.put('/index.html', res);
    // Also save the JS/CSS/icon files that index.html points to
    const files = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
    await Promise.allSettled(files.map((f) => cache.add(f)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google APIs: network only
  if (url.pathname.startsWith('/__/')) return;      // Firebase Hosting internals

  // Opening the app: try the network (4s max, for weak signal), else use the saved copy
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await Promise.race([fetch(req), timeout(4000)]);
        if (fresh.ok) (await caches.open(CACHE)).put('/index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // App files (JS, CSS, icons): use the saved copy, else fetch and save it
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
