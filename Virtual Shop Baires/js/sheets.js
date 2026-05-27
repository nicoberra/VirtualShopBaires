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
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwaQe4JKKlKEjgwBcyyhH4-MzUGSH-w56NDKAPGDYdz99cYF2ie1UA72DpPMtLLxxig6w/exec";

let PRODUCTOS  = [];
let CATEGORIAS = ["Todos"];
let IMAGE_MAP  = {};   // { "Categoria": { "Nombre producto": "fileId" } }

// ---------------------------------------------------------------------------
//  IMÁGENES DESDE DRIVE (via Apps Script)
// ---------------------------------------------------------------------------

async function cargarImagenes() {
  if (!APPS_SCRIPT_URL) return;
  try {
    const res  = await fetch(APPS_SCRIPT_URL);
    IMAGE_MAP  = await res.json();
  } catch (e) {
    console.warn("No se pudo cargar el mapa de imágenes:", e.message);
  }
}

// Dado un nombre de categoría y nombre de producto, devuelve la URL de imagen
function getImagenDrive(categoria, nombre) {
  const catMap = IMAGE_MAP[categoria];
  if (!catMap) return null;

  // Buscar coincidencia exacta primero
  if (catMap[nombre]) {
    return `https://lh3.googleusercontent.com/d/${catMap[nombre]}`;
  }

  // Buscar sin distinguir mayúsculas/minúsculas
  const key = Object.keys(catMap).find(
    k => k.toLowerCase() === nombre.toLowerCase()
  );
  if (key) return `https://lh3.googleusercontent.com/d/${catMap[key]}`;

  return null;
}

// ---------------------------------------------------------------------------
//  GOOGLE SHEETS
// ---------------------------------------------------------------------------

async function obtenerCategorias() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Categorias`;
  const res  = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substring(47).slice(0, -2));
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
    const res  = await fetch(url);
    const text = await res.text();
    const json = JSON.parse(text.substring(47).slice(0, -2));
    const rows = json.table.rows;
    if (!rows) return [];

    // Parsear todas las filas
    const rawRows = rows
      .filter(row => row.c && row.c[0] && row.c[0].v)
      .map(row => {
        const c   = row.c;
        const get = (idx) => (c[idx] && c[idx].v !== null && c[idx].v !== undefined) ? c[idx].v : null;
        const stockVal = get(2);
        return {
          nombre:         String(get(0) || "").trim(),
          precio:         Number(String(get(1) || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0,
          stock:          stockVal !== false && String(stockVal).toLowerCase() !== "false",
          color:          get(3) ? String(get(3)).trim() : null,
          talle:          get(4) ? String(get(4)).trim() : null,
          descripcion:    String(get(5) || ""),
          precioOriginal: get(6) ? Number(String(get(6)).replace(/[^\d.,]/g, "").replace(",", ".")) : null,
          badge:          get(7) ? String(get(7)).toLowerCase() : null,
          destacado:      String(get(8)).toLowerCase() === "si",
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
          destacado:      row.destacado,
          imagen:         getImagenDrive(nombreHoja, row.nombre),
          categoria:      nombreHoja,
          disponible:     true,
          tieneVariantes: false,
          variantes:      [],
          colores:        [],
          talles:         [],
        };
      }
      if (row.color || row.talle) {
        grouped[row.nombre].tieneVariantes = true;
        grouped[row.nombre].variantes.push({
          color:  row.color,
          talle:  row.talle,
          precio: row.precio,
          stock:  row.stock,
        });
      } else {
        // Sin variantes: checkbox desmarcado = ocultar
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

async function cargarProductos() {
  mostrarCargando();
  try {
    // 1. Cargar imágenes desde Drive (en paralelo con categorías)
    const [hojas] = await Promise.all([
      obtenerCategorias(),
      cargarImagenes(),
    ]);

    // 2. Cargar todas las hojas en paralelo
    const resultados = await Promise.all(hojas.map(h => fetchHoja(h)));

    // 3. Combinar y asignar IDs
    let id = 1;
    PRODUCTOS = resultados.flat().map(p => ({ ...p, id: id++ }));

    // 4. Categorías dinámicas (solo las que tienen productos)
    const catsConProductos = [...new Set(PRODUCTOS.map(p => p.categoria))];
    CATEGORIAS = ["Todos", ...catsConProductos];

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
