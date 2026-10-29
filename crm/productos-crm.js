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

// Una foto recién subida tarda 1-2 min en publicarse en la tienda: mientras tanto se muestra desde GitHub
function fotoRespaldo(img) {
  const m = /^https:\/\/virtualshopbaires\.com\.ar\/(img\/.+)$/.exec(img.getAttribute('src') || '');
  if (!m || img.dataset.respaldo) return false;
  img.dataset.respaldo = '1';
  img.src = 'https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/' + m[1];
  return true;
}

// Foto principal del producto (la primera de su galería); si no tiene, la de una variante
function _miniProducto(g) {
  return (g[0] && g[0].fotoProducto) || (g.find(v => v.imagen) || {}).imagen || '';
}
// Al cambiar la galería, la miniatura de la lista se actualiza enseguida
function _fijarFotoPrincipal(p, url) {
  let cambio = false;
  hermanos(p).forEach(v => { if ((v.fotoProducto || '') !== (url || '')) { v.fotoProducto = url || ''; cambio = true; } });
  if (cambio) { lsGuardar('productos', _productos); filtrarProductos(true); }
}
// Trae de la tienda la foto principal de cada producto (una sola consulta, en segundo plano)
async function _completarFotosProducto() {
  try {
    const r = await fetch(`${_SB_URL}/rest/v1/productos?select=categoria,nombre,imagenes&limit=5000`, { headers: { apikey: _SB_PUB }, cache: 'no-store' });
    if (!r.ok) return;
    const mapa = {};
    (await r.json()).forEach(x => { if (x.imagenes && x.imagenes[0]) mapa[x.categoria + '|' + String(x.nombre).trim()] = x.imagenes[0]; });
    let cambio = false;
    _productos.forEach(v => {
      const f = mapa[(v._sheet || v.categoria) + '|' + String(v.nombre || '').trim()] || '';
      if ((v.fotoProducto || '') !== f) { v.fotoProducto = f; cambio = true; }
    });
    if (cambio) { lsGuardar('productos', _productos); if ($('prod-tbody') || $('prod-table')) filtrarProductos(true); }
  } catch (e) { /* sin conexión: quedan las fotos de las variantes */ }
}

// ─── CANTIDAD DE STOCK: unidades de cada variante ('' = sin contar) ───
function _leerCantidad(v) {
  const t = String(v == null ? '' : v).trim();
  if (t === '') return '';
  const n = Math.floor(Number(t));
  return isFinite(n) && n >= 0 ? n : '';
}
function _valCantidad(p) { return p.cantidad === '' || p.cantidad == null ? '' : Number(p.cantidad); }
// Suma de unidades de las variantes que tienen número cargado (para los resúmenes)
function _totalUnidadesTxt(g) {
  const con = g.filter(v => _valCantidad(v) !== '');
  if (!con.length) return '';
  const t = con.reduce((a, v) => a + _valCantidad(v), 0);
  return ` · ${t} u.`;
}
function _unidadesTxt(p) { const c = _valCantidad(p); return c === '' ? '' : ` · ${c} ${c === 1 ? 'unidad' : 'unidades'}`; }
// Igual que el servidor: apagar deja 0 unidades; prender borra un 0 viejo
function _stockLocal(p, con) {
  p.stock = con;
  if (!con && _valCantidad(p) !== '') p.cantidad = 0;
  if (con && _valCantidad(p) === 0) p.cantidad = '';
}
function _inputCantidad(p) {
  return `<input type="number" class="stock-cant" min="0" step="1" inputmode="numeric" placeholder="—" value="${_valCantidad(p)}" aria-label="Unidades en stock de ${escHtml(p.color || p.talle || p.nombre || 'la variante')}" title="Unidades en stock">`;
}
function _activarCantidad(inp, p, pintar) {
  if (!inp) return;
  inp.addEventListener('click', e => e.stopPropagation());
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = _valCantidad(p); inp.blur(); } });
  inp.addEventListener('change', async () => {
    const n = _leerCantidad(inp.value);
    if (inp.value.trim() !== '' && n === '') { toast('Poné un número de 0 en adelante', 'err'); inp.value = _valCantidad(p); return; }
    if (n === _valCantidad(p)) { inp.value = n; return; }
    const antes = { stock: p.stock, cantidad: p.cantidad };
    p.cantidad = n; if (n !== '') p.stock = n > 0;
    pintar();
    try {
      const r = await actualizarCampo(p, 'cantidad', n);
      if (r && r.ok === false) throw new Error(/Campo no encontrado/.test(r.error || '') ? 'falta implementar la versión nueva del servidor' : r.error);
      lsGuardar('productos', _productos);
      toast(n === '' ? 'Cantidad borrada ✓' : `Stock: ${n} ${n === 1 ? 'unidad' : 'unidades'} ✓`);
      filtrarProductos(true);   // los resúmenes ("· 7 u.") y el filtro de stock quedan al día
    } catch (e) {
      Object.assign(p, antes); pintar();
      if (e.message !== 'auth') toast('No se guardó la cantidad: ' + e.message, 'err');
    }
  });
}

// Interruptor de stock (tipo iPhone): verde con la bolita a la derecha = con stock
function _switchStock(on) {
  return `<span class="sw-stock${on ? ' on' : ''}" role="switch" tabindex="0" aria-checked="${on ? 'true' : 'false'}" aria-label="${on ? 'Con stock' : 'Sin stock'}"><span class="sw-bola"></span></span>`;
}
// Cambia el interruptor que ya está en pantalla (así la bolita se desliza)
function _ponerSwitch(cont, on) {
  const sw = cont && cont.querySelector('.sw-stock');
  if (!sw) { if (cont) cont.innerHTML = _switchStock(on); return; }
  sw.classList.toggle('on', !!on);
  sw.setAttribute('aria-checked', on ? 'true' : 'false');
  sw.setAttribute('aria-label', on ? 'Con stock' : 'Sin stock');
}
// El interruptor también se usa con el teclado (Espacio o Enter)
document.addEventListener('keydown', e => {
  const sw = e.target && e.target.closest && e.target.closest('.sw-stock');
  if (sw && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); (sw.closest('.td-stock, .pvar-stock') || sw).click(); }
});

