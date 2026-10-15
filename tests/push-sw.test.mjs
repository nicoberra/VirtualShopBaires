// Service worker del CRM: al llegar un aviso pide el detalle y muestra cada venta nueva una sola vez.
//   node tests/push-sw.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

function cargar(respuesta) {
  const handlers = {}, mostradas = [], guardado = new Map(), pedidos = [];
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting() {}, clients: { claim() {}, matchAll: async () => [], openWindow: async u => mostradas.push({ abrio: u }) },
    registration: {
      pushManager: { getSubscription: async () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc" }) },
      showNotification: async (t, o) => { mostradas.push({ t, ...o }); },
    },
  };
  guardado.set("/secreto", "sec123");
  const caches = { open: async () => ({ put: async (k, r) => guardado.set(k, await r.text()), match: async k => guardado.has(k) ? new Response(guardado.get(k)) : undefined, addAll: async () => {} }), keys: async () => [] };
  const fetch = async (url) => { pedidos.push(url); if (respuesta instanceof Error) throw respuesta; return { json: async () => respuesta() }; };
  new Function("self", "caches", "fetch", readFileSync(join(root, "crm/sw.js"), "utf8"))(self, caches, fetch);
  const push = async () => { let p; handlers.push({ waitUntil: x => { p = x; } }); await p; };
  return { push, mostradas, pedidos, handlers };
}

{
  const ahora = Date.now();
  let eventos = [{ id: "a1", ts: ahora - 1000, t: "🛒 Nueva venta en la web", b: "Ana · $1000", s: "pedidos" }];
  const { push, mostradas, pedidos } = cargar(() => ({ ok: true, eventos }));
  await push();
  assert.equal(mostradas.length, 1);
  assert.equal(mostradas[0].t, "🛒 Nueva venta en la web"); assert.equal(mostradas[0].body, "Ana · $1000");
  assert.match(pedidos[0], /action=push_pendientes&endpoint=https%3A%2F%2Ffcm[^&]*&secreto=sec123&/);
  ok("muestra la venta con su detalle");

  eventos = eventos.concat([{ id: "b2", ts: ahora, t: "✅ Venta pagada con Mercado Pago", b: "Luis · $500" }]);
  await push();
  assert.equal(mostradas.length, 2); assert.equal(mostradas[1].t, "✅ Venta pagada con Mercado Pago");
  ok("en el siguiente aviso muestra solo lo nuevo");

  await push();
  assert.equal(mostradas.length, 3); assert.equal(mostradas[2].silent, true); assert.equal(mostradas[2].tag, "vsb-b2");
  ok("si no hay nada nuevo, reemplaza la última en silencio (sin repetir el sonido)");
}
{
  const { push, mostradas } = cargar(new Error("sin red"));
  await push();
  assert.equal(mostradas.length, 1); assert.match(mostradas[0].t, /Novedad/);
  ok("sin conexión al servidor igual avisa que hay una novedad");
}
{
  const { handlers, mostradas } = cargar(() => ({ ok: true, eventos: [] }));
  let p; handlers.notificationclick({ notification: { close() {} }, waitUntil: x => { p = x; } }); await p;
  assert.equal(mostradas[0].abrio, "/crm/panel.html");
  ok("tocar la notificación abre el CRM");
}
console.log(`\n${n} pruebas OK`);
