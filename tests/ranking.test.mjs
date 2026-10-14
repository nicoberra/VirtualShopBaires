// Ranking de productos: más vendidos y con más interés arriba (en general y en cada categoría).
//   node tests/ranking.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

const stubs = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
  SpreadsheetApp: {}, CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) }, LockService: {},
  Utilities: {}, UrlFetchApp: {}, ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
};
const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
  "\nreturn { _rankVentas, _rankPuntajes, _rankOrden, _normKey };")(...Object.values(stubs));

const prods = [
  { id: 1, categoria: "Camping", nombre: "Silla", orden: 0 },
  { id: 2, categoria: "Camping", nombre: "Silla Plegable X4", orden: 1 },
  { id: 3, categoria: "Camping", nombre: "Carpa Iglu 4 Personas", orden: 2 },
  { id: 4, categoria: "Playa", nombre: "Reposera Playa", orden: 3 },
  { id: 5, categoria: "Playa", nombre: "Sombrilla 2m", orden: 4 },
];
const nombres = prods.map(p => gs._normKey(p.nombre));
const hoy = new Date();
const pedidos = [
  { productos: "2x Silla Plegable X4 · Azul, 1x Carpa Iglu 4 Personas", estado: "Entregado", timestamp: hoy.toISOString(), nombre: "Ana" },
  { productos: "1x Silla Plegable X4 · Rojo", estado: "Pendiente", timestamp: hoy.toISOString(), nombre: "Luis" },
  { productos: "5x Sombrilla 2m", estado: "Cancelado", timestamp: hoy.toISOString(), nombre: "Pepe" },
  { productos: "9x Reposera Playa", estado: "Pendiente", timestamp: hoy.toISOString(), nombre: "BORRAR prueba" },
  { productos: "3x Silla · Negro", estado: "Entregado", timestamp: "2020-01-01 10:00", nombre: "Viejo" },
];

{
  const v = gs._rankVentas(pedidos, nombres, new Date(Date.now() - 180 * 86400000));
  assert.equal(v[gs._normKey("Silla Plegable X4")], 3);
  assert.equal(v[gs._normKey("Carpa Iglu 4 Personas")], 1);
  assert.equal(v[gs._normKey("Silla")] || 0, 0);
  ok("cuenta unidades vendidas por producto ('2x Silla Plegable X4' no suma a 'Silla')");
  assert.equal(v[gs._normKey("Sombrilla 2m")] || 0, 0);
  assert.equal(v[gs._normKey("Reposera Playa")] || 0, 0);
  ok("no cuenta pedidos cancelados ni de prueba (BORRAR / prueba)");
  assert.equal(v[gs._normKey("Silla")] || 0, 0);
  ok("solo cuenta ventas de los últimos 180 días");

  const inter = [
    { categoria: "Playa", nombre: "Sombrilla 2m", tipo: "carrito" },
    { categoria: "Playa", nombre: "Sombrilla 2m", tipo: "vista" },
    { categoria: "Playa", nombre: "Reposera Playa", tipo: "vista" },
    { categoria: "X", nombre: "No existe", tipo: "vista" },
  ];
  const pts = gs._rankPuntajes(prods, v, inter);
  assert.equal(pts[2], 30); assert.equal(pts[3], 10); assert.equal(pts[5], 4); assert.equal(pts[4], 1); assert.equal(pts[1], 0);
  ok("puntaje: venta 10, carrito 3, favorito 2, vista 1 (las de productos inexistentes se ignoran)");

  const orden = gs._rankOrden(prods, pts).map(p => p.id);
  assert.deepEqual(orden, [2, 3, 5, 4, 1]);
  ok("el más vendido queda primero; los sin datos al final, en su orden de antes");

  const camping = gs._rankOrden(prods, pts).filter(p => p.categoria === "Camping").map(p => p.id);
  const playa = gs._rankOrden(prods, pts).filter(p => p.categoria === "Playa").map(p => p.id);
  assert.deepEqual(camping, [2, 3, 1]); assert.deepEqual(playa, [5, 4]);
  ok("al filtrar por categoría el orden también va de más a menos popular");

  const conMl = prods.map(p => p.id === 1 ? { ...p, ventas_ml: 500 } : p);
  const ptsMl = gs._rankPuntajes(conMl, v, inter);
  assert.equal(ptsMl[1], 500);
  assert.equal(gs._rankOrden(conMl, ptsMl)[0].id, 1);
  ok("las ventas de Mercado Libre suman 1 punto por unidad (el más vendido en ML sube arriba)");
}
console.log(`\n${n} pruebas OK`);
