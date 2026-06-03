const selectedVariants = {};
const WA_NUMBER = "5491149457266";

function formatPrecio(n) {
  return "$" + n.toLocaleString("es-AR");
}

function getWAText(nombre, color, talle, precio) {
  let msg = `Hola! Me interesa: *${nombre}*`;
  if (color) msg += ` - Color: ${color}`;
  if (talle) msg += ` - Talle: ${talle}`;
  if (precio) msg += ` - Precio: ${formatPrecio(precio)}`;
  msg += `. ¿Está disponible?`;
  return encodeURIComponent(msg);
}

function isVariantComplete(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p || !p.tieneVariantes) return true;
  const sel = selectedVariants[pid] || {};
  if (p.colores.length > 0 && !sel.color) return false;
  if (p.talles.length  > 0 && !sel.talle) return false;
  return true;
}

function selectVariant(pid, type, value, btn) {
  if (!selectedVariants[pid]) selectedVariants[pid] = {};
  selectedVariants[pid][type] = value;
  btn.closest('.variant-options').querySelectorAll('.variant-btn')
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
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
  const addBtn  = card.querySelector('.btn-add');
  const waBtn   = card.querySelector('.btn-wa-product');
  const hint    = card.querySelector('.variant-hint');

  if (hint) hint.style.display = complete ? 'none' : 'flex';

  if (complete && variant) {
    if (priceEl) priceEl.textContent = formatPrecio(variant.precio);

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

    const inStock = variant.stock;
    if (addBtn) {
      addBtn.disabled = !inStock;
      addBtn.classList.toggle('btn-variant-disabled', !inStock);
      addBtn.innerHTML = inStock
        ? '<i class="fa-solid fa-cart-plus"></i> Agregar al carrito'
        : '<i class="fa-solid fa-ban"></i> Sin stock';
    }
    if (waBtn) {
      waBtn.classList.toggle('btn-variant-disabled', !inStock);
      waBtn.dataset.ready  = inStock ? 'true' : 'false';
      waBtn.dataset.color  = sel.color || '';
      waBtn.dataset.talle  = sel.talle || '';
      waBtn.dataset.precio = variant.precio || '';
    }
  } else {
    if (addBtn) { addBtn.disabled = true; addBtn.classList.add('btn-variant-disabled'); }
    if (waBtn)  { waBtn.classList.add('btn-variant-disabled'); waBtn.dataset.ready = 'false'; }
  }
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
  if (!waBtn || waBtn.dataset.ready !== 'true') return false;
  const precio = waBtn.dataset.precio ? Number(waBtn.dataset.precio) : p.precio;
  const text = getWAText(p.nombre, waBtn.dataset.color || null, waBtn.dataset.talle || null, precio);
  window.open(`https://wa.me/${WA_NUMBER}?text=${text}`, '_blank');
  return false;
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

  const imgHTML = p.imagen
    ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" />`
    : `<i class="fa-solid fa-box-open" style="font-size:3rem; color:var(--red);"></i>`;

  const descHTML = p.descripcion
    ? `<p class="product-desc product-desc-short">${p.descripcion}</p>`
    : "";

  let variantesHTML = "";
  if (hasVariants) {
    if (p.colores.length > 0) {
      variantesHTML += `
        <div class="variant-group" onclick="event.stopPropagation()">
          <span class="variant-label">Color:</span>
          <div class="variant-options" data-type="color">
            ${p.colores.map(c => `
              <button class="variant-btn${sel.color === c ? ' selected' : ''}"
                      onclick="event.stopPropagation(); selectVariant(${p.id},'color','${c.replace(/'/g,"\\'")}',this)">
                ${c}
              </button>`).join("")}
          </div>
        </div>`;
    }
    if (p.talles.length > 0) {
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

  const needsColor = p.colores.length > 1;
  const needsTalle = p.talles.length > 1;
  const hintText   = [needsColor ? 'color' : '', needsTalle ? 'talle' : ''].filter(Boolean).join(' y ');
  const hintHTML   = hasVariants && !alreadyComplete
    ? `<div class="variant-hint"><i class="fa-solid fa-circle-exclamation"></i> Seleccioná ${hintText} para continuar</div>`
    : "";

  const addBtnHTML = `
    <button class="btn-add${btnDisabled ? ' btn-variant-disabled' : ''}"
            onclick="addToCartWithVariant(${p.id})"
            ${btnDisabled ? 'disabled' : ''}>
      <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
    </button>`;

  const waBtnHTML = hasVariants
    ? `<button class="btn-wa-product${btnDisabled ? ' btn-variant-disabled' : ''}"
               onclick="return buyWithWA(${p.id})"
               data-ready="${!btnDisabled ? 'true' : 'false'}"
               data-color="${sel.color || ''}"
               data-talle="${sel.talle || ''}"
               data-precio="${displayPrice || ''}">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </button>`
    : `<a class="btn-wa-product"
          href="https://wa.me/${WA_NUMBER}?text=${getWAText(p.nombre, null, null, p.precio)}"
          target="_blank">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </a>`;

  return `
    <div class="product-card" data-id="${p.id}" onclick="openProductModal(${p.id})">
      <div class="product-img">${imgHTML}${badgeHTML}</div>
      <div class="product-info">
        <div class="product-info-top">
          <div class="category">${p.categoria}</div>
          <h3>${p.nombre}</h3>
          ${descHTML}
          ${variantesHTML}
        </div>
        <div class="product-info-bottom" onclick="event.stopPropagation()">
          ${hintHTML}
          <div class="product-price">
            <span class="price-main">${formatPrecio(displayPrice)}</span>
            ${oldPriceHTML}
          </div>
          ${addBtnHTML}
          ${waBtnHTML}
        </div>
      </div>
    </div>`;
}

// ─── MODAL DE PRODUCTO ───────────────────────────────────────────────────────

function openProductModal(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;

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

  const imgs    = (p.imagenes && p.imagenes.length) ? p.imagenes : (p.imagen ? [p.imagen] : []);
  const imgHTML = imgs.length
    ? `<img src="${imgs[0]}" alt="${p.nombre}" id="modal-img-main" />
       ${imgs.length > 1 ? `
         <button class="modal-img-prev" onclick="modalGaleria(${p.id},-1)"><i class="fa-solid fa-chevron-left"></i></button>
         <button class="modal-img-next" onclick="modalGaleria(${p.id},1)"><i class="fa-solid fa-chevron-right"></i></button>
         <div class="modal-img-dots" id="modal-img-dots">
           ${imgs.map((_,i) => `<span class="modal-dot${i===0?' active':''}" onclick="modalGaleriaGo(${p.id},${i})"></span>`).join('')}
         </div>` : ''}
       `
    : `<i class="fa-solid fa-box-open" style="font-size:5rem; color:var(--red);" id="modal-img-main"></i>`;

  const badgeHTML = (p.badge === "oferta" || p.badge === "offer")
    ? `<span class="badge-offer" style="position:absolute;top:12px;left:12px;">OFERTA</span>`
    : (p.badge === "nuevo" || p.badge === "new")
    ? `<span class="badge-new" style="position:absolute;top:12px;left:12px;">NUEVO</span>`
    : "";

  let variantesHTML = "";
  if (p.tieneVariantes) {
    if (p.colores.length > 0) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">Color:</span>
          <div class="variant-options">
            ${p.colores.map(c => `
              <button class="variant-btn${sel.color === c ? ' selected' : ''}"
                      onclick="selectVariantModal(${pid},'color','${c.replace(/'/g,"\\'")}',this)">
                ${c}
              </button>`).join("")}
          </div>
        </div>`;
    }
    if (p.talles.length > 0) {
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

  const needsColor = p.colores.length > 1;
  const needsTalle = p.talles.length > 1;
  const hintText   = [needsColor ? 'color' : '', needsTalle ? 'talle' : ''].filter(Boolean).join(' y ');
  const hintHTML   = p.tieneVariantes && !alreadyComplete
    ? `<div class="variant-hint"><i class="fa-solid fa-circle-exclamation"></i> Seleccioná ${hintText} para continuar</div>`
    : "";

  const oldPriceHTML = displayOldPrice
    ? `<span class="price-old" id="modal-old-price">${formatPrecio(displayOldPrice)}</span>` : "";

  const addBtnHTML = `
    <button class="btn-add${btnDisabled ? ' btn-variant-disabled' : ''}" id="modal-btn-add"
            onclick="addToCartFromModal(${pid})" ${btnDisabled ? 'disabled' : ''}>
      <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
    </button>`;

  const waBtnHTML = p.tieneVariantes
    ? `<button class="btn-wa-product${btnDisabled ? ' btn-variant-disabled' : ''}" id="modal-btn-wa"
               onclick="return buyWithWAModal(${pid})"
               data-ready="${!btnDisabled ? 'true' : 'false'}"
               data-color="${sel.color || ''}" data-talle="${sel.talle || ''}"
               data-precio="${displayPrice || ''}">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </button>`
    : `<a class="btn-wa-product" href="https://wa.me/${WA_NUMBER}?text=${getWAText(p.nombre,null,null,p.precio)}" target="_blank">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </a>`;

  const modal = document.getElementById('product-modal');
  modal.innerHTML = `
    <div class="modal-box" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="closeProductModal()"><i class="fa-solid fa-xmark"></i></button>
      <div class="modal-img" style="position:relative;">${imgHTML}${badgeHTML}</div>
      <div class="modal-info">
        <div class="category" style="font-size:0.75rem;color:var(--red);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${p.categoria}</div>
        <h2 class="modal-nombre">${p.nombre}</h2>
        ${p.descripcion ? `<p class="modal-desc">${p.descripcion}</p>` : ""}
        <div class="modal-variantes" id="modal-variantes">${variantesHTML}</div>
        ${hintHTML}
        <div class="modal-price">
          <span class="price-main" id="modal-price">${formatPrecio(displayPrice)}</span>
          ${oldPriceHTML}
        </div>
        <div class="modal-actions">
          ${addBtnHTML}
          ${waBtnHTML}
        </div>
      </div>
    </div>`;

  document.getElementById('product-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

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
  const addBtn     = document.getElementById('modal-btn-add');
  const waBtn      = document.getElementById('modal-btn-wa');
  const hint       = document.querySelector('#product-modal .variant-hint');

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

  if (hint) hint.style.display = complete ? 'none' : 'flex';

  if (complete && variant) {
    if (priceEl) priceEl.textContent = formatPrecio(variant.precio);
    if (variant.precioOriginal) {
      if (oldPriceEl) oldPriceEl.textContent = formatPrecio(variant.precioOriginal);
      else priceEl?.insertAdjacentHTML('afterend', `<span class="price-old" id="modal-old-price">${formatPrecio(variant.precioOriginal)}</span>`);
    } else { if (oldPriceEl) oldPriceEl.remove(); }

    const inStock = variant.stock;
    if (addBtn) { addBtn.disabled = !inStock; addBtn.classList.toggle('btn-variant-disabled', !inStock); }
    if (waBtn)  { waBtn.classList.toggle('btn-variant-disabled', !inStock); waBtn.dataset.ready = inStock ? 'true' : 'false'; waBtn.dataset.color = sel.color || ''; waBtn.dataset.talle = sel.talle || ''; waBtn.dataset.precio = variant.precio || ''; }
  } else {
    if (addBtn) { addBtn.disabled = true; addBtn.classList.add('btn-variant-disabled'); }
    if (waBtn)  { waBtn.classList.add('btn-variant-disabled'); waBtn.dataset.ready = 'false'; }
  }
}

function addToCartFromModal(pid) {
  addToCartWithVariant(pid);
  closeProductModal();
}

function buyWithWAModal(pid) {
  const waBtn = document.getElementById('modal-btn-wa');
  if (!waBtn || waBtn.dataset.ready !== 'true') return false;
  const p2    = PRODUCTOS.find(x => x.id === pid);
  const precio = waBtn.dataset.precio ? Number(waBtn.dataset.precio) : p2?.precio;
  const text = getWAText(
    p2?.nombre || '',
    waBtn.dataset.color || null,
    waBtn.dataset.talle || null,
    precio
  );
  window.open(`https://wa.me/${WA_NUMBER}?text=${text}`, '_blank');
  return false;
}

function closeProductModal() {
  document.getElementById('product-modal').classList.remove('open');
  document.body.style.overflow = '';
  _galeriaIdx = 0;
}

// ─── GALERÍA DE IMÁGENES EN MODAL ────────────────────────────────────────────

let _galeriaIdx = 0;

function modalGaleria(pid, dir) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const imgs = (p.imagenes && p.imagenes.length) ? p.imagenes : (p.imagen ? [p.imagen] : []);
  if (imgs.length <= 1) return;
  _galeriaIdx = (_galeriaIdx + dir + imgs.length) % imgs.length;
  _actualizarGaleria(imgs);
}

function modalGaleriaGo(pid, idx) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const imgs = (p.imagenes && p.imagenes.length) ? p.imagenes : (p.imagen ? [p.imagen] : []);
  _galeriaIdx = idx;
  _actualizarGaleria(imgs);
}

function _actualizarGaleria(imgs) {
  const imgEl  = document.getElementById('modal-img-main');
  const dotsEl = document.getElementById('modal-img-dots');
  if (imgEl && imgEl.tagName === 'IMG') imgEl.src = imgs[_galeriaIdx];
  if (dotsEl) {
    dotsEl.querySelectorAll('.modal-dot').forEach((d, i) =>
      d.classList.toggle('active', i === _galeriaIdx)
    );
  }
}
