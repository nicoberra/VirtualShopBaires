// ============================================================
//  Ordenar fotos arrastrando — compartido por panel.html y panel-ops.html
//  Compu: se agarra la foto y se mueve. Celular: se mantiene apretada y se mueve
//  (un deslizamiento normal sigue moviendo la pantalla).
//  Solo maneja el gesto: quién guarda y cómo lo decide productos-crm.js.
// ============================================================

const OrdenFotos = (() => {
  const MANTENER = 320;     // ms apretada para levantarla con el dedo
  const TOLERANCIA = 10;    // px que se puede mover el dedo mientras espera
  const EMPEZAR = 6;        // px que hay que mover el mouse para empezar
  const BORDE = 64;         // px desde el borde donde la ficha se desplaza sola
  const CURVA = 'cubic-bezier(.22, 1, .36, 1)';
  const sinMov = matchMedia('(prefers-reduced-motion: reduce)');
  let g = null;             // gesto en curso (uno solo a la vez)

  function contenedorConScroll(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    }
    return null;
  }

  // El clic que el navegador manda al soltar no tiene que tocar un botón ni cerrar la ficha
  function comerClic() {
    const comer = e => { e.preventDefault(); e.stopPropagation(); };
    const fin = () => {
      window.removeEventListener('click', comer, true);
      window.removeEventListener('pointerdown', fin, true);
    };
    window.addEventListener('click', comer, true);
    window.addEventListener('pointerdown', fin, true);
    setTimeout(fin, 350);
  }

  function escuchar(on) {
    const m = on ? 'addEventListener' : 'removeEventListener';
    window[m]('pointermove', mover, { capture: true });
    window[m]('pointerup', soltar, { capture: true });
    window[m]('pointercancel', cancelar, { capture: true });
    window[m]('pointerdown', otroDedo, { capture: true });
    window[m]('keydown', tecla, { capture: true });
    window[m]('blur', cancelar);
  }

  function empezar() {
    const s = g;
    clearTimeout(s.espera);
    if (!s.tile.isConnected || !s.tile.offsetParent) { terminar(false); return; }
    const caja = s.cont.getBoundingClientRect();
    s.tiles = [...s.cont.querySelectorAll('.foto-tile[data-orden]')];
    s.desde = s.hasta = s.tiles.indexOf(s.tile);
    // Los lugares se miden una vez, relativos al bloque: sirven aunque la ficha se desplace
    s.lugares = s.tiles.map(t => {
      const r = t.getBoundingClientRect();
      return { x: r.left - caja.left, y: r.top - caja.top, w: r.width, h: r.height };
    });
    s.agarre = { x: s.x0 - caja.left - s.lugares[s.desde].x, y: s.y0 - caja.top - s.lugares[s.desde].y };
    s.scroll = contenedorConScroll(s.cont);
    s.inicio = { x: s.x, y: s.y };
    s.fase = 'arrastre';
    s.cont.classList.add('ordenando');
    document.documentElement.classList.add('arrastrando-foto');
    s.tile.classList.add('foto-en-mano');
    getSelection()?.removeAllRanges();
    if (s.tactil && navigator.vibrate) navigator.vibrate(15);
    pintar();
    s.cuadro = requestAnimationFrame(desplazar);
  }

  function pintar() {
    const s = g, caja = s.cont.getBoundingClientRect(), l = s.lugares, o = l[s.desde];
    const ys = l.map(a => a.y);
    const x = s.x - caja.left - s.agarre.x;
    // Sin este tope, la foto en la mano estira la ficha y se desplaza sin fin
    const y = Math.max(Math.min(...ys) - 30, Math.min(Math.max(...ys) + 30, s.y - caja.top - s.agarre.y));
    s.tile.style.transform = `translate3d(${x - o.x}px, ${y - o.y}px, 0) scale(1.06)`;

    let cerca = s.hasta, dist = Infinity;
    l.forEach((a, i) => {
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < dist) { dist = d; cerca = i; }
    });
    s.hasta = cerca;
    s.tiles.forEach((t, i) => {
      let j = i;
      if (i === s.desde) j = cerca;
      else if (s.desde < cerca && i > s.desde && i <= cerca) j = i - 1;
      else if (cerca < s.desde && i >= cerca && i < s.desde) j = i + 1;
      t.classList.toggle('va-primera', j === 0);
      if (i !== s.desde) t.style.transform = j === i ? '' : `translate3d(${l[j].x - l[i].x}px, ${l[j].y - l[i].y}px, 0)`;
    });
  }

  // Cerca del borde de la ficha se desplaza sola, para llegar a las fotos que no se ven
  function desplazar() {
    const s = g;
    if (!s || s.fase !== 'arrastre') return;
    if (!s.tile.isConnected || !s.tile.offsetParent) { terminar(false); return; }
    const c = s.scroll;
    if (c && Math.hypot(s.x - s.inicio.x, s.y - s.inicio.y) > 4) {
      const r = c.getBoundingClientRect(), caja = s.cont.getBoundingClientRect();
      const arriba = Math.max(0, r.top), abajo = Math.min(innerHeight, r.bottom);
      const primero = caja.top + s.lugares[0].y, u = s.lugares[s.lugares.length - 1];
      let v = 0;
      if (s.y < arriba + BORDE && primero < arriba + 12) v = -Math.min(1, (arriba + BORDE - s.y) / BORDE);
      else if (s.y > abajo - BORDE && caja.top + u.y + u.h > abajo - 12) v = Math.min(1, (s.y - (abajo - BORDE)) / BORDE);
      if (v) { c.scrollTop += Math.sign(v) * Math.ceil(Math.abs(v) * 14); pintar(); }
    }
    s.cuadro = requestAnimationFrame(desplazar);
  }

  function mover(e) {
    if (!g || e.pointerId !== g.id) return;
    if (g.fase === 'soltando') return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.tactil && e.buttons === 0) { soltar(e); return; }   // soltó afuera de la ventana
    if (g.fase === 'espera') {
      const d = Math.hypot(g.x - g.x0, g.y - g.y0);
      if (g.tactil) { if (d > TOLERANCIA) terminar(false); return; }   // es scroll
      if (d < EMPEZAR) return;
      empezar();
      if (!g) return;
    }
    e.preventDefault();
    pintar();
  }

  function soltar(e) {
    if (!g || e.pointerId !== g.id || g.fase === 'soltando') return;
    if (g.fase === 'espera') { terminar(false); return; }
    comerClic();
    const s = g, a = s.lugares[s.desde], b = s.lugares[s.hasta];
    s.fase = 'soltando';
    cancelAnimationFrame(s.cuadro);
    const ms = sinMov.matches ? 0 : 180;
    s.tile.style.transition = ms ? `transform ${ms}ms ${CURVA}` : 'none';
    s.tile.style.transform = `translate3d(${b.x - a.x}px, ${b.y - a.y}px, 0)`;
    s.fin = setTimeout(() => terminar(true), ms);
  }

  function cancelar(e) {
    if (!g || g.fase === 'soltando') return;
    if (e && e.pointerId !== undefined && e.pointerId !== g.id) return;
    terminar(false);
  }

  function otroDedo(e) {
    if (g && g.fase !== 'soltando' && e.pointerId !== g.id) terminar(false);
  }

  function tecla(e) {
    if (!g || g.fase !== 'arrastre' || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    // El botón sigue apretado: el clic a comer es el que llega cuando lo suelte
    window.addEventListener('pointerup', comerClic, { capture: true, once: true });
    terminar(false);
  }

  function terminar(confirma) {
    const s = g;
    if (!s) return;
    g = null;
    clearTimeout(s.espera); clearTimeout(s.fin); cancelAnimationFrame(s.cuadro);
    escuchar(false);
    if (s.fase === 'espera') return;
    document.documentElement.classList.remove('arrastrando-foto');
    s.cont.classList.remove('ordenando');
    s.tiles.forEach(t => { t.classList.remove('foto-en-mano', 'va-primera'); t.style.transform = t.style.transition = ''; });
    const cambio = confirma && s.cont.isConnected && s.hasta !== s.desde;
    if (cambio) s.op.alOrdenar(s.desde, s.hasta);
    // Si la galería se tenía que redibujar mientras la foto estaba en la mano, se hace ahora
    else if (s.redibujar) s.redibujar();
  }

  function activar(cont, op) {
    const fotos = cont.querySelectorAll('.foto-tile[data-orden]');
    if (fotos.length < 2) return;
    cont.classList.add('se-ordena');
    cont.addEventListener('pointerdown', e => {
      const tile = e.target.closest('.foto-tile[data-orden]');
      if (g || !tile || !e.isPrimary || e.button !== 0 || e.target.closest('button, label, a')) return;
      g = { cont, op, tile, id: e.pointerId, tactil: e.pointerType === 'touch', fase: 'espera',
            x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      escuchar(true);
      if (g.tactil) g.espera = setTimeout(empezar, MANTENER);
      else e.preventDefault();   // sin seleccionar texto
    });
    // Tiene que existir antes de apoyar el dedo: si no, iOS ya no deja frenar el scroll
    cont.addEventListener('touchmove', e => {
      if (g && g.fase !== 'espera' && e.cancelable) e.preventDefault();
    }, { passive: false });
    cont.addEventListener('contextmenu', e => {
      // Al mantener apretado, el celular abre "guardar imagen"
      if ((e.pointerType === 'touch' || (g && g.tactil)) && e.target.closest('.foto-tile[data-orden]')) e.preventDefault();
    });
  }

  // true = hay una foto en la mano dentro de "zona": el redibujado queda para cuando la suelte
  function postergar(zona, misma, redibujar) {
    if (!g || g.fase === 'espera' || !zona.contains(g.cont)) return false;
    if (g.op.clave !== misma) { terminar(false); return false; }   // se abrió otra ficha
    g.redibujar = redibujar;
    return true;
  }

  return { activar, postergar };
})();
