"""Control de calidad automático. Devuelve un informe con PASS / WARN / FAIL por chequeo
y genera hojas de contacto para revisión visual (Claude las mira antes de entregar)."""
import json
import re
import struct
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .common import display_size, ffprobe, find_font, fmt_size, parse_rate, rotation, run

IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".heic", ".avif"}


class Report:
    def __init__(self, path):
        self.path = str(path)
        self.items = []
        self.data = {}
        self.previews = []

    def add(self, level, check, msg):
        self.items.append({"nivel": level, "chequeo": check, "detalle": msg})

    @property
    def status(self):
        lv = {i["nivel"] for i in self.items}
        return "FAIL" if "FAIL" in lv else "WARN" if "WARN" in lv else "PASS"

    def to_dict(self):
        return {"archivo": self.path, "estado": self.status, "datos": self.data,
                "chequeos": self.items, "previews": self.previews}

    def text(self):
        icon = {"PASS": "✔", "WARN": "▲", "FAIL": "✖", "INFO": "·"}
        lines = [f"QC {self.status}  {self.path}"]
        lines += [f"  {icon[i['nivel']]} {i['chequeo']}: {i['detalle']}" for i in self.items]
        lines += [f"  ↳ preview: {p}" for p in self.previews]
        return "\n".join(lines)