function prodThumb(src, size) {
  const s = size || 44;
  return src
    ? `<img class="prod-thumb" src="${escHtml(src)}" alt="" loading="lazy" style="width:${s}px;height:${s}px" onerror="if(!fotoRespaldo(this))this.replaceWith(Object.assign(document.createElement('span'),{className:'prod-thumb prod-thumb-empty',innerHTML:'<i class=\\'fa-solid fa-image\\'></i>'}))">`
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
          <span style="display:flex;gap:6px;align-items:center">
            <label class="cat-foto" title="Foto en el carrusel de la portada" data-cat="${escHtml(c)}">
              <img alt="" hidden><i class="fa-solid fa-image"></i>
              <input type="file" accept="image/*" hidden>
            </label>
            <button class="btn-secondary btn-sm btn-ver-cat" data-cat="${escHtml(c)}"><i class="fa-solid fa-eye"></i> Ver</button>
            <button class="btn-danger btn-sm btn-del-cat" data-cat="${escHtml(c)}"><i class="fa-solid fa-trash"></i> Eliminar</button>
          </span>
        </div>`).join('')
    : uiVacio('fa-tags', 'Todavía no hay categorías', 'Creá la primera para empezar a cargar productos.', { texto: 'Crear categoría', icono: 'fa-plus', onclick: "$('nueva-cat-nombre').focus()" });
  lista.querySelectorAll('.btn-ver-cat').forEach(btn => {
    btn.addEventListener('click', () => { hide('modal-editar-cats'); setProdCat(btn.dataset.cat); });
  });
  lista.querySelectorAll('.btn-del-cat').forEach(btn => {
    btn.addEventListener('click', () => eliminarCategoria(btn.dataset.cat));
  });
  lista.querySelectorAll('.cat-foto input').forEach(inp => {
    inp.addEventListener('change', () => subirFotoCategoria(inp));
  });
  $('nueva-cat-nombre').value = '';
  show('modal-editar-cats', 'flex');
  cargarFotosCategorias();
}

// Fotos de las categorías: las que giran en el carrusel de la portada de la tienda
async function cargarFotosCategorias() {
  try {
    const r = await crmEnviar({ action: 'ext_categorias_list' });
    (r.categorias || []).forEach(c => pintarFotoCategoria(c.nombre, c.imagen_url));
  } catch (e) { /* sin fotos: quedan los íconos */ }
}

function pintarFotoCategoria(cat, url) {
  const lbl = [...document.querySelectorAll('#editar-cats-lista .cat-foto')].find(l => l.dataset.cat === cat);
  if (!lbl) return;
  const img = lbl.querySelector('img');
  img.hidden = !url;
  if (url) img.src = url; else img.removeAttribute('src');
  lbl.title = url ? 'Cambiar la foto del carrusel de la portada' : 'Subir foto para el carrusel de la portada';
}

// Recorte cuadrado al centro (el carrusel muestra las fotos cuadradas)
function _prepararFotoCuadrada(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const lado = Math.min(img.width, img.height), sal = Math.min(800, lado);
      const c = document.createElement('canvas');
      c.width = c.height = sal;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sal, sal);
      ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, sal, sal);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

async function subirFotoCategoria(input) {
  const lbl = input.closest('.cat-foto'), cat = lbl.dataset.cat, file = input.files[0];
  input.value = '';
  if (!file) return;
  lbl.classList.add('subiendo');
  try {
    const data = await _prepararFotoCuadrada(file);
    const r = await crmEnviar({ action: 'ext_categoria_foto', nombre: cat, data });
    if (!r.ok) throw new Error(r.error || 'No se pudo guardar');
    pintarFotoCategoria(cat, r.url);
    toast('Foto de "' + cat + '" guardada ✓ (en la tienda se ve en un par de minutos)');
  } catch (e) {
    if (e.message !== 'auth') toast('Error al subir la foto: ' + e.message, 'err');
  } finally { lbl.classList.remove('subiendo'); }
}

// ── Filtros, páginas y menú "⋯" de la tabla de productos ─────────────
const PROD_POR_PAG = 25;
let _prodPag = 1, _prodLista = [];
const _prodFiltros = { stock: '', destacados: false, sinSku: false, sinFoto: false };

// mantenerPagina=true cuando la lista se actualiza sola (no por una búsqueda o filtro nuevo)
function filtrarProductos(mantenerPagina) {
  if (mantenerPagina !== true) _prodPag = 1;
  const q = val('prod-search').toLowerCase();
  const f = _prodFiltros;
  let list = _productos.filter(p => !HOJAS_NO_PRODUCTO.includes(p._sheet));
  if (_prodCatFil !== 'Todos') list = list.filter(p => p.categoria === _prodCatFil);
  if (q) list = list.filter(p =>
    String(p.nombre || '').toLowerCase().includes(q) ||
    String(p.color || '').toLowerCase().includes(q) ||
    String(p.marca || '').toLowerCase().includes(q) ||
    String(p.sku || '').toLowerCase().includes(q));
  if (f.stock === 'con') list = list.filter(p => p.stock);
  if (f.stock === 'sin') list = list.filter(p => !p.stock);
  if (f.destacados) list = list.filter(p => p.destacado);
  if (f.sinSku) list = list.filter(p => !String(p.sku || '').trim());
  if (f.sinFoto) list = list.filter(p => !p.imagen);
  actualizarBotonFiltros();
  renderProductos(list);
}

function _filtrosActivos() {
  const f = _prodFiltros;
  return (f.stock ? 1 : 0) + (f.destacados ? 1 : 0) + (f.sinSku ? 1 : 0) + (f.sinFoto ? 1 : 0);
}
function actualizarBotonFiltros() {
  const n = _filtrosActivos(), b = $('filtros-n'), btn = $('btn-filtros');
  if (b) { b.hidden = !n; b.textContent = n; }
  if (btn) btn.classList.toggle('activo', !!n);
}
function toggleFiltros(forzar) {
  const panel = $('filtros-panel'), btn = $('btn-filtros');
  if (!panel || !btn) return;
  const abrir = forzar !== undefined ? forzar : panel.hidden;
  if (abrir === !panel.hidden) return;
  if (abrir) pintarFiltros();
  panel.hidden = !abrir;
  btn.setAttribute('aria-expanded', String(abrir));
}
function pintarFiltros() {
  const f = _prodFiltros, panel = $('filtros-panel');
  const check = (k, txt) => `<label class="filtros-check"><input type="checkbox" data-f="${k}" ${f[k] ? 'checked' : ''}> ${txt}</label>`;
  panel.innerHTML = `
    <div><span class="filtros-tit">Stock</span>
      <div class="seg" role="group" aria-label="Stock">
        ${[['', 'Todos'], ['con', 'Con stock'], ['sin', 'Sin stock']].map(([v, t]) =>
          `<button type="button" class="seg-btn${f.stock === v ? ' on' : ''}" data-stock="${v}" aria-pressed="${f.stock === v}">${t}</button>`).join('')}
      </div>
    </div>
    ${check('destacados', 'Solo destacados')}
    ${check('sinSku', 'Sin SKU cargado')}
    ${check('sinFoto', 'Sin foto')}
    <button type="button" class="filtros-limpiar"${_filtrosActivos() ? '' : ' disabled'}>Limpiar filtros</button>`;
  panel.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', () => {
    f.stock = b.dataset.stock; pintarFiltros(); filtrarProductos();
  }));
  panel.querySelectorAll('[data-f]').forEach(c => c.addEventListener('change', () => {
    f[c.dataset.f] = c.checked; pintarFiltros(); filtrarProductos();
  }));
  panel.querySelector('.filtros-limpiar').addEventListener('click', () => {
    Object.assign(f, { stock: '', destacados: false, sinSku: false, sinFoto: false });
    pintarFiltros(); filtrarProductos();
  });
}

let _menuAbierto = null;
function abrirMenuAcciones(btn, items) {
  if (_menuAbierto && _menuAbierto.btn === btn) { cerrarMenuAcciones(true); return; }
  cerrarMenuAcciones();
  const m = document.createElement('div');
  m.className = 'acc-menu';
  m.setAttribute('role', 'menu');
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'acc-item' + (it.peligro ? ' peligro' : '');
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `<i class="fa-solid ${it.icon}" aria-hidden="true"></i>${escHtml(it.label)}`;
    b.addEventListener('click', ev => { ev.stopPropagation(); cerrarMenuAcciones(); it.fn(); });
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) { top = r.top - h - 6; m.classList.add('arriba'); }
  m.style.top = Math.max(8, top) + 'px';
  m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  _menuAbierto = { m, btn };
  requestAnimationFrame(() => m.classList.add('abierto'));
  m.querySelector('button').focus({ preventScroll: true });
}
function cerrarMenuAcciones(devolverFoco) {
  if (!_menuAbierto) return;
  const { m, btn } = _menuAbierto;
  _menuAbierto = null;
  btn.setAttribute('aria-expanded', 'false');
  m.remove();
  if (devolverFoco) btn.focus({ preventScroll: true });
}
document.addEventListener('click', e => {
  if (_menuAbierto && !_menuAbierto.m.contains(e.target) && !_menuAbierto.btn.contains(e.target)) cerrarMenuAcciones();
  const fw = document.querySelector('.filtros-wrap');
  if (fw && !fw.contains(e.target)) toggleFiltros(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (_menuAbierto) cerrarMenuAcciones(true);
    else if ($('filtros-panel') && !$('filtros-panel').hidden) { toggleFiltros(false); $('btn-filtros').focus(); }
    return;
  }
  if (_menuAbierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = [..._menuAbierto.m.querySelectorAll('.acc-item')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  }
});
window.addEventListener('scroll', () => cerrarMenuAcciones(), true);
window.addEventListener('resize', () => cerrarMenuAcciones());

function urlTienda(p) {
  return `https://virtualshopbaires.com.ar/productos.html?cat=${encodeURIComponent(p.categoria || '')}&buscar=${encodeURIComponent(p.nombre || '')}`;
}
function celdaAcciones() {
  return `<td class="td-acc"><div class="acc-wrap">
    <button type="button" class="btn-editar" title="Editar"><i class="fa-solid fa-pen" aria-hidden="true"></i><span class="btn-editar-txt"> Editar</span></button>
    <button type="button" class="btn-mas" aria-label="Más acciones" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
  </div></td>`;
}
function _estrella(p) { return p.destacado ? '<i class="fa-solid fa-star dest-star" title="Destacado" aria-label="Destacado"></i>' : ''; }

function renderProductos(list) {
  const el = $('prod-table');
  const pag = { set innerHTML(h) { ['prod-pag', 'prod-pag-arriba'].forEach(id => { if ($(id)) $(id).innerHTML = h; }); } };
  _prodLista = list;
  cerrarMenuAcciones();
  if (!list.length) {
    const hayFiltro = val('prod-search') || _prodCatFil !== 'Todos' || _filtrosActivos();
    el.innerHTML = hayFiltro
      ? uiVacio('fa-magnifying-glass', 'No encontramos productos', 'Probá con otra búsqueda, categoría o filtro.', { texto: 'Ver todos', onclick: "$('prod-search').value='';Object.assign(_prodFiltros,{stock:'',destacados:false,sinSku:false,sinFoto:false});setProdCat('Todos')" })
      : uiVacio('fa-box-open', 'Todavía no hay productos', 'Cargá el primero y va a aparecer en la tienda.', { texto: 'Agregar producto', icono: 'fa-plus', onclick: 'abrirModalNuevoProd()' });
    if (pag) pag.innerHTML = '';
    return;
  }
  if (esCelular()) { if (pag) pag.innerHTML = ''; renderProductosCards(list); return; }

  // Filas con el mismo nombre en la misma hoja = un producto con variantes
  const grupos = [], porClave = {};
  list.forEach(p => {
    const k = grupoClave(p);
    if (!porClave[k]) { porClave[k] = []; grupos.push(porClave[k]); }
    porClave[k].push(p);
  });
  const paginas = Math.max(1, Math.ceil(grupos.length / PROD_POR_PAG));
  _prodPag = Math.min(Math.max(1, _prodPag), paginas);
  const desde = (_prodPag - 1) * PROD_POR_PAG;
  const vista = grupos.slice(desde, desde + PROD_POR_PAG);

  el.innerHTML = `
    <table class="prod-tabla">
      <thead><tr>
        <th>Producto</th><th>SKU</th><th>Variante</th><th>Precio</th><th>Stock</th><th class="th-acc">Acciones</th>
      </tr></thead>
      <tbody id="prod-tbody"></tbody>
    </table>`;
  const frag = document.createDocumentFragment();
  vista.forEach(g => {
    if (g.length === 1) { frag.appendChild(buildProdRow(g[0], false)); return; }
    const hijos = g.map(v => buildProdRow(v, true));
    const add = document.createElement('tr');
    add.className = 'prod-var-add';
    add.innerHTML = `<td colspan="6"><button type="button" class="btn-var-add"><i class="fa-solid fa-plus"></i> Agregar variante</button></td>`;
    add.querySelector('button').addEventListener('click', () => abrirAgregarVariante(g));
    hijos.push(add);
    frag.appendChild(buildGrupoRow(g, hijos));
    hijos.forEach(tr => frag.appendChild(tr));
  });
  $('prod-tbody').appendChild(frag);
  pintarPaginacion(grupos.length, desde, vista.length, paginas);
}

function buildGrupoRow(g, hijos) {
  const precios = g.map(v => _precioNum(v.precio));
  const min = Math.min(...precios), max = Math.max(...precios);
  const skus = [...new Set(g.map(v => String(v.sku || '').trim()).filter(Boolean))];
  const conStock = g.filter(v => v.stock).length;
  const opciones = [...new Set(g.map(v => [v.talle, v.color || v.marca].map(x => String(x || '').trim()).filter(Boolean).join(' ')).filter(Boolean))];
  const stockTxt = (conStock === g.length ? 'Con stock' : conStock ? `${conStock} de ${g.length} con stock` : 'Sin stock') + _totalUnidadesTxt(g);
  const stockCls = conStock === g.length ? 'badge-conf' : conStock ? 'badge-pend' : 'badge-cancel';
  const tr = document.createElement('tr');
  tr.className = 'prod-group-row';
  tr.innerHTML = `
    <td class="td-nombre">
      <div class="prod-name-cell">
        ${prodThumb(_miniProducto(g), 64)}
        <div class="prod-name-text">
          <strong>${escHtml(g[0].nombre)}</strong>${_estrella(g[0])}
          <div class="prod-sub"><i class="fa-solid fa-chevron-right prod-group-chev" aria-hidden="true"></i> ${g.length} variantes${opciones.length ? ' · ' + escHtml(opciones.join(' · ')) : ''}</div>
        </div>
      </div>
    </td>
    <td class="td-sku">${skus.length ? escHtml(skus.join(', ')) : '<span class="text-muted">—</span>'}</td>
    <td><span class="pill-var">${g.length} variantes</span></td>
    <td><strong>${min === max ? fmtPrecioSheet(min) : 'desde ' + fmtPrecioSheet(min)}</strong></td>
    <td><span class="badge ${stockCls}">${stockTxt}</span></td>
    ${celdaAcciones()}`;

  const clave = grupoClave(g[0]);
  const fijar = abrir => {
    hijos.forEach(h => { h.hidden = !abrir; });
    tr.classList.toggle('abierto', abrir);
    tr.setAttribute('aria-expanded', String(abrir));
    if (abrir) _gruposAbiertos.add(clave); else _gruposAbiertos.delete(clave);
  };
  fijar(_gruposAbiertos.has(clave));
  tr.addEventListener('click', e => { if (!e.target.closest('.td-acc')) fijar(hijos[0].hidden); });
  tr.querySelector('.btn-editar').addEventListener('click', () => editarProducto(g[0], 'producto'));
  const mas = tr.querySelector('.btn-mas');
  mas.addEventListener('click', () => abrirMenuAcciones(mas, [
    { icon: 'fa-arrow-up-right-from-square', label: 'Ver en la tienda', fn: () => window.open(urlTienda(g[0]), '_blank', 'noopener') },
    { icon: hijos[0].hidden ? 'fa-chevron-down' : 'fa-chevron-up', label: hijos[0].hidden ? 'Ver variantes' : 'Ocultar variantes', fn: () => fijar(hijos[0].hidden) },
    { icon: 'fa-layer-group', label: 'Agregar variante', fn: () => abrirAgregarVariante(g) },
    { icon: 'fa-trash', label: 'Eliminar producto completo', peligro: true, fn: () => eliminarGrupo(g) },
  ]));
  return tr;
}

