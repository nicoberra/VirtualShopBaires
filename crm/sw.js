/* Service Worker — VSB CRM / Operaciones */
const CACHE_NAME = 'vsb-crm-v3';

const PRECACHE_URLS = [
  '/crm/panel.css',
  '/crm/icon-crm.png',
];

// Dominios que NUNCA se cachean
const NETWORK_ONLY_DOMAINS = [
  'script.google.com',
  'googleapis.com',
  'cdnjs.cloudflare.com',
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_DOMAINS.some(d => url.includes(d));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') return;

  // APIs dinámicas: siempre red
  if (isNetworkOnly(url)) return;

  // Navegación HTML: red primero
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then(r => r || caches.match('/crm/panel.html'))
      )
    );
    return;
  }

  // Recursos estáticos del CRM: caché primero, actualizar en background
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
