// ============================================================
//  Notificaciones de ventas — CRM y Operaciones
//  Se activan por dispositivo (celular o compu) con un toque.
// ============================================================
(function () {
  const PANEL = location.pathname.includes('panel-ops') ? 'ops' : 'crm';
  const OCULTO = 'vsb_push_aviso_oculto';
  const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function navegador() {
    const ua = navigator.userAgent;
    const n = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' :
              /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    const so = /Android/.test(ua) ? 'Android' : esIOS ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : '';
    return n + (so ? ' en ' + so : '') + (instalada ? ' (app)' : '');
  }
  function claveBytes(b64) {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64.length % 4) % 4));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  function aviso(msg, tipo) { if (typeof toast === 'function') toast(msg, tipo); else alert(msg); }
  async function suscripcion() {
    const reg = await navigator.serviceWorker.ready;
    return { reg, sub: await reg.pushManager.getSubscription() };
  }
  // El servidor entrega un secreto por dispositivo; el service worker lo usa para pedir el detalle
  async function guardar(sub) {
    const g = await crm({ action: 'push_suscribir', endpoint: sub.endpoint, panel: PANEL, navegador: navegador() });
    if (g && g.ok && g.secreto) await (await caches.open('vsb-push-estado')).put('/secreto', new Response(g.secreto));
    return g;
  }
  async function bajaDispositivo() {
    const { sub } = await suscripcion();
    if (sub) { await crm({ action: 'push_desuscribir', endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    try { await (await caches.open('vsb-push-estado')).delete('/secreto'); } catch (e) {}
  }

  async function activar() {
    if (!soporta) {
      aviso(esIOS && !instalada
        ? 'En iPhone primero instalá el CRM: Compartir → "Agregar a inicio", y abrilo desde ese ícono.'
        : 'Este navegador no permite notificaciones. Usá Chrome.', 'err');
      return;
    }
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      aviso('Las notificaciones están bloqueadas. Habilitalas en el candado de la barra de direcciones (o en Ajustes del celular) y volvé a tocar el botón.', 'err');
      pintar(); return;
    }
    try {
      let { reg, sub } = await suscripcion();
      if (!sub) {
        const r = await crm({ action: 'push_clave' });
        if (!r || !r.ok) throw new Error('clave');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(r.clave) });
      }
      const g = await guardar(sub);
      if (!g || !g.ok) throw new Error((g && g.error) || 'servidor');
      await crm({ action: 'push_probar' });
      aviso('Listo: te va a llegar una notificación de prueba en unos segundos.');
    } catch (e) {
      aviso('No se pudieron activar las notificaciones. Probá de nuevo en un rato.', 'err');
    }
    pintar();
  }

  async function desactivar() {
    try {
      await bajaDispositivo();
      aviso('Notificaciones desactivadas en este dispositivo.');
    } catch (e) { aviso('No se pudo desactivar. Probá de nuevo.', 'err'); }
    pintar();
  }

  // Botón en el menú lateral + aviso arriba (se ve en celular y compu)
  function crearUI() {
    const pie = document.querySelector('#sidebar .sidebar-footer');
    if (pie && !document.getElementById('btn-push')) {
      const b = document.createElement('button');
      b.id = 'btn-push'; b.type = 'button'; b.className = 'btn-logout btn-push';
      b.addEventListener('click', () => b.dataset.activo === '1' ? desactivar() : activar());
      pie.insertBefore(b, pie.firstChild);
    }
    if (!document.getElementById('push-aviso')) {
      const d = document.createElement('div');
      d.id = 'push-aviso'; d.className = 'push-aviso'; d.hidden = true; d.setAttribute('role', 'status');
      d.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i>' +
        '<span>Activá las notificaciones para enterarte de cada venta en este dispositivo.</span>' +
        '<button type="button" class="push-si">Activar</button>' +
        '<button type="button" class="push-no" aria-label="Ahora no"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
      d.querySelector('.push-si').addEventListener('click', activar);
      d.querySelector('.push-no').addEventListener('click', () => { try { localStorage.setItem(OCULTO, String(Date.now())); } catch (e) {} d.hidden = true; });
      document.body.appendChild(d);
    }
  }

  async function pintar() {
    const b = document.getElementById('btn-push'), d = document.getElementById('push-aviso');
    let activo = false;
    if (soporta && Notification.permission === 'granted') { try { activo = !!(await suscripcion()).sub; } catch (e) {} }
    if (b) {
      b.dataset.activo = activo ? '1' : '0';
      b.innerHTML = activo ? '<i class="fa-solid fa-bell" aria-hidden="true"></i> Notificaciones: sí'
                           : '<i class="fa-solid fa-bell-slash" aria-hidden="true"></i> Activar notificaciones';
      b.title = activo ? 'Tocá para dejar de recibir avisos de ventas en este dispositivo' : 'Recibir un aviso por cada venta';
    }
    if (d) {
      let oculto = 0; try { oculto = Number(localStorage.getItem(OCULTO)) || 0; } catch (e) {}
      const bloqueado = soporta && Notification.permission === 'denied';
      d.hidden = activo || bloqueado || (Date.now() - oculto < 7 * 86400000) || (!soporta && !(esIOS && !instalada));
    }
  }

  // Cada vez que se entra, se renueva la suscripción en el servidor (por si cambió)
  async function sincronizar() {
    if (!soporta || Notification.permission !== 'granted') return;
    try { const { sub } = await suscripcion(); if (sub) guardar(sub).catch(() => {}); } catch (e) {}
  }

  // "Salir" también corta las notificaciones de este dispositivo (máx. 4 s de espera)
  function envolverSalir() {
    const salir = window.logout;
    if (typeof salir !== 'function' || salir._push) return;
    window.logout = async function () {
      if (soporta) await Promise.race([bajaDispositivo().catch(() => {}), new Promise(r => setTimeout(r, 4000))]);
      return salir.apply(this, arguments);
    };
    window.logout._push = true;
  }

  let listo = false;
  function alEntrar() {
    if (listo) return;
    const app = document.getElementById('app');
    if (!app || app.style.display === 'none' || !sessionStorage.getItem('crm_token')) return;
    listo = true;
    envolverSalir(); crearUI(); pintar(); sincronizar();
  }
  const obs = new MutationObserver(alEntrar);
  window.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    if (app) obs.observe(app, { attributes: true, attributeFilter: ['style'] });
    alEntrar();
  });
})();
