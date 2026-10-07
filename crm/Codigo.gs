/* ============================================================
   CRM — Virtual Shop Baires
   Google Apps Script — pegar TODO en un archivo Codigo.gs

   Publicar como: Aplicación Web
     Ejecutar como: Yo
     Quién tiene acceso: Cualquiera
   ============================================================ */

// ─── CONFIGURACIÓN ───────────────────────────────────────────
// Ya está puesto el ID de tu planilla — no lo toques
var SHEET_ID = '1sufFbmZQzjG8i8FP-XybYReqeQgsHFjhSV2KEMaNTnA';

// Productos y Pedidos externos están en pestañas de la misma planilla CRM
var PRODUCTOS_SHEET_ID = SHEET_ID;
var PEDIDOS_SHEET_ID   = SHEET_ID;

// Tabs de categorías en el Sheet de Productos (en orden)
var CAT_TABS = ['Juguetes','Belleza','Piletas ','Inflables','Bazar, baño y cocina',
                'Muebles para el hogar','Camping','Playa','Mascotas',
                'Pilates y Yoga','Fitness y musculacion'];

// Para fotos de productos (GitHub repo de la tienda)
var GH_TOKEN  = PropertiesService.getScriptProperties().getProperty('GH_TOKEN') || '';
var GH_REPO   = 'nicoberra/VirtualShopBaires';
var GH_BRANCH = 'main';

// Para comprobantes de pago (carpeta de Google Drive)
// Creá una carpeta en Drive → copiá el ID de la URL
var COMPROB_FOLDER_ID = '';   // ← PEGAR ID DE CARPETA DRIVE AQUÍ (opcional)

// Mercado Pago Checkout Pro
// Obtené el Access Token en: mercadopago.com.ar/developers → Tu aplicación → Credenciales
var MP_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN') || '';

// Avisos por Telegram cuando entra un pedido (opcional)
var TG_TOKEN = '';
var TG_CHAT  = '';

// Datos bancarios para transferencia (se muestran en el checkout)
var BANK_ALIAS   = 'virtualshopbairescvu';
var BANK_CBU     = '0000003100000091453220';
var BANK_TITULAR = 'BR TRADE SRL';
var BANK_BANCO   = 'Mercado Pago CVU';
var BANK_CUIT    = '30-71077182-7';
// ─────────────────────────────────────────────────────────────

// Estructura de cada pestaña: k = clave API, h = título en la hoja
var TABS = {
  'Clientes': [
    { k:'id',       h:'ID'        },
    { k:'fecha',    h:'Fecha'     },
    { k:'nombre',   h:'Nombre'    },
    { k:'telefono', h:'Teléfono'  },
    { k:'email',    h:'Email'     },
    { k:'ciudad',   h:'Ciudad'    },
    { k:'notas',    h:'Notas'     },
    { k:'origen',   h:'Origen'    },
    { k:'clave',    h:'Clave'     }
  ],
  'Pedidos': [
    { k:'id',          h:'ID'           },
    { k:'fecha',       h:'Fecha'        },
    { k:'cliente',     h:'Cliente'      },
    { k:'telefono',    h:'Teléfono'     },
    { k:'detalle',     h:'Detalle'      },
    { k:'monto',       h:'Monto'        },
    { k:'estado',      h:'Estado'       },
    { k:'notas',       h:'Notas'        },
    { k:'comprobante', h:'Comprobante'  },
    { k:'clienteid',   h:'ClienteID'    }
  ],
  'Suscriptores': [
    { k:'id',     h:'ID'     },
    { k:'fecha',  h:'Fecha'  },
    { k:'email',  h:'Email'  },
    { k:'nombre', h:'Nombre' },
    { k:'origen', h:'Origen' }
  ]
};

var PRODUCTOS_COLS = ['Nombre','Categoría','Precio','Stock','Costo','Destacado'];

// ─── PUNTO DE ENTRADA ────────────────────────────────────────

function doGet(e)  { return manejar(e); }
function doPost(e) { return manejar(e); }

