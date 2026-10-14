// Botón volver arriba
window.addEventListener("scroll", () => {
  const btn = document.getElementById("back-to-top");
  if (btn) btn.classList.toggle("visible", window.scrollY > 300);
}, { passive: true });

// Mobile: celular único que desliza de derecha a izquierda + swipe manual
(function () {
  if (window.innerWidth > 480) return;
  const frames = Array.from(document.querySelectorAll('.hero-phone-frame'));
  if (!frames.length) return;
  const heroGrid = document.getElementById('hero-video-grid');
  let idx = 0;
  let busy = false;

  function playVideo(vid) {
    if (!vid) return;
    vid.load();
    vid.currentTime = 0;
    vid.play().catch(() => {});
  }

  function goTo(newIdx) {
    if (busy) return;
    busy = true;
    if (heroGrid) heroGrid.classList.add('mobile-init-done');
    const oldIdx = idx;
    idx = (newIdx + frames.length) % frames.length;
    const outFrame = frames[oldIdx];
    const inFrame  = frames[idx];
    playVideo(inFrame.querySelector('video'));
    outFrame.classList.remove('mobile-active');
    outFrame.classList.add('mobile-exit');
    inFrame.classList.add('mobile-active');
    setTimeout(() => {
      outFrame.classList.remove('mobile-exit');
      busy = false;
    }, 560);
  }

  function advance() { goTo(idx + 1); }

  // El primer frame ya está visible por CSS (:not(.mobile-init-done) :first-child)
  playVideo(frames[0].querySelector('video'));

  // Auto-avance
  let autoTimer = null;
  function resetAuto() {
    clearInterval(autoTimer);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      autoTimer = setInterval(advance, 4500);
    }
  }
  resetAuto();

  // Swipe horizontal para cambiar el celular manualmente
  let swipeStartX = null;
  const swipeTarget = heroGrid || document.querySelector('.hero-video-grid') || frames[0].parentElement;

  swipeTarget.addEventListener('touchstart', function(e) {
    swipeStartX = e.touches[0].clientX;
  }, { passive: true });

  swipeTarget.addEventListener('touchend', function(e) {
    if (swipeStartX === null) return;
    const diff = swipeStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      goTo(diff > 0 ? idx + 1 : idx - 1);
      resetAuto();
    }
    swipeStartX = null;
  }, { passive: true });
})();

// Header: se oculta al bajar, reaparece al subir
(function () {
  const header = document.querySelector("header");
  if (!header) return;
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > lastY && y > 90) {
      header.classList.add("header--hidden");
    } else {
      header.classList.remove("header--hidden");
    }
    lastY = y;
  }, { passive: true });
})();

