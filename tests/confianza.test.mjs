// Dispositivos de confianza del panel (Apps Script): se crean desde el 3er ingreso,
// entran sin clave, y dejan de valer al cambiar PANEL_PASS, al vencer o con "Salir".
//   node tests/confianza.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

function cargar() {
  const props = { PANEL_PASS: "clave-buena-123" };
  const cache = new Map();
  const hojas = {};
  const hoja = (nombre) => {
    const filas = [];
    return hojas[nombre] = {
      filas,
      appendRow: r => filas.push(r.slice()), setFrozenRows() {},
      getLastRow: () => filas.length,
      getDataRange: () => ({ getValues: () => filas.map(r => r.slice()) }),
      deleteRow: i => filas.splice(i - 1, 1), deleteRows: (i, k) => filas.splice(i - 1, k),
      getRange: (f, c) => ({ setValue: v => { filas[f - 1][c - 1] = v; } }),
    };
  };
  const libro = { getSheetByName: n => hojas[n] || null, insertSheet: n => hoja(n) };
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || "" }) },
    SpreadsheetApp: { openById: () => libro },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      computeDigest: (alg, s) => [...createHash(alg === "MD5" ? "md5" : "sha256").update(String(s)).digest()].map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { MD5: "MD5", SHA_256: "SHA_256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => randomUUID(), formatDate: () => "", base64Encode: s => Buffer.from(String(s)).toString("base64"),
    },
    UrlFetchApp: {}, ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { loginPanel, verifyPanel, loginDispositivo, olvidarDispositivo };")(...Object.values(stubs));
  return { gs, props, hojas };
}

{
  const { gs, props, hojas } = cargar();
  const r1 = gs.loginPanel({ clave: "clave-buena-123" });
  assert.equal(r1.ok, true); assert.equal(r1.dispositivo, undefined);
  ok("los primeros ingresos no crean dispositivo de confianza");

  const r3 = gs.loginPanel({ clave: "clave-buena-123", confiar: "1", navegador: "Chrome en Windows" });
  assert.match(r3.dispositivo, /^[a-f0-9]{64}$/);
  const fila = hojas.Dispositivos.filas[1];
  assert.notEqual(fila[0], r3.dispositivo); assert.equal(fila[0].length, 64);
  assert.ok(!JSON.stringify(hojas.Dispositivos.filas).includes("clave-buena-123"));
  ok("al 3er ingreso devuelve una llave larga; la planilla guarda solo su hash (nunca la clave)");

  assert.equal(gs.loginPanel({ clave: "mal", confiar: "1" }).dispositivo, undefined);
  ok("con la clave equivocada no se crea ningún dispositivo");

  const d = gs.loginDispositivo({ dispositivo: r3.dispositivo });
  assert.equal(d.ok, true); assert.ok(gs.verifyPanel({ token: d.token }).ok);
  ok("con la llave entra directo y recibe una sesión válida");

  assert.equal(gs.loginDispositivo({ dispositivo: "f".repeat(64) }).error, "dispositivo");
  assert.equal(gs.loginDispositivo({ dispositivo: "<script>" }).error, "dispositivo");
  ok("una llave inventada o mal formada no entra");

  props.PANEL_PASS = "otra-clave-nueva";
  assert.equal(gs.loginDispositivo({ dispositivo: r3.dispositivo }).error, "dispositivo");
  assert.equal(hojas.Dispositivos.filas.length, 1);
  ok("si se cambia PANEL_PASS, los dispositivos de confianza dejan de valer y se borran");
}
{
  const { gs, hojas } = cargar();
  const r = gs.loginPanel({ clave: "clave-buena-123", confiar: "1" });
  hojas.Dispositivos.filas[1][2] = new Date(Date.now() - 61 * 86400000);
  assert.equal(gs.loginDispositivo({ dispositivo: r.dispositivo }).error, "dispositivo");
  ok("un dispositivo sin usar por más de 60 días vence");

  const r2 = gs.loginPanel({ clave: "clave-buena-123", confiar: "1" });
  assert.equal(gs.olvidarDispositivo({ dispositivo: r2.dispositivo }).ok, true);
  assert.equal(gs.loginDispositivo({ dispositivo: r2.dispositivo }).error, "dispositivo");
  ok("'Salir' (olvidarDispositivo) lo deja de confianza nunca más");

  for (let i = 0; i < 35; i++) gs.loginPanel({ clave: "clave-buena-123", confiar: "1" });
  assert.ok(hojas.Dispositivos.filas.length - 1 <= 30);
  ok("se guardan como máximo 30 dispositivos (los más viejos se borran)");
}
{
  // El dueño nunca queda afuera por intentos de otros
  const { gs } = cargar();
  const mio = gs.loginPanel({ clave: "clave-buena-123", confiar: "1", navegador: "Chrome en Windows" }).dispositivo;
  for (let i = 0; i < 12; i++) gs.loginPanel({ clave: "robot-" + i });
  assert.match(gs.loginPanel({ clave: "clave-buena-123" }).error, /Demasiados intentos/);
  ok("10 claves equivocadas de desconocidos bloquean a los navegadores desconocidos");

  const r = gs.loginPanel({ clave: "clave-buena-123", dispositivo: mio });
  assert.equal(r.ok, true); assert.ok(r.token); assert.equal(r.dispositivo, undefined);
  ok("pero un navegador reconocido entra igual con su clave (no lo bloquean los robots)");

  for (let i = 0; i < 10; i++) gs.loginPanel({ clave: "me-equivoque", dispositivo: mio });
  assert.match(gs.loginPanel({ clave: "clave-buena-123", dispositivo: mio }).error, /desde este navegador/);
  ok("un navegador reconocido tiene su propio límite de 10 errores (sigue protegido)");

  const falsa = "a".repeat(64);
  assert.match(gs.loginPanel({ clave: "clave-buena-123", dispositivo: falsa }).error, /Demasiados intentos/);
  ok("una llave inventada no saltea el bloqueo general");
}
console.log(`\n${n} pruebas OK`);
