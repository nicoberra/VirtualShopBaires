// ============================================================
//  Cuenta del cliente: entrar, crear cuenta, confirmar el email con un código y recuperar la contraseña.
//  Lo usan mi-cuenta.html, mis-compras.html y order-status.html.
//  La sesión (token firmado por el servidor) se guarda en localStorage "vsb_user".
// ============================================================
const VsbCuenta = (() => {
  const API = "https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  function sesion() {
    try { const u = JSON.parse(localStorage.getItem("vsb_user") || "null"); return u && u.token ? u : null; } catch (e) { return null; }
  }
  function guardar(d) {
    const u = { nombre: d.nombre || "", email: d.email || "", token: d.token };
    try { localStorage.setItem("vsb_user", JSON.stringify(u)); } catch (e) {}
    return u;
  }
  function salir() { try { localStorage.removeItem("vsb_user"); } catch (e) {} }

  async function api(datos) {
    const r = await fetch(API, { method: "POST", body: JSON.stringify(datos), redirect: "follow" });
    return r.json();
  }
  // Mismo hash que ya usaba la tienda: el servidor le agrega sal e iteraciones
  async function hash(pass, email) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase().trim() + ":" + pass));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function estilos() {
    if (document.getElementById("vc-estilos")) return;
    const s = document.createElement("style");
    s.id = "vc-estilos";
    s.textContent = `
      .vc-card { background: var(--black-3); border-radius: var(--radius); padding: 26px; box-shadow: var(--shadow); text-align: left; }
      .vc-card h2 { font-size: 1.05rem; font-weight: 700; color: var(--white); margin: 0 0 6px; display: flex; align-items: center; gap: 10px; }
      .vc-card h2 i { color: var(--red); }
      .vc-sub { font-size: .86rem; color: var(--gray); margin: 0 0 16px; line-height: 1.45; }
      .vc-campos { display: flex; flex-direction: column; gap: 10px; }
      .vc-campos label { font-size: .8rem; font-weight: 600; color: var(--gray); margin-bottom: -4px; }
      .vc-campos input { padding: 12px 14px; min-height: 46px; border: 1.5px solid var(--black-2); border-radius: 8px; font-size: 1rem; background: var(--black); color: var(--white); box-sizing: border-box; width: 100%; }
      .vc-campos input:focus { outline: none; border-color: var(--red); }
      .vc-codigo { letter-spacing: .5em; text-align: center; font-size: 1.4rem !important; font-weight: 700; }
      .vc-btn { width: 100%; min-height: 46px; padding: 12px; background: var(--red); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: .95rem; cursor: pointer; margin-top: 6px; touch-action: manipulation; }
      .vc-btn:disabled { opacity: .6; cursor: progress; }
      .vc-links { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 14px; }
      .vc-link { background: none; border: 0; padding: 8px 0; min-height: 40px; color: var(--red); font: inherit; font-size: .86rem; font-weight: 600; cursor: pointer; }
      .vc-msg { font-size: .85rem; margin: 10px 0 0; line-height: 1.4; }
      .vc-msg.err { color: var(--red); }
      .vc-msg.ok { color: #4caf88; }
      .vc-trampa { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    `;
    document.head.appendChild(s);
  }

  // Formulario completo dentro de "el". op: { titulo, subtitulo, alEntrar(usuario), modo }
  function formulario(el, op = {}) {
    estilos();
    let modo = op.modo || "entrar", email = op.email || "";

    const pintar = (msg, tipo) => {
      const nota = msg ? `<p class="vc-msg ${tipo || "err"}" role="${tipo === "ok" ? "status" : "alert"}">${esc(msg)}</p>` : "";
      const trampa = '<input class="vc-trampa" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">';
      let h = "";
      if (modo === "entrar") h = `
        <h2><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i>${esc(op.titulo || "Iniciá sesión")}</h2>
        ${op.subtitulo ? `<p class="vc-sub">${esc(op.subtitulo)}</p>` : ""}
        <form class="vc-campos" data-f="entrar" novalidate>${trampa}
          <label for="vc-email">Email</label><input id="vc-email" type="email" autocomplete="email" required value="${esc(email)}">
          <label for="vc-pass">Contraseña</label><input id="vc-pass" type="password" autocomplete="current-password" required>
          <button class="vc-btn" type="submit">Ingresar</button>
        </form>${nota}
        <div class="vc-links"><button type="button" class="vc-link" data-ir="crear">Crear cuenta</button><button type="button" class="vc-link" data-ir="olvide">¿Olvidaste tu contraseña?</button></div>`;
      else if (modo === "crear") h = `
        <h2><i class="fa-solid fa-user-plus" aria-hidden="true"></i>Crear cuenta</h2>
        <p class="vc-sub">Si ya compraste, usá el mismo email de la compra: vas a ver todos tus pedidos.</p>
        <form class="vc-campos" data-f="crear" novalidate>${trampa}
          <label for="vc-nombre">Nombre</label><input id="vc-nombre" autocomplete="name" required>
          <label for="vc-email">Email</label><input id="vc-email" type="email" autocomplete="email" required value="${esc(email)}">
          <label for="vc-pass">Contraseña (mínimo 6 caracteres)</label><input id="vc-pass" type="password" autocomplete="new-password" required minlength="6">
          <label for="vc-pass2">Repetí la contraseña</label><input id="vc-pass2" type="password" autocomplete="new-password" required>
          <button class="vc-btn" type="submit">Crear cuenta</button>
        </form>${nota}
        <div class="vc-links"><button type="button" class="vc-link" data-ir="entrar">Ya tengo cuenta</button></div>`;
      else if (modo === "codigo") h = `
        <h2><i class="fa-solid fa-envelope-circle-check" aria-hidden="true"></i>Confirmá tu email</h2>
        <p class="vc-sub">Te mandamos un código de 6 números a <b>${esc(email)}</b>. Si no lo ves, revisá el correo no deseado.</p>
        <form class="vc-campos" data-f="codigo" novalidate>
          <label for="vc-codigo">Código</label><input id="vc-codigo" class="vc-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
          <button class="vc-btn" type="submit">Confirmar</button>
        </form>${nota}
        <div class="vc-links"><button type="button" class="vc-link" data-reenviar>Mandarme otro código</button><button type="button" class="vc-link" data-ir="entrar">Volver</button></div>`;
      else if (modo === "olvide") h = `
        <h2><i class="fa-solid fa-key" aria-hidden="true"></i>Recuperar contraseña</h2>
        <p class="vc-sub">Te mandamos un código al email de tu cuenta para que elijas una contraseña nueva.</p>
        <form class="vc-campos" data-f="olvide" novalidate>${trampa}
          <label for="vc-email">Email</label><input id="vc-email" type="email" autocomplete="email" required value="${esc(email)}">
          <button class="vc-btn" type="submit">Mandarme el código</button>
        </form>${nota}
        <div class="vc-links"><button type="button" class="vc-link" data-ir="entrar">Volver</button></div>`;
      else if (modo === "nueva") h = `
        <h2><i class="fa-solid fa-key" aria-hidden="true"></i>Elegí una contraseña nueva</h2>
        <p class="vc-sub">Si hay una cuenta con <b>${esc(email)}</b>, te mandamos un código. Revisá también el correo no deseado.</p>
        <form class="vc-campos" data-f="nueva" novalidate>
          <label for="vc-codigo">Código</label><input id="vc-codigo" class="vc-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
          <label for="vc-pass">Contraseña nueva (mínimo 6 caracteres)</label><input id="vc-pass" type="password" autocomplete="new-password" required>
          <label for="vc-pass2">Repetí la contraseña</label><input id="vc-pass2" type="password" autocomplete="new-password" required>
          <button class="vc-btn" type="submit">Guardar y entrar</button>
        </form>${nota}
        <div class="vc-links"><button type="button" class="vc-link" data-ir="olvide">Mandarme otro código</button><button type="button" class="vc-link" data-ir="entrar">Volver</button></div>`;
      el.innerHTML = `<div class="vc-card">${h}</div>`;
      el.querySelectorAll("[data-ir]").forEach(b => b.addEventListener("click", () => { const e = el.querySelector("#vc-email"); if (e) email = e.value.trim(); modo = b.dataset.ir; pintar(); }));
      const re = el.querySelector("[data-reenviar]");
      if (re) re.addEventListener("click", () => enviar("reenviar"));
      const f = el.querySelector("form");
      if (f) f.addEventListener("submit", e => { e.preventDefault(); enviar(f.dataset.f); });
      const primero = [...el.querySelectorAll("input:not(.vc-trampa)")].find(i => !i.value);
      if (primero && op.foco !== false) setTimeout(() => primero.focus({ preventScroll: true }), 30);
    };

    const valor = id => (el.querySelector("#" + id) || {}).value || "";
    const entro = d => { const u = guardar(d); if (op.alEntrar) op.alEntrar(u); };

    async function enviar(f) {
      const btn = el.querySelector(".vc-btn");
      const ocupado = t => { if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = t; } };
      const libre = () => { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.txt || btn.textContent; } };
      const website = valor("vc-trampa") || ((el.querySelector(".vc-trampa") || {}).value || "");
      try {
        if (f === "entrar") {
          email = valor("vc-email").trim(); const pass = valor("vc-pass");
          if (!emailOk(email) || !pass) return pintar("Completá tu email y tu contraseña.");
          ocupado("Ingresando…");
          const d = await api({ action: "loginUser", email, hash: await hash(pass, email), website });
          if (d.ok && d.token) return entro(d);
          if (d.ok && d.verificar) { modo = "codigo"; return pintar(d.aviso || "", d.aviso ? "err" : "ok"); }
          libre();
          return pintar(d.error === "Usuario no encontrado" ? "No encontramos una cuenta con ese email. Podés crearla." : (d.error || "No pudimos entrar."));
        }
        if (f === "crear") {
          const nombre = valor("vc-nombre").trim(); email = valor("vc-email").trim();
          const pass = valor("vc-pass"), pass2 = valor("vc-pass2");
          if (!nombre) return pintar("Escribí tu nombre.");
          if (!emailOk(email)) return pintar("Revisá el email.");
          if (pass.length < 6) return pintar("La contraseña tiene que tener al menos 6 caracteres.");
          if (pass !== pass2) return pintar("Las contraseñas no coinciden.");
          ocupado("Creando…");
          const d = await api({ action: "registerUser", nombre, email, hash: await hash(pass, email), website });
          if (d.ok) { modo = "codigo"; return pintar(d.aviso || "", d.aviso ? "err" : "ok"); }
          libre();
          if (d.error === "email_taken") { modo = "entrar"; return pintar("Ya hay una cuenta con ese email. Entrá con tu contraseña o recuperala."); }
          return pintar(d.error || "No pudimos crear la cuenta.");
        }
        if (f === "codigo") {
          const codigo = valor("vc-codigo").replace(/\D/g, "");
          if (codigo.length !== 6) return pintar("El código tiene 6 números.");
          ocupado("Confirmando…");
          const d = await api({ action: "verifyEmail", email, codigo });
          if (d.ok && d.token) return entro(d);
          libre(); return pintar(d.error || "No pudimos confirmar el código.");
        }
        if (f === "reenviar") {
          const d = await api({ action: "forgotPassword", email });
          return pintar(d.ok ? "Te mandamos un código nuevo." : (d.error || "No pudimos mandar el código."), d.ok ? "ok" : "err");
        }
        if (f === "olvide") {
          email = valor("vc-email").trim();
          if (!emailOk(email)) return pintar("Revisá el email.");
          ocupado("Enviando…");
          const d = await api({ action: "forgotPassword", email, website });
          if (d.ok) { modo = "nueva"; return pintar(); }
          libre(); return pintar(d.error || "No pudimos mandar el código.");
        }
        if (f === "nueva") {
          const codigo = valor("vc-codigo").replace(/\D/g, ""), pass = valor("vc-pass"), pass2 = valor("vc-pass2");
          if (codigo.length !== 6) return pintar("El código tiene 6 números.");
          if (pass.length < 6) return pintar("La contraseña tiene que tener al menos 6 caracteres.");
          if (pass !== pass2) return pintar("Las contraseñas no coinciden.");
          ocupado("Guardando…");
          const d = await api({ action: "resetPassword", email, codigo, hash: await hash(pass, email) });
          if (d.ok && d.token) return entro(d);
          libre(); return pintar(d.error || "No pudimos cambiar la contraseña.");
        }
      } catch (e) {
        libre(); pintar("Error de conexión. Revisá tu internet e intentá de nuevo.");
      }
    }
    pintar();
  }

  return { sesion, guardar, salir, api, hash, formulario, esc };
})();
