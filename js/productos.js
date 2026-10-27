const selectedVariants = {};
const WA_NUMBER = "5491149457266";

// Encuadre de fotos elegido en el CRM: viaja en la URL como "#vsb=x,y,zoom"
// (el navegador ignora lo que va después de #). Sin encuadre: la foto entera, sin recortes.
function fotoSrc(url) { return String(url || "").split("#")[0]; }
function fotoEstilo(url) {
  const m = /#vsb=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/.exec(String(url || ""));
  if (!m) return "";
  const x = Math.min(100, +m[1]), y = Math.min(100, +m[2]), z = Math.min(4, Math.max(1, +m[3]));
  return `object-fit:cover;object-position:${x}% ${y}%;transform:scale(${z});transform-origin:${x}% ${y}%;`;
}
function ponerFoto(imgEl, url) { imgEl.src = fotoSrc(url); imgEl.style.cssText = fotoEstilo(url); }

// Interés de los clientes para ordenar por popularidad: ver la ficha, agregar al carrito,
// marcar favorito. Una vez por producto y tipo en cada visita; sin datos personales.
function registrarInteraccion(p, tipo) {
  try {
    if (!p || typeof SUPABASE_URL === "undefined") return;
    const k = "vsb_int_" + tipo + "_" + favClave(p);
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, "1");
    fetch(SUPABASE_URL + "/rest/v1/interacciones", {
      method: "POST", keepalive: true,
      headers: { apikey: SUPABASE_PUB, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ categoria: String(p.categoria || "").slice(0, 80), nombre: String(p.nombre || "").slice(0, 200), tipo })
    }).catch(() => {});
  } catch (e) {}
}

function getFavoritos() { try { return JSON.parse(localStorage.getItem("vsb_favoritos") || "[]"); } catch (e) { return []; } }
// Clave estable (categoría + nombre): el id numérico cambia cuando cambia el catálogo.
// Los favoritos viejos guardados con id se siguen reconociendo.
function favClave(p) { return (String(p.categoria || "") + "|" + String(p.nombre || "")).toLowerCase().trim(); }
function esFavorito(p, favs) { favs = favs || getFavoritos(); return favs.includes(favClave(p)) || favs.includes(p.id); }
function isFavorito(id) { const p = PRODUCTOS.find(x => x.id === id); return !!p && esFavorito(p); }
function toggleFavorito(id, btn) {
  const p = PRODUCTOS.find(x => x.id === id);
  if (!p) return;
  const clave = favClave(p);
  let favs = getFavoritos();
  const ya = esFavorito(p, favs);
  favs = favs.filter(f => f !== clave && f !== id);
  if (!ya) {
    favs.push(clave);
    registrarInteraccion(p, "favorito");
    btn.classList.add("fav-active");
    btn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    btn.title = "Quitar de favoritos";
    btn.setAttribute("aria-label", "Quitar de favoritos"); btn.setAttribute("aria-pressed", "true");
    showToast("❤️ Guardado en favoritos");
  } else {
    btn.classList.remove("fav-active");
    btn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    btn.title = "Guardar en favoritos";
    btn.setAttribute("aria-label", "Guardar en favoritos"); btn.setAttribute("aria-pressed", "false");
    showToast("Quitado de favoritos");
  }
  localStorage.setItem("vsb_favoritos", JSON.stringify(favs));
}

function formatPrecio(n) {
  return "$" + n.toLocaleString("es-AR");
}

function getProductUrl(pid) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/[^/]*$/, '') + 'productos.html';
  url.search = '?id=' + pid;
  url.hash = '';
  return url.toString();
}

function getWAText(nombre, color, talle, precio, pid) {
  let msg = `Hola! 👋 Quiero consultar sobre *${nombre}*`;
  if (color) msg += ` · Color: ${color}`;
  if (talle) msg += ` · Talle: ${talle}`;
  if (precio) msg += `\n💰 Precio: ${formatPrecio(precio)}`;
  if (pid) msg += `\n🔗 ${getProductUrl(pid)}`;
  msg += `\n\n¿Tienen stock disponible?`;
  return encodeURIComponent(msg);
}

const MAX_BOTONES_VARIANTE = 8;

function escAttrVar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Con muchas opciones se usa un desplegable en vez de botones
function variantSelectHTML(pid, type, valores, actual) {
  return `<select class="variant-select" data-type="${type}" aria-label="Elegí ${type}"
            onclick="event.stopPropagation()"
            onchange="event.stopPropagation(); selectVariantSelect(${pid},'${type}',this.value)">
      <option value="">Elegí una opción (${valores.length})</option>
      ${valores.map(v => `<option value="${escAttrVar(v)}"${actual === v ? ' selected' : ''}>${escAttrVar(v)}</option>`).join('')}
    </select>`;
}

