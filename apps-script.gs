// ============================================================
//  APPS SCRIPT — Mapa de imágenes desde Google Drive
//
//  ESTRUCTURA DEL DRIVE:
//
//  📁 Carpeta raíz (FOLDER_ID)
//    📁 Mascotas                    ← mismo nombre que la pestaña del Sheet
//      📁 Arnes para perros         ← subcarpeta con el nombre exacto del producto
//          🖼️ 1.jpg                 ← imágenes numeradas: 1, 2, 3...
//          🖼️ 2.jpg
//          🖼️ 3.jpg
//      🖼️ Cama para mascotas.jpg    ← o imagen directa si solo hay una foto
//
//  RETORNA JSON:
//  {
//    "Mascotas": {
//      "Arnes para perros": ["fileId1", "fileId2", "fileId3"],
//      "Cama para mascotas": "fileId"
//    }
//  }
//
//  CÓMO ACTUALIZAR DESPUÉS DE CAMBIOS:
//  Implementar → Administrar implementaciones → lápiz → Nueva versión → Implementar
// ============================================================

const FOLDER_ID = "1xBYFnxDn-uTjoyFGc0thzOF_WS16jUz5";

function doGet() {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const result = {};

    const catFolders = folder.getFolders();
    while (catFolders.hasNext()) {
      const catFolder = catFolders.next();
      const catName   = catFolder.getName().trim();
      result[catName] = {};

      // ── Archivos directos en la categoría (imagen única, sin subcarpeta) ──
      const directFiles = catFolder.getFiles();
      while (directFiles.hasNext()) {
        const file     = directFiles.next();
        const fileName = file.getName().replace(/\.[^/.]+$/, "").trim();
        result[catName][fileName] = file.getId();
      }

      // ── Subcarpetas = productos con múltiples imágenes numeradas ──────────
      const productFolders = catFolder.getFolders();
      while (productFolders.hasNext()) {
        const productFolder = productFolders.next();
        const productName   = productFolder.getName().trim();

        // Recopilar archivos y ordenarlos numéricamente por nombre
        const filesArr = [];
        const varFiles = productFolder.getFiles();
        while (varFiles.hasNext()) {
          const f = varFiles.next();
          filesArr.push({ name: f.getName(), id: f.getId() });
        }

        // Ordenar: 1.jpg < 2.jpg < 10.jpg (orden numérico)
        filesArr.sort((a, b) => {
          const na = parseInt(a.name) || 0;
          const nb = parseInt(b.name) || 0;
          return na !== nb ? na - nb : a.name.localeCompare(b.name);
        });

        result[catName][productName] = filesArr.map(f => f.id);
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
