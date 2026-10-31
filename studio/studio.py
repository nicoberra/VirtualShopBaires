#!/usr/bin/env python3
"""studio — CLI del estudio multimedia de Virtual Shop Baires.

  studio doctor                                  estado de herramientas
  studio new <nombre>                            crea proyecto con estructura estándar
  studio probe <archivo>                         análisis técnico (video/imagen/audio)
  studio img cutout  <in> -o out.png             PNG transparente con bordes limpios
  studio img product <in> -o out.jpg --fmt ml    producto centrado sobre fondo (+sombra)
  studio img fit     <in> -o out.jpg --fmt feed45 --mode blur|pad|crop
  studio img enhance <in> -o out.jpg             exposición/balance/nitidez conservadores
  studio vid encode  <in> -o out.mp4 --profile social [--fmt reel --mode blur]
  studio vid slideshow img1 img2 ... -o reel.mp4 --logo L.png --cta "Comprá ya"
  studio qc <archivo> [--expect reel] [--fps 30]  control de calidad + previews
Todos los comandos de edición corren QC automáticamente sobre el resultado.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import PRESETS, ffprobe, fmt_size, has  # noqa: E402

ROOT = Path(__file__).resolve().parent
BRAND = {"navy": "#1B2B4B", "red": "#CC1212", "yellow": "#FFD700"}


def _qc(out, outdir=None, **kw):
    from lib import qc
    outdir = outdir or Path(out).parent / "qc"
    r = qc.qc(out, outdir=outdir, **kw)
    qc.save_report(r, outdir)
    print(r.text())
    return r


def cmd_doctor(a):
    import importlib
    ok = True
    for t in ["ffmpeg", "ffprobe", "convert", "vips", "exiftool", "sox"]:
        print(f"  {'✔' if has(t) else '✖'} {t}")
        ok &= has(t) or t in ("vips", "sox")
    for m in ["PIL", "numpy", "cv2", "scipy", "skimage", "av", "soundfile", "rembg", "onnxruntime",
              "torch", "faster_whisper", "demucs", "librosa", "scenedetect"]:
        try:
            mod = importlib.import_module(m)
            print(f"  ✔ {m} {getattr(mod, '__version__', '')}")
        except Exception:
            adv = m in ("torch", "faster_whisper", "demucs", "librosa", "scenedetect")
            print(f"  {'·' if adv else '✖'} {m} {'(capa avanzada, no instalada)' if adv else 'FALTA'}")
            ok &= adv
    models = list(Path.home().glob(".u2net/*.onnx")) + list(Path.home().glob(".rembg/models/*/*.onnx"))
    print(f"  {'✔' if models else '✖'} modelos de recorte: {', '.join(p.stem for p in models) or 'ninguno'}")
    print("  GPU:", "sí" if has("nvidia-smi") else "no (todo en CPU)")
    print("LISTO" if ok else "FALTAN DEPENDENCIAS → bash studio/setup.sh")


def cmd_new(a):
    p = ROOT / "proyectos" / a.nombre
    for sub in ["00_original", "01_trabajo", "02_export", "qc"]:
        (p / sub).mkdir(parents=True, exist_ok=True)
    notes = p / "NOTAS.md"
    if not notes.exists():
        notes.write_text(f"# {a.nombre}\n\n- Marca: {a.marca}\n- Pedido:\n- Entregables:\n- Decisiones:\n")
    print(p)


def cmd_probe(a):
    from lib import qc
    p = Path(a.archivo)
    if p.suffix.lower() in qc.IMG_EXT:
        from PIL import Image
        im = Image.open(p)
        print(json.dumps({"formato": im.format, "modo": im.mode, "tamaño": im.size,
                          "icc": bool(im.info.get("icc_profile")), "exif": bool(im.getexif())}, ensure_ascii=False))
    else:
        d = ffprobe(p)
        from lib.common import display_size, rotation
        for s in d["streams"]:
            if s.get("codec_type") == "video" and rotation(s):
                print(f"  ROTACIÓN {rotation(s)}° → tamaño visible {display_size(s)}")
            keys = ["index", "codec_type", "codec_name", "profile", "width", "height", "avg_frame_rate",
                    "pix_fmt", "color_space", "sample_rate", "channels", "duration", "bit_rate"]
            print({k: s[k] for k in keys if k in s})
        f = d["format"]
        print({k: f.get(k) for k in ["format_name", "duration", "size", "bit_rate"]})


def cmd_img(a):
    from lib import images as I
    out = Path(a.output)
    if a.op == "cutout":
        res = I.cutout(I.load(a.input), model=a.model, box=a.box)
        if a.trim:
            res = I.trim(res)
        I.save(res, out)
    elif a.op == "product":
        size = fmt_size(a.fmt)
        margin = a.margin if a.margin is not None else (PRESETS["imagen"]["margen_ml"] if a.fmt == "ml" else None)
        bg = a.bg
        if out.suffix.lower() == ".png" and a.bg == "white" and a.transparent:
            bg = "transparent"
        res, meta = I.product_shot(a.input, size, bg=bg, margin=margin, shadow=not a.no_shadow,
                                   model=a.model, box=a.box)
        # el recorte intermedio se guarda y pasa por QC: el JPG final ya no tiene alfa para evaluar
        cut = out.parent.parent / "01_trabajo" / (out.stem + "_recorte.png")
        if not cut.parent.exists():
            cut = out.with_name(out.stem + "_recorte.png")
        I.save(meta["cutout"], cut)
        rc = _qc(cut)
        if rc.status == "FAIL":
            print("  ✖ RECORTE NO APTO: no entregar. Indicar --box x0,y0,x1,y1 o usar otra foto.")
        if meta["upscaled"]:
            print(f"  ▲ aviso: el producto se amplió x{meta['escala']} — la original es más chica que el destino")
        I.save(res, out)
    elif a.op == "fit":
        res = I.fit(I.load(a.input), fmt_size(a.fmt), mode=a.mode, color=a.bg if a.bg.startswith("#") else "#FFFFFF")
        I.save(res, out)
    elif a.op == "enhance":
        res = I.enhance(I.load(a.input), sharpen=a.sharpen, denoise=a.denoise)
        I.save(res, out)
    print(f"→ {out}")
    _qc(out, expect=a.fmt if a.op in ("product", "fit") else None)


def cmd_vid(a):
    from lib import video as V
    out = Path(a.output)
    if a.op == "encode":
        if a.fmt:
            from lib.common import display_size
            _, vs, _ = V.info(a.inputs[0])
            sw, sh = display_size(vs)
            tw, th = fmt_size(a.fmt)
            k = max(tw / sw, th / sh) if a.mode == "crop" else min(tw / sw, th / sh)
            if k > 1.05:
                print(f"  ▲ aviso: la fuente ({sw}x{sh}) se amplía x{k:.2f}; no va a tener más detalle que el original")
        V.encode(a.inputs[0], out, profile=a.profile, size=fmt_size(a.fmt) if a.fmt else None,
                 mode=a.mode, x=a.x, start=a.start, end=a.end, fps=a.fps, mute=a.mute)
    elif a.op == "slideshow":
        texts = a.textos.split("|") if a.textos else None
        _, meta = V.slideshow(a.inputs, out, size=fmt_size(a.fmt or "reel"), per=a.per, trans=a.trans,
                              fps=a.fps or 30, product=not a.foto, bg=a.bg, texts=texts, logo=a.logo,
                              cta=a.cta, cta_sub=a.cta_sub, audio=a.audio, profile=a.profile)
        print(f"  {meta}")
    print(f"→ {out}")
    _qc(out, expect=a.fmt or ("reel" if a.op == "slideshow" else None), fps=a.fps)


def cmd_qc(a):
    r = _qc(a.archivo, outdir=a.outdir, expect=a.expect, fps=a.fps, max_dur=a.max_dur)
    sys.exit(1 if r.status == "FAIL" else 0)


def main():
    p = argparse.ArgumentParser(prog="studio", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    sp.add_parser("doctor").set_defaults(fn=cmd_doctor)
    n = sp.add_parser("new"); n.add_argument("nombre"); n.add_argument("--marca", default="virtualshopbaires"); n.set_defaults(fn=cmd_new)
    pr = sp.add_parser("probe"); pr.add_argument("archivo"); pr.set_defaults(fn=cmd_probe)

    im = sp.add_parser("img")
    im.add_argument("op", choices=["cutout", "product", "fit", "enhance"])
    im.add_argument("input"); im.add_argument("-o", "--output", required=True)
    im.add_argument("--fmt", default="feed11", help="preset (reel, feed45, feed11, ml, web...) o WxH")
    im.add_argument("--bg", default="white", help="white | transparent | #hex | grad:#a:#b")
    im.add_argument("--mode", default="blur", choices=["blur", "pad", "crop"])
    im.add_argument("--margin", type=float); im.add_argument("--no-shadow", action="store_true")
    im.add_argument("--transparent", action="store_true"); im.add_argument("--trim", action="store_true")
    im.add_argument("--model", default="birefnet-general-lite", help="birefnet-general-lite (calidad) | isnet-general-use (rápido) | u2net")
    im.add_argument("--box", type=lambda v: tuple(int(x) for x in v.split(",")),
                    help="x0,y0,x1,y1 zona del producto (fotos de ambiente)")
    im.add_argument("--sharpen", type=float, default=0.6); im.add_argument("--denoise", type=int, default=0)
    im.set_defaults(fn=cmd_img)

    v = sp.add_parser("vid")
    v.add_argument("op", choices=["encode", "slideshow"])
    v.add_argument("inputs", nargs="+"); v.add_argument("-o", "--output", required=True)
    v.add_argument("--profile", default="social", choices=list(PRESETS["perfiles_video"]))
    v.add_argument("--fmt"); v.add_argument("--mode", default="blur", choices=["blur", "pad", "crop"])
    v.add_argument("--x", default="center", help="encuadre horizontal en crop: center o 0..1")
    v.add_argument("--start", type=float); v.add_argument("--end", type=float)
    v.add_argument("--fps", type=float); v.add_argument("--mute", action="store_true")
    v.add_argument("--per", type=float, default=2.8); v.add_argument("--trans", type=float, default=0.45)
    v.add_argument("--foto", action="store_true", help="slideshow sin recorte de producto (fotos de ambiente)")
    v.add_argument("--bg", default="grad:#FFFFFF:#E6EBF2")
    v.add_argument("--textos", help="textos por imagen separados por |")
    v.add_argument("--logo"); v.add_argument("--cta"); v.add_argument("--cta-sub"); v.add_argument("--audio")
    v.set_defaults(fn=cmd_vid)

    q = sp.add_parser("qc"); q.add_argument("archivo"); q.add_argument("--expect"); q.add_argument("--fps", type=float)
    q.add_argument("--max-dur", type=float); q.add_argument("--outdir"); q.set_defaults(fn=cmd_qc)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
