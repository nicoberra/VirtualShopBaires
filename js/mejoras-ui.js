/**
 * mejoras-ui.js — Virtual Shop Baires
 * Mejoras de rendimiento y UX (WebP, reduced-motion, cart feedback).
 * Bloque aislado y reversible — no toca lógica de datos ni flags de stock.
 */
(function () {
  'use strict';

  /* ----------------------------------------------------------------
   * WebP swap: logo.png → logo.webp donde el browser lo soporte
   * ---------------------------------------------------------------- */
  function swapLogoWebP() {
    var test = new Image();
    test.onload = function () {
      if (test.width !== 1) return;
      document.querySelectorAll('img[src$="logo.png"]').forEach(function (img) {
        img.src = img.src.replace('logo.png', 'logo.webp');
      });
    };
    test.src =
      'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEA' +
      'AkA4JZACdAEO/gHOAAA=';
  }

  /* ----------------------------------------------------------------
   * Reduced motion: pausar videos del hero y animaciones del topbar
   * ---------------------------------------------------------------- */
  function handleReducedMotion() {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    function applyMotionPref(reduced) {
      document.querySelectorAll('.hero-vid').forEach(function (vid) {
        if (reduced) {
          vid.pause();
          vid.removeAttribute('autoplay');
        } else {
          vid.setAttribute('autoplay', '');
          vid.play().catch(function () {});
        }
      });

      var camion = document.querySelector('.topbar-camion');
      if (camion) {
        camion.style.animationPlayState = reduced ? 'paused' : '';
      }
    }

    applyMotionPref(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', function (e) { applyMotionPref(e.matches); });
    }
  }

  /* ----------------------------------------------------------------
   * Cart button bounce: bounce del botón al agregar producto
   * ---------------------------------------------------------------- */
  function setupCartFeedback() {
    var btn   = document.querySelector('.cart-action-btn');
    var label = document.getElementById('cart-label');
    if (!btn || !label) return;

    var prev = label.textContent.trim();

    var observer = new MutationObserver(function () {
      var curr = label.textContent.trim();
      var prevNum = parseInt(prev, 10) || 0;
      var currNum = parseInt(curr, 10) || 0;

      if (currNum > prevNum) {
        btn.classList.remove('vsb-adding');
        void btn.offsetWidth; // forzar reflow para reiniciar animación
        btn.classList.add('vsb-adding');
        btn.addEventListener('animationend', function () {
          btn.classList.remove('vsb-adding');
        }, { once: true });
      }
      prev = curr;
    });

    observer.observe(label, { childList: true, characterData: true, subtree: true });
  }

  /* ----------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------- */
  function init() {
    swapLogoWebP();
    handleReducedMotion();
    setupCartFeedback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
