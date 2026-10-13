// Límites contra abuso del Apps Script: bloqueo tras fallos, honeypot, registro e idempotencia.
//   node tests/antiabuso.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };

function cargar() {
  const cache = new Map();
  const usuarios = [["Fecha registro", "Email", "Nombre", "Hash contraseña"]];
  const hojaUsuarios = {
    getDataRange: () => ({ getValues: () => usuarios.map(r => r.slice()) }),
    appendRow: (r) => usuarios.push(r), getRange: (f, c) => ({ setValue: (v) => { usuarios[f - 1][c - 1] = v; } }),
  };
  const stubs = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => ({ PANEL_PASS: "clave-correcta-larga" })[k] || "" }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === "Usuarios" ? hojaUsuarios : null }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      computeDigest: (alg, s) => [...createHash(alg === "MD5" ? "md5" : "sha256").update(String(s)).digest()].map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { MD5: "MD5", SHA_256: "SHA_256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => Math.random().toString(36).slice(2), formatDate: () => "", base64Encode: s => Buffer.from(String(s)).toString("base64"),
    },
    UrlFetchApp: {}, ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { loginPanel, verifyPanel, tiendaRegistrar, tiendaLogin, tiendaCambiarClave, _claveIdem };")(...Object.values(stubs));
  return { gs, cache };
}

{
  const { gs } = cargar();
  for (let i = 0; i < 10; i++) assert.equal(gs.loginPanel({ clave: String(1000 + i) }).error, "Contraseña incorrecta.");
  assert.match(gs.loginPanel({ clave: "9999" }).error, /Demasiados intentos/);
  assert.match(gs.loginPanel({ clave: "clave-correcta-larga" }).error, /Demasiados intentos/);
  ok("CRM: 10 claves equivocadas (aunque cambien las primeras letras) bloquean 15 minutos");
}
{
  const { gs } = cargar();
  for (let i = 0; i < 9; i++) gs.loginPanel({ clave: "mal" + i });
  const r = gs.loginPanel({ clave: "clave-correcta-larga" });
  assert.equal(r.ok, true); assert.ok(gs.verifyPanel({ token: r.token }).ok);
  for (let i = 0; i < 9; i++) assert.equal(gs.loginPanel({ clave: "mal" + i }).error, "Contraseña incorrecta.");
  ok("CRM: la clave correcta entra normal y limpia el contador de fallos");
}
{
  const { gs } = cargar();
  assert.equal(gs.tiendaRegistrar({ nombre: "Ana", email: "ana@x.com", hash: "h1" }).ok, true);
  assert.equal(gs.tiendaRegistrar({ nombre: "Bot", email: "bot@x.com", hash: "h", website: "spam.com" }).ok, false);
  ok("registro: personas se registran normal; el honeypot frena bots");

  assert.equal(gs.tiendaLogin({ email: "ana@x.com", hash: "h1" }).ok, true);
  for (let i = 0; i < 5; i++) assert.equal(gs.tiendaLogin({ email: "ana@x.com", hash: "mal" }).error, "Contraseña incorrecta");
  assert.match(gs.tiendaLogin({ email: "ana@x.com", hash: "h1" }).error, /bloqueamos los intentos por 15 minutos/);
  assert.match(gs.tiendaCambiarClave({ email: "ana@x.com", oldHash: "h1", newHash: "h2" }).error, /bloqueamos/);
  ok("cuentas: 5 contraseñas equivocadas bloquean login y cambio de clave 15 min, con mensaje amable");
}
{
  const { gs } = cargar();
  gs.tiendaRegistrar({ nombre: "Ana", email: "ana@x.com", hash: "h1" });
  for (let i = 0; i < 4; i++) gs.tiendaLogin({ email: "ana@x.com", hash: "mal" });
  assert.equal(gs.tiendaLogin({ email: "ana@x.com", hash: "h1" }).ok, true);
  for (let i = 0; i < 4; i++) gs.tiendaLogin({ email: "ana@x.com", hash: "mal" });
  assert.equal(gs.tiendaLogin({ email: "ana@x.com", hash: "h1" }).ok, true);
  ok("cuentas: entrar bien reinicia el contador (un cliente que se equivoca no queda bloqueado)");
}
{
  const { gs } = cargar();
  let ultimo;
  for (let i = 0; i < 31; i++) ultimo = gs.tiendaRegistrar({ nombre: "N", email: `u${i}@x.com`, hash: "h" });
  assert.match(ultimo.error, /muchos registros/);
  ok("registro: tope de 30 cuentas nuevas por minuto en total (frena registros masivos)");
}
{
  const { gs } = cargar();
  const items = [{ nombre: "Silla", color: "Azul", qty: 1 }];
  const a = gs._claveIdem("pedido", { idPedido: "p-abc123-xyz", email: "a@x.com" }, items);
  const b = gs._claveIdem("pedido", { idPedido: "p-abc123-xyz", email: "a@x.com" }, [{ nombre: "Otra", qty: 2 }]);
  const c = gs._claveIdem("pedido", { idPedido: "p-otro-9999", email: "a@x.com" }, items);
  assert.equal(a, b); assert.notEqual(a, c);
  assert.notEqual(a, gs._claveIdem("mp", { idPedido: "p-abc123-xyz" }, items));
  ok("idempotencia nueva: el mismo idPedido devuelve el mismo pedido; otro id es otro pedido");
  const v1 = gs._claveIdem("pedido", { email: "a@x.com", nombre: "Ana" }, items);
  assert.equal(v1, gs._claveIdem("pedido", { email: "A@x.com ", nombre: "ana" }, items));
  assert.equal(v1, gs._claveIdem("pedido", { email: "a@x.com", nombre: "Ana", idPedido: "<script>" }, items));
  ok("formato viejo (sin id, o id inválido) sigue funcionando por carrito + email");
}
console.log(`\n${n} pruebas OK`);
