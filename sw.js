/* Service Worker — Virtual Shop Baires (Tienda) */
const CACHE_NAME = 'vsb-store-v1';

// Recursos estáticos a pre-cachear (app shell)
const PRECACHE_URLS = [
  '/css/styles.css',
  '/js/main.js',
  '/js/cart.js',
  '/js/productos.js',
  '/js/sheets.js',
  '/logo.png',
];

// Dominios que NUNCA se cachean (datos dinámicos, pagos, APIs)
const NETWORK_ONLY_DOMAINS = [
  'script.google.com',
  'googleapis.com',
  'mercadopago.com',
  'sdk.mercadopago.com',
  'http2.mlstatic.com',
  'www.mercadopago.com',
];

function isNetworkOnly(url) {
  return NETWORK_ONLY_DOMAINS.some(d => url.includes(d));
}

// ─── Install: pre-cachear app shell ───────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(() => {})
    )
  );
  self.skipWaiting();
});

// ─── Activate: limpiar caches viejos ──────────────────────────────────────────
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

// ─── Fetch: estrategia por tipo de recurso ────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  // Solo GET
  if (request.method !== 'GET') return;

  // APIs dinámicas: siempre red (nunca cachear)
  if (isNetworkOnly(url)) return;

  // Navegación (HTML): red primero, caída a caché
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request).then(r => r || caches.match('/')))
    );
    return;
  }

  // Recursos estáticos (CSS, JS, imágenes, fuentes): caché primero, actualizar en background
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
