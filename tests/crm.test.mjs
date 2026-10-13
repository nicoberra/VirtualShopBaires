// Pruebas del CRM (crm/panel.js, crm/panel-ops.js y crm/Codigo.gs) con DOM y servicios
// de Google simulados. No toca la red ni datos reales.
//   node tests/crm.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0;
const ok = (m) => { n++; console.log("  ✓", m); };

// ── DOM mínimo ──────────────────────────────────────────────────────────────
function crearDOM(valores = {}) {
  const els = {};
  const el = (id) => els[id] || (els[id] = {
    id, value: valores[id] ?? "", textContent: "", innerHTML: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    focus() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  });
  const document = {
    hidden: true, getElementById: el, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, createElement: () => el("tmp" + Math.random()), body: { appendChild() {} },
  };
  const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), key: i => [...m.keys()][i], get length() { return m.size; }, _m: m }; };
  return { els, document, localStorage: store(), sessionStorage: store() };
}

function cargarPanel(archivo, valores) {
  const dom = crearDOM(valores);
  const toasts = [];
  const src = readFileSync(join(root, archivo), "utf8");
  const env = {
    document: dom.document, window: {}, location: { pathname: "/crm/" + archivo.split("/").pop().replace(".js", ".html"), reload() {} },
    localStorage: dom.localStorage, sessionStorage: dom.sessionStorage, setInterval() {}, setTimeout: (f) => 0, clearTimeout() {},
    fetch: async () => ({}), FileReader: function () {}, URLSearchParams,
  };
  // Object.keys(localStorage) en lsBorrarTodo: exponer las claves como propiedades
  const api = new Function(...Object.keys(env), src + `
    ;return {
      agruparFacturacion: typeof agruparFacturacion === "function" ? agruparFacturacion : null, crmOk, guardarCliente, borrarCliente, cambiarEstadoPedido, loadPedidos, lsLeer,
      get clientes() { return _clientes; }, set clientes(v) { _clientes = v; },
      get pedidos() { return _pedidos; }, set pedidos(v) { _pedidos = v; },
      set: (nombre, fn) => eval(nombre + ' = fn'),
    };`)(...Object.values(env));
  api.set("toast", (m, t = "ok") => toasts.push([t, m]));
  api.set("filtrarClientes", () => {});
  api.set("filtrarPedidos", () => {});
  api.set("confirmar", (msg, fn) => fn());
  return { api, dom, toasts };
}

