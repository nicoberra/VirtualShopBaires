/* Service Worker — VSB CRM / Operaciones */
const CACHE_NAME = 'vsb-crm-v4';

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

// ─── NOTIFICACIONES DE VENTAS ───────────────────────────────
// El aviso llega vacío; acá se pide el detalle al servidor y se muestra.
const CRM_URL = 'https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec';
const ESTADO_PUSH = 'vsb-push-estado';

async function ultimoVisto(nuevo) {
  const c = await caches.open(ESTADO_PUSH);
  if (nuevo !== undefined) return c.put('/visto', new Response(String(nuevo)));
  const r = await c.match('/visto');
  return r ? Number(await r.text()) || 0 : 0;
}

async function mostrarAvisos() {
  const sub = await self.registration.pushManager.getSubscription();
  let eventos = [];
  try {
    const r = await fetch(CRM_URL + '?action=push_pendientes&endpoint=' + encodeURIComponent(sub ? sub.endpoint : '') + '&_=' + Date.now());
    const d = await r.json();
    if (d && d.ok) eventos = d.eventos || [];
  } catch (e) {}
  const visto = await ultimoVisto();
  const desde = visto || Date.now() - 10 * 60 * 1000;
  let nuevos = eventos.filter(e => e.ts > desde).slice(-5);
  if (!nuevos.length && !eventos.length) {
    nuevos = [{ id: 'gen' + Date.now(), ts: Date.now(), t: '🛒 Novedad en la tienda', b: 'Abrí el CRM para ver el detalle.', s: 'pedidos' }];
  }
  // Ya se mostraron: se reemplaza el último en silencio (el navegador exige mostrar algo)
  if (!nuevos.length) nuevos = [Object.assign({ silencio: true }, eventos[eventos.length - 1])];
  await ultimoVisto(Math.max(...nuevos.map(e => e.ts)));
  await Promise.all(nuevos.map(e => self.registration.showNotification(e.t, {
    body: e.b, tag: 'vsb-' + e.id, icon: '/crm/icon-crm.png', badge: '/crm/icon-crm.png',
    vibrate: [180, 80, 180], renotify: !e.silencio, silent: !!e.silencio, data: { s: e.s || 'pedidos' }
  })));
}

self.addEventListener('push', event => { event.waitUntil(mostrarAvisos()); });

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const lista = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const abierta = lista.find(c => new URL(c.url).pathname.startsWith('/crm/'));
    if (abierta) { await abierta.focus(); return; }
    await self.clients.openWindow('/crm/panel.html');
  })());
});
