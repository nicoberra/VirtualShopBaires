#!/usr/bin/env python3
"""
Genera páginas estáticas para SEO a partir de la planilla pública de la tienda:
  /<categoria>/index.html     una página por categoría principal (CATEGORIAS)
  /producto/<slug>/index.html una página por producto visible en la tienda
  /sitemap.xml                todas las páginas públicas

Usa la misma planilla y las mismas reglas que js/sheets.js (precio con columna
"descuento", agrupado por nombre, solo productos con variantes visibles).
No inventa precios, reseñas ni puntajes. No publica la columna SKU_costo.

Uso:  python tools/generar_seo.py            (desde la raíz del repo)
      python tools/generar_seo.py --offline  (usa tools/.cache_planilla.json)
"""
import html, json, os, re, shutil, sys, unicodedata, urllib.parse, urllib.request
from datetime import date

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET_ID = "1sufFbmZQzjG8i8FP-XybYReqeQgsHFjhSV2KEMaNTnA"
SITIO = "https://virtualshopbaires.com.ar"
MARCA = "Virtual Shop Baires"
HOY = date.today().isoformat()
CACHE = os.path.join(RAIZ, "tools", ".cache_planilla.json")
MARCADOR = "<!-- generado por tools/generar_seo.py: no editar a mano -->"

CATS_EXTERNAS = {"herramientas"}
ALIAS_CAT = {"Jardin, Caza y Pesca": "Camping"}

