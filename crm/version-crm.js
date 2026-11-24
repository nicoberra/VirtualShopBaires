// ============================================================
//  Versión nueva del CRM — compartido por panel.html y panel-ops.html
//  El CRM queda abierto días enteros (sobre todo instalado en la compu) y no veía los cambios.
//  Cada tanto compara los archivos de esta página con los publicados:
//   - si hay versión nueva y no estás editando nada, al volver a la ventana se actualiza sola;
//   - si estás editando, aparece un cartel para actualizar cuando quieras;
//   - el botón ↻ también la trae.
// ============================================================
(() => {
  const propios = doc => [...doc.querySelectorAll('script[src], link[rel="stylesheet"][href]')]
    .map(e => e.getAttribute('src') || e.getAttribute('href'))
    .filter(u => u && !/^https?:|^\/\//.test(u))
    .sort().join('|');
  const actuales = propios(document);
  let hayNueva = false, revisando = false;

  async function revisar() {
    if (revisando || hayNueva) return;
    revisando = true;
    try {
      const r = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const html = await r.text();
        const nuevos = propios(new DOMParser().parseFromString(html, 'text/html'));
        if (nuevos && nuevos !== actuales) { hayNueva = true; avisar(); }
      }
    } catch (e) { /* sin conexión: se revisa la próxima vez */ }
    revisando = false;
  }

  // Seguro recargar: sin fichas o ventanas abiertas, sin escribir en un campo y sin fotos subiéndose
  function seguro() {
    if (typeof _fotosPendientes === 'function' && _fotosPendientes() > 0) return false;
    const abierta = [...document.querySelectorAll('.modal-backdrop')].some(m => m.style.display === 'flex' || m.classList.contains('show'));
    const a = document.activeElement;
    const escribiendo = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'button' && a.id !== 'ped-search';
    return !abierta && !escribiendo;
  }
  function actualizar() { location.reload(); }

  function avisar() {
    if (document.getElementById('crm-version-nueva')) return;
    const b = document.createElement('div');
    b.id = 'crm-version-nueva';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Hay una versión nueva del CRM</span>' +
      '<button type="button">Actualizar</button>';
    b.querySelector('button').addEventListener('click', actualizar);
    document.body.appendChild(b);
  }

  // El ↻ trae la versión nueva si la hay
  ['refreshCurrent', 'refreshPedidos'].forEach(n => {
    const orig = window[n];
    if (typeof orig === 'function') window[n] = function () { if (hayNueva && seguro()) return actualizar(); return orig.apply(this, arguments); };
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (hayNueva && seguro()) return actualizar();
    revisar();
  });
  window.addEventListener('focus', () => { if (hayNueva && seguro()) actualizar(); });
  setTimeout(revisar, 15000);
  setInterval(() => { if (!document.hidden) revisar(); }, 10 * 60 * 1000);

  const s = document.createElement('style');
  s.textContent = `
    #crm-version-nueva { position: fixed; z-index: 400; left: 50%; top: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
      max-width: calc(100vw - 24px); padding: 10px 10px 10px 16px; border-radius: 14px; background: #111827; color: #fff; font-size: .9rem; font-weight: 600;
      box-shadow: 0 12px 30px rgba(0,0,0,.25); animation: crmVer .35s cubic-bezier(.22,1,.36,1); }
    #crm-version-nueva button { min-height: 40px; padding: 0 16px; border: 0; border-radius: 10px; background: var(--red, #e11d2a); color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    @keyframes crmVer { from { opacity: 0; transform: translate(-50%, -8px); } }
    @media (prefers-reduced-motion: reduce) { #crm-version-nueva { animation: none; } }`;
  document.head.appendChild(s);
})();
