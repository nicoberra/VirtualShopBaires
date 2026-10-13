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
    <button type="button" class="btn-editar"><i class="fa-solid fa-pen" aria-hidden="true"></i> Editar</button>
    <button type="button" class="btn-mas" aria-label="Más acciones" aria-haspopup="menu" aria-expanded="false"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
  </div></td>`;
}
function _estrella(p) { return p.destacado ? '<i class="fa-solid fa-star dest-star" title="Destacado" aria-label="Destacado"></i>' : ''; }

function renderProductos(list) {
  const el = $('prod-table'), pag = $('prod-pag');
  _prodLista = list;
  cerrarMenuAcciones();
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i>Sin productos</div>';
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
  const stockTxt = conStock === g.length ? 'Con stock' : conStock ? `${conStock} de ${g.length} con stock` : 'Sin stock';
  const stockCls = conStock === g.length ? 'badge-conf' : conStock ? 'badge-pend' : 'badge-cancel';
  const tr = document.createElement('tr');
  tr.className = 'prod-group-row';
  tr.innerHTML = `
    <td class="td-nombre">
      <div class="prod-name-cell">
        ${prodThumb((g.find(v => v.imagen) || {}).imagen, 64)}
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
  tr.querySelector('.btn-editar').addEventListener('click', () => editarProducto(g[0]));
  const mas = tr.querySelector('.btn-mas');
  mas.addEventListener('click', () => abrirMenuAcciones(mas, [
    { icon: 'fa-arrow-up-right-from-square', label: 'Ver en la tienda', fn: () => window.open(urlTienda(g[0]), '_blank', 'noopener') },
    { icon: hijos[0].hidden ? 'fa-chevron-down' : 'fa-chevron-up', label: hijos[0].hidden ? 'Ver variantes' : 'Ocultar variantes', fn: () => fijar(hijos[0].hidden) },
    { icon: 'fa-layer-group', label: 'Agregar variante', fn: () => abrirAgregarVariante(g) },
    { icon: 'fa-trash', label: 'Eliminar producto completo', peligro: true, fn: () => eliminarGrupo(g) },
  ]));
  return tr;
}