function manejar(e) {
  var p = (e && e.parameter) ? e.parameter : {};

  // Handle raw JSON POST body (checkout sends body: JSON.stringify(payload))
  if (!p.action && e && e.postData && e.postData.contents) {
    try {
      var bd = JSON.parse(e.postData.contents);
      if (bd && bd.action) p = bd;
    } catch(ex) {}
  }

  var out;
  try {
    var accion = p.action || 'list';
    var tab    = p.tab    || 'Clientes';
    if (['list','add','update','delete'].indexOf(accion) >= 0 && !TABS[tab])
      throw 'Pestaña inválida: ' + tab;

    // Acciones que requieren token de admin
    var ADMIN_ACTIONS = {
      'list':1,'add':1,'update':1,'delete':1,
      'productos_list':1,'productos_save':1,'productos_add':1,
      'fotos_list':1,'foto_subir':1,'foto_borrar':1,'fotos_orden':1,
      'ext_productos_list':1,'ext_producto_update':1,'ext_producto_agregar':1,
      'ext_producto_eliminar':1,'ext_categoria_agregar':1,'ext_categoria_eliminar':1,
      'ext_pedidos_list':1,'ext_pedidos_listar':1,'ext_pedido_update':1
    };
    if (ADMIN_ACTIONS[accion]) {
      var tok = String(p.token || '').trim();
      if (!tok || CacheService.getScriptCache().get('panel_' + tok) !== '1')
        return responder({ ok:false, error:'auth' }, p.callback);
    }

    if      (accion === 'list')            out = { ok:true, rows:  listar(tab) };
    else if (accion === 'add')             out = { ok:true, id:    agregar(tab, p) };
    else if (accion === 'update')          out = { ok:true, updated: actualizar(tab, p) };
    else if (accion === 'delete')          out = { ok:true, deleted: borrar(tab, p.id) };
    else if (accion === 'registrar')       out = registrar(p);
    else if (accion === 'login')           out = login(p);
    else if (accion === 'suscribir')       out = { ok:true, id: suscribir(p) };
    else if (accion === 'productos_list')  out = { ok:true, rows: productosListar() };
    else if (accion === 'productos_save')  out = { ok:true, saved: productosGuardar(p) };
    else if (accion === 'productos_add')   out = { ok:true, id: productosAgregar(p) };
    else if (accion === 'fotos_list')      out = { ok:true, fotos: fotosListar(p) };
    else if (accion === 'foto_subir')      out = { ok:true, foto:    fotoSubir(p) };
    else if (accion === 'foto_borrar')     out = { ok:true, borrada: fotoBorrar(p) };
    else if (accion === 'fotos_orden')     out = { ok:true, ordenado: fotosOrdenar(p) };
    else if (accion === 'comprobante_subir') out = { ok:true, url: comprobanteSubir(p) };
    else if (accion === 'mp_preferencia')       out = crearPreferencia(p);
    else if (accion === 'ext_productos_list')    out = { ok:true, rows: extProductosListar(p) };
    else if (accion === 'ext_producto_update')   out = extProductoActualizar(p);
    else if (accion === 'ext_producto_agregar')  out = extProductoAgregar(p);
    else if (accion === 'ext_producto_eliminar') out = extProductoEliminar(p);
    else if (accion === 'ext_categoria_agregar') out = extCategoriaAgregar(p);
    else if (accion === 'ext_categoria_eliminar') out = extCategoriaEliminar(p);
    else if (accion === 'ext_pedidos_list')     out = { ok:true, rows: extPedidosListar(p) };
    else if (accion === 'ext_pedidos_listar')   out = extPedidosListar(p);
    else if (accion === 'ext_pedido_update')    out = extPedidoActualizar(p);
    else if (accion === 'createOrder')          out = crearPedido(p);
    else if (accion === 'version')              out = { ok:true, version: 'v2' };
    else if (accion === 'loginPanel')           out = loginPanel(p);
    else if (accion === 'verifyPanel')          out = verifyPanel(p);
    else throw 'Acción desconocida: ' + accion;

  } catch(err) {
    out = { ok:false, error: String(err) };
  }
  return responder(out, p.callback);
}

function responder(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback)
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── TELEGRAM ────────────────────────────────────────────────

function avisarTelegram(texto) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'post', muteHttpExceptions: true,
      payload: { chat_id: TG_CHAT, text: texto, disable_web_page_preview: 'true' }
    });
  } catch(e) {}
}

// ─── HOJA HELPERS ────────────────────────────────────────────

// Abre la planilla única
function ss() {
  return SpreadsheetApp.openById(SHEET_ID);
}