for (const archivo of ["crm/panel.js", "crm/panel-ops.js"]) {
  console.log(archivo);
  const valores = { "mcli-nombre": "Ana", "mcli-email": "ana@test.local", "mcli-dni": "30111222", "mcli-telefono": "11 5555" };

  // doble clic → una sola llamada
  {
    const { api } = cargarPanel(archivo, valores);
    let llamadas = 0;
    api.set("crm", async (p) => { llamadas++; await new Promise(r => globalThis.setTimeout(r, 20)); return { ok: true, id: "c1" }; });
    await Promise.all([api.guardarCliente(), api.guardarCliente()]);
    assert.equal(llamadas, 1);
    assert.equal(api.clientes.length, 1);
    ok("doble clic en Guardar cliente → una sola alta");
    assert.equal(api.clientes[0].id, "c1"); assert.equal(api.clientes[0].dni, "30111222");
    ok("el cliente nuevo aparece en la lista sin recargar, con DNI y demás campos");
  }
  // error del backend → no dice "guardado"
  {
    const { api, toasts } = cargarPanel(archivo, valores);
    api.set("crm", async () => ({ ok: false, error: "Hoja bloqueada" }));
    await api.guardarCliente();
    assert.equal(api.clientes.length, 0);
    assert.deepEqual(toasts.at(-1), ["err", "Error: Hoja bloqueada"]);
    ok("si el backend falla, muestra el error en vez de 'Cliente guardado'");
  }
  // borrar sin id → no llama al backend
  {
    const { api, toasts } = cargarPanel(archivo, valores);
    let llamadas = 0;
    api.set("crm", async () => { llamadas++; return { ok: true, deleted: true }; });
    await api.borrarCliente("", "Sin ID");
    assert.equal(llamadas, 0); assert.equal(toasts.at(-1)[0], "err");
    ok("borrar un cliente sin ID no llama al backend (podía borrar otra fila)");
    api.clientes = [{ id: "c1", nombre: "A" }, { id: "c2", nombre: "B" }];
    await api.borrarCliente("c2", "B");
    await new Promise(r => globalThis.setTimeout(r, 5));
    assert.deepEqual(api.clientes.map(c => c.id), ["c1"]);
    ok("borrar por id saca solo ese cliente de la lista, sin recargar");
  }
  // estado de pedido de Mercado Pago y web
  {
    const { api } = cargarPanel(archivo, valores);
    const pedidas = [];
    api.set("crm", async (p) => { pedidas.push(p); return { ok: true, updated: true }; });
    api.pedidos = [{ fuente: "mp", _mpId: "p9", estado: "Pendiente" }, { fuente: "web", _row: 5, orderNumber: "VSB-1", estado: "Pendiente" }];
    const sel = { value: "Confirmado" };
    await api.cambiarEstadoPedido(sel, "mp:p9");
    assert.equal(pedidas[0].action, "update"); assert.equal(pedidas[0].tab, "Pedidos"); assert.equal(pedidas[0].id, "p9");
    await api.cambiarEstadoPedido({ value: "Entregado" }, "row:5");
    assert.equal(pedidas[1].action, "ext_pedido_update"); assert.equal(pedidas[1].orderNumber, "VSB-1");
    assert.equal(api.pedidos[0].estado, "Confirmado"); assert.equal(api.pedidos[1].estado, "Entregado");
    ok("cambiar estado: pedidos de Mercado Pago y web van cada uno a su pestaña");
    api.set("crm", async () => ({ ok: false, error: "x" }));
    const sel2 = { value: "Cancelado" };
    await api.cambiarEstadoPedido(sel2, "row:5");
    assert.equal(sel2.value, "Entregado");
    ok("si falla, el selector vuelve al estado anterior");
  }
  // caché local: pinta desde localStorage al instante
  {
    const { api, dom } = cargarPanel(archivo, valores);
    const pref = archivo.includes("ops") ? "vsbops_" : "vsbcrm_";
    dom.localStorage.setItem(pref + "pedidos", JSON.stringify({ t: Date.now(), d: [{ orderNumber: "VSB-9" }] }));
    let llamadas = 0;
    api.set("crm", async () => { llamadas++; return []; });
    await api.loadPedidos();
    assert.equal(api.pedidos[0].orderNumber, "VSB-9"); assert.equal(llamadas, 0);
    ok("pedidos: abre al instante desde la caché local (sin red si tiene menos de 40 s)");
  }
}

// ── Facturación (panel.js) ──────────────────────────────────────────────────
console.log("Facturación");
{
  const { api } = cargarPanel("crm/panel.js", {});
  const pedidos = [
    { fuente: "web", timestamp: "2026-10-05 10:00", total: 10000, estado: "Confirmado", productos: "1x Silla · Azul" },
    { fuente: "web", timestamp: "2026-10-06 10:00", total: "13.949,10", estado: "Entregado", productos: "2x Mesa" },
    { fuente: "web", timestamp: "2026-10-07 10:00", total: 5000, estado: "Pendiente", productos: "1x Silla" },
    { fuente: "web", timestamp: "2026-10-08 10:00", total: 7000, estado: "Cancelado", productos: "1x Silla" },
    { fuente: "mp", timestamp: "2026-09-30 22:00", total: 14499, estado: "Confirmado", productos: "1x Auto" },
    { fuente: "web", timestamp: "", total: 999, estado: "Confirmado" },
  ];
  const f = api.agruparFacturacion(pedidos, [{ nombre: "Silla", costo: 6000 }, { nombre: "Mesa", costo: "4.000" }]);
  const oct = f.meses.find(b => b.d.getMonth() === 9), sep = f.meses.find(b => b.d.getMonth() === 8);
  assert.equal(oct.n, 2); assert.ok(Math.abs(oct.monto - 23949.1) < 0.01);
  ok("octubre: 2 ventas cobradas = $23.949,10 (acepta '13.949,10' como texto)");
  assert.equal(oct.pendN, 1); assert.equal(oct.pendMonto, 5000);
  ok("pendientes de pago aparte (1 · $5.000), no suman como facturado");
  assert.ok(!f.meses.some(b => b.monto === 7000 || b.pendMonto === 7000 + 5000));
  ok("cancelados no cuentan");
  assert.equal(sep.n, 1); assert.equal(sep.monto, 14499);
  ok("Mercado Pago entra en facturación (antes solo se leía una pestaña)");
  assert.ok(Math.abs(oct.ben - (10000 - 6000 + 13949.1 - 8000)) < 0.01); assert.equal(oct.benParcial, false);
  ok("beneficio = facturado − costos conocidos");
  assert.equal(sep.benParcial, true);
  ok("si falta el costo de un producto, el beneficio se marca como parcial (no inventa)");
  const total = f.anios.reduce((s, b) => s + b.n, 0);
  assert.equal(total, 3);
  ok("sin fecha → no se cuenta; ningún pedido contado dos veces");
}

