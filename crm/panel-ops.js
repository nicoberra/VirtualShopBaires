// ============================================================
//  CRM Panel Operaciones — Virtual Shop Baires
//  panel-ops.js  (solo Clientes, Productos, Pedidos)
// ============================================================

// ─── CONFIG ──────────────────────────────────────────────────
const CRM_URL = 'https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec';
// ─────────────────────────────────────────────────────────────

// ─── COMUNICACIÓN CON EL BACKEND ─────────────────────────────

function crm(params) {
  return new Promise((resolve, reject) => {
    // Inyectar token en todas las llamadas excepto las públicas
    const PUBLIC = { loginPanel:1, verifyPanel:1, version:1 };
    const token = !PUBLIC[params.action] ? sessionStorage.getItem('ops_crm_token') : null;
    const allParams = token ? { token, ...params } : { ...params };

    const cb = 'cb_' + Date.now() + Math.floor(Math.random() * 1e6);
    const qs = new URLSearchParams({ ...allParams, callback: cb, _: Date.now() });
    const s  = document.createElement('script');
    const ok = () => { delete window[cb]; s.remove(); };
    const to = setTimeout(() => { ok(); reject(new Error('timeout')); }, 45000);
    window[cb] = (data) => {
      clearTimeout(to); ok();
      // Token expirado o inválido: volver al login
      if (data && data.ok === false && data.error === 'auth') {
        sessionStorage.removeItem('ops_crm_token');
        location.reload();
        return;
      }
      resolve(data);
    };
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

async function doLogin() {
  const pass = val('login-pass');
  if (!pass) return;
  const btn = document.querySelector('#login-box button');
  if (btn) btn.disabled = true;
  $('login-err').textContent = '';
  try {
    const data = await crm({ action: 'loginPanel', clave: pass });
    if (data.ok && data.token) {
      sessionStorage.setItem('ops_crm_token', data.token);
      localStorage.removeItem('ops_auth'); // limpiar credencial vieja
      hide('login-wrap');
      show('app', 'flex');
      goTo('panel');
      prefetchAll();
    } else {
      $('login-err').textContent = data.error || 'Contraseña incorrecta.';
      shakeLoginBox();
    }
  } catch {
    $('login-err').textContent = 'Error de conexión. Intentá de nuevo.';
    shakeLoginBox();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function shakeLoginBox() {
  const box = $('login-box');
  if (!box) return;
  box.classList.remove('crm-shake');
  void box.offsetWidth;
  box.classList.add('crm-shake');
  box.addEventListener('animationend', () => box.classList.remove('crm-shake'), { once: true });
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
  sessionStorage.removeItem('ops_crm_token');
  localStorage.removeItem('ops_auth');
  localStorage.removeItem('vsb_nav_from_crm');
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
    panel:     loadPanel,
    clientes:  loadClientes,
    productos: loadProductos,
    pedidos:   loadPedidos,
  };
  if (loaders[sec]) loaders[sec]();
}

async function loadPanel() {
  const cards = $('panel-ops-cards');
  cards.innerHTML = '<div class="stat-card" style="grid-column:1/-1"><div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div></div>';
  try {
    const [clientes, productos, pedidos] = await Promise.all([
      getData('ext_clientes_listar', null, false).catch(() => []),
      getData('ext_productos_listar', null, false).catch(() => []),
      getData('ext_pedidos_listar',   null, false).catch(() => []),
    ]);
    if (!_clientes.length  && clientes.length)  _clientes  = clientes;
    if (!_productos.length && productos.length) _productos = productos;
    if (!_pedidos.length   && pedidos.length)   _pedidos   = pedidos;

    const pendientes = pedidos.filter(p => !p.estado || p.estado === 'Pendiente').length;
    const enCamino   = pedidos.filter(p => p.estado === 'En camino').length;

    cards.innerHTML = `
      <div class="stat-card stat-card-link" onclick="goTo('clientes')"><div class="stat-label">Clientes</div><div class="stat-val">${clientes.length}</div></div>
      <div class="stat-card stat-card-link" onclick="goTo('productos')"><div class="stat-label">Productos</div><div class="stat-val">${productos.length}</div></div>
      <div class="stat-card stat-card-link" onclick="goTo('pedidos')"><div class="stat-label">Pedidos pendientes</div><div class="stat-val">${pendientes}</div></div>
      <div class="stat-card stat-card-link" onclick="goTo('pedidos')"><div class="stat-label">En camino</div><div class="stat-val">${enCamino}</div></div>`;

    // Pedidos recientes
    const recPed = pedidos.slice(0, 5);
    const pedWrap = $('panel-ops-pedidos-rec');
    pedWrap.innerHTML = '';
    if (recPed.length) {
      recPed.forEach(p => {
        const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.cliente || '—';
        const est    = p.estado || 'Pendiente';
        const cls    = est === 'Entregado' ? 'badge-entre' : est === 'En camino' ? 'badge-camino' : 'badge-pend';
        const item   = document.createElement('div');
        item.className = 'panel-rec-item panel-rec-clickable';
        item.innerHTML = `<div class="panel-rec-left"><div class="panel-rec-name">${nombre}</div><div class="panel-rec-sub">${p.productos||p.producto||p.detalle||''}</div></div><span class="badge ${cls}">${est}</span>`;
        item.addEventListener('click', () => goTo('pedidos'));
        pedWrap.appendChild(item);
      });
    } else {
      pedWrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-inbox"></i>Sin pedidos</div>';
    }

    // Clientes recientes
    const recCli = [...clientes].reverse().slice(0, 5);
    const cliWrap = $('panel-ops-clientes-rec');
    cliWrap.innerHTML = '';
    if (recCli.length) {
      recCli.forEach(c => {
        const item = document.createElement('div');
        item.className = 'panel-rec-item panel-rec-clickable';
        item.innerHTML = `<div class="panel-rec-left"><div class="panel-rec-name">${c.nombre||'—'}</div><div class="panel-rec-sub">${c.email||c.telefono||''}</div></div><div style="font-size:0.78rem;color:var(--text2)">${c.ciudad||''}</div>`;
        item.addEventListener('click', () => { goTo('clientes'); verHistorialCliente(c); });
        cliWrap.appendChild(item);
      });
    } else {
      cliWrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user"></i>Sin clientes</div>';
    }
  } catch(e) {
    cards.innerHTML = `<div class="stat-card" style="grid-column:1/-1"><p class="text-muted">Error al cargar: ${e.message}</p></div>`;
  }
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

let _clientes = [];

function pedidosDeCliente(cli) {
  const dig = t => String(t||'').replace(/\D/g,'');
  const cliTel   = dig(cli.telefono);
  const cliEmail = (cli.email||'').toLowerCase().trim();
  const cliNom   = (cli.nombre||'').trim().toLowerCase();
  return _pedidos.filter(p => {
    if (cliEmail && (p.email||'').toLowerCase().trim() === cliEmail) return true;
    if (cliTel   && dig(p.telefono) === cliTel) return true;
    const pNom = ((p.nombre||'') + ' ' + (p.apellido||'')).trim().toLowerCase();
    if (cliNom   && pNom.includes(cliNom)) return true;
    return false;
  });
}

async function loadClientes(force=false) {
  if (!force && _clientes.length) { filtrarClientes(); return; }
  $('cli-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    _clientes = await getData('list','Clientes',force);
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
        String(c.apellido||'').toLowerCase().includes(q) ||
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
      <tbody id="cli-tbody"></tbody>
    </table>`;
  const tbody = $('cli-tbody');
  list.forEach(c => {
    const numPedidos = pedidosDeCliente(c).length;
    const nombreCompleto = [c.nombre, c.apellido].filter(Boolean).join(' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-nombre" style="cursor:pointer"><strong>${nombreCompleto||'—'}</strong>${c.ciudad ? `<div class="prod-sub">${c.ciudad}</div>` : ''}</td>
      <td>${c.email||'—'}</td>
      <td>${c.telefono||'—'}</td>
      <td class="hide-mobile">${c.ciudad||'—'}</td>
      <td style="text-align:center">
        <span class="badge ${numPedidos > 0 ? 'badge-conf' : ''}" style="cursor:${numPedidos>0?'pointer':'default'}">${numPedidos}</span>
      </td>
      <td class="td-actions">
        ${c.telefono ? `<button class="btn-icon btn-wa" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
        <button class="btn-icon" title="Ver historial"><i class="fa-solid fa-clock-rotate-left"></i></button>
        <button class="btn-icon edit-btn" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon del-btn" title="Borrar" style="color:var(--red)"><i class="fa-solid fa-trash"></i></button>
      </td>`;
    tr.querySelector('.td-nombre').addEventListener('click', () => verHistorialCliente(c));
    tr.querySelector('td:nth-child(5) .badge').addEventListener('click', () => verHistorialCliente(c));
    const waBtn = tr.querySelector('.btn-wa');
    if (waBtn) {
      waBtn.addEventListener('click', () => {
        const tel = String(c.telefono||'').replace(/\D/g,'');
        window.open('https://wa.me/' + tel, '_blank');
      });
    }
    tr.querySelector('.btn-icon:not(.btn-wa)').addEventListener('click', () => verHistorialCliente(c));
    tr.querySelector('.edit-btn').addEventListener('click', () => editarCliente(c));
    tr.querySelector('.del-btn').addEventListener('click', () => borrarCliente(c.id, c.nombre||''));
    tbody.appendChild(tr);
  });
}

function verHistorialCliente(cli) {
  const ped = pedidosDeCliente(cli);
  const nombreCompleto = [cli.nombre, cli.apellido].filter(Boolean).join(' ');
  $('mhist-title').textContent = `${nombreCompleto} — ${ped.length} pedido${ped.length !== 1 ? 's' : ''}`;
  const body = $('mhist-body');
  if (!ped.length) {
    body.innerHTML = '<div class="empty-state" style="padding:30px 0"><i class="fa-solid fa-bag-shopping"></i><p>Sin pedidos registrados</p></div>';
  } else {
    const sorted = [...ped].sort((a,b) => new Date(b.fecha||0) - new Date(a.fecha||0));
    body.innerHTML = sorted.map(p => {
      const fecha = p.fecha ? new Date(p.fecha).toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}) : '—';
      const esEnvio = (p.entrega||'').toLowerCase().includes('env');
      const estadoCls = {'pendiente':'badge-pend','confirmado':'badge-conf','en camino':'badge-cam','entregado':'badge-entr','cancelado':'badge-cancel'}[(p.estado||'').toLowerCase()] || '';
      return `<div class="hist-item">
        <div class="hist-header">
          <span class="hist-num">${p.orderNumber||'Pedido'}</span>
          <span class="hist-fecha">${fecha}</span>
          <span class="badge ${estadoCls}">${p.estado||'—'}</span>
        </div>
        <div class="hist-productos">${p.productos||'—'}</div>
        <div class="hist-meta">
          <span><i class="fa-solid fa-${esEnvio?'truck':'store-alt'}" style="margin-right:4px;color:var(--text2)"></i>${esEnvio?'Envío a domicilio':'Retiro en local'}</span>
          <span><i class="fa-solid fa-credit-card" style="margin-right:4px;color:var(--text2)"></i>${p.metodoPago||'—'}</span>
          <span class="hist-total">$${Number(p.total||0).toLocaleString('es-AR')}</span>
        </div>
      </div>`;
    }).join('');
  }
  show('modal-cli-hist', 'flex');
}

const _CLI_FIELDS = ['mcli-id','mcli-nombre','mcli-apellido','mcli-telefono','mcli-dni',
  'mcli-email','mcli-direccion','mcli-cp','mcli-ciudad','mcli-provincia',
  'mcli-cuit','mcli-iva','mcli-razon','mcli-notas'];

function abrirModalCliente() {
  $('mcli-title').textContent = 'Nuevo cliente';
  _CLI_FIELDS.forEach(id => $(id).value = '');
  show('modal-cliente', 'flex');
  setTimeout(() => $('mcli-nombre').focus(), 50);
}

function editarCliente(c) {
  $('mcli-title').textContent = 'Editar cliente';
  $('mcli-id').value        = c.id||'';
  $('mcli-nombre').value    = c.nombre||'';
  $('mcli-apellido').value  = c.apellido||'';
  $('mcli-telefono').value  = c.telefono||'';
  $('mcli-dni').value       = c.dni||'';
  $('mcli-email').value     = c.email||'';
  $('mcli-direccion').value = c.direccion||'';
  $('mcli-cp').value        = c.cp||'';
  $('mcli-ciudad').value    = c.ciudad||'';
  $('mcli-provincia').value = c.provincia||'';
  $('mcli-cuit').value      = c.cuit||'';
  $('mcli-iva').value       = c.iva||'';
  $('mcli-razon').value     = c.razon||'';
  $('mcli-notas').value     = c.notas||'';
  show('modal-cliente', 'flex');
}

async function guardarCliente() {
  const nombre = val('mcli-nombre');
  if (!nombre) { toast('El nombre es obligatorio','err'); return; }
  const id = val('mcli-id');
  const params = {
    action: id ? 'update' : 'add', tab: 'Clientes',
    nombre, apellido: val('mcli-apellido'), telefono: val('mcli-telefono'),
    dni: val('mcli-dni'), email: val('mcli-email'),
    direccion: val('mcli-direccion'), cp: val('mcli-cp'),
    ciudad: val('mcli-ciudad'), provincia: val('mcli-provincia'),
    cuit: val('mcli-cuit'), iva: val('mcli-iva'), razon: val('mcli-razon'),
    notas: val('mcli-notas')
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
  const html = cats.map(c => {
    const active = c === _prodCatFil ? ' active' : '';
    const catEsc = c.replace(/'/g, "\\'");
    return `<span class="chip${active}" onclick="setProdCat('${catEsc}')">${c}</span>`;
  }).join('');
  $('prod-cats').innerHTML = html +
    `<button class="btn-danger btn-sm" style="margin-left:4px" onclick="abrirModalEditarCats()"><i class="fa-solid fa-pen"></i> Editar categorías</button>`;
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

    let pVal = precioN, dVal = descN, sVal = Number(p.stock) || 0, hVal = !!p.destacado;

    const renderStock = v => v > 0
      ? `<strong>${v}</strong><i class="fa-solid fa-pen edit-hint"></i>`
      : `<span class="badge badge-cancel">0</span><i class="fa-solid fa-pen edit-hint"></i>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="td-nombre" style="cursor:pointer"><strong>${p.nombre}</strong>${p.subcategoria ? `<div class="prod-sub">${p.subcategoria}</div>` : ''}</td>
      ${hayColor ? `<td>${colorMarca ? `<span class="badge-color">${colorMarca}</span>` : '—'}</td>` : ''}
      ${hayTalle ? `<td>${p.talle||'—'}</td>` : ''}
      <td class="td-editable td-precio"><strong>${fmtPrecioSheet(p.precio)}</strong><i class="fa-solid fa-pen edit-hint"></i></td>
      <td class="td-editable td-desc"><span class="text-muted">${fmtPrecioSheet(p.descuento)}</span><i class="fa-solid fa-pen edit-hint"></i></td>
      <td class="td-editable td-stock">${renderStock(sVal)}</td>
      <td class="td-center td-toggle td-dest">${hVal ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>'}</td>
      <td style="white-space:nowrap">
        <a class="btn-icon" href="https://virtualshopbaires.com.ar/productos.html?cat=${encodeURIComponent(p.categoria||'')}&buscar=${encodeURIComponent(p.nombre||'')}" target="_blank" rel="noopener" title="Ver en tienda"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        <button class="btn-icon btn-edit-prod" title="Ver / editar completo"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn-icon btn-del-prod" title="Eliminar producto" style="color:var(--red)"><i class="fa-solid fa-trash"></i></button>
      </td>`;

    tr.querySelector('.td-nombre').addEventListener('click', () => editarProducto(decodeURIComponent(safe)));
    tr.querySelector('.td-precio').addEventListener('click', function() {
      editarCeldaNum(this, p, 'precio', pVal, v => { pVal = v; p.precio = v; }, '$');
    });
    tr.querySelector('.td-desc').addEventListener('click', function() {
      editarCeldaNum(this, p, 'descuento', dVal, v => { dVal = v; p.descuento = v; }, '$');
    });
    tr.querySelector('.td-stock').addEventListener('click', function() {
      editarCeldaNum(this, p, 'stock', sVal, v => { sVal = v; p.stock = v; }, '', renderStock);
    });
    tr.querySelector('.td-dest').addEventListener('click', function() {
      hVal = !hVal; p.destacado = hVal;
      this.innerHTML = hVal ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>';
      crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo:'destacado', valor: hVal })
        .then(() => toast('Destacado actualizado ✓')).catch(() => toast('Error','err'));
    });
    tr.querySelector('.btn-edit-prod').addEventListener('click', () => editarProducto(decodeURIComponent(safe)));
    tr.querySelector('.btn-del-prod').addEventListener('click', () => eliminarProducto(p));

    tbody.appendChild(tr);
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

  $('mprod-title').textContent   = p.nombre || p.categoria || 'Producto';
  $('mprod-nombre').value        = p.nombre || '';
  $('mprod-color').value         = p.color || p.marca || '';
  $('mprod-talle').value         = p.talle || p.subcategoria || '';
  $('mprod-descripcion').value   = p.descripcion || '';

  const precioN = Number(String(p.precio||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  const descN   = Number(String(p.descuento||0).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  const stockN  = Number(p.stock) || 0;
  $('mprod-precio').value      = precioN;
  $('mprod-descuento').value   = descN;
  $('mprod-stock-num').value   = stockN;
  $('mprod-destacado').checked = !!p.destacado;

  const todasCats = [...new Set(_productos.map(x => x.categoria).filter(Boolean))].sort();
  const selCats   = (p.categoria||'').split(',').map(c => c.trim()).filter(Boolean);
  const wrap = $('mprod-cats-chips');
  wrap.innerHTML = '';
  todasCats.forEach(cat => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cat-chip' + (selCats.includes(cat) ? ' cat-chip-sel' : '');
    chip.textContent = cat;
    chip.addEventListener('click', () => chip.classList.toggle('cat-chip-sel'));
    wrap.appendChild(chip);
  });

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
  const base = location.origin + window.location.pathname.replace(/\/crm\/.*$/, '/');
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
  const nombre    = $('mprod-nombre').value.trim();
  const color     = $('mprod-color').value.trim();
  const talle     = $('mprod-talle').value.trim();
  const descripcion = $('mprod-descripcion').value.trim();
  const precio    = Number($('mprod-precio').value) || 0;
  const descuento = Number($('mprod-descuento').value) || 0;
  const stock     = Number($('mprod-stock-num').value) || 0;
  const destacado = $('mprod-destacado').checked;
  const catsSel   = [...$('mprod-cats-chips').querySelectorAll('.cat-chip-sel')].map(ch => ch.textContent).join(', ');

  const updates = [
    { campo:'nombre',      valor: nombre      },
    { campo:'categoria',   valor: catsSel     },
    { campo:'color',       valor: color       },
    { campo:'talle',       valor: talle       },
    { campo:'descripcion', valor: descripcion },
    { campo:'precio',      valor: precio      },
    { campo:'descuento',   valor: descuento   },
    { campo:'stock',       valor: stock       },
    { campo:'destacado',   valor: destacado   },
  ];

  try {
    for (const u of updates) {
      await crm({ action:'ext_producto_update', sheet: p._sheet, row: p._row, campo: u.campo, valor: u.valor });
    }
    const idx = _productos.findIndex(x => x._sheet === p._sheet && x._row === p._row);
    if (idx >= 0) {
      Object.assign(_productos[idx], { nombre, categoria: catsSel, color, talle, descripcion, precio, descuento, stock, destacado });
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
let _pedPeriodo = 'hoy';

function setPedPeriodo(p) {
  _pedPeriodo = p;
  document.querySelectorAll('#ped-periodo-chips .cat-chip').forEach(b => b.classList.toggle('cat-chip-sel', b.dataset.p === p));
  filtrarPedidos();
}

function _filtrarPorPeriodo(list) {
  if (_pedPeriodo === 'todos') return list;
  const hoy  = new Date(); hoy.setHours(0,0,0,0);
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate()-1);
  const sem  = new Date(hoy); sem.setDate(sem.getDate()-6);
  return list.filter(p => {
    const d = new Date(String(p.timestamp||p.fecha||'').replace(' ','T'));
    if (isNaN(d)) return false;
    if (_pedPeriodo === 'hoy')    return d >= hoy;
    if (_pedPeriodo === 'ayer')   return d >= ayer && d < hoy;
    if (_pedPeriodo === 'semana') return d >= sem;
    return true;
  });
}

function refreshCurrent() {
  const btn = $('btn-refresh-global');
  if (btn) { btn.classList.add('spinning'); setTimeout(() => btn.classList.remove('spinning'), 700); }
  if (currentSec === 'pedidos')   { delete _cache['ext_pedidos_listar'];   _pedidos   = []; loadPedidos(true);   return; }
  if (currentSec === 'clientes')  { delete _cache['ext_clientes_listar'];  _clientes  = []; loadClientes(true);  return; }
  if (currentSec === 'productos') { delete _cache['ext_productos_listar']; _productos = []; loadProductos(true); return; }
  if (currentSec === 'panel')     { Object.keys(_cache).forEach(k => delete _cache[k]); _clientes = []; _pedidos = []; _productos = []; loadPanel(); return; }
}

async function refreshPedidos() {
  const btn = $('btn-refresh-ped');
  if (btn) { btn.classList.add('spinning'); setTimeout(() => btn.classList.remove('spinning'), 650); }
  delete _cache['ext_pedidos_listar'];
  _pedidos = [];
  await loadPedidos(true);
}

async function loadPedidos(force=false, silent=false) {
  if (!force && _pedidos.length) { filtrarPedidos(); return; }
  if (!silent) $('ped-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
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
  let list = _filtrarPorPeriodo(_pedidos);
  if (est) list = list.filter(p => (p.estado||'Pendiente') === est);
  if (q)  list = list.filter(p =>
    (p.nombre||p.cliente||'').toLowerCase().includes(q) ||
    (p.apellido||'').toLowerCase().includes(q) ||
    (p.email||'').toLowerCase().includes(q) ||
    (p.productos||p.producto||p.detalle||'').toLowerCase().includes(q) ||
    (p.orderNumber||'').toLowerCase().includes(q) ||
    (p.telefono||'').includes(q) ||
    (p.dni||'').includes(q));
  renderPedidos(list);
}

function renderPedidos(list) {
  const el = $('ped-table');
  if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bag-shopping"></i>Sin pedidos</div>'; return; }

  const t = document.createElement('table');
  const thead = t.createTHead();
  const hr = thead.insertRow();
  ['Fecha','Pedido','Cliente','Email','Total','Pago','Entrega','Estado',''].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
  });
  const tbody = t.createTBody();

  list.forEach(p => {
    const nombre   = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.cliente || '—';
    const telefono = p.telefono || '';
    const email    = p.email || '';
    const orderNum = p.orderNumber || p.id || '';
    const total    = p.total  ? '$' + Number(p.total).toLocaleString('es-AR')
                   : p.monto  ? '$' + Number(p.monto).toLocaleString('es-AR') : '—';
    const pago     = p.metodoPago || p.metodo || p.pago || '—';
    const entrega  = p.metodoEntrega || '—';
    const estado   = p.estado || 'Pendiente';

    const tr = tbody.insertRow();
    tr.className = 'ped-row-main';

    const tdFecha = tr.insertCell(); tdFecha.style.whiteSpace = 'nowrap';
    tdFecha.textContent = fmtFecha(p.timestamp || p.fecha || '');

    const tdNum = tr.insertCell();
    tdNum.style.cssText = 'font-size:0.72rem;color:var(--text2);white-space:nowrap';
    tdNum.textContent = orderNum;

    const tdCli = tr.insertCell();
    tdCli.innerHTML = `<strong>${nombre}</strong>${telefono ? `<div style="font-size:0.78rem;color:var(--text2)">${telefono}</div>` : ''}`;

    const tdEmail = tr.insertCell(); tdEmail.style.fontSize = '0.82rem';
    tdEmail.textContent = email;

    const tdTotal = tr.insertCell();
    tdTotal.innerHTML = `<strong>${total}</strong>`;

    const tdPago = tr.insertCell(); tdPago.style.fontSize = '0.82rem';
    tdPago.textContent = pago;

    const tdEntrega = tr.insertCell(); tdEntrega.style.fontSize = '0.82rem';
    tdEntrega.textContent = entrega;

    const tdEstado = tr.insertCell();
    tdEstado.innerHTML = badgeEstado(estado);

    const tdChev = tr.insertCell();
    tdChev.innerHTML = '<i class="fa-solid fa-chevron-down ped-chevron"></i>';

    const dr = tbody.insertRow();
    dr.style.display = 'none';
    const dc = dr.insertCell();
    dc.colSpan = 9;

    let dir = '';
    if (p.calle) {
      dir = p.calle + (p.numeroCalle ? ' ' + p.numeroCalle : '');
      if (p.piso)      dir += ', piso ' + p.piso;
      if (p.localidad) dir += ' · ' + p.localidad;
      if (p.provincia) dir += ', ' + p.provincia;
      if (p.cp)        dir += ' (CP ' + p.cp + ')';
    }

    dc.innerHTML = `<div class="ped-detail-box">
      ${p.dni         ? `<div><span class="ped-label">DNI/CUIT:</span> ${p.dni}</div>` : ''}
      ${dir           ? `<div><span class="ped-label">Dirección:</span> ${dir}</div>` : ''}
      ${p.productos   ? `<div style="flex-basis:100%"><span class="ped-label">Productos:</span> ${p.productos}</div>` : ''}
      ${p.observaciones ? `<div><span class="ped-label">Notas:</span> ${p.observaciones}</div>` : ''}
      ${(p.subtotal && Number(p.descuento) > 0) ? `<div><span class="ped-label">Subtotal:</span> $${Number(p.subtotal).toLocaleString('es-AR')} · <span class="ped-label">Descuento:</span> -$${Number(p.descuento).toLocaleString('es-AR')}</div>` : ''}
      <div style="margin-top:4px;flex-basis:100%">
        <span class="ped-label">Estado:</span>
        <select class="sel sel-sm" onchange="cambiarEstadoPedido(this,${p._row||0})">
          ${['Pendiente','Confirmado','En camino','Entregado','Cancelado'].map(e =>
            `<option${e===estado?' selected':''}>${e}</option>`).join('')}
        </select>
      </div>
    </div>`;

    tr.addEventListener('click', () => {
      const open = dr.style.display !== 'none';
      dr.style.display = open ? 'none' : 'table-row';
      const ch = tdChev.querySelector('.ped-chevron');
      if (ch) ch.style.transform = open ? '' : 'rotate(180deg)';
    });
  });

  el.innerHTML = '';
  el.appendChild(t);
}

async function cambiarEstadoPedido(sel, row) {
  const estado = sel.value;
  try {
    await crm({ action: 'ext_pedido_update', row, campo: 'estado', valor: estado });
    const p = _pedidos.find(x => String(x._row) === String(row));
    if (p) p.estado = estado;
    toast('Estado actualizado');
  } catch(e) {
    toast('Error al actualizar', 'err');
  }
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

// ─── GESTIÓN DE PRODUCTOS Y CATEGORÍAS ───────────────────────

function abrirModalNuevoProd() {
  const cats = [...new Set(_productos.map(p => p.categoria).filter(Boolean))].sort();
  const sel = $('np-categoria');
  sel.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  if (_prodCatFil !== 'Todos') sel.value = _prodCatFil;
  $('np-nombre').value = '';
  $('np-precio').value = '0';
  $('np-stock').value = '1';
  $('np-marca').value = '';
  show('modal-nuevo-prod', 'flex');
  setTimeout(() => $('np-nombre').focus(), 100);
}

async function guardarNuevoProd() {
  const nombre = $('np-nombre').value.trim();
  const categoria = $('np-categoria').value;
  if (!nombre || !categoria) { toast('Completá nombre y categoría', 'err'); return; }
  const btn = $('np-btn-guardar');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await crm({ action:'ext_producto_agregar', sheet: categoria, nombre,
      precio: Number($('np-precio').value)||0,
      stock:  Number($('np-stock').value)||1,
      marca:  $('np-marca').value.trim() });
    toast('Producto agregado ✓');
    hide('modal-nuevo-prod');
    delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
  } catch(e) { toast('Error al agregar', 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Agregar producto'; }
}

function eliminarProducto(p) {
  confirmar(`¿Eliminar "${p.nombre}"? Esta acción no se puede deshacer.`, async () => {
    try {
      await crm({ action:'ext_producto_eliminar', sheet: p._sheet, row: p._row });
      toast('Producto eliminado');
      delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
    } catch(e) { toast('Error al eliminar', 'err'); }
  });
}

function abrirModalEditarCats() {
  const cats = [...new Set(_productos.map(p => p.categoria).filter(Boolean))].sort();
  const lista = $('editar-cats-lista');
  lista.innerHTML = cats.length
    ? cats.map(c => `
        <div class="editar-cat-row">
          <span>${c}</span>
          <button class="btn-danger btn-sm btn-del-cat" data-cat="${c}"><i class="fa-solid fa-trash"></i> Eliminar</button>
        </div>`).join('')
    : '<p class="text-muted">No hay categorías todavía.</p>';
  lista.querySelectorAll('.btn-del-cat').forEach(btn => {
    btn.addEventListener('click', () => eliminarCategoria(btn.dataset.cat));
  });
  $('nueva-cat-nombre').value = '';
  show('modal-editar-cats', 'flex');
}

async function guardarNuevaCat() {
  const nombre = $('nueva-cat-nombre').value.trim();
  if (!nombre) { toast('Escribí un nombre', 'err'); return; }
  try {
    const r = await crm({ action:'ext_categoria_agregar', nombre });
    if (!r.ok) { toast(r.error || 'Error', 'err'); return; }
    toast('Categoría creada ✓');
    hide('modal-editar-cats');
    delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
  } catch(e) { toast('Error al crear categoría', 'err'); }
}

function eliminarCategoria(cat) {
  confirmar(`¿Eliminar la categoría "${cat}" y TODOS sus productos? Esta acción no se puede deshacer.`, async () => {
    try {
      await crm({ action:'ext_categoria_eliminar', nombre: cat });
      toast('Categoría eliminada');
      _prodCatFil = 'Todos';
      hide('modal-editar-cats');
      delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
    } catch(e) { toast('Error al eliminar categoría', 'err'); }
  });
}

// ─── AUTO-REFRESH PEDIDOS ─────────────────────────────────────

function _silentRefreshPedidos() {
  if (!sessionStorage.getItem('ops_crm_token')) return;
  delete _cache['ext_pedidos_listar'];
  _pedidos = [];
  loadPedidos(true, true).then(() => {
    if (currentSec === 'panel') loadPanel();
  }).catch(() => {});
}

setInterval(() => { if (!document.hidden) _silentRefreshPedidos(); }, 30000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) _silentRefreshPedidos();
});

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('vsb_nav_from_crm') === '1') {
    const btn = $('btn-volver-crm');
    if (btn) btn.style.display = 'flex';
  }
  if (sessionStorage.getItem('ops_crm_token')) {
    hide('login-wrap');
    show('app', 'flex');
    goTo('panel');
  }
});
