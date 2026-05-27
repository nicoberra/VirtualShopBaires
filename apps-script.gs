// ============================================================
//  APPS SCRIPT — Mapa de imágenes desde Google Drive
//
//  CÓMO USARLO:
//  1. Abrí tu Google Sheet
//  2. Extensiones → Apps Script
//  3. Borrá el código que hay y pegá TODO este archivo
//  4. Guardá (Ctrl+S)
//  5. Clic en "Implementar" → "Nueva implementación"
//  6. Tipo: "Aplicación web"
//  7. Ejecutar como: "Yo"
//  8. Acceso: "Cualquier usuario"
//  9. Implementar → copiá la URL que aparece
//  10. Pegá esa URL en APPS_SCRIPT_URL dentro de js/sheets.js
// ============================================================

const FOLDER_ID = "1xBYFnxDn-uTjoyFGc0thzOF_WS16jUz5";

function doGet() {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const result = {};

    const subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      const sub     = subFolders.next();
      const catName = sub.getName().trim();
      result[catName] = {};

      const files = sub.getFiles();
      while (files.hasNext()) {
        const file     = files.next();
        const fileName = file.getName().replace(/\.[^/.]+$/, "").trim(); // sin extensión
        result[catName][fileName] = file.getId();
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
