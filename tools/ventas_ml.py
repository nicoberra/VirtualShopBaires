"""Ventas de Mercado Libre -> ranking de la tienda.

Lee los Excels exportados de las publicaciones de ML (columna "Cantidad vendida"),
cruza cada publicación con el producto de la tienda de nombre más parecido y genera
supabase/06-ventas-ml.sql, que guarda el total en productos.ventas_ml.
No se conecta a Mercado Libre: solo usa los Excels.

  python tools/ventas_ml.py "C:/ruta/Exels de ML"
"""
import glob
import json
import os
import re
import sys
import unicodedata
import urllib.request

import openpyxl

SUPABASE_URL = "https://dtsixnqwwrbwybulpuxo.supabase.co"
SUPABASE_PUB = "sb_publishable_nGmdSmwKGuiF5LG9fbA8dw_auHYFgCM"   # clave pública de la tienda
UMBRAL = 0.75   # parecido mínimo entre título de ML y nombre del producto
SALIDA = os.path.join(os.path.dirname(__file__), "..", "supabase", "06-ventas-ml.sql")


def palabras(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\[\d+\]", "", s)
    return {t for t in re.findall(r"[a-z0-9]+", s) if len(t) > 1 or t.isdigit()}


def leer_ml(carpeta):
    pubs = []
    for f in sorted(glob.glob(os.path.join(carpeta, "*.xlsx"))):
        filas = list(openpyxl.load_workbook(f, read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
        if not filas:
            continue
        cab = [str(c or "").strip().lower() for c in filas[0]]
        i_tit, i_id, i_vend = cab.index("titulo"), cab.index("id"), cab.index("cantidad vendida")
        for r in filas[1:]:
            if r and r[i_id]:
                pubs.append({"titulo": r[i_tit], "vendidos": int(r[i_vend] or 0)})
    return pubs


def leer_productos():
    req = urllib.request.Request(SUPABASE_URL + "/rest/v1/productos?select=id,nombre&limit=5000",
                                 headers={"apikey": SUPABASE_PUB})
    return json.load(urllib.request.urlopen(req))


def main():
    pubs, prods = leer_ml(sys.argv[1]), leer_productos()
    cand = [(p, palabras(p["nombre"])) for p in prods]
    total, sin = {}, []
    for m in pubs:
        mt = palabras(m["titulo"])
        mejor, puntaje = None, 0
        for p, pt in cand:
            if not pt or not mt:
                continue
            comun = len(mt & pt)
            s = comun / len(pt) * 0.6 + comun / len(mt) * 0.4
            if s > puntaje:
                mejor, puntaje = p, s
        if puntaje >= UMBRAL:
            total[mejor["id"]] = total.get(mejor["id"], 0) + m["vendidos"]
        elif m["vendidos"]:
            sin.append(m)
    filas = ",\n".join(f"  ({i}, {n})" for i, n in sorted(total.items()))
    sql = ("-- Generado por tools/ventas_ml.py desde los Excels de Mercado Libre.\n"
           "alter table public.productos add column if not exists ventas_ml int not null default 0;\n"
           "update public.productos set ventas_ml = 0;\n"
           "update public.productos p set ventas_ml = v.n from (values\n" + filas + "\n) as v(id, n) where p.id = v.id;\n")
    with open(SALIDA, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)
    print(f"{len(pubs)} publicaciones · {len(total)} productos de la tienda con ventas de ML")
    print(f"Sin producto en la tienda (no suman): {len(sin)} publicaciones con ventas, ej.:")
    for m in sorted(sin, key=lambda m: -m["vendidos"])[:5]:
        print(f"  {m['vendidos']:>5}  {m['titulo']}")
    print("Listo:", os.path.normpath(SALIDA))


if __name__ == "__main__":
    main()
