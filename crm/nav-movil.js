// ============================================================
//  CRM · Menú inferior del celular
//  Mueve los botones del menú a una barra flotante abajo y dibuja
//  una "píldora" roja que se desliza hasta la sección activa.
//  Lo comparten panel.html y panel-ops.html (no toca la lógica de goTo).
// ============================================================
(function () {
  const barra = document.getElementById('mobile-nav-scroll');
  if (!barra) return;

  // Fuera del encabezado fijo, así se ubica respecto de la pantalla
  document.body.appendChild(barra);
  barra.classList.add('mnav-abajo');
  barra.setAttribute('role', 'navigation');
  barra.setAttribute('aria-label', 'Secciones');

  const pildora = document.createElement('span');
  pildora.className = 'mnav-pildora';
  pildora.setAttribute('aria-hidden', 'true');
  barra.prepend(pildora);

  let primera = true;
  function ubicar() {
    const activo = barra.querySelector('.mnav-btn.active');
    barra.querySelectorAll('.mnav-btn').forEach(b => b.setAttribute('aria-current', b === activo ? 'page' : 'false'));
    if (!activo || !barra.offsetWidth) { pildora.style.opacity = '0'; return; }
    if (primera) pildora.style.transition = 'none';   // al abrir, sin deslizarse desde la izquierda
    pildora.style.opacity = '1';
    pildora.style.width = activo.offsetWidth + 'px';
    pildora.style.transform = `translateX(${activo.offsetLeft}px)`;
    if (primera) { pildora.offsetWidth; pildora.style.transition = ''; primera = false; }
  }

  // goTo() cambia la clase "active" de los botones: con eso alcanza para mover la píldora
  new MutationObserver(ubicar).observe(barra, { subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', ubicar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(ubicar);
  ubicar();
})();
