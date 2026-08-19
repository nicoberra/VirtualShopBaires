// Botón volver arriba
window.addEventListener("scroll", () => {
  const btn = document.getElementById("back-to-top");
  if (btn) btn.classList.toggle("visible", window.scrollY > 300);
}, { passive: true });

// Mobile: celular único que desliza de derecha a izquierda
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

  function advance() {
    if (busy) return;
    busy = true;
    // Marca que JS tomó el control (desactiva el fallback CSS del primer frame)
    if (heroGrid) heroGrid.classList.add('mobile-init-done');
    const oldIdx = idx;
    idx = (idx + 1) % frames.length;
    const outFrame = frames[oldIdx];
    const inFrame = frames[idx];
    playVideo(inFrame.querySelector('video'));
    outFrame.classList.remove('mobile-active');
    outFrame.classList.add('mobile-exit');
    inFrame.classList.add('mobile-active');
    setTimeout(() => {
      outFrame.classList.remove('mobile-exit');
      busy = false;
    }, 750);
  }

  // El primer frame ya está visible por CSS (:not(.mobile-init-done) :first-child)
  // Solo arrancamos el video
  playVideo(frames[0].querySelector('video'));

  setInterval(advance, 4500);
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
    hamburger.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownNav.classList.toggle("open");
      hamburger.classList.toggle("open");
    });

    // Cerrar al hacer click fuera
    document.addEventListener("click", (e) => {
      if (!dropdownNav.contains(e.target) && !hamburger.contains(e.target)) {
        dropdownNav.classList.remove("open");
        hamburger.classList.remove("open");
      }
    });

    // Cerrar al elegir un ítem
    dropdownNav.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        dropdownNav.classList.remove("open");
        hamburger.classList.remove("open");
      });
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
