// Prueba de carga con Node (sin dependencias). Ver tests/carga/README.md
//   TARGET_URL=https://script.google.com/macros/s/.../exec CONCURRENCIA=50 TOTAL=200 node tests/carga/carga-node.mjs
const URL_OBJ = process.env.TARGET_URL || "";
const CONC    = Number(process.env.CONCURRENCIA || 20);
const TOTAL   = Number(process.env.TOTAL || CONC * 4);
const PRODUCTO = process.env.PRODUCTO || "Producto de prueba";
const CATEGORIA = process.env.CATEGORIA || "";

const PROD = ["virtualshopbaires.com.ar", "AKfycbwovdDoOyb7WN", "AKfycbzDLw6AMe", "1sufFbmZQzjG8i8FP"];
if (!URL_OBJ) { console.error("Falta TARGET_URL"); process.exit(1); }
if (PROD.some(p => URL_OBJ.includes(p))) { console.error("BLOQUEADO: esa URL es de producción."); process.exit(1); }

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))] ?? 0; };

async function unPedido(i) {
  const t0 = performance.now();
  try {
    const res = await fetch(URL_OBJ, {
      method: "POST", redirect: "follow",
      body: JSON.stringify({
        action: "createOrder",
        nombre: "Carga", apellido: "Test " + i, email: `carga${i}@test.local`, telefono: "1100000000", dni: "00000000",
        metodoEntrega: "retiro", metodoPago: "transferencia", provincia: "CABA", localidad: "CABA", calle: "Test", numeroCalle: "1", cp: "1000",
        productos: [{ nombre: PRODUCTO, categoria: CATEGORIA, qty: 1 }], envioZona: "",
        subtotal: 1, descuento: 0, total: 1, observaciones: "PRUEBA DE CARGA",
      }),
    });
    const txt = await res.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    return { ms: performance.now() - t0, ok: !!(j && j.ok), orderNumber: j?.orderNumber, error: j?.error || (res.ok ? null : "HTTP " + res.status) };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, error: String(e.message || e) };
  }
}

const results = [];
let next = 0;
async function worker() { while (next < TOTAL) { const i = next++; results.push(await unPedido(i)); } }
const t0 = performance.now();
await Promise.all(Array.from({ length: CONC }, worker));
const dur = (performance.now() - t0) / 1000;

const lat = results.map(r => r.ms);
const errores = results.filter(r => !r.ok);
const nums = results.map(r => r.orderNumber).filter(Boolean);
const dup = nums.length - new Set(nums).size;
console.log(`\n${TOTAL} pedidos con ${CONC} concurrentes en ${dur.toFixed(1)} s (${(TOTAL / dur).toFixed(1)} req/s)`);
console.log(`p50 ${pct(lat, 50).toFixed(0)} ms · p95 ${pct(lat, 95).toFixed(0)} ms · p99 ${pct(lat, 99).toFixed(0)} ms`);
console.log(`errores: ${errores.length} (${(100 * errores.length / TOTAL).toFixed(1)} %) · duplicados de orderNumber: ${dup}`);
const porError = {};
errores.forEach(e => { porError[e.error] = (porError[e.error] || 0) + 1; });
Object.entries(porError).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
