const selectedVariants = {};
const WA_NUMBER = "5491149457266";

function formatPrecio(n) {
  return "$" + n.toLocaleString("es-AR");
}

function getWAText(nombre, color, talle) {
  let msg = `Hola! Me interesa: *${nombre}*`;
  if (color) msg += ` - Color: ${color}`;
  if (talle) msg += ` - Talle: ${talle}`;
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

  const card   = document.querySelector(`.product-card[data-id="${pid}"]`);
  if (!card) return;

  const priceEl = card.querySelector('.price-main');
  const addBtn  = card.querySelector('.btn-add');
  const waBtn   = card.querySelector('.btn-wa-product');
  const hint    = card.querySelector('.variant-hint');

  // Mostrar/ocultar hint
  if (hint) hint.style.display = complete ? 'none' : 'flex';

  if (complete && variant) {
    if (priceEl) priceEl.textContent = formatPrecio(variant.precio);

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
      waBtn.dataset.ready = inStock ? 'true' : 'false';
      waBtn.dataset.color = sel.color || '';
      waBtn.dataset.talle = sel.talle || '';
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
  const p    = PRODUCTOS.find(x => x.id === pid);
  if (!p) return false;
  const card = document.querySelector(`.product-card[data-id="${pid}"]`);
  const waBtn = card?.querySelector('.btn-wa-product');
  if (!waBtn || waBtn.dataset.ready !== 'true') return false;
  const text = getWAText(p.nombre, waBtn.dataset.color || null, waBtn.dataset.talle || null);
  window.open(`https://wa.me/${WA_NUMBER}?text=${text}`, '_blank');
  return false;
}

function renderProductCard(p) {
  const badgeHTML = (p.badge === "new" || p.badge === "nuevo")
    ? `<span class="badge-new">NUEVO</span>`
    : (p.badge === "offer" || p.badge === "oferta")
    ? `<span class="badge-offer">OFERTA</span>`
    : "";

  const oldPriceHTML = p.precioOriginal
    ? `<span class="price-old">${formatPrecio(p.precioOriginal)}</span>`
    : "";

  const imgHTML = p.imagen
    ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" />`
    : `<i class="fa-solid fa-box-open" style="font-size:3rem; color:var(--red);"></i>`;

  const descHTML = p.descripcion
    ? `<p class="product-desc">${p.descripcion}</p>`
    : "";

  // Variantes sin selección por defecto
  let variantesHTML = "";
  if (p.tieneVariantes) {
    if (p.colores.length > 0) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">Color:</span>
          <div class="variant-options" data-type="color">
            ${p.colores.map(c => `
              <button class="variant-btn"
                      onclick="selectVariant(${p.id},'color','${c.replace(/'/g,"\\'")}',this)">
                ${c}
              </button>`).join("")}
          </div>
        </div>`;
    }
    if (p.talles.length > 0) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">Talle:</span>
          <div class="variant-options" data-type="talle">
            ${p.talles.map(t => `
              <button class="variant-btn"
                      onclick="selectVariant(${p.id},'talle','${t.replace(/'/g,"\\'")}',this)">
                ${t}
              </button>`).join("")}
          </div>
        </div>`;
    }
  }

  const hasVariants = p.tieneVariantes;

  // Hint solo para productos con variantes
  const hintHTML = hasVariants
    ? `<div class="variant-hint"><i class="fa-solid fa-circle-exclamation"></i> Seleccioná color${p.talles.length ? ' y talle' : ''} para continuar</div>`
    : "";

  // Botón carrito
  const addBtnHTML = `
    <button class="btn-add${hasVariants ? ' btn-variant-disabled' : ''}"
            onclick="addToCartWithVariant(${p.id})"
            ${hasVariants ? 'disabled' : ''}>
      <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
    </button>`;

  // Botón WhatsApp directo
  const waBtnHTML = hasVariants
    ? `<button class="btn-wa-product btn-variant-disabled"
               onclick="return buyWithWA(${p.id})"
               data-ready="false" data-color="" data-talle="">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </button>`
    : `<a class="btn-wa-product"
          href="https://wa.me/${WA_NUMBER}?text=${getWAText(p.nombre, null, null)}"
          target="_blank">
         <i class="fa-brands fa-whatsapp"></i> Comprar por WhatsApp
       </a>`;

  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-img">${imgHTML}${badgeHTML}</div>
      <div class="product-info">
        <div class="product-info-top">
          <div class="category">${p.categoria}</div>
          <h3>${p.nombre}</h3>
          ${descHTML}
          ${variantesHTML}
        </div>
        <div class="product-info-bottom">
          ${hintHTML}
          <div class="product-price">
            <span class="price-main">${formatPrecio(p.precio)}</span>
            ${oldPriceHTML}
          </div>
          ${addBtnHTML}
          ${waBtnHTML}
        </div>
      </div>
    </div>`;
}
