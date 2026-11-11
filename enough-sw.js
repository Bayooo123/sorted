// Service worker for the Enough PWA at /enough/app. Registered with
// scope '/enough/app' so it never touches the Sorted site or /roadmap.
//
// Strategy: the app shell (one HTML file) is network-first so a deploy is
// picked up on the next open, with the cached copy as the offline fallback.
// Icons and the manifest are cache-first. API calls go to another origin
// (sorted-api.vercel.app) and are never intercepted or cached: balances
// and payments must always be live.
const CACHE = 'enough-app-v1';
const SHELL = '/enough/app';
const STATIC = [
  '/enough-app.webmanifest',
  '/icons/enough-192.png',
  '/icons/enough-512.png',
  '/icons/enough-maskable-512.png',
  '/icons/enough-apple-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([SHELL].concat(STATIC))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('enough-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' && url.pathname.startsWith('/enough/app')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }
  if (STATIC.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