# Categorías con página propia: pestaña → textos (palabra clave principal aprobada)
CATEGORIAS = [
    {"tab": "Autos a escala", "slug": "autos-a-escala", "corto": "Autos a escala",
     "h1": "Autos a escala 1:64",
     "title": "Autos a escala 1:64 de colección | Virtual Shop Baires",
     "desc": "Autos a escala 1:64 de metal para coleccionar: Maisto, Bburago, clásicos, deportivos, camionetas y motos. Precio de importador y envío a todo el país.",
     "intro": "Autos a escala 1:64 de metal para coleccionar: modelos Maisto y Bburago, autos clásicos, deportivos, camionetas, bomberos y motos a escala. Precio de importador directo y envío a todo el país.",
     "h2": "Autos de colección Maisto y Bburago"},
    {"tab": "Inflables", "slug": "inflables", "corto": "Inflables",
     "h1": "Inflables para pileta",
     "title": "Inflables para pileta Bestway e Intex | Virtual Shop Baires",
     "desc": "Inflables para pileta Bestway e Intex: colchonetas, flotadores, botes, aros de básquet y juegos para el agua. Comprá online con envío a todo el país.",
     "intro": "Inflables para pileta Bestway e Intex: colchonetas, flotadores, botes inflables, aros de básquet y juegos para el agua, para chicos y grandes. Comprá online con envío a todo el país.",
     "h2": "Colchonetas, flotadores y botes inflables"},
    {"tab": "Juguetes", "slug": "juguetes", "corto": "Juguetes",
     "h1": "Juguetes importados",
     "title": "Juguetes importados | Virtual Shop Baires",
     "desc": "Juguetes importados para todas las edades: bloques Sluban, Playmobil, autos a control remoto y muñecas. Precio de importador y envío a todo el país.",
     "intro": "Juguetes importados para todas las edades: bloques para armar Sluban, figuras Playmobil, autos a control remoto, muñecas y más. Comprá online con precio de importador directo y envío a todo el país.",
     "h2": "Bloques, Playmobil y autos a control remoto"},
    {"tab": "Fitness y musculacion", "slug": "fitness", "corto": "Fitness",
     "h1": "Elementos de gimnasio para casa",
     "title": "Elementos de gimnasio para casa | Virtual Shop Baires",
     "desc": "Elementos de gimnasio para casa: mancuernas recubiertas, bandas elásticas, ruedas abdominales y ejercitadores. Comprá online con envío a todo el país.",
     "intro": "Elementos de gimnasio para entrenar en casa: mancuernas recubiertas, bandas elásticas, ruedas abdominales, ejercitadores de mano y accesorios de musculación. Envío a todo el país.",
     "h2": "Mancuernas, bandas elásticas y accesorios de musculación"},
    {"tab": "Camping", "slug": "camping", "corto": "Camping",
     "h1": "Artículos de camping",
     "title": "Artículos de camping | Virtual Shop Baires",
     "desc": "Artículos de camping y aire libre: carpas, gazebos 3x3 y repuestos, sillas plegables, faroles LED e infladores. Comprá online con envío a todo el país.",
     "intro": "Artículos de camping y aire libre: carpas, gazebos 3x3 y repuestos, sillas plegables, faroles LED e infladores. Equipate para tu próxima salida con envío a todo el país.",
     "h2": "Carpas, gazebos y sillas de camping"},
    {"tab": "Playa", "slug": "playa", "corto": "Playa",
     "h1": "Reposeras y sombrillas de playa",
     "title": "Reposeras y sombrillas de playa | Virtual Shop Baires",
     "desc": "Reposeras y sombrillas de playa: reposeras plegables, camastros, sombrillas con soporte para arena y bases de contrapeso. Envío a todo el país.",
     "intro": "Reposeras y sombrillas de playa para el verano: reposeras plegables, camastros, sombrillas reclinables con soporte para arena y bases de contrapeso. Comprá online con envío a todo el país.",
     "h2": "Reposeras plegables, camastros y sombrillas"},
    {"tab": "Muebles para el hogar", "slug": "muebles", "corto": "Muebles",
     "h1": "Mesas ratonas nórdicas y muebles para el hogar",
     "title": "Mesa ratona nórdica y muebles | Virtual Shop Baires",
     "desc": "Mesa ratona nórdica, mesas nido y muebles de living minimalista, más sombrillas para el jardín. Comprá con precio de importador y envío a todo el país.",
     "intro": "Mesa ratona nórdica, mesas nido y muebles de living de estilo minimalista para renovar tu casa, además de sombrillas para jardín y pileta. Precio de importador directo y envío a todo el país.",
     "h2": "Mesas ratonas, mesas nido y living minimalista"},
    {"tab": "Bazar, baño y cocina", "slug": "bazar-bano-y-cocina", "corto": "Bazar, baño y cocina",
     "h1": "Accesorios de baño y cocina",
     "title": "Accesorios de baño y cocina | Virtual Shop Baires",
     "desc": "Accesorios de baño y cocina: organizadores, percheros de pared, toalleros, escobillas y afiladores de cuchillos. Comprá online con envío a todo el país.",
     "intro": "Accesorios de baño y cocina para ordenar tu casa: organizadores, percheros de pared, toalleros, escobillas, afiladores de cuchillos y decoración. Envío a todo el país.",
     "h2": "Organizadores, percheros y accesorios de bazar"},
    {"tab": "Mascotas", "slug": "mascotas", "corto": "Mascotas",
     "h1": "Comederos y accesorios para perros y gatos",
     "title": "Accesorios para perros y gatos | Virtual Shop Baires",
     "desc": "Comederos y accesorios para perros y gatos: comederos de acero inoxidable, correas, cadenas y corta uñas. Comprá online con envío a todo el país.",
     "intro": "Comederos y accesorios para perros y gatos: comederos y bebederos de acero inoxidable antideslizantes, correas, cadenas y corta uñas. Comprá online con envío a todo el país.",
     "h2": "Comederos de acero inoxidable, correas y cuidado"},
    {"tab": "Pilates y Yoga", "slug": "pilates-y-yoga", "corto": "Pilates y Yoga",
     "h1": "Mat de yoga y pilates",
     "title": "Mat de yoga y pilates | Virtual Shop Baires",
     "desc": "Mat de yoga y colchonetas de pilates en TPE y neoprene, bandas de látex y almohadillas protectoras. Comprá online con envío a todo el país.",
     "intro": "Mat de yoga y colchonetas de pilates en TPE y neoprene, bandas de látex y almohadillas protectoras para practicar en casa. Comprá online con envío a todo el país.",
     "h2": "Colchonetas, bandas de látex y accesorios"},
]
CAT_POR_TAB = {c["tab"]: c for c in CATEGORIAS}

