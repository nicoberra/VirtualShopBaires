// ============================================================
//  CONFIGURACIÓN GOOGLE SHEETS + GOOGLE DRIVE
//
//  ESTRUCTURA DEL GOOGLE SHEET:
//
//  1. Pestaña "Categorias":
//       A: nombre de cada categoría (una por fila)
//
//  2. Una pestaña por categoría (mismo nombre). Columnas:
//       A: nombre
//       B: descripcion
//       C: precio
//       D: precio_original  (opcional)
//       E: badge            (nuevo | oferta | vacío)
//       F: destacado        (si | vacío)
//       G: disponible       (no para ocultarlo | vacío)
//
//  ESTRUCTURA DEL GOOGLE DRIVE:
//       📁 Carpeta raíz (DRIVE_FOLDER_ID)
//         📁 Mascotas          ← mismo nombre que la pestaña
//           🖼️ Cama para perro.jpg   ← mismo nombre que columna A del sheet
//           🖼️ Comedero.jpg
//         📁 Piletas
//           🖼️ Pileta inflable.jpg
//
//  APPS SCRIPT:
//  En tu Google Sheet → Extensiones → Apps Script → pegá el código
//  de apps-script.gs y publicalo como app web pública.
//  Luego pegá la URL en APPS_SCRIPT_URL abajo.
// ============================================================

const SHEET_ID        = "1joofIvXtRnU0LcCs320MVIhy44HpaJZ1DqwQ7d2pBTw";
const DRIVE_FOLDER_ID = "1xBYFnxDn-uTjoyFGc0thzOF_WS16jUz5";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxS-UBfke2GiPSuEwhPTbivnbP4b3S3GAYm22qXPtxe68ORtHdRgaQnTDD13EK-jjgV_w/exec";

let PRODUCTOS  = [];
let CATEGORIAS = ["Todos"];
let IMAGE_MAP  = {};   // { "Categoria": { "Nombre producto": "fileId" } }

// ---------------------------------------------------------------------------
//  CACHE localStorage
// ---------------------------------------------------------------------------
const _CACHE_DATA   = 'vsb_data_v2';
const _CACHE_IMAGES = 'vsb_images_v2';
const _TTL_DATA     = 30 * 60 * 1000;   // 30 minutos
const _TTL_IMAGES   = 60 * 60 * 1000;   // 1 hora

function _readCache(key, ttl) {
  try {
    const s = localStorage.getItem(key);
    if (!s) return null;
    const obj = JSON.parse(s);
    if (Date.now() - obj.ts > ttl) return null;
    return obj.data;
  } catch { return null; }
}

function _writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ---------------------------------------------------------------------------
//  IMÁGENES LOCALES (manifest estático en el repo)
// ---------------------------------------------------------------------------

async function cargarImagenes() {
  const cached = _readCache(_CACHE_IMAGES, _TTL_IMAGES);
  if (cached) { IMAGE_MAP = cached; return; }
  try {
    const res = await _fetchWithTimeout("images-manifest.json", 8000);
    IMAGE_MAP = await res.json();
    _writeCache(_CACHE_IMAGES, IMAGE_MAP);
  } catch (e) {
    console.warn("No se pudo cargar el manifest de imágenes:", e.message);
  }
}

// Normaliza un string: minúsculas, sin tildes, sin barras
function _normalizeStr(s) {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\//g, "");
}

// Busca una clave en un mapa ignorando mayúsculas, tildes y '/' vs '-'
function _findKey(map, name) {
  if (!map) return null;
  if (map[name] !== undefined) return name;
  const norm = _normalizeStr(name);
  return Object.keys(map).find(k => _normalizeStr(k) === norm) || null;
}

// Convierte un path con espacios/tildes a URL segura
function _encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Devuelve la URL de la imagen principal (primera) de un producto.
function getImagenDrive(categoria, nombre) {
  const catKey = _findKey(IMAGE_MAP, categoria);
  const catMap = catKey ? IMAGE_MAP[catKey] : null;
  if (!catMap) return null;
  const key = _findKey(catMap, nombre);
  if (!key) return null;
  const val = catMap[key];
  const raw = Array.isArray(val) ? val[0] : (typeof val === "string" ? val : null);
  return raw ? _encodePath(raw) : null;
}

