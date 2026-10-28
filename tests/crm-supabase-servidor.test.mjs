// CRM con productos en Supabase, guardando DESDE EL SERVIDOR (Apps Script con SUPABASE_SECRET).
// El CRM entra solo con su clave; se prueba el camino completo: doPost → token → Supabase.
//   node tests/crm-supabase-servidor.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

// ── Supabase (PostgREST) simulado: entiende eq., select con variantes(...)/productos(...), offset/limit ──
function crearSupabase() {
  const db = {
    categorias: [{ nombre: "Camping", orden: 0, visible: true }],
    productos: [{ id: 1, categoria: "Camping", nombre: "Silla", descripcion: "d", subcategoria: null, destacado: false, imagenes: ["https://img/1.jpg"], orden: 0 },
                { id: 2, categoria: "Camping", nombre: "Carpa", descripcion: "", subcategoria: null, destacado: false, imagenes: [], orden: 1 }],
    variantes: [{ id: 10, producto_id: 1, color: "Azul", talle: "", precio: 30000, precio_descuento: null, stock: true, sku_costo: "S-1", imagen_url: "https://img/a.jpg", orden: 0 },
                { id: 11, producto_id: 1, color: "Rojo", talle: "", precio: 30000, precio_descuento: null, stock: false, sku_costo: null, imagen_url: null, orden: 1 },
                { id: 20, producto_id: 2, color: "Verde", talle: "", precio: 50000, precio_descuento: null, stock: true, sku_costo: null, imagen_url: null, orden: 0 }],
    crm_filas: [],   // papelera de fotos
  };
  let nextId = 100; const llamadas = [];
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body === undefined ? "" : JSON.stringify(body) });
  function fetch(url, opt = {}) {
    const u = new URL(url), tabla = u.pathname.replace("/rest/v1/", ""), metodo = (opt.method || "get").toLowerCase();
    llamadas.push({ metodo, tabla, url, key: opt.headers && opt.headers.apikey });
    const filtros = [...u.searchParams].filter(([k, v]) => v.startsWith("eq.")).map(([k, v]) => [k, v.slice(3)]);
    const enLista = [...u.searchParams].filter(([k, v]) => v.startsWith("in.(")).map(([k, v]) => [k, v.slice(4, -1).split(",")]);
    const T = db[tabla], sel = T.filter(r => filtros.every(([c, v]) => String(r[c]) === v) && enLista.every(([c, l]) => l.includes(String(r[c]))));
    const body = opt.payload ? JSON.parse(opt.payload) : undefined;
    if (metodo === "post") {
      const filas = [].concat(body);
      for (const f of filas) if (tabla === "productos" && T.some(p => p.categoria === f.categoria && p.nombre === f.nombre))
        return resp(409, { message: "duplicate key value violates unique constraint" });
      const nuevas = filas.map(f => ({ id: nextId++, imagenes: [], orden: 0, ...f })); T.push(...nuevas);
      return resp(201, (opt.headers.Prefer || "").includes("representation") ? nuevas.map(x => ({ id: x.id })) : undefined);
    }
    if (metodo === "patch") {
      if (tabla === "productos" && body.nombre && sel.some(r => T.some(p => p !== r && p.categoria === r.categoria && p.nombre === body.nombre)))
        return resp(409, { message: "duplicate key value violates unique constraint" });
      sel.forEach(r => Object.assign(r, body));
      return (opt.headers.Prefer || "").includes("representation") ? resp(200, sel.map(r => ({ ...r }))) : resp(204);
    }
    if (metodo === "delete") {
      sel.forEach(r => T.splice(T.indexOf(r), 1));
      if (tabla === "productos") db.variantes = db.variantes.filter(v => db.productos.some(p => p.id === v.producto_id));
      return resp(204);
    }
    const cols = u.searchParams.get("select") || "";
    let data = sel.map(r => ({ ...r }));
    if (tabla === "productos" && cols.includes("variantes(")) data.forEach(p => { p.variantes = db.variantes.filter(v => v.producto_id === p.id).map(v => ({ ...v })); });
    if (tabla === "variantes" && cols.includes("productos(")) data.forEach(v => { const p = db.productos.find(x => x.id === v.producto_id); v.productos = p ? { categoria: p.categoria, nombre: p.nombre } : null; });
    const desde = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
    return resp(200, data.slice(desde, desde + lim));
  }
  return { db, fetch, llamadas };
}