# Marcas detectadas solo si el nombre del producto las menciona (nunca se inventan)
MARCAS = ["Maisto", "Bburago", "Burago", "Bestway", "Intex", "Sluban", "Playmobil", "Lego", "Hot Wheels",
          "Samsonite", "Klimber", "Roots", "Oneskate"]


# ─── utilidades ──────────────────────────────────────────────────────────────
def norm(s):
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()

def slugify(s, largo=70):
    s = re.sub(r"\s+", "-", norm(s))
    s = re.sub(r"-+", "-", s).strip("-")
    if len(s) > largo:
        s = s[:largo].rsplit("-", 1)[0]
    return s or "producto"

def esc(s):
    return html.escape(str(s or ""), quote=True)

def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.,]", "", str(v))
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None

def precio_txt(n):
    entero = int(round(n))
    return "$" + f"{entero:,}".replace(",", ".")

def precio_transferencia_txt(n):
    """Precio con 10% OFF por transferencia (mismo cálculo que el checkout: centavos si hay)."""
    v = round(n * 90) / 100
    entero, cent = int(v), int(round((v - int(v)) * 100))
    return "$" + f"{entero:,}".replace(",", ".") + (f",{cent:02d}" if cent else "")

def recortar(s, maximo):
    s = re.sub(r"\s+", " ", str(s)).strip()
    if len(s) <= maximo:
        return s
    corte = s[:maximo + 1].rsplit(" ", 1)[0].rstrip(",;:-·|")
    return corte

def dentro(s, minimo, maximo):
    return minimo <= len(s) <= maximo


# ─── datos ───────────────────────────────────────────────────────────────────
def gviz(hoja):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:json&sheet=" + urllib.parse.quote(hoja)
    txt = urllib.request.urlopen(url, timeout=60).read().decode("utf-8")
    return json.loads(re.search(r"setResponse\(([\s\S]*)\)\s*;?\s*$", txt).group(1))

CATALOGO_URL = ("https://script.google.com/macros/s/AKfycbwovdDoOyb7WN-Hw-WpThWqpTCOWVHxuzaaTt1PH3lwiJ8ju_PigCFVgsEiRrbgE3dN/exec"
                "?action=catalogo")

def leer_catalogo_crm():
    """El CRM entrega solo las pestañas de productos (la planilla puede ser privada)."""
    try:
        req = urllib.request.Request(CATALOGO_URL, headers={"User-Agent": "vsb-generador-seo"})
        j = json.loads(urllib.request.urlopen(req, timeout=90).read().decode("utf-8"))
        if j.get("ok") and j.get("hojas"):
            return {t: tabla for t, tabla in j["hojas"].items() if t.lower().strip() not in CATS_EXTERNAS}
    except Exception as e:
        print(f"  aviso: el CRM no entregó el catálogo ({e}); se intenta la planilla directa", file=sys.stderr)
    return None

