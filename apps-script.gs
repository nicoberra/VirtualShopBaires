// ============================================================
// Virtual Shop Baires — Google Apps Script Backend
// Pegar en: script.google.com → nuevo proyecto
// ============================================================

const CONFIG = {
  ADMIN_EMAIL: 'virtualshopbaires@gmail.com',
  BANK_ALIAS: 'TU.ALIAS.AQUI',
  BANK_CBU: '0000000000000000000000',
  BANK_HOLDER: 'Nombre Apellido',
  BANK_BANK: 'Nombre del Banco',
  BANK_CUIT: '20-00000000-0',
  SITE_URL: 'https://virtualshopbaires.com.ar',
  DISCOUNT_PCT: 10,
  ORDER_PREFIX: 'VSB',
  ORDERS_SHEET: 'Pedidos',
  PROOF_FOLDER_NAME: 'VSB-Comprobantes',
};

// Columnas de la hoja (índice base 1 para Sheets, base 0 para arrays)
const COL = {
  FECHA: 1, HORA: 2, NUMERO: 3, NOMBRE: 4, APELLIDO: 5,
  EMAIL: 6, TELEFONO: 7, DNI: 8, PROVINCIA: 9, LOCALIDAD: 10,
  CP: 11, CALLE: 12, NUMERO_CALLE: 13, PISO: 14, METODO_ENTREGA: 15,
  PRODUCTOS: 16, SUBTOTAL: 17, DESCUENTO: 18, TOTAL: 19,
  METODO_PAGO: 20, ESTADO_PAGO: 21, ESTADO_PEDIDO: 22,
  URL_COMPROBANTE: 23, FECHA_TRANSFERENCIA: 24, FECHA_CONFIRMACION: 25,
  OBSERVACIONES: 26, NUMERO_SEGUIMIENTO: 27, NOTAS_ADMIN: 28,
};

// Estados válidos que el FRONTEND puede establecer (nunca PAGO CONFIRMADO)
const ESTADOS_PAGO_FRONTEND = [
  'PENDIENTE DE PAGO',
  'TRANSFERENCIA INFORMADA',
  'PENDIENTE DE VERIFICACIÓN',
];

// ============================================================
// PUNTO DE ENTRADA HTTP
// ============================================================

