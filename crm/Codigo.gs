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
      'gh_estado':1,'sb_estado':1,'producto_foto_subir':1,'producto_fotos_set':1,'ext_variante_agregar':1,
      'ext_producto_eliminar':1,'ext_categoria_agregar':1,'ext_categoria_eliminar':1,
      'ext_categorias_list':1,'ext_categoria_foto':1,
      'ext_pedidos_list':1,'ext_pedidos_listar':1,'ext_pedido_update':1
    };
    if (ADMIN_ACTIONS[accion]) {
      var tok = String(p.token || '').trim();
      if (!tok || CacheService.getScriptCache().get('panel_' + tok) !== '1')
        return responder({ ok:false, error:'auth' }, p.callback);
    }

    if      (SBP[accion] && _productosEnSupabase()) out = SBP[accion](p);   // productos en Supabase
    else if (accion === 'list')            out = { ok:true, rows:  listar(tab) };
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
    else if (accion === 'sb_estado')             out = sbEstado();
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
    else if (accion === 'version')              out = { ok:true, version: 'v13-fotos1' };
    else if (accion === 'loginPanel')           out = loginPanel(p);
    else if (accion === 'verifyPanel')          out = verifyPanel(p);
    else if (accion === 'loginDispositivo')     out = loginDispositivo(p);
    else if (accion === 'olvidarDispositivo')   out = olvidarDispositivo(p);
    else if (accion === 'ranking_actualizar')   out = actualizarRanking(p);
    else if (accion === 'mp_webhook')           out = mpWebhook(p, e);
    else if (accion === 'mis_pedidos')          out = misPedidos(p);
    else if (accion === 'catalogo')             out = catalogoPublico();
    // Cuentas de clientes y seguimiento (antes en otro script: ahora todo vive acá)
    else if (accion === 'registerUser')         out = tiendaRegistrar(p);
    else if (accion === 'loginUser')            out = tiendaLogin(p);
    else if (accion === 'changePassword')       out = tiendaCambiarClave(p);
    else if (accion === 'subscribe')            out = { ok:true, id: suscribir(p) };
    else if (accion === 'getMyOrders')          out = misPedidos(p);
    else if (accion === 'getOrder')             out = tiendaPedido(p);
    else if (accion === 'uploadProof')          out = tiendaComprobante(p);
    else throw 'Acción desconocida: ' + accion;

  } catch(err) {
    out = { ok:false, error: String(err) };
    _registrarError(accion, err);
  }
  if (CAMBIAN_CATALOGO[accion]) _catalogoInvalidar();   // la tienda ve los cambios al instante
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
  var errReg = _antiabusoRegistro(p);
  if (errReg) return { ok:false, error: errReg };

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
  var emailL = String(p.email).trim().toLowerCase();
  if (!_limite('login_' + emailL, 10, 900)) return { ok:false, error:'Demasiados intentos. Esperá 15 minutos.' };
  if (_bloqueado('login_' + emailL, 5)) return { ok:false, error: MSJ_BLOQUEO };
  var v = _verificarClave(datos[m][idx.clave], p.clave);
  if (!v.ok) { _falloSumar('login_' + emailL, 900); return { ok:false, error:'Contraseña incorrecta.' }; }
  _falloLimpiar('login_' + emailL);
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
// Bloqueo tras intentos FALLIDOS (los ingresos correctos no cuentan y limpian el contador).
function _fallosClave(clave) { return 'fl_' + _md5(clave); }
function _bloqueado(clave, max) {
  return parseInt(CacheService.getScriptCache().get(_fallosClave(clave)) || '0', 10) >= max;
}
function _falloSumar(clave, segundos) {
  var c = CacheService.getScriptCache(), k = _fallosClave(clave);
  c.put(k, String(parseInt(c.get(k) || '0', 10) + 1), segundos);
}
function _falloLimpiar(clave) { CacheService.getScriptCache().remove(_fallosClave(clave)); }
var MSJ_BLOQUEO = 'Por seguridad bloqueamos los intentos por 15 minutos. Si olvidaste la contraseña, escribinos por WhatsApp.';

// Antiabuso para crear cuentas: honeypot + 5 por email cada 10 min + 30 por minuto en total.
function _antiabusoRegistro(p) {
  if (String(p.website || '').trim()) return 'No se pudo crear la cuenta.';
  var email = String(p.email || '').trim().toLowerCase();
  if (!_limite('registro_' + email, 5, 600)) return 'Demasiados intentos. Esperá unos minutos.';
  if (!_limite('registro_global_' + Math.floor(Date.now() / 60000), 30, 120))
    return 'Estamos recibiendo muchos registros. Probá de nuevo en un minuto.';
  return '';
}

