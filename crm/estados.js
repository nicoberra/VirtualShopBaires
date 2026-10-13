// ============================================================
//  CRM · Estados de la interfaz (cargando / vacío / error)
//  Mismo aspecto en todas las secciones del CRM y de Operaciones.
// ============================================================
function _uiEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Silueta de la lista mientras carga (en vez de "Cargando…")
function uiCargando(filas = 5, conFoto = false) {
  const fila = `<div class="sk-fila">${conFoto ? '<span class="crm-skeleton sk-foto"></span>' : ''}
    <span class="sk-txt"><span class="crm-skeleton sk-l1"></span><span class="crm-skeleton sk-l2"></span></span>
    <span class="crm-skeleton sk-pill"></span></div>`;
  return `<div class="sk-lista" role="status" aria-label="Cargando">${fila.repeat(filas)}</div>`;
}

// Vacío: ícono + qué va acá + botón con lo siguiente que conviene hacer
function uiVacio(icono, titulo, texto, boton) {
  return `<div class="empty-state">
    <i class="fa-solid ${icono}" aria-hidden="true"></i>
    <strong class="empty-tit">${_uiEsc(titulo)}</strong>
    ${texto ? `<span class="empty-txt">${_uiEsc(texto)}</span>` : ''}
    ${boton ? `<button type="button" class="btn-secondary btn-sm empty-btn" onclick="${boton.onclick}">${boton.icono ? `<i class="fa-solid ${boton.icono}"></i> ` : ''}${_uiEsc(boton.texto)}</button>` : ''}
  </div>`;
}

// Error: mensaje claro + Reintentar (solo afecta a esa sección)
function uiError(mensaje, reintentar) {
  const msg = /timeout/i.test(String(mensaje)) ? 'El servidor tardó demasiado en responder.'
            : /failed to fetch|network|load/i.test(String(mensaje)) ? 'Revisá tu conexión a internet.'
            : String(mensaje || 'Ocurrió un error inesperado.');
  return `<div class="estado-error" role="alert">
    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
    <strong class="empty-tit">No se pudo cargar</strong>
    <span class="empty-txt">${_uiEsc(msg)}</span>
    ${reintentar ? `<button type="button" class="btn-secondary btn-sm empty-btn" onclick="${reintentar}"><i class="fa-solid fa-rotate-right"></i> Reintentar</button>` : ''}
  </div>`;
}

// Una respuesta {ok:false} del servidor es un error, no una lista vacía
function sinError(res) {
  if (res && res.ok === false) throw new Error(res.error || 'El servidor respondió con un error');
  return res;
}