function doGet(e) {
  try {
    const action = e.parameter.action || '';
    if (action === 'getOrder') return jsonResponse(getOrder(e.parameter));
    if (action === 'getMyOrders') return jsonResponse(getMyOrders(e.parameter));
    if (action === 'subscribe')    return jsonResponse(subscribe(e.parameter));
    if (action === 'registerUser')  return jsonResponse(registerUser(e.parameter));
    if (action === 'loginUser')     return jsonResponse(loginUser(e.parameter));
    if (action === 'changePassword') return jsonResponse(changePassword(e.parameter));
    return jsonResponse({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    if (action === 'createOrder') return jsonResponse(createOrder(body));
    if (action === 'uploadProof') return jsonResponse(uploadProof(body));

    return jsonResponse({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// CREAR PEDIDO
// ============================================================

function createOrder(body) {
  // Validar campos requeridos
  const required = ['nombre', 'apellido', 'email', 'telefono', 'dni',
                    'metodoEntrega', 'productos', 'subtotal', 'total'];
  for (const f of required) {
    if (!body[f]) return { ok: false, error: `Campo requerido: ${f}` };
  }

  // Si el método de entrega es envío, validar dirección
  if (body.metodoEntrega === 'envio') {
    const reqAddr = ['provincia', 'localidad', 'cp', 'calle', 'numeroCalle'];
    for (const f of reqAddr) {
      if (!body[f]) return { ok: false, error: `Campo de dirección requerido: ${f}` };
    }
  }

  const sheet = getOrdersSheet();
  const orderNumber = generateOrderNumber(sheet);
  const now = new Date();

  const row = new Array(28).fill('');
  row[COL.FECHA - 1]           = Utilities.formatDate(now, 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy');
  row[COL.HORA - 1]            = Utilities.formatDate(now, 'America/Argentina/Buenos_Aires', 'HH:mm:ss');
  row[COL.NUMERO - 1]          = orderNumber;
  row[COL.NOMBRE - 1]          = body.nombre;
  row[COL.APELLIDO - 1]        = body.apellido;
  row[COL.EMAIL - 1]           = body.email;
  row[COL.TELEFONO - 1]        = body.telefono;
  row[COL.DNI - 1]             = body.dni;
  row[COL.PROVINCIA - 1]       = body.provincia || '';
  row[COL.LOCALIDAD - 1]       = body.localidad || '';
  row[COL.CP - 1]              = body.cp || '';
  row[COL.CALLE - 1]           = body.calle || '';
  row[COL.NUMERO_CALLE - 1]    = body.numeroCalle || '';
  row[COL.PISO - 1]            = body.piso || '';
  row[COL.METODO_ENTREGA - 1]  = body.metodoEntrega;
  row[COL.PRODUCTOS - 1]       = JSON.stringify(body.productos);
  row[COL.SUBTOTAL - 1]        = body.subtotal;
  row[COL.DESCUENTO - 1]       = body.descuento || 0;
  row[COL.TOTAL - 1]           = body.total;
  row[COL.METODO_PAGO - 1]     = 'Transferencia bancaria';
  row[COL.ESTADO_PAGO - 1]     = 'PENDIENTE DE PAGO';
  row[COL.ESTADO_PEDIDO - 1]   = 'PEDIDO CREADO';
  row[COL.OBSERVACIONES - 1]   = body.observaciones || '';

  sheet.appendRow(row);
  addProductLinks(sheet, sheet.getLastRow(), body.productos);

  sendOrderCreatedEmailToCustomer(body, orderNumber, body.total);
  sendOrderCreatedEmailToAdmin(body, orderNumber, body.total);

  return {
    ok: true,
    orderNumber,
    bankData: {
      alias: CONFIG.BANK_ALIAS,
      cbu: CONFIG.BANK_CBU,
      titular: CONFIG.BANK_HOLDER,
      banco: CONFIG.BANK_BANK,
      cuit: CONFIG.BANK_CUIT,
    },
    total: body.total,
  };
}

// ============================================================
// SUBIR COMPROBANTE
// ============================================================

function uploadProof(body) {
  if (!body.orderNumber || !body.email || !body.fileBase64) {
    return { ok: false, error: 'Faltan datos requeridos' };
  }

  const sheet = getOrdersSheet();
  const rowIndex = findOrderRow(sheet, body.orderNumber, body.email);
  if (!rowIndex) return { ok: false, error: 'Pedido no encontrado' };

  // Verificar que el estado actual NO sea administrativo
  const currentPayStatus = sheet.getRange(rowIndex, COL.ESTADO_PAGO).getValue();
  if (currentPayStatus === 'PAGO CONFIRMADO') {
    return { ok: false, error: 'Este pedido ya fue confirmado' };
  }

  // Guardar archivo en Google Drive
  const folder = getProofFolder();
  const base64Data = body.fileBase64.replace(/^data:[^;]+;base64,/, '');
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64Data),
    body.fileMimeType || 'application/octet-stream',
    `${body.orderNumber}-comprobante`
  );
  const file = folder.createFile(blob);
  const fileUrl = file.getUrl();

  // Actualizar fila: estado + URL comprobante + fecha
  const now = new Date();
  const fechaStr = Utilities.formatDate(now, 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
  sheet.getRange(rowIndex, COL.ESTADO_PAGO).setValue('TRANSFERENCIA INFORMADA');
  sheet.getRange(rowIndex, COL.ESTADO_PEDIDO).setValue('ESPERANDO PAGO');
  sheet.getRange(rowIndex, COL.URL_COMPROBANTE).setValue(fileUrl);
  sheet.getRange(rowIndex, COL.FECHA_TRANSFERENCIA).setValue(fechaStr);

  // Notificar al admin
  sendProofUploadedEmailToAdmin(body.orderNumber, body.email, fileUrl);

  return { ok: true, message: 'Comprobante recibido. Te avisaremos cuando confirmemos el pago.' };
}

// ============================================================
// CONSULTAR PEDIDO
// ============================================================

function getOrder(params) {
  if (!params.order || !params.email) {
    return { ok: false, error: 'Faltan parámetros' };
  }

  const sheet = getOrdersSheet();
  const rowIndex = findOrderRow(sheet, params.order, params.email);
  if (!rowIndex) return { ok: false, error: 'Pedido no encontrado' };

  const data = sheet.getRange(rowIndex, 1, 1, 28).getValues()[0];

  return {
    ok: true,
    order: {
      numero:          data[COL.NUMERO - 1],
      fecha:           data[COL.FECHA - 1],
      nombre:          data[COL.NOMBRE - 1],
      apellido:        data[COL.APELLIDO - 1],
      email:           data[COL.EMAIL - 1],
      metodoEntrega:   data[COL.METODO_ENTREGA - 1],
      total:           data[COL.TOTAL - 1],
      estadoPago:      data[COL.ESTADO_PAGO - 1],
      estadoPedido:    data[COL.ESTADO_PEDIDO - 1],
      urlComprobante:  data[COL.URL_COMPROBANTE - 1],
      numeroSeguimiento: data[COL.NUMERO_SEGUIMIENTO - 1],
      productos:       (() => { try { return JSON.parse(data[COL.PRODUCTOS - 1]); } catch(e) { return []; } })(),
    },
  };
}

// ============================================================
// TRIGGER onEdit — solo el admin puede confirmar pagos
// ============================================================

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== CONFIG.ORDERS_SHEET) return;

  const col = e.range.getColumn();
  const row = e.range.getRow();
  if (row < 2) return; // encabezado

  // Si el admin cambió la columna ESTADO_PAGO a PAGO CONFIRMADO
  if (col === COL.ESTADO_PAGO && e.value === 'PAGO CONFIRMADO') {
    const data = sheet.getRange(row, 1, 1, 28).getValues()[0];
    const email   = data[COL.EMAIL - 1];
    const nombre  = data[COL.NOMBRE - 1];
    const numero  = data[COL.NUMERO - 1];
    const total   = data[COL.TOTAL - 1];

    // Registrar fecha de confirmación
    const fechaStr = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
    sheet.getRange(row, COL.FECHA_CONFIRMACION).setValue(fechaStr);
    sheet.getRange(row, COL.ESTADO_PEDIDO).setValue('PREPARANDO PEDIDO');

    sendPaymentConfirmedEmailToCustomer(email, nombre, numero, total);
  }
}

// ============================================================
// EMAILS
// ============================================================

function sendOrderCreatedEmailToCustomer(body, orderNumber, total) {
  const subject = `Tu pedido ${orderNumber} fue recibido — Virtual Shop Baires`;
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#CC1212">¡Tu pedido fue recibido!</h2>
      <p>Hola <strong>${body.nombre}</strong>, gracias por tu compra.</p>
      <p><strong>N° de pedido:</strong> ${orderNumber}</p>
      <p><strong>Total a transferir:</strong> $${Number(total).toLocaleString('es-AR')}</p>
      <hr>
      <h3>Datos bancarios para transferir</h3>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px;font-weight:bold">Alias</td><td style="padding:6px">${CONFIG.BANK_ALIAS}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">CBU</td><td style="padding:6px">${CONFIG.BANK_CBU}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Titular</td><td style="padding:6px">${CONFIG.BANK_HOLDER}</td></tr>
        <tr style="background:#f5f5f5"><td style="padding:6px;font-weight:bold">Banco</td><td style="padding:6px">${CONFIG.BANK_BANK}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">CUIT</td><td style="padding:6px">${CONFIG.BANK_CUIT}</td></tr>
      </table>
      <p style="margin-top:20px">Una vez realizada la transferencia, subí el comprobante en:</p>
      <p><a href="${CONFIG.SITE_URL}/order-status.html" style="color:#CC1212">${CONFIG.SITE_URL}/order-status.html</a></p>
      <p>Usá tu N° de pedido <strong>${orderNumber}</strong> y tu email <strong>${body.email}</strong>.</p>
      <hr>
      <p style="color:#888;font-size:12px">Virtual Shop Baires · ${CONFIG.SITE_URL}</p>
    </div>`;
  GmailApp.sendEmail(body.email, subject, '', { htmlBody, name: 'Virtual Shop Baires' });
}

function sendOrderCreatedEmailToAdmin(body, orderNumber, total) {
  const subject = `[VSB] Nuevo pedido: ${orderNumber}`;
  const text = `Nuevo pedido recibido.\n\nN°: ${orderNumber}\nCliente: ${body.nombre} ${body.apellido}\nEmail: ${body.email}\nTeléfono: ${body.telefono}\nTotal: $${total}\nEntrega: ${body.metodoEntrega}\n\nVer en Google Sheets.`;
  GmailApp.sendEmail(CONFIG.ADMIN_EMAIL, subject, text, { name: 'Virtual Shop Baires' });
}

function sendProofUploadedEmailToAdmin(orderNumber, customerEmail, fileUrl) {
  const subject = `[VSB] Comprobante subido: ${orderNumber}`;
  const text = `El cliente (${customerEmail}) subió un comprobante para el pedido ${orderNumber}.\n\nComprobante: ${fileUrl}\n\nVerificá la transferencia y confirmá en Google Sheets cambiando el estado de pago a PAGO CONFIRMADO.`;
  GmailApp.sendEmail(CONFIG.ADMIN_EMAIL, subject, text, { name: 'Virtual Shop Baires' });
}

function sendPaymentConfirmedEmailToCustomer(email, nombre, orderNumber, total) {
  const subject = `¡Pago confirmado! Pedido ${orderNumber} — Virtual Shop Baires`;
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#25a244">¡Tu pago fue confirmado!</h2>
      <p>Hola <strong>${nombre}</strong>, recibimos y verificamos tu transferencia.</p>
      <p><strong>Pedido N°:</strong> ${orderNumber}</p>
      <p><strong>Total:</strong> $${Number(total).toLocaleString('es-AR')}</p>
      <p>Tu pedido está siendo preparado. Te avisaremos cuando sea despachado.</p>
      <p>Podés hacer seguimiento en: <a href="${CONFIG.SITE_URL}/order-status.html" style="color:#CC1212">${CONFIG.SITE_URL}/order-status.html</a></p>
      <hr>
      <p style="color:#888;font-size:12px">Virtual Shop Baires · ${CONFIG.SITE_URL}</p>
    </div>`;
  GmailApp.sendEmail(email, subject, '', { htmlBody, name: 'Virtual Shop Baires' });
}

// ============================================================
// HELPERS
// ============================================================

function getOrdersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.ORDERS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ORDERS_SHEET);
    const headers = [
      'Fecha','Hora','N° Pedido','Nombre','Apellido','Email','Teléfono','DNI/CUIT',
      'Provincia','Localidad','CP','Calle','Número','Piso/Dpto','Método entrega',
      'Productos','Subtotal','Descuento','Total','Método pago','Estado pago',
      'Estado pedido','URL Comprobante','Fecha transferencia informada',
      'Fecha confirmación','Observaciones','N° seguimiento','Notas admin',
    ];
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 28).setFontWeight('bold').setBackground('#1B2B4B').setFontColor('#ffffff');
  }
  return sheet;
}