// ── Backend (Codigo.gs) ─────────────────────────────────────────────────────
console.log("Backend");
{
  const HOJAS = {
    Pedidos: [["ID", "Fecha", "Cliente", "Teléfono", "Detalle", "Monto", "Estado", "Notas", "Comprobante", "ClienteID"],
              ["p1", new Date("2026-10-10T12:00:00-03:00"), "Ana", "11", "1x Auto", 14499, "Pendiente", "MercadoPago · ref: vsb-1 · email: ana@test.local", "", ""]],
    "Pedidos externos": [["timestamp", "orderNumber", "nombre", "email", "total", "estado"]],
    Camping: [["Producto", "Precio"], ["Silla", 100], ["Mesa", 200]],
    Clientes: [["ID", "Fecha", "Nombre", "Teléfono", "Email", "Ciudad", "Notas", "Origen", "Clave"], ["", "", "Sin id", "", "", "", "", "", ""], ["c1", "", "Con id", "", "", "", "", "", ""]],
  };
  for (let i = 0; i < 320; i++) HOJAS["Pedidos externos"].push([`2026-10-${String(1 + (i % 9)).padStart(2, "0")} ${String(10 + (i % 10))}:${String(i % 60).padStart(2, "0")}`, "VSB-" + i, "N" + i, "e@e", 100, "Pendiente"]);
  const sheet = (name) => ({
    getName: () => name, getLastRow: () => HOJAS[name].length, getLastColumn: () => HOJAS[name][0].length,
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({ getValue: () => HOJAS[name][r - 1][c - 1], setValue: (v) => { HOJAS[name][r - 1][c - 1] = v; },
      getValues: () => HOJAS[name].slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))), setValues() {}, setFontWeight: () => ({}) }),
    deleteRow: (r) => HOJAS[name].splice(r - 1, 1), appendRow: (row) => HOJAS[name].push(row), setFrozenRows() {},
  });
  const ssFake = { getSheets: () => Object.keys(HOJAS).map(sheet), getSheetByName: (n) => HOJAS[n] ? sheet(n) : null, insertSheet: (n) => { HOJAS[n] = []; return sheet(n); } };
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) }, SpreadsheetApp: { openById: () => ssFake },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) }, LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error("sin red"); } },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16).replace("T", " "), DigestAlgorithm: {}, Charset: {}, computeDigest: () => [1, 2], getUuid: () => "u" },
    ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { extPedidosListar, extProductoEliminar, extPedidoActualizar, borrar };")(...Object.values(stubs));

  const lista = gs.extPedidosListar({});
  assert.equal(lista.length, 300);
  assert.ok(lista.some(p => p.fuente === "mp" && p._mpId === "p1" && p.orderNumber === "vsb-1" && p.email === "ana@test.local"));
  ok("listado: incluye los pedidos de Mercado Pago con número, email y estado");
  const todos = gs.extPedidosListar({ todos: 1 });
  assert.equal(todos.length, 321);
  const ultimo = todos.at(-1).timestamp, minimoDeLos300 = lista[0].timestamp;
  assert.ok(lista.at(-1).timestamp === ultimo && minimoDeLos300 >= todos[0].timestamp);
  ok("con más de 300 pedidos devuelve los 300 MÁS NUEVOS (antes devolvía los más viejos); todos=1 trae los 321");

  let r = gs.extProductoEliminar({ sheet: "Camping", row: 2, nombre: "Mesa" });
  assert.equal(r.ok, false); assert.equal(HOJAS.Camping.length, 3);
  ok("eliminar producto: si la fila ya no es ese producto, no borra nada");
  r = gs.extProductoEliminar({ sheet: "Camping", row: 3, nombre: "Mesa" });
  assert.equal(r.ok, true); assert.deepEqual(HOJAS.Camping.map(x => x[0]), ["Producto", "Silla"]);
  ok("eliminar producto: borra la fila correcta cuando el nombre coincide");

  HOJAS["Pedidos externos"] = [["timestamp", "orderNumber", "estado"], ["t", "VSB-A", "Pendiente"], ["t", "VSB-B", "Pendiente"]];
  r = gs.extPedidoActualizar({ row: 2, campo: "estado", valor: "Confirmado", orderNumber: "VSB-B" });
  assert.equal(r.ok, false); assert.equal(HOJAS["Pedidos externos"][1][2], "Pendiente");
  r = gs.extPedidoActualizar({ row: 3, campo: "estado", valor: "Confirmado", orderNumber: "VSB-B" });
  assert.equal(r.ok, true); assert.equal(HOJAS["Pedidos externos"][2][2], "Confirmado");
  ok("cambiar estado: verifica el número de pedido antes de escribir");

  assert.equal(gs.borrar("Clientes", ""), false); assert.equal(HOJAS.Clientes.length, 3);
  ok("borrar con id vacío no borra la primera fila sin id");
}