// Los botones de páginas van abajo y también arriba de la lista
function pintarPaginacion(total, desde, n, paginas) {
  ['prod-pag', 'prod-pag-arriba'].forEach(id => _pintarPaginacionEn($(id), total, desde, n, paginas));
}
function _pintarPaginacionEn(el, total, desde, n, paginas) {
  if (!el) return;
  const nums = [];
  if (paginas <= 7) for (let i = 1; i <= paginas; i++) nums.push(i);
  else {
    const set = new Set([1, paginas, _prodPag - 1, _prodPag, _prodPag + 1]);
    if (_prodPag <= 4) [2, 3, 4, 5].forEach(x => set.add(x));
    if (_prodPag >= paginas - 3) [paginas - 4, paginas - 3, paginas - 2, paginas - 1].forEach(x => set.add(x));
    [...set].filter(x => x >= 1 && x <= paginas).sort((a, b) => a - b).forEach((x, i, arr) => {
      if (i && x - arr[i - 1] > 1) nums.push('…');
      nums.push(x);
    });
  }
  el.innerHTML = `
    <span class="pag-info">Mostrando ${desde + 1}–${desde + n} de ${total} producto${total === 1 ? '' : 's'}</span>
    ${paginas > 1 ? `<nav class="pag-nav" aria-label="Páginas de productos">
      <button type="button" class="pag-btn" data-p="${_prodPag - 1}" ${_prodPag === 1 ? 'disabled' : ''} aria-label="Página anterior"><i class="fa-solid fa-chevron-left"></i></button>
      ${nums.map(x => x === '…' ? '<span class="pag-gap">…</span>'
        : `<button type="button" class="pag-btn${x === _prodPag ? ' on' : ''}" data-p="${x}"${x === _prodPag ? ' aria-current="page"' : ''}>${x}</button>`).join('')}
      <button type="button" class="pag-btn" data-p="${_prodPag + 1}" ${_prodPag === paginas ? 'disabled' : ''} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right"></i></button>
    </nav>` : ''}`;
  el.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
    _prodPag = Number(b.dataset.p);
    renderProductos(_prodLista);
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('sec-productos').scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' });
  }));
}

const _gruposAbiertos = new Set();

function grupoClave(p) {
  return p._sheet + '|' + String(p.nombre || '').trim();
}

// Formulario para sumar una variante (color, modelo, medida…) a un producto
function abrirAgregarVariante(grupo) {
  const ult = grupo[grupo.length - 1];
  const esUnico = grupo.length === 1;
  const precioN = Number(String(ult.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  document.getElementById('modal-nueva-var')?.remove();

  const m = document.createElement('div');
  m.id = 'modal-nueva-var';
  m.className = 'modal-backdrop';
  m.style.display = 'flex';
  m.innerHTML = `
    <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="nv-titulo">
      <div class="modal-header">
        <h3 id="nv-titulo">Agregar variante</h3>
        <button class="modal-close" type="button" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body">
        <p class="text-muted" style="font-size:.82rem;margin-bottom:12px"><strong>${escHtml(ult.nombre)}</strong><br>
          Variantes actuales: ${grupo.map(v => escHtml(v.color || '—')).join(', ')}</p>
        ${esUnico ? `
        <div class="form-group">
          <label for="nv-actual">Nombre de la variante que ya existe</label>
          <input type="text" id="nv-actual" value="${escHtml(ult.color || '')}" placeholder="Ej: Rojo">
          <small class="text-muted">Si dice "Único", cambialo por el color o modelo real.</small>
        </div>` : ''}
        <div class="form-group">
          <label for="nv-color">Nueva variante (color, modelo, medida…)</label>
          <input type="text" id="nv-color" placeholder="Ej: Azul" autocomplete="off">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="nv-precio">Precio ($)</label>
            <input type="number" id="nv-precio" min="0" step="1" value="${precioN}">
          </div>
          <div class="form-group">
            <label for="nv-sku">SKU</label>
            <input type="text" id="nv-sku" value="${escHtml(ult.sku || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>Foto de la variante (opcional)</label>
          <div style="display:flex;align-items:center;gap:10px">
            <span id="nv-prev">${prodThumb('', 56)}</span>
            <label class="btn-secondary btn-sm" style="cursor:pointer">
              <i class="fa-solid fa-image"></i> Elegir foto
              <input type="file" id="nv-foto" accept="image/*" style="display:none">
            </label>
          </div>
        </div>
        <p id="nv-err" class="err-msg" role="alert"></p>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" type="button" data-cerrar>Cancelar</button>
        <button class="btn-primary" type="button" id="nv-guardar"><i class="fa-solid fa-plus"></i> Agregar variante</button>
      </div>
    </div>`;
  document.body.appendChild(m);

  let fotoData = null;
  const cerrar = () => m.remove();
  m.addEventListener('click', e => { if (e.target === m) cerrar(); });
  m.querySelector('.modal-close').addEventListener('click', cerrar);
  m.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  m.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  m.querySelector('#nv-foto').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      fotoData = await _prepararFoto(f);
      m.querySelector('#nv-prev').innerHTML = prodThumb(fotoData, 56);
    } catch (err) { m.querySelector('#nv-err').textContent = err.message; }
  });
  m.querySelector('#nv-color').addEventListener('keydown', e => { if (e.key === 'Enter') m.querySelector('#nv-guardar').click(); });
  m.querySelector('#nv-color').focus();

  m.querySelector('#nv-guardar').addEventListener('click', async () => {
    const btn = m.querySelector('#nv-guardar');
    const err = m.querySelector('#nv-err');
    const color = m.querySelector('#nv-color').value.trim();
    const actual = esUnico ? m.querySelector('#nv-actual').value.trim() : null;
    err.textContent = '';
    if (!color) { err.textContent = 'Escribí el nombre de la nueva variante.'; return; }
    if (grupo.some(v => String(v.color || '').trim().toLowerCase() === color.toLowerCase()) ||
        (actual && actual.toLowerCase() === color.toLowerCase())) {
      err.textContent = 'Esa variante ya existe.'; return;
    }
    if (fotoData && _ghOk === false) { err.textContent = 'Para subir la foto falta configurar GH_TOKEN. Podés agregarla sin foto.'; return; }

    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Agregando…';
    try {
      if (esUnico && actual && actual !== String(ult.color || '').trim()) {
        const r0 = await actualizarCampo(ult, 'color', actual);
        if (r0 && r0.ok === false) throw new Error(r0.error);
      }
      const params = {
        action: 'ext_variante_agregar', sheet: ult._sheet, row: String(ult._row), nombre: ult.nombre,
        color, precio: m.querySelector('#nv-precio').value, sku: m.querySelector('#nv-sku').value.trim()
      };
      if (fotoData) params.data = fotoData;
      const r = await crmEnviar(params);
      if (!r || r.ok === false) throw new Error((r && r.error) || 'error');
      _gruposAbiertos.add(grupoClave(ult));
      cerrar();
      toast(`Variante "${color}" agregada ✓`);
      delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
    } catch (e) {
      err.textContent = 'No se pudo agregar: ' + e.message;
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus"></i> Agregar variante';
    }
  });
}