// Clave de idempotencia. Formato nuevo: el checkout manda idPedido (uno por intento de compra)
// y el mismo id devuelve el mismo pedido. Formato viejo (sin id): mismo carrito del mismo email.
// En los dos casos dura 10 min.
function _claveIdem(tipo, p, items) {
  var id = String(p.idPedido || '').trim();
  if (/^[\w-]{8,64}$/.test(id)) return 'idem_' + tipo + '_id_' + _md5(id);
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
// ¿Los productos ya viven en Supabase? Se activa con la propiedad FUENTE_PRODUCTOS=supabase
// (junto con la tienda y el CRM, para que todo funcione igual).
var SB_PUBLICO_URL = 'https://dtsixnqwwrbwybulpuxo.supabase.co';
var SB_PUBLICO_KEY = 'sb_publishable_nGmdSmwKGuiF5LG9fbA8dw_auHYFgCM';   // pública por diseño (solo lectura vía RLS)
function _productosEnSupabase() {
  return PropertiesService.getScriptProperties().getProperty('FUENTE_PRODUCTOS') === 'supabase';
}
function _sbLeerCatalogo() {
  var sel = 'categoria,nombre,descripcion,subcategoria,destacado,imagenes,orden,variantes(color,talle,precio,precio_descuento,stock,imagen_url,orden)';
  var h = { apikey: SB_PUBLICO_KEY };
  var rc = UrlFetchApp.fetch(SB_PUBLICO_URL + '/rest/v1/categorias?select=nombre&visible=eq.true&order=orden', { headers: h, muteHttpExceptions: true });
  var rp = UrlFetchApp.fetch(SB_PUBLICO_URL + '/rest/v1/productos?select=' + encodeURIComponent(sel) + '&order=orden', { headers: h, muteHttpExceptions: true });
  if (rc.getResponseCode() !== 200 || rp.getResponseCode() !== 200) throw 'Supabase no respondió (' + rc.getResponseCode() + '/' + rp.getResponseCode() + ')';
  return { categorias: JSON.parse(rc.getContentText()).map(function(c) { return c.nombre; }), productos: JSON.parse(rp.getContentText()) };
}

function _nuevoCacheCatalogo() {
  if (_productosEnSupabase()) {
    var d = _sbLeerCatalogo(), cache = { _tabs: {} };
    d.categorias.forEach(function(c) { cache._tabs[c] = true; cache[c] = []; });
    d.productos.forEach(function(p) {
      if (!cache[p.categoria]) return;
      (p.variantes || []).forEach(function(v) {      // la clave pública solo ve variantes con stock
        var desc = v.precio_descuento === null ? null : Number(v.precio_descuento);
        cache[p.categoria].push({ nombre: p.nombre, n: _normKey(p.nombre), color: String(v.color || '').toLowerCase(),
          talle: String(v.talle || '').toLowerCase(), precio: (desc && desc > 0) ? desc : Number(v.precio) });
      });
    });
    return cache;
  }
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

var SYSTEM_TABS = ['Clientes','Pedidos','Suscriptores','Productos','Pedidos externos','Pedidos Externos','Dispositivos'];

// ─── CATÁLOGO PÚBLICO (la tienda lo lee de acá, no de la planilla) ─
// Así la planilla puede ser PRIVADA: este script la lee como dueño y entrega solo
// las pestañas listadas en "Categorias", sin columnas internas (costo, SKU, proveedor).
// Formato igual al de la API gviz de Sheets, para que js/sheets.js lo use sin cambios.
var CATALOGO_NO_PUBLICAR = /sku|costo|proveedor|compra|ganancia|margen/i;
var CATALOGO_PROHIBIDAS  = SYSTEM_TABS.concat(['Usuarios', 'Errores', 'Categorias']);
var CAMBIAN_CATALOGO = {
  'ext_producto_update':1, 'ext_producto_agregar':1, 'ext_variantes_set':1, 'ext_variante_agregar':1,
  'ext_producto_eliminar':1, 'ext_categoria_agregar':1, 'ext_categoria_eliminar':1, 'ext_categoria_foto':1,
  'producto_foto_subir':1, 'producto_fotos_set':1, 'productos_save':1, 'productos_add':1
};
var CATALOGO_CACHE_SEG = 300;

function _catalogoInvalidar() {
  try { CacheService.getScriptCache().remove('catalogo_meta'); } catch(e) {}
}

function _catalogoArmar() {
  var spreadsheet = ss();
  var hc = spreadsheet.getSheetByName('Categorias');
  var cats = [];
  if (hc && hc.getLastRow() >= 1) {
    hc.getRange(1, 1, hc.getLastRow(), 1).getValues().forEach(function(r) {
      var v = String(r[0] || '').trim();
      if (v && v.toLowerCase() !== 'nombre') cats.push(v);
    });
  }
  var hojas = {};
  cats.forEach(function(tab) {
    if (CATALOGO_PROHIBIDAS.indexOf(tab) >= 0) return;
    var sh = spreadsheet.getSheetByName(tab);
    if (!sh || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    var datos = sh.getDataRange().getValues();
    var head = datos[0].map(function(h) { return String(h || '').trim(); });
    var ocultas = head.map(function(h) { return CATALOGO_NO_PUBLICAR.test(h); });
    var cols = head.map(function(h, i) { return { label: ocultas[i] ? '' : h }; });
    var rows = [];
    for (var r = 1; r < datos.length; r++) {
      if (!String(datos[r][0] || '').trim()) continue;
      rows.push({ c: datos[r].map(function(v, i) {
        if (ocultas[i] || v === '' || v === null) return null;
        if (v instanceof Date) return { v: Utilities.formatDate(v, 'GMT-3', 'yyyy-MM-dd') };
        return { v: v };
      }) });
    }
    hojas[tab] = { cols: cols, rows: rows };
  });
  return { ok: true, generado: new Date().toISOString(), categorias: cats, hojas: hojas };
}

// Respuesta cacheada 5 min en trozos (CacheService admite 100 KB por clave).
// ─── SUPABASE (base de datos rápida) ─────────────────────────
// Claves en Propiedades del script: SUPABASE_URL y SUPABASE_SECRET (sb_secret_… o la
// service_role vieja eyJ…). La clave secreta NUNCA va al navegador ni al repo.
var SB_URL = (PropertiesService.getScriptProperties().getProperty('SUPABASE_URL') || 'https://dtsixnqwwrbwybulpuxo.supabase.co').replace(/\/+$/, '');
var SB_KEY = PropertiesService.getScriptProperties().getProperty('SUPABASE_SECRET') || '';

function _sb(metodo, ruta, cuerpo, prefer) {
  if (!SB_URL || !SB_KEY) throw 'Falta SUPABASE_SECRET en Propiedades del script';
  var headers = { apikey: SB_KEY };
  if (/^eyJ/.test(SB_KEY)) headers.Authorization = 'Bearer ' + SB_KEY;   // clave vieja (JWT)
  if (prefer) headers.Prefer = prefer;
  var opt = { method: metodo, muteHttpExceptions: true, headers: headers, contentType: 'application/json' };
  if (cuerpo !== undefined) opt.payload = JSON.stringify(cuerpo);
  var r = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + ruta, opt);
  var txt = r.getContentText(), j = null;
  try { j = txt ? JSON.parse(txt) : null; } catch(e) {}
  return { code: r.getResponseCode(), json: j, text: txt };
}
function _sbOk(r, que) {
  if (r.code < 200 || r.code >= 300) throw (que || 'Supabase') + ' (' + r.code + '): ' + String(r.text).slice(0, 300);
  return r.json;
}

function sbEstado() {
  if (!SB_URL || !SB_KEY) return { ok:false, error:'Faltan SUPABASE_URL / SUPABASE_SECRET en Propiedades del script' };
  var r = _sb('get', 'productos?select=id');
  return { ok: r.code === 200, codigo: r.code, productos: Array.isArray(r.json) ? r.json.length : null,
           error: r.code === 200 ? '' : String(r.text).slice(0, 200) };
}

// ─── PRODUCTOS DEL CRM EN SUPABASE (con FUENTE_PRODUCTOS=supabase) ──────
// El CRM entra solo con su clave de siempre: este script guarda en Supabase con
// SUPABASE_SECRET, que nunca sale del servidor. Mismas acciones y mismo formato de
// filas que con la planilla, así la pantalla del CRM no cambia.
// Cada fila se identifica como "v<id de variante>": una lista vieja de la planilla
// (números de fila) se rechaza en vez de tocar otro producto.
function _sbVid(row) {
  var m = /^v(\d+)$/.exec(String(row || '').trim());
  if (!m) throw 'La lista de productos está desactualizada: tocá actualizar y volvé a intentar.';
  return Number(m[1]);
}
function _sbR(r, que) {
  if (r.code >= 200 && r.code < 300) return r.json;
  if (/duplicate key|unique/i.test(r.text)) throw 'Ya existe un producto con ese nombre en esa categoría';
  throw que + ' (' + r.code + '): ' + String(r.text).slice(0, 200);
}
function _sbVariante(vid) {
  var v = _sbR(_sb('get', 'variantes?select=id,producto_id,orden,productos(categoria,nombre)&id=eq.' + vid), 'Variante');
  if (!v || !v.length) throw 'La lista de productos está desactualizada: tocá actualizar y volvé a intentar.';
  return v[0];
}
function _sbFotoGH(categoria, nombre, data) {   // las fotos se siguen guardando en el repo de la tienda
  if (!GH_TOKEN) throw 'Falta GH_TOKEN para subir la foto';
  var ruta = STORE_IMG_DIR + '/' + _slug(categoria) + '/' + _slug(nombre) + '-' + new Date().getTime() + '.jpg';
  var up = ghApi('put', 'contents/' + encPath(ruta), { message: 'Foto de producto: ' + nombre,
    content: String(data).replace(/^data:[^,]*,/, ''), branch: GH_BRANCH });
  if (up.code < 200 || up.code >= 300) throw 'No se pudo subir la foto (' + up.code + ')';
  return STORE_BASE_URL + ruta;
}
function _sbImagenesSet(categoria, nombre, urls) {
  _sbR(_sb('patch', 'productos?categoria=eq.' + encodeURIComponent(categoria) + '&nombre=eq.' + encodeURIComponent(nombre),
    { imagenes: urls }, 'return=minimal'), 'Fotos');
}
var _SB_CAMPOS_VARIANTE = { precio:'precio', descuento:'precio_descuento', stock:'stock', color:'color', marca:'color',
  'talle/medida':'talle', talle:'talle', sku_costo:'sku_costo', sku:'sku_costo', imagen_url:'imagen_url' };
var _SB_CAMPOS_PRODUCTO = { descripcion:'descripcion', destacado:'destacado', producto:'nombre', nombre:'nombre', subcategoria:'subcategoria' };

var SBP = {
  ext_productos_list: function() {
    var sel = 'id,categoria,nombre,descripcion,subcategoria,destacado,imagenes,orden,' +
              'variantes(id,color,talle,precio,precio_descuento,stock,sku_costo,imagen_url,orden)';
    var prods = [];
    for (var desde = 0; ; desde += 1000) {   // Supabase entrega hasta 1000 por pedido
      var pag = _sbR(_sb('get', 'productos?select=' + encodeURIComponent(sel) + '&order=orden,id&offset=' + desde + '&limit=1000'), 'Productos');
      prods = prods.concat(pag);
      if (pag.length < 1000) break;
    }
    var filas = [];
    prods.forEach(function(p) {
      (p.variantes || []).sort(function(a, b) { return a.orden - b.orden || a.id - b.id; }).forEach(function(v) {
        filas.push({ _sheet: p.categoria, _row: 'v' + v.id, categoria: p.categoria, nombre: p.nombre,
          precio: Number(v.precio), stock: !!v.stock, color: v.color || '', marca: '', talle: v.talle || '',
          descripcion: p.descripcion || '', destacado: !!p.destacado,
          descuento: v.precio_descuento === null ? '' : Number(v.precio_descuento),
          subcategoria: p.subcategoria || '', sku: v.sku_costo || '', imagen: v.imagen_url || (p.imagenes || [])[0] || '' });
      });
    });
    return { ok: true, rows: filas };
  },

  ext_producto_update: function(p) {
    var campo = String(p.campo || '').trim().toLowerCase(), v = _sbVariante(_sbVid(p.row)), valor = p.valor;
    if (campo === 'stock' || campo === 'destacado') valor = esVerdadero(valor);
    else if (campo === 'precio') valor = _numPrecio(valor) || 0;
    else if (campo === 'descuento') { valor = _numPrecio(valor); if (!(valor > 0)) valor = null; }
    else valor = String(valor === undefined || valor === null ? '' : valor).trim();
    var cuerpo = {};
    if (_SB_CAMPOS_VARIANTE[campo]) {
      cuerpo[_SB_CAMPOS_VARIANTE[campo]] = (valor === '' && _SB_CAMPOS_VARIANTE[campo] === 'sku_costo') ? null : valor;
      _sbR(_sb('patch', 'variantes?id=eq.' + v.id, cuerpo, 'return=minimal'), 'Guardar');
    } else if (_SB_CAMPOS_PRODUCTO[campo]) {
      if (_SB_CAMPOS_PRODUCTO[campo] === 'nombre' && !valor) throw 'El nombre no puede quedar vacío';
      cuerpo[_SB_CAMPOS_PRODUCTO[campo]] = valor;
      _sbR(_sb('patch', 'productos?id=eq.' + v.producto_id, cuerpo, 'return=minimal'), 'Guardar');
    } else return { ok: false, error: 'Campo no encontrado: ' + campo };
    return { ok: true };
  },

  ext_producto_agregar: function(p) {
    var categoria = String(p.sheet || '').trim(), nombre = String(p.nombre || '').trim();
    if (!categoria || !nombre) return { ok: false, error: 'Faltan categoría o nombre' };
    var nuevo = _sbR(_sb('post', 'productos?select=id', { categoria: categoria, nombre: nombre, orden: 999999 }, 'return=representation'), 'Agregar producto')[0];
    _sbR(_sb('post', 'variantes', { producto_id: nuevo.id, color: String(p.marca || p.color || '').trim(),
      precio: _numPrecio(p.precio) || 0, stock: (_numPrecio(p.stock) || 0) > 0 || esVerdadero(p.stock) }, 'return=minimal'), 'Agregar producto');
    return { ok: true, id: nuevo.id };
  },

  ext_variante_agregar: function(p) {
    var v = _sbVariante(_sbVid(p.row)), color = String(p.color || '').trim();
    if (!color) return { ok: false, error: 'Falta el color' };
    if (p.nombre && v.productos && v.productos.nombre !== String(p.nombre).trim())
      throw 'La lista de productos está desactualizada: tocá actualizar y volvé a intentar.';
    var hermanas = _sbR(_sb('get', 'variantes?select=color,orden&producto_id=eq.' + v.producto_id), 'Variantes');
    if (hermanas.some(function(h) { return String(h.color).trim().toLowerCase() === color.toLowerCase(); }))
      return { ok: false, error: 'Ya existe la variante "' + color + '"' };
    var img = p.data ? _sbFotoGH(v.productos.categoria, v.productos.nombre + ' ' + color, p.data) : null;
    var orden = hermanas.reduce(function(m, h) { return Math.max(m, h.orden); }, -1) + 1;
    _sbR(_sb('post', 'variantes', { producto_id: v.producto_id, color: color, precio: _numPrecio(p.precio) || 0, stock: true,
      sku_costo: String(p.sku || '').trim() || null, imagen_url: img, orden: orden }, 'return=minimal'), 'Agregar variante');
    return { ok: true, imagen: img || '' };
  },

  ext_producto_eliminar: function(p) {
    var v = _sbVariante(_sbVid(p.row));
    if (p.nombre && v.productos && v.productos.nombre !== String(p.nombre).trim())
      return { ok: false, error: 'La lista de productos está desactualizada: tocá actualizar y volvé a intentar.' };
    _sbR(_sb('delete', 'variantes?id=eq.' + v.id, undefined, 'return=minimal'), 'Eliminar');
    var quedan = _sbR(_sb('get', 'variantes?select=id&producto_id=eq.' + v.producto_id), 'Eliminar');
    if (!quedan.length) _sbR(_sb('delete', 'productos?id=eq.' + v.producto_id, undefined, 'return=minimal'), 'Eliminar');
    return { ok: true };
  },

  ext_categoria_agregar: function(p) {
    var nombre = String(p.nombre || '').trim();
    if (!nombre) return { ok: false, error: 'Falta el nombre' };
    _sbR(_sb('post', 'categorias', { nombre: nombre, orden: 999, visible: true }, 'return=minimal'), 'Crear categoría');
    return { ok: true };
  },

  ext_categoria_eliminar: function(p) {
    var nombre = String(p.nombre || '').trim();
    if (!nombre) return { ok: false, error: 'Falta el nombre' };
    _sbR(_sb('delete', 'productos?categoria=eq.' + encodeURIComponent(nombre), undefined, 'return=minimal'), 'Eliminar categoría');
    _sbR(_sb('delete', 'categorias?nombre=eq.' + encodeURIComponent(nombre), undefined, 'return=minimal'), 'Eliminar categoría');
    return { ok: true };
  },

  // Fotos de las categorías (el carrusel que gira en la portada de la tienda)
  ext_categorias_list: function() {
    var r = _sb('get', 'categorias?select=nombre,imagen_url&order=orden,nombre');
    if (r.code !== 200) r = _sb('get', 'categorias?select=nombre&order=orden,nombre');   // todavía sin la columna
    return { ok: true, categorias: _sbR(r, 'Categorías') };
  },

  ext_categoria_foto: function(p) {
    var nombre = String(p.nombre || '').trim();
    if (!nombre) return { ok: false, error: 'Falta la categoría' };
    if (!_sbR(_sb('get', 'categorias?select=nombre&nombre=eq.' + encodeURIComponent(nombre)), 'Categoría').length)
      return { ok: false, error: 'No existe esa categoría' };
    var url = null;
    if (p.data) {   // sin foto = volver a la de siempre
      if (!GH_TOKEN) return { ok: false, error: 'Falta GH_TOKEN para subir la foto' };
      var ruta = STORE_IMG_DIR + '/categorias/' + _slug(nombre) + '-' + new Date().getTime() + '.jpg';
      var up = ghApi('put', 'contents/' + encPath(ruta), { message: 'Foto de categoría: ' + nombre,
        content: String(p.data).replace(/^data:[^,]*,/, ''), branch: GH_BRANCH });
      if (up.code < 200 || up.code >= 300) return { ok: false, error: 'No se pudo subir la foto (' + up.code + ')' };
      url = STORE_BASE_URL + ruta;
    }
    var r = _sb('patch', 'categorias?nombre=eq.' + encodeURIComponent(nombre), { imagen_url: url }, 'return=representation');
    if (r.code >= 400 && /imagen_url/.test(r.text)) return { ok: false, error: 'Falta preparar Supabase para las fotos de categoría' };
    if (!_sbR(r, 'Foto de categoría').length) return { ok: false, error: 'No existe esa categoría' };
    return { ok: true, url: url || '' };
  },

  // Fotos: se guardan en el repo y en el manifest como siempre, y además en Supabase
  // Las fotos viven en Supabase (productos.imagenes): se suma la nueva a las que ya tiene
  producto_foto_subir: function(p) {
    var categoria = String(p.categoria || '').trim(), nombre = String(p.nombre || '').trim();
    if (!categoria || !nombre || !p.data) return { ok: false, error: 'Faltan categoría, nombre o foto' };
    var act = _sbR(_sb('get', 'productos?select=imagenes&categoria=eq.' + encodeURIComponent(categoria) +
      '&nombre=eq.' + encodeURIComponent(nombre)), 'Fotos');
    if (!act.length) return { ok: false, error: 'La lista de productos está desactualizada: tocá actualizar y volvé a intentar.' };
    var previas = act[0].imagenes || [];
    if (!previas.length) {   // todavía no estaban en Supabase: se parte de las del manifest (las que ve la tienda)
      try { previas = _fotosDe(storeManifestLeer(), categoria, nombre).urls || []; } catch (e) { previas = []; }
    }
    var url = _sbFotoGH(categoria, nombre, p.data);
    var fotos = previas.concat([url]);
    _sbImagenesSet(categoria, nombre, fotos);
    return { ok: true, url: url, fotos: fotos };
  },
  ext_variantes_set: function() {   // ya no se usa desde el CRM: que no escriba en la planilla vieja
    return { ok: false, error: 'Acción no disponible con los productos en Supabase' };
  },
  producto_fotos_set: function(p) {
    var urls;
    try { urls = JSON.parse(p.urls || '[]'); } catch (e) { return { ok: false, error: 'urls inválidas' }; }
    if (!Array.isArray(urls) || !String(p.categoria || '').trim() || !String(p.nombre || '').trim()) return { ok: false, error: 'Faltan parámetros' };
    _sbImagenesSet(String(p.categoria).trim(), String(p.nombre).trim(), urls);
    try { productoFotosSet(p); } catch (e) {}   // el manifest viejo queda igual que Supabase (respaldo)
    return { ok: true, fotos: urls };
  }
};

// ─── RANKING DE PRODUCTOS (más vendidos y con más interés, arriba) ────
// Puntaje = unidades vendidas (últimos 180 días) × 10 + carritos × 3 + favoritos × 2 + vistas × 1
// + unidades vendidas en Mercado Libre (productos.ventas_ml, se carga desde los Excels de ML).
// (interacciones de los últimos 60 días). Ordena "productos.orden" en Supabase: la tienda
// ya lista por ese orden, así que vale para "Todos" y para cada categoría.
// Pública pero inofensiva: solo recalcula, y como mucho una vez por hora.
var RANK_PESOS = { venta: 10, carrito: 3, favorito: 2, vista: 1, ml: 1 };
var RANK_DIAS_VENTAS = 180, RANK_DIAS_INTERES = 60;

function _rankFecha(s) {
  var d = (s instanceof Date) ? s : new Date(String(s || '').replace(' ', 'T'));
  return isNaN(d) ? null : d;
}
function _rankEsPrueba(o) {
  return /borrar|prueba|test\b|@test\./i.test([o.nombre, o.apellido, o.email, o.observaciones, o.cliente].join(' '));
}
// Unidades vendidas por nombre normalizado. Los nombres más largos se buscan primero,
// así "Silla X4 Azul" no suma también a "Silla".
function _rankVentas(pedidos, nombres, desde) {
  var orden = nombres.slice().sort(function(a, b) { return b.length - a.length; });
  var ventas = {};
  pedidos.forEach(function(o) {
    if (/cancel/i.test(String(o.estado || '')) || _rankEsPrueba(o)) return;
    var f = _rankFecha(o.timestamp || o.fecha);
    if (f && f < desde) return;
    var txt = ' ' + _normKey(o.productos || o.detalle || o.producto || '') + ' ';
    orden.forEach(function(n) {
      if (!n) return;
      var re = new RegExp(' (\\d{1,3})x ' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?= )', 'g');
      txt = txt.replace(re, function(_, q) { ventas[n] = (ventas[n] || 0) + Number(q); return ' '; });
    });
  });
  return ventas;
}
function _rankPuntajes(prods, ventas, interacciones) {
  var porNombre = {};
  prods.forEach(function(p) { var k = _normKey(p.nombre); (porNombre[k] = porNombre[k] || []).push(p); });
  var pts = {};
  prods.forEach(function(p) { pts[p.id] = (ventas[_normKey(p.nombre)] || 0) * RANK_PESOS.venta + (Number(p.ventas_ml) || 0) * RANK_PESOS.ml; });
  (interacciones || []).forEach(function(i) {
    var lista = porNombre[_normKey(i.nombre)];
    if (!lista) return;
    var p = lista.length > 1 ? (lista.filter(function(x) { return _normKey(x.categoria) === _normKey(i.categoria); })[0] || lista[0]) : lista[0];
    pts[p.id] += RANK_PESOS[i.tipo] || 0;
  });
  return pts;
}
// Nuevo orden: mayor puntaje primero; empates (y sin datos) mantienen el orden que tenían
function _rankOrden(prods, pts) {
  return prods.slice().sort(function(a, b) {
    return (pts[b.id] - pts[a.id]) || (Number(a.orden) - Number(b.orden)) || (a.id - b.id);
  });
}

function actualizarRanking(p) {
  var cache = CacheService.getScriptCache();
  if (cache.get('ranking_hecho')) return { ok: true, omitido: 'Ya se actualizó en la última hora' };
  if (!_productosEnSupabase() || !SB_KEY) return { ok: false, error: 'El ranking necesita los productos en Supabase' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, omitido: 'Ya se está actualizando' };
  try {
    var prods = [];
    for (var desde = 0; ; desde += 1000) {
      var pag = _sbR(_sb('get', 'productos?select=id,categoria,nombre,orden,ventas_ml&order=orden,id&offset=' + desde + '&limit=1000'), 'Productos');
      prods = prods.concat(pag);
      if (pag.length < 1000) break;
    }
    var ahora = Date.now();
    var nombres = prods.map(function(x) { return _normKey(x.nombre); });
    var ventas = _rankVentas(extPedidosListar({ todos: 1 }) || [], nombres, new Date(ahora - RANK_DIAS_VENTAS * 86400000));

    var interacciones = [], desdeI = new Date(ahora - RANK_DIAS_INTERES * 86400000).toISOString();
    for (var o = 0; o < 50000; o += 1000) {
      var r = _sb('get', 'interacciones?select=categoria,nombre,tipo&creado=gte.' + encodeURIComponent(desdeI) + '&order=id&offset=' + o + '&limit=1000');
      if (r.code !== 200 || !Array.isArray(r.json)) break;     // si la tabla todavía no existe, sigue solo con ventas
      interacciones = interacciones.concat(r.json);
      if (r.json.length < 1000) break;
    }
    var pts = _rankPuntajes(prods, ventas, interacciones);
    var nuevo = _rankOrden(prods, pts);
    var cambios = [];
    nuevo.forEach(function(x, i) { if (Number(x.orden) !== i) cambios.push({ id: x.id, categoria: x.categoria, nombre: x.nombre, orden: i }); });
    // Un PATCH por producto (el id es identidad: no se puede "upsertear"), de a 50 en paralelo
    var hdr = { apikey: SB_KEY, Prefer: 'return=minimal' };
    if (/^eyJ/.test(SB_KEY)) hdr.Authorization = 'Bearer ' + SB_KEY;
    for (var c = 0; c < cambios.length; c += 50) {
      var reqs = cambios.slice(c, c + 50).map(function(x) {
        return { url: SB_URL + '/rest/v1/productos?id=eq.' + x.id, method: 'patch', headers: hdr,
                 contentType: 'application/json', payload: JSON.stringify({ orden: x.orden }), muteHttpExceptions: true };
      });
      UrlFetchApp.fetchAll(reqs).forEach(function(r) {
        if (r.getResponseCode() >= 300) throw 'Orden (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200);
      });
    }
    // Interacciones viejas: ya no suman, se borran para que la tabla no crezca
    _sb('delete', 'interacciones?creado=lt.' + encodeURIComponent(new Date(ahora - 180 * 86400000).toISOString()), undefined, 'return=minimal');

    cache.put('ranking_hecho', '1', 3600);
    _catalogoInvalidar();
    var top = nuevo.filter(function(x) { return pts[x.id] > 0; }).slice(0, 10).map(function(x) { return x.nombre + ' (' + pts[x.id] + ')'; });
    return { ok: true, productos: prods.length, conPuntaje: nuevo.filter(function(x) { return pts[x.id] > 0; }).length,
             interacciones: interacciones.length, movidos: cambios.length, top: top };
  } finally { lock.releaseLock(); }
}

// Copia TODOS los productos de la planilla a Supabase. Ejecutar a mano desde el editor
// (elegir migrarProductosASupabase → Ejecutar). Se puede repetir: reemplaza lo que haya.
function migrarProductosASupabase() {
  // Una vez que los productos viven en Supabase, la planilla queda vieja: no se copia encima.
  if (_productosEnSupabase()) throw 'Los productos ya se editan en Supabase: no se vuelven a copiar desde la planilla.';
  // Supabase ya tiene productos (unificados, con SKU): copiar encima los borraría.
  var hay = _sb('get', 'productos?limit=1&select=id');
  if (hay.code === 200 && hay.json && hay.json.length) throw 'Supabase ya tiene los productos cargados: no se copia encima desde la planilla.';
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var cat = _catalogoArmar();                       // pestañas listadas en "Categorias"
    var permitidas = {}; cat.categorias.forEach(function(c, i) { permitidas[c] = i; });
    var filas = extProductosListar({}).filter(function(p) { return permitidas[p._sheet] !== undefined || permitidas[p.categoria] !== undefined; });

    // Fotos de la tienda (images-manifest.json público del sitio)
    var manifest = {};
    try { manifest = JSON.parse(UrlFetchApp.fetch('https://virtualshopbaires.com.ar/images-manifest.json', { muteHttpExceptions: true }).getContentText()); } catch(e) {}
    var fotosDe = function(categoria, nombre) {
      var ck = _buscarClave(manifest, categoria); if (!ck) return [];
      var k = _buscarClave(manifest[ck], nombre); if (!k) return [];
      var v = manifest[ck][k]; return (Array.isArray(v) ? v : [v]).filter(function(u) { return /^https?:/.test(String(u)); });
    };

    // 1) Categorías (con el orden de la pestaña Categorias)
    var cats = cat.categorias.map(function(c, i) { return { nombre: c, orden: i, visible: true }; });
    _sbOk(_sb('post', 'categorias?on_conflict=nombre', cats, 'resolution=merge-duplicates,return=minimal'), 'categorías');

    // 2) Agrupar filas en productos con variantes
    var grupos = {}, orden = [];
    filas.forEach(function(p) {
      var categoria = String(p.categoria || p._sheet).trim(), nombre = String(p.nombre).trim();
      var k = categoria + '|' + nombre;
      if (!grupos[k]) { grupos[k] = { categoria: categoria, nombre: nombre, filas: [] }; orden.push(k); }
      grupos[k].filas.push(p);
    });

    // 3) Empezar de cero (borra productos y, en cascada, sus variantes)
    _sbOk(_sb('delete', 'productos?id=gt.0', undefined, 'return=minimal'), 'borrar productos');

    // 4) Productos
    var ids = {}, cuerpo = orden.map(function(k, i) {
      var g = grupos[k], f0 = g.filas[0];
      return {
        categoria: g.categoria, nombre: g.nombre,
        descripcion: (g.filas.filter(function(x) { return x.descripcion; })[0] || {}).descripcion || '',
        subcategoria: f0.subcategoria || null,
        destacado: g.filas.some(function(x) { return x.destacado; }),
        imagenes: fotosDe(g.categoria, g.nombre), orden: i
      };
    });
    for (var i = 0; i < cuerpo.length; i += 200) {
      var res = _sbOk(_sb('post', 'productos?select=id,categoria,nombre', cuerpo.slice(i, i + 200), 'return=representation'), 'productos');
      res.forEach(function(r) { ids[r.categoria + '|' + r.nombre] = r.id; });
    }

    // 5) Variantes
    var vars = [];
    orden.forEach(function(k) {
      grupos[k].filas.forEach(function(f, j) {
        var precio = _numPrecio(f.precio) || 0, desc = _numPrecio(f.descuento);
        vars.push({
          producto_id: ids[k], color: String(f.color || f.marca || '').trim(), talle: String(f.talle || '').trim(),
          precio: precio, precio_descuento: (desc && desc > 0) ? desc : null, stock: !!f.stock,
          sku_costo: f.sku ? String(f.sku) : null, imagen_url: f.imagen || null, orden: j
        });
      });
    });
    for (var v = 0; v < vars.length; v += 300)
      _sbOk(_sb('post', 'variantes', vars.slice(v, v + 300), 'return=minimal'), 'variantes');

    var resumen = 'Listo: ' + cats.length + ' categorías, ' + orden.length + ' productos, ' + vars.length + ' variantes copiados a Supabase.';
    Logger.log(resumen);
    return resumen;
  } finally { lock.releaseLock(); }
}

function catalogoPublico() {
  if (_productosEnSupabase()) {   // mismo formato de siempre, armado desde Supabase
    var d = _sbLeerCatalogo();
    var cols = ['producto','precio','stock','color','talle/medida','descripcion','destacado','subcategoria','','','imagen_url','descuento'].map(function(l) { return { label: l }; });
    var hojas = {};
    d.categorias.forEach(function(c) { hojas[c] = { cols: cols, rows: [] }; });
    var cel = function(x) { return (x === null || x === undefined || x === '') ? null : { v: x }; };
    d.productos.forEach(function(p) {
      if (!hojas[p.categoria]) return;
      (p.variantes || []).sort(function(a, b) { return a.orden - b.orden; }).forEach(function(v) {
        hojas[p.categoria].rows.push({ c: [cel(p.nombre), cel(Number(v.precio)), { v: !!v.stock }, cel(v.color), cel(v.talle), cel(p.descripcion),
          { v: !!p.destacado }, cel(p.subcategoria), null, null, cel(v.imagen_url), cel(v.precio_descuento === null ? null : Number(v.precio_descuento))] });
      });
    });
    return { ok: true, generado: new Date().toISOString(), fuente: 'supabase', categorias: d.categorias, hojas: hojas };
  }
  var cache = CacheService.getScriptCache();
  try {
    var meta = cache.get('catalogo_meta');
    if (meta) {
      var n = parseInt(meta, 10), claves = [];
      for (var i = 0; i < n; i++) claves.push('catalogo_' + i);
      var partes = cache.getAll(claves);
      if (claves.every(function(k) { return partes[k] !== undefined && partes[k] !== null; }))
        return JSON.parse(claves.map(function(k) { return partes[k]; }).join(''));
    }
  } catch(e) {}
  var data = _catalogoArmar();
  try {
    var txt = JSON.stringify(data), TROZO = 90000, put = {}, cant = Math.ceil(txt.length / TROZO);
    for (var j = 0; j < cant; j++) put['catalogo_' + j] = txt.substr(j * TROZO, TROZO);
    cache.putAll(put, CATALOGO_CACHE_SEG);
    cache.put('catalogo_meta', String(cant), CATALOGO_CACHE_SEG);
  } catch(e) {}
  return data;
}

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

// ─── CUENTAS DE CLIENTES DE LA TIENDA (pestaña Usuarios) ─────
// El navegador manda SHA-256(clave+email); acá se guarda con sal: "s1$<sal>$<hash>".
// Los hashes viejos sin "s1$" siguen entrando y se convierten solos.
function _hojaUsuarios() {
  var spreadsheet = ss();
  var sh = spreadsheet.getSheetByName('Usuarios');
  if (!sh) {
    sh = spreadsheet.insertSheet('Usuarios');
    sh.appendRow(['Fecha registro', 'Email', 'Nombre', 'Hash contraseña']);
    sh.setFrozenRows(1);
  }
  return sh;
}
function _buscarUsuario(sh, email) {
  var datos = sh.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++)
    if (String(datos[i][1] || '').trim().toLowerCase() === email) return { fila: i + 1, datos: datos[i] };
  return null;
}
function tiendaRegistrar(p) {
  var email = String(p.email || '').trim().toLowerCase(), nombre = String(p.nombre || '').trim().slice(0, 80);
  var hash = String(p.hash || '').trim();
  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !hash) return { ok:false, error:'Nombre, email y contraseña requeridos' };
  var errReg = _antiabusoRegistro(p);
  if (errReg) return { ok:false, error: errReg };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = _hojaUsuarios();
    if (_buscarUsuario(sh, email)) return { ok:false, error:'email_taken' };
    sh.appendRow([Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy HH:mm'), email, nombre, _hashClave(hash)]);
    return { ok:true };
  } finally { lock.releaseLock(); }
}
function tiendaLogin(p) {
  var email = String(p.email || '').trim().toLowerCase(), hash = String(p.hash || '').trim();
  if (!email || !hash) return { ok:false, error:'Faltan datos' };
  if (String(p.website || '').trim()) return { ok:false, error:'No se pudo iniciar sesión.' };   // honeypot
  if (!_limite('login_tienda_' + email, 10, 900)) return { ok:false, error:'Demasiados intentos. Esperá 15 minutos.' };
  if (_bloqueado('login_tienda_' + email, 5)) return { ok:false, error: MSJ_BLOQUEO };
  var sh = _hojaUsuarios(), u = _buscarUsuario(sh, email);
  if (!u) return { ok:false, error:'Usuario no encontrado' };
  var v = _verificarClave(u.datos[3], hash);
  if (!v.ok) { _falloSumar('login_tienda_' + email, 900); return { ok:false, error:'Contraseña incorrecta' }; }
  _falloLimpiar('login_tienda_' + email);
  if (v.actualizar) sh.getRange(u.fila, 4).setValue(_hashClave(hash));
  return { ok:true, nombre: u.datos[2], email: u.datos[1] };
}
function tiendaCambiarClave(p) {
  var email = String(p.email || '').trim().toLowerCase();
  var viejo = String(p.oldHash || '').trim(), nuevo = String(p.newHash || '').trim();
  if (!email || !viejo || !nuevo) return { ok:false, error:'Faltan datos' };
  if (!_limite('cambio_tienda_' + email, 10, 900)) return { ok:false, error:'Demasiados intentos. Esperá 15 minutos.' };
  var sh = _hojaUsuarios(), u = _buscarUsuario(sh, email);
  if (!u) return { ok:false, error:'Usuario no encontrado' };
  if (_bloqueado('login_tienda_' + email, 5)) return { ok:false, error: MSJ_BLOQUEO };
  if (!_verificarClave(u.datos[3], viejo).ok) { _falloSumar('login_tienda_' + email, 900); return { ok:false, error:'Contraseña actual incorrecta' }; }
  _falloLimpiar('login_tienda_' + email);
  sh.getRange(u.fila, 4).setValue(_hashClave(nuevo));
  return { ok:true };
}

