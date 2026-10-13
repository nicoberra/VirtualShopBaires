// Prueba crm/supabase-crm.js (CRM con productos en Supabase) contra un Supabase simulado.
//   node tests/supabase-crm.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

// ── Supabase simulado (tablas en memoria + builder encadenable) ─────────────
function crearDB() {
  const db = {
    categorias: [{ nombre: "Camping", orden: 0 }],
    productos: [{ id: 1, categoria: "Camping", nombre: "Silla", descripcion: "d", subcategoria: null, destacado: false, imagenes: ["https://img/1.jpg"], orden: 0 },
                { id: 2, categoria: "Camping", nombre: "Carpa", descripcion: "", subcategoria: null, destacado: false, imagenes: [], orden: 1 }],
    variantes: [{ id: 10, producto_id: 1, color: "Azul", talle: "", precio: 30000, precio_descuento: null, stock: true, sku_costo: "S-1", imagen_url: null, orden: 0 },
                { id: 11, producto_id: 1, color: "Rojo", talle: "", precio: 30000, precio_descuento: null, stock: false, sku_costo: null, imagen_url: null, orden: 1 },
                { id: 20, producto_id: 2, color: "Verde", talle: "", precio: 50000, precio_descuento: null, stock: true, sku_costo: null, imagen_url: null, orden: 0 }],
  };
  let nextId = 100;
  const from = (tabla) => {
    const q = { tabla, op: "select", cols: "*", filtros: [], payload: null, uno: false, quizas: false, head: false };
    const b = {
      select(cols, opt) { if (q.op === "select") q.cols = cols || "*"; q.ret = true; if (opt && opt.head) q.head = true; return b; },
      insert(p) { q.op = "insert"; q.payload = p; return b; },
      update(p) { q.op = "update"; q.payload = p; return b; },
      delete() { q.op = "delete"; return b; },
      eq(c, v) { q.filtros.push([c, v]); return b; },
      order() { return b; }, range() { return b; },
      single() { q.uno = true; return b; }, maybeSingle() { q.quizas = true; return b; },
      then(res, rej) { try { res(ejecutar(q)); } catch (e) { rej(e); } },
    };
    return b;
  };
  const filtra = (rows, f) => rows.filter(r => f.every(([c, v]) => String(r[c]) === String(v)));
  function ejecutar(q) {
    const T = db[q.tabla];
    if (q.op === "insert") {
      if (q.tabla === "productos" && T.some(p => p.categoria === q.payload.categoria && p.nombre === q.payload.nombre))
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      const row = { id: nextId++, imagenes: [], descripcion: "", destacado: false, subcategoria: null, orden: 0, ...q.payload };
      T.push(row); return { data: q.uno ? row : [row], error: null };
    }
    const sel = filtra(T, q.filtros);
    if (q.op === "update") {
      if (q.tabla === "productos" && q.payload.nombre && sel.some(r => T.some(p => p !== r && p.categoria === r.categoria && p.nombre === q.payload.nombre)))
        return { data: null, error: { message: "duplicate key value violates unique constraint" } };
      sel.forEach(r => Object.assign(r, q.payload)); return { data: null, error: null };
    }
    if (q.op === "delete") {
      sel.forEach(r => T.splice(T.indexOf(r), 1));
      if (q.tabla === "productos") db.variantes = db.variantes.filter(v => db.productos.some(p => p.id === v.producto_id));
      return { data: null, error: null };
    }
    if (q.head) return { count: sel.length, data: null, error: null };
    let data = sel.map(r => ({ ...r }));
    if (q.tabla === "productos" && /variantes\(/.test(q.cols)) data.forEach(p => { p.variantes = db.variantes.filter(v => v.producto_id === p.id).map(v => ({ ...v })); });
    if (q.tabla === "variantes" && /productos\(/.test(q.cols)) data.forEach(v => { const p = db.productos.find(x => x.id === v.producto_id); v.productos = p ? { nombre: p.nombre } : null; });
    if (q.uno) return { data: data[0] || null, error: data.length ? null : { message: "no rows" } };
    if (q.quizas) return { data: data[0] || null, error: null };
    return { data, error: null };
  }
  return { db, cliente: { from, auth: {
    getSession: async () => ({ data: { session: { user: { app_metadata: { role: "admin" } } } } }),
    signInWithPassword: async () => ({}), signOut: async () => ({}) } } };
}

function cargar() {
  const sim = crearDB();
  const llamadasOriginal = [];
  const src = readFileSync(join(root, "crm/supabase-crm.js"), "utf8").replace("const CRM_PRODUCTOS_EN_SUPABASE = false;", "const CRM_PRODUCTOS_EN_SUPABASE = true;");
  const store = new Map();
  const env = {
    window: { supabase: { createClient: () => sim.cliente } }, document: { getElementById: () => null },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    setTimeout: () => 0,
  };
  const api = new Function(...Object.keys(env), `
    let _productos = [], _fotosProd = null, _ghOk = true;
    let crm = async (p) => ({ ok: true, via: 'apps-script', action: p.action });
    let crmEnviar = async (p) => { __orig.push(p); return p.action === 'producto_foto_subir' ? { ok: true, url: 'https://img/nueva.jpg' } : { ok: true, via: 'apps-script' }; };
    let cargarFotos = () => {}; const renderFotos = () => {};
    const __orig = [];
    ${src}
    return { crm: (p) => crm(p), crmEnviar: (p) => crmEnviar(p), __orig, get fotos() { return _fotosProd; }, cargarFotos: (p) => cargarFotos(p),
             set productos(v) { _productos = v; } };`)(...Object.values(env));
  return { api, db: sim.db, store };
}

{
  const { api, db, store } = cargar();
  assert.equal(store.get("vsb-crm-fuente"), "supabase");
  ok("al activarse descarta la lista guardada de la planilla (evita borrar por número de fila)");

  const r = await api.crm({ action: "ext_productos_list" });
  assert.equal(r.rows.length, 3);
  const azul = r.rows.find(x => x.color === "Azul");
  assert.equal(azul._row, 10); assert.equal(azul.sku, "S-1"); assert.equal(azul.categoria, "Camping"); assert.deepEqual(azul._imagenes, ["https://img/1.jpg"]);
  assert.equal(r.rows.find(x => x.color === "Rojo").stock, false);
  ok("lista todas las variantes (con y sin stock) con SKU, en el formato de siempre");

  assert.equal((await api.crm({ action: "ext_pedidos_listar" })).via, "apps-script");
  ok("pedidos y el resto del CRM siguen yendo a Apps Script");

  await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "10", campo: "precio", valor: "$ 32.500" });
  await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "11", campo: "stock", valor: "true" });
  await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "10", campo: "talle/medida", valor: "XL" });
  assert.equal(db.variantes.find(v => v.id === 10).precio, 32500); assert.equal(db.variantes.find(v => v.id === 11).stock, true);
  assert.equal(db.variantes.find(v => v.id === 10).talle, "XL"); assert.equal(db.variantes.find(v => v.id === 20).precio, 50000);
  ok("editar precio, stock y medida cambia SOLO esa variante");

  await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "11", campo: "descripcion", valor: "Nueva" });
  await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "10", campo: "producto", valor: "Silla Director" });
  assert.equal(db.productos.find(p => p.id === 1).descripcion, "Nueva"); assert.equal(db.productos.find(p => p.id === 1).nombre, "Silla Director");
  ok("descripción y nombre se guardan una vez para todo el producto");

  const dup = await api.crmEnviar({ action: "ext_producto_update", sheet: "Camping", row: "20", campo: "producto", valor: "Silla Director" });
  assert.equal(dup.ok, false); assert.match(dup.error, /Ya existe/);
  ok("no deja dos productos con el mismo nombre en la misma categoría");

  const a = await api.crm({ action: "ext_producto_agregar", sheet: "Camping", nombre: "Farol", precio: "9999", stock: "1", marca: "" });
  assert.equal(a.ok, true); assert.equal(db.variantes.filter(v => v.producto_id === a.id).length, 1);
  ok("agregar producto crea el producto con su primera variante");

  await api.crmEnviar({ action: "ext_variante_agregar", sheet: "Camping", row: "20", nombre: "Carpa", color: "Azul", precio: "52000", sku: "C-9", data: "data:image/png;base64,AAA" });
  const nueva = db.variantes.find(v => v.producto_id === 2 && v.color === "Azul");
  assert.equal(nueva.precio, 52000); assert.equal(nueva.sku_costo, "C-9"); assert.equal(nueva.imagen_url, "https://img/nueva.jpg"); assert.equal(nueva.orden, 1);
  ok("agregar variante (con foto subida al repo) queda al final del producto");

  const mal = await api.crm({ action: "ext_producto_eliminar", sheet: "Camping", row: 20, nombre: "Otro" });
  assert.equal(mal.ok, false); assert.ok(db.variantes.some(v => v.id === 20));
  ok("eliminar verifica el nombre: si no coincide, no borra nada");

  await api.crm({ action: "ext_producto_eliminar", sheet: "Camping", row: 20, nombre: "Carpa" });
  assert.ok(!db.variantes.some(v => v.id === 20)); assert.ok(db.productos.some(p => p.id === 2));
  await api.crm({ action: "ext_producto_eliminar", sheet: "Camping", row: nueva.id, nombre: "Carpa" });
  assert.ok(!db.productos.some(p => p.id === 2));
  ok("eliminar la última variante elimina también el producto");

  await api.crmEnviar({ action: "producto_foto_subir", categoria: "Camping", nombre: "Silla Director", data: "x" });
  assert.deepEqual(db.productos.find(p => p.id === 1).imagenes, ["https://img/1.jpg", "https://img/nueva.jpg"]);
  await api.crmEnviar({ action: "producto_fotos_set", categoria: "Camping", nombre: "Silla Director", urls: JSON.stringify(["https://img/nueva.jpg"]) });
  assert.deepEqual(db.productos.find(p => p.id === 1).imagenes, ["https://img/nueva.jpg"]);
  ok("fotos: subir agrega a la lista y ordenar/borrar la reemplaza");

  await api.cargarFotos({ _imagenes: ["https://img/a.jpg"] });
  assert.deepEqual(api.fotos, ["https://img/a.jpg"]);
  ok("la ficha muestra las fotos guardadas en Supabase");

  await api.crm({ action: "ext_categoria_agregar", nombre: "Pesca" });
  assert.ok(db.categorias.some(c => c.nombre === "Pesca"));
  await api.crm({ action: "ext_categoria_eliminar", nombre: "Camping" });
  assert.ok(!db.productos.some(p => p.categoria === "Camping")); assert.ok(!db.categorias.some(c => c.nombre === "Camping"));
  ok("crear y eliminar categorías (eliminar borra sus productos)");
}

// Los <script> del CRM comparten el ámbito global: un nombre repetido rompe el archivo entero.
{
  const nombres = f => new Set([...readFileSync(join(root, f), "utf8").matchAll(/^(?:const|let|var|function|async function|class)\s+([\w$]+)/gm)].map(m => m[1]));
  const propios = nombres("crm/supabase-crm.js");
  for (const f of ["crm/panel.js", "crm/panel-ops.js", "crm/productos-crm.js"]) {
    const choque = [...nombres(f)].filter(x => propios.has(x));
    assert.deepEqual(choque, [], `nombres repetidos con ${f}: ${choque}`);
  }
  ok("no repite nombres globales de los otros archivos del CRM");
}
console.log(`\n${n} pruebas OK`);
