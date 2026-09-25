// ============================================================
//  CRM Panel — Virtual Shop Baires
//  panel.js
// ============================================================

// ─── CONFIG — CAMBIÁ ESTOS DOS VALORES ───────────────────────
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
    const to = setTimeout(() => { ok(); reject(new Error('timeout')); }, 20000);
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

function badgeEstado(estado) {
  const map = { Pendiente:'badge-pend', Confirmado:'badge-conf', 'En camino':'badge-camino', Entregado:'badge-entre', Cancelado:'badge-cancel' };
  const cls = map[estado] || 'badge-pend';
  return `<span class="badge ${cls}">${estado || 'Pendiente'}</span>`;
}

// ─── AUTH ─────────────────────────────────────────────────────

function doLogin() {
  const pass = val('login-pass');
  if (pass === PANEL_PASS) {
    sessionStorage.setItem('crm_auth', '1');
    hide('login-wrap');
    show('app', 'flex');
    goTo('panel');
  } else {
    $('login-err').textContent = 'Contraseña incorrecta.';
  }
}

function logout() {
  sessionStorage.removeItem('crm_auth');
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
    panel:        loadPanel,
    facturacion:  loadFacturacion,
    clientes:     loadClientes,
    productos:    loadProductos,
    pedidos:      loadPedidos,
    suscriptores: loadSuscriptores,
    comprobantes: loadComprobantes,
    estadisticas: loadEstadisticas,
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

// ─── PANEL (DASHBOARD) ───────────────────────────────────────

async function loadPanel() {
  const cards = $('panel-cards');
  cards.innerHTML = '<div class="stat-card skeleton"></div>'.repeat(4);

  try {
    const [clientes, pedidos, stats] = await Promise.all([
      getData('list', 'Clientes'),
      getData('list', 'Pedidos'),
      crm({ action: 'eventos_stats' })
    ]);
    const mes = new Date(); mes.setDate(1); mes.setHours(0,0,0,0);
    const factMes = pedidos.filter(p => new Date(String(p.fecha).replace(' ','T')) >= mes)
                           .reduce((s,p) => s + (Number(String(p.monto).replace(/[^\d.]/g,'')) || 0), 0);
    const pendientes = pedidos.filter(p => p.estado === 'Pendiente' || !p.estado).length;

    cards.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Clientes</div>
        <div class="stat-val">${clientes.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pedidos pendientes</div>
        <div class="stat-val text-yellow">${pendientes}</div>
        <div class="stat-sub">${pedidos.length} totales</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Facturación del mes</div>
        <div class="stat-val">${fmtMoney(factMes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Visitas hoy</div>
        <div class="stat-val">${(stats.visitas && stats.visitas.hoy) || 0}</div>
        <div class="stat-sub">${(stats.visitas && stats.visitas.mes) || 0} este mes</div>
      </div>
    `;

    // Pedidos recientes
    const recPed = [...pedidos].reverse().slice(0, 5);
    $('panel-pedidos-rec').innerHTML = recPed.length ? `
      <table><tbody>
        ${recPed.map(p => `
          <tr>
            <td>${p.cliente || '—'}</td>
            <td>${fmtMoney(p.monto)}</td>
            <td>${badgeEstado(p.estado)}</td>
          </tr>`).join('')}
      </tbody></table>` : '<div class="empty-state"><i class="fa-solid fa-inbox"></i>Sin pedidos</div>';

    // Clientes recientes
    const recCli = [...clientes].reverse().slice(0, 5);
    $('panel-clientes-rec').innerHTML = recCli.length ? `
      <table><tbody>
        ${recCli.map(c => `
          <tr>
            <td>${c.nombre || '—'}</td>
            <td style="color:var(--text2);font-size:0.82rem">${c.email || c.telefono || ''}</td>
          </tr>`).join('')}
      </tbody></table>` : '<div class="empty-state"><i class="fa-solid fa-user"></i>Sin clientes</div>';

  } catch(e) {
    cards.innerHTML = `<div class="stat-card" style="grid-column:1/-1"><p class="text-muted">Error al cargar datos: ${e.message}</p></div>`;
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

function agruparFacturacion(pedidos, productos) {
  const costoDe = nombre => { const p = productos.find(x => x.nombre === nombre); return p ? (Number(String(p.costo).replace(/[^\d.]/g,''))||0) : 0; };
  const ventas = pedidos.map(p => {
    const items = parseDetalle(p.detalle);
    const monto = Number(String(p.monto).replace(/[^\d.]/g,''))||0;
    const costo = items.reduce((s,it) => s + costoDe(it.nombre)*(it.cantidad||1), 0);
    return { fecha: parseFecha(p.fecha), monto, beneficio: monto - costo, items };
  }).filter(v => v.fecha);

  const bucket = (map, key, d, v) => {
    const b = map[key] || (map[key] = { monto:0, ben:0, n:0, d, prod:{} });
    b.monto += v.monto; b.ben += v.beneficio; b.n++;
    v.items.forEach(it => { b.prod[it.nombre] = (b.prod[it.nombre]||0)+(it.cantidad||1); });
  };
  const por = { anios:{}, meses:{}, semanas:{} };
  ventas.forEach(v => {
    bucket(por.anios,   v.fecha.getFullYear(),                                   new Date(v.fecha.getFullYear(),0,1), v);
    bucket(por.meses,   v.fecha.getFullYear()+'-'+v.fecha.getMonth(),            v.fecha, v);
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
  el.innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    const [pedidos, productoRes] = await Promise.all([
      getData('list', 'Pedidos', force),
      crm({ action: 'productos_list' })
    ]);
    const productos = productoRes.rows || [];
    _factData = agruparFacturacion(pedidos, productos);
    renderFact();
  } catch(e) {
    el.innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
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
  if (!rows.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-chart-line"></i>Sin datos</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Período</th><th>N° ventas</th><th>Facturado</th><th>Beneficio</th>
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
      <td class="${b.ben>=0?'text-green':'text-red'}">${fmtMoney(b.ben)}</td>`;
    tr.onclick = () => toggleFactDetail(rid, b);
    tbody.appendChild(tr);
    const det = document.createElement('tr');
    det.id = rid; det.className = 'fact-detail-row'; det.style.display='none';
    det.innerHTML = `<td colspan="4"><div class="fact-detail-inner" id="${rid}-inner"></div></td>`;
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
        <tbody>${prods.map(([n,c])=>`<tr><td>${n}</td><td>${c}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="text-muted">Sin detalle de productos</p>';
  } else {
    row.style.display = 'none';
    if (icon) icon.style.transform = 'rotate(0deg)';
  }
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
  $('cli-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    [_clientes, _pedidos_para_clientes] = await Promise.all([
      getData('list','Clientes',force),
      getData('list','Pedidos',force)
    ]);
    filtrarClientes();
  } catch(e) {
    $('cli-table').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
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
    $('prod-table').innerHTML = `<p class="text-muted" style="padding:20px">Error al cargar: ${e.message}</p>`;
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

  // Detectar si hay columna talle o color en este set
  const hayColor = list.some(p => p.color || p.marca);
  const hayTalle = list.some(p => p.talle);

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Nombre</th>
          ${hayColor ? '<th>Color / Marca</th>' : ''}
          ${hayTalle ? '<th>Talle</th>' : ''}
          <th>Precio</th>
          <th>P. Original</th>
          <th>Stock</th>
          <th>⭐</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${list.map(p => {
          const colorMarca = (p.color || p.marca || '').trim();
          const safe = encodeURIComponent(JSON.stringify({
            _sheet: p._sheet, _row: p._row,
            nombre: p.nombre, categoria: p.categoria,
            color: p.color, marca: p.marca, talle: p.talle,
            precio: p.precio, descuento: p.descuento,
            stock: p.stock, destacado: p.destacado,
            descripcion: p.descripcion, subcategoria: p.subcategoria
          }));
          return `
          <tr>
            <td><strong>${p.nombre}</strong>${p.subcategoria ? `<div class="prod-sub">${p.subcategoria}</div>` : ''}</td>
            ${hayColor ? `<td>${colorMarca ? `<span class="badge-color">${colorMarca}</span>` : '—'}</td>` : ''}
            ${hayTalle ? `<td>${p.talle||'—'}</td>` : ''}
            <td><strong>${fmtPrecioSheet(p.precio)}</strong></td>
            <td class="text-muted">${fmtPrecioSheet(p.descuento)}</td>
            <td class="td-center">${p.stock
              ? '<span class="badge badge-conf">✓</span>'
              : '<span class="badge badge-cancel">✗</span>'}</td>
            <td class="td-center">${p.destacado ? '<span class="text-yellow" style="font-size:1.1rem">★</span>' : '<span class="text-muted">☆</span>'}</td>
            <td>
              <button class="btn-icon" onclick="editarProducto(decodeURIComponent('${safe}'))">
                <i class="fa-solid fa-pen"></i>
              </button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
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
    // Actualizar cache local
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
  $('ped-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    _pedidos = await getData('list','Pedidos',force);
    filtrarPedidos();
  } catch(e) {
    $('ped-table').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
  }
}

function filtrarPedidos() {
  const q   = val('ped-search').toLowerCase();
  const est = val('ped-estado-fil');
  let list = _pedidos;
  if (est) list = list.filter(p => p.estado === est);
  if (q)  list = list.filter(p =>
    String(p.cliente||'').toLowerCase().includes(q) ||
    String(p.detalle||'').toLowerCase().includes(q) ||
    String(p.telefono||'').includes(q));
  renderPedidos(list);
}

function renderPedidos(list) {
  const el = $('ped-table');
  if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bag-shopping"></i>Sin pedidos</div>'; return; }
  el.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Detalle</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${[...list].reverse().map(p => `
          <tr>
            <td style="white-space:nowrap">${fmtFecha(p.fecha)}</td>
            <td><strong>${p.cliente||'—'}</strong><div style="font-size:0.78rem;color:var(--text2)">${p.telefono||''}</div></td>
            <td style="max-width:200px;font-size:0.82rem">${p.detalle||'—'}</td>
            <td><strong>${fmtMoney(p.monto)}</strong></td>
            <td>${badgeEstado(p.estado)}</td>
            <td class="td-actions">
              <button class="btn-icon" onclick="editarPedido(${JSON.stringify(p).replace(/"/g,'&quot;')})"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-icon" onclick="borrarPedido('${p.id}')" style="color:var(--red)"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function abrirModalPedido() {
  $('mped-title').textContent = 'Nuevo pedido';
  ['mped-id','mped-cliente','mped-telefono','mped-detalle','mped-monto','mped-notas'].forEach(id => $(id).value = '');
  $('mped-estado').value = 'Pendiente';
  hide('nuevo-cli-wrap');
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

async function loadSuscriptores(force=false) {
  $('sus-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    const list = await getData('list','Suscriptores',force);
    if (!list.length) { $('sus-table').innerHTML = '<div class="empty-state"><i class="fa-solid fa-envelope"></i>Sin suscriptores</div>'; return; }
    $('sus-table').innerHTML = `
      <table>
        <thead><tr><th>Fecha</th><th>Email</th><th>Nombre</th><th>Origen</th></tr></thead>
        <tbody>
          ${[...list].reverse().map(s => `
            <tr>
              <td>${fmtFecha(s.fecha)}</td>
              <td>${s.email||'—'}</td>
              <td>${s.nombre||'—'}</td>
              <td>${s.origen||'web'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    $('sus-table').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
  }
}

// ─── COMPROBANTES ────────────────────────────────────────────

async function loadComprobantes(force=false) {
  $('comp-table').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando…</div>';
  try {
    const pedidos = await getData('list','Pedidos',force);
    const conComp = pedidos.filter(p => p.comprobante);
    if (!conComp.length) {
      $('comp-table').innerHTML = '<div class="empty-state"><i class="fa-solid fa-file-image"></i>Sin comprobantes subidos</div>';
      return;
    }
    $('comp-table').innerHTML = `
      <table>
        <thead><tr><th>Fecha</th><th>Cliente</th><th>Monto</th><th>Estado</th><th>Comprobante</th></tr></thead>
        <tbody>
          ${[...conComp].reverse().map(p => `
            <tr>
              <td>${fmtFecha(p.fecha)}</td>
              <td><strong>${p.cliente||'—'}</strong></td>
              <td>${fmtMoney(p.monto)}</td>
              <td>${badgeEstado(p.estado)}</td>
              <td>
                <a href="${p.comprobante}" target="_blank" class="btn-secondary btn-sm" style="text-decoration:none">
                  <i class="fa-solid fa-eye"></i> Ver
                </a>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    $('comp-table').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
  }
}

// ─── ESTADÍSTICAS ────────────────────────────────────────────

async function loadEstadisticas() {
  $('stats-content').innerHTML = '<div class="loading-row"><i class="fa-solid fa-spinner fa-spin"></i> Cargando estadísticas…</div>';
  try {
    const [statsRes, abandonos] = await Promise.all([
      crm({ action:'eventos_stats' }),
      crm({ action:'abandonos_list' })
    ]);
    const s = statsRes.stats || statsRes;
    const ab = abandonos.rows || [];
    renderStats(s, ab);
  } catch(e) {
    $('stats-content').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${e.message}</p>`;
  }
}

function barChart(datos) {
  if (!datos || !datos.length) return '<p class="text-muted">Sin datos</p>';
  const max = Math.max(...datos.map(d=>d.n), 1);
  return `<div class="bar-chart">
    ${datos.map(d => {
      const h = Math.round((d.n / max) * 68);
      const lbl = d.d ? d.d.slice(5) : (d.nombre||'');
      return `<div class="bar-item"><div class="bar-fill" style="height:${h}px"></div><div class="bar-label">${lbl}</div></div>`;
    }).join('')}
  </div>`;
}

function topList(items, labelKey='nombre', countKey='n') {
  if (!items || !items.length) return '<p class="text-muted">Sin datos</p>';
  return `<ul class="top-list">
    ${items.slice(0,10).map((it,i) => `
      <li>
        <span><span class="top-rank">${i+1}.</span> ${it[labelKey]||'—'}</span>
        <span class="top-n">${it[countKey]}</span>
      </li>`).join('')}
  </ul>`;
}

function renderStats(s, abandonos) {
  const v = s.visitas||{};
  const el = $('stats-content');
  el.innerHTML = `
    <!-- Visitas -->
    <div class="stats-row" style="margin-bottom:20px">
      <div class="stat-card"><div class="stat-label">Hoy</div><div class="stat-val">${v.hoy||0}</div></div>
      <div class="stat-card"><div class="stat-label">Esta semana</div><div class="stat-val">${v.semana||0}</div></div>
      <div class="stat-card"><div class="stat-label">Este mes</div><div class="stat-val">${v.mes||0}</div></div>
      <div class="stat-card"><div class="stat-label">Total</div><div class="stat-val">${v.total||0}</div></div>
    </div>

    <!-- Gráfico 14 días -->
    <div class="card" style="margin-bottom:14px">
      <h3 class="card-title"><i class="fa-solid fa-chart-bar"></i> Visitas últimos 14 días</h3>
      ${barChart(s.porDia||[])}
    </div>

    <!-- Embudo -->
    <div class="stats-3col">
      <div class="stat-card" style="text-align:center">
        <div class="stat-label">Carritos</div>
        <div class="stat-val text-yellow">${s.carrito||0}</div>
      </div>
      <div class="stat-card" style="text-align:center">
        <div class="stat-label">Abandonos</div>
        <div class="stat-val text-red">${s.abandonos||0}</div>
      </div>
      <div class="stat-card" style="text-align:center">
        <div class="stat-label">Compras</div>
        <div class="stat-val text-green">${s.compras||0}</div>
      </div>
    </div>

    <!-- Top productos y categorías -->
    <div class="stats-2col">
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-fire"></i> Productos más vistos</h3>
        ${topList(s.topProductos)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-tags"></i> Categorías más vistas</h3>
        ${topList(s.topCategorias)}
      </div>
    </div>

    <!-- Fuentes y ubicaciones -->
    <div class="stats-2col">
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-share-nodes"></i> Fuentes de tráfico</h3>
        ${topList(s.fuentes)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-location-dot"></i> Ciudades</h3>
        ${topList(s.ciudades)}
      </div>
    </div>

    <div class="stats-3col">
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-globe"></i> Países</h3>
        ${topList(s.paises)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-map"></i> Regiones</h3>
        ${topList(s.regiones)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-language"></i> Idiomas</h3>
        ${topList(s.idiomas)}
      </div>
    </div>

    <!-- Dispositivos -->
    <div class="stats-3col">
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-mobile"></i> Dispositivos</h3>
        ${topList(s.dispositivos)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-desktop"></i> Sistemas operativos</h3>
        ${topList(s.sistemas)}
      </div>
      <div class="card">
        <h3 class="card-title"><i class="fa-solid fa-browser"></i> Navegadores</h3>
        ${topList(s.navegadores)}
      </div>
    </div>

    <!-- Carritos abandonados -->
    ${abandonos.length ? `
    <div class="card">
      <h3 class="card-title"><i class="fa-solid fa-cart-xmark"></i> Carritos abandonados (últimos 100)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Ítem</th><th>Contacto</th><th>Monto aprox.</th></tr></thead>
          <tbody>
            ${abandonos.map(a=>`
              <tr>
                <td>${fmtFecha(a.fecha)}</td>
                <td>${a.item||'—'}</td>
                <td>${a.contacto||'—'}</td>
                <td>${a.monto ? fmtMoney(a.monto) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <p class="text-muted" style="font-size:0.78rem;text-align:center;margin-top:8px">
      ⓘ Edad y sexo no están disponibles en este sistema — requieren Google Analytics 4 + Google Signals.
    </p>
  `;
}

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('crm_auth') === '1') {
    hide('login-wrap');
    show('app', 'flex');
    goTo('panel');
  }
});
