/* Píxel de Meta (Facebook / Instagram) — Virtual Shop Baires
 * Eventos: PageView (todas las páginas), ViewContent (ver producto), AddToCart,
 * InitiateCheckout y Purchase (con valor en ARS).
 * Mientras META_PIXEL_ID esté vacío no se carga nada (queda apagado).
 * El ID del píxel es público (no es una clave secreta). */
(function () {
  var META_PIXEL_ID = ''; // ← pegar acá el ID del conjunto de datos de Meta (solo números)

  if (!/^\d{6,20}$/.test(META_PIXEL_ID)) { window.vsbPixel = function () {}; return; }

  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', META_PIXEL_ID);
  fbq('track', 'PageView');

  // vsbPixel(evento, datos, idEvento): idEvento sirve para no contar dos veces la misma compra.
  window.vsbPixel = function (evento, datos, idEvento) {
    try {
      var d = datos || {};
      if (d.value !== undefined) { d.value = Math.round(Number(d.value) || 0); d.currency = 'ARS'; }
      if (idEvento) fbq('track', evento, d, { eventID: String(idEvento) });
      else fbq('track', evento, d);
    } catch (e) {}
  };
})();