function generateOrderNumber(sheet) {
  const today = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyyMMdd');
  const prefix = `${CONFIG.ORDER_PREFIX}-${today}-`;
  const lastRow = sheet.getLastRow();
  let maxSeq = 0;
  if (lastRow > 1) {
    const numbers = sheet.getRange(2, COL.NUMERO, lastRow - 1, 1).getValues();
    for (const [num] of numbers) {
      if (String(num).startsWith(prefix)) {
        const seq = parseInt(String(num).slice(prefix.length), 10) || 0;
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

function findOrderRow(sheet, orderNumber, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const data = sheet.getRange(2, 1, lastRow - 1, 28).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][COL.NUMERO - 1] === orderNumber &&
        data[i][COL.EMAIL - 1].toLowerCase() === email.toLowerCase()) {
      return i + 2; // +2 porque la fila 1 es encabezado y los arrays son base 0
    }
  }
  return null;
}

function getMyOrders(params) {
  const email = (params.email || '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'Email requerido' };

  const sheet = getOrdersSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, orders: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 28).getValues();
  const orders = [];
  for (const row of data) {
    if ((row[COL.EMAIL - 1] || '').toLowerCase() !== email) continue;
    orders.push({
      numero:       row[COL.NUMERO - 1],
      fecha:        row[COL.FECHA - 1],
      nombre:       row[COL.NOMBRE - 1],
      apellido:     row[COL.APELLIDO - 1],
      productos:    row[COL.PRODUCTOS - 1],
      total:        row[COL.TOTAL - 1],
      estadoPago:   row[COL.ESTADO_PAGO - 1],
      estadoPedido: row[COL.ESTADO_PEDIDO - 1],
      metodoPago:   row[COL.METODO_PAGO - 1],
      metodoEntrega:row[COL.METODO_ENTREGA - 1],
    });
  }
  orders.sort((a, b) => (b.fecha > a.fecha ? 1 : -1));
  return { ok: true, orders };
}

// ============================================================
// USUARIOS
// ============================================================

function registerUser(params) {
  const email  = (params.email  || '').toLowerCase().trim();
  const nombre = (params.nombre || '').trim();
  const hash   = (params.hash   || '').trim();
  if (!nombre || !email) return { ok: false, error: 'Nombre y email requeridos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      if ((data[i][0] || '').toLowerCase() === email) {
        return { ok: false, error: 'email_taken' };
      }
    }
  }

  const fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
  sheet.appendRow([fecha, email, nombre, hash]);
  return { ok: true };
}

