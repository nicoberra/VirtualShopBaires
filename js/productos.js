// Estado de variantes seleccionadas por producto { pid: { color, talle } }
const selectedVariants = {};

function formatPrecio(n) {
  return "$" + n.toLocaleString("es-AR");
}

// Inicializa la selección al primer hover/render
function initVariant(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p || !p.tieneVariantes || selectedVariants[pid]) return;
  selectedVariants[pid] = {};
  if (p.colores.length > 0) selectedVariants[pid].color = p.colores[0];
  if (p.talles.length  > 0) selectedVariants[pid].talle = p.talles[0];
  updateVariantState(pid);
}

// Cuando el usuario elige color o talle
function selectVariant(pid, type, value, btn) {
  if (!selectedVariants[pid]) selectedVariants[pid] = {};
  selectedVariants[pid][type] = value;
  btn.closest('.variant-options').querySelectorAll('.variant-btn')
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  updateVariantState(pid);
}

// Actualiza precio y estado del botón según variante seleccionada
function updateVariantState(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p || !p.tieneVariantes) return;
  const sel = selectedVariants[pid] || {};

  const variant = p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  );

  const card = document.querySelector(`.product-card[data-id="${pid}"]`);
  if (!card || !variant) return;

  const priceEl = card.querySelector('.price-main');
  const addBtn  = card.querySelector('.btn-add');
  if (priceEl) priceEl.textContent = formatPrecio(variant.precio);
  if (addBtn) {
    addBtn.disabled = !variant.stock;
    addBtn.innerHTML = variant.stock
      ? '<i class="fa-solid fa-cart-plus"></i> Agregar al carrito'
      : '<i class="fa-solid fa-ban"></i> Sin stock';
  }
}

// Botón "Agregar" en productos con variantes
function addToCartWithVariant(pid) {
  const p = PRODUCTOS.find(x => x.id === pid);
  if (!p) return;
  const sel = selectedVariants[pid] || {};
  const variant = p.variantes.find(v =>
    (!p.colores.length || v.color === sel.color) &&
    (!p.talles.length  || v.talle === sel.talle)
  );
  if (!variant || !variant.stock) return;
  Cart.add(pid, sel, variant.precio);
}

// Render de tarjeta de producto
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

  // Selectores de variantes
  let variantesHTML = "";
  if (p.tieneVariantes) {
    if (p.colores.length > 0) {
      variantesHTML += `
        <div class="variant-group">
          <span class="variant-label">Color:</span>
          <div class="variant-options" data-type="color">
            ${p.colores.map((c, i) => `
              <button class="variant-btn${i === 0 ? ' selected' : ''}"
                      onclick="selectVariant(${p.id}, 'color', '${c.replace(/'/g, "\\'")}', this)">
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
            ${p.talles.map((t, i) => `
              <button class="variant-btn${i === 0 ? ' selected' : ''}"
                      onclick="selectVariant(${p.id}, 'talle', '${t.replace(/'/g, "\\'")}', this)">
                ${t}
              </button>`).join("")}
          </div>
        </div>`;
    }
  }

  const addBtnHTML = p.tieneVariantes
    ? `<button class="btn-add" onclick="addToCartWithVariant(${p.id})">
         <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
       </button>`
    : `<button class="btn-add" onclick="Cart.add(${p.id})">
         <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
       </button>`;

  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-img">
        ${imgHTML}
        ${badgeHTML}
      </div>
      <div class="product-info">
        <div class="category">${p.categoria}</div>
        <h3>${p.nombre}</h3>
        ${descHTML}
        ${variantesHTML}
        <div class="product-price">
          <span class="price-main">${formatPrecio(p.precio)}</span>
          ${oldPriceHTML}
        </div>
        ${addBtnHTML}
      </div>
    </div>
  `;
}