function pintarPaginacion(total, desde, n, paginas) {
  const el = $('prod-pag');
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

  const renderStock = v => (v
    ? '<span class="badge badge-conf">Con stock</span>'
    : '<span class="badge badge-cancel">Sin stock</span>') + '<i class="fa-solid fa-pen edit-hint"></i>';
  const sub = esVariante ? talle : (p.subcategoria || (_prodCatFil === 'Todos' ? p.categoria : ''));
  const variante = [talle, colorMarca].filter(Boolean).join(' · ') || 'Único';

  const tr = document.createElement('tr');
  if (esVariante) tr.className = 'prod-var-row';
  tr.innerHTML = `
    <td class="td-nombre">
      <div class="prod-name-cell${esVariante ? ' es-variante' : ''}">
        ${prodThumb(p.imagen, esVariante ? 44 : 64)}
        <div class="prod-name-text">
          <strong>${escHtml(esVariante ? (colorMarca || talle || '—') : p.nombre)}</strong>${_estrella(p)}
          ${sub ? `<div class="prod-sub">${escHtml(sub)}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="td-editable td-sku">${renderSku(p.sku)}</td>
    <td><span class="pill-var">${escHtml(variante)}</span></td>
    <td class="td-editable td-precio"><strong>${fmtPrecioSheet(p.precio)}</strong><i class="fa-solid fa-pen edit-hint"></i></td>
    <td class="td-toggle td-stock" title="Tocá para cambiar">${renderStock(sVal)}</td>
    ${celdaAcciones()}`;

  tr.querySelector('.td-nombre').addEventListener('click', () => editarProducto(p));
  tr.querySelector('.td-precio').addEventListener('click', function() {
    editarCeldaNum(this, p, 'precio', pVal, v => { pVal = v; p.precio = v; }, '$');
  });
  tr.querySelector('.td-sku').addEventListener('click', function() { editarCeldaSku(this, p); });
  tr.querySelector('.td-stock').addEventListener('click', function() {
    sVal = sVal ? 0 : 1; p.stock = !!sVal;
    this.innerHTML = renderStock(sVal);
    actualizarCampo(p, 'stock', !!sVal)
      .then(r => { if (r.ok === false) throw new Error(r.error); toast('Stock actualizado ✓'); lsGuardar('productos', _productos); })
      .catch(() => { sVal = sVal ? 0 : 1; p.stock = !!sVal; this.innerHTML = renderStock(sVal); toast('Error al guardar stock', 'err'); });
  });
  tr.querySelector('.btn-editar').addEventListener('click', () => editarProducto(p));
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

  // En la tienda: "descuento" es el precio que se cobra y "precio" el que se muestra tachado
  const base = _precioNum(p.precio), desc = _precioNum(p.descuento);
  const conRebaja = desc > 0 && desc < base;
  $('mprod-precio').value      = conRebaja ? desc : base;
  $('mprod-descuento').value   = conRebaja ? base : '';
  setStockModal(!!p.stock);
  $('mprod-destacado').checked = !!p.destacado;
  $('mprod-destacado').closest('.dest-tile').classList.toggle('on', !!p.destacado);

  // Categoría: la del producto (se elige al crearlo)
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
  const actual      = Number($('mprod-precio').value) || 0;
  const anterior    = Number($('mprod-descuento').value) || 0;
  const stock       = (Number($('mprod-stock-num').value) || 0) > 0;
  const destacado   = $('mprod-destacado').checked;
  if (actual <= 0) { toast('Poné el precio actual', 'err'); $('mprod-precio').focus(); return; }
  if (anterior && anterior <= actual) { toast('El precio anterior tiene que ser mayor que el actual', 'err'); $('mprod-descuento').focus(); return; }
  // Con precio anterior: se guarda como precio (tachado) y el actual como descuento
  const precio    = anterior ? anterior : actual;
  const descuento = anterior ? actual : '';
  const descAntes = _precioNum(p.descuento) > 0 ? _precioNum(p.descuento) : '';

  // De esta variante
  const propios = [
    { campo:'color',        valor: color },
    { campo:'talle/medida', valor: talle },
    { campo:'sku_costo',    valor: sku },
    { campo:'precio',       valor: precio },
    { campo:'stock',        valor: stock },
  ];
  if (String(descuento) !== String(descAntes)) propios.push({ campo:'descuento', valor: descuento });
  // De todo el producto (todas las variantes)
  const comunes = [
    { campo:'descripcion', valor: descripcion },
    { campo:'destacado',   valor: destacado },
  ];
  if (nombre && nombre !== p.nombre) comunes.unshift({ campo:'producto', valor: nombre });

  const btn = $('mprod-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
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
    Object.assign(p, { color, talle, sku, precio, descuento, stock });
    vars.forEach(v => Object.assign(v, { nombre: nombre || v.nombre, descripcion, destacado }));
    lsGuardar('productos', _productos);
    toast('Producto guardado ✓');
    hide('modal-producto');
    filtrarProductos(true);
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
}

// Stock y destacado de la ficha
function setStockModal(con) {
  $('mprod-stock-num').value = con ? 1 : 0;
  document.querySelectorAll('[data-stock-m]').forEach(b => {
    const on = (b.dataset.stockM === '1') === con;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-stock-m]');
  if (b) setStockModal(b.dataset.stockM === '1');
});
document.addEventListener('change', e => {
  if (e.target.id === 'mprod-destacado') e.target.closest('.dest-tile').classList.toggle('on', e.target.checked);
});

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
  const fotosHTML = _fotosProd.map((url, i) => `
        <div class="foto-tile">
          <img src="${escHtml(url)}" alt="Foto ${i + 1}" loading="lazy">
          ${i === 0 ? '<span class="foto-principal">Principal</span>' : `<button type="button" class="foto-btn foto-btn-star" data-acc="principal" data-i="${i}" title="Hacer principal" aria-label="Hacer principal"><i class="fa-solid fa-star"></i></button>`}
          <button type="button" class="foto-btn foto-btn-x" data-acc="quitar" data-i="${i}" title="Quitar de la tienda" aria-label="Quitar foto"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('')
    + (_ghOk === false ? '' : `<label for="foto-input" class="foto-add" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();$('foto-input').click()}"><i class="fa-solid fa-plus"></i><span>Agregar imagen</span></label>`);

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

  grid.innerHTML = `<div class="fotos-tiles">${fotosHTML}</div>${varsHTML}${aviso}`;
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

// ─── CELULAR: productos como tarjetas ─────────────────────────
function esCelular() { return window.matchMedia('(max-width: 768px)').matches; }
(function() {
  let antes = null;
  window.addEventListener('resize', () => {
    const ahora = esCelular();
    if (antes !== null && ahora !== antes && typeof currentSec !== 'undefined' && currentSec === 'productos' && _productos.length) filtrarProductos();
    antes = ahora;
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
      ${prodThumb((g.find(v => v.imagen) || {}).imagen, 60)}
      <div class="pcard-info">
        <div class="pcard-nombre">${escHtml(p0.nombre)}</div>
        <div class="pcard-meta">
          <b>${min === max ? fmtPrecioSheet(min) : fmtPrecioSheet(min) + ' – ' + fmtPrecioSheet(max)}</b>
          ${varios ? `<span class="badge">${g.length} variantes</span>` : (String(p0.color || '').trim() ? `<span class="badge-color">${escHtml(p0.color)}</span>` : '')}
          <span class="badge ${conStock ? 'badge-conf' : 'badge-cancel'}">${conStock ? (varios ? conStock + ' con stock' : 'Con stock') : 'Sin stock'}</span>
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
        <button type="button" class="pvar-btn pvar-stock ${v.stock ? 'on' : ''}" title="Stock">${v.stock ? 'Con stock' : 'Sin stock'}</button>
        <button type="button" class="pvar-btn" data-a="editar" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="pvar-btn pvar-del" data-a="eliminar" title="Eliminar esta variante"><i class="fa-solid fa-trash"></i></button>`;
      fila.querySelector('[data-a="editar"]').addEventListener('click', () => editarProducto(v));
      fila.querySelector('[data-a="eliminar"]').addEventListener('click', () => eliminarProducto(v));
      const bs = fila.querySelector('.pvar-stock');
      bs.addEventListener('click', () => cambiarStockTarjeta(v, bs));
      vars.appendChild(fila);
    });
  };
  if (vars && _gruposAbiertos.has(clave)) { pintarVariantes(); vars.hidden = false; card.classList.add('abierta'); }

  card.querySelector('.pcard-top').addEventListener('click', () => editarProducto(p0));
  card.querySelector('[data-a="editar"]').addEventListener('click', () => editarProducto(p0));
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

function cambiarStockTarjeta(p, boton) {
  const nuevo = !p.stock;
  p.stock = nuevo;
  if (boton) { boton.classList.toggle('on', nuevo); boton.textContent = nuevo ? 'Con stock' : 'Sin stock'; }
  actualizarCampo(p, 'stock', nuevo)
    .then(r => {
      if (r && r.ok === false) throw new Error(r.error);
      toast(nuevo ? 'Con stock ✓' : 'Sin stock ✓');
      lsGuardar('productos', _productos);
      if (!boton) filtrarProductos();
    })
    .catch(() => {
      p.stock = !nuevo;
      if (boton) { boton.classList.toggle('on', !nuevo); boton.textContent = !nuevo ? 'Con stock' : 'Sin stock'; }
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