// Devuelve una pestaña por nombre, la crea si no existe
function hoja(tab) {
  var spreadsheet = ss();
  var sh = spreadsheet.getSheetByName(tab);
  var titulos = TABS[tab].map(function(c) { return c.h; });

  if (!sh) {
    sh = spreadsheet.insertSheet(tab);
    sh.appendRow(titulos);
    sh.getRange(1,1,1,titulos.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < titulos.length) {
    sh.getRange(1,1,1,titulos.length).setValues([titulos]).setFontWeight('bold');
  }
  return sh;
}

// Devuelve la pestaña Productos (misma planilla)
function hojaProductos() {
  var spreadsheet = ss();
  var sh = spreadsheet.getSheetByName('Productos');
  if (!sh) {
    sh = spreadsheet.insertSheet('Productos');
    sh.appendRow(PRODUCTOS_COLS);
    sh.getRange(1,1,1,PRODUCTOS_COLS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ─── CRUD GENÉRICO ───────────────────────────────────────────

function listar(tab) {
  var sh = hoja(tab);
  var cols = TABS[tab];
  var datos = sh.getDataRange().getValues();
  var filas = [];

  for (var i = 1; i < datos.length; i++) {
    if (!datos[i][0] && !datos[i][2]) continue;
    var o = {};
    for (var c = 0; c < cols.length; c++) {
      if (cols[c].k === 'clave') continue;  // nunca exponer contraseña
      var v = datos[i][c];
      o[cols[c].k] = (v instanceof Date)
        ? Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd HH:mm')
        : v;
    }
    filas.push(o);
  }
  return filas;
}

// Limpia el teléfono: saca símbolos que Sheets tomaría como fórmula
function limpiarTel(raw) {
  return String(raw || '')
    .replace(/[^\d+()\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[+\-=@]+\s*/, '');
}

function agregar(tab, p) {
  var sh = hoja(tab);
  var cols = TABS[tab];
  if (p.telefono) p.telefono = limpiarTel(p.telefono);

  // Clientes: deduplicar por email → teléfono → nombre
  if (tab === 'Clientes') {
    var idx = {};
    for (var c = 0; c < cols.length; c++) idx[cols[c].k] = c;
    var datos = sh.getDataRange().getValues();
    var dig = function(x) { return String(x||'').replace(/\D/g,''); };
    var m = -1;

    for (var i = 1; i < datos.length && m < 0; i++) {
      if (p.email && String(datos[i][idx.email]).trim().toLowerCase() === String(p.email).trim().toLowerCase())
        m = i;
      else if (!p.email && p.telefono && dig(datos[i][idx.telefono]) && dig(datos[i][idx.telefono]) === dig(p.telefono))
        m = i;
      else if (!p.email && !p.telefono && p.nombre && String(datos[i][idx.nombre]).trim().toLowerCase() === String(p.nombre).trim().toLowerCase())
        m = i;
    }

    if (m >= 0) {
      // Ya existe: actualizar campos vacíos
      for (var c2 = 0; c2 < cols.length; c2++) {
        var k = cols[c2].k;
        if (k !== 'id' && k !== 'fecha' && p[k]) sh.getRange(m+1, c2+1).setValue(p[k]);
      }
      return String(datos[m][0]);
    }
  }

  var id = 'r' + Date.now() + Math.floor(Math.random()*1000);
  var fila = cols.map(function(c) {
    if (c.k === 'id')    return id;
    if (c.k === 'fecha') return p.fecha || new Date();
    return p[c.k] || '';
  });
  sh.appendRow(fila);

  if (tab === 'Pedidos')
    avisarTelegram('🧾 Nuevo pedido\n👤 ' + (p.cliente||'—') + '\n💰 $' + (p.monto||'0'));

  return id;
}

function actualizar(tab, p) {
  var sh = hoja(tab);
  var cols = TABS[tab];
  if (p.telefono) p.telefono = limpiarTel(p.telefono);
  var datos = sh.getDataRange().getValues();

  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]) === String(p.id)) {
      for (var c = 0; c < cols.length; c++)
        if (cols[c].k !== 'id' && p[cols[c].k] !== undefined)
          sh.getRange(i+1, c+1).setValue(p[cols[c].k]);
      return true;
    }
  }
  return false;
}

function borrar(tab, id) {
  var sh = hoja(tab);
  var datos = sh.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]) === String(id)) {
      sh.deleteRow(i+1);
      return true;
    }
  }
  return false;
}

// ─── CUENTAS DE CLIENTES (login desde la web) ────────────────

function idxClientes() {
  var cols = TABS['Clientes'], idx = {};
  for (var c = 0; c < cols.length; c++) idx[cols[c].k] = c;
  return idx;
}

function buscarPorEmail(datos, idx, email) {
  var e = String(email||'').trim().toLowerCase();
  if (!e) return -1;
  for (var i = 1; i < datos.length; i++)
    if (String(datos[i][idx.email]).trim().toLowerCase() === e) return i;
  return -1;
}

function clienteDeFila(datos, idx, i) {
  return {
    id:       datos[i][idx.id],
    nombre:   datos[i][idx.nombre],
    email:    datos[i][idx.email],
    telefono: datos[i][idx.telefono],
    ciudad:   datos[i][idx.ciudad]
  };
}

function registrar(p) {
  var sh = hoja('Clientes');
  var idx = idxClientes();
  var datos = sh.getDataRange().getValues();
  if (!p.email || !p.clave) return { ok:false, error:'Faltan datos.' };

  var m = buscarPorEmail(datos, idx, p.email);
  if (m >= 0) {
    if (datos[m][idx.clave]) return { ok:false, error:'Ya existe una cuenta con ese email. Iniciá sesión.' };
    sh.getRange(m+1, idx.clave+1).setValue(p.clave);
    ['nombre','telefono','ciudad'].forEach(function(k) {
      if (p[k]) sh.getRange(m+1, idx[k]+1).setValue(p[k]);
    });
    if (!datos[m][idx.origen]) sh.getRange(m+1, idx.origen+1).setValue('web');
    return { ok:true, cliente: clienteDeFila(sh.getDataRange().getValues(), idx, m) };
  }

  var id = 'r' + Date.now() + Math.floor(Math.random()*1000);
  var cols = TABS['Clientes'];
  sh.appendRow(cols.map(function(col) {
    if (col.k==='id')     return id;
    if (col.k==='fecha')  return new Date();
    if (col.k==='origen') return 'web';
    if (col.k==='notas')  return 'cuenta web';
    return p[col.k] || '';
  }));
  return { ok:true, cliente:{ id:id, nombre:p.nombre||'', email:p.email||'', telefono:p.telefono||'', ciudad:p.ciudad||'' } };
}

function login(p) {
  var sh = hoja('Clientes');
  var idx = idxClientes();
  var datos = sh.getDataRange().getValues();
  var m = buscarPorEmail(datos, idx, p.email);
  if (m < 0)                    return { ok:false, error:'No encontramos una cuenta con ese email.' };
  if (!datos[m][idx.clave])     return { ok:false, error:'Esa cuenta todavía no tiene contraseña.' };
  if (String(datos[m][idx.clave]) !== String(p.clave)) return { ok:false, error:'Contraseña incorrecta.' };
  return { ok:true, cliente: clienteDeFila(datos, idx, m) };
}