// ─── SEGUIMIENTO DE UN PEDIDO (order-status.html) ────────────
// Busca por número + email (los dos tienen que coincidir). No devuelve dirección ni DNI.
function _buscarPedidoWeb(numero, email) {
  var sh = ss().getSheetByName('Pedidos externos') || ss().getSheetByName('Pedidos Externos');
  if (!sh || sh.getLastRow() < 2) return null;
  var d = sh.getDataRange().getValues(), ix = _mapaPedidos(d[0]);
  if (ix.orderNumber === undefined || ix.email === undefined) return null;
  for (var r = 1; r < d.length; r++) {
    if (String(d[r][ix.orderNumber]) === numero && String(d[r][ix.email] || '').trim().toLowerCase() === email)
      return { sh: sh, fila: r + 1, d: d[r], ix: ix, headers: d[0] };
  }
  return null;
}
function tiendaPedido(p) {
  var numero = String(p.order || '').trim(), email = String(p.email || '').trim().toLowerCase();
  if (!numero || !email) return { ok:false, error:'Faltan parámetros' };
  if (!_limite('seguimiento_' + email, 30, 600)) return { ok:false, error:'Demasiadas consultas. Esperá unos minutos.' };
  var w = _buscarPedidoWeb(numero, email);
  if (w) {
    var c = function(k) { return w.ix[k] === undefined ? '' : w.d[w.ix[k]]; };
    var est = c('estado');
    var f = c('timestamp');
    return { ok:true, order: {
      numero: numero, fecha: (f instanceof Date) ? Utilities.formatDate(f, 'GMT-3', 'yyyy-MM-dd HH:mm') : f,
      nombre: c('nombre'), apellido: c('apellido'), email: email, metodoEntrega: c('metodoEntrega'),
      total: c('total'), estadoPago: _estadoPagoWeb(est, c('metodoPago')), estadoPedido: est,
      productos: [], urlComprobante: '', numeroSeguimiento: ''
    } };
  }
  var m = misPedidos({ email: email });   // pedidos de Mercado Pago (por referencia)
  var o = (m.orders || []).filter(function(x) { return String(x.numero) === numero; })[0];
  if (!o) return { ok:false, error:'Pedido no encontrado' };
  return { ok:true, order: { numero: o.numero, fecha: o.fecha, email: email, metodoEntrega: o.metodoEntrega, total: o.total,
    estadoPago: o.estadoPago, estadoPedido: o.estadoPedido, productos: [], urlComprobante: '', numeroSeguimiento: '' } };
}

