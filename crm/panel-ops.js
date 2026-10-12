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

// Escapa texto que viene de clientes/pedidos antes de meterlo en innerHTML (evita XSS)
function hx(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function badgeEstado(estado) {
  const map = { Pendiente:'badge-pend', Confirmado:'badge-conf', 'En camino':'badge-camino', Entregado:'badge-entre', Cancelado:'badge-cancel' };
  const cls = map[estado] || 'badge-pend';
  return `<span class="badge ${cls}">${hx(estado || 'Pendiente')}</span>`;
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
        item.innerHTML = `<div class="panel-rec-left"><div class="panel-rec-name">${hx(nombre)}</div><div class="panel-rec-sub">${hx(p.productos||p.producto||p.detalle||'')}</div></div><span class="badge ${cls}">${hx(est)}</span>`;
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
        item.innerHTML = `<div class="panel-rec-left"><div class="panel-rec-name">${hx(c.nombre||'—')}</div><div class="panel-rec-sub">${hx(c.email||c.telefono||'')}</div></div><div style="font-size:0.78rem;color:var(--text2)">${hx(c.ciudad||'')}</div>`;
        item.addEventListener('click', () => { goTo('clientes'); verHistorialCliente(c); });
        cliWrap.appendChild(item);
      });
    } else {
      cliWrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-user"></i>Sin clientes</div>';
    }
  } catch(e) {
    cards.innerHTML = `<div class="stat-card" style="grid-column:1/-1"><p class="text-muted">Error al cargar: ${hx(e.message)}</p></div>`;
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
      <td class="td-nombre" style="cursor:pointer"><strong>${hx(nombreCompleto||'—')}</strong>${c.ciudad ? `<div class="prod-sub">${hx(c.ciudad)}</div>` : ''}</td>
      <td>${hx(c.email||'—')}</td>
      <td>${hx(c.telefono||'—')}</td>
      <td class="hide-mobile">${hx(c.ciudad||'—')}</td>
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
          <span class="hist-num">${hx(p.orderNumber||'Pedido')}</span>
          <span class="hist-fecha">${fecha}</span>
          <span class="badge ${estadoCls}">${hx(p.estado||'—')}</span>
        </div>
        <div class="hist-productos">${hx(p.productos||'—')}</div>
        <div class="hist-meta">
          <span><i class="fa-solid fa-${esEnvio?'truck':'store-alt'}" style="margin-right:4px;color:var(--text2)"></i>${esEnvio?'Envío a domicilio':'Retiro en local'}</span>
          <span><i class="fa-solid fa-credit-card" style="margin-right:4px;color:var(--text2)"></i>${hx(p.metodoPago||'—')}</span>
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

function setProdCat(cat) {
  _prodCatFil = cat;
  buildProdCats();
  filtrarProductos();
}

let _prodActual = null;

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
    tdCli.innerHTML = `<strong>${hx(nombre)}</strong>${telefono ? `<div style="font-size:0.78rem;color:var(--text2)">${hx(telefono)}</div>` : ''}`;

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
      ${p.dni         ? `<div><span class="ped-label">DNI/CUIT:</span> ${hx(p.dni)}</div>` : ''}
      ${dir           ? `<div><span class="ped-label">Dirección:</span> ${hx(dir)}</div>` : ''}
      ${p.productos   ? `<div style="flex-basis:100%"><span class="ped-label">Productos:</span> ${hx(p.productos)}</div>` : ''}
      ${p.observaciones ? `<div><span class="ped-label">Notas:</span> ${hx(p.observaciones)}</div>` : ''}
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
  sel.innerHTML = cats.map(c => `<option value="${hx(c)}">${hx(c)}</option>`).join('');
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