def leer_planilla(offline):
    if offline:
        return json.load(open(CACHE, encoding="utf-8"))
    hojas = leer_catalogo_crm()
    if hojas:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump(hojas, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
        return hojas
    cats =[r["c"][0]["v"].strip() for r in gviz("Categorias")["table"]["rows"]
            if r.get("c") and r["c"][0] and r["c"][0].get("v")]
    hojas = {}
    for c in cats:
        if c.lower().strip() in CATS_EXTERNAS or c.lower() == "nombre":
            continue
        try:
            hojas[c] = gviz(c)["table"]
        except Exception as e:
            print(f"  aviso: no se pudo leer la pestaña {c}: {e}", file=sys.stderr)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(hojas, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return hojas

def productos_de(tab, tabla, manifest):
    """Replica fetchHoja de js/sheets.js."""
    labels = [str(c.get("label") or "").strip().lower() for c in tabla.get("cols", [])]
    i_desc = labels.index("descuento") if "descuento" in labels else -1
    i_img = labels.index("imagen_url") if "imagen_url" in labels else -1
    cat_man = next((manifest[k] for k in manifest if norm(k) == norm(tab)), {})
    agrupado = {}
    for r in tabla.get("rows") or []:
        c = r.get("c") or []
        get = lambda i: (c[i].get("v") if i < len(c) and c[i] and c[i].get("v") is not None else None)
        nombre = str(get(0) or "").strip()
        if not nombre or nombre.lower() == tab.lower():
            continue
        if not (get(1) or get(5) or get(4)):
            continue
        compacto = isinstance(get(5), bool)
        base = num(get(1)) or 0
        desc = num(get(i_desc)) if i_desc >= 0 else None
        precio = desc if (desc is not None and desc > 0) else base
        color = str(get(3)).strip() if get(3) else ""
        talle = "" if compacto else (str(get(4)).strip() if get(4) else "")
        descripcion = get(4) if compacto else get(5)
        p = agrupado.setdefault(nombre, {
            "nombre": nombre, "categoria": ALIAS_CAT.get(tab, tab), "tab": tab,
            "descripcion": descripcion.strip() if isinstance(descripcion, str) else "",
            "variantes": [], "imagenes": [],
        })
        if get(2) is False or str(get(2)).strip().lower() == "false":   # sin stock: no se publica (igual que la tienda)
            continue
        if color or talle:
            p["variantes"].append({"color": color, "talle": talle, "precio": precio,
                                   "stock": get(2) is not False and str(get(2)).lower() != "false",
                                   "imagen": str(get(i_img)).strip() if i_img >= 0 and get(i_img) else ""})
    out = []
    for p in agrupado.values():
        if not p["variantes"]:          # la tienda solo muestra productos con variantes (STOCK_ACTIVO=false)
            continue
        precios = [v["precio"] for v in p["variantes"] if v["precio"] and v["precio"] > 0]
        if not precios:
            continue
        p["precio_min"], p["precio_max"] = min(precios), max(precios)
        clave = next((k for k in cat_man if norm(k) == norm(p["nombre"])), None)
        v = cat_man.get(clave) if clave else None
        imgs = v if isinstance(v, list) else ([v] if v else [])
        imgs += [x["imagen"] for x in p["variantes"] if x["imagen"]]
        # El encuadre del CRM ("#vsb=...") es solo para la tienda: Google recibe la foto sin eso
        p["imagenes"] = list(dict.fromkeys(i.split("#")[0] for i in imgs if i.startswith("http")))
        p["marca"] = next((m for m in MARCAS if re.search(r"\b" + re.escape(m) + r"\b", p["nombre"], re.I)), None)
        if p["marca"] == "Burago":
            p["marca"] = "Bburago"
        out.append(p)
    return out


# ─── plantilla ───────────────────────────────────────────────────────────────
def plantilla():
    src = open(os.path.join(RAIZ, "productos.html"), encoding="utf-8").read()
    head = src[:src.index("<div class=\"page-hero\"")]
    footer = src[src.index("<footer>"):]
    # sacar los scripts propios del catálogo (filtros) y dejar solo los compartidos
    footer = re.sub(r"<script>\s*let selectedCat[\s\S]*?</script>\s*", "", footer, count=1)
    head = head.replace('class="active"', "")
    # los datos estructurados del catálogo no corresponden a estas páginas: cada una lleva los suyos
    head = re.sub(r'\s*<script type="application/ld\+json">[\s\S]*?</script>', "", head)
    head = re.sub(r"<title>[\s\S]*?</title>", "<title>{{TITLE}}</title>", head, count=1)
    head = re.sub(r'<meta\s+name="description"[^>]*>', '<meta name="description" content="{{DESC}}" />', head, count=1)
    head = re.sub(r'<meta\s+property="og:title"[^>]*>', '<meta property="og:title" content="{{TITLE}}" />', head, count=1)
    head = re.sub(r'<meta\s+property="og:description"[^>]*>', '<meta property="og:description" content="{{DESC}}" />', head, count=1)
    head = re.sub(r'<meta\s+property="og:image"[^>]*>', '<meta property="og:image" content="{{IMG}}" />', head, count=1)
    head = re.sub(r'<meta\s+property="og:url"[^>]*>', '<meta property="og:url" content="{{URL}}" />', head, count=1)
    head = re.sub(r'<meta\s+property="og:type"[^>]*>', '<meta property="og:type" content="{{OGTYPE}}" />', head, count=1)
    head = re.sub(r'<link\s+rel="canonical"[^>]*>', '<link rel="canonical" href="{{URL}}" />', head, count=1)
    # todas las rutas relativas se resuelven desde la raíz del sitio
    head = head.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <base href="/" />', 1)
    head = head.replace("</head>", "{{LDJSON}}\n" + ESTILOS + "\n</head>", 1)
    return head, footer

ESTILOS = """<style>
  .seo-wrap { padding: 28px 0 56px; }
  .seo-crumbs { font-size: .8rem; color: var(--gray); margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px; }
  .seo-crumbs a { color: var(--gray); text-decoration: none; }
  .seo-crumbs a:hover { color: var(--red); }
  .seo-h1 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 900; line-height: 1.15; margin: 0 0 10px; text-wrap: balance; }
  .seo-intro { color: var(--gray-light); max-width: 70ch; margin: 0 0 26px; line-height: 1.6; }
  .seo-h2 { font-size: 1.15rem; font-weight: 800; margin: 34px 0 14px; }
  .seo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
  .seo-card { background: var(--black-3, #fff); border-radius: 14px; overflow: hidden; text-decoration: none; color: inherit;
              box-shadow: 0 2px 12px rgba(0,0,0,.06); display: flex; flex-direction: column; transition: transform .18s ease, box-shadow .18s ease; }
  .seo-card:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(0,0,0,.10); }
  .seo-card img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fff; }
  .seo-card span { padding: 10px 12px 0; font-size: .82rem; line-height: 1.35; flex: 1; }
  .seo-card b { padding: 6px 12px 12px; color: var(--red); font-size: 1rem; }
  .pdp { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 32px; align-items: start; }
  .pdp-img { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 14px rgba(0,0,0,.06); }
  .pdp-img img { width: 100%; aspect-ratio: 1; object-fit: contain; display: block; }
  .pdp-thumbs { display: flex; gap: 8px; margin-top: 10px; overflow-x: auto; }
  .pdp-thumbs img { width: 64px; height: 64px; object-fit: contain; background: #fff; border-radius: 10px; border: 1px solid rgba(0,0,0,.08); cursor: pointer; flex: none; }
  .pdp-precio { font-size: 1.8rem; font-weight: 900; color: var(--red); margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
  .pdp-nota { font-size: .85rem; color: var(--gray); margin: 0 0 16px; }
  .pdp-vars { font-size: .9rem; margin: 0 0 18px; color: var(--gray-light); }
  .pdp-acciones { display: flex; flex-wrap: wrap; gap: 10px; }
  .pdp-acciones .btn-primary, .pdp-acciones .btn-wa { display: inline-flex; align-items: center; gap: 8px; }
  .pdp-desc { white-space: pre-line; line-height: 1.65; color: var(--gray-light); max-width: 75ch; }
  .seo-ver-todo { display: inline-block; margin-top: 18px; color: var(--red); font-weight: 700; text-decoration: none; }
  @media (max-width: 760px) { .seo-wrap { padding-left: 16px; padding-right: 16px; } .pdp { grid-template-columns: 1fr; gap: 18px; } .seo-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
  @media (prefers-reduced-motion: reduce) { .seo-card { transition: none; } .seo-card:hover { transform: none; } }
</style>"""

def pagina(head, footer, title, desc, url, img, ogtype, ldjson, cuerpo, script=""):
    assert len(title) <= 60, f"title largo ({len(title)}): {title}"
    h = (head.replace("{{TITLE}}", esc(title)).replace("{{DESC}}", esc(desc)).replace("{{URL}}", esc(url))
             .replace("{{IMG}}", esc(img)).replace("{{OGTYPE}}", ogtype)
             .replace("{{LDJSON}}", '<script type="application/ld+json">' +
                      json.dumps(ldjson, ensure_ascii=False).replace("</", "<\\/") + "</script>"))
    return MARCADOR + "\n" + h + cuerpo + "\n" + footer.replace("</body>", script + "\n</body>", 1)

def migas(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}

def migas_html(items):
    partes = [f'<a href="{esc(u.replace(SITIO + "/", ""))}">{esc(n)}</a>' for n, u in items[:-1]]
    partes.append(f'<span aria-current="page">{esc(items[-1][0])}</span>')
    return '<nav class="seo-crumbs" aria-label="Migas de pan">' + ' <span aria-hidden="true">›</span> '.join(partes) + "</nav>"

def tarjeta(p):
    img = p["imagenes"][0] if p["imagenes"] else "logo.png"
    desde = "Desde " if p["precio_max"] > p["precio_min"] else ""
    return (f'<a class="seo-card" href="producto/{p["slug"]}/"><img src="{esc(img)}" alt="{esc(p["nombre"])}" loading="lazy" width="300" height="300" />'
            f'<span>{esc(p["nombre"])}</span><b>{desde}{precio_txt(p["precio_min"])}</b></a>')


# ─── generación ──────────────────────────────────────────────────────────────
def main():
    offline = "--offline" in sys.argv
    manifest = json.load(open(os.path.join(RAIZ, "images-manifest.json"), encoding="utf-8"))
    hojas = leer_planilla(offline)
    productos, usados = [], set()
    for tab, tabla in hojas.items():
        for p in productos_de(tab, tabla, manifest):
            s = slugify(p["nombre"])
            base, n = s, 2
            while s in usados:
                s, n = f"{base}-{n}", n + 1
            usados.add(s)
            p["slug"] = s
            productos.append(p)
    if len(productos) < 100:
        sys.exit(f"Solo se leyeron {len(productos)} productos: no se reemplazan las páginas (¿falló la planilla?)")

    head, footer = plantilla()
    org = {"@id": SITIO + "/#organization"}

    # limpiar páginas generadas anteriores
    dir_prod = os.path.join(RAIZ, "producto")
    if os.path.isdir(dir_prod):
        shutil.rmtree(dir_prod)
    for c in CATEGORIAS:
        f = os.path.join(RAIZ, c["slug"], "index.html")
        if os.path.exists(f) and MARCADOR not in open(f, encoding="utf-8").read(200):
            sys.exit(f"{f} existe y no es una página generada: no se pisa")

    # productos
    por_cat = {}
    for p in productos:
        por_cat.setdefault(p["tab"], []).append(p)
    for p in productos:
        cat = CAT_POR_TAB.get(p["tab"])
        url = f"{SITIO}/producto/{p['slug']}/"
        cat_url = f"{SITIO}/{cat['slug']}/" if cat else f"{SITIO}/productos.html?cat={urllib.parse.quote(p['tab'])}"
        cat_nombre = cat["corto"] if cat else p["tab"]
        items_migas = [("Inicio", SITIO + "/"), (cat_nombre, cat_url), (p["nombre"], url)]
        precio = precio_txt(p["precio_min"])
        desde = "desde " if p["precio_max"] > p["precio_min"] else ""
        title = recortar(p["nombre"], 60 - len(" | " + MARCA)) + " | " + MARCA
        cuerpo_desc = re.sub(r"\s+", " ", p["descripcion"])
        # Descripción limpia (el texto de Mercado Libre suele empezar con palabras sueltas)
        cola = f" {desde}{precio}. Envío a todo el país y 10% OFF por transferencia. ¡Comprá online!"
        desc = recortar(p["nombre"], 155 - len(cola)) + cola
        largo = desc.replace(" ¡Comprá online!", " ¡Comprá online en Virtual Shop Baires!")
        if len(desc) < 140 and len(largo) <= 155:
            desc = largo
        colores = sorted({v["color"] for v in p["variantes"] if v["color"]})
        talles = sorted({v["talle"] for v in p["variantes"] if v["talle"]})
        hay_stock = any(v["stock"] for v in p["variantes"])
        disponibilidad = "https://schema.org/InStock" if hay_stock else "https://schema.org/OutOfStock"
        if p["precio_max"] > p["precio_min"]:
            oferta = {"@type": "AggregateOffer", "priceCurrency": "ARS", "lowPrice": p["precio_min"], "highPrice": p["precio_max"],
                      "offerCount": len(p["variantes"]), "availability": disponibilidad, "url": url, "seller": org}
        else:
            oferta = {"@type": "Offer", "priceCurrency": "ARS", "price": p["precio_min"], "availability": disponibilidad,
                      "url": url, "seller": org, "itemCondition": "https://schema.org/NewCondition"}
        prod_ld = {"@type": "Product", "@id": url + "#product", "name": p["nombre"], "url": url,
                   "image": p["imagenes"][:6] or [SITIO + "/logo.png"], "category": p["categoria"], "offers": oferta}
        if p["descripcion"]:
            prod_ld["description"] = recortar(cuerpo_desc, 5000)
        if p["marca"]:
            prod_ld["brand"] = {"@type": "Brand", "name": p["marca"]}
        ld = {"@context": "https://schema.org", "@graph": [prod_ld, migas(items_migas)]}

        imgs = p["imagenes"][:8]
        principal = imgs[0] if imgs else "logo.png"
        thumbs = "".join(f'<img src="{esc(i)}" alt="{esc(p["nombre"])} – foto {n + 1}" loading="lazy" onclick="document.getElementById(\'pdp-main\').src=this.src" />'
                         for n, i in enumerate(imgs)) if len(imgs) > 1 else ""
        vars_txt = []
        if colores:
            vars_txt.append("<strong>Colores:</strong> " + esc(", ".join(colores)))
        if talles:
            vars_txt.append("<strong>Medidas:</strong> " + esc(", ".join(talles)))
        relacionados = [x for x in por_cat.get(p["tab"], []) if x is not p][:6]
        wa = urllib.parse.quote(f"Hola! 👋 Quiero consultar sobre *{p['nombre']}*\n🔗 {url}\n\n¿Tienen stock disponible?")
        resumen = (f"{esc(p['nombre'])} {desde}{precio} en {MARCA}: producto importado nuevo, "
                   f"con envío a todo el país y 10% de descuento pagando por transferencia.")
        cuerpo = f"""
<main class="container seo-wrap">
  {migas_html(items_migas)}
  <div class="pdp">
    <div>
      <div class="pdp-img"><img id="pdp-main" src="{esc(principal)}" alt="{esc(p['nombre'])}" width="600" height="600" fetchpriority="high" /></div>
      <div class="pdp-thumbs">{thumbs}</div>
    </div>
    <div>
      <h1 class="seo-h1">{esc(p['nombre'])}</h1>
      <p class="pdp-precio">{'Desde ' if desde else ''}{precio}</p>
      <p class="pdp-nota"><strong>{'Desde ' if desde else ''}{precio_transferencia_txt(p['precio_min'])}</strong> pagando por transferencia (10% OFF) · Envío a todo el país</p>
      <p class="seo-intro">{resumen}</p>
      {'<p class="pdp-vars">' + '<br>'.join(vars_txt) + '</p>' if vars_txt else ''}
      <div class="pdp-acciones">
        <button type="button" class="btn-primary" id="pdp-comprar" onclick="pdpComprar()"><i class="fa-solid fa-cart-plus" aria-hidden="true"></i> Elegir variante y agregar al carrito</button>
        <a class="btn-wa" href="https://wa.me/5491149457266?text={wa}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Consultar por WhatsApp</a>
      </div>
    </div>
  </div>
  {'<h2 class="seo-h2">Descripción de ' + esc(recortar(p['nombre'], 70)) + '</h2><div class="pdp-desc">' + esc(p['descripcion']) + '</div>' if p['descripcion'] else ''}
  {'<h2 class="seo-h2">Más ' + esc(cat_nombre.lower()) + '</h2><div class="seo-grid">' + ''.join(tarjeta(x) for x in relacionados) + '</div><a class="seo-ver-todo" href="' + esc(cat_url.replace(SITIO + '/', '')) + '">Ver todo en ' + esc(cat_nombre) + ' →</a>' if relacionados else ''}
</main>
"""
        script = f"""<script>
  // Reusa la ficha de compra de la tienda (variantes, carrito) cuando cargan los datos.
  const PDP_NOMBRE = {json.dumps(p['nombre'], ensure_ascii=False)}, PDP_CAT = {json.dumps(p['categoria'], ensure_ascii=False)};
  let pdpId = null;
  const _n = s => String(s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  cargarProductos().then(() => {{
    const p = PRODUCTOS.find(x => _n(x.nombre) === _n(PDP_NOMBRE) && x.categoria === PDP_CAT) || PRODUCTOS.find(x => _n(x.nombre) === _n(PDP_NOMBRE));
    if (p) pdpId = p.id;
  }}).catch(() => {{}});
  function pdpComprar() {{
    if (pdpId !== null) openProductModal(pdpId);
    else location.href = "productos.html?buscar=" + encodeURIComponent(PDP_NOMBRE);
  }}
</script>"""
        out = pagina(head, footer, title, desc, url, principal if principal.startswith("http") else SITIO + "/logo.png",
                     "product", ld, cuerpo, script)
        d = os.path.join(dir_prod, p["slug"])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n").write(out)

    # categorías
    for c in CATEGORIAS:
        lista = por_cat.get(c["tab"], [])
        if not lista:
            continue
        assert dentro(c["desc"], 120, 155), f"desc {c['slug']} ({len(c['desc'])})"
        url = f"{SITIO}/{c['slug']}/"
        items_migas = [("Inicio", SITIO + "/"), (c["corto"], url)]
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": url, "url": url, "name": c["h1"], "description": c["desc"],
             "isPartOf": {"@id": SITIO + "/#website"},
             "mainEntity": {"@type": "ItemList", "numberOfItems": len(lista), "itemListElement": [
                 {"@type": "ListItem", "position": i + 1, "url": f"{SITIO}/producto/{p['slug']}/", "name": p["nombre"]}
                 for i, p in enumerate(lista)]}},
            migas(items_migas)]}
        cuerpo = f"""
<main class="container seo-wrap">
  {migas_html(items_migas)}
  <h1 class="seo-h1">{esc(c['h1'])}</h1>
  <p class="seo-intro">{esc(c['intro'])}</p>
  <h2 class="seo-h2">{esc(c['h2'])} <span style="color:var(--gray);font-weight:600;font-size:.85rem">({len(lista)} productos)</span></h2>
  <div class="seo-grid">{''.join(tarjeta(p) for p in lista)}</div>
  <a class="seo-ver-todo" href="productos.html?cat={esc(urllib.parse.quote(c['tab']))}">Ver {esc(c['corto'].lower())} con filtros y precios →</a>
</main>
"""
        img = next((p["imagenes"][0] for p in lista if p["imagenes"]), SITIO + "/logo.png")
        out = pagina(head, footer, c["title"], c["desc"], url, img, "website", ld, cuerpo)
        d = os.path.join(RAIZ, c["slug"])
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n").write(out)

    # sitemap
    urls = [("", "1.0", "daily"), ("productos.html", "0.9", "daily")]
    urls += [(c["slug"] + "/", "0.8", "daily") for c in CATEGORIAS if por_cat.get(c["tab"])]
    urls += [("nosotros.html", "0.5", "monthly"), ("faq.html", "0.5", "monthly"), ("contacto.html", "0.5", "monthly")]
    urls += [(f"producto/{p['slug']}/", "0.6", "weekly") for p in productos]
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, prio, freq in urls:
        sm.append(f"  <url><loc>{SITIO}/{u}</loc><lastmod>{HOY}</lastmod><changefreq>{freq}</changefreq><priority>{prio}</priority></url>")
    sm.append("</urlset>\n")
    open(os.path.join(RAIZ, "sitemap.xml"), "w", encoding="utf-8", newline="\n").write("\n".join(sm))

    sin_stock = sum(1 for p in productos if not any(v["stock"] for v in p["variantes"]))
    print(f"OK: {len(productos)} productos, {sum(1 for c in CATEGORIAS if por_cat.get(c['tab']))} categorías, "
          f"{len(urls)} URLs en sitemap, {sin_stock} sin stock según planilla, "
          f"{sum(1 for p in productos if p['marca'])} con marca detectada, {sum(1 for p in productos if not p['imagenes'])} sin imagen")

if __name__ == "__main__":
    main()