// Hamburger → dropdown nav
document.addEventListener("DOMContentLoaded", () => {
  const hamburger = document.getElementById("hamburger");
  const dropdownNav = document.getElementById("header-dropdown-nav");

  if (hamburger && dropdownNav) {
    function setMenuOpen(open) {
      dropdownNav.classList.toggle("open", open);
      hamburger.classList.toggle("open", open);
      hamburger.setAttribute("aria-expanded", open ? "true" : "false");
      dropdownNav.setAttribute("aria-hidden", open ? "false" : "true");
    }

    hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      setMenuOpen(!dropdownNav.classList.contains("open"));
    });

    // Cerrar al hacer click fuera
    document.addEventListener("click", (e) => {
      if (!dropdownNav.contains(e.target) && !hamburger.contains(e.target)) {
        setMenuOpen(false);
      }
    });

    // Cerrar con Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dropdownNav.classList.contains("open")) {
        setMenuOpen(false);
        hamburger.focus();
      }
    });

    // Cerrar al elegir un ítem
    dropdownNav.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => setMenuOpen(false));
    });
  }

  // Buscador
  const searchForm = document.getElementById("search-form");
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      if (q) window.location.href = `productos.html?buscar=${encodeURIComponent(q)}`;
    });
  }

  // Año dinámico copyright
  document.querySelectorAll(".copyright-year").forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // Animación de conteo para métricas ML
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const counters = document.querySelectorAll(".ml-stat-num[data-target]");
    if (!counters.length) return;

    function fmtNum(n, target) {
      const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return s + (target >= n ? "" : "");
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.target, 10);
        const suffix = el.dataset.suffix || "";
        const duration = 1400;
        const startTime = performance.now();

        function tick(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = Math.round(eased * target);
          el.textContent = current.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    }, { threshold: 0.6 });

    counters.forEach(el => observer.observe(el));
  })();

  // ===== CAROUSEL CATEGORÍAS INTERACTIVO =====
  (function () {
    const wrap = document.getElementById("cat-carousel-wrap");
    const track = document.getElementById("cat-track");
    const btnPrev = document.getElementById("cat-prev");
    const btnNext = document.getElementById("cat-next");
    if (!wrap || !track) return;

    const SPEED = 0.9;
    const CARD_W = 160;
    const isTouch = ('ontouchstart' in window);
    let autoPlay = true;
    let resumeTimer = null;

    function halfWidth() { return track.scrollWidth / 2; }
    function pauseAndResume(ms) {
      autoPlay = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { autoPlay = true; }, ms);
    }

    if (isTouch) {
      // ─── MOBILE: transform-based (scrollLeft no funciona en iOS RAF) ───
      let offset = 0;
      let dragging = false;
      let touchStartX = 0;
      let startOffset = 0;

      function loop(val) {
        const h = halfWidth();
        if (!h) return val;
        val = val % h;
        return val < 0 ? val + h : val;
      }

      function mobileTick() {
        if (autoPlay && !dragging) {
          offset = loop(offset + SPEED);
          track.style.transform = "translateX(-" + offset + "px)";
        }
        requestAnimationFrame(mobileTick);
      }
      requestAnimationFrame(mobileTick);

      wrap.addEventListener("touchstart", function(e) {
        dragging = true;
        autoPlay = false;
        touchStartX = e.touches[0].pageX;
        startOffset = offset;
      }, { passive: true });

      wrap.addEventListener("touchmove", function(e) {
        var dx = touchStartX - e.touches[0].pageX;
        offset = loop(startOffset + dx);
        track.style.transform = "translateX(-" + offset + "px)";
      }, { passive: true });

      wrap.addEventListener("touchend", function() {
        dragging = false;
        pauseAndResume(1500);
      }, { passive: true });

    } else {
      // ─── DESKTOP: scrollLeft-based ────────────────────────────────────
      let isDragging = false;
      let dragStartX = 0;
      let dragScrollStart = 0;

      function tick() {
        if (autoPlay && !isDragging) {
          wrap.scrollLeft += SPEED;
          if (wrap.scrollLeft >= halfWidth()) wrap.scrollLeft -= halfWidth();
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);

      wrap.addEventListener("mouseenter", () => { autoPlay = false; });
      wrap.addEventListener("mouseleave", () => { if (!isDragging) autoPlay = true; });

      wrap.addEventListener("mousedown", (e) => {
        isDragging = true; autoPlay = false;
        dragStartX = e.pageX; dragScrollStart = wrap.scrollLeft;
        wrap.classList.add("is-dragging"); e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        let next = dragScrollStart + (dragStartX - e.pageX);
        const hw = halfWidth();
        if (next < 0) next += hw; if (next >= hw) next -= hw;
        wrap.scrollLeft = next;
      });
      window.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        wrap.classList.remove("is-dragging");
        pauseAndResume(1200);
      });
      wrap.addEventListener("click", (e) => {
        if (Math.abs(wrap.scrollLeft - dragScrollStart) > 5) e.preventDefault();
      }, true);

      if (btnPrev) btnPrev.addEventListener("click", () => {
        let next = wrap.scrollLeft - CARD_W;
        const hw = halfWidth(); if (next < 0) next += hw;
        wrap.scrollLeft = next; pauseAndResume(1500);
      });
      if (btnNext) btnNext.addEventListener("click", () => {
        let next = wrap.scrollLeft + CARD_W;
        const hw = halfWidth(); if (next >= hw) next -= hw;
        wrap.scrollLeft = next; pauseAndResume(1500);
      });
    }
  })();
});

// Mostrar botón de cuenta en el header si el usuario está registrado
(function() {
  const user = JSON.parse(localStorage.getItem('vsb_user') || 'null');
  const btn = document.getElementById('header-user-btn');
  if (!btn) return;
  if (user && user.nombre) {
    btn.style.display = 'flex';
    btn.title = 'Hola, ' + user.nombre + ' — Mi cuenta';
  }
})();

// Limpia de la barra de direcciones los códigos de seguimiento que agregan Google, Meta, etc.
// (?srsltid=…, gclid, fbclid, utm_…). No recarga la página ni toca los parámetros propios
// de la tienda (cat, buscar, id, order, email, ref…).
(function() {
  const RASTREO = /^(srsltid|gclid|gbraid|wbraid|gad_source|gad_campaignid|fbclid|msclkid|ttclid|igshid|utm_[a-z]+)$/i;
  function limpiar() {
    try {
      const url = new URL(window.location.href);
      const claves = [...url.searchParams.keys()].filter(k => RASTREO.test(k));
      if (!claves.length) return;
      claves.forEach(k => url.searchParams.delete(k));
      history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
    } catch (e) {}
  }
  if (document.readyState === 'complete') setTimeout(limpiar, 800);
  else window.addEventListener('load', () => setTimeout(limpiar, 800));
})();