function buildProdRow(p, esVariante) {
  const precioN = _precioNum(p.precio);
  const colorMarca = String(p.color || p.marca || '').trim();
  const talle = String(p.talle || '').trim();
  let pVal = precioN, sVal = p.stock ? 1 : 0;

  const renderStock = v => _switchStock(v);
  const sub = esVariante ? talle : (p.subcategoria || (_prodCatFil === 'Todos' ? p.categoria : ''));
  const variante = [talle, colorMarca].filter(Boolean).join(' · ') || 'Único';

  const tr = document.createElement('tr');
  if (esVariante) tr.className = 'prod-var-row';
  tr.innerHTML = `
    <td class="td-nombre">
      <div class="prod-name-cell${esVariante ? ' es-variante' : ''}">
        ${prodThumb(esVariante ? p.imagen : _miniProducto([p]), esVariante ? 44 : 64)}
        <div class="prod-name-text">
          <strong>${escHtml(esVariante ? (colorMarca || talle || '—') : p.nombre)}</strong>${_estrella(p)}
          ${sub ? `<div class="prod-sub">${escHtml(sub)}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="td-editable td-sku">${renderSku(p.sku)}</td>
    <td><span class="pill-var">${escHtml(variante)}</span></td>
    <td class="td-editable td-precio"><strong>${fmtPrecioSheet(p.precio)}</strong><i class="fa-solid fa-pen edit-hint"></i></td>
    <td class="td-toggle td-stock" title="Tocá el interruptor o escribí cuántas unidades hay"><div class="stock-ctl">${renderStock(sVal)}${_inputCantidad(p)}</div></td>
    ${celdaAcciones()}`;

  tr.querySelector('.td-nombre').addEventListener('click', () => editarProducto(p, esVariante ? 'variante' : 'completo'));
  tr.querySelector('.td-precio').addEventListener('click', function() {
    editarCeldaNum(this, p, 'precio', pVal, v => { pVal = v; p.precio = v; }, '$');
  });
  tr.querySelector('.td-sku').addEventListener('click', function() { editarCeldaSku(this, p); });
  const tdStock = tr.querySelector('.td-stock'), inpCant = tdStock.querySelector('.stock-cant');
  const pintarStock = () => { sVal = p.stock ? 1 : 0; _ponerSwitch(tdStock.querySelector('.stock-ctl'), sVal); inpCant.value = _valCantidad(p); };
  tdStock.addEventListener('click', function(e) {
    if (e.target.closest('.stock-cant')) return;   // escribir el número no cambia el interruptor
    const antes = { stock: p.stock, cantidad: p.cantidad };
    _stockLocal(p, !p.stock); pintarStock();
    actualizarCampo(p, 'stock', p.stock)
      .then(r => { if (r.ok === false) throw new Error(r.error); toast('Stock actualizado ✓'); lsGuardar('productos', _productos); })
      .catch(() => { Object.assign(p, antes); pintarStock(); toast('Error al guardar stock', 'err'); });
  });
  _activarCantidad(inpCant, p, pintarStock);
  tr.querySelector('.btn-editar').addEventListener('click', () => editarProducto(p, esVariante ? 'variante' : 'completo'));
  const mas = tr.querySelector('.btn-mas');
  mas.addEventListener('click', () => abrirMenuAcciones(mas, [
    { icon: 'fa-arrow-up-right-from-square', label: 'Ver en la tienda', fn: () => window.open(urlTienda(p), '_blank', 'noopener') },
    ...(esVariante ? [] : [{ icon: 'fa-layer-group', label: 'Agregar variante', fn: () => abrirAgregarVariante([p]) }]),
    { icon: 'fa-star', label: p.destacado ? 'Quitar de destacados' : 'Marcar como destacado', fn: () => {
      const nuevo = !p.destacado; p.destacado = nuevo;
      actualizarCampo(p, 'destacado', nuevo)
        .then(r => { if (r && r.ok === false) throw new Error(r.error); toast(nuevo ? 'Destacado ✓' : 'Ya no es destacado ✓'); lsGuardar('productos', _productos); filtrarProductos(true); })
        .catch(() => { p.destacado = !nuevo; toast('No se pudo guardar', 'err'); });
    } },
    { icon: 'fa-trash', label: esVariante ? 'Eliminar esta variante' : 'Eliminar producto', peligro: true, fn: () => eliminarProducto(p) },
  ]));
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

// Modos de la ficha:
//   'producto' → datos de todo el producto (nombre, descripción, destacado, galería) + lista de variantes
//   'variante' → solo esa variante (color, talle, precio, stock, SKU y su foto)
//   'completo' → producto de una sola variante: todo junto
let _modoFicha = 'completo';
function editarProducto(p, modo) {
  if (typeof p === 'string') p = JSON.parse(p);
  const abierta = $('modal-producto').style.display === 'flex';
  if (abierta && _prodActual && _mprodInicial && JSON.stringify(_leerFormProd()) !== JSON.stringify(_mprodInicial)) {
    confirmar('Tenés cambios sin guardar en esta ficha. ¿Salir sin guardarlos?', () => { _mprodInicial = null; editarProducto(p, modo); });
    return;
  }
  _prodActual = p;
  const vars = hermanos(p);
  _modoFicha = modo || (vars.length > 1 ? 'variante' : 'completo');

  $('mprod-title').textContent   = p.nombre || p.categoria || 'Producto';
  $('mprod-nombre').value        = p.nombre || '';
  $('mprod-color').value         = p.color || p.marca || '';
  $('mprod-talle').value         = p.talle || '';
  $('mprod-descripcion').value   = p.descripcion || '';
  if ($('mprod-sku')) $('mprod-sku').value = p.sku || '';

  // En la tienda: "descuento" es el precio que se cobra y "precio" el que se muestra tachado
  const base = _precioNum(p.precio), desc = _precioNum(p.descuento);
  const conRebaja = desc > 0 && desc < base;
  $('mprod-precio').value      = conRebaja ? desc : base;
  $('mprod-descuento').value   = conRebaja ? base : '';
  setStockModal(!!p.stock, p.cantidad);
  $('mprod-destacado').checked = !!p.destacado;
  $('mprod-destacado').closest('.dest-tile').classList.toggle('on', !!p.destacado);

  // Categoría: la del producto (se elige al crearlo)
  const wrap = $('mprod-cats-chips');
  wrap.innerHTML = `<span class="cat-chip cat-chip-sel">${escHtml(p.categoria || p._sheet)}</span>`;
  _mprodInicial = _leerFormProd();   // para mandar solo lo que cambió

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

  if (_modoFicha === 'producto') {
    info.innerHTML = `<label>Variantes (${vars.length})</label>
       <div class="mprod-var-list mprod-var-edit">${vars.map((v, j) => `
         <div class="mprod-var">${prodThumb(v.imagen, 36)}<span class="mv-txt"><b>${escHtml(v.color || v.talle || '—')}</b> · ${fmtPrecioSheet(v.precio)} · ${v.stock ? 'Con stock' : 'Sin stock'}${_unidadesTxt(v)}</span>
           <button type="button" class="fv-btn" data-j="${j}"><i class="fa-solid fa-pen" aria-hidden="true"></i> Editar variante</button></div>`).join('')}
       </div>
       <p class="text-muted" style="font-size:.75rem;margin-top:6px">Precio, stock, SKU y foto se cambian en cada variante.</p>`;
    info.querySelectorAll('button[data-j]').forEach(b => b.addEventListener('click', () => editarProducto(vars[Number(b.dataset.j)], 'variante')));
  } else if (_modoFicha === 'variante') info.innerHTML = '';
  _aplicarModoFicha(p, vars);

  $('fotos-grid').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  show('modal-producto', 'flex');
  const cuerpo = document.querySelector('#modal-producto .mprod-body'); if (cuerpo) cuerpo.scrollTop = 0;
  if (typeof cargarFotos === 'function') cargarFotos(p);
}

// Muestra solo los campos que corresponden a cada modo
function _aplicarModoFicha(p, vars) {
  const m = _modoFicha, grupo = id => $(id) && $(id).closest('.form-group');
  const ver = (el, si) => { if (el) el.style.display = si ? '' : 'none'; };
  const prod = m !== 'variante', varia = m !== 'producto';
  ver(grupo('mprod-nombre'), prod); ver(grupo('mprod-cats-chips'), prod);
  ver(grupo('mprod-color'), varia); ver(grupo('mprod-talle'), varia);
  ver(grupo('mprod-precio'), varia); ver(grupo('mprod-descuento'), varia); ver(grupo('mprod-stock-num'), varia); ver(grupo('mprod-sku'), varia);
  ver(grupo('mprod-destacado'), prod); ver(grupo('mprod-descripcion'), prod);
  const secs = document.querySelectorAll('#modal-producto .mprod-sec');
  const h = (i, t) => { const e = secs[i] && secs[i].querySelector('h4'); if (e) e.textContent = t; };
  h(0, m === 'variante' ? 'Datos de la variante' : 'Información del producto');
  h(1, m === 'producto' ? 'Visibilidad' : 'Precio e inventario');
  h(2, m === 'variante' ? 'Foto de la variante' : (m === 'producto' ? 'Descripción y fotos del producto' : 'Descripción e imágenes'));
  const lblFotos = grupo('fotos-grid') && grupo('fotos-grid').querySelector('label');
  if (lblFotos) { lblFotos.textContent = 'Imágenes del producto'; lblFotos.style.display = m === 'variante' ? 'none' : ''; }
  $('mprod-h').textContent = m === 'variante' ? 'Editar variante' : 'Editar producto';
  $('mprod-title').textContent = m === 'variante'
    ? (p.nombre || '') + ' · ' + (p.color || p.talle || 'Variante')
    : (p.nombre || p.categoria || 'Producto');
  const etiqueta = document.querySelector('label[for="mprod-color"]');
  if (etiqueta) etiqueta.textContent = vars.length > 1 ? 'Nombre de la variante (color / modelo)' : 'Color / Marca';
  $('modal-producto').querySelector('.modal-prod').dataset.modo = m;
}

// Valores de la ficha tal como están en pantalla
let _mprodInicial = null;
function _leerFormProd() {
  return {
    nombre:      $('mprod-nombre').value.trim(),
    color:       $('mprod-color').value.trim(),
    talle:       $('mprod-talle').value.trim(),
    descripcion: $('mprod-descripcion').value.trim(),
    sku:         $('mprod-sku') ? $('mprod-sku').value.trim() : '',
    actual:      Number($('mprod-precio').value) || 0,
    anterior:    Number($('mprod-descuento').value) || 0,
    cantidad:    _leerCantidad($('mprod-stock-num').value),
    stock:       !!document.querySelector('#modal-producto [data-stock-m="1"].on'),
    destacado:   $('mprod-destacado').checked,
  };
}

// Guardar: se cierra al instante y se guarda por detrás en UN solo pedido con lo que cambió.
// Si el servidor falla, se vuelven los datos atrás y se avisa.
async function guardarProducto() {
  if (!_prodActual) return;
  const p = _prodActual;
  const vars = hermanos(p);
  const f = _leerFormProd(), ini = _mprodInicial || {};
  if (f.actual <= 0) { toast('Poné el precio actual', 'err'); $('mprod-precio').focus(); return; }
  if (f.anterior && f.anterior <= f.actual) { toast('El precio anterior tiene que ser mayor que el actual', 'err'); $('mprod-descuento').focus(); return; }
  // Con precio anterior: se guarda como precio (tachado) y el actual como descuento
  const precio    = f.anterior ? f.anterior : f.actual;
  const descuento = f.anterior ? f.actual : '';

  const variante = {}, producto = {};
  if (f.color !== ini.color) variante.color = f.color;
  if (f.talle !== ini.talle) variante['talle/medida'] = f.talle;
  if (f.sku !== ini.sku) variante.sku_costo = f.sku;
  if (f.actual !== ini.actual || f.anterior !== ini.anterior) { variante.precio = precio; variante.descuento = descuento; }
  if (f.stock !== ini.stock) variante.stock = f.stock;
  if (f.cantidad !== ini.cantidad) variante.cantidad = f.cantidad;
  if (f.nombre && f.nombre !== ini.nombre) producto.producto = f.nombre;
  if (f.descripcion !== ini.descripcion) producto.descripcion = f.descripcion;
  if (f.destacado !== ini.destacado) producto.destacado = f.destacado;

  hide('modal-producto');
  // Las fotos que todavía se están subiendo se terminan de guardar solas, aunque se cierre la ficha
  const fotosEnCurso = _fotosPendientes();
  if (!Object.keys(variante).length && !Object.keys(producto).length) {
    toast(fotosEnCurso ? 'Guardando las fotos… no cierres el CRM hasta que terminen' : 'Sin cambios');
    return;
  }

  // Se ve el cambio enseguida en la lista
  const antesP = { color: p.color, talle: p.talle, sku: p.sku, precio: p.precio, descuento: p.descuento, stock: p.stock, cantidad: p.cantidad };
  const antesV = vars.map(v => ({ v, nombre: v.nombre, descripcion: v.descripcion, destacado: v.destacado }));
  Object.assign(p, { color: f.color, talle: f.talle, sku: f.sku, precio, descuento, stock: f.stock, cantidad: f.cantidad });
  vars.forEach(v => Object.assign(v, { nombre: f.nombre || v.nombre, descripcion: f.descripcion, destacado: f.destacado }));
  filtrarProductos(true);
  toast(fotosEnCurso ? 'Guardando… (las fotos se terminan de subir solas)' : 'Guardando…');

  try {
    // Si cambia el nombre, se espera a que terminen las fotos (se suben con el nombre de antes)
    if (producto.producto && fotosEnCurso) await _enColaFotos(() => _guardarCambiosProducto(p, vars, variante, producto));
    else await _guardarCambiosProducto(p, vars, variante, producto);
    lsGuardar('productos', _productos);
    toast('Producto guardado ✓');
  } catch (e) {
    Object.assign(p, antesP);
    antesV.forEach(a => Object.assign(a.v, { nombre: a.nombre, descripcion: a.descripcion, destacado: a.destacado }));
    filtrarProductos(true);
    if (e.message !== 'auth') toast('No se guardó "' + (f.nombre || p.nombre) + '": ' + e.message, 'err');
  }
}

async function _guardarCambiosProducto(p, vars, variante, producto) {
  const r = await crmEnviar({ action: 'ext_producto_guardar', sheet: p._sheet, row: String(p._row),
    variante: JSON.stringify(variante), producto: JSON.stringify(producto) });
  if (r && r.ok) return;
  if (!/Acción desconocida|no disponible/.test((r && r.error) || '')) throw new Error((r && r.error) || 'sin respuesta');
  // Servidor anterior (o productos en la planilla): un pedido por campo, todos a la vez
  const tareas = Object.entries(variante).map(([campo, valor]) => actualizarCampo(p, campo, valor));
  vars.forEach(v => Object.entries(producto).forEach(([campo, valor]) => tareas.push(actualizarCampo(v, campo, valor))));
  const rs = await Promise.all(tareas);
  const mal = rs.find(x => x && x.ok === false && !/Campo no encontrado/.test(x.error || ''));
  if (mal) throw new Error(mal.error);
}

// Stock y destacado de la ficha
// "cant": unidades en stock ('' = sin contar). Los botones y el número siempre van de acuerdo.
function setStockModal(con, cant) {
  const inp = $('mprod-stock-num');
  if (cant !== undefined) inp.value = cant === '' || cant == null ? '' : Number(cant);
  else if (!con) inp.value = 0;
  else if (inp.value === '0') inp.value = '';
  _pintarBotonesStock(con);
}
function _pintarBotonesStock(con) {
  document.querySelectorAll('[data-stock-m]').forEach(b => {
    const on = (b.dataset.stockM === '1') === con;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
// Directo en los botones: la ficha frena los clics antes de que lleguen al documento
document.querySelectorAll('[data-stock-m]').forEach(b => b.addEventListener('click', () => setStockModal(b.dataset.stockM === '1')));
document.addEventListener('input', e => {
  if (e.target.id === 'mprod-stock-num' && e.target.value !== '') _pintarBotonesStock(Number(e.target.value) > 0);
});
document.addEventListener('change', e => {
  if (e.target.id === 'mprod-destacado') e.target.closest('.dest-tile').classList.toggle('on', e.target.checked);
});

// ─── FOTOS DEL PRODUCTO (las mismas que muestra la tienda) ──────

let _fotosProd = [];
let _ghOk = null;

// Las acciones sobre fotos van de a una y con la lista del momento: si se quita una foto
// mientras otra se sube, ninguna pisa a la otra. Lo pendiente se ve enseguida en pantalla.
let _colaFotos = Promise.resolve(), _opsFotos = 0;
const _galerias = {}, _fotosQuitando = new Set(), _subidas = {};
function _enColaFotos(fn) {
  _opsFotos++;
  const r = _colaFotos.then(fn).finally(() => { _opsFotos--; });
  _colaFotos = r.catch(() => {});
  return r;
}
function _fotosPendientes() { return _opsFotos + Object.values(_subidas).reduce((a, b) => a + b, 0); }
// Cerrar o recargar el CRM con fotos subiéndose las perdería: el navegador pregunta antes
window.addEventListener('beforeunload', e => { if (_fotosPendientes() > 0) { e.preventDefault(); e.returnValue = ''; } });
function _claveGal(p) { return (p._sheet || p.categoria) + '|' + String(p.nombre || '').trim(); }
function _claveSub(p, enVariante) { return enVariante ? 'v:' + p._row : 'p:' + _claveGal(p); }
function _galeriaDe(p) { return (_galerias[_claveGal(p)] || []).slice(); }
function _ponerGaleria(p, urls) {
  _galerias[_claveGal(p)] = urls.slice();
  if (_prodActual && _claveGal(_prodActual) === _claveGal(p)) _fotosProd = urls.slice();
}
// Vuelve a dibujar las fotos solo si la ficha abierta es de ese producto
function _repintarFotos(p) {
  if (_prodActual && _claveGal(_prodActual) === _claveGal(p)) renderFotos(_prodActual);
}

// ─── PAPELERA: las fotos quitadas se pueden recuperar durante 5 minutos ───
// Después el servidor las borra para siempre (salvo que otro producto o variante las use).
const _PAPELERA_MS = 5 * 60 * 1000;
const _papelera = {};   // clave del producto → [{ url, vid, vence }]
let _papeleraReloj = null;
function _vidDe(p) { const m = /^v(\d+)$/.exec(String(p._row || '')); return m ? Number(m[1]) : null; }
function _papeleraDe(p, enVariante) {
  const vid = enVariante ? _vidDe(p) : null, ahora = Date.now();
  return (_papelera[_claveGal(p)] || []).filter(x => x.vence > ahora && (x.vid || null) === vid);
}
function _papeleraAnotar(p, url, enVariante) {
  const k = _claveGal(p), lista = (_papelera[k] || []).filter(x => x.url !== url);
  lista.push({ url, vid: enVariante ? _vidDe(p) : null, vence: Date.now() + _PAPELERA_MS });
  _papelera[k] = lista;
}
function _papeleraSacar(p, url) {
  const k = _claveGal(p);
  _papelera[k] = (_papelera[k] || []).filter(x => fotoSrcCRM(x.url) !== fotoSrcCRM(url));
}
async function _cargarPapelera(p) {
  try {
    const r = await crmEnviar({ action: 'fotos_papelera', categoria: p._sheet || p.categoria, nombre: p.nombre });
    if (!r || !r.ok || !Array.isArray(r.fotos)) return;   // servidor viejo: sin papelera
    const ahora = Date.now();
    _papelera[_claveGal(p)] = r.fotos.map(x => ({ url: x.url, vid: x.vid || null, vence: ahora + x.quedan * 1000 }));
    _repintarFotos(p);
  } catch (e) { /* sin conexión: la papelera se ve la próxima vez */ }
}
function _papeleraHTML(items) {
  if (!items.length) return '';
  return `<div class="fotos-papelera">
      <div class="fp-tit"><b><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Quitadas recién</b><span>Se borran para siempre a los 5 minutos. Hasta entonces las podés recuperar.</span></div>
      <div class="fp-lista">${items.map(x => `
        <div class="fp-item">
          <img src="${escHtml(fotoSrcCRM(x.url))}" alt="" loading="lazy" onerror="fotoRespaldo(this)">
          <span class="fp-tiempo" data-vence="${x.vence}">${_papeleraFalta(x.vence)}</span>
          <button type="button" class="fv-btn fp-recuperar" data-url="${escHtml(x.url)}"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Recuperar</button>
        </div>`).join('')}</div>
    </div>`;
}
function _papeleraFalta(vence) {
  const s = Math.max(0, Math.ceil((vence - Date.now()) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
// Cuenta regresiva: cuando vence una, desaparece de la lista
function _papeleraTic() {
  const marcas = document.querySelectorAll('#fotos-grid .fp-tiempo');
  if (!marcas.length) { clearInterval(_papeleraReloj); _papeleraReloj = null; return; }
  let vencio = false;
  marcas.forEach(el => { const v = Number(el.dataset.vence); el.textContent = _papeleraFalta(v); if (v <= Date.now()) vencio = true; });
  if (vencio && _prodActual) renderFotos(_prodActual);
}
function _recuperarFoto(p, url, enVariante) {
  const k = _claveGal(p), antes = (_papelera[k] || []).slice();
  const err = e => { if (e.message !== 'auth') toast('No se pudo recuperar: ' + e.message, 'err'); };
  _papeleraSacar(p, url); _repintarFotos(p);
  _enColaFotos(() => {
    if (enVariante) {
      const urls = _fotosVarDe(p);
      if (urls.some(u => fotoSrcCRM(u) === fotoSrcCRM(url))) return;
      return _guardarFotosVariante(p, p, urls.concat(url), 'Foto recuperada ✓');
    }
    const urls = _galeriaDe(p);
    if (urls.some(u => fotoSrcCRM(u) === fotoSrcCRM(url))) return;
    return guardarFotos(p, urls.concat(url), 'Foto recuperada ✓');
  }).catch(e => { _papelera[k] = antes; _repintarFotos(p); err(e); });
}

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

// Lectura pública (la misma clave que usa la tienda): solo ve productos visibles
const _SB_URL = 'https://dtsixnqwwrbwybulpuxo.supabase.co', _SB_PUB = 'sb_publishable_nGmdSmwKGuiF5LG9fbA8dw_auHYFgCM';
async function _fotosDeSupabase(categoria, nombre) {
  const q = `${_SB_URL}/rest/v1/productos?select=imagenes&categoria=eq.${encodeURIComponent(categoria)}&nombre=eq.${encodeURIComponent(nombre)}`;
  const r = await fetch(q, { headers: { apikey: _SB_PUB }, cache: 'no-store' });
  if (!r.ok) return [];
  const f = await r.json();
  return (f[0] && f[0].imagenes) || [];
}

async function cargarFotos(p) {
  const grid = $('fotos-grid');
  grid.innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  try {
    if (_ghOk === null) {
      try { _ghOk = !!(await crmEnviar({ action: 'gh_estado' })).gh; } catch (e) { _ghOk = false; }
    }
    // Las fotos salen de Supabase, igual que en la tienda (el manifest viejo queda de respaldo)
    let fotos = await _fotosDeSupabase(p._sheet || p.categoria, p.nombre);
    if (!fotos.length) fotos = _fotosDelManifest(await _leerManifestTienda(), p._sheet || p.categoria, p.nombre);
    // Con cambios de fotos todavía en curso, manda lo último que se guardó desde acá
    if (_opsFotos && _galerias[_claveGal(p)]) fotos = _galeriaDe(p);
    _galerias[_claveGal(p)] = fotos.slice();
    _fotosProd = fotos;
    renderFotos(p);
    if (_fotosProd[0]) _fijarFotoPrincipal(p, _fotosProd[0]);
    _cargarPapelera(p);
  } catch (e) {
    grid.innerHTML = '<p class="text-muted">No se pudieron cargar las fotos</p>';
  }
}

// Fotos de una variante (la primera es la principal)
function _fotosVarDe(v) {
  return (Array.isArray(v.imagenes) && v.imagenes.length ? v.imagenes : (v.imagen ? [v.imagen] : [])).slice();
}

function renderFotos(p) {
  const grid = $('fotos-grid');
  const enVariante = _modoFicha === 'variante';
  const claveSub = _claveSub(p, enVariante);
  const lista = (enVariante ? _fotosVarDe(p) : _fotosProd).filter(u => !_fotosQuitando.has(claveSub + '|' + u));
  const fotosHTML = lista.map((url, i) => `
        <div class="foto-tile">
          <img src="${escHtml(fotoSrcCRM(url))}" style="${fotoEstiloCRM(url)}" alt="Foto ${i + 1}" loading="lazy" onerror="fotoRespaldo(this)">
          ${i === 0 ? '<span class="foto-principal">Principal</span>' : `<button type="button" class="foto-btn foto-btn-star" data-acc="principal" data-i="${i}" title="Hacer principal" aria-label="Hacer principal"><i class="fa-solid fa-star"></i></button>`}
          <button type="button" class="foto-btn foto-btn-copiar" data-acc="copiar" data-url="${escHtml(fotoSrcCRM(url))}" title="Copiar foto" aria-label="Copiar foto ${i + 1}"><i class="fa-regular fa-copy"></i></button>
          <button type="button" class="foto-btn foto-btn-crop" data-acc="encuadre" data-i="${i}" title="Encuadrar" aria-label="Encuadrar foto ${i + 1}"><i class="fa-solid fa-crop-simple"></i></button>
          <button type="button" class="foto-btn foto-btn-x" data-acc="quitar" data-i="${i}" title="Quitar de la tienda" aria-label="Quitar foto"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
    + '<div class="foto-tile foto-subiendo" role="status"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Subiendo…</span></div>'.repeat(_subidas[claveSub] || 0)
    + (_ghOk === false ? '' : `<label for="foto-input" class="foto-add" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();$('foto-input').click()}"><i class="fa-solid fa-plus"></i><span>Agregar imagen</span><small class="foto-add-drag">o arrastrala acá</small></label>`);

  // Foto de cada variante: bloque aparte, una fila por variante con sus botones
  const todas = _modoFicha === 'variante' ? [p] : (_modoFicha === 'producto' ? [] : hermanos(p));
  const varsHTML = (todas.length > 1 || _modoFicha === 'variante')
    ? `<div class="fotos-variantes">
         ${_modoFicha === 'variante' ? '' : '<div class="fv-head"><b>Foto de cada variante</b><span>Es la foto que ve el cliente cuando elige ese color o modelo.</span></div>'}
         <div class="fv-lista">${todas.map((v, j) => {
           const nom = escHtml(v.color || v.talle || 'Variante ' + (j + 1));
           return `
           <div class="fv-item${v === p ? ' actual' : ''}${_subidas[_claveSub(v, true)] ? ' subiendo' : ''}" data-j="${j}">
             <div class="fv-foto">${v.imagen
               ? `<img src="${escHtml(fotoSrcCRM(v.imagen))}" style="${fotoEstiloCRM(v.imagen)}" alt="Foto de ${nom}" loading="lazy" onerror="fotoRespaldo(this)">`
               : '<i class="fa-regular fa-image" aria-hidden="true"></i>'}</div>
             <div class="fv-info"><b>${nom}</b><small>${_modoFicha === 'variante' ? 'Es la que ve el cliente al elegir esta variante. Podés arrastrar una foto acá.' : (v === p ? 'La que estás editando' : (v.imagen ? 'Arrastrá una foto acá para cambiarla' : 'Sin foto propia'))}</small></div>
             <div class="fv-acc">
               ${_ghOk === false ? '' : `<label class="fv-btn fv-btn-main"><i class="fa-solid fa-upload" aria-hidden="true"></i> Cambiar foto<input type="file" accept="image/*" class="sr-only" data-acc="var-subir" data-j="${j}"></label>`}
               ${_fotosProd.length ? `<button type="button" class="fv-btn" data-acc="var-elegir" data-j="${j}"><i class="fa-regular fa-images" aria-hidden="true"></i> Elegir de la galería</button>` : ''}
               ${v.imagen ? `<button type="button" class="fv-btn fv-ico" data-acc="encuadre-var" data-j="${j}" title="Encuadrar" aria-label="Encuadrar foto de ${nom}"><i class="fa-solid fa-crop-simple"></i></button>
               <button type="button" class="fv-btn fv-ico" data-acc="copiar" data-url="${escHtml(fotoSrcCRM(v.imagen))}" title="Copiar foto" aria-label="Copiar foto de ${nom}"><i class="fa-regular fa-copy"></i></button>` : ''}
             </div>
             <div class="fv-galeria" hidden>${_fotosProd.map(u => `<button type="button" class="fv-elegir" data-acc="var-usar" data-j="${j}" data-url="${escHtml(u)}" aria-label="Usar esta foto para ${nom}"><img src="${escHtml(fotoSrcCRM(u))}" alt="" loading="lazy" onerror="fotoRespaldo(this)"></button>`).join('')}</div>
           </div>`; }).join('')}
         </div>
       </div>`
    : '';

  const aviso = _ghOk === false
    ? '<p class="text-muted" style="font-size:.75rem;color:var(--red)">Para subir o cambiar fotos falta configurar GH_TOKEN en el Apps Script del CRM.</p>'
    : '';

  const deGaleria = _fotosProd.filter(u => !lista.some(f => fotoSrcCRM(f) === fotoSrcCRM(u)));
  const papeleraHTML = _papeleraHTML(_papeleraDe(p, enVariante));
  grid.innerHTML = enVariante
    ? `<div class="fotos-bloque-tit"><span>Son las fotos que ve el cliente al elegir esta variante. La primera es la principal; con ★ elegís otra.</span></div>
       <div class="fotos-tiles">${fotosHTML}</div>${papeleraHTML}
       ${deGaleria.length ? `<div class="fv-desde-galeria"><button type="button" class="fv-btn" data-acc="var-elegir"><i class="fa-regular fa-images" aria-hidden="true"></i> Sumar una foto de la galería del producto</button>
         <div class="fv-galeria" hidden>${deGaleria.map(u => `<button type="button" class="fv-elegir" data-acc="var-usar" data-url="${escHtml(u)}" aria-label="Sumar esta foto a la variante"><img src="${escHtml(fotoSrcCRM(u))}" alt="" loading="lazy" onerror="fotoRespaldo(this)"></button>`).join('')}</div></div>` : ''}
       ${aviso}`
    : `<div class="fotos-bloque-tit"><span>Se ven en la ficha de la tienda, en este orden. La primera es la principal; con ★ elegís otra.</span></div><div class="fotos-tiles">${fotosHTML}</div>${papeleraHTML}${varsHTML}${aviso}`;
  _activarArrastreFotos(grid);
  grid.querySelectorAll('.fp-recuperar').forEach(b => b.addEventListener('click', () => _recuperarFoto(p, b.dataset.url, enVariante)));
  if (papeleraHTML && !_papeleraReloj) _papeleraReloj = setInterval(_papeleraTic, 1000);
  grid.querySelectorAll('.foto-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.acc === 'copiar') copiarFoto(b.dataset.url, b);
      else if (enVariante) accionFotoVariante(p, b.dataset.acc, lista[Number(b.dataset.i)]);
      else accionFoto(p, b.dataset.acc, lista[Number(b.dataset.i)]);
    });
  });
  if (enVariante) {
    const caja = grid.querySelector('.fv-desde-galeria');
    if (caja) {
      caja.querySelector('[data-acc="var-elegir"]').addEventListener('click', () => { const g = caja.querySelector('.fv-galeria'); g.hidden = !g.hidden; });
      caja.querySelectorAll('[data-acc="var-usar"]').forEach(b => b.addEventListener('click', () => usarFotoEnVariante(p, p, b.dataset.url, caja)));
    }
  }
  // Variantes
  grid.querySelectorAll('.fv-item').forEach(item => {
    const v = todas[Number(item.dataset.j)];
    item.querySelectorAll('[data-acc]').forEach(b => {
      const acc = b.dataset.acc;
      if (acc === 'var-subir') b.addEventListener('change', () => { const f = b.files[0]; b.value = ''; if (f) subirFotoVariante(p, v, f, item); });
      else b.addEventListener('click', () => {
        if (acc === 'copiar') copiarFoto(b.dataset.url, b);
        else if (acc === 'encuadre-var') encuadrarVariante(p, v);
        else if (acc === 'var-elegir') { const g = item.querySelector('.fv-galeria'); g.hidden = !g.hidden; }
        else if (acc === 'var-usar') usarFotoEnVariante(p, v, b.dataset.url, item);
      });
    });
    // Soltar una foto sobre la fila de la variante cambia SU foto (no la galería)
    item.addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); } });
    item.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); item.classList.add('arrastrando'); } });
    item.addEventListener('dragleave', () => item.classList.remove('arrastrando'));
    item.addEventListener('drop', e => {
      const f = [...(e.dataTransfer?.files || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      e.preventDefault(); e.stopPropagation(); item.classList.remove('arrastrando');
      subirFotoVariante(p, v, f, item);
    });
  });
}

