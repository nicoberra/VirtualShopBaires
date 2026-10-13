// ============================================================
//  CRM · Ingreso "de vidrio"
//  Un solo campo de contraseña real (cualquier largo: no se baja la seguridad);
//  encima se dibuja una casilla por carácter con su animación. Al validar:
//  las casillas se juntan en un ✓ y la tarjeta pasa a verde; si falla, tiembla
//  en rojo y se limpia. Lo usan panel.html y panel-ops.html.
// ============================================================
(function () {
  const input = document.getElementById('login-pass');
  const card  = document.getElementById('login-box');
  if (!input || !card) return;
  const campo = input.closest('.glass-field');
  const fila  = campo.querySelector('.glass-boxes');
  const tit   = document.getElementById('login-tit');
  const sub   = document.getElementById('login-sub');
  const TXT   = { tit: tit.textContent, sub: sub.textContent };
  const MAX = 16, MIN = 6;
  const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ocupado = false;

  function pintar() {
    const n = Math.min(input.value.length, MAX);
    const total = Math.min(Math.max(n + 1, MIN), MAX);
    while (fila.children.length < total) {
      const c = document.createElement('span');
      c.className = 'glass-box';
      fila.appendChild(c);
    }
    while (fila.children.length > total) fila.lastElementChild.remove();
    const foco = document.activeElement === input && !ocupado;
    [...fila.children].forEach((c, i) => {
      const lleno = i < n;
      c.classList.toggle('activo', foco && i === Math.min(n, MAX - 1));
      if (lleno && !c.classList.contains('lleno')) {
        c.classList.add('lleno');
        c.innerHTML = '<i></i>';            // el punto entra con su "pop"
      } else if (!lleno && c.classList.contains('lleno')) {
        c.classList.remove('lleno');
        c.innerHTML = '';
      }
    });
  }

  function reiniciar() {
    ocupado = false;
    card.classList.remove('ok', 'mal', 'crm-shake');
    campo.classList.remove('ok', 'mal', 'cargando');
    tit.textContent = TXT.tit;
    sub.textContent = TXT.sub;
    input.value = '';
    [...fila.children].forEach(c => c.style.removeProperty('--dx'));
    pintar();
  }

  input.addEventListener('input', pintar);
  input.addEventListener('focus', pintar);
  input.addEventListener('blur', pintar);

  window.loginGlass = {
    cargando(si) {
      ocupado = !!si;
      campo.classList.toggle('cargando', ocupado);
      pintar();
    },
    // Correcto: las casillas se juntan en el centro, aparece el ✓ y recién ahí se entra
    exito(entrar) {
      ocupado = true;
      const centro = fila.getBoundingClientRect();
      const mitad = centro.left + centro.width / 2;
      [...fila.children].forEach(c => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--dx', (mitad - (r.left + r.width / 2)) + 'px');
      });
      campo.classList.remove('cargando');
      campo.classList.add('ok');
      card.classList.add('ok');
      tit.textContent = 'Verificado correctamente';
      sub.textContent = 'Entrando al panel…';
      setTimeout(() => { entrar(); setTimeout(reiniciar, 400); }, sinMovimiento() ? 250 : 1100);
    },
    // Incorrecto o bloqueado: tiembla en rojo y se limpia para volver a escribir
    error() {
      ocupado = false;
      campo.classList.remove('cargando');
      campo.classList.add('mal');
      card.classList.add('mal');
      card.classList.remove('crm-shake');
      void card.offsetWidth;
      card.classList.add('crm-shake');
      setTimeout(() => {
        input.value = '';
        campo.classList.remove('mal');
        card.classList.remove('mal');
        pintar();
        input.focus();
      }, sinMovimiento() ? 300 : 650);
    },
    reiniciar,
  };
  pintar();
})();