// ─── SUSCRIPTORES ────────────────────────────────────────────

function suscribir(p) {
  var sh = hoja('Suscriptores');
  var datos = sh.getDataRange().getValues();
  var e = String(p.email||'').trim().toLowerCase();
  if (!e) return '';
  for (var i = 1; i < datos.length; i++)
    if (String(datos[i][2]).trim().toLowerCase() === e) return String(datos[i][0]);
  var id = 's' + Date.now();
  sh.appendRow([id, new Date(), p.email, p.nombre||'', p.origen||'web']);
  return id;
}

// ─── PRODUCTOS (pestaña en la misma planilla) ────────────────

function esVerdadero(v) {
  return v === true ||
    String(v).trim().toUpperCase() === 'TRUE' ||
    String(v).trim().toLowerCase() === 'si';
}

function productosListar() {
  var sh = hojaProductos();
  var datos = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < datos.length; i++) {
    var nombre = String(datos[i][0]).trim();
    if (!nombre) continue;
    out.push({
      nombre:    nombre,
      categoria: String(datos[i][1]||'').trim(),
      precio:    datos[i][2],
      stock:     esVerdadero(datos[i][3]),
      costo:     datos[i][4],
      destacado: esVerdadero(datos[i][5])
    });
  }
  return out;
}

function productosGuardar(p) {
  var sh = hojaProductos();
  var datos = sh.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).trim() === String(p.nombre).trim()) {
      if (p.categoria !== undefined) sh.getRange(i+1,2).setValue(p.categoria);
      if (p.precio    !== undefined) sh.getRange(i+1,3).setValue(Number(String(p.precio).replace(/[^\d.]/g,''))||0);
      if (p.stock     !== undefined) sh.getRange(i+1,4).setValue(esVerdadero(p.stock));
      if (p.costo     !== undefined) sh.getRange(i+1,5).setValue(Number(String(p.costo).replace(/[^\d.]/g,''))||0);
      if (p.destacado !== undefined) sh.getRange(i+1,6).setValue(esVerdadero(p.destacado));
      return true;
    }
  }
  return false;
}

// Agregar un producto nuevo desde el panel
function productosAgregar(p) {
  var sh = hojaProductos();
  if (!p.nombre) return false;
  sh.appendRow([
    String(p.nombre).trim(),
    String(p.categoria||'').trim(),
    Number(String(p.precio||0).replace(/[^\d.]/g,''))||0,
    esVerdadero(p.stock !== undefined ? p.stock : true),
    Number(String(p.costo||0).replace(/[^\d.]/g,''))||0,
    esVerdadero(p.destacado||false)
  ]);
  return true;
}

// ─── FOTOS DE PRODUCTOS (GitHub repo) ────────────────────────

function ghApi(method, path, payload) {
  if (!GH_TOKEN) return { code:503, json:{ message:'GH_TOKEN no configurado' } };
  var opt = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization:        'Bearer ' + GH_TOKEN,
      Accept:               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':         'CRM-VSB'
    }
  };
  if (payload) { opt.contentType='application/json'; opt.payload=JSON.stringify(payload); }
  var res  = UrlFetchApp.fetch('https://api.github.com/repos/'+GH_REPO+'/'+path, opt);
  var txt  = res.getContentText();
  var json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch(e) {}
  return { code: res.getResponseCode(), json: json };
}

function encPath(p) {
  return p.split('/').map(function(s){ return encodeURIComponent(s); }).join('/');
}

function ghDir(prefix) {
  var r = ghApi('get','contents/'+encPath(prefix));
  return (r.code===200 && Array.isArray(r.json)) ? r.json : [];
}

function ordenFotos(a,b) {
  var na=parseInt((String(a).match(/^(\d+)/)||[0,0])[1],10);
  var nb=parseInt((String(b).match(/^(\d+)/)||[0,0])[1],10);
  return (na-nb) || String(a).localeCompare(String(b));
}

function ordenarSegun(actuales, guardado) {
  var res = [];
  if (guardado && guardado.length)
    guardado.forEach(function(n){ if(actuales.indexOf(n)>=0 && res.indexOf(n)<0) res.push(n); });
  return res.concat(actuales.filter(function(n){ return res.indexOf(n)<0; }).sort(ordenFotos));
}

function fotosListar(p) {
  var pre = String(p.carpeta||'').trim();
  if (!pre || !GH_TOKEN) return [];
  var files = ghDir(pre).filter(function(x){
    return x.type==='file' && /\.(webp|jpe?g|png|gif|avif)$/i.test(x.name);
  });
  var actuales = files.map(function(x){ return x.name; });
  var man = manifestCargar();
  var names = ordenarSegun(actuales, man.manifest[pre]||null);
  manifestGuardarKey(man, pre, names);
  return names;
}