// Comprobante de transferencia: se guarda PRIVADO en Drive (carpeta "VSB-Comprobantes")
// y el link queda en las observaciones del pedido para verlo desde el CRM.
function tiendaComprobante(p) {
  var numero = String(p.orderNumber || '').trim(), email = String(p.email || '').trim().toLowerCase();
  if (!numero || !email || !p.fileBase64) return { ok:false, error:'Faltan datos requeridos' };
  var datos = String(p.fileBase64).replace(/^data:[^;]+;base64,/, '');
  if (datos.length > 7000000) return { ok:false, error:'El archivo es muy grande (máx. 5 MB).' };
  var mime = String(p.fileMimeType || 'image/jpeg');
  if (!/^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(mime)) return { ok:false, error:'Subí una imagen o un PDF.' };
  if (!_limite('comprobante_' + email, 5, 3600)) return { ok:false, error:'Demasiados intentos. Esperá un rato.' };
  var w = _buscarPedidoWeb(numero, email);
  if (!w) return { ok:false, error:'Pedido no encontrado' };
  var carpetas = DriveApp.getFoldersByName('VSB-Comprobantes');
  var carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder('VSB-Comprobantes');
  var archivo = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(datos), mime, numero + '-comprobante'));
  var url = archivo.getUrl();
  if (w.ix.observaciones !== undefined) {
    var obs = String(w.d[w.ix.observaciones] || '');
    w.sh.getRange(w.fila, w.ix.observaciones + 1).setValue(('Comprobante: ' + url + (obs ? ' | ' + obs : '')).slice(0, 5000));
  }
  avisarTelegram('📎 Comprobante subido\nPedido ' + numero + '\n' + url);
  return { ok:true, message:'Comprobante recibido. Te avisaremos cuando confirmemos el pago.' };
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

  // Máx 10 claves equivocadas en 15 min EN TOTAL (no por prefijo: así no se puede adivinar
  // probando combinaciones). La clave correcta limpia el contador.
  var cache = CacheService.getScriptCache();
  if (_bloqueado('panel_login', 10)) return { ok:false, error:'Demasiados intentos fallidos. Esperá 15 minutos.' };

  if (String(p.clave || '') !== String(stored)) {
    _falloSumar('panel_login', 900);
    return { ok:false, error:'Contraseña incorrecta.' };
  }

  // Éxito: limpiar contador y emitir token
  _falloLimpiar('panel_login');
  var token = Utilities.getUuid();
  cache.put('panel_' + token, '1', 28800); // 8 horas
  var out = { ok:true, token: token };
  // A partir del 3er ingreso correcto en el mismo navegador, queda como dispositivo de confianza
  if (String(p.confiar || '') === '1') {
    try { out.dispositivo = _crearDispositivo(p.navegador); } catch (e) { _registrarError('dispositivo', e); }
  }
  return out;
}

