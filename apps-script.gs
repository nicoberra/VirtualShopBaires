// ============================================================
//  APPS SCRIPT — Mapa de imágenes desde Google Drive
//
//  ESTRUCTURA DEL DRIVE:
//  📁 Carpeta raíz (FOLDER_ID)
//    📁 Mascotas
//      📁 Arnes para perros   ← mismo nombre que columna A del Sheet
//          🖼️ 1.jpg           ← numeradas: 1, 2, 3...
//          🖼️ 2.jpg
//      🖼️ Cama.jpg            ← imagen directa si tiene una sola foto
//
//  RETORNA JSON con URLs listas para usar:
//  {
//    "Mascotas": {
//      "Arnes para perros": ["https://...", "https://..."],
//      "Cama": "https://..."
//    }
//  }
//
//  PARA ACTUALIZAR: Implementar → Administrar → lápiz → Nueva versión → Implementar
// ============================================================

const FOLDER_ID = "1xBYFnxDn-uTjoyFGc0thzOF_WS16jUz5";

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

      // Archivos directos en la categoría (producto con una sola imagen)
      const directFiles = catFolder.getFiles();
      while (directFiles.hasNext()) {
        const file     = directFiles.next();
        const fileName = file.getName().replace(/\.[^/.]+$/, "").trim();
        result[catName][fileName] = getImgUrl(file);
      }

      // Subcarpetas = productos con múltiples imágenes numeradas
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

        // Ordenar numéricamente: 1 < 2 < 10
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
