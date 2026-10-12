// ============================================================
//  Productos — compartido por panel.html (CRM) y panel-ops.html (Operaciones)
//  Se carga DESPUÉS de panel.js / panel-ops.js y usa sus helpers:
//  $, val, crm, toast, show, hide, cargarFotos, eliminarProducto,
//  _productos y _prodCatFil.
// ============================================================

const HOJAS_NO_PRODUCTO = ['Categorias'];

function crmToken() {
  return sessionStorage.getItem('crm_token') || sessionStorage.getItem('ops_crm_token') || '';
}

// POST con respuesta legible (sirve para descripciones largas)
async function crmEnviar(params) {
  const body = new URLSearchParams({ token: crmToken(), ...params });
  const r = await fetch(CRM_URL, { method: 'POST', body });
  const data = await r.json();
  if (data && data.ok === false && data.error === 'auth') {
    toast('La sesión venció, volvé a entrar', 'err');
    throw new Error('auth');
  }
  return data;
}

function actualizarCampo(p, campo, valor) {
  return crmEnviar({ action: 'ext_producto_update', sheet: p._sheet, row: String(p._row), campo, valor: String(valor) });
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtPrecioSheet(v) {
  if (!v && v !== 0) return '—';
  const n = Number(String(v).replace(/[^\d.,]/g,'').replace(',','.'));
  return isNaN(n) || n === 0 ? '—' : '$' + n.toLocaleString('es-AR', {minimumFractionDigits:0});
}

function prodThumb(src, size) {
  const s = size || 44;
  return src
    ? `<img class="prod-thumb" src="${escHtml(src)}" alt="" loading="lazy" style="width:${s}px;height:${s}px" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'prod-thumb prod-thumb-empty',innerHTML:'<i class=\\'fa-solid fa-image\\'></i>'}))">`
    : `<span class="prod-thumb prod-thumb-empty" style="width:${s}px;height:${s}px"><i class="fa-solid fa-image"></i></span>`;
}

function hermanos(p) {
  const nom = String(p.nombre || '').trim();
  return _productos.filter(x => x._sheet === p._sheet && String(x.nombre || '').trim() === nom);
}

function filtrarProductos() {
  const q = val('prod-search').toLowerCase();
  let list = _productos.filter(p => !HOJAS_NO_PRODUCTO.includes(p._sheet));
  if (_prodCatFil !== 'Todos') list = list.filter(p => p.categoria === _prodCatFil);
  if (q) list = list.filter(p =>
    String(p.nombre || '').toLowerCase().includes(q) ||
    String(p.color || '').toLowerCase().includes(q) ||
    String(p.marca || '').toLowerCase().includes(q) ||
    String(p.sku || '').toLowerCase().includes(q));
  renderProductos(list);
}

function renderProductos(list) {
  const el = $('prod-table');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i>Sin productos</div>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Producto</th>
        <th>SKU</th>
        <th>Color / Variante</th>
        <th>Precio</th>
        <th>Stock</th>
        <th>⭐</th>
        <th></th>
      </tr></thead>
      <tbody id="prod-tbody"></tbody>
    </table>`;

  const tbody = $('prod-tbody');
  const NCOLS = 7;

  // Filas con el mismo nombre en la misma hoja = un producto con variantes
  const grupos = [];
  const porClave = {};
  list.forEach(p => {
    const k = p._sheet + '|' + String(p.nombre || '').trim();
    if (!porClave[k]) { porClave[k] = []; grupos.push(porClave[k]); }
    porClave[k].push(p);
  });

  const frag = document.createDocumentFragment();
  grupos.forEach(g => {
    if (g.length === 1) { frag.appendChild(buildProdRow(g[0], false)); return; }
    const precios = g.map(v => Number(String(v.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0);
    const min = Math.min(...precios), max = Math.max(...precios);
    const skus = [...new Set(g.map(v => v.sku).filter(Boolean))];
    const head = document.createElement('tr');
    head.className = 'prod-group-row';
    head.innerHTML = `
      <td colspan="${NCOLS}">
        <div class="prod-name-cell">
          <i class="fa-solid fa-chevron-right prod-group-chev"></i>
          ${prodThumb((g.find(v => v.imagen) || {}).imagen)}
          <div class="prod-name-text">
            <strong>${escHtml(g[0].nombre)}</strong>
            <div class="prod-sub">
              <span class="badge">${g.length} variantes</span>
              ${min === max ? fmtPrecioSheet(min) : fmtPrecioSheet(min) + ' – ' + fmtPrecioSheet(max)}
              ${skus.length ? ` · SKU ${escHtml(skus.join(', '))}` : ''}
            </div>
          </div>
        </div>
      </td>`;
    const hijos = g.map(v => buildProdRow(v, true));
    hijos.forEach(tr => { tr.hidden = true; });
    head.addEventListener('click', () => {
      const abrir = hijos[0].hidden;
      hijos.forEach(tr => { tr.hidden = !abrir; });
      head.classList.toggle('abierto', abrir);
    });
    frag.appendChild(head);
    hijos.forEach(tr => frag.appendChild(tr));
  });
  tbody.appendChild(frag);
}

function buildProdRow(p, esVariante) {
  const precioN = Number(String(p.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  const colorMarca = String(p.color || p.marca || '').trim();
  let pVal = precioN, sVal = p.stock ? 1 : 0, hVal = !!p.destacado;

  const renderStock = v => (v
    ? '<span class="badge badge-conf">Con stock</span>'
    : '<span class="badge badge-cancel">Sin stock</span>') + '<i class="fa-solid fa-pen edit-hint"></i>';

  const tr = document.createElement('tr');
  if (esVariante) tr.className = 'prod-var-row';
  tr.innerHTML = `
    <td class="td-nombre">
      <div class="prod-name-cell${esVariante ? ' es-variante' : ''}">
        ${prodThumb(p.imagen, esVariante ? 36 : 44)}
        <div class="prod-name-text">
          ${esVariante
            ? `<strong>${escHtml(colorMarca || '—')}</strong>`
            : `<strong>${escHtml(p.nombre)}</strong>${p.subcategoria ? `<div class="prod-sub">${escHtml(p.subcategoria)}</div>` : ''}`}
        </div>
      </div>
    </td>
    <td class="td-editable td-sku">${renderSku(p.sku)}</td>
    <td>${colorMarca ? `<span class="badge-color">${escHtml(colorMarca)}</span>` : '—'}</td>
    <td class="td-editable td-precio"><strong>${fmtPrecioSheet(p.precio)}</strong><i class="fa-solid fa-pen edit-hint"></i></td>
    <td class="td-toggle td-stock">${renderStock(sVal)}</td>
    <td class="td-center td-toggle td-dest">${hVal ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>'}</td>
    <td style="white-space:nowrap">
      <a class="btn-icon" href="https://virtualshopbaires.com.ar/productos.html?cat=${encodeURIComponent(p.categoria||'')}&buscar=${encodeURIComponent(p.nombre||'')}" target="_blank" rel="noopener" title="Ver en tienda"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
      <button class="btn-icon btn-edit-prod" title="Ver / editar completo"><i class="fa-solid fa-pen-to-square"></i></button>
      <button class="btn-icon btn-del-prod" title="Eliminar producto" style="color:var(--red)"><i class="fa-solid fa-trash"></i></button>
    </td>`;

  tr.querySelector('.td-nombre').addEventListener('click', () => editarProducto(p));
  tr.querySelector('.td-precio').addEventListener('click', function() {
    editarCeldaNum(this, p, 'precio', pVal, v => { pVal = v; p.precio = v; }, '$');
  });
  tr.querySelector('.td-sku').addEventListener('click', function() { editarCeldaSku(this, p); });
  tr.querySelector('.td-stock').addEventListener('click', function() {
    sVal = sVal ? 0 : 1; p.stock = !!sVal;
    this.innerHTML = renderStock(sVal);
    actualizarCampo(p, 'stock', !!sVal)
      .then(r => { if (r.ok === false) throw new Error(r.error); toast('Stock actualizado ✓'); })
      .catch(() => { sVal = sVal ? 0 : 1; p.stock = !!sVal; this.innerHTML = renderStock(sVal); toast('Error al guardar stock', 'err'); });
  });
  tr.querySelector('.td-dest').addEventListener('click', function() {
    hVal = !hVal; p.destacado = hVal;
    this.innerHTML = hVal ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>';
    actualizarCampo(p, 'destacado', hVal)
      .then(() => toast('Destacado actualizado ✓')).catch(() => toast('Error', 'err'));
  });
  tr.querySelector('.btn-edit-prod').addEventListener('click', () => editarProducto(p));
  tr.querySelector('.btn-del-prod').addEventListener('click', () => eliminarProducto(p));
  return tr;
}

function renderSku(v) {
  return (v ? `<span>${escHtml(v)}</span>` : '<span class="text-muted">—</span>') + '<i class="fa-solid fa-pen edit-hint"></i>';
}

function editarCeldaSku(td, p) {
  if (td.querySelector('input')) return;
  const actual = String(p.sku || '');
  td.innerHTML = `<input type="text" class="inline-input" style="width:90px">`;
  const input = td.querySelector('input');
  input.value = actual;
  input.focus(); input.select();
  let cancelado = false;
  input.addEventListener('blur', async () => {
    if (cancelado) return;
    const nuevo = input.value.trim();
    td.innerHTML = renderSku(nuevo);
    if (nuevo === actual) return;
    try {
      const r = await actualizarCampo(p, 'sku_costo', nuevo);
      if (r && r.ok === false) throw new Error(r.error || 'error');
      p.sku = nuevo;
      toast('SKU guardado ✓');
    } catch(e) { toast('Error al guardar SKU','err'); td.innerHTML = renderSku(actual); }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancelado = true; td.innerHTML = renderSku(actual); }
  });
}

async function editarCeldaNum(td, p, campo, valorActual, onSave, prefix='$', customRender=null) {
  if (td.querySelector('input')) return;
  td.innerHTML = `<input type="number" class="inline-input" value="${valorActual}" min="0" step="1">`;
  const input = td.querySelector('input');
  input.focus(); input.select();
  const renderVal = customRender || (v => v
    ? `<strong>${prefix}${Number(v).toLocaleString('es-AR')}</strong><i class="fa-solid fa-pen edit-hint"></i>`
    : `<span class="text-muted">—</span><i class="fa-solid fa-pen edit-hint"></i>`);
  let cancelado = false;
  const guardar = async () => {
    if (cancelado) return;
    const nuevo = Number(input.value) || 0;
    td.innerHTML = renderVal(nuevo);
    if (nuevo === valorActual) return;
    try {
      const r = await actualizarCampo(p, campo, nuevo);
      if (r && r.ok === false) throw new Error(r.error);
      onSave(nuevo);
      toast('Guardado ✓');
    } catch(e) { toast('Error al guardar','err'); td.innerHTML = renderVal(valorActual); }
  };
  input.addEventListener('blur', guardar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { cancelado = true; td.innerHTML = renderVal(valorActual); }
  });
}

function editarProducto(p) {
  if (typeof p === 'string') p = JSON.parse(p);
  _prodActual = p;
  const vars = hermanos(p);

  $('mprod-title').textContent   = p.nombre || p.categoria || 'Producto';
  $('mprod-nombre').value        = p.nombre || '';
  $('mprod-color').value         = p.color || p.marca || '';
  $('mprod-talle').value         = p.talle || '';
  $('mprod-descripcion').value   = p.descripcion || '';
  if ($('mprod-sku')) $('mprod-sku').value = p.sku || '';

  const precioN = Number(String(p.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  $('mprod-precio').value      = precioN;
  $('mprod-descuento').value   = 0;
  $('mprod-stock-num').value   = p.stock ? 1 : 0;
  $('mprod-destacado').checked = !!p.destacado;

  // Categoría: es la pestaña de la planilla (solo lectura)
  const wrap = $('mprod-cats-chips');
  wrap.innerHTML = `<span class="cat-chip cat-chip-sel">${escHtml(p.categoria || p._sheet)}</span>`;

  // Variantes del producto (solo lectura, cada una se edita desde su fila)
  let info = $('mprod-variantes');
  if (!info) {
    info = document.createElement('div');
    info.id = 'mprod-variantes';
    info.className = 'form-group';
    $('mprod-descripcion').closest('.form-group').insertAdjacentElement('afterend', info);
  }
  info.innerHTML = vars.length > 1
    ? `<label>Variantes (${vars.length}) — estás editando: <strong>${escHtml(p.color || '—')}</strong></label>
       <div class="mprod-var-list">${vars.map(v => `
         <span class="mprod-var${v === p ? ' actual' : ''}">${prodThumb(v.imagen, 28)}${escHtml(v.color || '—')} · ${fmtPrecioSheet(v.precio)}${v.sku ? ' · SKU ' + escHtml(v.sku) : ''}</span>`).join('')}
       </div>
       <p class="text-muted" style="font-size:.75rem;margin-top:6px">El nombre, la descripción y el destacado se aplican a todas las variantes. Color, SKU, precio y stock son de esta variante.</p>`
    : '';

  $('fotos-grid').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  show('modal-producto', 'flex');
  if (typeof cargarFotos === 'function') cargarFotos(p);
}

async function guardarProducto() {
  if (!_prodActual) return;
  const p = _prodActual;
  const vars = hermanos(p);
  const nombre      = $('mprod-nombre').value.trim();
  const color       = $('mprod-color').value.trim();
  const talle       = $('mprod-talle').value.trim();
  const descripcion = $('mprod-descripcion').value.trim();
  const sku         = $('mprod-sku') ? $('mprod-sku').value.trim() : (p.sku || '');
  const precio      = Number($('mprod-precio').value) || 0;
  const stock       = (Number($('mprod-stock-num').value) || 0) > 0;
  const destacado   = $('mprod-destacado').checked;

  // De esta variante
  const propios = [
    { campo:'color',        valor: color },
    { campo:'talle/medida', valor: talle },
    { campo:'sku_costo',    valor: sku },
    { campo:'precio',       valor: precio },
    { campo:'stock',        valor: stock },
  ];
  // De todo el producto (todas las variantes)
  const comunes = [
    { campo:'descripcion', valor: descripcion },
    { campo:'destacado',   valor: destacado },
  ];
  if (nombre && nombre !== p.nombre) comunes.unshift({ campo:'producto', valor: nombre });

  try {
    for (const u of propios) {
      const r = await actualizarCampo(p, u.campo, u.valor);
      if (r && r.ok === false && !/Campo no encontrado/.test(r.error || '')) throw new Error(r.error);
    }
    for (const v of vars) {
      for (const u of comunes) {
        const r = await actualizarCampo(v, u.campo, u.valor);
        if (r && r.ok === false && !/Campo no encontrado/.test(r.error || '')) throw new Error(r.error);
      }
    }
    Object.assign(p, { color, talle, sku, precio, stock });
    vars.forEach(v => Object.assign(v, { nombre: nombre || v.nombre, descripcion, destacado }));
    toast('Producto guardado en Sheets ✓');
    hide('modal-producto');
    filtrarProductos();
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'err');
  }
}
