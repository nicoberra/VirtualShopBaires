// Carrito de compras con soporte de variantes
const Cart = (() => {
  let items = JSON.parse(localStorage.getItem("vsb_cart") || "[]");

  function save() {
    localStorage.setItem("vsb_cart", JSON.stringify(items));
    updateBadge();
    renderCart();
  }

  function updateBadge() {
    const total = items.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll("#cart-label").forEach(el => {
      el.textContent = total;
    });
  }

  function renderCart() {
    const container = document.getElementById("cart-items");
    const totalEl   = document.getElementById("cart-total");
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `<div class="cart-empty"><i class="fa-solid fa-cart-shopping" style="font-size:2rem;color:var(--gray-light);"></i><br>Tu carrito está vacío</div>`;
      if (totalEl) totalEl.textContent = "$0";
      return;
    }

    container.innerHTML = items.map(item => {
      const varInfo = [item.color, item.talle].filter(Boolean).join(" / ");
      const varHTML = varInfo ? `<div class="cart-item-variant">${varInfo}</div>` : "";
      const imgHTML = item.imagen
        ? `<img src="${item.imagen}" alt="${item.nombre}" />`
        : `<i class="fa-solid fa-box-open"></i>`;
      return `
        <div class="cart-item">
          <div class="cart-item-img">${imgHTML}</div>
          <div class="cart-item-info">
            <h4>${item.nombre}</h4>
            ${varHTML}
            <div class="item-price">${formatPrecio(item.precio)}</div>
            <div class="cart-item-qty">
              <button class="qty-btn" onclick="Cart.decQty('${item.cartKey}')">−</button>
              <span>${item.qty}</span>
              <button class="qty-btn" onclick="Cart.incQty('${item.cartKey}')">+</button>
            </div>
          </div>
          <button class="remove-item" onclick="Cart.remove('${item.cartKey}')">✕</button>
        </div>`;
    }).join("");

    const total = items.reduce((s, i) => s + i.precio * i.qty, 0);
    if (totalEl) totalEl.textContent = formatPrecio(total);
  }

  // id: product id | variant: { color, talle } | precio: precio de la variante
  function add(id, variant, precio) {
    const p = PRODUCTOS.find(x => x.id === id);
    if (!p) return;

    const color     = variant?.color || null;
    const talle     = variant?.talle || null;
    const cartKey   = `${id}-${color || ""}-${talle || ""}`;
    const finalPrecio = precio !== undefined ? precio : p.precio;

    const existing = items.find(x => x.cartKey === cartKey);
    if (existing) {
      existing.qty++;
    } else {
      items.push({
        id:       p.id,
        cartKey,
        nombre:   p.nombre,
        precio:   finalPrecio,
        imagen:   p.imagen || null,
        color,
        talle,
        qty:      1,
      });
    }
    save();
    showToast(`✓ ${p.nombre} agregado al carrito`);
  }

  function remove(cartKey) {
    items = items.filter(x => x.cartKey !== cartKey);
    save();
  }

  function incQty(cartKey) {
    const item = items.find(x => x.cartKey === cartKey);
    if (item) { item.qty++; save(); }
  }

  function decQty(cartKey) {
    const item = items.find(x => x.cartKey === cartKey);
    if (item) {
      item.qty--;
      if (item.qty <= 0) items = items.filter(x => x.cartKey !== cartKey);
      save();
    }
  }

  function getItems() { return items; }

  function getTotal() {
    return items.reduce((s, i) => s + i.precio * i.qty, 0);
  }

  function clear() {
    items = [];
    save();
  }

  // Init
  updateBadge();
  renderCart();

  return { add, remove, incQty, decQty, getItems, getTotal, clear };
})();

// Panel del carrito
function openCart() {
  document.getElementById("cart-overlay").classList.add("open");
  document.getElementById("cart-panel").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCart() {
  document.getElementById("cart-overlay").classList.remove("open");
  document.getElementById("cart-panel").classList.remove("open");
  document.body.style.overflow = "";
}

// Toast
function showToast(msg, type = "success") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}
