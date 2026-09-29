// ============================================================
//  CRM Panel Operaciones — Virtual Shop Baires
//  panel-ops.js  (solo Clientes, Productos, Pedidos)
// ============================================================

// ─── CONFIG ──────────────────────────────────────────────────
const CRM_URL    = 'https://script.google.com/macros/s/AKfycbwmPAvB8_p0muyXl3Q-qt0XWaE_mk76HTImcPt3vdFzVpO8vwQUjOoDCpu_BZWlezyh/exec';
const PANEL_PASS = '2208';
// ─────────────────────────────────────────────────────────────

// ─── COMUNICACIÓN CON EL BACKEND ─────────────────────────────

function crm(params) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Date.now() + Math.floor(Math.random() * 1e6);
    const qs = new URLSearchParams({ ...params, callback: cb, _: Date.now() });
    const s  = document.createElement('script');
    const ok = () => { delete window[cb]; s.remove(); };
    const to = setTimeout(() => { ok(); reject(new Error('timeout')); }, 45000);
    window[cb] = (data) => { clearTimeout(to); ok(); resolve(data); };
    s.onerror  = () => { clearTimeout(to); ok(); reject(new Error('red')); };
    s.src = CRM_URL + '?' + qs.toString();
    document.body.appendChild(s);
  });
}

async function crmPost(params) {
  await fetch(CRM_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  return { ok: true };
}

function fileABase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ─── HELPERS UI ──────────────────────────────────────────────

const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value.trim() : '');
const hide  = id => { const el = $(id); if (el) el.style.display = 'none'; };
const show  = (id, d='block') => { const el = $(id); if (el) el.style.display = d; };
const fmtMoney = n => '$' + Number(n || 0).toLocaleString('es-AR', {minimumFractionDigits:0});
const fmtFecha = s => { try { return new Date(String(s).replace(' ','T')).toLocaleDateString('es-AR'); } catch { return s; } };

let _toastTimer;
function toast(msg, tipo = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + tipo;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.className = 'toast', 3000);
}

function cerrarModal(e, id) {
  if (e.target.classList.contains('modal-backdrop')) hide(id);
}

function confirmar(msg, fn) {
  $('confirm-msg').textContent = msg;
  const btn = $('confirm-btn');
  btn.onclick = () => { hide('modal-confirm'); fn(); };
  show('modal-confirm', 'flex');
}

function badgeEstado(estado) {
  const map = { Pendiente:'badge-pend', Confirmado:'badge-conf', 'En camino':'badge-camino', Entregado:'badge-entre', Cancelado:'badge-cancel' };
  const cls = map[estado] || 'badge-pend';
  return `<span class="badge ${cls}">${estado || 'Pendiente'}</span>`;
}

// ─── AUTH ─────────────────────────────────────────────────────

function doLogin() {
  const pass = val('login-pass');
  if (pass === PANEL_PASS) {
    sessionStorage.setItem('ops_auth', '1');
    hide('login-wrap');
    show('app', 'flex');
    goTo('clientes');
    prefetchAll();
  } else {
    $('login-err').textContent = 'Contraseña incorrecta.';
  }
}

function prefetchAll() {
  getData('list', 'Clientes').catch(() => {});
  crm({ action: 'ext_pedidos_listar' }).then(raw => {
    _pedidos = Array.isArray(raw) ? [...raw].reverse() : [];
  }).catch(() => {});
  crm({ action: 'ext_productos_list' }).then(r => {
    _productos = r.rows || [];
    _cache['ext_productos_list'] = _productos;
  }).catch(() => {});
}

function logout() {
  sessionStorage.removeItem('ops_auth');
  location.reload();
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────

let currentSec = '';

function goTo(sec) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  const el = $('sec-' + sec);
  if (el) el.classList.add('active');

  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  document.querySelectorAll(`[data-sec="${sec}"]`).forEach(a => a.classList.add('active'));

  if (currentSec !== sec) {
    currentSec = sec;
    loadSection(sec);
  }
}

function loadSection(sec) {
  const loaders = {
    clientes:  loadClientes,
    productos: loadProductos,
    pedidos:   loadPedidos,
  };
  if (loaders[sec]) loaders[sec]();
}

// ─── CACHÉ DE DATOS ───────────────────────────────────────────

