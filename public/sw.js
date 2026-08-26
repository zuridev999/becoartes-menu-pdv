const CACHE_NAME = 'becoartes-kiosk-v1.9.9';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => Promise.all(
        clients.map((client) => {
          if ('navigate' in client) return client.navigate(client.url);
          return client.postMessage({ type: 'BECOARTES_APP_UPDATED', version: CACHE_NAME });
        })
      ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Recursos de terceiros devem seguir direto pelo navegador. Interceptá-los
  // aqui pode transformar uma falha transitória em erro definitivo de rede.
  if (requestUrl.origin !== self.location.origin) return;

  // Strategy: Network First, falling back to cache
  // This avoids the "blank screen" hash mismatch issue
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
