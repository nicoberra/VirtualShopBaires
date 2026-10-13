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

// Avisos por Telegram cuando entra un pedido (opcional).
// Se leen de Propiedades del script (TG_TOKEN y TG_CHAT) para no publicarlos en el repo.
var TG_TOKEN = PropertiesService.getScriptProperties().getProperty('TG_TOKEN') || '';
var TG_CHAT  = PropertiesService.getScriptProperties().getProperty('TG_CHAT')  || '';

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
    { k:'clave',    h:'Clave'     },
    // Columnas agregadas al final (2026-10-13): la ficha del CRM ya las pedía y se perdían
    { k:'apellido',  h:'Apellido'      },
    { k:'dni',       h:'DNI'           },
    { k:'direccion', h:'Dirección'     },
    { k:'cp',        h:'CP'            },
    { k:'provincia', h:'Provincia'     },
    { k:'cuit',      h:'CUIT'          },
    { k:'iva',       h:'Condición IVA' },
    { k:'razon',     h:'Razón social'  }
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
      'ext_productos_list':1,'ext_producto_update':1,'ext_producto_agregar':1,'ext_variantes_set':1,
      'gh_estado':1,'producto_foto_subir':1,'producto_fotos_set':1,'ext_variante_agregar':1,
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
    else if (accion === 'ext_variantes_set')     out = extVariantesSet(p);
    else if (accion === 'gh_estado')             out = { ok:true, gh: !!GH_TOKEN };
    else if (accion === 'producto_foto_subir')   out = productoFotoSubir(p);
    else if (accion === 'producto_fotos_set')    out = productoFotosSet(p);
    else if (accion === 'ext_variante_agregar')  out = extVarianteAgregar(p);
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
    else if (accion === 'mp_webhook')           out = mpWebhook(p, e);
    else if (accion === 'mis_pedidos')          out = misPedidos(p);
    else throw 'Acción desconocida: ' + accion;

  } catch(err) {
    out = { ok:false, error: String(err) };
    _registrarError(accion, err);
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
  if (!String(p.id || '').trim()) return false;
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
  if (!String(id || '').trim()) return false;   // sin id podría borrar la primera fila sin id
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
    sh.getRange(m+1, idx.clave+1).setValue(_hashClave(p.clave));
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
    if (col.k==='clave')  return _hashClave(p.clave);
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
  if (!_limite('login_' + String(p.email).trim().toLowerCase(), 10, 900))
    return { ok:false, error:'Demasiados intentos. Esperá 15 minutos.' };
  var v = _verificarClave(datos[m][idx.clave], p.clave);
  if (!v.ok) return { ok:false, error:'Contraseña incorrecta.' };
  if (v.actualizar) sh.getRange(m+1, idx.clave+1).setValue(_hashClave(p.clave));   // migra la clave vieja
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

// ─── FOTOS DE LA TIENDA (images-manifest.json del repo) ─────
// La web toma las fotos de images-manifest.json: { categoria: { nombre: [urls] } }

var STORE_MANIFEST = 'images-manifest.json';
var STORE_IMG_DIR  = 'img/productos';
var STORE_BASE_URL = 'https://virtualshopbaires.com.ar/';

function _normKey(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}
function _buscarClave(obj, nombre) {
  if (!obj) return null;
  if (obj[nombre] !== undefined) return nombre;
  var n = _normKey(nombre);
  var ks = Object.keys(obj);
  for (var i = 0; i < ks.length; i++) if (_normKey(ks[i]) === n) return ks[i];
  return null;
}
function _slug(s) {
  return _normKey(s).replace(/\s+/g,'-').slice(0, 60) || 'producto';
}

function storeManifestLeer() {
  var r = ghApi('get', 'contents/' + STORE_MANIFEST + '?ref=' + GH_BRANCH);
  if (r.code !== 200 || !r.json) throw 'No se pudo leer el manifest (' + r.code + ')';
  var txt = Utilities.newBlob(Utilities.base64Decode(String(r.json.content).replace(/\n/g,''))).getDataAsString('UTF-8');
  return { data: JSON.parse(txt), sha: r.json.sha };
}

function storeManifestGuardar(man, mensaje) {
  var txt = JSON.stringify(man.data, null, 2);
  var r = ghApi('put', 'contents/' + STORE_MANIFEST, {
    message: mensaje,
    content: Utilities.base64Encode(txt, Utilities.Charset.UTF_8),
    sha: man.sha,
    branch: GH_BRANCH
  });
  if (r.code < 200 || r.code >= 300) throw 'No se pudo guardar el manifest (' + r.code + ')';
}

function _fotosDe(man, categoria, nombre) {
  var catKey = _buscarClave(man.data, categoria) || categoria;
  if (!man.data[catKey]) man.data[catKey] = {};
  var key = _buscarClave(man.data[catKey], nombre) || nombre;
  var v = man.data[catKey][key];
  var urls = Array.isArray(v) ? v.slice() : (v ? [v] : []);
  return { catKey: catKey, key: key, urls: urls };
}

// Sube una foto al repo y la agrega a las fotos del producto en la tienda
function productoFotoSubir(p) {
  if (!GH_TOKEN) return { ok:false, error:'Falta GH_TOKEN en las propiedades del script' };
  var categoria = String(p.categoria||'').trim(), nombre = String(p.nombre||'').trim();
  if (!categoria || !nombre || !p.data) return { ok:false, error:'Faltan categoría, nombre o foto' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ruta = STORE_IMG_DIR + '/' + _slug(categoria) + '/' + _slug(nombre) + '-' + new Date().getTime() + '.jpg';
    var up = ghApi('put', 'contents/' + encPath(ruta), {
      message: 'Foto de producto: ' + nombre,
      content: String(p.data).replace(/^data:[^,]*,/, ''),
      branch:  GH_BRANCH
    });
    if (up.code < 200 || up.code >= 300) return { ok:false, error:'No se pudo subir la foto (' + up.code + ')' };

    var url = STORE_BASE_URL + ruta;
    var man = storeManifestLeer();
    var f = _fotosDe(man, categoria, nombre);
    f.urls.push(url);
    man.data[f.catKey][f.key] = f.urls;
    storeManifestGuardar(man, 'Fotos: ' + nombre);
    return { ok:true, url: url, fotos: f.urls };
  } catch (e) {
    return { ok:false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

// Agrega una variante nueva debajo de una fila del producto (copia esa fila)
function extVarianteAgregar(p) {
  var sheetName = String(p.sheet||'').trim();
  var row = parseInt(p.row, 10);
  var color = String(p.color||'').trim();
  if (!sheetName || !row || !color) return { ok:false, error:'Faltan parámetros (sheet, row, color)' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ss().getSheetByName(sheetName);
    if (!sh) return { ok:false, error:'Hoja no encontrada: ' + sheetName };
    var lastCol = sh.getLastColumn();
    var idx = _headerIdx(sh.getRange(1, 1, 1, lastCol).getValues()[0]);
    if (idx['color'] === undefined) return { ok:false, error:'La hoja no tiene columna Color' };

    var nombre = String(sh.getRange(row, 1).getValue()).trim();
    if (p.nombre && String(p.nombre).trim() !== nombre)
      return { ok:false, error:'La fila ' + row + ' no coincide con "' + p.nombre + '". Recargá los productos.' };

    // Mismo color ya cargado en el producto
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === nombre && String(data[i][idx['color']]).trim().toLowerCase() === color.toLowerCase())
        return { ok:false, error:'Ya existe la variante "' + color + '"' };
    }

    var img = '';
    if (p.data) {
      if (!GH_TOKEN) return { ok:false, error:'Falta GH_TOKEN para subir la foto' };
      var ruta = STORE_IMG_DIR + '/' + _slug(sheetName) + '/' + _slug(nombre + ' ' + color) + '-' + new Date().getTime() + '.jpg';
      var up = ghApi('put', 'contents/' + encPath(ruta), {
        message: 'Foto de variante: ' + nombre + ' - ' + color,
        content: String(p.data).replace(/^data:[^,]*,/, ''),
        branch:  GH_BRANCH
      });
      if (up.code < 200 || up.code >= 300) return { ok:false, error:'No se pudo subir la foto (' + up.code + ')' };
      img = STORE_BASE_URL + ruta;
    }

    sh.insertRowsAfter(row, 1);
    sh.getRange(row, 1, 1, lastCol).copyTo(sh.getRange(row + 1, 1, 1, lastCol));
    var nueva = row + 1;
    sh.getRange(nueva, idx['color'] + 1).setValue(color);
    if (idx['imagen_url'] !== undefined) sh.getRange(nueva, idx['imagen_url'] + 1).setValue(img);
    if (p.precio !== undefined && p.precio !== '' && idx['precio'] !== undefined)
      sh.getRange(nueva, idx['precio'] + 1).setValue(Number(String(p.precio).replace(/[^\d.,]/g,'').replace(',','.')) || 0);
    if (p.sku !== undefined && idx['sku_costo'] !== undefined) {
      var c = sh.getRange(nueva, idx['sku_costo'] + 1);
      c.setNumberFormat('@'); c.setValue(String(p.sku).trim());
    }
    if (idx['stock'] !== undefined) sh.getRange(nueva, idx['stock'] + 1).setValue(true);
    return { ok:true, row: nueva, imagen: img };
  } catch (e) {
    return { ok:false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

// Reemplaza la lista de fotos del producto (ordenar, elegir principal o quitar)
function productoFotosSet(p) {
  if (!GH_TOKEN) return { ok:false, error:'Falta GH_TOKEN en las propiedades del script' };
  var categoria = String(p.categoria||'').trim(), nombre = String(p.nombre||'').trim();
  var urls;
  try { urls = JSON.parse(p.urls || '[]'); } catch(e) { return { ok:false, error:'urls inválidas' }; }
  if (!categoria || !nombre || !Array.isArray(urls)) return { ok:false, error:'Faltan parámetros' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var man = storeManifestLeer();
    var f = _fotosDe(man, categoria, nombre);
    if (urls.length) man.data[f.catKey][f.key] = urls.length === 1 ? urls[0] : urls;
    else delete man.data[f.catKey][f.key];
    storeManifestGuardar(man, 'Fotos: ' + nombre);
    return { ok:true, fotos: urls };
  } catch (e) {
    return { ok:false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
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

// ─── UTILIDADES DE SEGURIDAD ─────────────────────────────────

var CRM_EXEC_URL = 'https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec';

function _hex(bytes) {
  return bytes.map(function(b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function _md5(s) {
  return _hex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(s), Utilities.Charset.UTF_8));
}
function _sha256(s) {
  return _hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

// Contraseñas: se guardan como "s1$<sal>$<hash>" (SHA-256 iterado con sal por usuario).
// Las claves viejas en texto plano siguen funcionando y se convierten solas al próximo login.
var CLAVE_ITERACIONES = 1000;
function _hashClave(clave, sal) {
  sal = sal || _md5(Utilities.getUuid() + Math.random()).slice(0, 16);
  var h = String(clave);
  for (var i = 0; i < CLAVE_ITERACIONES; i++) h = _sha256(sal + ':' + h);
  return 's1$' + sal + '$' + h;
}
// Devuelve { ok, actualizar } — actualizar=true si la clave guardada estaba en texto plano.
function _verificarClave(guardada, clave) {
  guardada = String(guardada || '');
  if (!guardada) return { ok:false, actualizar:false };
  if (guardada.indexOf('s1$') === 0) {
    var sal = guardada.split('$')[1];
    return { ok: _hashClave(clave, sal) === guardada, actualizar:false };
  }
  var ok = guardada === String(clave);
  return { ok: ok, actualizar: ok };
}

// Límite de pedidos: true si todavía se permite. Ventana deslizante en CacheService.
function _limite(clave, max, segundos) {
  var c = CacheService.getScriptCache();
  var k = 'rl_' + _md5(clave);
  var n = parseInt(c.get(k) || '0', 10);
  if (n >= max) return false;
  c.put(k, String(n + 1), segundos);
  return true;
}
// Antiabuso común para endpoints públicos que crean pedidos o pagos.
function _antiabuso(p, tipo) {
  if (String(p.website || '').trim()) return 'No se pudo procesar el pedido.';   // honeypot: lo completan los bots
  var email = String(p.email || '').trim().toLowerCase();
  if (email && !_limite(tipo + '_mail_' + email, 5, 600))
    return 'Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.';
  if (!_limite(tipo + '_global_' + Math.floor(Date.now() / 60000), 60, 120))
    return 'Estamos recibiendo muchos pedidos en este momento. Probá de nuevo en un minuto.';
  return '';
}
// Clave de idempotencia: el mismo carrito del mismo email en 10 min devuelve el mismo pedido.
function _claveIdem(tipo, p, items) {
  var norm = (items || []).map(function(i) {
    return [_normKey(i.nombre || i.title || ''), String(i.color||'').toLowerCase(), String(i.talle||'').toLowerCase(),
            parseInt(i.cantidad || i.quantity || i.qty || 1, 10)].join('|');
  }).sort().join(';');
  return 'idem_' + tipo + '_' + _md5([String(p.email||'').trim().toLowerCase(), String(p.nombre||'').trim().toLowerCase(),
    norm, String(p.metodoPago||''), String(p.envioZona || p.envio || '')].join('#'));
}

// ─── ERRORES CENTRALIZADOS ───────────────────────────────────
// Registra en la pestaña "Errores" y avisa por Telegram como máximo una vez cada 15 min por tipo.
var ERRORES_ESPERADOS = /^(Pestaña inválida|Acción desconocida)/;
function _registrarError(accion, err) {
  try {
    var msg = String(err && err.message || err).slice(0, 500);
    if (ERRORES_ESPERADOS.test(msg)) return;
    var spreadsheet = ss();
    var sh = spreadsheet.getSheetByName('Errores');
    if (!sh) {
      sh = spreadsheet.insertSheet('Errores');
      sh.appendRow(['Fecha', 'Acción', 'Error']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), String(accion || ''), msg]);
    var k = 'err_tg_' + _md5(String(accion) + msg.slice(0, 80));
    var c = CacheService.getScriptCache();
    if (!c.get(k)) {
      c.put(k, '1', 900);
      avisarTelegram('⚠️ Error en el CRM (' + (accion || '—') + ')\n' + msg.slice(0, 300));
    }
  } catch(e) {}
}

// ─── PRECIOS EN EL SERVIDOR ──────────────────────────────────
// Nunca se confía en el precio que manda el navegador: el precio de cada
// producto se busca en la planilla (misma regla que la tienda: columna
// "descuento" si tiene un número > 0, si no la columna Precio) y el envío
// se calcula con la tabla de zonas del servidor.

var ZONAS_ENVIO_SRV = {
  capital: { nombre:'Capital', precio:5500 },
  gba1:    { nombre:'GBA 1',   precio:7000 },
  gba2:    { nombre:'GBA 2',   precio:9000 },
  gba3:    { nombre:'GBA 3',   precio:15000 }
};
var DESCUENTO_TRANSFERENCIA_PCT = 10;   // mismo valor que DISCOUNT_PCT en checkout.html

// Acepta números y texto en formato argentino: "12.500", "$ 12.500,50", "12500.5"
function _numPrecio(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = String(v).replace(/[^\d.,]/g,'');
  if (s.indexOf(',') >= 0)                 s = s.replace(/\./g,'').replace(',','.');  // 12.500,50 → 12500.50
  else if (/^\d{1,3}(\.\d{3})+$/.test(s))  s = s.replace(/\./g,'');                  // 12.500    → 12500
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Pestañas de catálogo (todas menos las del sistema). Se lee una vez por ejecución.
function _nuevoCacheCatalogo() {
  var tabs = {};
  ss().getSheets().forEach(function(sh) {
    var n = sh.getName();
    if (SYSTEM_TABS.indexOf(n) < 0) tabs[n] = true;
  });
  return { _tabs: tabs };
}

// Filas {nombre, color, talle, precio} de una pestaña, leídas una sola vez por ejecución.
function _catalogoHoja(cache, tabName) {
  if (cache[tabName]) return cache[tabName];
  var rows = [];
  var sh = ss().getSheetByName(tabName);
  if (sh && sh.getLastRow() >= 2) {
    var data = sh.getDataRange().getValues();
    var idx  = _headerIdx(data[0]);
    var hD   = String(data[0][3]||'').trim().toLowerCase();
    var hE   = String(data[0][4]||'').trim().toLowerCase();
    for (var r = 1; r < data.length; r++) {
      var nombre = String(data[r][0]||'').trim();
      if (!nombre) continue;
      var base = _numPrecio(data[r][1]);
      var desc = idx['descuento'] !== undefined ? _numPrecio(data[r][idx['descuento']]) : null;
      rows.push({
        nombre: nombre,
        n:      _normKey(nombre),
        color:  hD === 'color' ? String(data[r][3]||'').trim().toLowerCase() : '',
        talle:  hE.indexOf('talle') >= 0 ? String(data[r][4]||'').trim().toLowerCase() : '',
        precio: (desc !== null && desc > 0) ? desc : base
      });
    }
  }
  cache[tabName] = rows;
  return rows;
}

// Busca el precio real de un producto (y variante). Si no viene categoría, recorre todas las pestañas.
function _precioCatalogo(cache, categoria, nombre, color, talle) {
  var n = _normKey(nombre);
  var c = String(color||'').trim().toLowerCase();
  var t = String(talle||'').trim().toLowerCase();
  var tabs = [];
  if (categoria) {
    var real = _buscarClave(cache._tabs, String(categoria).trim());
    if (real) tabs.push(real);
  }
  if (!tabs.length) tabs = Object.keys(cache._tabs);

  for (var i = 0; i < tabs.length; i++) {
    var rows = _catalogoHoja(cache, tabs[i]).filter(function(r) { return r.n === n; });
    if (!rows.length) continue;
    var exactas = rows.filter(function(r) { return (!c || r.color === c) && (!t || r.talle === t); });
    var row = exactas[0] || rows[0];
    if (row.precio !== null && row.precio > 0) return { precio: row.precio, categoria: tabs[i] };
  }
  return null;
}

// Recalcula un pedido completo con precios del servidor.
// items: [{nombre, categoria?, color?, talle?, cantidad|qty}]  envioId: capital|gba1|gba2|gba3|''  descuentoPct: 0 o 10
function _calcularPedidoServidor(items, envioId, descuentoPct) {
  var cache = _nuevoCacheCatalogo();
  var out = { items:[], subtotal:0, noVerificados:[], envio:0, envioNombre:'' };

  (items || []).forEach(function(i) {
    var nombre = String(i.nombre || i.title || '').trim();
    if (!nombre) return;
    var qty = parseInt(i.cantidad || i.quantity || i.qty || 1, 10);
    if (isNaN(qty) || qty < 1) qty = 1;
    if (qty > 99) qty = 99;
    var hit = _precioCatalogo(cache, i.categoria, nombre, i.color, i.talle);
    if (!hit) { out.noVerificados.push(nombre); return; }
    out.items.push({ nombre:nombre, color:String(i.color||''), talle:String(i.talle||''), qty:qty, precio:hit.precio });
    out.subtotal += hit.precio * qty;
  });

  var z = ZONAS_ENVIO_SRV[String(envioId||'').trim().toLowerCase()];
  if (z) { out.envio = z.precio; out.envioNombre = z.nombre; }

  // misma fórmula de redondeo que el checkout
  out.descuento = Math.round(out.subtotal * (descuentoPct||0) / 100 * 100) / 100;
  out.total     = Math.round((out.subtotal - out.descuento + out.envio) * 100) / 100;
  return out;
}

function _detalleItems(items) {
  return items.map(function(i) {
    return i.qty + 'x ' + i.nombre + (i.color ? ' · ' + i.color : '') + (i.talle ? ' / ' + i.talle : '');
  }).join(', ');
}

// ─── MERCADO PAGO ────────────────────────────────────────────

function crearPreferencia(p) {
  if (!MP_ACCESS_TOKEN) return { ok:false, error:'MP_ACCESS_TOKEN no configurado en Codigo.gs' };

  var items = [];
  try { items = JSON.parse(p.items || '[]'); } catch(e) { return { ok:false, error:'items inválidos' }; }
  if (!items.length) return { ok:false, error:'Carrito vacío' };

  // Mismo carrito reenviado (doble clic, reintento tras timeout) → mismo link de pago
  var cacheMP = CacheService.getScriptCache();
  var idem = _claveIdem('mp', p, items);
  var previo = cacheMP.get(idem);
  if (previo) { try { return JSON.parse(previo); } catch(e) {} }
  var abuso = _antiabuso(p, 'mp');
  if (abuso) return { ok:false, error: abuso };

  // Precios y envío calculados en el servidor; el precio del navegador se ignora.
  var calc = _calcularPedidoServidor(items, p.envio, 0);
  if (calc.noVerificados.length)
    return { ok:false, error:'Estos productos ya no están disponibles: ' + calc.noVerificados.join(', ') + '. Quitalos del carrito e intentá de nuevo.' };
  if (!calc.items.length || calc.total <= 0) return { ok:false, error:'Carrito vacío' };

  var itemsMP = calc.items.map(function(i) {
    return {
      title:       (i.nombre + (i.color ? ' · ' + i.color : '') + (i.talle ? ' / ' + i.talle : '')).slice(0, 256),
      quantity:    i.qty,
      unit_price:  i.precio,
      currency_id: 'ARS'
    };
  });
  if (calc.envio > 0)
    itemsMP.push({ title:'Envío a domicilio · ' + calc.envioNombre, quantity:1, unit_price:calc.envio, currency_id:'ARS' });

  var ref = String(p.ref || ('vsb-' + Date.now())).replace(/[^\w\-]/g,'').slice(0, 60) || ('vsb-' + Date.now());

  var payload = {
    items: itemsMP,
    back_urls: {
      success: 'https://virtualshopbaires.com.ar/gracias.html?ref=' + ref,
      failure: 'https://virtualshopbaires.com.ar/checkout.html?mp=error',
      pending: 'https://virtualshopbaires.com.ar/gracias.html?ref=' + ref + '&estado=pendiente'
    },
    auto_return: 'approved',
    statement_descriptor: 'Virtual Shop Baires',
    external_reference: ref,
    notification_url: CRM_EXEC_URL + '?action=mp_webhook'
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

  // Guardar pedido como Pendiente en Sheets (con el total calculado en el servidor)
  var total   = calc.total;
  var detalle = _detalleItems(calc.items) + (calc.envio > 0 ? ', Envío ' + calc.envioNombre : '');
  agregar('Pedidos', {
    cliente:  String(p.nombre  || '').slice(0, 120),
    telefono: String(p.telefono || '').slice(0, 40),
    detalle:  detalle,
    monto:    total,
    estado:   'Pendiente',
    notas:    'MercadoPago · ref: ' + ref + (p.email ? ' · email: ' + String(p.email).trim().toLowerCase().slice(0, 120) : '')
  });

  avisarTelegram('💳 Nuevo pedido MP\n👤 ' + (p.nombre||'—') + '\n💰 $' + total + '\nRef: ' + ref);
  var res = { ok:true, url: json.init_point, ref: ref, total: total };
  cacheMP.put(idem, JSON.stringify(res), 600);
  return res;
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
    var disp = sh.getDataRange().getDisplayValues();
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

      // Display value: Sheets guarda SKUs como "4.6" como fecha
      var sku = '';
      if (idx['sku_costo'] !== undefined) sku = String(disp[r][idx['sku_costo']]||'').trim();
      else if (idx['sku'] !== undefined) sku = String(disp[r][idx['sku']]||'').trim();

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
        descripcion: descripcion,
        destacado:   destacado,
        descuento:   descuento,
        subcategoria:subcategoria,
        sku:         sku,
        imagen:      idx['imagen_url'] !== undefined ? String(data[r][idx['imagen_url']]||'').trim() : ''
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

  var celda = sh.getRange(row, colIdx);
  if (campo === 'sku_costo' || campo === 'sku') {
    celda.setNumberFormat('@');
    valor = String(valor == null ? '' : valor).trim();
  }
  celda.setValue(valor);
  return { ok:true };
}

// Convierte una fila en N variantes: la fila original queda como la primera
// y debajo se insertan copias con su color e imagen propios.
function extVariantesSet(p) {
  var sheetName = String(p.sheet||'').trim();
  var row = parseInt(p.row, 10);
  var vars;
  try { vars = JSON.parse(p.variantes || '[]'); } catch(e) { return { ok:false, error:'variantes inválidas' }; }
  if (!sheetName || !row || !vars.length) return { ok:false, error:'Faltan parámetros (sheet, row, variantes)' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ss().getSheetByName(sheetName);
    if (!sh) return { ok:false, error:'Hoja no encontrada: ' + sheetName };
    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    var idx = _headerIdx(headers);
    var cColor = idx['color'], cImg = idx['imagen_url'], cNombre = 0;
    if (cColor === undefined) return { ok:false, error:'La hoja no tiene columna Color' };

    var nombre = String(sh.getRange(row, cNombre + 1).getValue()).trim();
    if (p.nombre && String(p.nombre).trim() !== nombre)
      return { ok:false, error:'La fila ' + row + ' no coincide con "' + p.nombre + '"' };

    var setVar = function(r, v) {
      sh.getRange(r, cColor + 1).setValue(String(v.color || '').trim());
      if (cImg !== undefined && v.img) sh.getRange(r, cImg + 1).setValue(String(v.img));
    };

    setVar(row, vars[0]);
    if (vars.length > 1) {
      sh.insertRowsAfter(row, vars.length - 1);
      var base = sh.getRange(row, 1, 1, lastCol);
      for (var i = 1; i < vars.length; i++) {
        base.copyTo(sh.getRange(row + i, 1, 1, lastCol));
        setVar(row + i, vars[i]);
      }
    }
    return { ok:true, filas: vars.length };
  } finally {
    lock.releaseLock();
  }
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
  // Confirmar que la fila sigue siendo ese producto (si alguien agregó o borró filas, la posición cambia)
  if (p.nombre && String(sh.getRange(row, 1).getValue()).trim() !== String(p.nombre).trim())
    return { ok:false, error:'La lista cambió desde que la abriste. Tocá actualizar y volvé a intentar.' };
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

// ─── Columnas de "Pedidos externos" ──────────────────────────
// La pestaña puede tener encabezados del sistema viejo ("Fecha", "N° Pedido", "Estado pedido"…)
// o los del CRM ("timestamp", "orderNumber", "estado"…). Se busca cada campo por sus alias.
var PED_ALIAS = {
  timestamp:     ['timestamp', 'fecha'],
  orderNumber:   ['ordernumber', 'npedido', 'nropedido'],
  nombre:        ['nombre'],
  apellido:      ['apellido'],
  email:         ['email'],
  telefono:      ['telefono'],
  dni:           ['dni', 'dnicuit'],
  metodoEntrega: ['metodoentrega'],
  metodoPago:    ['metodopago'],
  provincia:     ['provincia'],
  localidad:     ['localidad'],
  calle:         ['calle'],
  numeroCalle:   ['numerocalle', 'numero'],
  piso:          ['piso', 'pisodpto'],
  cp:            ['cp'],
  productos:     ['productos'],
  subtotal:      ['subtotal'],
  descuento:     ['descuento'],
  total:         ['total'],
  observaciones: ['observaciones'],
  estado:        ['estado', 'estadopedido']
};
function _normH(h) { return _normKey(h).replace(/\s+/g, ''); }
// Devuelve { campo: índice de columna (0-based) } según los encabezados reales de la pestaña.
function _mapaPedidos(headers) {
  var hs = headers.map(_normH), idx = {};
  Object.keys(PED_ALIAS).forEach(function(k) {
    var al = PED_ALIAS[k];
    for (var i = 0; i < al.length; i++) { var j = hs.indexOf(al[i]); if (j >= 0) { idx[k] = j; break; } }
  });
  return idx;
}

function extPedidosListar(p) {
  try {
    var ssO  = ss();
    var sh   = ssO.getSheetByName('Pedidos externos') || ssO.getSheetByName('Pedidos Externos');
    if (!sh) return [];
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return [];

    var headers = data[0].map(function(h) { return String(h||'').trim(); });
    var mapa    = _mapaPedidos(headers);
    var fmtV    = function(v) { return (v instanceof Date) ? Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd HH:mm') : v; };
    var result  = [];
    for (var r = 1; r < data.length; r++) {
      if (!data[r][0]) continue;
      var obj = { _row: r + 1, fuente: 'web' };
      headers.forEach(function(h, i) { obj[h] = fmtV(data[r][i]); });
      // nombres estándar (timestamp, orderNumber, estado…) sin importar el encabezado real
      Object.keys(mapa).forEach(function(k) { obj[k] = fmtV(data[r][mapa[k]]); });
      result.push(obj);
    }

    // Pedidos de Mercado Pago (pestaña Pedidos): mismo formato para verlos en la misma lista
    var shM = ssO.getSheetByName('Pedidos');
    if (shM && shM.getLastRow() >= 2) {
      var cols = TABS['Pedidos'].map(function(c) { return c.k; });
      var dm = shM.getDataRange().getValues();
      for (var m = 1; m < dm.length; m++) {
        var id = dm[m][cols.indexOf('id')];
        if (!id) continue;
        var notas = String(dm[m][cols.indexOf('notas')] || '');
        var f = dm[m][cols.indexOf('fecha')];
        result.push({
          fuente:        'mp',
          _mpId:         String(id),
          orderNumber:   (notas.match(/ref: ([\w\-]+)/) || [])[1] || String(id),
          timestamp:     (f instanceof Date) ? Utilities.formatDate(f, 'GMT-3', 'yyyy-MM-dd HH:mm') : String(f || ''),
          nombre:        dm[m][cols.indexOf('cliente')],
          telefono:      dm[m][cols.indexOf('telefono')],
          email:         (notas.match(/email: ([^\s·]+)/) || [])[1] || '',
          productos:     dm[m][cols.indexOf('detalle')],
          total:         dm[m][cols.indexOf('monto')],
          metodoPago:    'mercadopago',
          estado:        dm[m][cols.indexOf('estado')] || 'Pendiente',
          observaciones: notas,
          comprobante:   dm[m][cols.indexOf('comprobante')]
        });
      }
    }

    // Más viejos primero (el panel los da vuelta). Sin "todos", solo los 300 más recientes.
    result.sort(function(a, b) { return String(a.timestamp || '') < String(b.timestamp || '') ? -1 : 1; });
    return (p && p.todos) ? result : result.slice(-300);
  } catch(ex) {
    _registrarError('ext_pedidos_listar', ex);
    return [];
  }
}

function crearPedido(p) {
  try {
    var COLS = ['timestamp','orderNumber','nombre','apellido','email','telefono','dni',
                'metodoEntrega','metodoPago','provincia','localidad','calle','numeroCalle',
                'piso','cp','productos','subtotal','descuento','total','observaciones','estado'];

    var prodsIdem = [];
    try { prodsIdem = (typeof p.productos === 'string') ? JSON.parse(p.productos) : (p.productos || []); } catch(ex) {}
    var cacheP = CacheService.getScriptCache();
    var idem   = _claveIdem('pedido', p, prodsIdem);
    var previo = cacheP.get(idem);
    if (previo) { try { return JSON.parse(previo); } catch(ex) {} }
    var abuso = _antiabuso(p, 'pedido');
    if (abuso) return { ok:false, error: abuso };

    // Lock corto: dos envíos idénticos simultáneos no crean dos pedidos
    var lock = LockService.getScriptLock();
    var conLock = lock.tryLock(15000);
    if (conLock) {
      previo = cacheP.get(idem);
      if (previo) { lock.releaseLock(); try { return JSON.parse(previo); } catch(ex) {} }
    }
    try {

    var ssO = ss();
    var sh  = ssO.getSheetByName('Pedidos externos') || ssO.getSheetByName('Pedidos Externos');
    if (!sh) {
      sh = ssO.insertSheet('Pedidos externos');
      sh.appendRow(COLS);
      sh.getRange(1, 1, 1, COLS.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    var orderNum = 'VSB-' + new Date().getTime() + Math.floor(Math.random() * 10);
    var now = Utilities.formatDate(new Date(), 'GMT-3', 'yyyy-MM-dd HH:mm');

    // Subtotal, descuento, envío y total se recalculan con precios del servidor.
    // Si algún producto no se encuentra en el catálogo, se conservan los valores
    // del navegador y el pedido queda marcado para revisar a mano.
    var productosStr = '';
    try {
      var prods = (typeof p.productos === 'string') ? JSON.parse(p.productos) : p.productos;
      if (Array.isArray(prods) && prods.length) {
        var esTransf = ['transferencia','efectivo'].indexOf(String(p.metodoPago||'').toLowerCase()) >= 0;
        var calc = _calcularPedidoServidor(prods, p.envioZona, esTransf ? DESCUENTO_TRANSFERENCIA_PCT : 0);
        if (calc.items.length && !calc.noVerificados.length) {
          productosStr = _detalleItems(calc.items);
          p.subtotal   = calc.subtotal;
          p.descuento  = calc.descuento;
          p.total      = calc.total;
        } else {
          productosStr = prods.map(function(i) {
            return i.qty + 'x ' + i.nombre +
              (i.color ? ' · ' + i.color : '') +
              (i.talle ? ' / ' + i.talle : '');
          }).join(', ');
          p.observaciones = '⚠ PRECIOS SIN VERIFICAR (' + (calc.noVerificados.join(', ') || 'sin productos') + ') | ' + (p.observaciones || '');
        }
      }
    } catch(ex) {}

    var valorDe = function(col) {
      if (col === 'timestamp')   return now;
      if (col === 'orderNumber') return orderNum;
      if (col === 'estado')      return 'Pendiente';
      if (col === 'productos')   return productosStr;
      return (p[col] !== undefined && p[col] !== null) ? p[col] : '';
    };
    // Escribir cada dato en la columna que corresponde según los encabezados reales
    // (la pestaña puede tener el formato viejo: "Fecha", "N° Pedido", "Estado pedido"…)
    var headersP = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var mapaP = _mapaPedidos(headersP);
    var faltan = COLS.filter(function(c) { return mapaP[c] === undefined; });
    if (faltan.length) {   // columnas que la pestaña no tiene: se agregan al final
      sh.getRange(1, headersP.length + 1, 1, faltan.length).setValues([faltan]);
      faltan.forEach(function(c, i) { mapaP[c] = headersP.length + i; });
      headersP = headersP.concat(faltan);
    }
    var row = headersP.map(function() { return ''; });
    COLS.forEach(function(c) { row[mapaP[c]] = valorDe(c); });

    sh.appendRow(row);

    var res = {
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
    cacheP.put(idem, JSON.stringify(res), 600);

    } finally {
      if (conLock) lock.releaseLock();
    }

    avisarTelegram('🛒 Nuevo pedido: ' + orderNum +
      '\n' + (p.nombre||'') + ' ' + (p.apellido||'') +
      '\n' + (p.email||'') + ' · ' + (p.telefono||'') +
      '\nTotal: $' + (p.total||0) + ' · ' + (p.metodoPago||'') + ' · ' + (p.metodoEntrega||''));

    return res;
  } catch(err) {
    _registrarError('createOrder', err);
    return { ok:false, error: String(err) };
  }
}

// ─── MERCADO PAGO: CONFIRMACIÓN AUTOMÁTICA ───────────────────
// Apps Script no expone los encabezados HTTP, así que no se puede validar la firma
// x-signature. En su lugar, cada aviso se RECONSULTA a la API de Mercado Pago con el
// MP_ACCESS_TOKEN: solo un pago real, aprobado y de esta cuenta confirma un pedido.

function _mpGet(path) {
  var r = UrlFetchApp.fetch('https://api.mercadopago.com' + path, {
    method: 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + MP_ACCESS_TOKEN }
  });
  var j = null;
  try { j = JSON.parse(r.getContentText()); } catch(e) {}
  return { code: r.getResponseCode(), json: j };
}

// Marca como Confirmado el pedido de la pestaña Pedidos cuya nota tiene "ref: <external_reference>".
// Idempotente: si ya está confirmado o el pago ya se procesó, no hace nada.
function _confirmarPagoMP(pago) {
  if (!pago || pago.status !== 'approved') return { ok:true, estado:'ignorado' };
  var ref = String(pago.external_reference || '');
  if (!ref) return { ok:true, estado:'sin_ref' };

  var cache = CacheService.getScriptCache();
  var kPago = 'mp_ok_' + pago.id;
  if (cache.get(kPago)) return { ok:true, estado:'duplicado' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = hoja('Pedidos');
    var cols = TABS['Pedidos'].map(function(c) { return c.k; });
    var cEstado = cols.indexOf('estado'), cNotas = cols.indexOf('notas'), cMonto = cols.indexOf('monto');
    var datos = sh.getDataRange().getValues();
    for (var i = datos.length - 1; i >= 1; i--) {
      var notas = String(datos[i][cNotas] || '');
      if (notas.indexOf('ref: ' + ref) < 0) continue;
      if (notas.indexOf('pago MP ' + pago.id) >= 0 || String(datos[i][cEstado]) === 'Confirmado') {
        cache.put(kPago, '1', 21600);
        return { ok:true, estado:'ya_confirmado' };
      }
      var monto = Number(datos[i][cMonto]) || 0;
      var pagado = Number(pago.transaction_amount) || 0;
      var aviso = (monto && pagado + 1 < monto) ? ' ⚠ PAGÓ $' + pagado + ' DE $' + monto : '';
      if (!aviso) sh.getRange(i + 1, cEstado + 1).setValue('Confirmado');
      sh.getRange(i + 1, cNotas + 1).setValue(notas + ' · pago MP ' + pago.id + ' aprobado' + aviso);
      cache.put(kPago, '1', 21600);
      avisarTelegram((aviso ? '⚠️ Pago MP con monto distinto' : '✅ Pago MP aprobado') +
        '\n👤 ' + (datos[i][cols.indexOf('cliente')] || '—') + '\n💰 $' + pagado + '\nRef: ' + ref);
      return { ok:true, estado: aviso ? 'monto_distinto' : 'confirmado' };
    }
    return { ok:true, estado:'pedido_no_encontrado' };
  } finally {
    lock.releaseLock();
  }
}

// Recibe las notificaciones de Mercado Pago (notification_url de la preferencia).
function mpWebhook(p, e) {
  if (!MP_ACCESS_TOKEN) return { ok:true };
  var body = {};
  try { if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents); } catch(ex) {}
  var tipo = String(p.type || p.topic || body.type || body.topic || '');
  var id   = String(p['data.id'] || (body.data && body.data.id) || p.id || '');
  if (tipo !== 'payment' || !/^\d+$/.test(id)) return { ok:true };

  var r = _mpGet('/v1/payments/' + id);
  if (r.code !== 200 || !r.json) { _registrarError('mp_webhook', 'No se pudo consultar el pago ' + id + ' (' + r.code + ')'); return { ok:true }; }
  return _confirmarPagoMP(r.json);
}

// Conciliación: confirma pagos aprobados de las últimas 48 h que no llegaron por webhook.
// Se ejecuta sola cada 30 min después de correr instalarConciliacion() una vez.
function conciliarPagosMP() {
  if (!MP_ACCESS_TOKEN) return { ok:false, error:'MP_ACCESS_TOKEN no configurado' };
  var desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  var hasta = new Date().toISOString();
  var r = _mpGet('/v1/payments/search?sort=date_created&criteria=desc&status=approved&limit=100' +
                 '&range=date_created&begin_date=' + encodeURIComponent(desde) + '&end_date=' + encodeURIComponent(hasta));
  if (r.code !== 200 || !r.json) { _registrarError('conciliarPagosMP', 'Búsqueda de pagos falló (' + r.code + ')'); return { ok:false }; }
  var res = { revisados:0, confirmados:0 };
  (r.json.results || []).forEach(function(pago) {
    if (String(pago.external_reference || '').indexOf('vsb-') !== 0) return;
    res.revisados++;
    var x = _confirmarPagoMP(pago);
    if (x.estado === 'confirmado' || x.estado === 'monto_distinto') res.confirmados++;
  });
  return res;
}

// Ejecutar UNA vez a mano desde el editor de Apps Script (pide autorización).
function instalarConciliacion() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'conciliarPagosMP') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('conciliarPagosMP').timeBased().everyMinutes(30).create();
  return 'Conciliación instalada: cada 30 minutos';
}

// ─── MIS COMPRAS (página pública por email) ──────────────────
// Devuelve solo lo necesario para listar: nunca dirección, DNI ni teléfono.
function _estadoPagoWeb(estado, metodo) {
  var e = String(estado || '').toLowerCase();
  if (e === 'cancelado') return 'PAGO RECHAZADO';
  if (e === 'confirmado' || e === 'en camino' || e === 'entregado') return 'PAGO CONFIRMADO';
  return 'PENDIENTE DE PAGO';
}

function misPedidos(p) {
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok:false, error:'Email inválido' };
  if (!_limite('mis_' + email, 20, 600) || !_limite('mis_global_' + Math.floor(Date.now() / 60000), 120, 120))
    return { ok:false, error:'Demasiadas consultas. Esperá unos minutos.' };

  var orders = [];
  var ssO = ss();

  // Pedidos de la web (transferencia / efectivo)
  var sh = ssO.getSheetByName('Pedidos externos') || ssO.getSheetByName('Pedidos Externos');
  if (sh && sh.getLastRow() >= 2) {
    var d = sh.getDataRange().getValues();
    var ix = _mapaPedidos(d[0]);
    var col = function(r, k) { return ix[k] === undefined ? '' : d[r][ix[k]]; };
    for (var r = 1; r < d.length; r++) {
      if (String(col(r, 'email') || '').trim().toLowerCase() !== email) continue;
      var estado = col(r, 'estado');
      orders.push({
        numero:        col(r, 'orderNumber'),
        fecha:         col(r, 'timestamp'),
        productos:     col(r, 'productos'),
        total:         col(r, 'total'),
        metodoPago:    col(r, 'metodoPago'),
        metodoEntrega: col(r, 'metodoEntrega'),
        estadoPedido:  estado,
        estadoPago:    _estadoPagoWeb(estado, col(r, 'metodoPago'))
      });
    }
  }

  // Pedidos de Mercado Pago (pestaña Pedidos, el email va en las notas)
  var shM = ssO.getSheetByName('Pedidos');
  if (shM && shM.getLastRow() >= 2) {
    var cols = TABS['Pedidos'].map(function(c) { return c.k; });
    var dm = shM.getDataRange().getValues();
    for (var m = 1; m < dm.length; m++) {
      var notas = String(dm[m][cols.indexOf('notas')] || '');
      if (notas.toLowerCase().indexOf('email: ' + email) < 0) continue;
      var refM = (notas.match(/ref: ([\w\-]+)/) || [])[1] || dm[m][cols.indexOf('id')];
      var est = dm[m][cols.indexOf('estado')];
      orders.push({
        numero:        refM,
        fecha:         dm[m][cols.indexOf('fecha')],
        productos:     dm[m][cols.indexOf('detalle')],
        total:         dm[m][cols.indexOf('monto')],
        metodoPago:    'mercadopago',
        metodoEntrega: '',
        estadoPedido:  est,
        estadoPago:    _estadoPagoWeb(est, 'mercadopago')
      });
    }
  }

  orders.forEach(function(o) { if (o.fecha instanceof Date) o.fecha = o.fecha.toISOString(); });
  orders.sort(function(a, b) { return String(b.fecha) > String(a.fecha) ? 1 : -1; });
  return { ok:true, orders: orders.slice(0, 50) };
}

function extPedidoActualizar(p) {
  var row   = parseInt(p.row, 10);
  var campo = String(p.campo||'').trim().toLowerCase();
  var valor = p.valor;

  if (!row || !campo) return { ok:false, error:'Faltan parámetros (row, campo)' };

  var sh = ss().getSheetByName('Pedidos externos') || ss().getSheetByName('Pedidos Externos');
  if (!sh) return { ok:false, error:'Hoja no encontrada' };

  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var mapa    = _mapaPedidos(headers);
  var canon   = Object.keys(PED_ALIAS).filter(function(k) { return k.toLowerCase() === campo; })[0];
  var colIdx  = (canon && mapa[canon] !== undefined) ? mapa[canon] + 1 : -1;
  if (colIdx < 0) {
    for (var i = 0; i < headers.length; i++) {
      if (_normH(headers[i]) === _normH(campo)) { colIdx = i + 1; break; }
    }
  }
  if (colIdx < 0) return { ok:false, error:'Campo no encontrado: ' + campo };

  // Confirmar que la fila es ese pedido
  if (p.orderNumber && mapa.orderNumber !== undefined &&
      String(sh.getRange(row, mapa.orderNumber + 1).getValue()) !== String(p.orderNumber))
    return { ok:false, error:'El pedido cambió de lugar en la planilla. Tocá actualizar y volvé a intentar.' };

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