function fotosOrdenar(p) {
  if (!GH_TOKEN) return false;
  var pre   = String(p.carpeta||'').trim();
  var orden = String(p.orden||'').split(',').map(function(s){ return s.trim(); }).filter(String);
  if (!pre || !orden.length) return false;
  var man = manifestCargar();
  man.manifest[pre] = orden;
  var payload = { message:'Orden fotos: '+pre, content:Utilities.base64Encode(JSON.stringify(man.manifest)), branch:GH_BRANCH };
  if (man.sha) payload.sha = man.sha;
  var r = ghApi('put','contents/fotos.json',payload);
  return (r.code>=200 && r.code<300);
}

function fotoSubir(p) {
  if (!GH_TOKEN) return false;
  var pre = String(p.carpeta||'').trim();
  if (!pre || !p.data) return false;
  var files = ghDir(pre).filter(function(x){ return x.type==='file'; });
  var maxN = 0;
  files.forEach(function(x){ var m=x.name.match(/^(\d+)\./); if(m) maxN=Math.max(maxN,parseInt(m[1],10)); });
  var filename = (maxN+1)+'.jpg';
  var r = ghApi('put','contents/'+encPath(pre+'/'+filename),{
    message: 'Foto nueva '+filename,
    content: String(p.data).replace(/^data:[^,]*,/,''),
    branch:  GH_BRANCH
  });
  if (r.code>=200 && r.code<300) { fotosListar({carpeta:pre}); return filename; }
  return false;
}

function fotoBorrar(p) {
  if (!GH_TOKEN) return false;
  var pre = String(p.carpeta||'').trim();
  var fn  = String(p.filename||'').trim();
  if (!pre || !fn) return false;
  var path = 'contents/'+encPath(pre+'/'+fn);
  var g = ghApi('get',path);
  if (g.code!==200 || !g.json || !g.json.sha) return false;
  var r = ghApi('delete',path,{ message:'Borrar foto '+fn, sha:g.json.sha, branch:GH_BRANCH });
  if (r.code>=200 && r.code<300) { fotosListar({carpeta:pre}); return true; }
  return false;
}

function manifestCargar() {
  var g = manifestCargar_raw();
  return g;
}
function manifestCargar_raw() {
  var g = ghApi('get','contents/fotos.json');
  var manifest={}, sha=null;
  if (g.code===200 && g.json && g.json.content) {
    sha = g.json.sha;
    try {
      manifest = JSON.parse(Utilities.newBlob(Utilities.base64Decode(g.json.content)).getDataAsString());
    } catch(e) {}
  }
  return { manifest:manifest, sha:sha };
}

function manifestGuardarKey(man, key, names) {
  if (!GH_TOKEN) return;
  var antes = JSON.stringify(man.manifest[key]||null);
  if (names && names.length) man.manifest[key] = names; else delete man.manifest[key];
  if (antes === JSON.stringify(man.manifest[key]||null)) return;
  var payload = { message:'Fotos: '+key, content:Utilities.base64Encode(JSON.stringify(man.manifest)), branch:GH_BRANCH };
  if (man.sha) payload.sha = man.sha;
  ghApi('put','contents/fotos.json',payload);
}

// ─── MERCADO PAGO ────────────────────────────────────────────

function crearPreferencia(p) {
  if (!MP_ACCESS_TOKEN) return { ok:false, error:'MP_ACCESS_TOKEN no configurado en Codigo.gs' };

  var items = [];
  try { items = JSON.parse(p.items || '[]'); } catch(e) { return { ok:false, error:'items inválidos' }; }
  if (!items.length) return { ok:false, error:'Carrito vacío' };

  var itemsMP = items.map(function(i) {
    return {
      title:       String(i.nombre || i.title || 'Producto').slice(0, 256),
      quantity:    Math.max(1, parseInt(i.cantidad || i.quantity || 1, 10)),
      unit_price:  parseFloat((String(i.precio || i.unit_price || 0)).replace(',','.')),
      currency_id: 'ARS'
    };
  });

  var ref = String(p.ref || ('vsb-' + Date.now()));

  var payload = {
    items: itemsMP,
    back_urls: {
      success: 'https://virtualshopbaires.com.ar/gracias.html?ref=' + ref,
      failure: 'https://virtualshopbaires.com.ar/checkout.html?mp=error',
      pending: 'https://virtualshopbaires.com.ar/gracias.html?ref=' + ref + '&estado=pendiente'
    },
    auto_return: 'approved',
    statement_descriptor: 'Virtual Shop Baires',
    external_reference: ref
  };
  if (p.email) payload.payer = { email: String(p.email) };

  var res = UrlFetchApp.fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + MP_ACCESS_TOKEN },
    payload: JSON.stringify(payload)
  });

  var json = null;
  try { json = JSON.parse(res.getContentText()); } catch(e) {}
  if (res.getResponseCode() !== 201 || !json || !json.init_point)
    return { ok:false, error: (json && json.message) || 'Error MP (' + res.getResponseCode() + ')' };

  // Guardar pedido como Pendiente en Sheets
  var total   = itemsMP.reduce(function(s,i){ return s + i.unit_price * i.quantity; }, 0);
  var detalle = itemsMP.map(function(i){ return i.quantity + 'x ' + i.title; }).join(', ');
  agregar('Pedidos', {
    cliente:  String(p.nombre  || ''),
    telefono: String(p.telefono || ''),
    detalle:  detalle,
    monto:    total,
    estado:   'Pendiente',
    notas:    'MercadoPago · ref: ' + ref
  });

  avisarTelegram('💳 Nuevo pedido MP\n👤 ' + (p.nombre||'—') + '\n💰 $' + total + '\nRef: ' + ref);
  return { ok:true, url: json.init_point, ref: ref };
}