function selectVariantSelect(pid, type, value) {
  if (!selectedVariants[pid]) selectedVariants[pid] = {};
  selectedVariants[pid][type] = value || null;
  document.querySelectorAll(`.product-card[data-id="${pid}"] .variant-select[data-type="${type}"], #product-modal .variant-select[data-type="${type}"]`)
    .forEach(s => { s.value = value || ''; });
  updateVariantState(pid);
  const modal = document.getElementById('product-modal');
  if (modal && modal.classList.contains('open')) updateModalVariantState(pid);
}

// Fotos que muestra el detalle: las de la variante elegida (si tiene varias propias) o las del producto
function _fotosDetalle(p) {
  const sel = selectedVariants[p.id] || {};
  const v = (sel.color && p.variantes) ? p.variantes.find(x => x.color === sel.color && x.imagenes && x.imagenes.length > 1) : null;
  if (v) return v.imagenes;
  return (p.imagenes && p.imagenes.length) ? p.imagenes : (p.imagen ? [p.imagen] : []);
}

function _galeriaModalHTML(p, imgs) {
  return imgs.length
    ? `<img src="${fotoSrc(imgs[0])}" alt="${p.nombre}" id="modal-img-main" />
       ${imgs.length > 1 ? `
         <button type="button" class="modal-img-prev" aria-label="Foto anterior" onclick="modalGaleria(${p.id},-1)"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
         <button type="button" class="modal-img-next" aria-label="Foto siguiente" onclick="modalGaleria(${p.id},1)"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
         <div class="modal-img-dots" id="modal-img-dots">
           ${imgs.map((_,i) => `<span class="modal-dot${i===0?' active':''}" onclick="modalGaleriaGo(${p.id},${i})"></span>`).join('')}
         </div>` : ''}
       `
    : `<i class="fa-solid fa-box-open" style="font-size:5rem; color:var(--red);" id="modal-img-main"></i>`;
}

// Muestra la foto de la variante elegida (si tiene imagen propia); con varias, el detalle pasa a mostrar las suyas
function mostrarImagenVariante(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  const sel = selectedVariants[pid] || {};
  if (!p || !p.tieneVariantes || !sel.color) return;
  const v = p.variantes.find(x => x.color === sel.color && (x.imagen || (x.imagenes && x.imagenes.length)));
  if (!v) return;
  const principal = (v.imagenes && v.imagenes[0]) || v.imagen;
  const cardImg = document.querySelector(`.product-card[data-id="${pid}"] .product-img img`);
  if (cardImg) ponerFoto(cardImg, principal);
  const modal = document.getElementById('product-modal');
  const cont = modal && modal.classList.contains('open') ? modal.querySelector('.modal-img') : null;
  if (cont && v.imagenes && v.imagenes.length > 1) {
    const badge = cont.querySelector('.badge-offer, .badge-new');
    _galeriaIdx = 0;
    cont.innerHTML = _galeriaModalHTML(p, v.imagenes);
    if (badge) cont.appendChild(badge);
    return;
  }
  const modalImg = document.getElementById('modal-img-main');
  if (modalImg && modalImg.tagName === 'IMG') modalImg.src = fotoSrc(principal);
}

function isVariantComplete(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p || !p.tieneVariantes) return true;
  const sel = selectedVariants[pid] || {};
  if (p.colores.length > 0 && !sel.color) return false;
  if (p.talles.length  > 0 && !sel.talle) return false;
  return true;
}

// ─── ESTADO DE COMPRA (uno solo para tarjeta, detalle y "Comprar ahora") ────
// listo: se puede comprar · elegir: falta color/talle · sinstock: no hay disponibilidad real
const _COLORES = /^(azul|rojo|roja|verde|negro|negra|blanco|blanca|gris|amarillo|amarilla|naranja|rosa|rosado|violeta|lila|celeste|marr[oó]n|beige|dorado|plateado|bord[oó]|turquesa|fucsia|multicolor(es)?|transparente|crema|natural|nude|coral|menta|[uú]nico|surtido|varios)\b/i;
function etiquetaVariante(p) {
  if (p.categoria === "Autos a escala") return "Modelo";
  const vals = (p.colores || []).filter(Boolean);
  return vals.length && vals.every(v => _COLORES.test(String(v).trim())) ? "Color" : "Opción";
}