// ── "Pedidos externos" con los encabezados viejos reales + columnas nuevas de Clientes ──
console.log("Pestaña con formato viejo y Clientes ampliado");
{
  const VIEJOS = ["Fecha", "Hora", "N° Pedido", "Nombre", "Apellido", "Email", "Teléfono", "DNI/CUIT", "Provincia", "Localidad", "CP", "Calle", "Número", "Piso/Dpto",
    "Método entrega", "Productos", "Subtotal", "Descuento", "Total", "Método pago", "Estado pago", "Estado pedido", "URL Comprobante", "Fecha transferencia informada",
    "Fecha confirmación", "Observaciones", "N° seguimiento", "Notas admin", "Links productos"];
  const HOJAS = {
    "Pedidos externos": [VIEJOS.slice()],
    Pedidos: [["ID", "Fecha", "Cliente", "Teléfono", "Detalle", "Monto", "Estado", "Notas", "Comprobante", "ClienteID"]],
    Clientes: [["ID", "Fecha", "Nombre", "Teléfono", "Email", "Ciudad", "Notas", "Origen", "Clave"]],
    Camping: [["Producto", "Precio", "Stock", "Color", "Talle/Medida", "Descripcion"], ["Silla", 30000, true, "Azul", "", "d"]],
  };
  const sheet = (name) => ({
    getName: () => name, getLastRow: () => HOJAS[name].length, getLastColumn: () => Math.max(...HOJAS[name].map(r => r.length)),
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValue: () => (HOJAS[name][r - 1] || [])[c - 1], setValue: (v) => { HOJAS[name][r - 1][c - 1] = v; },
      getValues: () => HOJAS[name].slice(r - 1, r - 1 + (nr || 1)).map(x => { const y = x.slice(c - 1, c - 1 + (nc || 1)); while (y.length < (nc || 1)) y.push(""); return y; }),
      setValues: (vals) => { vals.forEach((fila, i) => fila.forEach((v, j) => { const row = HOJAS[name][r - 1 + i]; row[c - 1 + j] = v; })); return { setFontWeight: () => ({}) }; },
      setFontWeight: () => ({}),
    }),
    appendRow: (row) => HOJAS[name].push(row.slice()), setFrozenRows() {}, deleteRow: (r) => HOJAS[name].splice(r - 1, 1),
  });
  const ssFake = { getSheets: () => Object.keys(HOJAS).map(sheet), getSheetByName: (n) => HOJAS[n] ? sheet(n) : null, insertSheet: (n) => { HOJAS[n] = []; return sheet(n); } };
  const cache = new Map();
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) }, SpreadsheetApp: { openById: () => ssFake },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetch() { throw new Error("sin red"); } },
    Utilities: { formatDate: () => "2026-10-13 10:00", DigestAlgorithm: { MD5: "md5", SHA_256: "sha256" }, Charset: {}, computeDigest: (a, s) => [...String(s)].slice(0, 16).map(ch => ch.charCodeAt(0) % 127), getUuid: () => "u" + Math.random() },
    ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { crearPedido, extPedidosListar, extPedidoActualizar, misPedidos, agregar, listar };")(...Object.values(stubs));

  const r = gs.crearPedido({ nombre: "Ana", apellido: "Pérez", email: "ana@test.local", telefono: "11", dni: "30111222", metodoEntrega: "retiro",
    metodoPago: "transferencia", provincia: "CABA", localidad: "CABA", calle: "Calle", numeroCalle: "123", cp: "1000",
    productos: [{ nombre: "Silla", categoria: "Camping", color: "Azul", qty: 1 }], envioZona: "", observaciones: "nota" });
  assert.equal(r.ok, true);
  const fila = HOJAS["Pedidos externos"][1], col = (h) => fila[VIEJOS.indexOf(h)];
  assert.equal(col("N° Pedido"), r.orderNumber); assert.equal(col("Nombre"), "Ana"); assert.equal(col("Email"), "ana@test.local");
  assert.equal(col("DNI/CUIT"), "30111222"); assert.equal(col("Número"), "123"); assert.equal(col("Estado pedido"), "Pendiente"); assert.equal(col("Total"), 27000);
  assert.equal(HOJAS["Pedidos externos"][0].length, VIEJOS.length);
  ok("crear pedido en la pestaña vieja: cada dato cae en su columna (N° Pedido, DNI/CUIT, Estado pedido…), sin columnas nuevas");

  const lista = gs.extPedidosListar({});
  const p = lista.find(x => x.fuente === "web");
  assert.equal(p.orderNumber, r.orderNumber); assert.equal(p.estado, "Pendiente"); assert.equal(p.email, "ana@test.local"); assert.equal(p.total, 27000);
  ok("el CRM lee los pedidos de la pestaña vieja con los nombres estándar (orderNumber, estado, total)");

  const u = gs.extPedidoActualizar({ row: 2, campo: "estado", valor: "Confirmado", orderNumber: r.orderNumber });
  assert.equal(u.ok, true); assert.equal(col("Estado pedido"), "Confirmado"); assert.equal(col("Estado pago"), "");
  ok("cambiar estado escribe en 'Estado pedido' (antes: 'Campo no encontrado: estado')");

  const m = gs.misPedidos({ email: "ana@test.local" });
  assert.equal(m.orders.length, 1); assert.equal(m.orders[0].numero, r.orderNumber); assert.equal(m.orders[0].estadoPago, "PAGO CONFIRMADO");
  ok("mis compras encuentra el pedido en la pestaña vieja");

  gs.agregar("Clientes", { nombre: "Ana", email: "ana@test.local", apellido: "Pérez", dni: "30111222", cuit: "20-30111222-1", razon: "Ana SRL" });
  const h = HOJAS.Clientes[0];
  assert.deepEqual(h.slice(0, 9), ["ID", "Fecha", "Nombre", "Teléfono", "Email", "Ciudad", "Notas", "Origen", "Clave"]);
  assert.ok(h.includes("DNI") && h.includes("Razón social"));
  const cli = gs.listar("Clientes")[0];
  assert.equal(cli.dni, "30111222"); assert.equal(cli.razon, "Ana SRL"); assert.equal(cli.apellido, "Pérez"); assert.equal(cli.clave, undefined);
  ok("Clientes: las columnas nuevas se agregan al final sin mover las existentes, y DNI/apellido/razón social se guardan");
}