// ─── COMPROBANTES DE PAGO (Google Drive) ─────────────────────

// ─── PRODUCTOS EXTERNOS (Sheet separado por categorías) ──────

function _headerIdx(headers) {
  var idx = {};
  headers.forEach(function(h, i) { idx[String(h||'').trim().toLowerCase()] = i; });
  return idx;
}

var SYSTEM_TABS = ['Clientes','Pedidos','Suscriptores','Productos','Pedidos externos','Pedidos Externos'];

function extProductosListar(p) {
  var filtCat = String(p.categoria||'').trim();
  var ssP = ss();
  var result = [];

  // Descubrir tabs de categorías dinámicamente (excluye tabs del sistema)
  var tabNames = ssP.getSheets()
    .map(function(sh) { return sh.getName(); })
    .filter(function(n) { return SYSTEM_TABS.indexOf(n) < 0; });

  tabNames.forEach(function(tabName) {
    var catKey = tabName.trim();
    if (filtCat && filtCat !== catKey) return;
    var sh = ssP.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) return;
    var data = sh.getDataRange().getValues();
    var idx  = _headerIdx(data[0]);

    for (var r = 1; r < data.length; r++) {
      var nombre = String(data[r][0]||'').trim();
      if (!nombre) continue;

      var precio    = data[r][1];
      var stockRaw  = data[r][2];
      var colD      = String(data[r][3]||'').trim();
      var colE      = String(data[r][4]||'').trim();

      // Detectar si col D es Color o Marca
      var hD = String(data[0][3]||'').trim().toLowerCase();
      var color = (hD === 'color') ? colD : '';
      var marca = (hD === 'marca') ? colD : '';

      // Talle (col E si hay talle/medida, sino es descripcion)
      var hE = String(data[0][4]||'').trim().toLowerCase();
      var talle       = (hE.indexOf('talle') >= 0) ? colE : '';
      var colDescIdx  = (hE.indexOf('talle') >= 0) ? 5 : 4;
      var descripcion = String(data[r][colDescIdx]||'').trim();

      // Destacado y descuento: buscar por header
      var destacado = false, descuento = '';
      if (idx['destacado'] !== undefined) destacado = esVerdadero(data[r][idx['destacado']]);
      if (idx['descuento'] !== undefined) descuento = data[r][idx['descuento']];

      // Subcategorías
      var subcategoria = '';
      if (idx['subcategorias'] !== undefined) subcategoria = String(data[r][idx['subcategorias']]||'').trim();

      result.push({
        _sheet:      tabName,
        _row:        r + 1,
        categoria:   catKey,
        nombre:      nombre,
        precio:      precio,
        stock:       esVerdadero(stockRaw),
        color:       color,
        marca:       marca,
        talle:       talle,
        descripcion: descripcion.slice(0, 200),
        destacado:   destacado,
        descuento:   descuento,
        subcategoria:subcategoria
      });
    }
  });
  return result;
}

function extProductoActualizar(p) {
  var sheetName = String(p.sheet||'').trim();
  var row       = parseInt(p.row, 10);
  var campo     = String(p.campo||'').trim().toLowerCase();
  var valor     = p.valor;

  if (!sheetName || !row || !campo)
    return { ok:false, error:'Faltan parámetros (sheet, row, campo)' };

  var sh  = ss().getSheetByName(sheetName);
  if (!sh) return { ok:false, error:'Hoja no encontrada: ' + sheetName };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var colIdx  = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]||'').trim().toLowerCase() === campo) { colIdx = i + 1; break; }
  }
  if (colIdx < 0) return { ok:false, error:'Campo no encontrado: ' + campo };

  if (campo === 'precio' || campo === 'descuento') {
    valor = Number(String(valor).replace(/[^\d.,]/g,'').replace(',','.')) || 0;
  } else if (campo === 'stock' || campo === 'destacado') {
    valor = (valor === true || valor === 'true');
  }

  sh.getRange(row, colIdx).setValue(valor);
  return { ok:true };
}

function extProductoAgregar(p) {
  var sheetName = String(p.sheet||p.categoria||'').trim();
  if (!sheetName || !p.nombre) return { ok:false, error:'Faltan nombre o categoría' };
  var sh = ss().getSheetByName(sheetName);
  if (!sh) return { ok:false, error:'Categoría no encontrada: ' + sheetName };
  var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(),1)).getValues()[0];
  var row = headers.map(function(h) {
    var hk = String(h||'').trim().toLowerCase();
    if (hk === 'nombre')                       return String(p.nombre||'').trim();
    if (hk === 'precio')                       return Number(String(p.precio||0).replace(/[^\d.]/g,''))||0;
    if (hk === 'stock')                        return Number(String(p.stock||1).replace(/[^\d.]/g,''))||0;
    if (hk === 'color')                        return String(p.color||'').trim();
    if (hk === 'marca')                        return String(p.marca||p.color||'').trim();
    if (hk.indexOf('talle') >= 0 || hk.indexOf('medida') >= 0) return String(p.talle||'').trim();
    if (hk.indexOf('descripci') >= 0)          return String(p.descripcion||'').trim();
    if (hk === 'destacado')                    return false;
    if (hk === 'descuento')                    return 0;
    if (hk.indexOf('subcategor') >= 0)         return String(p.subcategoria||'').trim();
    return '';
  });
  sh.appendRow(row);
  return { ok:true, row: sh.getLastRow() };
}