const _cache = {};
async function getData(action, tab, force = false) {
  const key = action + (tab ? ':' + tab : '');
  if (!force && _cache[key]) return _cache[key];
  const params = { action };
  if (tab) params.tab = tab;
  const res = await crm(params);
  const data = res.rows || res.stats || res.fotos || [];
  _cache[key] = data;
  return data;
}
function invalidate(...keys) {
  keys.forEach(k => delete _cache[k]);
}

// ─── CLIENTES ────────────────────────────────────────────────

let _clientes = [], _pedidos_para_clientes = [];

function comprasDeCliente(cli) {
  const dig = t => String(t||'').replace(/\D/g,'');
  return _pedidos_para_clientes.filter(p =>
    (p.clienteid && p.clienteid === cli.id) ||
    (!p.clienteid && dig(p.telefono) && dig(p.telefono) === dig(cli.telefono)) ||
    (!p.clienteid && p.cliente && p.cliente.trim().toLowerCase() === String(cli.nombre).trim().toLowerCase())
  ).length;
}

async function loadClientes(force=false) {
  if (!force && _clientes.length) { filtrarClientes(); return; }
  $('cli-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    [_clientes, _pedidos_para_clientes] = await Promise.all([
      getData('list','Clientes',force),
      getData('list','Pedidos',force)
    ]);
    filtrarClientes();
  } catch(e) {
    $('cli-table').innerHTML = `<div style="padding:20px;text-align:center">
      <p class="text-muted" style="margin-bottom:12px">No se pudo cargar</p>
      <button class="btn-secondary" onclick="loadClientes(true)"><i class="fa-solid fa-rotate-right"></i> Reintentar</button>
    </div>`;
  }
}

function filtrarClientes() {
  const q = val('cli-search').toLowerCase();
  const list = q
    ? _clientes.filter(c =>
        String(c.nombre||'').toLowerCase().includes(q) ||
        String(c.email||'').toLowerCase().includes(q) ||
        String(c.telefono||'').includes(q))
    : _clientes;
  renderClientes(list);
}