// ── Catálogo público (para poder hacer privada la planilla) ──────────────────
console.log("Catálogo público");
{
  const HOJAS = {
    Categorias: [["Autos a escala"], ["Camping"], ["Clientes"], ["Pedidos externos"]],
    "Autos a escala": [["Producto", "Precio", "Stock", "Color", "Talle/Medida", "Descripcion", "destacado", "Subcategoria", "SKU_costo", "", "imagen_url", "descuento"],
                       ["Auto Maisto", 5499, true, "Rojo", "", "desc", false, "", "4.6", "", "https://img/x.jpg", ""], ["", "", "", "", "", "", "", "", "", "", "", ""]],
    Camping: [["Producto", "Precio", "Stock", "Color", "Costo proveedor"], ["Silla", 30000, true, "Azul", 12000]],
    Clientes: [["ID", "Email"], ["c1", "secreto@cliente.com"]],
    "Pedidos externos": [["Email", "DNI/CUIT"], ["x@y.com", "30111222"]],
  };
  const sheet = (name) => ({
    getLastRow: () => HOJAS[name].length, getLastColumn: () => HOJAS[name][0].length,
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({ getValues: () => HOJAS[name].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
  });
  const ssFake = { getSheetByName: (n) => HOJAS[n] ? sheet(n) : null, getSheets: () => Object.keys(HOJAS).map(sheet) };
  const cache = new Map(); let lecturas = 0;
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) }, SpreadsheetApp: { openById: () => { lecturas++; return ssFake; } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), putAll: (o) => Object.entries(o).forEach(([k, v]) => cache.set(k, v)), getAll: (ks) => Object.fromEntries(ks.map(k => [k, cache.get(k)])), remove: (k) => cache.delete(k) }) },
    LockService: {}, UrlFetchApp: {}, Utilities: { formatDate: () => "" }, ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") + "\nreturn { catalogoPublico, _catalogoInvalidar };")(...Object.values(stubs));
  const c = gs.catalogoPublico();
  const json = JSON.stringify(c);
  assert.deepEqual(Object.keys(c.hojas).sort(), ["Autos a escala", "Camping"]);
  assert.ok(!json.includes("secreto@cliente.com") && !json.includes("30111222") && !json.includes("x@y.com"));
  ok("solo entrega pestañas de productos: nunca Clientes ni Pedidos aunque estén en Categorias");
  const autos = c.hojas["Autos a escala"];
  assert.equal(autos.cols[8].label, ""); assert.equal(autos.rows[0].c[8], null); assert.ok(!json.includes("4.6"));
  assert.equal(c.hojas.Camping.cols[4].label, ""); assert.ok(!json.includes("12000"));
  ok("oculta columnas internas (SKU_costo, Costo proveedor) sin correr las demás de lugar");
  assert.equal(autos.cols[11].label, "descuento"); assert.equal(autos.rows[0].c[1].v, 5499); assert.equal(autos.rows[0].c[2].v, true);
  assert.equal(autos.rows.length, 1);
  ok("formato igual al de la planilla: precios, casillas, descuento e imagen_url; sin filas vacías");
  const antes = lecturas; gs.catalogoPublico(); assert.equal(lecturas, antes);
  ok("la segunda visita sale de la caché (no vuelve a leer la planilla)");
  gs._catalogoInvalidar(); gs.catalogoPublico(); assert.equal(lecturas, antes + 1);
  ok("al editar un producto desde el CRM la caché se borra y la tienda ve el cambio");
}