// Devuelve un array con todas las URLs de imágenes de un producto.
function getImagenesDrive(categoria, nombre) {
  const catKey = _findKey(IMAGE_MAP, categoria);
  const catMap = catKey ? IMAGE_MAP[catKey] : null;
  if (!catMap) return [];
  const key = _findKey(catMap, nombre);
  if (!key) return [];
  const val = catMap[key];
  const arr = Array.isArray(val) ? val : (typeof val === "string" ? [val] : []);
  return arr.map(_encodePath);
}

// ---------------------------------------------------------------------------
//  GOOGLE SHEETS
// ---------------------------------------------------------------------------

function _fetchWithTimeout(url, ms = 12000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function _parseGviz(text) {
  // Regex robusto — no depende del largo exacto del prefijo
  const m = text.match(/setResponse\(([\s\S]*)\)\s*;?\s*$/);
  if (m) return JSON.parse(m[1]);
  // Fallback: intenta parsear directo
  return JSON.parse(text);
}

async function obtenerCategorias() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Categorias`;
  const res  = await _fetchWithTimeout(url);
  const text = await res.text();
  const json = _parseGviz(text);
  return json.table.rows
    .filter(row => row.c && row.c[0] && row.c[0].v)
    .map(row => String(row.c[0].v).trim());
}

// Estructura del Sheet por categoría:
//   A: nombre | B: precio | C: stock (checkbox) | D: color | E: talle
//   F: descripcion | G: precio_original | H: badge | I: destacado
async function fetchHoja(nombreHoja) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(nombreHoja)}`;
  try {
    const res  = await _fetchWithTimeout(url);
    const text = await res.text();
    const json = _parseGviz(text);
    const rows = json.table.rows;
    if (!rows) return [];

    // Estructura actual del Sheet:
    // A(0):nombre | B(1):precio | C(2):stock | D(3):color | E(4):talle
    // F(5):descripcion | G(6):destacado (checkbox) | H(7):descuento (precio rebajado)

    const rawRows = rows
      .filter(row => {
        if (!row.c || !row.c[0] || !row.c[0].v) return false;
        const nombre = String(row.c[0].v).trim().toLowerCase();
        // Ignorar filas donde el nombre es igual al nombre de la hoja (encabezado/título)
        if (nombre === nombreHoja.toLowerCase()) return false;
        // Ignorar filas donde el precio (col B) es 0 o vacío y no hay descripción (son encabezados)
        const tieneContenido = row.c[1]?.v || row.c[5]?.v;
        if (!tieneContenido) return false;
        return true;
      })
      .map(row => {
        const c   = row.c;
        const get = (idx) => (c[idx] && c[idx].v !== null && c[idx].v !== undefined) ? c[idx].v : null;
        const stockVal   = get(2);
        const precioBase = Number(String(get(1) || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
        const descuento  = get(7) ? Number(String(get(7)).replace(/[^\d.,]/g, "").replace(",", ".")) : null;
        return {
          nombre:         String(get(0) || "").trim(),
          precio:         descuento !== null ? descuento : precioBase,  // precio real de venta
          precioOriginal: descuento !== null ? precioBase : null,       // tachado si hay descuento
          badge:          descuento !== null ? "oferta" : null,
          stock:          stockVal !== false && String(stockVal).toLowerCase() !== "false",
          color:          get(3) ? String(get(3)).trim() : null,
          talle:          get(4) ? String(get(4)).trim() : null,
          descripcion:    typeof get(5) === "string" ? get(5).trim() : "",
          destacado:      get(6) === true,
        };
      });

    // Agrupar por nombre para construir variantes
    const grouped = {};
    rawRows.forEach(row => {
      if (!grouped[row.nombre]) {
        grouped[row.nombre] = {
          nombre:         row.nombre,
          descripcion:    row.descripcion,
          precio:         row.precio,
          precioOriginal: row.precioOriginal,
          badge:          row.badge,
          destacado:      false,
          imagen:         getImagenDrive(nombreHoja, row.nombre),
          imagenes:       getImagenesDrive(nombreHoja, row.nombre),
          categoria:      nombreHoja,
          disponible:     true,
          tieneVariantes: false,
          variantes:      [],
          colores:        [],
          talles:         [],
        };
      }
      // Si cualquier fila tiene destacado marcado, el producto es destacado
      if (row.destacado) grouped[row.nombre].destacado = true;

      if (row.color || row.talle) {
        grouped[row.nombre].tieneVariantes = true;
        grouped[row.nombre].variantes.push({
          color:          row.color,
          talle:          row.talle,
          precio:         row.precio,
          precioOriginal: row.precioOriginal,
          stock:          row.stock,
        });
      } else {
        if (!row.stock) grouped[row.nombre].disponible = false;
      }
    });

    // Listas únicas de colores/talles y precio base
    return Object.values(grouped)
      .filter(p => p.disponible)
      .map(p => {
        if (p.tieneVariantes) {
          p.colores = [...new Set(p.variantes.filter(v => v.color).map(v => v.color))];
          p.talles  = [...new Set(p.variantes.filter(v => v.talle).map(v => v.talle))];
          const firstOk = p.variantes.find(v => v.stock);
          if (firstOk) p.precio = firstOk.precio;
        }
        return p;
      });

  } catch (e) {
    console.warn(`No se pudo cargar la hoja "${nombreHoja}":`, e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
//  CARGA PRINCIPAL
// ---------------------------------------------------------------------------

// Categorías que redirigen a otro sitio — NO se cargan como productos
// Fuente única de verdad: usada en sheets.js, index.html y productos.html
const CATS_EXTERNAS = {
  "herramientas": "https://sanou.com.ar"
};

async function cargarProductos() {
  // Servir desde cache si existe (carga instantánea)
  const cached = _readCache(_CACHE_DATA, _TTL_DATA);
  if (cached) {
    PRODUCTOS  = cached.productos;
    CATEGORIAS = cached.categorias;
    IMAGE_MAP  = cached.imageMap || {};
    return PRODUCTOS;
  }

  mostrarCargando();
  try {
    // 1. Cargar imágenes desde Drive (en paralelo con categorías)
    const [hojas] = await Promise.all([
      obtenerCategorias(),
      cargarImagenes(),
    ]);

    // 2. Cargar hojas de productos (omitir categorías externas)
    const hojasCargables = hojas.filter(h => !Object.keys(CATS_EXTERNAS).includes(h.toLowerCase().trim()));
    const resultados = await Promise.all(hojasCargables.map(h => fetchHoja(h)));

    // 3. Combinar y asignar IDs (descartar productos con precio 0 sin descripción — fallback de gviz)
    let id = 1;
    PRODUCTOS = resultados.flat()
      .filter(p => p.precio > 0 || p.descripcion)
      .map(p => ({ ...p, id: id++ }));

    // 4. Categorías: las que tienen productos + las externas del Sheet
    const catsConProductos = [...new Set(PRODUCTOS.map(p => p.categoria))];
    const catsExternas     = hojas.filter(h => Object.keys(CATS_EXTERNAS).includes(h.toLowerCase().trim()));
    CATEGORIAS = ["Todos", ...catsConProductos, ...catsExternas];

    _writeCache(_CACHE_DATA, { productos: PRODUCTOS, categorias: CATEGORIAS, imageMap: IMAGE_MAP });
    ocultarCargando();
    return PRODUCTOS;
  } catch (e) {
    console.error("Error cargando productos:", e);
    ocultarCargando();
    mostrarError();
    return [];
  }
}

// ---------------------------------------------------------------------------
//  UI helpers
// ---------------------------------------------------------------------------

function mostrarCargando() {
  document.querySelectorAll("#featured-products, #products-container").forEach(el => {
    el.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:60px 0; color:var(--gray-light);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:2rem; color:var(--red);"></i>
        <p style="margin-top:16px;">Cargando productos...</p>
      </div>`;
  });
}

function ocultarCargando() {}

function mostrarError() {
  document.querySelectorAll("#featured-products, #products-container").forEach(el => {
    el.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:60px 0; color:var(--gray-light);">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem; color:var(--red);"></i>
        <p style="margin-top:16px;">No se pudieron cargar los productos. Verificá que el Sheet esté publicado.</p>
      </div>`;
  });
}
