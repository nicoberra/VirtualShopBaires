// k6 run -e TARGET_URL=https://script.google.com/macros/s/.../exec -e VUS=50 tests/carga/checkout.k6.js
import http from "k6/http";
import { check } from "k6";

const URL = __ENV.TARGET_URL || "";
const PROD = ["virtualshopbaires.com.ar", "AKfycbwovdDoOyb7WN", "AKfycbzDLw6AMe", "1sufFbmZQzjG8i8FP"];
if (!URL || PROD.some(p => URL.includes(p))) throw new Error("BLOQUEADO: falta TARGET_URL o es de producción");

export const options = {
  scenarios: {
    checkouts: { executor: "shared-iterations", vus: Number(__ENV.VUS || 50), iterations: Number(__ENV.ITER || 200), maxDuration: "10m" },
  },
  thresholds: { http_req_failed: ["rate<0.02"], http_req_duration: ["p(95)<8000"] },
};

export default function () {
  const i = __VU * 10000 + __ITER;
  const body = JSON.stringify({
    action: "createOrder",
    nombre: "Carga", apellido: "k6 " + i, email: `k6-${i}@test.local`, telefono: "1100000000", dni: "00000000",
    metodoEntrega: "retiro", metodoPago: "transferencia", provincia: "CABA", localidad: "CABA", calle: "Test", numeroCalle: "1", cp: "1000",
    productos: [{ nombre: __ENV.PRODUCTO || "Producto de prueba", categoria: __ENV.CATEGORIA || "", qty: 1 }],
    envioZona: "", subtotal: 1, descuento: 0, total: 1, observaciones: "PRUEBA DE CARGA",
  });
  const res = http.post(URL, body, { redirects: 5 });
  let j = null; try { j = res.json(); } catch (e) {}
  check(res, { "ok": () => j && j.ok === true, "sin error de cuota": () => !(j && /quota|Service invoked too many times|Lock/i.test(j.error || "")) });
}