// Descripción legible: "a - b - c" se muestra como lista; el texto no cambia
function _escHTML(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function descripcionHTML(texto) {
  const t = String(texto || "").trim();
  if (!t) return "";
  let cuerpo;
  if (/^- /m.test(t) && /\n/.test(t)) {
    // Formato nuevo: bloques separados por línea en blanco; "Título:" y listas con "- "
    cuerpo = t.split(/\n{2,}/).map(bloque => {
      const lineas = bloque.split("\n").map(x => x.trim()).filter(Boolean);
      let html = "", items = [];
      const cerrar = () => { if (items.length) { html += `<ul>${items.map(x => `<li>${_escHTML(x)}</li>`).join("")}</ul>`; items = []; } };
      lineas.forEach(l => {
        if (l.startsWith("- ")) items.push(l.slice(2));
        else if (/^[^.]{2,40}:$/.test(l)) { cerrar(); html += `<p class="desc-tit">${_escHTML(l)}</p>`; }
        else if (/^Garantía:/i.test(l)) { cerrar(); html += `<p class="desc-garantia">${_escHTML(l)}</p>`; }
        else { cerrar(); html += `<p>${_escHTML(l)}</p>`; }
      });
      cerrar();
      return html;
    }).join("");
  } else {
    const partes = t.split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
    cuerpo = (partes.length >= 3 && partes.every(x => x.length < 160))
      ? `<p>${_escHTML(partes[0])}</p><ul>${partes.slice(1).map(x => `<li>${_escHTML(x)}</li>`).join("")}</ul>`
      : t.split(/\n{2,}/).map(x => `<p>${_escHTML(x).replace(/\n/g, "<br>")}</p>`).join("");
  }
  const larga = t.length > 360;
  return `<div class="modal-desc${larga ? " modal-desc-corta" : ""}" id="modal-desc">${cuerpo}</div>` +
    (larga ? `<button type="button" class="modal-desc-mas" aria-controls="modal-desc" aria-expanded="false"
               onclick="const d=document.getElementById('modal-desc');const a=d.classList.toggle('modal-desc-corta');this.setAttribute('aria-expanded',String(!a));this.textContent=a?'Ver descripción completa':'Ver menos'">Ver descripción completa</button>` : "");
}

// 10% OFF por transferencia o efectivo: mismo valor que DISCOUNT_PCT (checkout) y el servidor
const DESCUENTO_TRANSFERENCIA = 10;
function precioTransferencia(precio) { return Math.round(Number(precio) * (100 - DESCUENTO_TRANSFERENCIA)) / 100; }
function formatPrecioExacto(n) {
  const x = Number(n), dec = Math.round(x * 100) % 100 !== 0;
  return "$" + x.toLocaleString("es-AR", { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: 2 });
}
function htmlTransfer(precio) {
  return `<div class="precio-transfer"><strong>${formatPrecioExacto(precioTransferencia(precio))}</strong> con transferencia <span class="precio-transfer-off">${DESCUENTO_TRANSFERENCIA}% OFF</span></div>`;
}
// Cambia el precio y su línea de transferencia juntos (tarjeta o detalle)
function ponerPrecio(el, precio) {
  if (!el) return;
  el.textContent = formatPrecio(precio);
  const caja = el.closest('.product-info, .modal-info');
  const t = caja && caja.querySelector('.precio-transfer');
  if (t) t.outerHTML = htmlTransfer(precio);
}

function nombreVisible(p) {
  return String(p.nombre || "").replace(/\s*\[[^\]]*\]\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
function _escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

// Botón principal de la tarjeta: si falta elegir opción, abre el detalle (nunca queda "mudo")
function accionTarjeta(pid) {
  const e = estadoCompra(pid);
  if (e.estado === "elegir") return openProductModal(pid);
  if (e.estado === "listo") return addToCartWithVariant(pid);
}

function varianteElegida(p) {
  const sel = selectedVariants[p.id] || {};
  return p.variantes.find(v => (!p.colores.length || v.color === sel.color) && (!p.talles.length || v.talle === sel.talle)) || null;
}
function estadoCompra(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return { estado: "sinstock" };
  if (!p.tieneVariantes) return { estado: p.disponible === false ? "sinstock" : "listo" };
  if (!p.variantes.some(v => v.stock)) return { estado: "sinstock" };       // ninguna opción disponible
  if (!isVariantComplete(pid)) {
    const falta = [p.colores.length > 1 ? "una opción" : "", p.talles.length > 1 ? "el talle" : ""].filter(Boolean).join(" y ");
    return { estado: "elegir", falta };
  }
  const v = varianteElegida(p);
  return (v && v.stock) ? { estado: "listo", variante: v } : { estado: "sinstock", variante: v, opcion: true };
}
function _waConsulta(p) {
  return "https://wa.me/5491149457266?text=" + encodeURIComponent("Hola! Quería consultar por: " + p.nombre);
}
function htmlEstadoCompra(p, e) {
  if (e.estado === "listo") return "";
  if (e.estado === "elegir") return `<i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> Elegí ${e.falta} para comprar`;
  return `<i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${e.opcion ? "Esta opción no tiene stock" : "Sin stock por el momento"} · ` +
         `<a href="${_waConsulta(p)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Consultanos</a>`;
}
// Aplica el estado a un contenedor (tarjeta o detalle): ambos botones y el mensaje juntos
function pintarEstadoCompra(root, pid) {
  if (!root) return;
  const p = PRODUCTOS.find(x => x.id === pid);
  const e = estadoCompra(pid), ok = e.estado === "listo";
  const enTarjeta = root.classList.contains("product-card");
  root.querySelectorAll(".btn-add, .btn-wa-product").forEach(b => {
    const activo = ok || (enTarjeta && e.estado === "elegir" && b.classList.contains("btn-add"));
    b.disabled = !activo;
    b.classList.toggle("btn-variant-disabled", !activo);
    b.dataset.ready = ok ? "true" : "false";
    if (enTarjeta && b.classList.contains("btn-wa-product")) b.hidden = !ok;
  });
  const add = root.querySelector(".btn-add");
  if (add) add.innerHTML = e.estado === "sinstock"
    ? '<i class="fa-solid fa-ban" aria-hidden="true"></i> Sin stock'
    : (enTarjeta && e.estado === "elegir")
      ? '<i class="fa-solid fa-sliders" aria-hidden="true"></i> Elegir opción'
      : '<i class="fa-solid fa-cart-plus" aria-hidden="true"></i> Agregar al carrito';
  const msg = root.querySelector(".compra-estado");
  const mostrar = !ok && !(enTarjeta && e.estado === "elegir");
  if (msg && p) { msg.innerHTML = mostrar ? htmlEstadoCompra(p, e) : ""; msg.hidden = !mostrar; msg.dataset.estado = e.estado; }
}

function selectVariant(pid, type, value, btn) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!selectedVariants[pid]) selectedVariants[pid] = {};
  selectedVariants[pid][type] = value;

  // Si la otra dimensión seleccionada ya no es válida para esta nueva selección, limpiarla
  if (p && p.tieneVariantes) {
    const otroTipo = type === 'color' ? 'talle' : 'color';
    const otroValor = selectedVariants[pid][otroTipo];
    if (otroValor) {
      const combinacionValida = p.variantes.some(v =>
        v[type] === value && v[otroTipo] === otroValor && v.stock
      );
      if (!combinacionValida) {
        selectedVariants[pid][otroTipo] = null;
        // Desmarcar visualmente el botón de la otra dimensión
        const card = document.querySelector(`.product-card[data-id="${pid}"]`);
        if (card) {
          card.querySelectorAll(`[data-type="${otroTipo}"] .variant-btn`)
            .forEach(b => b.classList.remove('selected'));
        }
        const modal = document.getElementById('product-modal');
        if (modal && modal.classList.contains('open')) {
          modal.querySelectorAll(`[data-type="${otroTipo}"] .variant-btn`)
            .forEach(b => b.classList.remove('selected'));
        }
      }
    }
  }

  btn.closest('.variant-options').querySelectorAll('.variant-btn')
    .forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
  btn.classList.add('selected');
  btn.setAttribute('aria-pressed', 'true');
  updateVariantState(pid);
}

