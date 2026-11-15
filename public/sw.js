/* CareCircle service worker: the app works offline and shows the last saved
   "today" list and medicines when there is no internet. */
const VERSION = 'carecircle-v2';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/chart.js',
  '/js/voice.js',
  '/js/icons.js',
  '/js/image.js',
  '/js/prefs.js',
  '/js/views/more.js',
  '/js/views/welcome.js',
  '/js/views/today.js',
  '/js/views/medicines.js',
  '/js/views/appointments.js',
  '/js/views/health.js',
  '/js/views/circle.js',
  '/js/views/medicalId.js',
];
// Read-only API answers worth keeping for offline use.
const OFFLINE_API = [
  '/api/doses/today',
  '/api/medications',
  '/api/me',
  '/api/medical-id',
  '/api/appointments',
];
const DATA_CACHE = `${VERSION}-data`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Signing out removes any saved health data from this device.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'clear-data') event.waitUntil(caches.delete(DATA_CACHE));
});

const markOffline = async (response) => {
  const headers = new Headers(response.headers);
  headers.set('x-carecircle-offline', '1');
  return new Response(await response.blob(), { status: response.status, headers });
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!OFFLINE_API.includes(url.pathname)) return; // network only
    // Network first; fall back to the last good answer when offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA_CACHE).then((c) => c.put(request.url, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.open(DATA_CACHE).then((c) => c.match(request.url));
          return cached
            ? markOffline(cached)
            : Response.json(
                { error: { code: 'OFFLINE', message: 'You are offline.' } },
                { status: 503 },
              );
        }),
    );
    return;
  }

  if (
    url.pathname.startsWith('/internal/') ||
    url.pathname.startsWith('/a/') ||
    url.pathname.startsWith('/id/')
  )
    return;

  // App shell: serve from cache straight away, refresh it in the background.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached ?? cache.match('/index.html'));
      return cached ?? network;
    }),
  );
});