function cargar(props) {
  const sb = crearSupabase(), gh = [];
  const cache = new Map([["panel_TOKEN-OK", "1"]]);
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || "" }) },
    SpreadsheetApp: { openById: () => { throw new Error("no debería tocar la planilla"); } },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: (url, opt) => {
      if (url.startsWith("https://api.github.com")) { gh.push({ url, metodo: opt.method });
        if (url.includes("images-manifest.json") && opt.method === "get")
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ sha: "x", content: Buffer.from(JSON.stringify({ Camping: { Silla: ["https://img/1.jpg"] } })).toString("base64") }) };
        return { getResponseCode: () => 201, getContentText: () => "{}" }; }
      return sb.fetch(url, opt); } },
    Utilities: { formatDate: () => "", base64Decode: s => [...Buffer.from(s, "base64")], base64Encode: s => Buffer.from(String(s)).toString("base64"),
      newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString("utf8") }), Charset: { UTF_8: "utf8" } },
    ContentService: { createTextOutput: t => ({ setMimeType: () => ({ t }) }), MimeType: { JSON: 1, JAVASCRIPT: 2 } },
    DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") + "\nreturn { doPost };")(...Object.values(stubs));
  const pedir = (params) => JSON.parse(gs.doPost({ parameter: { token: "TOKEN-OK", ...params } }).t);
  return { pedir, db: sb.db, llamadas: sb.llamadas, gh };
}