function loginUser(params) {
  const email = (params.email || '').toLowerCase().trim();
  const hash  = (params.hash  || '').trim();
  if (!email || !hash) return { ok: false, error: 'Faltan datos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Usuario no encontrado' };

  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      const storedHash = data[i][2] || '';
      if (storedHash === hash) return { ok: true, nombre: data[i][1], email: data[i][0] };
      return { ok: false, error: 'Contraseña incorrecta' };
    }
  }
  return { ok: false, error: 'Usuario no encontrado' };
}

function changePassword(params) {
  const email    = (params.email    || '').toLowerCase().trim();
  const oldHash  = (params.oldHash  || '').trim();
  const newHash  = (params.newHash  || '').trim();
  if (!email || !oldHash || !newHash) return { ok: false, error: 'Faltan datos' };

  const sheet = getUsuariosSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'Usuario no encontrado' };

  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues();
  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email) {
      if ((data[i][2] || '') !== oldHash) return { ok: false, error: 'Contraseña actual incorrecta' };
      sheet.getRange(i + 2, 4).setValue(newHash);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Usuario no encontrado' };
}

function getUsuariosSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Usuarios');
  if (!sheet) {
    sheet = ss.insertSheet('Usuarios');
    sheet.appendRow(['Fecha registro', 'Email', 'Nombre', 'Hash contraseña']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1B2B4B').setFontColor('#ffffff');
  }
  return sheet;
}

