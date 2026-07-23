// ============================================================
//  APPS SCRIPT — Virtual Shop Baires
//
//  FUNCIONES:
//  1. doGet()           → devuelve mapa de imágenes desde Drive (imagen manifest)
//  2. doPost()          → recibe pedidos del Worker y los agrega a Google Sheets
//  3. syncPricesToSupabase() → sincroniza precios del Sheet al Worker/Supabase
//
//  ESTRUCTURA DEL DRIVE:
//  📁 Carpeta raíz (FOLDER_ID)
//    📁 Mascotas
//      📁 Arnes para perros   ← mismo nombre que columna A del Sheet
//          🖼️ 1.jpg           ← numeradas: 1, 2, 3...
//      🖼️ Cama.jpg            ← imagen directa si tiene una sola foto
//
//  PARA ACTUALIZAR: Implementar → Administrar → lápiz → Nueva versión → Implementar
// ============================================================

const FOLDER_ID      = "1xBYFnxDn-uTjoyFGc0thzOF_WS16jUz5";
const SHEET_ID       = "1joofIvXtRnU0LcCs320MVIhy44HpaJZ1DqwQ7d2pBTw";
const WORKER_API     = "https://virtualshopbaires.com.ar/api";
const ADMIN_TOKEN    = PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN") || "";
// Configurar en el script: Proyecto → Configuración del proyecto → Propiedades del script
// Clave: ADMIN_TOKEN  Valor: (mismo token que en el Worker)

// ============================================================
//  1. doGet — mapa de imágenes (ya existía)
// ============================================================

function getImgUrl(file) {
  return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w800";
}

function doGet() {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const result = {};

    const catFolders = folder.getFolders();
    while (catFolders.hasNext()) {
      const catFolder = catFolders.next();
      const catName   = catFolder.getName().trim();
      result[catName] = {};

      const directFiles = catFolder.getFiles();
      while (directFiles.hasNext()) {
        const file     = directFiles.next();
        const fileName = file.getName().replace(/\.[^/.]+$/, "").trim();
        result[catName][fileName] = getImgUrl(file);
      }

      const productFolders = catFolder.getFolders();
      while (productFolders.hasNext()) {
        const productFolder = productFolders.next();
        const productName   = productFolder.getName().trim();

        const filesArr = [];
        const varFiles = productFolder.getFiles();
        while (varFiles.hasNext()) {
          const f = varFiles.next();
          filesArr.push({ name: f.getName(), url: getImgUrl(f) });
        }

        filesArr.sort((a, b) => {
          const na = parseInt(a.name) || 0;
          const nb = parseInt(b.name) || 0;
          return na !== nb ? na - nb : a.name.localeCompare(b.name);
        });

        if (filesArr.length === 1) {
          result[catName][productName] = filesArr[0].url;
        } else if (filesArr.length > 1) {
          result[catName][productName] = filesArr.map(f => f.url);
        }
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
//  2. doPost — recibe pedidos desde el Worker y los registra
//  El Worker llama a este endpoint automáticamente al crear
//  un pedido o cambiar su estado.
// ============================================================

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "newOrder";

    if (action === "newOrder") {
      appendOrderToSheet(body.order);
    } else if (action === "paymentConfirmed") {
      updateOrderStatus(body.order.order_number, "Pago confirmado", body.order.confirmed_at);
    } else if (action === "paymentRejected") {
      updateOrderStatus(body.order.order_number, "Comprobante rechazado", null);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function appendOrderToSheet(order) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  let sheet   = ss.getSheetByName("Pedidos");

  // Crear la pestaña si no existe
  if (!sheet) {
    sheet = ss.insertSheet("Pedidos");
    const headers = [
      "Número", "Fecha", "Cliente", "Email", "Teléfono", "Dirección",
      "Productos", "Subtotal", "Descuento", "Total", "Estado pago", "Estado pedido",
      "Vence", "Notas del cliente"
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText = items.map(i =>
    `${i.nombre}${i.color ? " (" + i.color : ""}${i.talle ? "/" + i.talle : ""}${(i.color || i.talle) ? ")" : ""} x${i.qty} = $${(i.subtotal || i.precio_unit * i.qty).toLocaleString("es-AR")}`
  ).join("\n");

  const row = [
    order.order_number || "",
    order.created_at ? new Date(order.created_at).toLocaleString("es-AR") : new Date().toLocaleString("es-AR"),
    order.customer_name || "",
    order.customer_email || "",
    order.customer_phone || "",
    order.customer_address || "",
    itemsText,
    order.subtotal || 0,
    order.discount_amount || 0,
    order.total || 0,
    "Esperando transferencia",
    "Pend. pago",
    order.expires_at ? new Date(order.expires_at).toLocaleString("es-AR") : "",
    order.customer_notes || "",
  ];

  sheet.appendRow(row);
}

function updateOrderStatus(orderNumber, paymentStatus, confirmedAt) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("Pedidos");
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderNumber) {
      sheet.getRange(i + 1, 11).setValue(paymentStatus);
      if (confirmedAt) {
        sheet.getRange(i + 1, 12).setValue("Preparando pedido");
      }
      break;
    }
  }
}

// ============================================================
//  3. syncPricesToSupabase — llamar manualmente desde el editor
//  Lee los precios del Sheet y los sincroniza al Worker (que
//  los guarda en Supabase products_cache).
// ============================================================

function syncPricesToSupabase() {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const catSheet = ss.getSheetByName("Categorias");
  if (!catSheet) { Logger.log("No se encontró la pestaña 'Categorias'"); return; }

  const catRows = catSheet.getDataRange().getValues().slice(1).map(r => String(r[0]).trim()).filter(Boolean);
  const products = [];

  for (const categoria of catRows) {
    const hoja = ss.getSheetByName(categoria);
    if (!hoja) continue;

    const rows = hoja.getDataRange().getValues().slice(1); // saltar encabezado
    for (const row of rows) {
      const nombre = String(row[0] || "").trim();
      if (!nombre || nombre.toLowerCase() === categoria.toLowerCase()) continue;

      const precioBase  = parseFloat(String(row[1] || "0").replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      const stockVal    = row[2];
      const color       = String(row[3] || "").trim();
      const talle       = String(row[4] || "").trim();
      const descuento   = row[7] ? parseFloat(String(row[7]).replace(/[^\d.,]/g, "").replace(",", ".")) : null;

      const precio      = descuento !== null ? descuento : precioBase;
      const stock       = stockVal !== false && String(stockVal).toLowerCase() !== "false";

      if (precio <= 0) continue;

      products.push({
        nombre,
        categoria,
        precio,
        precio_original: descuento !== null ? precioBase : null,
        color,
        talle,
        stock,
      });
    }
  }

  if (!ADMIN_TOKEN) {
    Logger.log("ERROR: ADMIN_TOKEN no configurado. Ir a Proyecto → Propiedades del script → Agregar ADMIN_TOKEN.");
    return;
  }

  const res = UrlFetchApp.fetch(`${WORKER_API}/admin/sync-products`, {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` },
    payload: JSON.stringify({ products }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(res.getContentText());
  Logger.log(`Sincronización completada: ${result.synced}/${result.total} productos. Errores: ${result.errors?.length || 0}`);
  if (result.errors?.length) Logger.log("Errores: " + JSON.stringify(result.errors.slice(0, 5)));
}
