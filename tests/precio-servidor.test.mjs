// Prueba las funciones de precio del servidor de crm/Codigo.gs contra una
// planilla simulada. No toca Google ni producción.
//   node tests/precio-servidor.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src  = readFileSync(join(root, "crm", "Codigo.gs"), "utf8");

// ── Planilla simulada ───────────────────────────────────────────────────────
const HOJAS = {
  Clientes: [["id","nombre"]],
  Pedidos:  [["id","cliente"]],
  "Autos a escala": [
    ["Producto","Precio","Stock","Color","Talle/Medida","Descripcion","destacado","Subcategoria","SKU_costo","","imagen_url","descuento"],
    ["Auto Chevrolet Blazer", 25000, true, "Rojo", "", "desc", false, "", "4.6", "", "", ""],
    ["Auto Chevrolet Blazer", 25000, true, "Azul", "", "desc", false, "", "4.6", "", "", 19990],
    ["Moto Vespa", "$ 12.500", true, "", "", "desc", false, "", "", "", "", ""],
  ],
  Camping: [
    ["Producto","Precio","Stock","Color","Talle/Medida","Descripcion"],
    ["Silla Plegable Director", 30000, true, "", "", "desc"],
    ["Remera Trekking", 8000, true, "Negro", "M", "desc"],
    ["Remera Trekking", 8500, true, "Negro", "L", "desc"],
  ],
};
const fakeSheet = (name) => ({
  getName: () => name,
  getLastRow: () => HOJAS[name].length,
  getDataRange: () => ({ getValues: () => HOJAS[name].map(r => r.slice()) }),
});
const fakeSS = {
  getSheets: () => Object.keys(HOJAS).map(fakeSheet),
  getSheetByName: (n) => (HOJAS[n] ? fakeSheet(n) : null),
};
const stubs = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
  SpreadsheetApp: { openById: () => fakeSS },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  UrlFetchApp: { fetch: () => { throw new Error("sin red en tests"); } },
  Utilities: { formatDate: () => "", getUuid: () => "x", base64Encode: () => "", base64Decode: () => "", newBlob: () => ({}) },
  ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {},
};
const api = new Function(
  ...Object.keys(stubs),
  src + "\nreturn { _calcularPedidoServidor, _precioCatalogo, _nuevoCacheCatalogo, _numPrecio, ZONAS_ENVIO_SRV };"
)(...Object.values(stubs));

// ── Casos ───────────────────────────────────────────────────────────────────
let n = 0;
const ok = (msg) => { n++; console.log("  ✓", msg); };

// 1) El precio del navegador se ignora
let r = api._calcularPedidoServidor([{ nombre:"Auto Chevrolet Blazer", categoria:"Autos a escala", color:"Rojo", cantidad:2, precio:1 }], "", 0);
assert.equal(r.items[0].precio, 25000); assert.equal(r.subtotal, 50000); assert.equal(r.total, 50000);
ok("precio manipulado ($1) → se usa el real ($25.000)");

// 2) Variante con descuento usa la columna "descuento"
r = api._calcularPedidoServidor([{ nombre:"Auto Chevrolet Blazer", categoria:"Autos a escala", color:"Azul", cantidad:1 }], "", 0);
assert.equal(r.items[0].precio, 19990);
ok("variante Azul con descuento → $19.990");

// 3) Sin categoría (carritos viejos) se encuentra igual
r = api._calcularPedidoServidor([{ nombre:"silla plegable director", cantidad:1 }], "", 0);
assert.equal(r.items[0].precio, 30000);
ok("sin categoría y en minúsculas → se busca en todas las pestañas");

// 4) Producto inexistente → no verificado, no se cobra
r = api._calcularPedidoServidor([{ nombre:"Producto Inventado", categoria:"Camping", cantidad:1 }], "", 0);
assert.deepEqual(r.noVerificados, ["Producto Inventado"]); assert.equal(r.items.length, 0);
ok("producto inexistente → queda en noVerificados");

// 5) Talle exacto
r = api._calcularPedidoServidor([{ nombre:"Remera Trekking", categoria:"Camping", color:"Negro", talle:"L", cantidad:1 }], "", 0);
assert.equal(r.items[0].precio, 8500);
ok("talle L → $8.500 (no el de M)");

// 6) Envío por zona del servidor, aunque el cliente no mande costo
r = api._calcularPedidoServidor([{ nombre:"Moto Vespa", categoria:"Autos a escala", cantidad:1 }], "gba2", 0);
assert.equal(r.items[0].precio, 12500); assert.equal(r.envio, 9000); assert.equal(r.total, 21500);
ok("precio con formato '$ 12.500' + envío GBA 2 → total $21.500");

// 7) Descuento 10% transferencia con la misma fórmula de redondeo del checkout
r = api._calcularPedidoServidor([{ nombre:"Remera Trekking", categoria:"Camping", color:"Negro", talle:"M", cantidad:3 }], "capital", 10);
const sub = 24000, disc = Math.round(sub * 10 / 100 * 100) / 100;
assert.equal(r.descuento, disc); assert.equal(r.total, sub - disc + 5500);
ok("10% transferencia + Capital → $" + r.total);

// 8) Cantidad acotada
r = api._calcularPedidoServidor([{ nombre:"Moto Vespa", cantidad:-5 }, { nombre:"Moto Vespa", cantidad:500 }], "", 0);
assert.equal(r.items[0].qty, 1); assert.equal(r.items[1].qty, 99);
ok("cantidad -5 → 1, cantidad 500 → 99");

// 9) Zona inválida → sin envío
r = api._calcularPedidoServidor([{ nombre:"Moto Vespa", cantidad:1 }], "gba9", 0);
assert.equal(r.envio, 0);
ok("zona inexistente → envío $0");

console.log(`\n${n} pruebas OK`);
