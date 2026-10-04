// PicTalk service worker: keeps the app itself on the phone so it opens with no signal.
// Only caches PicTalk's own files. Firebase uploads/data always go straight to the network.

// Filled in by the build (pictalkOfflineFiles in vite.config.js): an id for this build and
// every file it's made of, so the whole app — PDF tools included — is saved at install.
// A new build changes this file, so phones install it and drop the old copy.
const BUILD = 'dev';
const FILES = [];
const CACHE = `pictalk-shell-${BUILD}`;

// App files have content hashes in their names, so a header like "Vary: Origin" from the
// server must not stop a saved copy from being used.
const match = (req) => caches.match(req, { ignoreVary: true });

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.put('/index.html', await fetch('/index.html', { cache: 'no-store' }));
    // All or nothing: if a file can't be saved, the previous copy of the app stays in use
    await cache.addAll(FILES.filter((f) => f !== '/index.html').map((f) => new Request(f, { cache: 'reload' })));
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
        return (await match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // App files (JS, CSS, icons): use the saved copy, else fetch and save it
  event.respondWith((async () => {
    const cached = await match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  })());
});