// ── Cuentas de clientes y seguimiento (ahora en el mismo script) ─────────────
console.log("Cuentas de la tienda y seguimiento");
{
  const crypto = await import("node:crypto");
  const HOJAS = {
    "Pedidos externos": [["Fecha", "Hora", "N° Pedido", "Nombre", "Apellido", "Email", "Calle", "Total", "Método pago", "Estado pedido", "Observaciones"],
                         ["2026-10-12 21:53", "", "VSB-77", "Ana", "Pérez", "ana@test.local", "Calle Falsa 123", 27000, "transferencia", "Pendiente", ""]],
    Pedidos: [["ID", "Fecha", "Cliente", "Teléfono", "Detalle", "Monto", "Estado", "Notas", "Comprobante", "ClienteID"]],
    Suscriptores: [["ID", "Fecha", "Email", "Nombre", "Origen"]],
  };
  const sheet = (name) => ({
    getLastRow: () => HOJAS[name].length, getLastColumn: () => HOJAS[name][0].length,
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()) }),
    getRange: (r, c) => ({ setValue: (v) => { HOJAS[name][r - 1][c - 1] = v; }, getValue: () => HOJAS[name][r - 1][c - 1] }),
    appendRow: (row) => HOJAS[name].push(row.slice()), setFrozenRows() {},
  });
  const ssFake = { getSheetByName: (n) => HOJAS[n] ? sheet(n) : null, insertSheet: (n) => { HOJAS[n] = []; return sheet(n); }, getSheets: () => [] };
  const cache = new Map(); const archivos = []; const tg = [];
  const toBytes = (b) => Array.from(b).map(x => x > 127 ? x - 256 : x);
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => k === "TG_TOKEN" || k === "TG_CHAT" ? "x" : "" }) }, SpreadsheetApp: { openById: () => ssFake },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    UrlFetchApp: { fetch: (u, o) => { tg.push(o && o.payload && o.payload.text); return {}; } },
    Utilities: { DigestAlgorithm: { MD5: "md5", SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }, computeDigest: (a, s) => toBytes(crypto.createHash(a).update(String(s)).digest()),
      formatDate: () => "13/10/2026 10:00", getUuid: () => crypto.randomUUID(), base64Decode: (s) => [...Buffer.from(s, "base64")], newBlob: (b, m, n) => ({ b, m, n }) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: (blob) => { archivos.push(blob); return { getUrl: () => "https://drive.google.com/file/d/abc/view" }; } }) },
    ContentService: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { tiendaRegistrar, tiendaLogin, tiendaCambiarClave, tiendaPedido, tiendaComprobante, suscribir };")(...Object.values(stubs));
  const h1 = "a".repeat(64), h2 = "b".repeat(64);
  assert.equal(gs.tiendaRegistrar({ nombre: "Ana", email: "Ana@Test.local", hash: h1 }).ok, true);
  assert.match(String(HOJAS.Usuarios.at(-1)[3]), /^s1\$/);
  assert.equal(gs.tiendaRegistrar({ nombre: "Ana", email: "ana@test.local", hash: h1 }).error, "email_taken");
  ok("registro: crea la pestaña Usuarios, guarda hash con sal y no duplica emails");
  const l = gs.tiendaLogin({ email: "ana@test.local", hash: h1 });
  assert.equal(l.ok, true); assert.equal(l.nombre, "Ana");
  assert.equal(gs.tiendaLogin({ email: "ana@test.local", hash: h2 }).error, "Contraseña incorrecta");
  ok("login: devuelve nombre y email como espera mi-cuenta.html");
  assert.equal(gs.tiendaCambiarClave({ email: "ana@test.local", oldHash: h1, newHash: h2 }).ok, true);
  assert.equal(gs.tiendaLogin({ email: "ana@test.local", hash: h2 }).ok, true);
  ok("cambiar contraseña funciona");
  const o = gs.tiendaPedido({ order: "VSB-77", email: "ANA@test.local" });
  assert.equal(o.ok, true); assert.equal(o.order.numero, "VSB-77"); assert.equal(o.order.total, 27000); assert.equal(o.order.estadoPago, "PENDIENTE DE PAGO");
  assert.ok(!JSON.stringify(o).includes("Calle Falsa"));
  assert.equal(gs.tiendaPedido({ order: "VSB-77", email: "otro@test.local" }).ok, false);
  ok("estado del pedido: número + email, sin exponer la dirección; con otro email no lo muestra");
  const png = Buffer.from("png").toString("base64");
  assert.equal(gs.tiendaComprobante({ orderNumber: "VSB-77", email: "ana@test.local", fileBase64: "data:image/png;base64," + png, fileMimeType: "image/png" }).ok, true);
  assert.equal(archivos.length, 1); assert.match(HOJAS["Pedidos externos"][1][10], /^Comprobante: https:\/\/drive/);
  assert.equal(gs.tiendaComprobante({ orderNumber: "VSB-77", email: "ana@test.local", fileBase64: png, fileMimeType: "text/html" }).ok, false);
  ok("comprobante: se guarda en Drive, queda el link en el pedido y rechaza archivos que no son imagen/PDF");
  gs.suscribir({ email: "news@test.local", nombre: "N" }); gs.suscribir({ email: "news@test.local" });
  assert.equal(HOJAS.Suscriptores.length, 2);
  ok("suscripción sin duplicados");
}

