// Botón volver arriba
window.addEventListener("scroll", () => {
  const btn = document.getElementById("back-to-top");
  if (btn) btn.classList.toggle("visible", window.scrollY > 300);
});

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

  // ===== CAROUSEL CATEGORÍAS INTERACTIVO =====
  (function () {
    const wrap = document.getElementById("cat-carousel-wrap");
    const track = document.getElementById("cat-track");
    const btnPrev = document.getElementById("cat-prev");
    const btnNext = document.getElementById("cat-next");
    if (!wrap || !track) return;

    const SPEED = 0.7;        // px por frame (auto-scroll)
    const CARD_W = 180;       // ancho aprox de cada ítem (160px + gap)
    let autoPlay = true;
    let isDragging = false;
    let dragStartX = 0;
    let dragScrollStart = 0;
    let resumeTimer = null;

    // Half-width para el loop infinito (los ítems están duplicados)
    function halfWidth() { return track.scrollWidth / 2; }

    // Auto-scroll con requestAnimationFrame
    function tick() {
      if (autoPlay && !isDragging) {
        wrap.scrollLeft += SPEED;
        if (wrap.scrollLeft >= halfWidth()) {
          wrap.scrollLeft -= halfWidth();
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    function pauseAndResume(ms) {
      autoPlay = false;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { autoPlay = true; }, ms);
    }

    // Pausa al pasar el mouse (en desktop)
    wrap.addEventListener("mouseenter", () => { autoPlay = false; });
    wrap.addEventListener("mouseleave", () => { if (!isDragging) autoPlay = true; });

    // === DRAG CON MOUSE ===
    wrap.addEventListener("mousedown", (e) => {
      isDragging = true;
      autoPlay = false;
      dragStartX = e.pageX;
      dragScrollStart = wrap.scrollLeft;
      wrap.classList.add("is-dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = dragStartX - e.pageX;
      let next = dragScrollStart + dx;
      const hw = halfWidth();
      if (next < 0) next += hw;
      if (next >= hw) next -= hw;
      wrap.scrollLeft = next;
    });
    window.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      wrap.classList.remove("is-dragging");
      pauseAndResume(1200);
    });

    // Evitar que click en enlace se dispare después de drag
    wrap.addEventListener("click", (e) => {
      if (Math.abs(wrap.scrollLeft - dragScrollStart) > 5) e.preventDefault();
    }, true);

    // === TOUCH (CELULAR) ===
    let touchStartX = 0;
    let touchScrollStart = 0;
    wrap.addEventListener("touchstart", (e) => {
      autoPlay = false;
      touchStartX = e.touches[0].pageX;
      touchScrollStart = wrap.scrollLeft;
    }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      const dx = touchStartX - e.touches[0].pageX;
      let next = touchScrollStart + dx;
      const hw = halfWidth();
      if (next < 0) next += hw;
      if (next >= hw) next -= hw;
      wrap.scrollLeft = next;
    }, { passive: true });
    wrap.addEventListener("touchend", () => {
      pauseAndResume(1500);
    }, { passive: true });

    // === FLECHAS ===
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        let next = wrap.scrollLeft - CARD_W;
        const hw = halfWidth();
        if (next < 0) next += hw;
        wrap.scrollLeft = next;
        pauseAndResume(1500);
      });
    }
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        let next = wrap.scrollLeft + CARD_W;
        const hw = halfWidth();
        if (next >= hw) next -= hw;
        wrap.scrollLeft = next;
        pauseAndResume(1500);
      });
    }
  })();
});