const PROPS = { FUENTE_PRODUCTOS: "supabase", SUPABASE_SECRET: "sb_secret_test", GH_TOKEN: "gh_test" };
{
  const { pedir, db, llamadas, gh } = cargar(PROPS);

  assert.equal(pedir({ action: "ext_productos_list", token: "MALO" }).error, "auth");
  ok("sin la clave del CRM no se puede ni listar");

  const r = pedir({ action: "ext_productos_list" });
  assert.equal(r.rows.length, 3);
  const azul = r.rows.find(x => x.color === "Azul");
  assert.equal(azul._row, "v10"); assert.equal(azul._sheet, "Camping"); assert.equal(azul.sku, "S-1"); assert.equal(azul.imagen, "https://img/a.jpg");
  assert.equal(r.rows.find(x => x.color === "Rojo").stock, false);
  assert.ok(llamadas.every(l => l.key === "sb_secret_test"));
  ok("lista todo (con y sin stock, con SKU) en el formato de siempre, usando la clave secreta del servidor");

  pedir({ action: "ext_producto_update", sheet: "Camping", row: "v10", campo: "precio", valor: "$ 32.500" });
  pedir({ action: "ext_producto_update", sheet: "Camping", row: "v11", campo: "stock", valor: "true" });
  pedir({ action: "ext_producto_update", sheet: "Camping", row: "v10", campo: "descuento", valor: "0" });
  assert.equal(db.variantes.find(v => v.id === 10).precio, 32500); assert.equal(db.variantes.find(v => v.id === 11).stock, true);
  assert.equal(db.variantes.find(v => v.id === 10).precio_descuento, null); assert.equal(db.variantes.find(v => v.id === 20).precio, 50000);
  ok("editar precio ($ 32.500 = 32500), stock y descuento cambia SOLO esa variante");

  pedir({ action: "ext_producto_update", sheet: "Camping", row: "v11", campo: "producto", valor: "Silla Director" });
  assert.equal(db.productos.find(p => p.id === 1).nombre, "Silla Director");
  const dup = pedir({ action: "ext_producto_update", sheet: "Camping", row: "v20", campo: "producto", valor: "Silla Director" });
  assert.equal(dup.ok, false); assert.match(dup.error, /Ya existe/);
  ok("el nombre se cambia para todo el producto y no permite repetidos");

  const antesG = llamadas.length;
  const g = pedir({ action: "ext_producto_guardar", sheet: "Camping", row: "v10",
    variante: JSON.stringify({ precio: "$ 31.000", descuento: "", stock: "false", color: "Verde" }),
    producto: JSON.stringify({ descripcion: "Plegable", destacado: "true" }) });
  assert.equal(g.ok, true);
  const v10 = db.variantes.find(v => v.id === 10);
  assert.deepEqual([v10.precio, v10.precio_descuento, v10.stock, v10.color], [31000, null, false, "Verde"]);
  assert.deepEqual([db.productos.find(p => p.id === 1).descripcion, db.productos.find(p => p.id === 1).destacado], ["Plegable", true]);
  assert.equal(db.variantes.find(v => v.id === 11).precio, 30000);
  assert.ok(llamadas.length - antesG <= 3, "una lectura y como mucho dos escrituras");
  assert.equal(pedir({ action: "ext_producto_guardar", sheet: "Camping", row: "v10", variante: JSON.stringify({ inventado: 1 }) }).ok, false);
  assert.equal(pedir({ action: "ext_producto_guardar", sheet: "Camping", row: "v10", producto: "{roto" }).ok, false);
  ok("guardar la ficha manda todos los cambios en un solo pedido (variante + producto) y rechaza campos raros");

  const fv = pedir({ action: "variante_foto_subir", sheet: "Camping", row: "v11", color: "Rojo", data: "data:image/jpeg;base64,AAA" });
  assert.equal(fv.ok, true); assert.match(fv.url, /^https:\/\/.+\.jpg$/);
  assert.equal(db.variantes.find(v => v.id === 11).imagen_url, fv.url);
  assert.deepEqual(db.productos.find(p => p.id === 1).imagenes, ["https://img/1.jpg"]);
  assert.equal(pedir({ action: "variante_foto_subir", sheet: "Camping", row: "v11" }).ok, false);
  assert.deepEqual(fv.fotos, [fv.url]);
  const fv2 = pedir({ action: "variante_foto_subir", sheet: "Camping", row: "v11", color: "Rojo", data: "data:image/jpeg;base64,BBB" });
  assert.deepEqual(db.variantes.find(v => v.id === 11).imagenes, [fv.url, fv2.url]);
  assert.equal(db.variantes.find(v => v.id === 11).imagen_url, fv.url);
  ok("subir fotos a una variante las suma a SU lista (la primera queda como principal); la galería del producto no cambia");

  const fs = pedir({ action: "variante_fotos_set", sheet: "Camping", row: "v11", urls: JSON.stringify([fv2.url, "javascript:alert(1)", "https://img/x.jpg"]) });
  assert.equal(fs.ok, true);
  assert.deepEqual(db.variantes.find(v => v.id === 11).imagenes, [fv2.url, "https://img/x.jpg"]);
  assert.equal(db.variantes.find(v => v.id === 11).imagen_url, fv2.url);
  pedir({ action: "variante_fotos_set", sheet: "Camping", row: "v11", urls: "[]" });
  assert.equal(db.variantes.find(v => v.id === 11).imagen_url, null);
  assert.equal(pedir({ action: "variante_fotos_set", sheet: "Camping", row: "v11", urls: "{roto" }).ok, false);
  ok("ordenar/quitar fotos de una variante: la principal es la primera, descarta direcciones raras y permite dejarla sin fotos");

  const vieja = pedir({ action: "ext_producto_update", sheet: "Camping", row: "11", campo: "precio", valor: "1" });
  assert.equal(vieja.ok, false); assert.match(vieja.error, /desactualizada/);
  const vieja2 = pedir({ action: "ext_producto_eliminar", sheet: "Camping", row: 20, nombre: "Carpa" });
  assert.equal(vieja2.ok, false); assert.equal(db.variantes.find(v => v.id === 11).precio, 30000); assert.ok(db.variantes.some(v => v.id === 20));
  ok("una lista vieja de la planilla (número de fila) se rechaza: nunca toca otro producto");

  const a = pedir({ action: "ext_producto_agregar", sheet: "Camping", nombre: "Farol", precio: "9999", stock: "1", marca: "Negro" });
  assert.equal(a.ok, true); assert.deepEqual(db.variantes.filter(v => v.producto_id === a.id).map(v => [v.color, v.precio, v.stock]), [["Negro", 9999, true]]);
  ok("agregar producto crea el producto con su primera variante");

  const va = pedir({ action: "ext_variante_agregar", sheet: "Camping", row: "v20", nombre: "Carpa", color: "Azul", precio: "52.000", sku: "C-9", data: "data:image/jpeg;base64,AAA" });
  const nueva = db.variantes.find(v => v.producto_id === 2 && v.color === "Azul");
  assert.equal(va.ok, true); assert.equal(nueva.precio, 52000); assert.equal(nueva.sku_costo, "C-9"); assert.equal(nueva.orden, 1);
  assert.match(nueva.imagen_url, /^https:\/\/virtualshopbaires\.com\.ar\/img\/productos\/camping\//); assert.ok(gh.some(g => g.metodo === "put"));
  assert.equal(pedir({ action: "ext_variante_agregar", sheet: "Camping", row: "v20", nombre: "Carpa", color: "azul" }).ok, false);
  ok("agregar variante: foto al repo, queda al final y no repite colores");

  assert.equal(pedir({ action: "ext_producto_eliminar", sheet: "Camping", row: "v20", nombre: "Otro" }).ok, false);
  assert.ok(db.variantes.some(v => v.id === 20));
  pedir({ action: "ext_producto_eliminar", sheet: "Camping", row: "v20", nombre: "Carpa" });
  assert.ok(!db.variantes.some(v => v.id === 20)); assert.ok(db.productos.some(p => p.id === 2));
  pedir({ action: "ext_producto_eliminar", sheet: "Camping", row: "v" + nueva.id, nombre: "Carpa" });
  assert.ok(!db.productos.some(p => p.id === 2));
  ok("eliminar verifica el nombre, y al borrar la última variante se va el producto");

  const f = pedir({ action: "producto_foto_subir", categoria: "Camping", nombre: "Silla Director", data: "data:image/jpeg;base64,AAA" });
  assert.equal(f.ok, true); assert.deepEqual(db.productos.find(p => p.id === 1).imagenes, f.fotos);
  pedir({ action: "producto_fotos_set", categoria: "Camping", nombre: "Silla Director", urls: JSON.stringify(["https://img/x.jpg"]) });
  assert.deepEqual(db.productos.find(p => p.id === 1).imagenes, ["https://img/x.jpg"]);
  ok("fotos: se guardan en el repo/manifest como siempre y también en Supabase");

  pedir({ action: "ext_categoria_agregar", nombre: "Pesca" });
  assert.ok(db.categorias.some(c => c.nombre === "Pesca"));
  pedir({ action: "ext_categoria_eliminar", nombre: "Pesca" });
  assert.ok(!db.categorias.some(c => c.nombre === "Pesca")); assert.ok(db.productos.some(p => p.categoria === "Camping"));
  ok("crear y eliminar categorías (solo la elegida)");

  assert.equal(pedir({ action: "ext_categoria_foto", nombre: "Camping", token: "MALO" }).error, "auth");
  const cf = pedir({ action: "ext_categoria_foto", nombre: "Camping", data: "data:image/jpeg;base64,AAA" });
  assert.equal(cf.ok, true); assert.match(cf.url, /^https:\/\/virtualshopbaires\.com\.ar\/img\/productos\/categorias\/camping-/);
  assert.equal(db.categorias.find(c => c.nombre === "Camping").imagen_url, cf.url);
  assert.equal(pedir({ action: "ext_categorias_list" }).categorias[0].imagen_url, cf.url);
  assert.equal(pedir({ action: "ext_categoria_foto", nombre: "No existe", data: "data:image/jpeg;base64,AAA" }).ok, false);
  pedir({ action: "ext_categoria_foto", nombre: "Camping" });
  assert.equal(db.categorias.find(c => c.nombre === "Camping").imagen_url, null);
  ok("foto de categoría (carrusel de la portada): solo con la clave del CRM, se sube al repo y se puede quitar");
}
{
  const { pedir } = cargar({ FUENTE_PRODUCTOS: "supabase" });
  const r = pedir({ action: "ext_productos_list" });
  assert.equal(r.ok, false); assert.match(r.error, /SUPABASE_SECRET/);
  ok("si falta la clave secreta lo dice claro (no cae a la planilla vieja)");
}
console.log(`\n${n} pruebas OK`);