function extProductoEliminar(p) {
  var sheetName = String(p.sheet||'').trim();
  var row = parseInt(p.row, 10);
  if (!sheetName || !row) return { ok:false, error:'Faltan parámetros' };
  var sh = ss().getSheetByName(sheetName);
  if (!sh) return { ok:false, error:'Hoja no encontrada: ' + sheetName };
  if (row < 2 || row > sh.getLastRow()) return { ok:false, error:'Fila fuera de rango' };
  sh.deleteRow(row);
  return { ok:true };
}

function extCategoriaAgregar(p) {
  var nombre = String(p.nombre||'').trim();
  if (!nombre) return { ok:false, error:'Falta el nombre' };
  var ssP = ss();
  if (ssP.getSheetByName(nombre)) return { ok:false, error:'Ya existe esa categoría' };
  var sh = ssP.insertSheet(nombre);
  sh.appendRow(['Nombre','Precio','Stock','Marca','Descripcion','Destacado']);
  sh.getRange(1,1,1,6).setFontWeight('bold');
  sh.setFrozenRows(1);
  return { ok:true };
}

function extCategoriaEliminar(p) {
  var nombre = String(p.nombre||'').trim();
  if (!nombre) return { ok:false, error:'Falta el nombre' };
  var ssP = ss();
  var sh = ssP.getSheetByName(nombre);
  if (!sh) return { ok:false, error:'Hoja no encontrada' };
  ssP.deleteSheet(sh);
  return { ok:true };
}

function extPedidosListar(p) {
  try {
    var ssO  = ss();
    var sh   = ssO.getSheetByName('Pedidos externos') || ssO.getSheetByName('Pedidos Externos');
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];

    var headers = data[0].map(function(h) { return String(h||'').trim(); });
    var result  = [];
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;
      var obj = { _row: r + 1 };
      headers.forEach(function(h, i) {
        var v = data[r][i];
        obj[h] = (v instanceof Date)
          ? Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd HH:mm') : v;
      });
      result.push(obj);
    }
    return result.slice(0, 300);
  } catch(ex) {
    return [];
  }
}

function crearPedido(p) {
  try {
    var COLS = ['timestamp','orderNumber','nombre','apellido','email','telefono','dni',
                'metodoEntrega','metodoPago','provincia','localidad','calle','numeroCalle',
                'piso','cp','productos','subtotal','descuento','total','observaciones','estado'];

    var ssO = ss();
    var sh  = ssO.getSheetByName('Pedidos externos') || ssO.getSheetByName('Pedidos Externos');
    if (!sh) {
      sh = ssO.insertSheet('Pedidos externos');
      sh.appendRow(COLS);
      sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    var orderNum = 'VSB-' + new Date().getTime();
    var now = Utilities.formatDate(new Date(), 'GMT-3', 'yyyy-MM-dd HH:mm');

    var productosStr = '';
    try {
      var prods = (typeof p.productos === 'string') ? JSON.parse(p.productos) : p.productos;
      if (Array.isArray(prods)) {
        productosStr = prods.map(function(i) {
          return i.qty + 'x ' + i.nombre +
            (i.color ? ' · ' + i.color : '') +
            (i.talle ? ' / ' + i.talle : '');
        }).join(', ');
      }
    } catch(ex) {}

    var row = COLS.map(function(col) {
      if (col === 'timestamp')   return now;
      if (col === 'orderNumber') return orderNum;
      if (col === 'estado')      return 'Pendiente';
      if (col === 'productos')   return productosStr;
      return (p[col] !== undefined && p[col] !== null) ? p[col] : '';
    });

    sh.appendRow(row);

    avisarTelegram('🛒 Nuevo pedido: ' + orderNum +
      '\n' + (p.nombre||'') + ' ' + (p.apellido||'') +
      '\n' + (p.email||'') + ' · ' + (p.telefono||'') +
      '\nTotal: $' + (p.total||0) + ' · ' + (p.metodoPago||'') + ' · ' + (p.metodoEntrega||''));

    return {
      ok:          true,
      orderNumber: orderNum,
      total:       p.total || 0,
      bankData: {
        alias:   BANK_ALIAS,
        cbu:     BANK_CBU,
        titular: BANK_TITULAR,
        banco:   BANK_BANCO,
        cuit:    BANK_CUIT
      }
    };
  } catch(err) {
    return { ok:false, error: String(err) };
  }
}

function extPedidoActualizar(p) {
  var row   = parseInt(p.row, 10);
  var campo = String(p.campo||'').trim().toLowerCase();
  var valor = p.valor;

  if (!row || !campo) return { ok:false, error:'Faltan parámetros (row, campo)' };

  var sh = ss().getSheetByName('Pedidos externos') || ss().getSheetByName('Pedidos Externos');
  if (!sh) return { ok:false, error:'Hoja no encontrada' };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var colIdx  = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]||'').trim().toLowerCase() === campo) { colIdx = i + 1; break; }
  }
  if (colIdx < 0) return { ok:false, error:'Campo no encontrado: ' + campo };

  sh.getRange(row, colIdx).setValue(valor);
  return { ok:true };
}