// ============================================================
// SUSCRIPTORES
// ============================================================

function subscribe(params) {
  const email = (params.email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Email inválido' };
  }

  const sheet = getSuscriptoresSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const emails = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (const [e] of emails) {
      if ((e || '').toLowerCase() === email) return { ok: true, already: true };
    }
  }

  const fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm');
  sheet.appendRow([fecha, email, params.nombre || '', 'Web']);
  return { ok: true };
}

function getSuscriptoresSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Suscriptores');
  if (!sheet) {
    sheet = ss.insertSheet('Suscriptores');
    sheet.appendRow(['Fecha', 'Email', 'Nombre', 'Fuente']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1B2B4B').setFontColor('#ffffff');
  }
  return sheet;
}

function addProductLinks(sheet, rowIndex, productos) {
  const products = Array.isArray(productos) ? productos : [];
  if (!products.length) return;

  // Agrega encabezado en col 29 si no existe
  if (!sheet.getRange(1, 29).getValue()) {
    sheet.getRange(1, 29)
      .setValue('Links productos')
      .setFontWeight('bold')
      .setBackground('#1B2B4B')
      .setFontColor('#ffffff');
  }

  let fullText = '';
  const links = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const name = String(p.nombre || '');
    const qty  = p.qty || 1;
    const prec = Number(p.precio || 0) * qty;
    const line = `${name} x${qty}  —  $${prec.toLocaleString('es-AR')}`;
    const url  = p.id ? `${CONFIG.SITE_URL}/productos.html?id=${p.id}` : `${CONFIG.SITE_URL}/productos.html?q=${encodeURIComponent(name)}`;
    links.push({ start: fullText.length, end: fullText.length + name.length, url });
    fullText += line;
    if (i < products.length - 1) fullText += '\n';
  }

  const builder = SpreadsheetApp.newRichTextValue().setText(fullText);
  for (const lk of links) {
    builder.setLinkUrl(lk.start, lk.end, lk.url);
  }
  const cell = sheet.getRange(rowIndex, 29);
  cell.setRichTextValue(builder.build());
  cell.setWrap(true);
}

function getProofFolder() {
  const folders = DriveApp.getFoldersByName(CONFIG.PROOF_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(CONFIG.PROOF_FOLDER_NAME);
}
