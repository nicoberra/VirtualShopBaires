// Papelera de fotos: una foto quitada se puede recuperar 5 minutos; después se borra del repo
// para siempre, salvo que otro producto, variante, descripción o categoría la siga usando.
//   node tests/papelera-fotos.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };
const F = (x) => "https://virtualshopbaires.com.ar/img/productos/camping/" + x + ".jpg";

function cargar() {
  let ahora = Date.parse("2026-10-28T12:00:00Z");
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [ahora])); } static now() { return ahora; } }
  const db = {
    categorias: [{ nombre: "Camping", imagen_url: F("cat") }],
    productos: [{ id: 1, categoria: "Camping", nombre: "Silla", descripcion: "Mirá " + F("desc") + " acá", imagenes: [F("s1"), F("s2"), F("s3")] },
                { id: 2, categoria: "Camping", nombre: "Carpa", descripcion: "", imagenes: [F("c1")] }],
    variantes: [{ id: 10, producto_id: 1, color: "Azul", imagen_url: F("v1"), imagenes: [F("v1"), F("v2"), F("s3")], orden: 0 },
                { id: 11, producto_id: 1, color: "Rojo", imagen_url: null, imagenes: [], orden: 1 },
                { id: 20, producto_id: 2, color: "Verde", imagen_url: F("c2"), imagenes: [F("c2")], orden: 0 }],
    crm_filas: [],
  };
  const archivos = new Set(["s1", "s2", "s3", "v1", "v2", "c1", "c2", "cat", "desc"].map(x => "img/productos/camping/" + x + ".jpg"));
  let nextId = 1, ghFalla = false;
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body === undefined ? "" : JSON.stringify(body) });
  function supabase(url, opt) {
    const u = new URL(url), tabla = u.pathname.replace("/rest/v1/", ""), metodo = (opt.method || "get").toLowerCase();
    const T = db[tabla];
    const filtros = [...u.searchParams].filter(([k]) => !["select", "order", "offset", "limit"].includes(k));
    const pasa = r => filtros.every(([c, v]) => v.startsWith("eq.") ? String(r[c]) === v.slice(3)
      : v.startsWith("in.(") ? v.slice(4, -1).split(",").includes(String(r[c])) : true);
    const sel = T.filter(pasa), body = opt.payload ? JSON.parse(opt.payload) : undefined;
    if (metodo === "post") { [].concat(body).forEach(f => T.push({ id: nextId++, ...f })); return resp(201); }
    if (metodo === "patch") { sel.forEach(r => Object.assign(r, body)); return resp(204); }
    if (metodo === "delete") {
      sel.forEach(r => T.splice(T.indexOf(r), 1));
      if (tabla === "productos") db.variantes = db.variantes.filter(v => db.productos.some(p => p.id === v.producto_id));
      return resp(204);
    }
    const cols = u.searchParams.get("select") || "";
    const data = sel.map(r => JSON.parse(JSON.stringify(r)));
    if (tabla === "productos" && cols.includes("variantes(")) data.forEach(p => { p.variantes = db.variantes.filter(v => v.producto_id === p.id).map(v => ({ ...v })); });
    if (tabla === "variantes" && cols.includes("productos(")) data.forEach(v => { const p = db.productos.find(x => x.id === v.producto_id); v.productos = { categoria: p.categoria, nombre: p.nombre }; });
    const desde = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
    return resp(200, data.slice(desde, desde + lim));
  }
  function github(url, opt) {
    const ruta = decodeURIComponent(url.split("/contents/")[1].split("?")[0]), metodo = opt.method;
    if (ruta === "images-manifest.json") {
      if (metodo === "get") return resp(200, { sha: "m", content: Buffer.from("{}").toString("base64") });
      return resp(200, {});
    }
    if (metodo === "get") return archivos.has(ruta) ? resp(200, { sha: "sha-" + ruta }) : resp(404, {});
    if (metodo === "delete") { if (ghFalla) return resp(500, {}); archivos.delete(ruta); return resp(200, {}); }
    archivos.add(ruta); return resp(201, {});
  }
  const props = { FUENTE_PRODUCTOS: "supabase", SUPABASE_SECRET: "sb_secret_x", GH_TOKEN: "gh" };
  const cache = new Map([["panel_TOKEN-OK", "1"]]);
  const lock = { waitLock() {}, tryLock: () => true, releaseLock() {} };
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || "" }) },
    SpreadsheetApp: { openById: () => { throw new Error("no debería tocar la planilla"); } },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => lock, getUserLock: () => lock },
    UrlFetchApp: { fetch: (url, opt = {}) => url.startsWith("https://api.github.com") ? github(url, opt) : supabase(url, opt) },
    Utilities: { formatDate: () => "", base64Decode: s => [...Buffer.from(s, "base64")], base64Encode: s => Buffer.from(String(s)).toString("base64"),
      newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString("utf8") }), Charset: { UTF_8: "utf8" } },
    ContentService: { createTextOutput: t => ({ setMimeType: () => ({ t }) }), MimeType: { JSON: 1, JAVASCRIPT: 2 } },
    DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {}, Date: FakeDate,
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") + "\nreturn { doPost, purgarFotosPapelera };")(...Object.values(stubs));
  const pedir = (params) => JSON.parse(gs.doPost({ parameter: { token: "TOKEN-OK", ...params } }).t);
  return { pedir, db, archivos, purgar: gs.purgarFotosPapelera, pasar: min => { ahora += min * 60000; }, fallarGH: v => { ghFalla = v; } };
}
const existe = (s, x) => s.archivos.has("img/productos/camping/" + x + ".jpg");
const fotosSilla = (s, urls) => s.pedir({ action: "producto_fotos_set", categoria: "Camping", nombre: "Silla", urls: JSON.stringify(urls) });
const papelera = (s, nombre = "Silla") => s.pedir({ action: "fotos_papelera", categoria: "Camping", nombre }).fotos;