// ─── COMPROBANTES DE PAGO (Google Drive) ─────────────────────

function comprobanteSubir(p) {
  if (!p.data) return '';

  // Si no hay carpeta Drive configurada, guardar URL inline en el pedido
  if (!COMPROB_FOLDER_ID) {
    if (p.pedidoId) actualizar('Pedidos', { id:p.pedidoId, comprobante:'[imagen subida sin Drive]' });
    return '';
  }

  var data = String(p.data);
  var mime = (data.match(/^data:([^;]+)/)||[])[1] || 'image/jpeg';
  var ext  = mime.indexOf('png')>=0 ? 'png' : (mime.indexOf('pdf')>=0 ? 'pdf' : 'jpg');
  var blob = Utilities.newBlob(
    Utilities.base64Decode(data.replace(/^data:[^,]*,/,'')),
    mime,
    'comprobante_' + Utilities.formatDate(new Date(),'GMT-3','yyyyMMdd_HHmmss') + '.' + ext
  );
  var file = DriveApp.getFolderById(COMPROB_FOLDER_ID).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  if (p.pedidoId) actualizar('Pedidos', { id:p.pedidoId, comprobante:url });
  avisarTelegram('📎 Comprobante subido' + (p.pedidoId ? ' (pedido '+p.pedidoId+')' : ''));
  return url;
}

// ─── MIGRACIÓN: correr UNA SOLA VEZ desde Apps Script ────────
// Copia las pestañas de productos y pedidos externos a esta planilla.
// Pasos: Abrir Apps Script → seleccionar "migrarPlanillas" → ▶ Ejecutar

function migrarPlanillas() {
  var ID_PRODUCTOS = '1joofIvXtRnU0LcCs320MVIhy44HpaJZ1DqwQ7d2pBTw';
  var ID_PEDIDOS   = '1TrrCEZvlQUcNTvPkBv9Ot57I5vebbySwWG2kagq42E0';
  var dest = ss();
  var log  = [];

  // 1. Copiar pestañas de productos por categoría
  try {
    var ssP = SpreadsheetApp.openById(ID_PRODUCTOS);
    CAT_TABS.forEach(function(tabName) {
      var origen = ssP.getSheetByName(tabName);
      if (!origen) { log.push('SKIP productos: ' + tabName + ' (no existe)'); return; }

      var existente = dest.getSheetByName(tabName);
      if (existente) dest.deleteSheet(existente);

      origen.copyTo(dest).setName(tabName);
      log.push('OK productos: ' + tabName);
    });
  } catch(e) {
    log.push('ERROR productos: ' + e);
  }

  // 2. Copiar pedidos externos → pestaña "Pedidos externos"
  try {
    var ssO      = SpreadsheetApp.openById(ID_PEDIDOS);
    var shOrigen = ssO.getSheetByName('Pedidos') || ssO.getSheetByName('pedidos') || ssO.getSheets()[0];
    if (shOrigen) {
      var existePed = dest.getSheetByName('Pedidos externos');
      if (existePed) dest.deleteSheet(existePed);
      shOrigen.copyTo(dest).setName('Pedidos externos');
      log.push('OK pedidos externos');
    } else {
      log.push('SKIP pedidos: hoja no encontrada');
    }
  } catch(e) {
    log.push('ERROR pedidos: ' + e);
  }

  Logger.log(log.join('\n'));
  SpreadsheetApp.getUi().alert('Migración completa:\n\n' + log.join('\n'));
}

// ─── LOGIN DEL PANEL CRM ─────────────────────────────────────

function loginPanel(p) {
  var stored = PropertiesService.getScriptProperties().getProperty('PANEL_PASS');
  if (!stored) return { ok:false, error:'Contraseña no configurada. Agregá PANEL_PASS en las propiedades del script.' };

  // Rate limiting: máx 5 intentos fallidos en 15 minutos por prefijo de clave
  var cache    = CacheService.getScriptCache();
  var rateKey  = 'login_fail_' + Utilities.base64Encode(String(p.clave||'').slice(0,4));
  var fails    = parseInt(cache.get(rateKey) || '0', 10);
  if (fails >= 5) return { ok:false, error:'Demasiados intentos fallidos. Esperá 15 minutos.' };

  if (String(p.clave || '') !== String(stored)) {
    cache.put(rateKey, String(fails + 1), 900); // 15 minutos
    return { ok:false, error:'Contraseña incorrecta.' };
  }

  // Éxito: limpiar contador y emitir token
  cache.remove(rateKey);
  var token = Utilities.getUuid();
  cache.put('panel_' + token, '1', 28800); // 8 horas
  return { ok:true, token: token };
}

function verifyPanel(p) {
  if (!p.token) return { ok:false };
  var val = CacheService.getScriptCache().get('panel_' + p.token);
  return { ok: val === '1' };
}
