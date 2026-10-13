// ============================================================
//  BLOQUE PARA PEGAR EN EL PROYECTO DE apps-script.gs (registro / login de la tienda)
//  NO reemplaces el archivo entero: tu copia tiene los datos bancarios reales en CONFIG.
//
//  Cómo pegarlo:
//   1. Abrí ese proyecto de Apps Script.
//   2. Borrá las funciones registerUser, loginUser y changePassword que ya existen
//      (desde "function registerUser(params) {" hasta el cierre de changePassword, justo
//      antes de "function getUsuariosSheet()").
//   3. Pegá todo este bloque en ese mismo lugar.
//   4. Implementar → Administrar implementaciones → ✏️ → Nueva versión → Implementar.
//      La URL /exec no cambia.
// ============================================================

// El navegador manda SHA-256(clave+email). En el servidor se vuelve a hashear con sal por
// usuario y se guarda "s1$<sal>$<hash>". Los hashes viejos (sin "s1$") siguen funcionando
// y se convierten solos en el próximo login exitoso.
function _hexUS(bytes) {
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function _shaUS(s) {
  return _hexUS(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}
function _hashServidor(clienteHash, sal) {
  sal = sal || _shaUS(Utilities.getUuid() + Math.random()).slice(0, 16);
  let h = String(clienteHash);
  for (let i = 0; i < 1000; i++) h = _shaUS(sal + ':' + h);
  return 's1$' + sal + '$' + h;
}
function _verificarHash(guardado, clienteHash) {
  guardado = String(guardado || '');
  if (!guardado) return { ok: false, actualizar: false };
  if (guardado.indexOf('s1$') === 0) return { ok: _hashServidor(clienteHash, guardado.split('$')[1]) === guardado, actualizar: false };
  const ok = guardado === String(clienteHash);
  return { ok, actualizar: ok };
}
function _limiteUS(clave, max, seg) {
  const c = CacheService.getScriptCache();
  const k = 'rl_' + _shaUS(clave).slice(0, 40);
  const n = parseInt(c.get(k) || '0', 10);
  if (n >= max) return false;
  c.put(k, String(n + 1), seg);
  return true;
}

function registerUser(params) {
  const email  = (params.email  || '').toLowerCase().trim();
  const nombre = (params.nombre || '').trim();
  const hash   = (params.hash   || '').trim();
  if (!nombre || !email) return { ok: false, error: 'Nombre y email requeridos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      if ((data[i][0] || '').toLowerCase() === email) {
        return { ok: false, error: 'email_taken' };
      }
    }
  }

  if (!hash) return { ok: false, error: 'Faltan datos' };
  const fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
  sheet.appendRow([fecha, email, nombre, _hashServidor(hash)]);
  return { ok: true };
}

function loginUser(params) {
  const email = (params.email || '').toLowerCase().trim();
  const hash  = (params.hash  || '').trim();
  if (!email || !hash) return { ok: false, error: 'Faltan datos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Usuario no encontrado' };

  if (!_limiteUS('login_' + email, 10, 900)) return { ok: false, error: 'Demasiados intentos. Esperá 15 minutos.' };

  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      const v = _verificarHash(data[i][2], hash);
      if (!v.ok) return { ok: false, error: 'Contraseña incorrecta' };
      if (v.actualizar) sheet.getRange(i + 2, 4).setValue(_hashServidor(hash));   // migra el hash viejo
      return { ok: true, nombre: data[i][1], email: data[i][0] };
    }
  }
  return { ok: false, error: 'Usuario no encontrado' };
}

function changePassword(params) {
  const email    = (params.email    || '').toLowerCase().trim();
  const oldHash  = (params.oldHash  || '').trim();
  const newHash  = (params.newHash  || '').trim();
  if (!email || !oldHash || !newHash) return { ok: false, error: 'Faltan datos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Usuario no encontrado' };

  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      if (!_limiteUS('cambio_' + email, 10, 900)) return { ok: false, error: 'Demasiados intentos. Esperá 15 minutos.' };
      if (!_verificarHash(data[i][2], oldHash).ok) return { ok: false, error: 'Contraseña actual incorrecta' };
      sheet.getRange(i + 2, 4).setValue(_hashServidor(newHash));
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuario no encontrado' };
}