console.log("Papelera de fotos");
{
  const s = cargar();
  assert.equal(fotosSilla(s, [F("s1"), F("s3")]).ok, true);
  assert.ok(existe(s, "s2"), "no se borra enseguida");
  const p = papelera(s);
  assert.equal(p.length, 1); assert.equal(p[0].url, F("s2")); assert.ok(p[0].quedan > 290 && p[0].quedan <= 300);
  ok("quitar una foto la deja 5 minutos en la papelera (sin borrar el archivo)");
  s.pasar(4); s.purgar();
  assert.ok(existe(s, "s2")); ok("a los 4 minutos sigue estando");
  s.pasar(1.5); s.purgar();
  assert.ok(!existe(s, "s2"), "se borró del repo"); assert.equal(s.db.crm_filas.length, 0); assert.equal(papelera(s).length, 0);
  ok("pasados los 5 minutos se borra del repo para siempre y sale de la papelera");
}
{
  const s = cargar();
  fotosSilla(s, [F("s1"), F("s3")]); s.pasar(2);
  fotosSilla(s, [F("s1"), F("s3"), F("s2")]);
  assert.equal(papelera(s).length, 0); s.pasar(10); s.purgar();
  assert.ok(existe(s, "s2")); ok("si se recupera antes de los 5 minutos, no se borra nunca");
}
{
  const s = cargar();
  fotosSilla(s, [F("s1")]);   // s3 también la usa la variante Azul
  s.pasar(6); s.purgar();
  assert.ok(!existe(s, "s2")); assert.ok(existe(s, "s3"), "la sigue usando una variante");
  assert.equal(s.db.crm_filas.length, 0);
  ok("una foto que sigue usando una variante no se borra (y sale de la papelera)");
}
{
  const s = cargar();
  const r = s.pedir({ action: "variante_fotos_set", row: "v10", urls: JSON.stringify([F("v2"), F("s3")]) });
  assert.equal(r.ok, true);
  const p = papelera(s); assert.equal(p.length, 1); assert.equal(p[0].vid, 10); assert.equal(p[0].url, F("v1"));
  s.pasar(6); s.purgar(); assert.ok(!existe(s, "v1"));
  ok("las fotos quitadas de una variante también pasan por la papelera y después se borran");
}
{
  const s = cargar();
  fotosSilla(s, [F("s1") + "#vsb=50,40,1.2", F("s2"), F("s3")]);
  assert.equal(s.db.crm_filas.length, 0); ok("cambiar el encuadre no manda la foto a la papelera");
  fotosSilla(s, [F("s2"), F("s3")]);
  assert.equal(papelera(s)[0].url, F("s1") + "#vsb=50,40,1.2"); ok("al recuperar vuelve con su encuadre");
}
{
  const s = cargar();
  s.db.productos[0].imagenes.push("https://otra-web.com/foto.jpg", "https://virtualshopbaires.com.ar/index.html");
  fotosSilla(s, [F("s1"), F("s2"), F("s3")]);
  assert.equal(s.db.crm_filas.length, 0); ok("solo se anotan archivos de img/productos de la tienda (nunca otras webs ni páginas)");
}
{
  const s = cargar();
  s.db.productos[0].imagenes.push(F("desc"), F("cat"));
  fotosSilla(s, [F("s1"), F("s2"), F("s3")]); s.pasar(6); s.purgar();
  assert.ok(existe(s, "desc") && existe(s, "cat")); ok("no borra fotos usadas en una descripción o en una categoría");
}
{
  const s = cargar();
  assert.equal(s.pedir({ action: "ext_producto_eliminar", row: "v20" }).ok, true);
  assert.equal(papelera(s, "Carpa").length, 2);
  s.pasar(6); s.purgar(); assert.ok(!existe(s, "c1") && !existe(s, "c2"));
  ok("al eliminar un producto, sus fotos pasan por la papelera y después se borran");
}
{
  const s = cargar();
  fotosSilla(s, [F("s1"), F("s3")]); s.pasar(6); s.fallarGH(true); s.purgar();
  assert.ok(existe(s, "s2")); assert.equal(s.db.crm_filas.length, 1);
  s.fallarGH(false); s.purgar(); assert.ok(!existe(s, "s2"));
  ok("si GitHub falla, queda en la papelera y se reintenta en la próxima pasada");
}
{
  const s = cargar();
  assert.equal(s.pedir({ action: "fotos_papelera", token: "MALO", categoria: "Camping", nombre: "Silla" }).error, "auth");
  ok("ver la papelera pide la clave del CRM");
  assert.equal(s.pedir({ action: "version" }).version, "v20-papelera-fotos"); ok("versión del servidor: v20-papelera-fotos");
}
console.log(`\n${n} pruebas OK`);
