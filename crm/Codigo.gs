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

// Para fotos de productos (GitHub repo de la tienda)
// Creá un token en: github.com/settings/tokens → Fine-grained → Contents: Read and write
var GH_TOKEN  = '';   // ← PEGAR TU TOKEN AQUÍ
var GH_REPO   = 'nicoberra/VirtualShopBaires';
var GH_BRANCH = 'main';

// Para comprobantes de pago (carpeta de Google Drive)
// Creá una carpeta en Drive → copiá el ID de la URL
var COMPROB_FOLDER_ID = '';   // ← PEGAR ID DE CARPETA DRIVE AQUÍ (opcional)

// Mercado Pago Checkout Pro
// Obtené el Access Token en: mercadopago.com.ar/developers → Tu aplicación → Credenciales
var MP_ACCESS_TOKEN = '';     // ← APP_USR-... de PRODUCCIÓN

// Avisos por Telegram cuando entra un pedido (opcional)
var TG_TOKEN = '';
var TG_CHAT  = '';
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
  var out;
  try {
    var accion = p.action || 'list';
    var tab    = p.tab    || 'Clientes';
    if (['list','add','update','delete'].indexOf(accion) >= 0 && !TABS[tab])
      throw 'Pestaña inválida: ' + tab;

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
    else if (accion === 'evento_add')      out = { ok:true, saved: eventoAgregar(p) };
    else if (accion === 'eventos_stats')   out = { ok:true, stats: eventosStats() };
    else if (accion === 'abandonos_list')  out = { ok:true, rows: abandonosList() };
    else if (accion === 'fotos_list')      out = { ok:true, fotos: fotosListar(p) };
    else if (accion === 'foto_subir')      out = { ok:true, foto:    fotoSubir(p) };
    else if (accion === 'foto_borrar')     out = { ok:true, borrada: fotoBorrar(p) };
    else if (accion === 'fotos_orden')     out = { ok:true, ordenado: fotosOrdenar(p) };
    else if (accion === 'comprobante_subir') out = { ok:true, url: comprobanteSubir(p) };
    else if (accion === 'mp_preferencia')  out = crearPreferencia(p);
    else if (accion === 'version')         out = { ok:true, version: 'v2' };
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

// Devuelve la pestaña Eventos (misma planilla)
var EVENTOS_COLS = ['Fecha','Tipo','Item','Sesión','Fuente','Contacto','Monto',
  'País','Región','Ciudad','Dispositivo','SO','Navegador','Idioma','Pantalla'];

function hojaEventos() {
  var spreadsheet = ss();
  var sh = spreadsheet.getSheetByName('Eventos');
  if (!sh) {
    sh = spreadsheet.insertSheet('Eventos');
    sh.appendRow(EVENTOS_COLS);
    sh.getRange(1,1,1,EVENTOS_COLS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < EVENTOS_COLS.length) {
    sh.getRange(1,1,1,EVENTOS_COLS.length).setValues([EVENTOS_COLS]).setFontWeight('bold');
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

// ─── ESTADÍSTICAS (pestaña Eventos) ──────────────────────────

function eventoAgregar(p) {
  var tipo = String(p.tipo||'').trim();
  if (!tipo) return false;
  hojaEventos().appendRow([
    new Date(),
    tipo,
    String(p.item||'').slice(0,500),
    String(p.sesion||''),
    String(p.fuente||''),
    String(p.contacto||''),
    parseInt(String(p.monto||'').replace(/[^\d]/g,''),10) || '',
    String(p.pais||''),
    String(p.region||''),
    String(p.ciudad||''),
    String(p.disp||''),
    String(p.so||''),
    String(p.nav||''),
    String(p.idioma||''),
    String(p.pantalla||'')
  ]);
  return true;
}

function _iniDia(d) { var x=new Date(d); x.setHours(0,0,0,0); return x; }
function _iniSemana(d) { var x=_iniDia(d); var wd=(x.getDay()+6)%7; x.setDate(x.getDate()-wd); return x; }

function eventosStats() {
  var sh = hojaEventos();
  var datos = sh.getDataRange().getValues();
  var ahora = new Date();
  var iniHoy = _iniDia(ahora);
  var iniSem = _iniSemana(ahora);
  var iniMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  var vis = { hoy:0, semana:0, mes:0, total:0 };
  var fuentes={}, prod={}, cat={}, paises={}, regiones={}, ciudades={};
  var dispositivos={}, sistemas={}, navegadores={}, idiomas={};
  var carrito=0, abandonos=0, compras=0;

  var suma = function(o,v) { v=String(v||'').trim(); if(v) o[v]=(o[v]||0)+1; };
  var vVis={}, vProd={}, vCat={}, vCar={};
  var ya = function(r,k) { if(r[k]) return true; r[k]=1; return false; };

  // Últimos 14 días
  var porDia = {};
  for (var k=0; k<14; k++) {
    var dd = _iniDia(ahora); dd.setDate(dd.getDate()-k);
    porDia[Utilities.formatDate(dd,'GMT-3','yyyy-MM-dd')] = 0;
  }

  for (var i = 1; i < datos.length; i++) {
    var f = datos[i][0];
    if (!(f instanceof Date)) f = new Date(f);
    if (isNaN(f)) continue;
    var tipo = String(datos[i][1]||'').trim();
    var item = String(datos[i][2]||'').trim();
    var fuente = String(datos[i][4]||'').trim() || 'directo';
    var ses = String(datos[i][3]||'').trim() || ('fila'+i);
    var dia = Utilities.formatDate(f,'GMT-3','yyyy-MM-dd');

    if (tipo === 'visita') {
      if (ya(vVis, ses+'|'+dia)) continue;
      vis.total++;
      if (f >= iniHoy) vis.hoy++;
      if (f >= iniSem) vis.semana++;
      if (f >= iniMes) vis.mes++;
      fuentes[fuente] = (fuentes[fuente]||0) + 1;
      suma(paises,      datos[i][7]);
      suma(regiones,    datos[i][8]);
      suma(ciudades,    datos[i][9]);
      suma(dispositivos,datos[i][10]);
      suma(sistemas,    datos[i][11]);
      suma(navegadores, datos[i][12]);
      suma(idiomas,     datos[i][13]);
      if (porDia[dia] !== undefined) porDia[dia]++;

    } else if (tipo === 'producto' && item) {
      if (!ya(vProd, ses+'|'+item+'|'+dia)) prod[item] = (prod[item]||0)+1;
    } else if (tipo === 'categoria' && item) {
      if (!ya(vCat, ses+'|'+item+'|'+dia)) cat[item] = (cat[item]||0)+1;
    } else if (tipo === 'carrito') {
      if (!ya(vCar, ses+'|'+dia)) carrito++;
    } else if (tipo === 'abandono') {
      abandonos++;
    } else if (tipo === 'compra') {
      compras++;
    }
  }

  var top = function(o, n) {
    return Object.keys(o).map(function(k){ return { nombre:k, n:o[k] }; })
      .sort(function(a,b){ return b.n-a.n; }).slice(0, n||10);
  };

  return {
    visitas:      vis,
    porDia:       Object.keys(porDia).sort().map(function(k){ return { d:k, n:porDia[k] }; }),
    fuentes:      top(fuentes,8),
    topProductos: top(prod,10),
    topCategorias:top(cat,12),
    paises:       top(paises,15),
    regiones:     top(regiones,15),
    ciudades:     top(ciudades,20),
    dispositivos: top(dispositivos,5),
    sistemas:     top(sistemas,8),
    navegadores:  top(navegadores,8),
    idiomas:      top(idiomas,10),
    carrito, abandonos, compras
  };
}

function abandonosList() {
  var sh = hojaEventos();
  var datos = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][1]||'').trim() !== 'abandono') continue;
    var f = datos[i][0];
    out.push({
      fecha:    (f instanceof Date) ? Utilities.formatDate(f,'GMT-3','yyyy-MM-dd HH:mm') : String(f),
      item:     String(datos[i][2]||''),
      contacto: String(datos[i][5]||''),
      monto:    datos[i][6]
    });
  }
  return out.reverse().slice(0,100);
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