function updateVariantState(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p || !p.tieneVariantes) return;
  const sel      = selectedVariants[pid] || {};
  const complete = isVariantComplete(pid);

  const variant = complete ? p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  ) : null;

  mostrarImagenVariante(pid);

  const card = document.querySelector(`.product-card[data-id="${pid}"]`);
  if (!card) return;

  // Deshabilitar talles que no existen para el color seleccionado (y viceversa)
  if (sel.color && p.talles.length > 0) {
    const tallesDisponibles = p.variantes
      .filter(v => v.color === sel.color && v.stock)
      .map(v => v.talle);
    card.querySelectorAll('[data-type="talle"] .variant-btn').forEach(btn => {
      const noDisponible = !tallesDisponibles.includes(btn.textContent.trim());
      btn.classList.toggle('btn-variant-disabled', noDisponible);
      btn.disabled = noDisponible;
    });
  }
  if (sel.talle && p.colores.length > 0) {
    const coloresDisponibles = p.variantes
      .filter(v => v.talle === sel.talle && v.stock)
      .map(v => v.color);
    card.querySelectorAll('[data-type="color"] .variant-btn').forEach(btn => {
      const noDisponible = !coloresDisponibles.includes(btn.textContent.trim());
      btn.classList.toggle('btn-variant-disabled', noDisponible);
      btn.disabled = noDisponible;
    });
  }

  const priceEl = card.querySelector('.price-main');

  // Mostrar precio parcial: si solo hay un talle seleccionado, buscar precio de ese talle
  // (útil cuando el precio varía por talle y el color no importa para el precio)
  if (!complete && priceEl) {
    let parcialVariant = null;
    if (sel.talle && !sel.color) {
      parcialVariant = p.variantes.find(v => v.talle === sel.talle && v.stock);
    } else if (sel.color && !sel.talle) {
      parcialVariant = p.variantes.find(v => v.color === sel.color && v.stock);
    }
    if (parcialVariant) ponerPrecio(priceEl, parcialVariant.precio);
  }

  if (complete && variant) {
    if (priceEl) ponerPrecio(priceEl, variant.precio);

    // Actualizar precio tachado
    const oldPriceEl = card.querySelector('.price-old');
    if (variant.precioOriginal) {
      if (oldPriceEl) {
        oldPriceEl.textContent = formatPrecio(variant.precioOriginal);
      } else {
        priceEl?.insertAdjacentHTML('afterend', `<span class="price-old">${formatPrecio(variant.precioOriginal)}</span>`);
      }
    } else {
      if (oldPriceEl) oldPriceEl.remove();
    }

  }
  pintarEstadoCompra(card, pid);
}

