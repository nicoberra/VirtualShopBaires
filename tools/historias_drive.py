"""Mantiene en el Drive las fotos de productos que muestra la tienda, separadas por categoría,
para que los agentes de marketing las usen en historias de Instagram.

    Destino: G:\\Mi unidad\\Contenido AI HQ\\VirtualShopBaires\\Historias\\<Categoría>\\<Producto> - N.jpg

Uso (en la compu del dueño, con Google Drive para escritorio en G:):
    python tools/historias_drive.py            # sincroniza
    python tools/historias_drive.py --simular  # solo muestra qué cambiaría, sin tocar nada

El Drive queda IGUAL a lo que hay en el CRM/tienda:
  - baja las fotos nuevas,
  - si en el CRM se cambió o reordenó una foto, reemplaza el archivo,
  - borra las fotos que ya no están en el CRM (van a la papelera del Drive: se recuperan 30 días).
Guarda en _fotos.json qué foto de la tienda es cada archivo. Guarda el original, sin recomprimir.
Necesita Playwright (lee la lista igual que la ve la tienda).
"""
import os, re, sys, json, random, urllib.request, concurrent.futures as cf
from playwright.sync_api import sync_playwright

BASE = r"G:\Mi unidad\Contenido AI HQ\VirtualShopBaires\Historias"
REGISTRO = os.path.join(BASE, "_fotos.json")
TIENDA = "https://virtualshopbaires.com.ar/productos.html"
RAW = "https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/"
EXT_FOTO = (".jpg", ".jpeg", ".png", ".webp")


def lista_de_la_tienda():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        pg = b.new_page()
        # Sin caché: siempre lo último que hay en el CRM
        pg.add_init_script("try { localStorage.clear(); } catch (e) {}")
        pg.goto(f"{TIENDA}?qa={random.randint(1, 10**9)}", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_function("() => typeof PRODUCTOS !== 'undefined' && PRODUCTOS.length > 0 && typeof CATALOGO_ERROR !== 'undefined' && !CATALOGO_ERROR", timeout=60000)
        datos = pg.evaluate("""() => PRODUCTOS.map(p => {
          let ims = [...(p.imagenes || []), ...(p.imagen ? [p.imagen] : [])];
          (p.variantes || []).forEach(v => { ims.push(...(v.imagenes || [])); if (v.imagen) ims.push(v.imagen); });
          return { categoria: p.categoria, nombre: p.nombre, imagenes: [...new Set(ims.map(u => String(u).split('#')[0]).filter(Boolean))] };
        })""")
        b.close()
    return datos


def limpio(t, largo=110):
    t = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", str(t)).strip().rstrip(".")
    return re.sub(r"\s+", " ", t)[:largo].strip()


def leer(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def bajar(t):
    u, dest = t
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        try:
            datos = leer(u)
        except Exception:
            # Foto recién subida que todavía no se publicó en la tienda: se baja de GitHub
            m = re.match(r"^https://virtualshopbaires\.com\.ar/(img/.+)$", u)
            if not m:
                raise
            datos = leer(RAW + m.group(1))
        if len(datos) < 1000:
            return "chica " + u
        with open(dest + ".part", "wb") as f:
            f.write(datos)
        os.replace(dest + ".part", dest)
        return "ok"
    except Exception as e:
        return f"error {u} {str(e)[:60]}"


def main():
    simular = "--simular" in sys.argv
    if not os.path.isdir(os.path.dirname(BASE)):
        sys.exit(f"No encuentro la carpeta del Drive: {os.path.dirname(BASE)}")
    try:
        registro = json.load(open(REGISTRO, encoding="utf-8"))
    except Exception:
        registro = {}

    productos = lista_de_la_tienda()
    if len(productos) < 50:
        sys.exit(f"La tienda devolvió solo {len(productos)} productos: no toco nada por las dudas.")

    deseado = {}   # ruta relativa -> url
    for p in productos:
        carpeta = limpio(p["categoria"], 60)
        for i, u in enumerate(p["imagenes"], 1):
            ext = os.path.splitext(u.split("?")[0])[1].lower()
            ext = ext if ext in EXT_FOTO else ".jpg"
            deseado[os.path.join(carpeta, f"{limpio(p['nombre'])} - {i}{ext}")] = u

    # Qué bajar: lo que falta o lo que cambió de foto
    tareas = [(u, os.path.join(BASE, rel)) for rel, u in deseado.items()
              if not (os.path.exists(os.path.join(BASE, rel)) and registro.get(rel) == u)]
    # Qué borrar: fotos del Drive que ya no están en el CRM
    sobran = []
    for raiz, _, archivos in os.walk(BASE):
        for a in archivos:
            if not a.lower().endswith(EXT_FOTO):
                continue
            rel = os.path.relpath(os.path.join(raiz, a), BASE)
            if rel not in deseado:
                sobran.append(rel)

    print(f"Fotos en el CRM: {len(deseado)} | a bajar o reemplazar: {len(tareas)} | a borrar del Drive: {len(sobran)}")
    if simular:
        for rel in sorted(sobran)[:40]:
            print("   borraría:", rel)
        if len(sobran) > 40:
            print(f"   … y {len(sobran) - 40} más")
        return

    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(bajar, tareas))
    for (u, dest), r in zip(tareas, res):
        if r == "ok":
            registro[os.path.relpath(dest, BASE)] = u
    borradas = 0
    for rel in sobran:
        try:
            os.remove(os.path.join(BASE, rel))      # Drive para escritorio lo manda a la papelera del Drive
            registro.pop(rel, None)
            borradas += 1
        except Exception as e:
            print("   no se pudo borrar:", rel, str(e)[:60])
    for raiz, dirs, archivos in os.walk(BASE, topdown=False):   # carpetas de categoría que quedaron vacías
        if raiz != BASE and not os.listdir(raiz):
            os.rmdir(raiz)
    registro = {k: v for k, v in registro.items() if k in deseado}
    with open(REGISTRO, "w", encoding="utf-8") as f:
        json.dump(registro, f, ensure_ascii=False, indent=0)
    mal = [r for r in res if r != "ok"]
    print(f"Listo: bajadas o reemplazadas {res.count('ok')} | borradas {borradas} | con problema {len(mal)}")
    for m in mal[:10]:
        print("  ", m)


if __name__ == "__main__":
    main()