// Menú: botón "Categorías" que despliega la lista (al pasar el mouse en compu, al tocar en celular)
document.addEventListener("DOMContentLoaded", () => {
  const fila = document.querySelector("#header-dropdown-nav > .container");
  if (!fila || fila.querySelector(".nav-cats-btn")) return;
  const vieja = document.querySelector("#header-dropdown-nav .dropdown-cats-section");
  if (vieja) vieja.remove();   // reemplaza la lista fija de la portada

  const ICONO = { "Mascotas": "🐾", "Fitness y musculacion": "💪", "Pilates y Yoga": "🧘", "Muebles para el hogar": "🪑",
    "Bazar, baño y cocina": "🍳", "Camping": "⛺", "Playa": "🏖️", "Herramientas": "🔧", "Inflables": "🛟",
    "Juguetes": "🧸", "Autos a escala": "🏎️", "Jardin y aire libre": "🌿" };
  const CORTO = { "Bazar, baño y cocina": "Bazar y cocina", "Muebles para el hogar": "Muebles",
    "Fitness y musculacion": "Fitness", "Jardin y aire libre": "Jardín" };
  const EXTERNAS = { "Herramientas": "https://sanou.com.ar" };
  const BASE = ["Mascotas", "Fitness y musculacion", "Pilates y Yoga", "Muebles para el hogar",
    "Bazar, baño y cocina", "Camping", "Playa"];

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-cats-btn";
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "nav-cats-panel");
  btn.innerHTML = 'Categorías <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
  const panel = document.createElement("div");
  panel.className = "nav-cats-panel";
  panel.id = "nav-cats-panel";
  panel.innerHTML = '<div class="nav-cats-inner"><div class="nav-cats-grid"></div></div>';
  const grid = panel.querySelector(".nav-cats-grid");

  const productos = [...fila.querySelectorAll("a")].find(a => /productos\.html$/.test(a.getAttribute("href") || ""));
  (productos || fila.firstElementChild).after(btn);
  fila.appendChild(panel);

  const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  function pintar(cats) {
    const lista = [...new Set([...cats, ...Object.keys(EXTERNAS)])];
    grid.innerHTML = lista.map(c => {
      const ext = EXTERNAS[c];
      const href = ext || "productos.html?cat=" + encodeURIComponent(c).replace(/%20/g, "+");
      return `<a href="${esc(href)}" class="nav-cat"${ext ? ' target="_blank" rel="noopener"' : ""} tabindex="-1">` +
             `<span aria-hidden="true">${ICONO[c] || "🛍️"}</span>${esc(CORTO[c] || c)}</a>`;
    }).join("");
  }
  pintar(BASE);
  if (typeof SUPABASE_URL !== "undefined") {
    fetch(`${SUPABASE_URL}/rest/v1/categorias?select=nombre&visible=eq.true&order=orden`, { headers: { apikey: SUPABASE_PUB } })
      .then(r => r.ok ? r.json() : null)
      .then(f => { if (Array.isArray(f) && f.length) { pintar(f.map(x => x.nombre)); abrir(btn.getAttribute("aria-expanded") === "true"); } })
      .catch(() => {});
  }

  function abrir(si) {
    btn.setAttribute("aria-expanded", si ? "true" : "false");
    panel.classList.toggle("open", si);
    grid.querySelectorAll("a").forEach(a => { a.tabIndex = si ? 0 : -1; });
  }
  btn.addEventListener("click", () => abrir(btn.getAttribute("aria-expanded") !== "true"));

  // Compu (mouse): se abre al pasar por encima y se cierra al salir
  const conMouse = window.matchMedia("(hover: hover) and (pointer: fine)");
  let t = null;
  const entrar = () => { if (!conMouse.matches) return; clearTimeout(t); abrir(true); };
  const salir = () => { if (!conMouse.matches) return; clearTimeout(t); t = setTimeout(() => abrir(false), 250); };
  [btn, panel].forEach(el => { el.addEventListener("mouseenter", entrar); el.addEventListener("mouseleave", salir); });

  // Al cerrar el menú principal, se cierra también
  const nav = document.getElementById("header-dropdown-nav");
  new MutationObserver(() => { if (!nav.classList.contains("open")) abrir(false); }).observe(nav, { attributes: true, attributeFilter: ["class"] });
  panel.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); abrir(false); btn.focus(); } });
});
