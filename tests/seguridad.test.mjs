// Prueba hash de contraseñas, antiabuso, idempotencia, webhook de Mercado Pago,
// conciliación y "mis compras" de crm/Codigo.gs y apps-script.gs contra servicios
// de Google simulados. No toca la red ni producción.
//   node tests/seguridad.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Servicios de Google simulados ───────────────────────────────────────────
function crearEntorno(hojasIniciales, pagosMP = {}, busquedaMP = []) {
  const HOJAS = JSON.parse(JSON.stringify(hojasIniciales));
  const cache = new Map();
  const telegram = [];
  const fetches = [];
  const sheet = (name) => ({
    getName: () => name,
    getLastRow: () => HOJAS[name].length,
    getLastColumn: () => Math.max(...HOJAS[name].map(r => r.length)),
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()), getDisplayValues: () => HOJAS[name].map(r => r.map(String)) }),
    getRange: (r, c, nr, nc) => ({
      setValue: (v) => { while (HOJAS[name].length < r) HOJAS[name].push([]); HOJAS[name][r - 1][c - 1] = v; },
      getValue: () => (HOJAS[name][r - 1] || [])[c - 1],
      getValues: () => HOJAS[name].slice(r - 1, r - 1 + (nr || 1)).map(row => row.slice(c - 1, c - 1 + (nc || 1))),
      setValues: () => {}, setFontWeight: () => ({}),
    }),
    appendRow: (row) => HOJAS[name].push(row.slice()),
    setFrozenRows: () => {},
  });
  const ssFake = {
    getSheets: () => Object.keys(HOJAS).map(sheet),
    getSheetByName: (n) => (HOJAS[n] ? sheet(n) : null),
    insertSheet: (n) => { HOJAS[n] = []; return sheet(n); },
  };
  const toBytes = (buf) => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "MP_ACCESS_TOKEN" ? "TEST-token" : k === "TG_TOKEN" ? "tg" : k === "TG_CHAT" ? "1" : "") }) },
    SpreadsheetApp: { openById: () => ssFake, getActiveSpreadsheet: () => ssFake },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: {
      fetch: (url, opt) => {
        fetches.push(url);
        if (url.includes("api.telegram.org")) { telegram.push(opt && opt.payload && opt.payload.text); return { getResponseCode: () => 200, getContentText: () => "{}" }; }
        const m = url.match(/\/v1\/payments\/(\d+)$/);
        if (m) {
          const p = pagosMP[m[1]];
          return { getResponseCode: () => (p ? 200 : 404), getContentText: () => JSON.stringify(p || { message: "not found" }) };
        }
        if (url.includes("/v1/payments/search")) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: busquedaMP }) };
        throw new Error("URL no esperada en test: " + url);
      },
    },
    Utilities: {
      DigestAlgorithm: { MD5: "md5", SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (alg, s) => toBytes(crypto.createHash(alg).update(String(s), "utf8").digest()),
      formatDate: () => "2026-10-12 12:00",
      getUuid: () => crypto.randomUUID(),
      base64Encode: () => "", base64Decode: () => [], newBlob: () => ({}),
    },
    ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  return { HOJAS, cache, telegram, fetches, stubs };
}

function cargar(archivo, env, exportar) {
  const src = readFileSync(join(root, archivo), "utf8");
  return new Function(...Object.keys(env.stubs), src + `\nreturn { ${exportar.join(", ")} };`)(...Object.values(env.stubs));
}

const BASE = {
  Clientes: [["ID", "Fecha", "Nombre", "Teléfono", "Email", "Ciudad", "Notas", "Origen", "Clave"]],
  Pedidos: [["ID", "Fecha", "Cliente", "Teléfono", "Detalle", "Monto", "Estado", "Notas", "Comprobante", "ClienteID"]],
  "Pedidos externos": [["timestamp", "orderNumber", "nombre", "apellido", "email", "telefono", "dni", "metodoEntrega", "metodoPago", "provincia", "localidad", "calle", "numeroCalle", "piso", "cp", "productos", "subtotal", "descuento", "total", "observaciones", "estado"]],
  Camping: [["Producto", "Precio", "Stock", "Color", "Talle/Medida", "Descripcion"], ["Silla Plegable Director", 30000, true, "", "", "desc"]],
};