function renderClientes(list) {
  const el = $('cli-table');
  if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users"></i>Sin clientes</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Ciudad</th><th>Compras</th><th></th></tr></thead>
      <tbody>
        ${list.map(c => `
          <tr>
            <td><strong>${c.nombre||'—'}</strong></td>
            <td>${c.email||'—'}</td>
            <td>${c.telefono||'—'}</td>
            <td>${c.ciudad||'—'}</td>
            <td>${comprasDeCliente(c)}</td>
            <td class="td-actions">
              <button class="btn-icon" onclick="editarCliente(${JSON.stringify(c).replace(/"/g,'&quot;')})"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-icon" onclick="borrarCliente('${c.id}','${(c.nombre||'').replace(/'/g,'')}')" style="color:var(--red)"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function abrirModalCliente() {
  $('mcli-title').textContent = 'Nuevo cliente';
  ['mcli-id','mcli-nombre','mcli-telefono','mcli-email','mcli-ciudad','mcli-notas'].forEach(id => $(id).value = '');
  show('modal-cliente', 'flex');
  setTimeout(() => $('mcli-nombre').focus(), 50);
}

function editarCliente(c) {
  $('mcli-title').textContent = 'Editar cliente';
  $('mcli-id').value       = c.id||'';
  $('mcli-nombre').value   = c.nombre||'';
  $('mcli-telefono').value = c.telefono||'';
  $('mcli-email').value    = c.email||'';
  $('mcli-ciudad').value   = c.ciudad||'';
  $('mcli-notas').value    = c.notas||'';
  show('modal-cliente', 'flex');
}

async function guardarCliente() {
  const nombre = val('mcli-nombre');
  if (!nombre) { toast('El nombre es obligatorio','err'); return; }
  const id = val('mcli-id');
  const params = {
    action: id ? 'update' : 'add', tab: 'Clientes',
    nombre, telefono: val('mcli-telefono'), email: val('mcli-email'),
    ciudad: val('mcli-ciudad'), notas: val('mcli-notas')
  };
  if (id) params.id = id;
  try {
    const r = await crm(params);
    if (!r.ok) throw new Error(r.error || 'error');
    toast(id ? 'Cliente actualizado' : 'Cliente guardado');
    hide('modal-cliente');
    invalidate('list:Clientes');
    loadClientes(true);
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

function borrarCliente(id, nombre) {
  confirmar(`¿Borrar al cliente "${nombre}"?`, async () => {
    try {
      await crm({ action:'delete', tab:'Clientes', id });
      toast('Cliente borrado');
      invalidate('list:Clientes');
      loadClientes(true);
    } catch(e) { toast('Error: '+e.message,'err'); }
  });
}

// ─── PRODUCTOS (Sheet externo por categorías) ────────────────

let _productos = [], _prodCatFil = 'Todos';

async function loadProductos(force=false) {
  if (!force && _productos.length) { buildProdCats(); filtrarProductos(); return; }
  $('prod-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando productos…</div>';
  try {
    const key = 'ext_productos_list';
    if (force) delete _cache[key];
    const r = _cache[key] ? { rows: _cache[key] } : await crm({ action:'ext_productos_list' });
    _productos = r.rows || [];
    _cache[key] = _productos;
    buildProdCats();
    filtrarProductos();
  } catch(e) {
    $('prod-table').innerHTML = `<div style="padding:20px;text-align:center">
      <p class="text-muted" style="margin-bottom:12px">No se pudo cargar</p>
      <button class="btn-secondary" onclick="loadProductos(true)"><i class="fa-solid fa-rotate-right"></i> Reintentar</button>
    </div>`;
  }
}

function buildProdCats() {
  const cats = ['Todos', ...new Set(_productos.map(p => p.categoria).filter(Boolean))];
  $('prod-cats').innerHTML = cats.map(c =>
    `<span class="chip${c===_prodCatFil?' active':''}" onclick="setProdCat('${c}')">${c}</span>`).join('');
}

function setProdCat(cat) {
  _prodCatFil = cat;
  buildProdCats();
  filtrarProductos();
}

function filtrarProductos() {
  const q = val('prod-search').toLowerCase();
  let list = _productos;
  if (_prodCatFil !== 'Todos') list = list.filter(p => p.categoria === _prodCatFil);
  if (q) list = list.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    (p.color||'').toLowerCase().includes(q) ||
    (p.marca||'').toLowerCase().includes(q));
  renderProductos(list);
}

function fmtPrecioSheet(v) {
  if (!v && v !== 0) return '—';
  const n = Number(String(v).replace(/[^\d.,]/g,'').replace(',','.'));
  return isNaN(n) || n === 0 ? '—' : '$' + n.toLocaleString('es-AR', {minimumFractionDigits:0});
}

function renderProductos(list) {
  const el = $('prod-table');
  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-open"></i>Sin productos</div>';
    return;
  }

  const hayColor = list.some(p => p.color || p.marca);
  const hayTalle = list.some(p => p.talle);

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Nombre</th>
        ${hayColor ? '<th>Color / Marca</th>' : ''}
        ${hayTalle ? '<th>Talle</th>' : ''}
        <th>Precio</th>
        <th>P. Original</th>
        <th>Stock</th>
        <th>⭐</th>
        <th></th>
      </tr></thead>
      <tbody id="prod-tbody"></tbody>
    </table>`;

  const tbody = $('prod-tbody');
  list.forEach(p => {
    const precioN = Number(String(p.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
    const descN   = Number(String(p.descuento||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
    const colorMarca = (p.color || p.marca || '').trim();
    const safe = encodeURIComponent(JSON.stringify({
      _sheet: p._sheet, _row: p._row, nombre: p.nombre, categoria: p.categoria,
      color: p.color, marca: p.marca, talle: p.talle, precio: p.precio,
      descuento: p.descuento, stock: p.stock, destacado: p.destacado,
      descripcion: p.descripcion, subcategoria: p.subcategoria
    }));

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.nombre}</strong>${p.subcategoria ? `<div class="prod-sub">${p.subcategoria}</div>` : ''}</td>
      ${hayColor ? `<td>${colorMarca ? `<span class="badge-color">${colorMarca}</span>` : '—'}</td>` : ''}
      ${hayTalle ? `<td>${p.talle||'—'}</td>` : ''}
      <td class="td-editable td-precio"><strong>${fmtPrecioSheet(p.precio)}</strong><i class="fa-solid fa-pen edit-hint"></i></td>
      <td class="td-editable td-desc"><span class="text-muted">${fmtPrecioSheet(p.descuento)}</span><i class="fa-solid fa-pen edit-hint"></i></td>
      <td class="td-center td-toggle td-stock">${p.stock ? '<span class="badge badge-conf">✓</span>' : '<span class="badge badge-cancel">✗</span>'}</td>
      <td class="td-center td-toggle td-dest">${p.destacado ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>'}</td>
      <td style="white-space:nowrap">
        <a class="btn-icon" href="https://virtualshopbaires.com.ar/productos.html?cat=${encodeURIComponent(p.categoria||'')}&buscar=${encodeURIComponent(p.nombre||'')}" target="_blank" rel="noopener" title="Ver en tienda"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        <button class="btn-icon" title="Ver fotos"><i class="fa-solid fa-image"></i></button>
      </td>`;

    let pVal = precioN, dVal = descN, sVal = !!p.stock, hVal = !!p.destacado;

    tr.querySelector('.td-precio').addEventListener('click', function() {
      editarCeldaNum(this, p, 'precio', pVal, v => { pVal = v; p.precio = v; });
    });
    tr.querySelector('.td-desc').addEventListener('click', function() {
      editarCeldaNum(this, p, 'descuento', dVal, v => { dVal = v; p.descuento = v; });
    });
    tr.querySelector('.td-stock').addEventListener('click', function() {
      sVal = !sVal; p.stock = sVal;
      this.innerHTML = sVal ? '<span class="badge badge-conf">✓</span>' : '<span class="badge badge-cancel">✗</span>';
      crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo:'stock', valor: sVal })
        .then(() => toast('Stock actualizado ✓')).catch(() => toast('Error','err'));
    });
    tr.querySelector('.td-dest').addEventListener('click', function() {
      hVal = !hVal; p.destacado = hVal;
      this.innerHTML = hVal ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>';
      crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo:'destacado', valor: hVal })
        .then(() => toast('Destacado actualizado ✓')).catch(() => toast('Error','err'));
    });
    tr.querySelector('.btn-icon').addEventListener('click', () => editarProducto(decodeURIComponent(safe)));

    tbody.appendChild(tr);
  });
}

async function editarCeldaNum(td, p, campo, valorActual, onSave) {
  if (td.querySelector('input')) return;
  td.innerHTML = `<input type="number" class="inline-input" value="${valorActual}" min="0" step="1">`;
  const input = td.querySelector('input');
  input.focus(); input.select();
  const renderVal = v => v ? `<strong>$${Number(v).toLocaleString('es-AR')}</strong><i class="fa-solid fa-pen edit-hint"></i>`
                           : `<span class="text-muted">—</span><i class="fa-solid fa-pen edit-hint"></i>`;
  const guardar = async () => {
    const nuevo = Number(input.value) || 0;
    td.innerHTML = renderVal(nuevo);
    if (nuevo === valorActual) return;
    try {
      await crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo, valor: nuevo });
      onSave(nuevo);
      toast('Guardado ✓');
    } catch(e) { toast('Error al guardar','err'); td.innerHTML = renderVal(valorActual); }
  };
  input.addEventListener('blur', guardar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { td.innerHTML = renderVal(valorActual); }
  });
}

let _prodActual = null;

function editarProducto(raw) {
  const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
  _prodActual = p;

  $('mprod-title').textContent  = p.categoria;
  $('mprod-nombre').value       = p.nombre;
  $('mprod-categoria-info').textContent = p.categoria || '';
  $('mprod-color-info').textContent     = (p.color || p.marca || p.talle)
    ? [p.color||p.marca, p.talle].filter(Boolean).join(' · ') : '—';

  const precioN = Number(String(p.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  const descN   = Number(String(p.descuento||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  $('mprod-precio').value     = precioN;
  $('mprod-descuento').value  = descN;
  $('mprod-stock').checked    = !!p.stock;
  $('mprod-destacado').checked= !!p.destacado;

  if (p.descripcion) {
    $('mprod-desc-wrap').style.display = 'block';
    $('mprod-desc').textContent = p.descripcion;
  } else {
    $('mprod-desc-wrap').style.display = 'none';
  }

  $('fotos-grid').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  show('modal-producto', 'flex');
  cargarFotos(p);
}

async function cargarFotos(p) {
  const carpeta = `Productos/${p.categoria||'Sin Categoria'}/${p.nombre}`;
  try {
    const r = await crm({ action:'fotos_list', carpeta });
    renderFotos(r.fotos||[], carpeta);
  } catch(e) {
    $('fotos-grid').innerHTML = '<p class="text-muted">No se pudieron cargar las fotos</p>';
  }
}

function renderFotos(fotos, carpeta) {
  const grid = $('fotos-grid');
  if (!fotos.length) { grid.innerHTML = '<p class="text-muted" style="font-size:0.82rem">Sin fotos</p>'; return; }
  const base = location.origin + '/' + window.location.pathname.replace(/\/crm\/.*$/, '/');
  grid.innerHTML = fotos.map((fn, i) => {
    const url = base + carpeta + '/' + fn;
    return `
      <div class="foto-item" id="foto-${i}">
        <img src="${url}" alt="${fn}">
        ${i===0 ? '<span class="foto-first-badge">Principal</span>' : ''}
        <button class="foto-del" onclick="borrarFoto('${carpeta}','${fn}')">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>`;
  }).join('');
}

async function subirFoto(input) {
  if (!input.files[0] || !_prodActual) return;
  const p = _prodActual;
  const carpeta = `Productos/${p.categoria||'Sin Categoria'}/${p.nombre}`;
  $('fotos-grid').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Subiendo…</div>';
  try {
    const data = await fileABase64(input.files[0]);
    const fn = (await (data.length > 500000
      ? crmPost({ action:'foto_subir', carpeta, data })
      : crm({ action:'foto_subir', carpeta, data }))).foto;
    if (fn) { toast('Foto subida'); cargarFotos(p); }
    else throw new Error('sin respuesta');
  } catch(e) { toast('Error al subir foto','err'); cargarFotos(p); }
  input.value = '';
}

async function borrarFoto(carpeta, filename) {
  confirmar(`¿Borrar la foto "${filename}"?`, async () => {
    try {
      await crm({ action:'foto_borrar', carpeta, filename });
      toast('Foto borrada');
      cargarFotos(_prodActual);
    } catch(e) { toast('Error','err'); }
  });
}

async function guardarProducto() {
  if (!_prodActual) return;
  const p = _prodActual;
  const precio    = Number($('mprod-precio').value) || 0;
  const descuento = Number($('mprod-descuento').value) || 0;
  const stock     = $('mprod-stock').checked;
  const destacado = $('mprod-destacado').checked;

  const updates = [
    { campo:'precio',    valor: precio    },
    { campo:'descuento', valor: descuento },
    { campo:'stock',     valor: stock     },
    { campo:'destacado', valor: destacado },
  ];

  try {
    for (const u of updates) {
      await crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo: u.campo, valor: u.valor });
    }
    const idx = _productos.findIndex(x => x._sheet === p._sheet && x._row === p._row);
    if (idx >= 0) {
      _productos[idx].precio    = precio;
      _productos[idx].descuento = descuento;
      _productos[idx].stock     = stock;
      _productos[idx].destacado = destacado;
    }
    toast('Producto guardado en Sheets ✓');
    hide('modal-producto');
    filtrarProductos();
  } catch(e) {
    toast('Error al guardar: ' + e.message, 'err');
  }
}

// ─── PEDIDOS ─────────────────────────────────────────────────

let _pedidos = [];

async function loadPedidos(force=false) {
  if (!force && _pedidos.length) { filtrarPedidos(); return; }
  $('ped-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    const raw = await crm({ action: 'ext_pedidos_listar' });
    _pedidos = Array.isArray(raw) ? [...raw].reverse() : [];
    filtrarPedidos();
  } catch(e) {
    $('ped-table').innerHTML = `<div style="padding:20px;text-align:center">
      <p class="text-muted" style="margin-bottom:12px">No se pudo cargar</p>
      <button class="btn-secondary" onclick="loadPedidos(true)"><i class="fa-solid fa-rotate-right"></i> Reintentar</button>
    </div>`;
  }
}

function filtrarPedidos() {
  const q   = val('ped-search').toLowerCase();
  const est = val('ped-estado-fil');
  let list = _pedidos;
  if (est) list = list.filter(p => (p.estado||'Pendiente') === est);
  if (q)  list = list.filter(p =>
    (p.nombre||p.cliente||'').toLowerCase().includes(q) ||
    (p.producto||p.detalle||'').toLowerCase().includes(q) ||
    (p.telefono||'').includes(q));
  renderPedidos(list);
}

function renderPedidos(list) {
  const el = $('ped-table');
  if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bag-shopping"></i>Sin pedidos</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Fecha</th><th>Cliente</th><th>Producto</th>
        <th>Talle</th><th>Color</th><th>Total</th><th>Pago</th><th>Estado</th>
      </tr></thead>
      <tbody>
        ${list.map(p => `
          <tr>
            <td style="white-space:nowrap">${fmtFecha(p.fecha||p.timestamp||'')}</td>
            <td><strong>${p.nombre||p.cliente||'—'}</strong><div style="font-size:0.78rem;color:var(--text2)">${p.telefono||''}</div></td>
            <td style="max-width:180px;font-size:0.82rem">${p.producto||p.detalle||'—'}</td>
            <td>${p.talle||'—'}</td>
            <td>${p.color||'—'}</td>
            <td><strong>${p.total ? '$'+Number(p.total).toLocaleString('es-AR') : '—'}</strong></td>
            <td>${p.metodo||p.pago||'—'}</td>
            <td>${badgeEstado(p.estado||'Pendiente')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function abrirModalPedido() {
  $('mped-title').textContent = 'Nuevo pedido';
  ['mped-id','mped-cliente','mped-telefono','mped-detalle','mped-monto','mped-notas'].forEach(id => $(id).value = '');
  $('mped-estado').value = 'Pendiente';
  hide('nuevo-cli-wrap');
  hide('mped-comp-wrap');
  show('modal-pedido', 'flex');
  setTimeout(() => $('mped-cliente').focus(), 50);
}

function editarPedido(p) {
  $('mped-title').textContent  = 'Editar pedido';
  $('mped-id').value       = p.id||'';
  $('mped-cliente').value  = p.cliente||'';
  $('mped-telefono').value = p.telefono||'';
  $('mped-detalle').value  = p.detalle||'';
  $('mped-monto').value    = p.monto||'';
  $('mped-estado').value   = p.estado||'Pendiente';
  $('mped-notas').value    = p.notas||'';
  hide('nuevo-cli-wrap');
  if (p.comprobante) {
    $('mped-comp-link').href = p.comprobante;
    show('mped-comp-wrap');
  } else {
    hide('mped-comp-wrap');
  }
  show('modal-pedido', 'flex');
}

let _mostrarNuevoCli = false;
function toggleNuevoCli() {
  _mostrarNuevoCli = !_mostrarNuevoCli;
  $('nuevo-cli-wrap').style.display = _mostrarNuevoCli ? 'block' : 'none';
}

async function guardarPedido() {
  const cliente = val('mped-cliente');
  if (!cliente) { toast('El cliente es obligatorio','err'); return; }
  const id = val('mped-id');
  let clienteid = '';

  if (_mostrarNuevoCli && !id) {
    try {
      const r = await crm({
        action:'add', tab:'Clientes', nombre:cliente,
        telefono: val('mped-telefono'), email: val('mped-ncli-email'), ciudad: val('mped-ncli-ciudad')
      });
      clienteid = r.id||'';
      invalidate('list:Clientes');
    } catch(e) { toast('Error al crear cliente','err'); return; }
  }

  const params = {
    action: id ? 'update' : 'add', tab: 'Pedidos',
    cliente, telefono: val('mped-telefono'), detalle: val('mped-detalle'),
    monto: val('mped-monto'), estado: $('mped-estado').value, notas: val('mped-notas')
  };
  if (id) params.id = id;
  if (clienteid) params.clienteid = clienteid;
  try {
    const r = await crm(params);
    if (!r.ok) throw new Error(r.error||'error');
    toast(id ? 'Pedido actualizado' : 'Pedido guardado');
    hide('modal-pedido');
    _mostrarNuevoCli = false;
    invalidate('list:Pedidos');
    loadPedidos(true);
  } catch(e) { toast('Error: '+e.message,'err'); }
}

function borrarPedido(id) {
  confirmar('¿Borrar este pedido?', async () => {
    try {
      await crm({ action:'delete', tab:'Pedidos', id });
      toast('Pedido borrado');
      invalidate('list:Pedidos');
      loadPedidos(true);
    } catch(e) { toast('Error: '+e.message,'err'); }
  });
}

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('ops_auth') === '1') {
    hide('login-wrap');
    show('app', 'flex');
    goTo('clientes');
  }
});
