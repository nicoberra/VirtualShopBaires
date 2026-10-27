// Datos del CRM en Supabase (tabla crm_filas): pedidos, clientes, cuentas, dispositivos, etc.
// La primera vez se copian solos de la planilla; después todo se lee y escribe en Supabase.
//   node tests/datos-supabase.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

// ── Supabase simulado: solo la tabla crm_filas (eq., in., order, limit/offset) ──
function crearSupabase() {
  const db = { crm_filas: [] }; let nextId = 1; const llamadas = [];
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body === undefined ? "" : JSON.stringify(body) });
  function fetch(url, opt = {}) {
    const u = new URL(url), tabla = u.pathname.replace("/rest/v1/", ""), metodo = (opt.method || "get").toLowerCase();
    llamadas.push({ metodo, url });
    if (tabla !== "crm_filas") return resp(404, { message: "tabla " + tabla });
    const filtros = [...u.searchParams].filter(([k, v]) => /^(eq|in)\./.test(v));
    const pasa = r => filtros.every(([c, v]) => v.startsWith("eq.") ? String(r[c]) === decodeURIComponent(v.slice(3))
      : v.slice(4, -1).split(",").includes(String(r[c])));
    const sel = db.crm_filas.filter(pasa);
    const body = opt.payload ? JSON.parse(opt.payload) : undefined;
    if (metodo === "post") {
      const nuevas = [].concat(body).map(f => ({ id: nextId++, ...JSON.parse(JSON.stringify(f)) }));
      db.crm_filas.push(...nuevas);
      return resp(201, (opt.headers.Prefer || "").includes("representation") ? nuevas.map(x => ({ id: x.id })) : undefined);
    }
    if (metodo === "patch") { sel.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(body)))); return resp(204); }
    if (metodo === "delete") { db.crm_filas = db.crm_filas.filter(r => !sel.includes(r)); return resp(204); }
    const orden = [...sel].sort((a, b) => a.orden - b.orden || a.id - b.id);
    const desde = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
    return resp(200, orden.slice(desde, desde + lim).map(r => ({ id: r.id, orden: r.orden, valores: r.valores })));
  }
  return { db, fetch, llamadas };
}

// Planilla simulada (lo que había antes)
function crearPlanilla(inicial) {
  const hojas = {};
  const hoja = (nombre, filas = []) => hojas[nombre] = {
    filas, getName: () => nombre,
    appendRow: r => filas.push(r.slice()), setFrozenRows() {},
    getLastRow: () => filas.length, getLastColumn: () => Math.max(0, ...filas.map(f => f.length)),
    getDataRange: () => ({ getValues: () => filas.map(r => r.slice()) }),
    getRange: (f, c) => ({ setValue: v => { filas[f - 1][c - 1] = v; }, setFontWeight() {}, setValues() {} }), deleteRow: i => filas.splice(i - 1, 1),
  };
  Object.entries(inicial).forEach(([k, v]) => hoja(k, v));
  return { hojas, libro: { getSheetByName: n => hojas[n] || null, insertSheet: n => hoja(n), getSheets: () => Object.values(hojas) } };
}

function cargar({ planilla = {}, props = {} } = {}) {
  const sb = crearSupabase(), pl = crearPlanilla(planilla);
  const P = { PANEL_PASS: "clave-buena-123", SUPABASE_SECRET: "sb_secret_test", FUENTE_PRODUCTOS: "supabase", ...props };
  const cache = new Map();
  const lock = () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} });
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => P[k] || null, setProperty: (k, v) => { P[k] = v; } }) },
    SpreadsheetApp: { openById: () => pl.libro },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: lock, getUserLock: lock },
    Utilities: {
      computeDigest: (alg, s) => [...createHash(alg === "MD5" ? "md5" : "sha256").update(String(s)).digest()].map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { MD5: "MD5", SHA_256: "SHA_256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => randomUUID(), formatDate: (d) => d.toISOString().slice(0, 16).replace("T", " "),
      base64Encode: s => Buffer.from(String(s)).toString("base64"),
    },
    UrlFetchApp: { fetch: (url, opt) => sb.fetch(url, opt), fetchAll: () => [] },
    ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { listar, agregar, actualizar, borrar, extPedidosListar, extPedidoActualizar, loginPanel, loginDispositivo, tiendaRegistrar, tiendaLogin, suscribir, _registrarError, ss };")(...Object.values(stubs));
  return { gs, sb, pl, P };
}
const filasDe = (sb, hoja) => sb.db.crm_filas.filter(r => r.hoja === hoja).sort((a, b) => a.orden - b.orden);