let n = 0;
const ok = (msg) => { n++; console.log("  ✓", msg); };
const pedidoBase = (extra = {}) => ({
  action: "createOrder", nombre: "Ana", apellido: "Test", email: "ana@test.local", telefono: "11", dni: "1", metodoEntrega: "retiro",
  metodoPago: "transferencia", provincia: "CABA", localidad: "CABA", calle: "x", numeroCalle: "1", cp: "1000",
  productos: [{ nombre: "Silla Plegable Director", categoria: "Camping", qty: 1, precio: 1 }], envioZona: "", subtotal: 1, descuento: 0, total: 1, ...extra,
});

// ── Codigo.gs: contraseñas ──────────────────────────────────────────────────
console.log("Contraseñas (Codigo.gs)");
{
  const env = crearEntorno(BASE);
  const api = cargar("crm/Codigo.gs", env, ["_hashClave", "_verificarClave", "registrar", "login"]);
  const h = api._hashClave("secreta123");
  assert.match(h, /^s1\$[0-9a-f]{16}\$[0-9a-f]{64}$/);
  assert.notEqual(api._hashClave("secreta123"), h);
  ok("hash con sal: formato s1$sal$hash y distinto cada vez");
  assert.equal(api._verificarClave(h, "secreta123").ok, true);
  assert.equal(api._verificarClave(h, "otra").ok, false);
  ok("verifica la correcta y rechaza la incorrecta");

  const r = api.registrar({ email: "nuevo@test.local", clave: "abc12345", nombre: "Nuevo" });
  assert.equal(r.ok, true);
  const guardada = env.HOJAS.Clientes.at(-1)[8];
  assert.match(String(guardada), /^s1\$/); assert.ok(!String(guardada).includes("abc12345"));
  ok("registrar guarda el hash, nunca el texto");
  assert.equal(api.login({ email: "nuevo@test.local", clave: "abc12345" }).ok, true);
  assert.equal(api.login({ email: "nuevo@test.local", clave: "mal" }).ok, false);
  ok("login con clave hasheada");

  env.HOJAS.Clientes.push(["c1", "", "Viejo", "", "viejo@test.local", "", "", "web", "claveplana"]);
  assert.equal(api.login({ email: "viejo@test.local", clave: "claveplana" }).ok, true);
  assert.match(String(env.HOJAS.Clientes.at(-1)[8]), /^s1\$/);
  assert.equal(api.login({ email: "viejo@test.local", clave: "claveplana" }).ok, true);
  ok("clave vieja en texto plano: entra y se migra sola a hash");

  for (let i = 0; i < 12; i++) api.login({ email: "viejo@test.local", clave: "x" + i });
  assert.match(api.login({ email: "viejo@test.local", clave: "claveplana" }).error || "", /Demasiados intentos/);
  ok("login: bloqueo tras 10 intentos por email");
}

// ── apps-script.gs: contraseñas ─────────────────────────────────────────────
console.log("Contraseñas (apps-script.gs)");
{
  const env = crearEntorno({ ...BASE, Usuarios: [["Fecha registro", "Email", "Nombre", "Hash contraseña"]] });
  const api = cargar("apps-script.gs", env, ["registerUser", "loginUser", "changePassword"]);
  const hc = "a".repeat(64); // hash que manda el navegador
  assert.equal(api.registerUser({ email: "u@test.local", nombre: "U", hash: hc }).ok, true);
  assert.match(String(env.HOJAS.Usuarios.at(-1)[3]), /^s1\$/); assert.notEqual(env.HOJAS.Usuarios.at(-1)[3], hc);
  ok("registerUser guarda hash con sal del servidor");
  assert.equal(api.loginUser({ email: "u@test.local", hash: hc }).ok, true);
  assert.equal(api.loginUser({ email: "u@test.local", hash: "b".repeat(64) }).ok, false);
  ok("loginUser con hash nuevo");
  env.HOJAS.Usuarios.push(["", "viejo@test.local", "V", "c".repeat(64)]);
  assert.equal(api.loginUser({ email: "viejo@test.local", hash: "c".repeat(64) }).ok, true);
  assert.match(String(env.HOJAS.Usuarios.at(-1)[3]), /^s1\$/);
  ok("hash viejo: entra y se migra solo");
  assert.equal(api.changePassword({ email: "viejo@test.local", oldHash: "c".repeat(64), newHash: "d".repeat(64) }).ok, true);
  assert.equal(api.loginUser({ email: "viejo@test.local", hash: "d".repeat(64) }).ok, true);
  assert.equal(api.loginUser({ email: "viejo@test.local", hash: "c".repeat(64) }).ok, false);
  ok("changePassword funciona con el hash migrado");
}

