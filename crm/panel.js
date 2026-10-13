// ============================================================
//  CRM Panel — Virtual Shop Baires
//  panel.js
// ============================================================

// ─── CONFIG ───────────────────────────────────────────────────
const CRM_URL = 'https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec';
// ─────────────────────────────────────────────────────────────

// ─── COMUNICACIÓN CON EL BACKEND ─────────────────────────────

function crm(params) {
  return new Promise((resolve, reject) => {
    // Inyectar token en todas las llamadas excepto las públicas
    const PUBLIC = { loginPanel:1, verifyPanel:1, version:1, loginDispositivo:1, olvidarDispositivo:1 };
    const token = !PUBLIC[params.action] ? sessionStorage.getItem('crm_token') : null;
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
        sessionStorage.removeItem('crm_token');
        lsBorrarTodo();
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
  const token = sessionStorage.getItem('crm_token');
  const allParams = token ? { token, ...params } : { ...params };
  await fetch(CRM_URL, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(allParams).toString()
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
const val = id => ($( id) ? $(id).value.trim() : '');
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
  const glass = window.loginGlass;
  if (glass) glass.cargando(true);
  const fallo = msg => {
    $('login-err').textContent = msg;
    if (glass) glass.error(); else shakeLoginBox();
  };
  try {
    const extra = window.confianza ? confianza.paramsLogin() : {};
    const data = await crm({ action: 'loginPanel', clave: pass, ...extra });
    if (data.ok && data.token) {
      if (window.confianza) confianza.ingresoOk(data);
      sessionStorage.setItem('crm_token', data.token);
      const entrar = () => {
        hide('login-wrap');
        show('app', 'flex');
        goTo('panel');
        prefetchAll();
      };
      if (glass) glass.exito(entrar); else entrar();
    } else {
      fallo(data.error || 'Contraseña incorrecta.');
    }
  } catch {
    fallo('Error de conexión. Intentá de nuevo.');
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
  // Carga todo en paralelo al entrar — navegación instantánea después
  getData('list', 'Clientes').catch(() => {});
  crm({ action: 'ext_pedidos_listar' }).then(raw => {
    _pedidos = Array.isArray(raw) ? [...raw].reverse() : [];
  }).catch(() => {});
  crm({ action: 'ext_productos_list' }).then(r => {
    _productos = r.rows || [];
    _cache['ext_productos_list'] = _productos;
    lsGuardar('productos', _productos);
  }).catch(() => {});
}

async function logout() {
  if (window.confianza) await confianza.olvidar();   // deja de ser de confianza
  lsBorrarTodo();
  sessionStorage.removeItem('crm_token');
  location.reload();
}

// ─── NAVEGACIÓN ───────────────────────────────────────────────

let currentSec = '';

function goTo(sec) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  const el = $('sec-' + sec);
  if (el) el.classList.add('active');

  document.querySelectorAll('.nav-link, .mnav-btn').forEach(a => a.classList.remove('active'));
  document.querySelectorAll(`[data-sec="${sec}"]`).forEach(a => a.classList.add('active'));

  if (currentSec !== sec) {
    currentSec = sec;
    loadSection(sec);
  }
}

function loadSection(sec) {
  const loaders = {
    panel:        loadPanel,
    facturacion:  loadFacturacion,
    clientes:     loadClientes,
    productos:    loadProductos,
    pedidos:      loadPedidos,
    comprobantes: loadComprobantes,
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
  const res = sinError(await crm(params));
  const data = res.rows || res.stats || res.fotos || [];
  _cache[key] = data;
  return data;
}
function invalidate(...keys) {
  keys.forEach(k => delete _cache[k]);
}

// ─── ESCRITURAS SEGURAS Y CACHÉ LOCAL ─────────────────────────
// crmOk: falla si el backend responde ok:false (antes se mostraba "guardado" aunque fallara).
async function crmOk(params) {
  const r = await crm(params);
  if (!r || r.ok === false) throw new Error((r && r.error) || 'No se pudo guardar');
  return r;
}
// unaVez: evita que un doble clic mande dos veces la misma acción.
const _ocupado = {};
async function unaVez(clave, fn) {
  if (_ocupado[clave]) return;
  _ocupado[clave] = true;
  try { return await fn(); } finally { _ocupado[clave] = false; }
}
// Caché en localStorage: cada sección pinta al instante y se actualiza en segundo plano.
const _LS = location.pathname.includes('panel-ops') ? 'vsbops_' : 'vsbcrm_';
const LS_TTL = 40000;
function lsGuardar(k, data) { try { localStorage.setItem(_LS + k, JSON.stringify({ t: Date.now(), d: data })); } catch {} }
function lsLeer(k) { try { const o = JSON.parse(localStorage.getItem(_LS + k) || 'null'); return o && Array.isArray(o.d) ? o : null; } catch { return null; } }
function lsBorrarTodo() { try { Object.keys(localStorage).filter(k => k.startsWith(_LS)).forEach(k => localStorage.removeItem(k)); } catch {} }
// Campos de cliente que el backend guarda hoy (pestaña Clientes)
const CLI_CAMPOS_GUARDADOS = ['nombre','apellido','telefono','email','dni','direccion','cp','ciudad','provincia','cuit','iva','razon','notas'];

// ─── PANEL (DASHBOARD) ───────────────────────────────────────

async function loadPanel() {
  const cards = $('panel-cards');
  cards.innerHTML = '<div class="stat-card skeleton"></div>'.repeat(4);
  $('panel-pedidos-rec').innerHTML = uiCargando(5);
  $('panel-clientes-rec').innerHTML = uiCargando(5);

  try {
    // Clientes: fuente principal
    const clientes = await getData('list', 'Clientes');

    // Pedidos: usar cache si ya cargó (prefetchAll), si no fetchear
    let pedidos = _pedidos.length ? _pedidos : [];
    if (!pedidos.length) {
      const raw = sinError(await crm({ action: 'ext_pedidos_listar' }));
      pedidos = Array.isArray(raw) ? [...raw].reverse() : [];
      _pedidos = pedidos;
    }

    const mes = new Date(); mes.setDate(1); mes.setHours(0,0,0,0);
    const pendientes = pedidos.filter(p => (p.estado||'Pendiente') === 'Pendiente').length;
    const delMes     = pedidos.filter(p => {
      const d = new Date(String(p.timestamp||p.fecha||'').replace(' ','T'));
      return !isNaN(d) && d >= mes;
    });
    const factMes = delMes.reduce((s,p) => s + (Number(String(p.total||p.monto||0).replace(/[^\d.]/g,'')) || 0), 0);

    cards.innerHTML = `
      <div class="stat-card stat-card-link" onclick="goTo('clientes')">
        <div class="stat-label"><i class="fa-solid fa-users" style="color:var(--red)"></i> Clientes</div>
        <div class="stat-val">${clientes.length}</div>
      </div>
      <div class="stat-card stat-card-link" onclick="goTo('pedidos')">
        <div class="stat-label"><i class="fa-solid fa-clock" style="color:#f59e0b"></i> Pendientes</div>
        <div class="stat-val text-yellow">${pendientes}</div>
        <div class="stat-sub">${pedidos.length} totales</div>
      </div>
      <div class="stat-card stat-card-link" onclick="goTo('pedidos')">
        <div class="stat-label"><i class="fa-solid fa-calendar-day" style="color:var(--green)"></i> Este mes</div>
        <div class="stat-val">${delMes.length}</div>
        <div class="stat-sub">pedidos</div>
      </div>
      <div class="stat-card stat-card-link" onclick="goTo('facturacion')">
        <div class="stat-label"><i class="fa-solid fa-dollar-sign" style="color:var(--green)"></i> Facturación</div>
        <div class="stat-val">${fmtMoney(factMes)}</div>
        <div class="stat-sub">este mes</div>
      </div>`;

    // Pedidos recientes (formato web: nombre+apellido, total, estado)
    const recPed = pedidos.slice(0, 5);
    $('panel-pedidos-rec').innerHTML = recPed.length ? recPed.map(p => {
      const nombre = [p.nombre, p.apellido].filter(Boolean).join(' ') || p.cliente || '—';
      const total  = p.total ? fmtMoney(p.total) : p.monto ? fmtMoney(p.monto) : '—';
      return `<div class="panel-rec-item">
        <div class="panel-rec-left">
          <div class="panel-rec-name">${hx(nombre)}</div>
          <div class="panel-rec-sub">${fmtFecha(p.timestamp||p.fecha||'')} · ${hx(p.metodoPago||p.metodo||'')}</div>
        </div>
        <div class="panel-rec-right">
          <div class="panel-rec-total">${total}</div>
          ${badgeEstado(p.estado||'Pendiente')}
        </div>
      </div>`;
    }).join('') : uiVacio('fa-inbox', 'Todavía no hay pedidos', 'Los pedidos de la tienda van a aparecer acá.', { texto: 'Ir a Pedidos', onclick: "goTo('pedidos')" });

    // Clientes recientes
    const recCli = [...clientes].reverse().slice(0, 5);
    const recCliWrap = $('panel-clientes-rec');
    recCliWrap.innerHTML = '';
    if (recCli.length) {
      recCli.forEach(c => {
        const item = document.createElement('div');
        item.className = 'panel-rec-item panel-rec-clickable';
        item.innerHTML = `<div class="panel-rec-left"><div class="panel-rec-name">${hx(c.nombre||'—')}</div><div class="panel-rec-sub">${hx(c.email||c.telefono||'')}</div></div><div class="panel-rec-right" style="font-size:0.78rem;color:var(--text2)">${hx(c.ciudad||'')}</div>`;
        item.addEventListener('click', () => { goTo('clientes'); verHistorialCliente(c); });
        recCliWrap.appendChild(item);
      });
    } else {
      recCliWrap.innerHTML = uiVacio('fa-user', 'Todavía no hay clientes', 'Cuando alguien compre o se registre va a aparecer acá.', { texto: 'Agregar cliente', icono: 'fa-plus', onclick: "goTo('clientes');abrirModalCliente()" });
    }

  } catch(e) {
    cards.innerHTML = `<div class="stat-card" style="grid-column:1/-1">${uiError(e.message, 'loadPanel()')}</div>`;
    $('panel-pedidos-rec').innerHTML = '';
    $('panel-clientes-rec').innerHTML = '';
  }
}

// ─── FACTURACIÓN ─────────────────────────────────────────────

let _factData = null, _factTab = 'anios';

function parseDetalle(det) {
  if (!det) return [];
  return String(det).split(',').map(s => {
    const m = s.trim().match(/^(\d+)x\s+(.+)$/);
    return m ? { nombre: m[2].trim(), cantidad: +m[1] } : null;
  }).filter(Boolean);
}

const lunesDe = d => { const x = new Date(d); x.setHours(0,0,0,0); const wd=(x.getDay()+6)%7; x.setDate(x.getDate()-wd); return x; };
const parseFecha = f => { const d = new Date(String(f).replace(' ','T')); return isNaN(d) ? null : d; };

const _num = v => {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
};
const ESTADOS_COBRADOS = ['Confirmado', 'En camino', 'Entregado'];

function agruparFacturacion(pedidos, productos) {
  const costos = {};
  productos.forEach(x => { const c = _num(x.costo); if (c > 0) costos[String(x.nombre).trim().toLowerCase()] = c; });
  const hayCostos = Object.keys(costos).length > 0;
  const ventas = pedidos.map(p => {
    const estado = p.estado || 'Pendiente';
    const items = parseDetalle(p.productos || p.detalle).map(it => ({ ...it, nombre: it.nombre.split(' · ')[0].trim() }));
    const monto = _num(p.total !== undefined && p.total !== '' ? p.total : p.monto);
    let costo = 0, costoCompleto = hayCostos && items.length > 0;
    items.forEach(it => { const c = costos[it.nombre.toLowerCase()]; if (c) costo += c * (it.cantidad || 1); else costoCompleto = false; });
    return { fecha: parseFecha(p.timestamp || p.fecha), monto, estado, beneficio: costoCompleto ? monto - costo : null, items };
  }).filter(v => v.fecha && v.estado !== 'Cancelado');

  const bucket = (map, key, d, v) => {
    const b = map[key] || (map[key] = { monto:0, ben:0, benParcial:false, n:0, pendN:0, pendMonto:0, d, prod:{} });
    if (!ESTADOS_COBRADOS.includes(v.estado)) { b.pendN++; b.pendMonto += v.monto; return; }
    b.monto += v.monto; b.n++;
    if (v.beneficio === null) b.benParcial = true; else b.ben += v.beneficio;
    v.items.forEach(it => { b.prod[it.nombre] = (b.prod[it.nombre]||0)+(it.cantidad||1); });
  };
  const por = { anios:{}, meses:{}, semanas:{} };
  ventas.forEach(v => {
    bucket(por.anios,   v.fecha.getFullYear(),                                   new Date(v.fecha.getFullYear(),0,1), v);
    bucket(por.meses,   v.fecha.getFullYear()+'-'+v.fecha.getMonth(),            new Date(v.fecha.getFullYear(), v.fecha.getMonth(), 1), v);
    const l = lunesDe(v.fecha);
    bucket(por.semanas, l.getTime(),                                             l, v);
  });
  const orden = o => Object.values(o).sort((a,b) => b.d - a.d);
  return { anios: orden(por.anios), meses: orden(por.meses), semanas: orden(por.semanas) };
}

function fmtPeriodo(tab, b) {
  if (tab === 'anios')   return String(b.d.getFullYear());
  if (tab === 'meses')   return b.d.toLocaleDateString('es-AR', { month:'long', year:'numeric' });
  const fin = new Date(b.d); fin.setDate(fin.getDate()+6);
  return b.d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'}) + ' – ' + fin.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
}

async function loadFacturacion(force=false) {
  const el = $('fact-table');
  el.innerHTML = uiCargando(6);
  try {
    const [pedidos, productoRes] = await Promise.all([
      crm({ action: 'ext_pedidos_listar', todos: 1 }).then(r => Array.isArray(sinError(r)) ? r : []),
      crm({ action: 'productos_list' })
    ]);
    const productos = productoRes.rows || [];
    _factData = agruparFacturacion(pedidos, productos);
    renderFact();
  } catch(e) {
    el.innerHTML = uiError(e.message, 'loadFacturacion(true)');
  }
}

function factTab(tab) {
  _factTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderFact();
}

function renderFact() {
  if (!_factData) return;
  const rows = _factData[_factTab];
  const el = $('fact-table');
  if (!rows.length) { el.innerHTML = uiVacio('fa-chart-line', 'Todavía no hay ventas', 'Cuando entren pedidos vas a ver acá lo facturado por año, mes y semana.', { texto: 'Ir a Pedidos', onclick: "goTo('pedidos')" }); return; }
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Período</th><th>N° ventas</th><th>Facturado</th><th>Beneficio</th><th>Pendientes de pago</th>
      </tr></thead>
      <tbody id="fact-tbody"></tbody>
    </table>`;
  const tbody = $('fact-tbody');
  rows.forEach((b,i) => {
    const rid = 'frow'+i;
    const tr = document.createElement('tr');
    tr.className = 'fact-row'; tr.dataset.rid = rid;
    tr.innerHTML = `
      <td><i class="fa-solid fa-chevron-right" id="ficon-${rid}" style="font-size:0.7rem;margin-right:8px;color:var(--text2);transition:transform 0.2s"></i>${fmtPeriodo(_factTab,b)}</td>
      <td>${b.n}</td>
      <td>${fmtMoney(b.monto)}</td>
      <td class="${b.ben>=0?'text-green':'text-red'}" title="${b.benParcial ? 'Faltan costos de algunos productos: el beneficio no es exacto' : ''}">${b.n ? (b.benParcial && !b.ben ? '—' : fmtMoney(b.ben) + (b.benParcial ? ' *' : '')) : '—'}</td>
      <td class="text-muted">${b.pendN ? b.pendN + ' · ' + fmtMoney(b.pendMonto) : '—'}</td>`;
    tr.onclick = () => toggleFactDetail(rid, b);
    tbody.appendChild(tr);
    const det = document.createElement('tr');
    det.id = rid; det.className = 'fact-detail-row'; det.style.display='none';
    det.innerHTML = `<td colspan="5"><div class="fact-detail-inner" id="${rid}-inner"></div></td>`;
    tbody.appendChild(det);
  });
}

function toggleFactDetail(rid, b) {
  const row = $(rid);
  const icon = $('ficon-'+rid);
  if (row.style.display === 'none') {
    row.style.display = '';
    if (icon) icon.style.transform = 'rotate(90deg)';
    const inner = $(rid+'-inner');
    const prods = Object.entries(b.prod).sort((a,z)=>z[1]-a[1]);
    inner.innerHTML = prods.length ? `
      <table style="font-size:0.82rem">
        <thead><tr><th>Producto</th><th>Cantidad vendida</th></tr></thead>
        <tbody>${prods.map(([n,c])=>`<tr><td>${hx(n)}</td><td>${hx(c)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="text-muted">Sin detalle de productos</p>';
  } else {
    row.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
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
  const local = !force && lsLeer('clientes');
  if (local) {
    _clientes = local.d; _cache['list:Clientes'] = _clientes; filtrarClientes();
    if (Date.now() - local.t < LS_TTL) return;
  } else {
    $('cli-table').innerHTML = uiCargando(6);
  }
  try {
    _clientes = await getData('list','Clientes',true);
    lsGuardar('clientes', _clientes);
    if (currentSec === 'clientes') filtrarClientes();
  } catch(e) {
    if (local) return;
    $('cli-table').innerHTML = uiError(e.message, 'loadClientes(true)');
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
  if (!list.length) { el.innerHTML = val('cli-search') ? uiVacio('fa-magnifying-glass', 'Sin resultados', 'No hay clientes que coincidan con la búsqueda.', { texto: 'Limpiar búsqueda', onclick: "$('cli-search').value='';filtrarClientes()" }) : uiVacio('fa-users', 'Todavía no hay clientes', 'Cuando alguien compre o se registre en la tienda va a aparecer acá.', { texto: 'Agregar cliente', icono: 'fa-plus', onclick: 'abrirModalCliente()' }); return; }
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
    body.innerHTML = uiVacio('fa-bag-shopping', 'Sin pedidos registrados', 'Este cliente todavía no hizo compras.');
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
  return unaVez('cliente', async () => {
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
      const r = await crmOk(params);
      if (id && r.updated === false) throw new Error('No se encontró el cliente (¿lo borraron?)');
      toast(id ? 'Cliente actualizado' : 'Cliente guardado');
      hide('modal-cliente');
      // Actualizar en memoria (sin volver a descargar toda la tabla)
      const nuevoId = id || r.id;
      const datos = {};
      CLI_CAMPOS_GUARDADOS.forEach(k => { if (params[k] !== undefined) datos[k] = params[k]; });
      const i = _clientes.findIndex(c => String(c.id) === String(nuevoId));
      if (i >= 0) _clientes[i] = { ..._clientes[i], ...datos };
      else _clientes.push({ ...datos, id: nuevoId, origen: 'crm' });
      _cache['list:Clientes'] = _clientes; lsGuardar('clientes', _clientes);
      filtrarClientes();
    } catch(e) { toast('Error: ' + e.message, 'err'); }
  });
}

function borrarCliente(id, nombre) {
  if (!String(id || '').trim()) { toast('Este cliente no tiene ID: borralo desde la planilla', 'err'); return; }
  confirmar(`¿Borrar al cliente "${nombre}"?`, () => unaVez('borrar-cli-' + id, async () => {
    try {
      const r = await crmOk({ action:'delete', tab:'Clientes', id });
      if (r.deleted === false) throw new Error('No se encontró el cliente (¿ya estaba borrado?)');
      _clientes = _clientes.filter(c => String(c.id) !== String(id));
      _cache['list:Clientes'] = _clientes; lsGuardar('clientes', _clientes);
      toast('Cliente borrado');
      filtrarClientes();
    } catch(e) { toast('Error: '+e.message,'err'); }
  }));
}

// ─── PRODUCTOS (Sheet externo por categorías) ────────────────

let _productos = [], _prodCatFil = 'Todos';

async function loadProductos(force=false) {
  if (!force && _productos.length) { buildProdCats(); filtrarProductos(); return; }
  const key = 'ext_productos_list';
  // Al instante desde la caché local; se actualiza en segundo plano si tiene más de 40 s
  const local = !force && lsLeer('productos');
  if (local) {
    _productos = local.d; _cache[key] = _productos; buildProdCats(); filtrarProductos();
    if (Date.now() - local.t < LS_TTL) return;
  } else {
    $('prod-table').innerHTML = uiCargando(6, true);
  }
  try {
    if (force) delete _cache[key];
    const r = (!force && _cache[key] && !local) ? { rows: _cache[key] } : await crm({ action:'ext_productos_list' });
    sinError(r);
    _productos = r.rows || [];
    _cache[key] = _productos;
    lsGuardar('productos', _productos);
    if (currentSec === 'productos') { buildProdCats(); filtrarProductos(true); }   // mantiene la página
  } catch(e) {
    if (local) return;
    $('prod-table').innerHTML = uiError(e.message, 'loadProductos(true)');
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
  const key = currentSec;
  if (key === 'pedidos')      { delete _cache['ext_pedidos_listar'];   _pedidos   = []; loadPedidos(true);   return; }
  if (key === 'clientes')     { delete _cache['list:Clientes'];  _clientes  = []; loadClientes(true);  return; }
  if (key === 'productos')    { delete _cache['ext_productos_list']; _productos = []; loadProductos(true); return; }
  if (key === 'facturacion')  { loadFacturacion(true); return; }
  if (key === 'comprobantes') { loadComprobantes(true); return; }
  if (key === 'panel')        { Object.keys(_cache).forEach(k => delete _cache[k]); _clientes = []; _pedidos = []; _productos = []; loadPanel(); return; }
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
  const local = !force && lsLeer('pedidos');
  if (local) {
    _pedidos = local.d; filtrarPedidos();
    if (Date.now() - local.t < LS_TTL) return;
  } else if (!silent) {
    $('ped-table').innerHTML = uiCargando(6);
  }
  try {
    const raw = sinError(await crm({ action: 'ext_pedidos_listar' }));
    _pedidos = Array.isArray(raw) ? [...raw].reverse() : [];
    lsGuardar('pedidos', _pedidos);
    filtrarPedidos();
  } catch(e) {
    if (local || silent) return;
    $('ped-table').innerHTML = uiError(e.message, 'loadPedidos(true)');
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
  if (!list.length) { el.innerHTML = uiVacio('fa-bag-shopping', 'No hay pedidos para mostrar', 'Probá con otro período o estado, o quitá la búsqueda.', { texto: 'Ver todos', onclick: "$('ped-search').value='';$('ped-estado-fil').value='';setPedPeriodo('todos')" }); return; }

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
        <select class="sel sel-sm" onchange="cambiarEstadoPedido(this,'${hx(p.fuente === 'mp' ? 'mp:' + p._mpId : 'row:' + (p._row || 0))}')">
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

async function cambiarEstadoPedido(sel, clave) {
  const estado = sel.value;
  const m = String(clave).match(/^(mp|row):(.*)$/);
  const tipo = m ? m[1] : 'row', ref = m ? m[2] : String(clave);
  const p = _pedidos.find(x => tipo === 'mp' ? String(x._mpId) === ref : String(x._row) === ref);
  const anterior = p ? (p.estado || 'Pendiente') : null;
  try {
    if (tipo === 'mp') {
      const r = await crmOk({ action: 'update', tab: 'Pedidos', id: ref, estado });
      if (r.updated === false) throw new Error('No se encontró el pedido');
    } else {
      await crmOk({ action: 'ext_pedido_update', row: ref, campo: 'estado', valor: estado, orderNumber: (p && p.orderNumber) || '' });
    }
    if (p) p.estado = estado;
    lsGuardar('pedidos', _pedidos);
    toast('Estado actualizado');
  } catch(e) {
    if (anterior) sel.value = anterior;
    toast('Error: ' + e.message, 'err');
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

  // Si hay datos de nuevo cliente, crearlo primero
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

// ─── SUSCRIPTORES ────────────────────────────────────────────

// ─── COMPROBANTES ────────────────────────────────────────────

async function loadComprobantes(force=false) {
  $('comp-table').innerHTML = uiCargando(5);
  try {
    const pedidos = await getData('list','Pedidos',force);
    const conComp = pedidos.filter(p => p.comprobante);
    if (!conComp.length) {
      $('comp-table').innerHTML = uiVacio('fa-file-image', 'Sin comprobantes subidos', 'Cuando un cliente suba el comprobante de su transferencia va a aparecer acá.', { texto: 'Ir a Pedidos', onclick: "goTo('pedidos')" });
      return;
    }
    $('comp-table').innerHTML = `
      <table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Monto</th><th>Estado</th><th>Comprobante</th></tr></thead>
        <tbody>
          ${[...conComp].reverse().map(p => `
            <tr>
              <td>${fmtFecha(p.fecha)}</td>
              <td><strong>${hx(p.cliente||'—')}</strong></td>
              <td>${fmtMoney(p.monto)}</td>
              <td>${badgeEstado(p.estado)}</td>
              <td>
                <a href="${/^https?:\/\//i.test(p.comprobante||'') ? hx(p.comprobante) : '#'}" target="_blank" rel="noopener" class="btn-secondary btn-sm" style="text-decoration:none">
                  <i class="fa-solid fa-eye"></i> Ver
                </a>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    $('comp-table').innerHTML = uiError(e.message, 'loadComprobantes(true)');
  }
}

// ─── AUTO-REFRESH PEDIDOS ─────────────────────────────────────

function _silentRefreshPedidos() {
  if (!sessionStorage.getItem('crm_token')) return;
  loadPedidos(true, true).then(() => {
    if (currentSec === 'panel') loadPanel();
  }).catch(() => {});
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
    await crmOk({ action:'ext_producto_agregar', sheet: categoria, nombre,
      precio: Number($('np-precio').value)||0,
      stock:  Number($('np-stock').value)||1,
      marca:  $('np-marca').value.trim() });
    toast('Producto agregado ✓');
    hide('modal-nuevo-prod');
    delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
  } catch(e) { toast('Error al agregar: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Agregar producto'; }
}

function eliminarProducto(p) {
  confirmar(`¿Eliminar "${p.nombre}"? Esta acción no se puede deshacer.`, async () => {
    try {
      await crmOk({ action:'ext_producto_eliminar', sheet: p._sheet, row: p._row, nombre: p.nombre });
      toast('Producto eliminado');
      delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
    } catch(e) { toast('Error al eliminar: ' + e.message, 'err'); }
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
      await crmOk({ action:'ext_categoria_eliminar', nombre: cat });
      toast('Categoría eliminada');
      _prodCatFil = 'Todos';
      hide('modal-editar-cats');
      delete _cache['ext_productos_list']; _productos = []; loadProductos(true);
    } catch(e) { toast('Error al eliminar categoría: ' + e.message, 'err'); }
  });
}

// Cada 30 segundos si la pestaña está visible
setInterval(() => { if (!document.hidden) _silentRefreshPedidos(); }, 30000);

// Al volver a la pestaña/app después de estar en otro lado
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) _silentRefreshPedidos();
});

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('crm_token')) {
    hide('login-wrap');
    show('app', 'flex');
    goTo('panel');
  } else if (window.confianza) {
    confianza.entrarDirecto(t => sessionStorage.setItem('crm_token', t), () => {
      hide('login-wrap');
      show('app', 'flex');
      goTo('panel');
      prefetchAll();
    });
  }
});