function addToCartWithVariant(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  if (p.tieneVariantes) {
    if (!isVariantComplete(pid)) return;
    const sel = selectedVariants[pid] || {};
    const variant = p.variantes.find(v =>
      (!p.colores.length || v.color === sel.color) &&
      (!p.talles.length  || v.talle === sel.talle)
    );
    if (!variant || !variant.stock) return;
    Cart.add(pid, sel, variant.precio);
  } else {
    Cart.add(pid);
  }
}

function buyWithWA(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return false;
  const card  = document.querySelector(`.product-card[data-id="${pid}"]`);
  const waBtn = card?.querySelector('.btn-wa-product');
  if (!waBtn || estadoCompra(pid).estado !== 'listo') { avisarEstadoCompra(card, pid); return false; }
  addToCartWithVariant(pid);
  window.location.href = 'checkout.html';
  return false;
}

// Si algo impide comprar, se muestra y se resalta el motivo (nunca un clic "mudo")
function avisarEstadoCompra(root, pid) {
  pintarEstadoCompra(root, pid);
  const msg = root && root.querySelector('.compra-estado');
  if (!msg) return;
  msg.classList.remove('compra-estado-aviso'); void msg.offsetWidth; msg.classList.add('compra-estado-aviso');
}

function cardImgNav(btn, dir) {
  const card = btn.closest('.product-card');
  const pid = parseInt(card.dataset.id);
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const imgs = (p.imagenes && p.imagenes.length > 0) ? p.imagenes : (p.imagen ? [p.imagen] : []);
  if (imgs.length < 2) return;
  const imgEl = card.querySelector('.product-img img');
  if (!imgEl) return;
  let idx = (parseInt(imgEl.dataset.idx || '0') + dir + imgs.length) % imgs.length;
  imgEl.onerror = function() { this.style.display = 'none'; this.parentElement.classList.add('img-fallback'); };
  ponerFoto(imgEl, imgs[idx]);
  imgEl.dataset.idx = String(idx);
  card.querySelectorAll('.card-img-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

function renderProductCard(p) {
  // Pre-seleccionar opciones únicas antes de renderizar
  if (p.tieneVariantes) {
    if (!selectedVariants[p.id]) selectedVariants[p.id] = {};
    if (p.colores.length === 1) selectedVariants[p.id].color = p.colores[0];
    if (p.talles.length  === 1) selectedVariants[p.id].talle = p.talles[0];
  }

  const hasVariants     = p.tieneVariantes;
  const alreadyComplete = hasVariants && isVariantComplete(p.id);
  const sel             = selectedVariants[p.id] || {};

  const currentVariant = alreadyComplete ? p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  ) : null;

  const inStock        = currentVariant ? currentVariant.stock : true;
  const displayPrice   = currentVariant ? currentVariant.precio : p.precio;
  const displayOldPrice = currentVariant ? currentVariant.precioOriginal : p.precioOriginal;
  const btnDisabled    = hasVariants && (!alreadyComplete || !inStock);

  const badgeHTML = (p.badge === "new" || p.badge === "nuevo")
    ? `<span class="badge-new">NUEVO</span>`
    : (p.badge === "offer" || p.badge === "oferta")
    ? `<span class="badge-offer">OFERTA</span>`
    : "";

  const oldPriceHTML = displayOldPrice
    ? `<span class="price-old">${formatPrecio(displayOldPrice)}</span>`
    : "";

  const imgs = (p.imagenes && p.imagenes.length > 0) ? p.imagenes : (p.imagen ? [p.imagen] : []);
  const hasMultiImgs = imgs.length > 1;
  const imgHTML = imgs.length > 0
    ? `<img src="${fotoSrc(imgs[0])}" style="${fotoEstilo(imgs[0])}" alt="${_escAttr(nombreVisible(p))}" loading="lazy" decoding="async" data-idx="0" onerror="this.src='';this.style.display='none';this.parentElement.classList.add('img-fallback')" />`
    : `<i class="fa-solid fa-box-open" style="font-size:3rem; color:var(--red);"></i>`;
  const carouselHTML = hasMultiImgs
    ? `<button type="button" class="card-arrow card-arrow-prev" aria-label="Foto anterior" tabindex="-1" onclick="event.stopPropagation();cardImgNav(this,-1)">&#8249;</button><button type="button" class="card-arrow card-arrow-next" aria-label="Foto siguiente" tabindex="-1" onclick="event.stopPropagation();cardImgNav(this,1)">&#8250;</button><div class="card-img-dots">${imgs.map((_,i)=>`<span class="card-img-dot${i===0?' active':''}"></span>`).join('')}</div>`
    : '';

  const descHTML = p.descripcion
    ? `<p class="product-desc product-desc-short">${p.descripcion}</p>`
    : "";

  let variantesHTML = "";
  if (hasVariants) {
    if (p.colores.length > MAX_BOTONES_VARIANTE) {
      variantesHTML += `
        <div class="variant-group" onclick="event.stopPropagation()">
          <span class="variant-label">${etiquetaVariante(p)}:</span>
          ${variantSelectHTML(p.id, 'color', p.colores, sel.color)}
        </div>`;
    } else if (p.colores.length > 1) {
      variantesHTML += `
        <div class="variant-group" onclick="event.stopPropagation()">
          <span class="variant-label">${etiquetaVariante(p)}:</span>
          <div class="variant-options" data-type="color">
            ${p.colores.map(c => `
              <button class="variant-btn${sel.color === c ? ' selected' : ''}"
                      onclick="event.stopPropagation(); selectVariant(${p.id},'color','${c.replace(/'/g,"\\'")}',this)">
                ${c}
              </button>`).join("")}
          </div>
        </div>`;
    }
    if (p.talles.length > 1) {
      variantesHTML += `
        <div class="variant-group" onclick="event.stopPropagation()">
          <span class="variant-label">Talle:</span>
          <div class="variant-options" data-type="talle">
            ${p.talles.map(t => `
              <button class="variant-btn${sel.talle === t ? ' selected' : ''}"
                      onclick="event.stopPropagation(); selectVariant(${p.id},'talle','${t.replace(/'/g,"\\'")}',this)">
                ${t}
              </button>`).join("")}
          </div>
        </div>`;
    }
  }

  const ec = estadoCompra(p.id), puede = ec.estado === "listo", elegir = ec.estado === "elegir";
  const hintHTML = `<div class="compra-estado" role="status" data-estado="${ec.estado}"${(puede || elegir) ? " hidden" : ""}>${(puede || elegir) ? "" : htmlEstadoCompra(p, ec)}</div>`;
  const nom = nombreVisible(p);

  const addBtnHTML = `
    <button type="button" class="btn-add${(puede || elegir) ? '' : ' btn-variant-disabled'}"
            onclick="accionTarjeta(${p.id})" data-ready="${puede}" ${(puede || elegir) ? '' : 'disabled'}>
      ${ec.estado === "sinstock" ? '<i class="fa-solid fa-ban" aria-hidden="true"></i> Sin stock'
        : elegir ? '<i class="fa-solid fa-sliders" aria-hidden="true"></i> Elegir opción'
        : '<i class="fa-solid fa-cart-plus" aria-hidden="true"></i> Agregar al carrito'}
    </button>`;

  const waBtnHTML = `<button type="button" class="btn-wa-product" onclick="return buyWithWA(${p.id})"
               data-ready="${puede}"${puede ? '' : ' hidden disabled'}>
         <i class="fa-solid fa-bolt" aria-hidden="true"></i> Comprar ahora
       </button>`;

  const isFav = isFavorito(p.id);
  const favBtn = `<button type="button" class="fav-btn${isFav ? ' fav-active' : ''}" onclick="event.stopPropagation();toggleFavorito(${p.id},this)" title="${isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-label="${isFav ? 'Quitar de favoritos' : 'Guardar en favoritos'}" aria-pressed="${isFav}"><i class="fa-${isFav ? 'solid' : 'regular'} fa-heart" aria-hidden="true"></i></button>`;
  const opciones = p.tieneVariantes && p.variantes.length > 1 ? `<span class="card-opciones">${p.variantes.length} opciones</span>` : "";

  // Tarjeta compacta: categoría, nombre (2 líneas), precio y acciones. Descripción y variantes van al detalle.
  return `
    <article class="product-card" data-id="${p.id}" onclick="openProductModal(${p.id})"
             tabindex="0" aria-label="${_escAttr(nom)}"
             onkeydown="if((event.key==='Enter'||event.key===' ')&&event.target===this){event.preventDefault();openProductModal(${p.id})}">
      <div class="product-img">${imgHTML}${carouselHTML}${badgeHTML}${favBtn}</div>
      <div class="product-info">
        <div class="product-info-top">
          <div class="category">${p.categoria}${opciones}</div>
          <h3 title="${_escAttr(nom)}">${nom}</h3>
        </div>
        <div class="product-info-bottom" onclick="event.stopPropagation()">
          <div class="product-price">
            <span class="price-main">${formatPrecio(displayPrice)}</span>
            ${oldPriceHTML}
          </div>
          ${htmlTransfer(displayPrice)}
          ${hintHTML}
          <div class="card-actions">
            ${addBtnHTML}
            ${waBtnHTML}
          </div>
        </div>
      </div>
    </article>`;
}