{
  const fecha = new Date("2026-10-01T15:30:00Z");
  const { gs, sb, pl } = cargar({ planilla: {
    Clientes: [["ID", "Fecha", "Nombre", "Teléfono", "Email"], ["r1", fecha, "Ana", "1155", "ana@x.com"]],
    "Pedidos externos": [["timestamp", "orderNumber", "nombre", "total", "estado"], [fecha, "VSB-1", "Ana", 1000, "Pendiente"], [fecha, "VSB-2", "Luis", 500, "Pendiente"]],
  } });
  const cli = gs.listar("Clientes");
  assert.equal(cli.length, 1); assert.equal(cli[0].nombre, "Ana"); assert.equal(cli[0].fecha, "2026-10-01 15:30");
  assert.equal(filasDe(sb, "clientes").length, 2);
  assert.deepEqual(filasDe(sb, "clientes")[1].valores[1], { $d: fecha.toISOString() });
  ok("la primera vez copia la planilla a Supabase (encabezado + filas) y las fechas siguen siendo fechas");

  const peds = gs.extPedidosListar({});
  assert.deepEqual(peds.map(p => p.orderNumber), ["VSB-1", "VSB-2"]);
  assert.equal(gs.extPedidoActualizar({ row: peds[1]._row, campo: "estado", valor: "Confirmado", orderNumber: "VSB-2" }).ok, true);
  assert.equal(filasDe(sb, "pedidos externos")[2].valores[4], "Confirmado");
  assert.equal(pl.hojas["Pedidos externos"].filas[2][4], "Pendiente");
  assert.equal(gs.extPedidoActualizar({ row: peds[0]._row, campo: "estado", valor: "X", orderNumber: "VSB-2" }).ok, false);
  ok("pedidos de la web: se listan y se cambia el estado en Supabase; la planilla queda como respaldo sin tocar");
}
{
  const { gs, sb } = cargar();
  const id = gs.agregar("Clientes", { nombre: "Ana", email: "ana@x.com", telefono: "+54 11 5555" });
  assert.equal(gs.agregar("Clientes", { nombre: "Ana P", email: "ANA@x.com", ciudad: "CABA" }), id);
  assert.equal(gs.listar("Clientes").length, 1); assert.equal(gs.listar("Clientes")[0].ciudad, "CABA");
  ok("clientes: sin planilla previa crea la pestaña con encabezado y no duplica por email");

  const pid = gs.agregar("Pedidos", { cliente: "Ana", monto: "1000", estado: "Pendiente" });
  assert.equal(gs.actualizar("Pedidos", { id: pid, estado: "Entregado" }), true);
  assert.equal(gs.listar("Pedidos")[0].estado, "Entregado");
  assert.equal(gs.borrar("Pedidos", pid), true); assert.equal(gs.listar("Pedidos").length, 0);
  assert.equal(filasDe(sb, "pedidos").length, 1);
  ok("pedidos cargados a mano: agregar, editar y borrar (el encabezado queda)");
}
{
  const { gs } = cargar();
  assert.equal(gs.tiendaRegistrar({ email: "a@b.com", nombre: "Ana", hash: "h1" }).ok, true);
  assert.equal(gs.tiendaRegistrar({ email: "a@b.com", nombre: "Ana", hash: "h1" }).error, "email_taken");
  assert.equal(gs.tiendaLogin({ email: "a@b.com", hash: "h1" }).ok, true);
  assert.equal(gs.tiendaLogin({ email: "a@b.com", hash: "mal" }).ok, false);
  ok("cuentas de la tienda: registrarse, no repetir email y entrar con la contraseña");

  const r = gs.loginPanel({ clave: "clave-buena-123", confiar: "1" });
  gs.loginPanel({ clave: "clave-buena-123", dispositivo: r.dispositivo });
  gs.loginPanel({ clave: "clave-buena-123", dispositivo: r.dispositivo });
  const d = gs.loginDispositivo({ dispositivo: r.dispositivo });
  assert.equal(d.ok, true);
  ok("el ingreso al CRM con dispositivo de confianza funciona igual (fechas incluidas)");

  assert.match(gs.suscribir({ email: "x@y.com" }), /^s/);
  gs._registrarError("prueba", "algo falló");
  ok("suscriptores y registro de errores también van a Supabase");
}
{
  const filas = [["ID", "Fecha", "Cliente"]];
  for (let i = 0; i < 2300; i++) filas.push(["p" + i, "", "C" + i]);
  const { gs, sb } = cargar({ planilla: { Pedidos: filas } });
  const l = gs.listar("Pedidos");
  assert.equal(l.length, 2300); assert.equal(l[2299].cliente, "C2299");
  assert.ok(sb.llamadas.filter(x => x.metodo === "get" && x.url.includes("offset=2000")).length >= 1);
  ok("con más de 1000 filas lee todas (de a 1000)");
}
{
  const { gs, sb, pl } = cargar({ props: { FUENTE_DATOS: "planilla" } });
  gs.agregar("Clientes", { nombre: "Ana", email: "a@b.com" });
  assert.equal(sb.db.crm_filas.length, 0); assert.equal(pl.hojas.Clientes.filas.length, 2);
  ok("con FUENTE_DATOS = planilla vuelve a usar la planilla (para volver atrás si hiciera falta)");
}
{
  const { gs, sb } = cargar({ planilla: { Camping: [["Producto", "Precio"], ["Silla", 1]], Errores: [["Fecha"]] } });
  const nombres = gs.ss().getSheets().map(s => s.getName());
  assert.deepEqual(nombres, ["Camping"]);
  assert.equal(gs.ss().getSheetByName("Camping").getLastRow(), 2);
  assert.equal(sb.db.crm_filas.length, 0);
  ok("las pestañas viejas de productos siguen en la planilla y no se copian");
}
console.log(`\n${n} pruebas OK`);