// ── Codigo.gs: antiabuso e idempotencia en pedidos ──────────────────────────
console.log("Pedidos: antiabuso e idempotencia");
{
  const env = crearEntorno(BASE);
  const api = cargar("crm/Codigo.gs", env, ["crearPedido"]);
  const filas = () => env.HOJAS["Pedidos externos"].length - 1;

  const a = api.crearPedido(pedidoBase());
  const b = api.crearPedido(pedidoBase());
  assert.equal(a.ok, true); assert.equal(b.orderNumber, a.orderNumber); assert.equal(filas(), 1);
  ok("doble envío del mismo carrito → mismo pedido, una sola fila");
  assert.equal(a.total, 27000);
  ok("total recalculado en servidor ($30.000 − 10% = $27.000)");

  const bot = api.crearPedido(pedidoBase({ email: "bot@test.local", website: "http://spam" }));
  assert.equal(bot.ok, false); assert.equal(filas(), 1);
  ok("honeypot completo → rechazado sin crear fila");

  for (let i = 0; i < 4; i++) assert.equal(api.crearPedido(pedidoBase({ observaciones: "" + i, productos: [{ nombre: "Silla Plegable Director", categoria: "Camping", qty: i + 2 }] })).ok, true);
  const sexto = api.crearPedido(pedidoBase({ productos: [{ nombre: "Silla Plegable Director", categoria: "Camping", qty: 9 }] }));
  assert.equal(sexto.ok, false); assert.match(sexto.error, /muchos intentos/);
  ok("6.º pedido distinto del mismo email en 10 min → bloqueado");
  assert.equal(filas(), 5);
  ok("se crearon exactamente 5 filas");
}