# ---------------------------------------------------------------- imágenes
def _checker(size, sq=16):
    w, h = size
    y, x = np.mgrid[0:h, 0:w]
    c = (((x // sq) + (y // sq)) % 2) * 40 + 200
    return np.dstack([c, c, c]).astype(np.uint8)


def image_qc(path, expect=None, outdir=None):
    r = Report(path)
    im = Image.open(path)
    r.data.update(formato=im.format, modo=im.mode, ancho=im.width, alto=im.height,
                  peso_kb=round(Path(path).stat().st_size / 1024, 1),
                  icc=bool(im.info.get("icc_profile")))
    r.add("INFO", "dimensiones", f"{im.width}x{im.height} {im.format} {im.mode} {r.data['peso_kb']} KB")
    if expect:
        ew, eh = fmt_size(expect)
        r.add("PASS" if (im.width, im.height) == (ew, eh) else "FAIL", "resolución esperada",
              f"esperado {ew}x{eh}")
    arr = np.array(im.convert("RGBA"))
    a = arr[..., 3]
    has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    if has_alpha and (a < 255).any():
        semi = ((a > 0) & (a < 255)).mean()
        r.data["alfa_transparente_%"] = round((a == 0).mean() * 100, 1)
        r.add("PASS", "canal alfa", f"real ({r.data['alfa_transparente_%']}% transparente)")
        mq = float(((a > 0) & (a < 230)).sum() / max((a > 0).sum(), 1))
        r.data["mascara_semitransp"] = round(mq, 3)
        r.add("FAIL" if mq > 0.15 else "WARN" if mq > 0.08 else "PASS", "calidad de máscara",
              f"{mq*100:.1f}% del sujeto semitransparente (limpio < 8%, >15% = recorte fallido: "
              "probar --box o revisar si la foto es collage/ambiente)")
        # halo: bordes semitransparentes mucho más claros que el interior adyacente
        edge = (a > 20) & (a < 200)
        inner = cv2.erode((a == 255).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)
        ring = cv2.dilate(edge.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & inner
        if edge.sum() > 50 and ring.sum() > 50:
            le = arr[..., :3][edge].mean()
            li = arr[..., :3][ring].mean()
            diff = le - li
            r.data["halo_delta_luma"] = round(float(diff), 1)
            lvl = "FAIL" if diff > 45 else "WARN" if diff > 25 else "PASS"
            r.add(lvl, "halos de borde", f"Δluma borde-interior = {diff:+.1f} (umbral 25/45)")
        sides = {"arriba": a[0, :], "abajo": a[-1, :], "izq": a[:, 0], "der": a[:, -1]}
        touching = [k for k, v in sides.items() if (v > 128).mean() > 0.05]
        if touching and len(touching) < 4 and not all((v > 0).any() for v in sides.values()):
            r.add("WARN", "sujeto toca el borde", f"{', '.join(touching)} (¿producto cortado en la foto original?)")
        if outdir:  # previews sobre damero, negro y blanco para revisar bordes
            outdir = Path(outdir)
            outdir.mkdir(parents=True, exist_ok=True)
            k = min(1.0, 700 / max(im.size))
            small = Image.fromarray(arr).resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
            sa = np.array(small).astype(np.float32)
            al = sa[..., 3:4] / 255
            tiles = [_checker(small.size)] + [np.full_like(sa[..., :3], v) for v in (0, 255)]
            tiles = [(t * (1 - al) + sa[..., :3] * al).astype(np.uint8) for t in tiles]
            sheet = np.concatenate(tiles, axis=1)
            p = outdir / (Path(path).stem + "_qc_alfa.jpg")
            Image.fromarray(sheet).save(p, quality=88)
            r.previews.append(str(p))
    elif has_alpha:
        r.add("INFO", "canal alfa", "presente pero totalmente opaco")
    vis = a > 0  # estadísticas solo sobre píxeles visibles
    rgb = arr[..., :3].astype(np.float32)[vis] if vis.any() else arr[..., :3].reshape(-1, 3).astype(np.float32)
    lum = rgb.mean(axis=1)
    clip_hi, clip_lo = (lum >= 254).mean(), (lum <= 1).mean()
    r.data.update(luma_media=round(float(lum.mean()), 1))
    gray = cv2.cvtColor(arr[..., :3], cv2.COLOR_RGB2GRAY)
    sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
    r.data["nitidez_laplaciano"] = round(float(sharp), 1)
    r.add("WARN" if sharp < 30 else "PASS", "nitidez", f"varianza laplaciana {sharp:.0f} (<30 = posible desenfoque)")
    if clip_lo > 0.05:
        r.add("WARN", "sombras quemadas", f"{clip_lo*100:.1f}% en negro puro")
    if min(im.size) < 800:
        r.add("WARN", "resolución baja", "lado menor < 800 px; no apto para ficha de producto grande")
    if im.format == "JPEG" and has_alpha:
        r.add("FAIL", "formato", "JPEG no soporta transparencia")
    return r


# ---------------------------------------------------------------- video
def _faststart(path):
    """True si el átomo moov está antes que mdat (reproducción inmediata en web/redes)."""
    try:
        with open(path, "rb") as f:
            while True:
                hdr = f.read(8)
                if len(hdr) < 8:
                    return None
                size, typ = struct.unpack(">I4s", hdr)
                if typ == b"moov":
                    return True
                if typ == b"mdat":
                    return False
                if size == 1:
                    size = struct.unpack(">Q", f.read(8))[0]
                    f.seek(size - 16, 1)
                elif size == 0:
                    return None
                else:
                    f.seek(size - 8, 1)
    except Exception:
        return None


def contact_sheet(path, out, n=12, cols=4, width=1400):
    d = ffprobe(path)
    dur = float(d["format"].get("duration", 0) or 0)
    font = ImageFont.truetype(find_font("Inter", "SemiBold") or find_font(), 22)
    frames = []
    with tempfile.TemporaryDirectory() as td:
        for i in range(n):
            t = dur * (i + 0.5) / n
            fp = Path(td) / f"{i:03d}.png"
            run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", str(fp)], check=False)
            if fp.exists():
                frames.append((t, Image.open(fp).convert("RGB")))
    if not frames:
        return None
    tw = width // cols
    th = int(tw * frames[0][1].height / frames[0][1].width)
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (tw * cols, th * rows), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for i, (t, fr) in enumerate(frames):
        x, y = (i % cols) * tw, (i // cols) * th
        sheet.paste(fr.resize((tw - 4, th - 4), Image.LANCZOS), (x + 2, y + 2))
        dr.rectangle((x + 6, y + 6, x + 96, y + 36), fill=(0, 0, 0))
        dr.text((x + 12, y + 8), f"{t:5.2f}s", font=font, fill=(255, 255, 0))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88)
    return str(out)


def video_qc(path, expect=None, fps=None, outdir=None, max_dur=None):
    r = Report(path)
    d = ffprobe(path)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    fmt = d["format"]
    if v is None:
        r.add("FAIL", "pista de video", "no hay")
        return r
    dur = float(fmt.get("duration", 0) or 0)
    vfps = parse_rate(v.get("avg_frame_rate", "0/1"))
    r.data.update(contenedor=fmt.get("format_name"), duracion_s=round(dur, 3),
                  codec=v.get("codec_name"), perfil=v.get("profile"), ancho=v.get("width"),
                  alto=v.get("height"), fps=round(vfps, 3), pix_fmt=v.get("pix_fmt"),
                  sar=v.get("sample_aspect_ratio", "1:1"), bitrate_kbps=round(int(fmt.get("bit_rate", 0)) / 1000),
                  peso_mb=round(int(fmt.get("size", 0)) / 1e6, 2),
                  audio=(f"{a['codec_name']} {a.get('sample_rate')}Hz {a.get('channels')}ch" if a else None))
    rot = rotation(v)
    if rot:
        dw, dh = display_size(v)
        r.data.update(rotacion=rot, visible=f"{dw}x{dh}")
        r.add("WARN", "rotación por metadato", f"{rot}° → se ve {dw}x{dh}; algunos reproductores la ignoran")
    r.add("INFO", "resumen", f"{v['width']}x{v['height']} {vfps:.2f}fps {v['codec_name']} {dur:.2f}s "
                            f"{r.data['bitrate_kbps']}kbps {r.data['peso_mb']}MB audio={r.data['audio']}")
    if expect:
        ew, eh = fmt_size(expect)
        r.add("PASS" if (v["width"], v["height"]) == (ew, eh) else "FAIL", "resolución esperada", f"esperado {ew}x{eh}")
    if fps:
        r.add("PASS" if abs(vfps - fps) < 0.05 else "FAIL", "fps esperado", f"esperado {fps}")
    if max_dur:
        r.add("PASS" if dur <= max_dur else "FAIL", "duración máxima", f"{dur:.2f}s / máx {max_dur}s")
    sar = v.get("sample_aspect_ratio", "1:1")
    r.add("PASS" if sar in ("1:1", "0:1", None) else "WARN", "píxel cuadrado", f"SAR {sar}")
    r.add("PASS" if v.get("pix_fmt") == "yuv420p" else "WARN", "compatibilidad pix_fmt",
          f"{v.get('pix_fmt')} (yuv420p = universal)")
    if v.get("codec_name") == "h264" and v["width"] % 2 + v["height"] % 2:
        r.add("FAIL", "dimensiones pares", "H.264 requiere ancho/alto pares")
    if fmt.get("format_name", "").startswith("mov"):
        fs = _faststart(path)
        r.add("PASS" if fs else "WARN", "faststart", "moov al inicio" if fs else "moov al final (carga lenta en web)")
    # decodificación completa: detecta cuadros corruptos
    dec = run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=False)
    errs = [l for l in dec.stderr.splitlines() if l.strip()]
    r.add("PASS" if not errs else "FAIL", "decodificación completa",
          "sin errores" if not errs else f"{len(errs)} errores: {errs[0][:120]}")
    # negros y congelados
    an = run(["ffmpeg", "-v", "info", "-i", str(path), "-vf",
              "blackdetect=d=0.4:pix_th=0.08,freezedetect=n=0.002:d=2", "-an", "-f", "null", "-"], check=False)
    blacks = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", an.stderr)
    freezes = re.findall(r"freeze_start: ([\d.]+)", an.stderr)
    r.add("WARN" if blacks else "PASS", "cuadros negros",
          ", ".join(f"{float(s):.2f}-{float(e):.2f}s" for s, e in blacks) or "ninguno")
    r.add("INFO" if freezes else "PASS", "imagen congelada >2s",
          (", ".join(f"{float(s):.2f}s" for s in freezes) + " (normal en placas fijas)") if freezes else "ninguna")
    # sonoridad
    if a:
        eb = run(["ffmpeg", "-v", "info", "-i", str(path), "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], check=False)
        I_ = re.findall(r"I:\s+(-?[\d.]+) LUFS", eb.stderr)
        tp = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", eb.stderr)
        if I_:
            lufs = float(I_[-1])
            peak = float(tp[-1]) if tp else None
            r.data.update(lufs=lufs, true_peak_dbfs=peak)
            r.add("PASS" if -17 <= lufs <= -12 else "WARN", "sonoridad", f"{lufs} LUFS (redes ≈ -14)")
            if peak is not None:
                r.add("PASS" if peak <= -1.0 else "WARN", "true peak", f"{peak} dBFS (≤ -1)")
        av_diff = abs(float(a.get("duration", dur) or dur) - float(v.get("duration", dur) or dur))
        r.add("PASS" if av_diff < 0.1 else "WARN", "duración audio/video", f"diferencia {av_diff:.3f}s")
    if outdir:
        cs = contact_sheet(path, Path(outdir) / (Path(path).stem + "_qc_contacto.jpg"))
        if cs:
            r.previews.append(cs)
    return r


def qc(path, **kw):
    ext = Path(path).suffix.lower()
    if ext in IMG_EXT:
        kw.pop("fps", None); kw.pop("max_dur", None)
        return image_qc(path, **kw)
    return video_qc(path, **kw)


def save_report(r, outdir):
    p = Path(outdir) / (Path(r.path).stem + "_qc.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(r.to_dict(), indent=2, ensure_ascii=False))
    return p
