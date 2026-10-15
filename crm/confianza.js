// ============================================================
//  CRM · Dispositivo de confianza
//  Desde el 3er ingreso correcto en este navegador, el servidor entrega una llave
//  aleatoria (nunca se guarda la contraseña) y la próxima vez se entra directo.
//  "Salir" la borra. Si cambia PANEL_PASS o pasan 60 días sin uso, deja de valer.
// ============================================================
(function () {
  const LLAVE = 'vsb_crm_dispositivo', CUENTA = 'vsb_crm_ingresos', INGRESOS_PARA_CONFIAR = 3;
  const leer = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const borrar = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const navegador = () => {
    const ua = navigator.userAgent;
    const so = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Otro';
    const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Navegador';
    return br + ' en ' + so;
  };

  window.confianza = {
    // Datos extra para mandar junto con la contraseña: la llave de este navegador (así
    // nunca lo bloquean los intentos de otros) o el pedido de una llave nueva
    paramsLogin() {
      const llave = leer(LLAVE);
      return llave ? { dispositivo: llave } : { confiar: '1', navegador: navegador() };
    },
    // Después de un ingreso correcto con contraseña
    ingresoOk(data) {
      escribir(CUENTA, String((Number(leer(CUENTA)) || 0) + 1));
      if (data && /^[a-f0-9]{64}$/.test(String(data.dispositivo || ''))) escribir(LLAVE, data.dispositivo);
    },
    // Al abrir el CRM: si este navegador es de confianza, entra sin pedir la clave
    async entrarDirecto(guardarSesion, entrar) {
      const llave = leer(LLAVE);
      if (!llave || (Number(leer(CUENTA)) || 0) < INGRESOS_PARA_CONFIAR) return false;
      const glass = window.loginGlass;
      const sub = document.getElementById('login-sub');
      if (sub) sub.textContent = 'Dispositivo de confianza: entrando…';
      if (glass) glass.cargando(true);
      try {
        const r = await crm({ action: 'loginDispositivo', dispositivo: llave });
        if (r && r.ok && r.token) {
          guardarSesion(r.token);
          if (glass) glass.exito(entrar); else entrar();
          return true;
        }
        if (r && r.error === 'dispositivo') borrar(LLAVE);   // venció o cambió la clave
      } catch (e) { /* sin conexión: queda el ingreso normal */ }
      if (glass) glass.reiniciar();
      return false;
    },
    // "Salir": este navegador deja de ser de confianza
    async olvidar() {
      const llave = leer(LLAVE);
      borrar(LLAVE);
      borrar(CUENTA);
      if (llave) { try { await crm({ action: 'olvidarDispositivo', dispositivo: llave }); } catch (e) {} }
    },
  };
})();