// ── Codigo.gs: Mercado Pago webhook y conciliación ──────────────────────────
console.log("Mercado Pago: webhook y conciliación");
{
  const hojas = JSON.parse(JSON.stringify(BASE));
  hojas.Pedidos.push(["p1", "2026-10-12", "Ana", "11", "1x Silla", 30000, "Pendiente", "MercadoPago · ref: vsb-111 · email: ana@test.local", "", ""]);
  hojas.Pedidos.push(["p2", "2026-10-12", "Beto", "12", "1x Silla", 30000, "Pendiente", "MercadoPago · ref: vsb-222 · email: beto@test.local", "", ""]);
  hojas.Pedidos.push(["p3", "2026-10-12", "Caro", "13", "1x Silla", 30000, "Pendiente", "MercadoPago · ref: vsb-333", "", ""]);
  const pagos = {
    "9001": { id: 9001, status: "approved", external_reference: "vsb-111", transaction_amount: 30000 },
    "9002": { id: 9002, status: "rejected", external_reference: "vsb-222", transaction_amount: 30000 },
    "9003": { id: 9003, status: "approved", external_reference: "vsb-333", transaction_amount: 100 },
  };
  const env = crearEntorno(hojas, pagos, [pagos["9001"], { id: 9004, status: "approved", external_reference: "otra-tienda", transaction_amount: 5 }]);
  const api = cargar("crm/Codigo.gs", env, ["mpWebhook", "conciliarPagosMP"]);
  const estado = (i) => env.HOJAS.Pedidos[i][6];

  let r = api.mpWebhook({ action: "mp_webhook", type: "payment", "data.id": "9001" }, null);
  assert.equal(r.estado, "confirmado"); assert.equal(estado(1), "Confirmado");
  ok("webhook con pago aprobado → reconsulta a MP y confirma el pedido");
  r = api.mpWebhook({ action: "mp_webhook" }, { postData: { contents: JSON.stringify({ action: "payment.updated", type: "payment", data: { id: "9001" } }) } });
  assert.equal(r.estado, "duplicado");
  assert.equal((env.HOJAS.Pedidos[1][7].match(/pago MP 9001/g) || []).length, 1);
  ok("webhook repetido (body JSON) → idempotente, nota una sola vez");
  r = api.mpWebhook({ action: "mp_webhook", type: "payment", "data.id": "9002" }, null);
  assert.equal(estado(2), "Pendiente");
  ok("pago rechazado → no confirma");
  r = api.mpWebhook({ action: "mp_webhook", type: "payment", "data.id": "9003" }, null);
  assert.equal(r.estado, "monto_distinto"); assert.equal(estado(3), "Pendiente"); assert.match(env.HOJAS.Pedidos[3][7], /PAGÓ \$100 DE \$30000/);
  ok("pago aprobado por menos plata → NO confirma y marca ⚠");
  r = api.mpWebhook({ action: "mp_webhook", type: "payment", "data.id": "123abc" }, null);
  assert.equal(r.ok, true);
  r = api.mpWebhook({ action: "mp_webhook", type: "payment", "data.id": "5555" }, null);
  assert.equal(estado(1), "Confirmado");
  ok("id inválido o pago inexistente → ignorado sin romper nada");
  assert.ok(env.telegram.some(t => /Pago MP aprobado/.test(t)));
  ok("aviso por Telegram del pago aprobado");

  env.cache.clear();
  const c = api.conciliarPagosMP();
  assert.equal(c.revisados, 1); assert.equal(c.confirmados, 0);
  ok("conciliación: ignora pagos de otras referencias y no re-confirma lo ya confirmado");
}

// ── Codigo.gs: mis compras ──────────────────────────────────────────────────
console.log("Mis compras");
{
  const hojas = JSON.parse(JSON.stringify(BASE));
  hojas["Pedidos externos"].push(["2026-10-10 10:00", "VSB-1", "Ana", "T", "ana@test.local", "11", "30111222", "Envío", "transferencia", "BA", "Quilmes", "Calle Falsa", "123", "", "1878", "1x Silla", 30000, 3000, 27000, "", "Pendiente"]);
  hojas["Pedidos externos"].push(["2026-10-11 10:00", "VSB-2", "Otro", "T", "otro@test.local", "11", "1", "Envío", "transferencia", "BA", "X", "Y", "1", "", "1", "1x Silla", 1, 0, 1, "", "Entregado"]);
  hojas.Pedidos.push(["p1", "2026-10-12", "Ana", "11", "1x Silla", 30000, "Confirmado", "MercadoPago · ref: vsb-111 · email: ana@test.local", "", ""]);
  const env = crearEntorno(hojas);
  const api = cargar("crm/Codigo.gs", env, ["misPedidos"]);
  const r = api.misPedidos({ email: "ANA@test.local " });
  assert.equal(r.ok, true); assert.equal(r.orders.length, 2);
  assert.deepEqual(r.orders.map(o => o.numero).sort(), ["VSB-1", "vsb-111"]);
  ok("encuentra pedidos web y de Mercado Pago del email (sin importar mayúsculas)");
  const json = JSON.stringify(r);
  assert.ok(!json.includes("Calle Falsa") && !json.includes("30111222") && !json.includes("otro@test.local"));
  ok("no expone dirección, DNI ni pedidos de otros");
  assert.equal(r.orders.find(o => o.numero === "vsb-111").estadoPago, "PAGO CONFIRMADO");
  ok("estado traducido para la página (Confirmado → PAGO CONFIRMADO)");
  assert.equal(api.misPedidos({ email: "no-es-email" }).ok, false);
  ok("email inválido → rechazado");
}

console.log(`\n${n} pruebas OK`);