// ─── MODAL DE PRODUCTO ───────────────────────────────────────────────────────

function openProductModal(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) { if (typeof showToast === "function") showToast("Ese producto ya no está disponible", "error"); return; }
  registrarInteraccion(p, "vista");

  // Sincronizar estado de variantes con la tarjeta
  if (p.tieneVariantes && !selectedVariants[pid]) selectedVariants[pid] = {};
  if (p.tieneVariantes && p.colores.length === 1) selectedVariants[pid].color = p.colores[0];
  if (p.tieneVariantes && p.talles.length  === 1) selectedVariants[pid].talle = p.talles[0];

  const sel             = selectedVariants[pid] || {};
  const alreadyComplete = p.tieneVariantes && isVariantComplete(pid);
  const currentVariant  = alreadyComplete ? p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  ) : null;

  const displayPrice    = currentVariant ? currentVariant.precio : p.precio;
  const displayOldPrice = currentVariant ? currentVariant.precioOriginal : p.precioOriginal;
  const inStock         = currentVariant ? currentVariant.stock : true;
  const btnDisabled     = p.tieneVariantes && (!alreadyComplete || !inStock);

  const imgHTML = _galeriaModalHTML(p, _fotosDetalle(p));

  const badgeHTML = (p.badge === "oferta" || p.badge === "offer")
    ? `<span class="badge-offer" style="position:absolute;top:12px;left:12px;">OFERTA</span>`
    : (p.badge === "nuevo" || p.badge === "new")
    ? `<span class="badge-new" style="position:absolute;top:12px;left:12px;">NUEVO</span>`
    : "";

  let variantesHTML = "";
  if (p.tieneVariantes) {
    if (p.colores.length > MAX_BOTONES_VARIANTE) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">${etiquetaVariante(p)}:</span>
          ${variantSelectHTML(pid, 'color', p.colores, sel.color)}
        </div>`;
    } else if (p.colores.length > 1) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">${etiquetaVariante(p)}:</span>
          <div class="variant-options" data-type="color">
            ${p.colores.map(c => `
              <button type="button" class="variant-btn${sel.color === c ? ' selected' : ''}" aria-pressed="${sel.color === c}"
                      onclick="selectVariantModal(${pid},'color','${c.replace(/'/g,"\\'")}',this)">
                ${c}
              </button>`).join("")}
          </div>
        </div>`;
    }
    if (p.talles.length > 1) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">Talle:</span>
          <div class="variant-options">
            ${p.talles.map(t => `
              <button class="variant-btn${sel.talle === t ? ' selected' : ''}"
                      onclick="selectVariantModal(${pid},'talle','${t.replace(/'/g,"\\'")}',this)">
                ${t}
              </button>`).join("")}
          </div>
        </div>`;
    }
  }

  const ec = estadoCompra(pid), puede = ec.estado === "listo";
  const hintHTML = `<div class="compra-estado" role="status" data-estado="${ec.estado}"${puede ? " hidden" : ""}>${htmlEstadoCompra(p, ec)}</div>`;

  const oldPriceHTML = displayOldPrice
    ? `<span class="price-old" id="modal-old-price">${formatPrecio(displayOldPrice)}</span>` : "";

  const addBtnHTML = `
    <button type="button" class="btn-add${puede ? '' : ' btn-variant-disabled'}" id="modal-btn-add"
            onclick="addToCartFromModal(${pid})" data-ready="${puede}" ${puede ? '' : 'disabled'}>
      ${ec.estado === "sinstock" ? '<i class="fa-solid fa-ban" aria-hidden="true"></i> Sin stock' : '<i class="fa-solid fa-cart-plus" aria-hidden="true"></i> Agregar al carrito'}
    </button>`;

  const waBtnHTML = `<button type="button" class="btn-wa-product${puede ? '' : ' btn-variant-disabled'}" id="modal-btn-wa"
               onclick="return buyWithWAModal(${pid})" data-ready="${puede}" ${puede ? '' : 'disabled'}>
         <i class="fa-solid fa-bolt" aria-hidden="true"></i> Comprar ahora
       </button>`;

  const modal = document.getElementById('product-modal');
  modal.innerHTML = `
    <div class="modal-box" onclick="event.stopPropagation()">
      <button type="button" class="modal-close" onclick="closeProductModal()" aria-label="Cerrar"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      <div class="modal-img" style="position:relative;">${imgHTML}${badgeHTML}</div>
      <div class="modal-info">
        <div class="category" style="font-size:0.75rem;color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${p.categoria}</div>
        <h2 class="modal-nombre" id="modal-nombre">${nombreVisible(p)}</h2>
        ${descripcionHTML(p.descripcion)}
        <div class="modal-variantes" id="modal-variantes">${variantesHTML}</div>
        ${hintHTML}
        <div class="modal-price">
          <span class="price-main" id="modal-price">${formatPrecio(displayPrice)}</span>
          ${oldPriceHTML}
        </div>
        ${htmlTransfer(displayPrice)}
        <div class="modal-actions">
          ${addBtnHTML}
          ${waBtnHTML}
        </div>
      </div>
    </div>`;

  if (!modal.classList.contains('open')) _modalOrigen = document.activeElement;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'modal-nombre');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  mostrarImagenVariante(pid);
  setTimeout(() => { const c = modal.querySelector('.modal-close'); if (c) c.focus(); }, 60);
}

// Detalle accesible: Escape cierra, el foco no se escapa y vuelve a la tarjeta al cerrar
let _modalOrigen = null;
document.addEventListener('keydown', e => {
  const modal = document.getElementById('product-modal');
  if (!modal || !modal.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeProductModal(); return; }
  if (e.key !== 'Tab') return;
  const f = [...modal.querySelectorAll('button:not([disabled]), a[href], select, input, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const primero = f[0], ultimo = f[f.length - 1];
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
});

function selectVariantModal(pid, type, value, btn) {
  selectVariant(pid, type, value, btn);           // actualiza selectedVariants y la tarjeta
  updateModalVariantState(pid);                    // actualiza el modal
}

function updateModalVariantState(pid) {
  const p   = PRODUCTOS.find(x => x.id === pid);
  if (!p)   return;
  const sel      = selectedVariants[pid] || {};
  const complete = isVariantComplete(pid);
  const variant  = complete ? p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  ) : null;

  const priceEl    = document.getElementById('modal-price');
  const oldPriceEl = document.getElementById('modal-old-price');

  // Deshabilitar variantes no disponibles en el modal
  if (sel.color && p.talles.length > 0) {
    const tallesDisponibles = p.variantes.filter(v => v.color === sel.color && v.stock).map(v => v.talle);
    document.querySelectorAll('#product-modal [data-type="talle"] .variant-btn').forEach(btn => {
      const noDisponible = !tallesDisponibles.includes(btn.textContent.trim());
      btn.classList.toggle('btn-variant-disabled', noDisponible);
      btn.disabled = noDisponible;
    });
  }
  if (sel.talle && p.colores.length > 0) {
    const coloresDisponibles = p.variantes.filter(v => v.talle === sel.talle && v.stock).map(v => v.color);
    document.querySelectorAll('#product-modal [data-type="color"] .variant-btn').forEach(btn => {
      const noDisponible = !coloresDisponibles.includes(btn.textContent.trim());
      btn.classList.toggle('btn-variant-disabled', noDisponible);
      btn.disabled = noDisponible;
    });
  }

  // Mostrar precio parcial en modal también
  if (!complete && priceEl) {
    let parcialVariant = null;
    if (sel.talle && !sel.color) {
      parcialVariant = p.variantes.find(v => v.talle === sel.talle && v.stock);
    } else if (sel.color && !sel.talle) {
      parcialVariant = p.variantes.find(v => v.color === sel.color && v.stock);
    }
    if (parcialVariant) ponerPrecio(priceEl, parcialVariant.precio);
  }

  if (complete && variant) {
    if (priceEl) ponerPrecio(priceEl, variant.precio);
    if (variant.precioOriginal) {
      if (oldPriceEl) oldPriceEl.textContent = formatPrecio(variant.precioOriginal);
      else priceEl?.insertAdjacentHTML('afterend', `<span class="price-old" id="modal-old-price">${formatPrecio(variant.precioOriginal)}</span>`);
    } else { if (oldPriceEl) oldPriceEl.remove(); }

  }
  pintarEstadoCompra(document.querySelector('#product-modal .modal-box'), pid);
}

function addToCartFromModal(pid) {
  addToCartWithVariant(pid);
  closeProductModal();
}

function buyWithWAModal(pid) {
  if (estadoCompra(pid).estado !== 'listo') { avisarEstadoCompra(document.querySelector('#product-modal .modal-box'), pid); return false; }
  addToCartWithVariant(pid);
  window.location.href = 'checkout.html';
  return false;
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
  _galeriaIdx = 0;
  if (_modalOrigen && document.contains(_modalOrigen)) _modalOrigen.focus({ preventScroll: true });
  _modalOrigen = null;
}

// ─── GALERÍA DE IMÁGENES EN MODAL ────────────────────────────────────────────

let _galeriaIdx = 0;

function modalGaleria(pid, dir) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const imgs = _fotosDetalle(p);
  if (imgs.length <= 1) return;
  _galeriaIdx = (_galeriaIdx + dir + imgs.length) % imgs.length;
  _actualizarGaleria(imgs);
}

function modalGaleriaGo(pid, idx) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const imgs = _fotosDetalle(p);
  _galeriaIdx = idx;
  _actualizarGaleria(imgs);
}

function _actualizarGaleria(imgs) {
  const imgEl  = document.getElementById('modal-img-main');
  const dotsEl = document.getElementById('modal-img-dots');
  if (imgEl && imgEl.tagName === 'IMG') imgEl.src = fotoSrc(imgs[_galeriaIdx]);
  if (dotsEl) {
    dotsEl.querySelectorAll('.modal-dot').forEach((d, i) =>
      d.classList.toggle('active', i === _galeriaIdx)
    );
  }
}