// ─── DISPOSITIVOS DE CONFIANZA DEL PANEL ─────────────────────
// Un navegador de confianza guarda una llave larga y aleatoria (nunca la contraseña).
// En la pestaña "Dispositivos" solo queda el hash de la llave. Se invalida sola si cambia
// PANEL_PASS, si no se usa en DISP_DIAS días, o con "Salir" en ese navegador.
var DISP_DIAS = 60, DISP_MAX = 30;
function _hojaDispositivos() {
  var sh = ss().getSheetByName('Dispositivos');
  if (!sh) {
    sh = ss().insertSheet('Dispositivos');
    sh.appendRow(['Llave (hash)', 'Creado', 'Último uso', 'Clave (hash)', 'Navegador']);
    sh.setFrozenRows(1);
  }
  return sh;
}
function _claveHashPanel() {
  return _sha256('vsb-panel:' + (PropertiesService.getScriptProperties().getProperty('PANEL_PASS') || ''));
}
function _crearDispositivo(navegador) {
  var llave = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = _hojaDispositivos();
    sh.appendRow([_sha256(llave), new Date(), new Date(), _claveHashPanel(), String(navegador || '').slice(0, 120)]);
    var sobran = sh.getLastRow() - 1 - DISP_MAX;          // se borran los más viejos
    if (sobran > 0) sh.deleteRows(2, sobran);
  } finally { lock.releaseLock(); }
  return llave;
}
function _buscarDispositivo(llave) {
  if (!/^[a-f0-9]{64}$/.test(String(llave || ''))) return null;
  var h = _sha256(llave), sh = _hojaDispositivos(), datos = sh.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) if (String(datos[i][0]) === h) return { sh: sh, fila: i + 1, datos: datos[i] };
  return null;
}
function loginDispositivo(p) {
  if (!_limite('disp_global_' + Math.floor(Date.now() / 60000), 60, 120))
    return { ok:false, error:'Demasiados intentos. Probá de nuevo en un minuto.' };
  var d = _buscarDispositivo(p.dispositivo);
  if (!d) return { ok:false, error:'dispositivo' };
  var vencido = new Date(d.datos[2]).getTime() < Date.now() - DISP_DIAS * 86400000;
  if (vencido || String(d.datos[3]) !== _claveHashPanel()) {
    d.sh.deleteRow(d.fila);
    return { ok:false, error:'dispositivo' };
  }
  d.sh.getRange(d.fila, 3).setValue(new Date());
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('panel_' + token, '1', 28800);
  return { ok:true, token: token };
}
function olvidarDispositivo(p) {
  var d = _buscarDispositivo(p.dispositivo);
  if (d) d.sh.deleteRow(d.fila);
  return { ok:true };
}

function verifyPanel(p) {
  if (!p.token) return { ok:false };
  var val = CacheService.getScriptCache().get('panel_' + p.token);
  return { ok: val === '1' };
}
