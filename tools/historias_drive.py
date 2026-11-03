"""Copia al Drive todas las fotos de productos que muestra la tienda, separadas por categoría,
para que los agentes de marketing las usen en historias de Instagram.

    Destino: G:\\Mi unidad\\Contenido AI HQ\\VirtualShopBaires\\Historias\\<Categoría>\\<Producto> - N.jpg

Uso (en la compu del dueño, con Google Drive para escritorio en G:):
    python tools/historias_drive.py

Se puede correr las veces que haga falta: solo baja las fotos nuevas. Guarda el archivo
original, sin recomprimir. Necesita Playwright (lee la lista igual que la ve la tienda).
"""
import os, re, sys, random, urllib.request, concurrent.futures as cf
from playwright.sync_api import sync_playwright

BASE = r"G:\Mi unidad\Contenido AI HQ\VirtualShopBaires\Historias"
TIENDA = "https://virtualshopbaires.com.ar/productos.html"
RAW = "https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/"


def lista_de_la_tienda():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        pg = b.new_page()
        pg.goto(f"{TIENDA}?qa={random.randint(1, 10**9)}", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_function("() => typeof PRODUCTOS !== 'undefined' && PRODUCTOS.length > 0", timeout=60000)
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
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return "ya"
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
    if not os.path.isdir(os.path.dirname(BASE)):
        sys.exit(f"No encuentro la carpeta del Drive: {os.path.dirname(BASE)}")
    tareas = []
    for p in lista_de_la_tienda():
        carpeta = os.path.join(BASE, limpio(p["categoria"], 60))
        for i, u in enumerate(p["imagenes"], 1):
            ext = os.path.splitext(u.split("?")[0])[1].lower()
            ext = ext if ext in (".jpg", ".jpeg", ".png", ".webp") else ".jpg"
            tareas.append((u, os.path.join(carpeta, f"{limpio(p['nombre'])} - {i}{ext}")))
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(bajar, tareas))
    mal = [r for r in res if r not in ("ok", "ya")]
    print(f"Fotos: {len(tareas)} | nuevas: {res.count('ok')} | ya estaban: {res.count('ya')} | con problema: {len(mal)}")
    for m in mal[:10]:
        print("  ", m)


if __name__ == "__main__":
    main()