// ─── ARRASTRAR FOTOS al recuadro "Agregar imagen" (o a cualquier parte de las fotos) ───
// Acepta archivos de la compu y también fotos arrastradas desde otra página, si esa página lo permite.
function _activarArrastreFotos(grid) {
  if (grid._arrastre) return;
  grid._arrastre = true;
  let cont = 0;
  const marcar = on => grid.querySelector('.foto-add')?.classList.toggle('arrastrando', on);
  const esArrastre = e => [...(e.dataTransfer?.types || [])].some(t => t === 'Files' || t === 'text/uri-list');
  grid.addEventListener('dragenter', e => { if (!esArrastre(e) || _ghOk === false) return; e.preventDefault(); cont++; marcar(true); });
  grid.addEventListener('dragover', e => { if (!esArrastre(e) || _ghOk === false) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  grid.addEventListener('dragleave', () => { cont = Math.max(0, cont - 1); if (!cont) marcar(false); });
  grid.addEventListener('drop', async e => {
    if (!esArrastre(e)) return;
    e.preventDefault(); cont = 0; marcar(false);
    let files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
    if (!files.length) {
      const url = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find(l => /^https?:\/\//.test(l.trim()));
      if (url) {
        try {
          const b = await (await fetch(url.trim(), { mode: 'cors' })).blob();
          if (/^image\//.test(b.type)) files = [new File([b], 'foto.' + (b.type.split('/')[1] || 'jpg'), { type: b.type })];
        } catch (err) {}
        if (!files.length) { toast('Esa página no deja usar la foto así. Guardala en la compu y arrastrá el archivo.', 'err'); return; }
      }
    }
    if (!files.length) { toast('Solo se pueden agregar imágenes', 'err'); return; }
    subirFoto({ files, value: '' });
  });
}

// ─── COPIAR FOTOS (para pegarlas en WhatsApp, Mercado Libre, etc.) ───
// Copia la imagen al portapapeles como PNG; si el navegador no lo permite, la descarga.
function _fotoRaw(src) {
  const m = /^https:\/\/virtualshopbaires\.com\.ar\/(img\/.+)$/.exec(src);
  return m ? 'https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/' + m[1] : null;
}
function _fotoBlob(src) {
  const traer = u => fetch(u, { mode: 'cors' }).then(r => { if (!r.ok) throw new Error('foto'); return r.blob(); });
  return traer(src).catch(e => { const raw = _fotoRaw(src); if (raw) return traer(raw); throw e; });
}
function _fotoPng(src) {
  return _fotoBlob(src)
    .then(b => createImageBitmap(b)).then(bmp => new Promise((res, rej) => {
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      c.toBlob(x => x ? res(x) : rej(new Error('png')), 'image/png');
    }));
}
async function _descargarFoto(src) {
  try {
    const b = await _fotoBlob(src);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = (src.split('/').pop().split('?')[0] || 'foto').replace(/\.[a-z0-9]+$/i, '') + '.' + ((b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'));
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Foto descargada ✓');
  } catch (e) { window.open(src, '_blank', 'noopener'); }
}
async function copiarFoto(url, btn) {
  const src = new URL(url, location.href).href;
  if (btn) btn.disabled = true;
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sin portapapeles');
    // La promesa va dentro del ClipboardItem para que Safari no pierda el permiso del toque
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': _fotoPng(src) })]);
    toast('Foto copiada ✓ Ya la podés pegar');
  } catch (e) {
    await _descargarFoto(src);
  } finally { if (btn) btn.disabled = false; }
}

// ─── ENCUADRE DE FOTOS (cómo se ve en la tarjeta de la tienda) ───────
// Se guarda en la propia URL: "foto.jpg#vsb=x,y,zoom". Sin eso, la tienda muestra la foto entera.
function fotoSrcCRM(url) { return String(url || '').split('#')[0]; }
function _leerEncuadre(url) {
  const m = /#vsb=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/.exec(String(url || ''));
  return m ? { x: Math.min(100, +m[1]), y: Math.min(100, +m[2]), z: Math.min(4, Math.max(1, +m[3])) } : null;
}
function fotoEstiloCRM(url) {
  const e = _leerEncuadre(url);
  return e ? `object-fit:cover;object-position:${e.x}% ${e.y}%;transform:scale(${e.z});transform-origin:${e.x}% ${e.y}%;` : '';
}

function _errServidorNuevo(r) {
  const e = (r && r.error) || 'sin respuesta';
  return /Acción desconocida|no disponible/.test(e) ? 'falta implementar la versión nueva del servidor' : e;
}

async function _guardarFotosVariante(p, v, urls, msg) {
  const r = await crmEnviar({ action: 'variante_fotos_set', sheet: v._sheet || v.categoria, row: String(v._row), urls: JSON.stringify(urls) });
  if (!r || !r.ok) throw new Error(_errServidorNuevo(r));
  v.imagenes = r.fotos || urls; v.imagen = v.imagenes[0] || '';
  lsGuardar('productos', _productos);
  _repintarFotos(p); filtrarProductos(true);
  toast(msg);
}

function accionFotoVariante(p, acc, url) {
  if (!url) return;
  const err = e => { if (e.message !== 'auth') toast('No se pudo guardar: ' + e.message, 'err'); };
  if (acc === 'principal') {
    _enColaFotos(() => {
      const urls = _fotosVarDe(p);
      if (!urls.includes(url)) return;
      return _guardarFotosVariante(p, p, [url].concat(urls.filter(u => u !== url)), 'Foto principal de la variante actualizada ✓');
    }).catch(err);
  } else if (acc === 'encuadre') {
    const i = _fotosVarDe(p).indexOf(url);
    abrirEncuadre(url, i === 0 ? 'Foto principal de la variante' : `Foto ${i + 1} de la variante`, nueva => _enColaFotos(() => {
      const urls = _fotosVarDe(p), j = urls.indexOf(url);
      if (j < 0) throw new Error('esa foto ya no está');
      urls[j] = nueva;
      return _guardarFotosVariante(p, p, urls, 'Encuadre guardado ✓');
    }));
  } else if (acc === 'quitar') {
    confirmar('¿Quitar esta foto de la variante? La vas a poder recuperar durante 5 minutos.', () => {
      const k = _claveSub(p, true) + '|' + url;
      _fotosQuitando.add(k); _repintarFotos(p);
      _enColaFotos(() => _guardarFotosVariante(p, p, _fotosVarDe(p).filter(u => u !== url), 'Foto quitada ✓ Podés recuperarla durante 5 minutos'))
        .then(() => _papeleraAnotar(p, url, true)).catch(err).finally(() => { _fotosQuitando.delete(k); _repintarFotos(p); });
    });
  }
}

async function subirFotoVariante(p, v, file) {
  const k = _claveSub(v, true);
  _subidas[k] = (_subidas[k] || 0) + 1; _repintarFotos(p);
  try {
    const data = await _prepararFoto(file);
    await _enColaFotos(async () => {
      const r = await crmEnviar({ action: 'variante_foto_subir', sheet: p._sheet || p.categoria, row: String(v._row), color: v.color || v.talle || '', data });
      if (!r || !r.ok) throw new Error(_errServidorNuevo(r));
      v.imagenes = r.fotos || _fotosVarDe(v).concat(r.url); v.imagen = v.imagenes[0] || '';
      lsGuardar('productos', _productos);
      filtrarProductos(true);
    });
    toast('Foto de "' + (v.color || v.talle || 'la variante') + '" cambiada ✓');
  } catch (e) {
    if (e.message !== 'auth') toast('No se pudo cambiar la foto: ' + e.message, 'err');
  } finally {
    _subidas[k]--; _repintarFotos(p);
  }
}

async function usarFotoEnVariante(p, v, url, item) {
  item && item.classList.add('subiendo');
  try {
    await _enColaFotos(() => {
      const urls = _fotosVarDe(v).filter(u => fotoSrcCRM(u) !== fotoSrcCRM(url)).concat(url);
      return _guardarFotosVariante(p, v, urls, 'Foto sumada a "' + (v.color || v.talle || 'la variante') + '" ✓');
    });
  } catch (e) {
    if (e.message !== 'auth') toast('No se pudo cambiar la foto: ' + e.message, 'err');
    item && item.classList.remove('subiendo');
  }
}

function encuadrarVariante(p, v) {
  if (!v) return;
  abrirEncuadre(v.imagen, `Foto de ${v.color || v.talle || 'la variante'}`, async nueva => {
    const r = await actualizarCampo(v, 'imagen_url', nueva);
    if (r && r.ok === false) throw new Error(r.error);
    v.imagen = nueva;
    lsGuardar('productos', _productos);
    renderFotos(p);
  });
}

// Editor: cuadro igual a la tarjeta de la tienda. Arrastrar mueve la foto, el control acerca.
function abrirEncuadre(url, titulo, onGuardar) {
  const base = fotoSrcCRM(url);
  const inicial = _leerEncuadre(url);
  let e = inicial ? { ...inicial } : { x: 50, y: 50, z: 1 };
  let entera = !inicial;

  document.getElementById('modal-encuadre')?.remove();
  const m = document.createElement('div');
  m.id = 'modal-encuadre';
  m.className = 'modal-backdrop';
  m.style.display = 'flex';
  m.innerHTML = `
    <div class="modal enc-modal" role="dialog" aria-modal="true" aria-labelledby="enc-tit">
      <div class="mprod-head">
        <div class="mprod-head-txt"><h3 id="enc-tit">Encuadrar foto</h3><p class="mprod-head-sub"></p></div>
        <button type="button" class="mprod-x enc-cerrar" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="enc-body">
        <div class="enc-marco" tabindex="0" aria-label="Vista de la tarjeta. Arrastrá para mover la foto; con las flechas también.">
          <img alt="" draggable="false">
          <span class="enc-guia" aria-hidden="true"></span>
        </div>
        <p class="enc-ayuda"><i class="fa-solid fa-hand-pointer"></i> Así se ve en la tienda. Arrastrá para mover la foto.</p>
        <label class="enc-zoom"><i class="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i>
          <input type="range" min="1" max="3" step="0.05" aria-label="Acercar">
          <i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i></label>
        <div class="seg seg-grande enc-modo" role="group" aria-label="Modo">
          <button type="button" class="seg-btn" data-modo="entera"><i class="fa-solid fa-expand"></i> Foto entera</button>
          <button type="button" class="seg-btn" data-modo="encuadre"><i class="fa-solid fa-crop-simple"></i> Encuadrada</button>
        </div>
      </div>
      <div class="mprod-foot">
        <button type="button" class="btn-secondary enc-cerrar">Cancelar</button>
        <button type="button" class="btn-primary enc-guardar">Guardar encuadre</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.querySelector('.mprod-head-sub').textContent = titulo || '';
  const marco = m.querySelector('.enc-marco'), img = marco.querySelector('img'), zoom = m.querySelector('input[type=range]');
  img.src = base;

  const pintar = () => {
    img.style.cssText = entera ? '' : `object-fit:cover;object-position:${e.x}% ${e.y}%;transform:scale(${e.z});transform-origin:${e.x}% ${e.y}%;`;
    zoom.value = e.z;
    zoom.disabled = false;
    m.querySelectorAll('[data-modo]').forEach(b => {
      const on = (b.dataset.modo === 'entera') === entera;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
    marco.classList.toggle('entera', entera);
  };
  const recortar = () => { if (entera) { entera = false; } };

  // Arrastrar (mouse o dedo): mover el punto de enfoque al revés del gesto, como al acomodar una foto
  let drag = null;
  marco.addEventListener('pointerdown', ev => {
    marco.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, y: ev.clientY, ex: e.x, ey: e.y };
    recortar(); pintar();
  });
  marco.addEventListener('pointermove', ev => {
    if (!drag) return;
    const w = marco.clientWidth, k = 100 / (w * Math.max(0.6, e.z - 0.4));
    e.x = Math.min(100, Math.max(0, drag.ex - (ev.clientX - drag.x) * k));
    e.y = Math.min(100, Math.max(0, drag.ey - (ev.clientY - drag.y) * k));
    pintar();
  });
  const soltar = () => { drag = null; };
  marco.addEventListener('pointerup', soltar);
  marco.addEventListener('pointercancel', soltar);
  marco.addEventListener('keydown', ev => {
    const paso = ev.shiftKey ? 10 : 3, d = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[ev.key];
    if (!d) return;
    ev.preventDefault(); recortar();
    e.x = Math.min(100, Math.max(0, e.x + d[0])); e.y = Math.min(100, Math.max(0, e.y + d[1]));
    pintar();
  });
  zoom.addEventListener('input', () => { recortar(); e.z = Number(zoom.value); pintar(); });
  m.querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => {
    entera = b.dataset.modo === 'entera';
    if (!entera && !inicial && e.z === 1 && e.x === 50 && e.y === 50) e = { x: 50, y: 50, z: 1 };
    pintar();
  }));

  const cerrar = () => { m.remove(); document.removeEventListener('keydown', esc); };
  const esc = ev => { if (ev.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', esc);
  m.addEventListener('click', ev => { if (ev.target === m) cerrar(); });
  m.querySelectorAll('.enc-cerrar').forEach(b => b.addEventListener('click', cerrar));
  m.querySelector('.enc-guardar').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    const r1 = n => Math.round(n * 10) / 10;
    const nueva = entera ? base : `${base}#vsb=${r1(e.x)},${r1(e.y)},${Math.round(e.z * 100) / 100}`;
    if (nueva === url) { cerrar(); return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await onGuardar(nueva);
      toast(entera ? 'Se muestra la foto entera ✓' : 'Encuadre guardado ✓ (en la tienda se ve en unos minutos)');
      cerrar();
    } catch (err) {
      toast('No se pudo guardar: ' + err.message, 'err');
      btn.disabled = false; btn.textContent = 'Guardar encuadre';
    }
  });
  pintar();
  setTimeout(() => marco.focus({ preventScroll: true }), 50);
}

async function guardarFotos(p, urls, msgOk) {
  const r = await crmEnviar({ action: 'producto_fotos_set', categoria: p._sheet || p.categoria, nombre: p.nombre, urls: JSON.stringify(urls) });
  if (!r || r.ok === false) throw new Error((r && r.error) || 'error');
  _ponerGaleria(p, urls);
  _repintarFotos(p);
  _fijarFotoPrincipal(p, urls[0]);
  toast(msgOk);
}

function accionFoto(p, acc, url) {
  if (!url) return;
  const err = e => { if (e.message !== 'auth') toast('Error: ' + e.message, 'err'); };
  if (acc === 'principal') {
    _enColaFotos(() => {
      const urls = _galeriaDe(p);
      if (!urls.includes(url)) return;
      return guardarFotos(p, [url].concat(urls.filter(u => u !== url)), 'Foto principal actualizada ✓');
    }).catch(err);
  } else if (acc === 'encuadre') {
    const i = _galeriaDe(p).indexOf(url);
    abrirEncuadre(url, i === 0 ? 'Foto principal' : `Foto ${i + 1}`, nueva => _enColaFotos(() => {
      const urls = _galeriaDe(p), j = urls.indexOf(url);
      if (j < 0) throw new Error('esa foto ya no está');
      urls[j] = nueva;
      return guardarFotos(p, urls, 'Encuadre guardado ✓');
    }));
  } else if (acc === 'quitar') {
    confirmar('¿Quitar esta foto del producto en la tienda? La vas a poder recuperar durante 5 minutos.', () => {
      const k = _claveSub(p, false) + '|' + url;
      _fotosQuitando.add(k); _repintarFotos(p);
      _enColaFotos(() => guardarFotos(p, _galeriaDe(p).filter(u => u !== url), 'Foto quitada ✓ Podés recuperarla durante 5 minutos'))
        .then(() => _papeleraAnotar(p, url, false)).catch(err).finally(() => { _fotosQuitando.delete(k); _repintarFotos(p); });
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
  const enVariante = _modoFicha === 'variante';
  const clave = _claveSub(p, enVariante);
  const categoria = p._sheet || p.categoria, nombre = p.nombre;   // los de este momento, aunque después se renombre
  // Cada foto aparece enseguida como "Subiendo…"; mientras tanto se pueden quitar u ordenar otras
  _subidas[clave] = (_subidas[clave] || 0) + files.length; _repintarFotos(p);
  let ok = 0;
  for (const file of files) {
    try {
      const data = await _prepararFoto(file);
      await _enColaFotos(async () => {
        if (enVariante) {
          const r = await crmEnviar({ action: 'variante_foto_subir', sheet: categoria, row: String(p._row), color: p.color || p.talle || '', data });
          if (!r || !r.ok) throw new Error(_errServidorNuevo(r));
          p.imagenes = r.fotos || _fotosVarDe(p).concat(r.url); p.imagen = p.imagenes[0] || '';
          lsGuardar('productos', _productos); filtrarProductos(true);
          return;
        }
        const r = await crmEnviar({ action: 'producto_foto_subir', categoria, nombre, data });
        if (!r || r.ok === false) throw new Error((r && r.error) || 'error');
        _ponerGaleria(p, r.fotos || _galeriaDe(p).concat(r.url));
        _fijarFotoPrincipal(p, _galeriaDe(p)[0]);
      });
      ok++;
    } catch (e) {
      if (e.message !== 'auth') toast('Error al subir foto: ' + e.message, 'err');
    }
    _subidas[clave]--; _repintarFotos(p);
  }
  if (ok) toast(ok === 1 ? 'Foto subida ✓ (en la tienda aparece en unos minutos)' : `${ok} fotos subidas ✓ (en la tienda aparecen en unos minutos)`);
}

// ─── CELULAR: productos como tarjetas ─────────────────────────
function esCelular() { return window.matchMedia('(max-width: 768px)').matches; }
// Si la ventana pasa de celular a compu (o al revés), la lista se vuelve a armar con la vista que corresponde.
// Se compara con la vista que se dibujó de verdad, así sirve aunque el cambio sea de un solo salto (maximizar).
(function() {
  window.addEventListener('resize', () => {
    const t = $('prod-table'); if (!t || !_productos.length) return;
    const dibujadaCelular = !!t.querySelector('.pcard') || t.classList.contains('prod-cards');
    const dibujadaCompu = !!document.querySelector('#prod-tbody tr');
    if ((esCelular() && dibujadaCompu && !dibujadaCelular) || (!esCelular() && dibujadaCelular)) filtrarProductos(true);
  });
})();

function _precioNum(v) { return Number(String(v || 0).replace(/[^\d.,]/g, '').replace(',', '.')) || 0; }

function renderProductosCards(list) {
  const el = $('prod-table');
  const grupos = [], porClave = {};
  list.forEach(p => {
    const k = grupoClave(p);
    if (!porClave[k]) { porClave[k] = []; grupos.push(porClave[k]); }
    porClave[k].push(p);
  });
  const wrap = document.createElement('div');
  wrap.className = 'pcards';
  // Se dibujan de a 40 para que la lista aparezca enseguida aunque haya cientos
  let i = 0;
  const tanda = () => {
    const frag = document.createDocumentFragment();
    grupos.slice(i, i + 40).forEach(g => frag.appendChild(buildProdCard(g)));
    wrap.appendChild(frag);
    i += 40;
    if (i < grupos.length) requestAnimationFrame(tanda);
  };
  el.innerHTML = '';
  el.appendChild(wrap);
  tanda();
}

function buildProdCard(g) {
  const p0 = g[0], varios = g.length > 1;
  const precios = g.map(v => _precioNum(v.precio));
  const min = Math.min(...precios), max = Math.max(...precios);
  const conStock = g.filter(v => v.stock).length;
  const clave = grupoClave(p0);
  const card = document.createElement('div');
  card.className = 'pcard';
  card.innerHTML = `
    <div class="pcard-top">
      ${prodThumb(_miniProducto(g), 60)}
      <div class="pcard-info">
        <div class="pcard-nombre">${escHtml(p0.nombre)}</div>
        <div class="pcard-meta">
          <b>${min === max ? fmtPrecioSheet(min) : fmtPrecioSheet(min) + ' – ' + fmtPrecioSheet(max)}</b>
          ${varios ? `<span class="badge">${g.length} variantes</span>` : (String(p0.color || '').trim() ? `<span class="badge-color">${escHtml(p0.color)}</span>` : '')}
          <span class="badge ${conStock ? 'badge-conf' : 'badge-cancel'}">${(conStock ? (varios ? conStock + ' con stock' : 'Con stock') : 'Sin stock') + _totalUnidadesTxt(g)}</span>
        </div>
      </div>
    </div>
    <div class="pcard-acts">
      <button type="button" class="pact" data-a="editar"><i class="fa-solid fa-pen-to-square"></i><span>Editar</span></button>
      <button type="button" class="pact" data-a="variante"><i class="fa-solid fa-layer-group"></i><span>Variante</span></button>
      ${varios ? '<button type="button" class="pact" data-a="variantes"><i class="fa-solid fa-chevron-down"></i><span>Ver variantes</span></button>' : '<button type="button" class="pact" data-a="stock"><i class="fa-solid fa-box"></i><span>Stock</span></button>'}
      <button type="button" class="pact pact-del" data-a="eliminar"><i class="fa-solid fa-trash"></i><span>Eliminar</span></button>
    </div>
    ${varios ? '<div class="pcard-vars" hidden></div>' : ''}`;

  const vars = card.querySelector('.pcard-vars');
  const pintarVariantes = () => {
    vars.innerHTML = '';
    g.forEach(v => {
      const fila = document.createElement('div');
      fila.className = 'pvar';
      fila.innerHTML = `
        ${prodThumb(v.imagen, 40)}
        <div class="pvar-info"><b>${escHtml(String(v.color || v.talle || '—'))}</b><span>${fmtPrecioSheet(v.precio)}</span></div>
        <button type="button" class="pvar-btn pvar-stock ${v.stock ? 'on' : ''}" title="Tocá para cambiar el stock" aria-label="Stock">${_switchStock(v.stock)}</button>
        ${_inputCantidad(v)}
        <button type="button" class="pvar-btn" data-a="editar" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="pvar-btn pvar-del" data-a="eliminar" title="Eliminar esta variante"><i class="fa-solid fa-trash"></i></button>`;
      fila.querySelector('[data-a="editar"]').addEventListener('click', () => editarProducto(v, 'variante'));
      fila.querySelector('[data-a="eliminar"]').addEventListener('click', () => eliminarProducto(v));
      const bs = fila.querySelector('.pvar-stock');
      const ic = fila.querySelector('.stock-cant');
      bs.addEventListener('click', () => cambiarStockTarjeta(v, bs, ic));
      _activarCantidad(ic, v, () => { bs.classList.toggle('on', !!v.stock); bs.innerHTML = _switchStock(v.stock); ic.value = _valCantidad(v); });
      vars.appendChild(fila);
    });
  };
  if (vars && _gruposAbiertos.has(clave)) { pintarVariantes(); vars.hidden = false; card.classList.add('abierta'); }

  card.querySelector('.pcard-top').addEventListener('click', () => editarProducto(p0, varios ? 'producto' : 'completo'));
  card.querySelector('[data-a="editar"]').addEventListener('click', () => editarProducto(p0, varios ? 'producto' : 'completo'));
  card.querySelector('[data-a="variante"]').addEventListener('click', () => abrirAgregarVariante(g));
  card.querySelector('[data-a="eliminar"]').addEventListener('click', () => varios ? eliminarGrupo(g) : eliminarProducto(p0));
  const bVars = card.querySelector('[data-a="variantes"]');
  if (bVars) bVars.addEventListener('click', () => {
    const abrir = vars.hidden;
    if (abrir && !vars.children.length) pintarVariantes();
    vars.hidden = !abrir;
    card.classList.toggle('abierta', abrir);
    if (abrir) _gruposAbiertos.add(clave); else _gruposAbiertos.delete(clave);
  });
  const bStock = card.querySelector('[data-a="stock"]');
  if (bStock) bStock.addEventListener('click', () => cambiarStockTarjeta(p0, null));
  return card;
}

function cambiarStockTarjeta(p, boton, inputCant) {
  const nuevo = !p.stock, cantAntes = p.cantidad;
  _stockLocal(p, nuevo);
  if (inputCant) inputCant.value = _valCantidad(p);
  if (boton) { boton.classList.toggle('on', nuevo); _ponerSwitch(boton, nuevo); }
  actualizarCampo(p, 'stock', nuevo)
    .then(r => {
      if (r && r.ok === false) throw new Error(r.error);
      toast(nuevo ? 'Con stock ✓' : 'Sin stock ✓');
      lsGuardar('productos', _productos);
      if (!boton) filtrarProductos();
    })
    .catch(() => {
      p.stock = !nuevo; p.cantidad = cantAntes;
      if (inputCant) inputCant.value = _valCantidad(p);
      if (boton) { boton.classList.toggle('on', !nuevo); _ponerSwitch(boton, !nuevo); }
      toast('No se pudo cambiar el stock', 'err');
    });
}

// Eliminar un producto con TODAS sus variantes. Se borra de la última fila hacia arriba
// para que los números de fila de las que faltan no cambien; el backend además
// confirma que cada fila siga siendo ese producto.
function eliminarGrupo(g) {
  const nombre = g[0].nombre;
  confirmar(`¿Eliminar "${nombre}" con sus ${g.length} variantes? No se puede deshacer.`, () => unaVez('eliminar-grupo-' + grupoClave(g[0]), async () => {
    const filas = [...g].sort((a, b) => Number(b._row) - Number(a._row));
    let hechas = 0;
    try {
      for (const v of filas) {
        await crmOk({ action: 'ext_producto_eliminar', sheet: v._sheet, row: v._row, nombre: v.nombre });
        hechas++;
      }
      toast(`"${nombre}" eliminado ✓`);
    } catch (e) {
      toast(`Se eliminaron ${hechas} de ${filas.length}: ${e.message}`, 'err');
    }
    delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
  }));
}

// Guardar cliente / pedido: el botón muestra "Guardando…" al instante y no se puede tocar dos veces
function _conBotonGuardando(nombre, modal) {
  const f = window[nombre];
  if (typeof f !== 'function' || f._guardando) return;
  window[nombre] = async function () {
    const b = document.querySelector('#' + modal + ' .btn-primary');
    if (b && b.disabled) return;
    const txt = b ? b.textContent : '';
    if (b) { b.disabled = true; b.textContent = 'Guardando…'; }
    try { return await f.apply(this, arguments); }
    finally { if (b) { b.disabled = false; b.textContent = txt; } }
  };
  window[nombre]._guardando = true;
}
_conBotonGuardando('guardarCliente', 'modal-cliente');
_conBotonGuardando('guardarPedido', 'modal-pedido');

(function () {
  const cargar = window.loadProductos;
  if (typeof cargar !== 'function' || cargar._fotos) return;
  window.loadProductos = async function () {
    const r = await cargar.apply(this, arguments);
    _completarFotosProducto();
    return r;
  };
  window.loadProductos._fotos = true;
})();
