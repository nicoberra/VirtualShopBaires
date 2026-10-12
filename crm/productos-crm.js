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

function categoriasProductos() {
  return [...new Set(_productos
    .filter(p => !HOJAS_NO_PRODUCTO.includes(p._sheet))
    .map(p => p.categoria).filter(Boolean))];
}

function buildProdCats() {
  const cats = ['Todos', ...categoriasProductos()];
  $('prod-cats').innerHTML = cats.map(c => {
    const active = c === _prodCatFil ? ' active' : '';
    return `<span class="chip${active}" data-cat="${escHtml(c)}">${escHtml(c)}</span>`;
  }).join('');
  $('prod-cats').querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => setProdCat(ch.dataset.cat));
  });
}

// Lista de categorías: cuántos productos tiene cada una, ver, agregar y eliminar
function abrirModalEditarCats() {
  const cats = categoriasProductos().sort((a, b) => a.localeCompare(b, 'es'));
  const contar = c => {
    const nombres = new Set(_productos.filter(p => p.categoria === c).map(p => String(p.nombre || '').trim()));
    return nombres.size;
  };
  const lista = $('editar-cats-lista');
  lista.innerHTML = cats.length
    ? cats.map(c => `
        <div class="editar-cat-row">
          <span><strong>${escHtml(c)}</strong> <span class="text-muted" style="font-size:.78rem">· ${contar(c)} productos</span></span>
          <span style="display:flex;gap:6px">
            <button class="btn-secondary btn-sm btn-ver-cat" data-cat="${escHtml(c)}"><i class="fa-solid fa-eye"></i> Ver</button>
            <button class="btn-danger btn-sm btn-del-cat" data-cat="${escHtml(c)}"><i class="fa-solid fa-trash"></i> Eliminar</button>
          </span>
        </div>`).join('')
    : '<p class="text-muted">No hay categorías todavía.</p>';
  lista.querySelectorAll('.btn-ver-cat').forEach(btn => {
    btn.addEventListener('click', () => { hide('modal-editar-cats'); setProdCat(btn.dataset.cat); });
  });
  lista.querySelectorAll('.btn-del-cat').forEach(btn => {
    btn.addEventListener('click', () => eliminarCategoria(btn.dataset.cat));
  });
  $('nueva-cat-nombre').value = '';
  show('modal-editar-cats', 'flex');
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

// ─── FOTOS DEL PRODUCTO (las mismas que muestra la tienda) ──────

let _fotosProd = [];
let _ghOk = null;

function _normFoto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function _leerManifestTienda() {
  const r = await fetch('/images-manifest.json?_=' + Date.now(), { cache: 'no-store' });
  return r.json();
}

function _fotosDelManifest(man, categoria, nombre) {
  const nc = _normFoto(categoria), nn = _normFoto(nombre);
  const catKey = Object.keys(man).find(k => _normFoto(k) === nc);
  if (!catKey) return [];
  const key = Object.keys(man[catKey]).find(k => _normFoto(k) === nn);
  if (!key) return [];
  const v = man[catKey][key];
  return Array.isArray(v) ? v.slice() : (v ? [v] : []);
}

async function cargarFotos(p) {
  const grid = $('fotos-grid');
  grid.innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try {
    if (_ghOk === null) {
      try { _ghOk = !!(await crmEnviar({ action: 'gh_estado' })).gh; } catch (e) { _ghOk = false; }
    }
    const man = await _leerManifestTienda();
    _fotosProd = _fotosDelManifest(man, p._sheet || p.categoria, p.nombre);
    renderFotos(p);
  } catch (e) {
    grid.innerHTML = '<p class="text-muted">No se pudieron cargar las fotos</p>';
  }
}

function renderFotos(p) {
  const grid = $('fotos-grid');
  const vars = hermanos(p).filter(v => v.imagen);
  const fotosHTML = _fotosProd.length
    ? _fotosProd.map((url, i) => `
        <div class="foto-item">
          <img src="${escHtml(url)}" alt="Foto ${i + 1}" loading="lazy">
          ${i === 0 ? '<span class="foto-first-badge">Principal</span>' : ''}
          <div class="foto-acciones">
            ${i > 0 ? `<button type="button" class="foto-btn" data-acc="principal" data-i="${i}" title="Hacer principal"><i class="fa-solid fa-star"></i></button>` : ''}
            <button type="button" class="foto-btn foto-btn-del" data-acc="quitar" data-i="${i}" title="Quitar de la tienda"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>`).join('')
    : '<p class="text-muted" style="font-size:0.82rem">Este producto todavía no tiene fotos en la tienda.</p>';

  const varsHTML = vars.length > 1 || (vars.length === 1 && !_fotosProd.includes(vars[0].imagen))
    ? `<div class="fotos-variantes">
         <span class="text-muted" style="font-size:.75rem">Fotos de cada variante (se cambian desde la planilla, columna imagen_url)</span>
         <div class="fotos-grid">${vars.map(v => `
           <div class="foto-item foto-item-sm" title="${escHtml(v.color || '')}">
             <img src="${escHtml(v.imagen)}" alt="${escHtml(v.color || '')}" loading="lazy">
             <span class="foto-var-label">${escHtml(v.color || '')}</span>
           </div>`).join('')}
         </div>
       </div>`
    : '';

  const aviso = _ghOk === false
    ? '<p class="text-muted" style="font-size:.75rem;color:var(--red)">Para subir o cambiar fotos falta configurar GH_TOKEN en el Apps Script del CRM.</p>'
    : '';

  grid.innerHTML = `<div class="fotos-grid">${fotosHTML}</div>${varsHTML}${aviso}`;
  grid.querySelectorAll('.foto-btn').forEach(b => {
    b.addEventListener('click', () => accionFoto(p, b.dataset.acc, Number(b.dataset.i)));
  });
}

async function guardarFotos(p, urls, msgOk) {
  const r = await crmEnviar({ action: 'producto_fotos_set', categoria: p._sheet || p.categoria, nombre: p.nombre, urls: JSON.stringify(urls) });
  if (!r || r.ok === false) throw new Error((r && r.error) || 'error');
  _fotosProd = urls;
  renderFotos(p);
  toast(msgOk);
}

function accionFoto(p, acc, i) {
  if (acc === 'principal') {
    const urls = _fotosProd.slice();
    const [f] = urls.splice(i, 1); urls.unshift(f);
    guardarFotos(p, urls, 'Foto principal actualizada ✓').catch(e => toast('Error: ' + e.message, 'err'));
  } else if (acc === 'quitar') {
    confirmar('¿Quitar esta foto del producto en la tienda?', () => {
      const urls = _fotosProd.filter((_, j) => j !== i);
      guardarFotos(p, urls, 'Foto quitada ✓').catch(e => toast('Error: ' + e.message, 'err'));
    });
  }
}

// Achica la imagen antes de subirla (máx 1600px, JPEG)
function _prepararFoto(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function subirFoto(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length || !_prodActual) return;
  const p = _prodActual;
  if (_ghOk === false) { toast('Falta configurar GH_TOKEN para subir fotos', 'err'); return; }
  const grid = $('fotos-grid');
  let ok = 0;
  for (let k = 0; k < files.length; k++) {
    grid.insertAdjacentHTML('afterbegin', `<div class="loading-row" id="foto-subiendo"><i class="fa-solid fa-spinner fa-spin"></i> Subiendo foto ${k + 1} de ${files.length}…</div>`);
    try {
      const data = await _prepararFoto(files[k]);
      const r = await crmEnviar({ action: 'producto_foto_subir', categoria: p._sheet || p.categoria, nombre: p.nombre, data });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'error');
      _fotosProd = r.fotos || _fotosProd.concat(r.url);
      ok++;
    } catch (e) {
      toast('Error al subir foto: ' + e.message, 'err');
    }
    renderFotos(p);
  }
  if (ok) toast(ok === 1 ? 'Foto subida ✓ (en la tienda aparece en unos minutos)' : `${ok} fotos subidas ✓ (en la tienda aparecen en unos minutos)`);
}

