"""Procesamiento de imágenes para e-commerce y redes.

Principio: fidelidad del producto. Nada de esto redibuja, inventa ni cambia colores de
etiquetas/logos: recorta, limpia bordes, encuadra, corrige exposición/balance de forma
global y suave, y exporta.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageFilter, ImageOps

from .common import PRESETS, fmt_size, hex_rgb

_SESSIONS = {}
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


# ---------------------------------------------------------------- carga / guardado
def load(path):
    """Abre respetando orientación EXIF y convirtiendo a sRGB si trae perfil ICC."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    icc = im.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(__import__("io").BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            mode = "RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB"
            im = ImageCms.profileToProfile(im.convert(mode), src, dst, outputMode=mode)
        except Exception:
            pass
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode or im.mode == "P" else "RGB")
    return im


def save(im, out, quality=None):
    """Guarda según extensión con perfil sRGB embebido. JPG nunca lleva alfa."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    ext = out.suffix.lower()
    q = PRESETS["imagen"]
    if ext in (".jpg", ".jpeg"):
        if im.mode == "RGBA":
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[3])
            im = bg
        im.convert("RGB").save(out, quality=quality or q["jpg_q"], subsampling=0,
                               optimize=True, progressive=True, icc_profile=SRGB)
    elif ext == ".webp":
        im.save(out, quality=quality or q["webp_q"], method=6, icc_profile=SRGB)
    elif ext == ".png":
        im.save(out, optimize=True, icc_profile=SRGB)
    else:
        im.save(out)
    return out


# ---------------------------------------------------------------- recorte de fondo
def _session(model):
    from rembg import new_session
    if model not in _SESSIONS:
        _SESSIONS[model] = new_session(model)
    return _SESSIONS[model]


def alpha_mask(im, model="birefnet-general-lite"):
    """Máscara alfa 0-255 (uint8) del sujeto principal."""
    from rembg import remove
    m = remove(im.convert("RGB"), session=_session(model), only_mask=True)
    a = np.array(m.convert("L"))
    # limpiar ruido: valores casi nulos a 0, casi plenos a 255
    a[a < 10] = 0
    a[a > 245] = 255
    # eliminar islas diminutas (< 0.15% del área del sujeto)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 127).astype(np.uint8), 8)
    if n > 2:
        total = stats[1:, cv2.CC_STAT_AREA].sum()
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 0.0015 * total:
                a[lab == i] = 0
    return a


def decontaminate(rgb, a):
    """Quita el color del fondo original que queda 'pegado' en los bordes semitransparentes
    (halos blancos/grises). Estima el fondo detrás del borde y resuelve
    I = a*F + (1-a)*B  ->  F = (I - (1-a)*B) / a.
    """
    rgb = rgb.astype(np.float32)
    af = a.astype(np.float32) / 255.0
    h, w = a.shape
    # fondo estimado: inpaint de la zona del sujeto, a baja resolución por velocidad
    s = max(1, int(max(h, w) / 512))
    small = cv2.resize(rgb, (w // s, h // s), interpolation=cv2.INTER_AREA)
    fgm = cv2.resize((a > 0).astype(np.uint8) * 255, (w // s, h // s), interpolation=cv2.INTER_NEAREST)
    fgm = cv2.dilate(fgm, np.ones((5, 5), np.uint8))
    bg = cv2.inpaint(small.clip(0, 255).astype(np.uint8), fgm, 7, cv2.INPAINT_TELEA)
    bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)
    a3 = np.maximum(af, 1e-3)[..., None]
    F = (rgb - (1 - af[..., None]) * bg) / a3
    F = F.clip(0, 255)
    # donde el alfa es muy bajo la ecuación es inestable: extender color del interior
    low = ((af > 0) & (af < 0.25)).astype(np.uint8) * 255
    if low.any():
        F8 = F.astype(np.uint8)
        ext = cv2.inpaint(F8, low, 3, cv2.INPAINT_TELEA).astype(np.float32)
        F = np.where(low[..., None] > 0, ext, F)
    edge = (af > 0) & (af < 1)
    out = rgb.copy()
    out[edge] = F[edge]
    return out.clip(0, 255).astype(np.uint8)


def cutout(im, model="birefnet-general-lite", feather=0.6, box=None):
    """Devuelve RGBA con alfa real y bordes descontaminados.
    box=(x0,y0,x1,y1): zona donde está el producto (fotos de ambiente / collages).
    Se segmenta solo esa zona y lo de afuera queda transparente."""
    if box:
        x0, y0, x1, y1 = box
        pad = int(0.04 * max(x1 - x0, y1 - y0))
        cx0, cy0 = max(0, x0 - pad), max(0, y0 - pad)
        cx1, cy1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
        im = im.crop((cx0, cy0, cx1, cy1))
    rgb = np.array(im.convert("RGB"))
    a = alpha_mask(im, model)
    if feather > 0:  # suavizado sub-pixel muy leve: evita bordes 'serruchados'
        a = cv2.GaussianBlur(a, (0, 0), feather)
    clean = decontaminate(rgb, a)
    rgba = np.dstack([clean, a])
    # píxeles totalmente transparentes con RGB neutro (evita halos al reescalar en otras apps)
    rgba[a == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA")


def matte_quality(a):
    """Fracción de píxeles semitransparentes dentro del sujeto. Un recorte limpio de
    producto ronda 2-8 %; > 15 % indica máscara 'nublada' (collage, ambiente, sujeto ambiguo)."""
    fg = a > 0
    if fg.sum() == 0:
        return 1.0
    return float(((a > 0) & (a < 230)).sum() / fg.sum())


def trim(rgba, thr=8):
    a = np.array(rgba.split()[3])
    ys, xs = np.where(a > thr)
    if len(xs) == 0:
        return rgba
    return rgba.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


# ---------------------------------------------------------------- composición
def _resize_premult(rgba, size):
    """Reescala RGBA en alfa premultiplicado (evita bordes oscuros/claros)."""
    arr = np.array(rgba).astype(np.float32) / 255.0
    a = arr[..., 3:4]
    pm = np.concatenate([arr[..., :3] * a, a], axis=2)
    interp = cv2.INTER_AREA if size[0] < rgba.width else cv2.INTER_LANCZOS4
    pm = cv2.resize(pm, size, interpolation=interp).clip(0, 1)
    a2 = pm[..., 3:4]
    rgb = np.where(a2 > 1e-4, pm[..., :3] / np.maximum(a2, 1e-4), 0)
    out = np.concatenate([rgb, a2], axis=2)
    return Image.fromarray((out * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def make_background(size, bg):
    """bg: 'white' | 'transparent' | '#RRGGBB' | 'grad:#AAAAAA:#BBBBBB' (vertical)."""
    w, h = size
    if bg == "transparent":
        return Image.new("RGBA", size, (0, 0, 0, 0))
    if bg == "white":
        return Image.new("RGBA", size, (255, 255, 255, 255))
    if bg.startswith("grad:"):
        _, c1, c2 = bg.split(":")
        c1, c2 = np.array(hex_rgb(c1), np.float32), np.array(hex_rgb(c2), np.float32)
        t = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        arr = (c1 * (1 - t) + c2 * t).repeat(w, axis=1)
        arr = arr + np.random.default_rng(0).normal(0, 0.6, arr.shape)  # dither anti-banding
        rgb = arr.clip(0, 255).astype(np.uint8)
        return Image.fromarray(np.dstack([rgb, np.full((h, w), 255, np.uint8)]), "RGBA")
    return Image.new("RGBA", size, (*hex_rgb(bg), 255))


def contact_shadow(prod, canvas_size, pos, strength=0.22):
    """Sombra de apoyo suave bajo el producto, derivada de su propia silueta."""
    W, H = canvas_size
    x, y = pos
    pw, ph = prod.size
    a = np.array(prod.split()[3]).astype(np.float32) / 255
    # silueta aplastada verticalmente y apoyada en la base
    sh_h = max(4, int(ph * 0.10))
    flat = cv2.resize(a, (pw, sh_h), interpolation=cv2.INTER_AREA)
    layer = np.zeros((H, W), np.float32)
    top = min(H - sh_h, y + ph - int(sh_h * 0.55))
    x0, x1 = max(0, x), min(W, x + pw)
    layer[top:top + sh_h, x0:x1] = flat[:, x0 - x:x1 - x]
    layer = cv2.GaussianBlur(layer, (0, 0), max(2, pw * 0.025))
    layer = (layer / max(layer.max(), 1e-6)) * strength
    return Image.fromarray((layer * 255).astype(np.uint8), "L")


def product_shot(src, out_size=(1080, 1080), bg="white", margin=None, shadow=True,
                 model="birefnet-general-lite", already_cut=False, box=None, area=None):
    """Producto recortado, centrado, con margen, sombra de apoyo opcional y fondo.
    area=(x0,y0,x1,y1) en fracciones del lienzo: zona donde ubicar el producto
    (p. ej. dejar libre la franja del logo y la del texto en un reel)."""
    im = load(src) if not isinstance(src, Image.Image) else src
    rgba = im if already_cut else cutout(im, model, box=box)
    mq = matte_quality(np.array(rgba.split()[3]))
    rgba = trim(rgba)
    margin = PRESETS["imagen"]["margen_producto"] if margin is None else margin
    W, H = out_size
    ax0, ay0, ax1, ay1 = area or (0, 0, 1, 1)
    aw, ah = W * (ax1 - ax0), H * (ay1 - ay0)
    avail_w, avail_h = aw - 2 * margin * W, ah - 2 * margin * H if area is None else ah
    k = min(avail_w / rgba.width, avail_h / rgba.height)
    nw, nh = max(1, round(rgba.width * k)), max(1, round(rgba.height * k))
    prod = _resize_premult(rgba, (nw, nh))
    x, y = int(W * ax0 + (aw - nw) / 2), int(H * ay0 + (ah - nh) / 2)
    canvas = make_background(out_size, bg)
    if shadow and bg != "transparent":
        sh = contact_shadow(prod, out_size, (x, y))
        dark = Image.new("RGBA", out_size, (0, 0, 0, 255))
        canvas = Image.composite(dark, canvas, sh)
    canvas.alpha_composite(prod, (x, y))
    return canvas, {"escala": round(k, 3), "producto_px": (nw, nh), "upscaled": k > 1.0,
                    "mascara_semitransp": round(mq, 3), "mascara_dudosa": mq > 0.15, "cutout": rgba}


def fit(im, out_size, mode="blur", color="#FFFFFF"):
    """Adapta una imagen a otro formato SIN deformar.
    blur: imagen completa sobre su propia versión desenfocada (sin recortar el producto)
    pad:  imagen completa sobre color plano
    crop: cubre el lienzo recortando lo que sobra (centrado)
    """
    W, H = out_size
    im = im.convert("RGB")
    if mode == "crop":
        return ImageOps.fit(im, out_size, Image.LANCZOS, centering=(0.5, 0.5))
    k = min(W / im.width, H / im.height)
    fg = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    if mode == "pad":
        bg = Image.new("RGB", out_size, hex_rgb(color) if color.startswith("#") else color)
    else:
        bg = ImageOps.fit(im, out_size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(max(W, H) / 30))
        bg = Image.blend(bg, Image.new("RGB", out_size, (0, 0, 0)), 0.18)
    bg.paste(fg, ((W - fg.width) // 2, (H - fg.height) // 2))
    return bg


# ---------------------------------------------------------------- mejora
def enhance(im, wb=True, levels=True, sharpen=0.6, denoise=0):
    """Corrección global conservadora: balance de blancos (gris mundial limitado),
    niveles con recorte 0.3%, nitidez por máscara de enfoque. Sin filtros 'de app'."""
    has_a = im.mode == "RGBA"
    alpha = im.split()[3] if has_a else None
    arr = np.array(im.convert("RGB")).astype(np.float32)
    if denoise > 0:
        arr = cv2.fastNlMeansDenoisingColored(arr.astype(np.uint8), None, denoise, denoise, 7, 21).astype(np.float32)
    if wb:
        lum = arr.mean(axis=2)
        sel = (lum > 30) & (lum < 235)
        means = arr[sel].mean(axis=0) if sel.sum() > 500 else arr.reshape(-1, 3).mean(axis=0)
        gains = means.mean() / np.maximum(means, 1)
        gains = np.clip(gains, 0.9, 1.1)  # limitado: corrige dominantes, no cambia colores del producto
        arr *= gains
    if levels:
        lo, hi = np.percentile(arr.mean(axis=2), [0.3, 99.7])
        lo, hi = min(lo, 20), max(hi, 235)  # nunca estira de más
        arr = (arr - lo) * (255.0 / max(hi - lo, 1))
    arr = arr.clip(0, 255).astype(np.uint8)
    out = Image.fromarray(arr)
    if sharpen > 0:
        r = max(1.0, max(out.size) / 1500)
        out = out.filter(ImageFilter.UnsharpMask(radius=r, percent=int(sharpen * 100), threshold=3))
    if has_a:
        out.putalpha(alpha)
    return out
