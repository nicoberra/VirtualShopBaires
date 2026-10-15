// Notificaciones push del CRM (Apps Script): claves VAPID, firma ES256, suscripciones y avisos.
//   node tests/push.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let n = 0; const ok = (m) => { n++; console.log("  ✓", m); };
const firmados = (b) => b.map(x => x > 127 ? x - 256 : x);

function cargar(respuestas = {}) {
  const props = { PANEL_PASS: "clave-buena-123" };
  const cache = new Map();
  const hojas = {};
  const enviados = [];
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: { openById: () => libro },
    CacheService: { getScriptCache: () => ({ get: k => cache.has(k) ? cache.get(k) : null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      computeDigest: (alg, s) => firmados([...createHash(alg === "MD5" ? "md5" : "sha256").update(String(s)).digest()]),
      DigestAlgorithm: { MD5: "MD5", SHA_256: "SHA_256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => randomUUID(), formatDate: () => "",
      base64Encode: s => Buffer.from(String(s)).toString("base64"),
      base64EncodeWebSafe: b => Buffer.from(b.map(x => x & 255)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      newBlob: s => ({ getBytes: () => firmados([...Buffer.from(String(s), "utf8")]) }),
    },
    UrlFetchApp: { fetchAll: reqs => reqs.map(r => { enviados.push(r); const c = respuestas[r.url] || 201; return { getResponseCode: () => c, getContentText: () => "" }; }) },
    ContentService: {}, DriveApp: {}, Logger: { log() {} }, MailApp: {}, ScriptApp: {},
  };
  const gs = new Function(...Object.keys(stubs), readFileSync(join(root, "crm/Codigo.gs"), "utf8") +
    "\nreturn { pushClave, pushSuscribir, pushDesuscribir, pushPendientes, avisarPush, pushProbar };")(...Object.values(stubs));
  return { gs, props, hojas, enviados, cache };
}

const FCM = "https://fcm.googleapis.com/fcm/send/abc123:APA91b-" + "x".repeat(120);
const APPLE = "https://web.push.apple.com/QGv" + "y".repeat(80);

{
  const { gs, props } = cargar();
  const c1 = gs.pushClave().clave;
  assert.match(c1, /^[A-Za-z0-9_-]{87}$/);
  assert.equal(Buffer.from(c1, "base64url")[0], 4);
  assert.equal(gs.pushClave().clave, c1);
  assert.ok(props.PUSH_VAPID_PRIVADA && props.PUSH_VAPID_PUBLICA === c1);
  ok("crea una sola vez las claves VAPID (pública de 65 bytes) y las guarda en propiedades");
}
{
  const { gs, enviados, hojas } = cargar();
  const clave = gs.pushClave().clave;
  const s1 = gs.pushSuscribir({ endpoint: FCM, panel: "crm", navegador: "Chrome Android" });
  assert.equal(s1.ok, true); assert.match(s1.secreto, /^[a-f0-9]{64}$/);
  assert.equal(gs.pushSuscribir({ endpoint: APPLE, panel: "ops" }).ok, true);
  const s2 = gs.pushSuscribir({ endpoint: FCM, panel: "crm" });
  assert.equal(s2.ok, true); assert.notEqual(s2.secreto, s1.secreto);
  assert.equal(hojas.Push.filas.length, 3);
  assert.ok(!JSON.stringify(hojas.Push.filas).includes(s2.secreto));
  ok("guarda cada dispositivo una sola vez");

  gs.avisarPush("🛒 Nueva venta en la web", "Ana · $1000", "pedidos");
  assert.equal(enviados.length, 2);
  const pub = Buffer.from(clave, "base64url");
  const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
  const llave = createPublicKey({ key: jwk, format: "jwk" });
  for (const r of enviados) {
    const m = r.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.equal(m[2], clave);
    const [h, c, f] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url"));
    assert.equal(claims.aud, new URL(r.url).origin);
    assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
    assert.equal(JSON.parse(Buffer.from(h, "base64url")).alg, "ES256");
    assert.ok(verify("sha256", Buffer.from(h + "." + c), { key: llave, dsaEncoding: "ieee-p1363" }, Buffer.from(f, "base64url")));
    assert.equal(r.headers.TTL, "86400"); assert.equal(r.payload, "");
  }
  ok("cada aviso va firmado con ES256 válido (verificado con la librería de Node) para Google y Apple");

  const pend = gs.pushPendientes({ endpoint: FCM, secreto: s2.secreto });
  assert.equal(pend.eventos.at(-1).t, "🛒 Nueva venta en la web");
  assert.equal(pend.eventos.at(-1).b, "Ana · $1000");
  assert.equal(gs.pushPendientes({ endpoint: "https://fcm.googleapis.com/fcm/send/inventado" }).ok, false);
  assert.equal(gs.pushPendientes({ endpoint: FCM }).ok, false);
  assert.equal(gs.pushPendientes({ endpoint: FCM, secreto: s1.secreto }).ok, false);
  ok("el detalle solo se entrega a un dispositivo suscripto con su secreto vigente (la planilla guarda solo el hash)");
}
{
  const { gs, hojas } = cargar({ [APPLE]: 410 });
  gs.pushSuscribir({ endpoint: FCM }); gs.pushSuscribir({ endpoint: APPLE });
  gs.avisarPush("x", "y");
  assert.equal(hojas.Push.filas.length, 2);
  assert.equal(hojas.Push.filas[1][1], FCM);
  ok("si el navegador dio de baja la suscripción (410), se borra sola");
}
{
  const { gs, hojas } = cargar();
  assert.equal(gs.pushSuscribir({ endpoint: "https://evil.example.com/x" }).ok, false);
  assert.equal(gs.pushSuscribir({ endpoint: "http://fcm.googleapis.com/fcm/send/x" }).ok, false);
  assert.equal(hojas.Push, undefined);
  ok("rechaza direcciones que no son de un servicio de notificaciones real");
  gs.pushDesuscribir({ endpoint: FCM });
  gs.pushSuscribir({ endpoint: FCM }); gs.pushDesuscribir({ endpoint: FCM });
  assert.equal(hojas.Push.filas.length, 1);
  ok("desactivar borra el dispositivo");
}
{
  const { gs } = cargar();
  gs.avisarPush("sin suscriptos", "no explota");
  for (let i = 0; i < 25; i++) gs.avisarPush("v" + i, "");
  const s = gs.pushSuscribir({ endpoint: FCM });
  assert.equal(gs.pushPendientes({ endpoint: FCM, secreto: s.secreto }).eventos.length, 20);
  ok("sin dispositivos no falla, y guarda solo los últimos 20 avisos");
}
{
  const { gs, props, hojas, enviados } = cargar();
  const s = gs.pushSuscribir({ endpoint: FCM });
  props.PANEL_PASS = "otra-clave-nueva";
  assert.equal(gs.pushPendientes({ endpoint: FCM, secreto: s.secreto }).ok, false);
  gs.avisarPush("x", "y");
  assert.equal(enviados.length, 0); assert.equal(hojas.Push.filas.length, 1);
  ok("si se cambia PANEL_PASS, esos dispositivos dejan de recibir avisos y se borran");
}
{
  const src = readFileSync(join(root, "crm/Codigo.gs"), "utf8");
  assert.ok(!/\b\d+n\b/.test(src.slice(src.indexOf("NOTIFICACIONES PUSH"), src.indexOf("HOJA HELPERS"))));
  ok("no usa literales BigInt (si faltara BigInt, el resto del CRM sigue andando)");
}
console.log(`\n${n} pruebas OK`);