console.log(`\n${n} pruebas OK`);

// ── Migración a Supabase (con Supabase simulado) ─────────────────────────────
console.log("Migración a Supabase");
{
  const HOJAS = {
    Categorias: [["Camping"], ["Playa"]],
    Camping: [["Producto", "Precio", "Stock", "Color", "Talle/Medida", "Descripcion", "destacado", "Subcategoria", "SKU_costo", "", "imagen_url", "descuento"],
              ["Silla", 30000, true, "Azul", "", "Linda silla", false, "", "C-12", "", "", ""],
              ["Silla", 30000, false, "Rojo", "", "", true, "", "C-13", "", "https://img/r.jpg", 25000],
              ["Carpa", 50000, true, "Verde", "", "Carpa", false, "", "", "", "", ""]],
    Playa: [["Producto", "Precio", "Stock", "Color", "Talle/Medida", "Descripcion"], ["Reposera", "$ 12.500", true, "Negro", "", "R"]],
    Errores: [["Fecha", "Acción", "Error"], ["x", "y", "z"]],
  };
  const sheet = (name) => ({ getName: () => name, getLastRow: () => HOJAS[name].length, getLastColumn: () => HOJAS[name][0].length,
    getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()), getDisplayValues: () => HOJAS[name].map(r => r.map(String)) }),
    getRange: (r, c, nr, nc) => ({ getValues: () => HOJAS[name].slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }) });
  const ssFake = { getSheetByName: (n) => HOJAS[n] ? sheet(n) : null, getSheets: () => Object.keys(HOJAS).map(sheet) };
  const llamadas = []; let nextId = 1;
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ SUPABASE_URL: "https://x.supabase.co/", SUPABASE_SECRET: "sb_secret_test" })[k] || "" }) },
    SpreadsheetApp: { openById: () => ssFake }, CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url, opt = {}) => {
      if (url.includes("images-manifest")) return { getContentText: () => JSON.stringify({ Camping: { Silla: ["https://img/s1.jpg", "https://img/s2.jpg"] } }), getResponseCode: () => 200 };
      const body = opt.payload ? JSON.parse(opt.payload) : undefined;
      llamadas.push({ url, method: opt.method, headers: opt.headers, body });
      let res = null;
      if (url.includes("/productos?select=id,categoria,nombre")) res = body.map(b => ({ id: nextId++, categoria: b.categoria, nombre: b.nombre }));
      return { getResponseCode: () => (opt.method === "post" ? 201 : 200), getContentText: () => res ? JSON.stringify(res) : "" };
    } },
    Utilities: { formatDate: () => "" }, ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") + "\nreturn { migrarProductosASupabase };")(...Object.values(stubs));
  const r = gs.migrarProductosASupabase();
  assert.match(r, /2 categorías, 3 productos, 4 variantes/);
  ok("migra 2 categorías, 3 productos y 4 variantes (ignora pestañas que no son de productos)");
  const prods = llamadas.find(l => l.url.includes("/productos?select")).body;
  const silla = prods.find(p => p.nombre === "Silla");
  assert.deepEqual(silla.imagenes, ["https://img/s1.jpg", "https://img/s2.jpg"]); assert.equal(silla.destacado, true); assert.equal(silla.descripcion, "Linda silla");
  ok("producto con fotos del manifest, destacado si alguna fila lo está y la primera descripción no vacía");
  const vars = llamadas.find(l => l.url.endsWith("/rest/v1/variantes")).body;
  const roja = vars.find(v => v.color === "Rojo");
  assert.equal(roja.stock, false); assert.equal(roja.precio_descuento, 25000); assert.equal(roja.sku_costo, "C-13"); assert.equal(roja.imagen_url, "https://img/r.jpg");
  assert.equal(vars.find(v => v.color === "Negro").precio, 12500);
  ok("variantes con stock, descuento, SKU interno, imagen y precio '$ 12.500' bien leído");
  assert.ok(llamadas.every(l => l.headers.apikey === "sb_secret_test" && !l.headers.Authorization));
  assert.ok(llamadas.some(l => l.method === "delete" && l.url.includes("productos?id=gt.0")));
  ok("usa la clave secreta solo en el header apikey y reemplaza lo anterior (se puede repetir)");
}
console.log(`\n${n} pruebas OK (total)`);
