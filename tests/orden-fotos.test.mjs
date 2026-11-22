// Ordenar fotos no puede perder ninguna: el servidor borra para siempre lo que no viene en la lista.
//   node tests/orden-fotos.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "crm/productos-crm.js"), "utf8").replace(/\r\n/g, "\n");
const cuerpo = src.match(/function _soloReordenar\([\s\S]*?\n}/);
assert.ok(cuerpo, "existe _soloReordenar");
const ordenar = new Function(cuerpo[0] + "\nreturn _soloReordenar;")();
let n = 0;
const ok = m => { n++; console.log("  ✓", m); };

assert.deepEqual(ordenar(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
ok("aplica el orden pedido");
assert.deepEqual(ordenar(["a", "b", "nueva"], ["b", "a"]), ["b", "a", "nueva"]);
ok("una foto subida desde otro lado se conserva");
assert.deepEqual(ordenar(["a", "c"], ["b", "c", "a"]), ["c", "a"]);
ok("una foto quitada desde otro lado no vuelve");
assert.deepEqual(ordenar(["a#vsb=1,2,3", "b"], ["b", "a"]), ["b", "a#vsb=1,2,3"]);
ok("se conserva el encuadre del servidor");
assert.deepEqual(ordenar(["a", "b", "a"], ["b", "a"]), ["b", "a", "a"]);
ok("una repetida no se pierde");

let semilla = 7;
const azar = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
for (let k = 0; k < 5000; k++) {
  const actuales = Array.from({ length: Math.floor(azar() * 16) }, () => "f" + Math.floor(azar() * 20) + (azar() < .2 ? "#vsb=1,2,1" : ""));
  const orden = Array.from({ length: Math.floor(azar() * 16) }, () => "f" + Math.floor(azar() * 20));
  assert.deepEqual(ordenar(actuales, orden).slice().sort(), actuales.slice().sort());
}
ok("5000 casos al azar: siempre salen las mismas fotos");

assert.ok(!/\[url\]\.concat\(urls\.filter/.test(src), "★ tiene que guardar con el orden seguro");
ok("★ usa el mismo guardado seguro");
console.log(`\n${n} comprobaciones OK`);
