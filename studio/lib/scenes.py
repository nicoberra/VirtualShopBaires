"""Ambientes procedurales para fotos de producto (sin IA generativa).

El producto se compone SIN modificarlo. El fondo se construye por código:
piso en perspectiva con escala física coherente con el tamaño real del producto,
pared, luz, profundidad de campo, sombras de contacto, grano unificado.
"""
import cv2
import numpy as np
from PIL import Image

from .images import _resize_premult, trim

RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- ruido
def _noise(h, w, scale, rng=RNG):
    """Value noise suave: ruido aleatorio a baja resolución, interpolado."""
    sh, sw = max(2, int(h / scale)), max(2, int(w / scale))
    n = rng.random((sh, sw)).astype(np.float32)
    return cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC)


def _fbm(h, w, base, octaves=4, rng=RNG):
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += _noise(h, w, base / (2 ** o), rng) * amp
        tot += amp
        amp *= 0.5
    return out / tot


# ---------------------------------------------------------------- texturas de piso (vista cenital)
# Unidad: PX_CM píxeles de textura por centímetro real.
PX_CM = 4


def tex_rubber(size_cm=400):
    """Piso de caucho de gimnasio en rollo continuo: negro con gránulos EPDM finos y de bajo contraste."""
    n = size_cm * PX_CM
    base = 33 + 5 * _fbm(n, n, 80 * PX_CM) + 2.5 * (RNG.random((n, n)) - 0.5)
    img = np.dstack([base, base, base + 1.2]).astype(np.float32)
    # gránulos de 1-3 mm: a nivel de píxel de textura, densos y apagados
    m = RNG.random((n, n))
    gray = (m < 0.10)
    light = (m < 0.018)
    color = (m > 0.997)
    img[gray] = img[gray] * 0.4 + np.array([66, 66, 68], np.float32) * 0.6
    img[light] = np.array([98, 98, 100], np.float32)
    img[color] = np.array([92, 52, 50], np.float32)
    img = cv2.GaussianBlur(img, (0, 0), 0.6)
    return img.clip(0, 255)


def tex_wood(size_cm=400, tone=(168, 134, 102)):
    """Parqué de roble claro: tablas de 14 cm x 120 cm, desfasadas, con veta."""
    n = size_cm * PX_CM
    pw, pl = 14 * PX_CM, 120 * PX_CM
    img = np.zeros((n, n, 3), np.float32)
    base = np.array(tone, np.float32)
    rows = n // pw + 1
    for r in range(rows):
        y0 = r * pw
        off = int(RNG.integers(0, pl))
        x = -off
        while x < n:
            x0, x1 = max(0, x), min(n, x + pl)
            y1 = min(n, y0 + pw)
            if x1 > x0 and y1 > y0:
                hh, ww = y1 - y0, x1 - x0
                var = RNG.uniform(0.86, 1.10)
                # veta: ruido estirado a lo largo de la tabla
                g = _noise(hh, ww * 1, 1.0)  # placeholder fino
                streak = cv2.resize(RNG.random((max(2, hh // 2), max(2, ww // 60))).astype(np.float32),
                                    (ww, hh), interpolation=cv2.INTER_CUBIC)
                fine = cv2.resize(RNG.random((hh, max(2, ww // 12))).astype(np.float32), (ww, hh),
                                  interpolation=cv2.INTER_LINEAR)
                wv = 0.78 + 0.18 * streak + 0.12 * fine + 0.02 * g
                img[y0:y1, x0:x1] = base * var * wv[..., None]
                img[y0:y1, x0:x0 + 1] *= 0.80   # junta de cabeza
            x += pl
        img[y0:y0 + 1, :] *= 0.80                # junta lateral
    img = cv2.GaussianBlur(img, (0, 0), 0.7)
    # tablas en dirección a la cámara (eje z): más natural en fotografía de interiores
    return np.ascontiguousarray(img.transpose(1, 0, 2)).clip(0, 255)


# ---------------------------------------------------------------- proyección del piso
def render_floor(tex, W, H, horizon, f, cam_h, x_center_cm=0.0, z_offset_cm=0.0):
    """Proyecta la textura cenital sobre el piso (y > horizon) con una cámara pinhole.
    f: distancia focal en px; cam_h: altura de cámara en cm. Devuelve imagen y mapa de profundidad (cm)."""
    n = tex.shape[0]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    dy = np.maximum(ys - horizon, 0.5)
    z = f * cam_h / dy                       # distancia en cm
    xw = (xs - W / 2) * z / f + x_center_cm  # posición lateral en cm
    u = (xw * PX_CM) % n
    v = ((z + z_offset_cm) * PX_CM) % n
    # antialias: mip simple según distancia (textura pre-desenfocada en 3 niveles)
    levels = [tex, cv2.GaussianBlur(tex, (0, 0), 2), cv2.GaussianBlur(tex, (0, 0), 6)]
    px_per_cm = f / z                        # píxeles de pantalla por cm de piso
    out = np.zeros((H, W, 3), np.float32)
    lv = np.clip(np.log2(PX_CM / np.maximum(px_per_cm, 1e-3)) / 1.6, 0, 2)
    samples = [cv2.remap(t, u, v, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP) for t in levels]
    i0 = np.floor(lv).astype(int)
    fr = (lv - i0)[..., None]
    for k in range(3):
        k1 = min(k + 1, 2)
        sel = (i0 == k)[..., None]
        out += np.where(sel, samples[k] * (1 - fr) + samples[k1] * fr, 0)
    out[ys < horizon] = 0
    return out, z


def depth_blur(img, depth, focus, strength, max_sigma=14):
    """Profundidad de campo: desenfoque creciente con |1/z - 1/focus| (como una lente real)."""
    coc = np.abs(1.0 / np.maximum(depth, 1) - 1.0 / focus) * strength
    coc = np.clip(coc, 0, max_sigma)
    levels = [0, 1.5, 3, 6, 10, max_sigma]
    stack = [img if s == 0 else cv2.GaussianBlur(img, (0, 0), s) for s in levels]
    out = np.zeros_like(img)
    idx = np.interp(coc, levels, np.arange(len(levels)))
    i0 = np.floor(idx).astype(int)
    fr = (idx - i0)[..., None]
    for k in range(len(levels)):
        k1 = min(k + 1, len(levels) - 1)
        sel = (i0 == k)[..., None]
        out += np.where(sel, stack[k] * (1 - fr) + stack[k1] * fr, 0)
    return out


# ---------------------------------------------------------------- paredes
def wall_gym(W, H, y_floor, glow=(204, 18, 18)):
    """Pared de gimnasio: hormigón oscuro, foco cálido detrás del producto, brillo rojo de marca, bokeh."""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    conc = 30 + 10 * _fbm(H, W, 220) + 4 * _fbm(H, W, 18)
    img = np.dstack([conc, conc * 1.0, conc * 1.04])
    # foco de luz detrás del producto (cono suave)
    cx, cy = W * 0.5, y_floor * 0.75
    r = np.sqrt(((xs - cx) / (W * 0.55)) ** 2 + ((ys - cy) / (H * 0.42)) ** 2)
    spot = np.exp(-r ** 2 * 2.2)
    img += spot[..., None] * np.array([70, 64, 58], np.float32)
    # resplandor rojo de marca muy sutil, detrás y por encima del producto
    rg = np.exp(-(((xs - cx) / (W * 0.35)) ** 2 + ((ys - y_floor * 0.55) / (H * 0.22)) ** 2))
    img += rg[..., None] * np.array(glow, np.float32) * 0.10
    # bokeh: luces de techo lejanas
    bok = np.zeros((H, W), np.float32)
    for _ in range(9):
        x = RNG.uniform(0.05, 0.95) * W
        y = RNG.uniform(0.06, 0.40) * y_floor
        rr = RNG.uniform(0.018, 0.04) * W
        cv2.circle(bok, (int(x), int(y)), int(rr), float(RNG.uniform(0.35, 0.8)), -1, lineType=cv2.LINE_AA)
    bok = cv2.GaussianBlur(bok, (0, 0), W * 0.006)
    img += bok[..., None] * np.array([255, 226, 180], np.float32) * 0.45
    return img


def wall_home(W, H, y_floor, base=(236, 231, 224)):
    """Pared clara de living con luz de ventana desde la izquierda y zócalo blanco."""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.ones((H, W, 3), np.float32) * np.array(base, np.float32)
    img *= (0.97 + 0.03 * _fbm(H, W, 300))[..., None]
    light = 0.78 + 0.30 * np.exp(-((xs - W * 0.05) / (W * 0.75)) ** 2)  # ventana a la izquierda
    img *= light[..., None]
    # sombra suave de marco de ventana proyectada (diagonal) — sugiere luz natural
    pane = ((((xs * 0.9 + ys * 0.35) % (W * 0.42)) < W * 0.02) & (xs < W * 0.55)).astype(np.float32)
    pane = cv2.GaussianBlur(pane, (0, 0), W * 0.01)
    img *= (1 - 0.07 * pane)[..., None]
    # zócalo
    zh = int(H * 0.035)
    zb = (ys >= y_floor - zh) & (ys < y_floor)
    img[zb] = np.array([246, 245, 242], np.float32) * light[zb][..., None]
    img[(ys >= y_floor - zh) & (ys < y_floor - zh + 2)] *= 0.93
    return img


# ---------------------------------------------------------------- composición
def _shadows(alpha, W, H, x, y, mode, strength, light_dx=0.0):
    """Capa de oscurecimiento 0..1. mode 'standing': contacto en la franja inferior + sombra
    ambiente amplia; 'flat': objeto apoyado plano (sombra = silueta ajustada)."""
    a = alpha.astype(np.float32) / 255
    ph, pw = a.shape
    full = np.zeros((H, W), np.float32)
    full[y:y + ph, x:x + pw] = a
    sh = np.zeros((H, W), np.float32)
    rows = np.where(a.max(axis=1) > 0.5)[0]
    bottom = y + (rows.max() if len(rows) else ph)
    if mode == "flat":
        m = np.roll(full, (int(ph * 0.012), int(light_dx * pw * 0.02)), axis=(0, 1))
        sh += cv2.GaussianBlur(m, (0, 0), max(2, pw * 0.006)) * 0.55
        sh += cv2.GaussianBlur(m, (0, 0), max(4, pw * 0.03)) * 0.35
    else:
        band = full.copy()
        band[: max(0, bottom - int(ph * 0.04))] = 0          # solo lo que toca el piso
        band = cv2.dilate(band, np.ones((3, 9), np.uint8))
        sh += cv2.GaussianBlur(band, (0, 0), max(2, pw * 0.006)) * 1.0
        # sombra ambiente: silueta aplastada contra el piso
        flat = cv2.resize(a, (pw, max(3, int(ph * 0.12))), interpolation=cv2.INTER_AREA)
        amb = np.zeros((H, W), np.float32)
        ty = max(0, bottom - flat.shape[0] // 2)
        x0 = x + int(light_dx * pw * 0.08)
        xa, xb = max(0, x0), min(W, x0 + pw)
        yb = min(H, ty + flat.shape[0])
        amb[ty:yb, xa:xb] = flat[: yb - ty, xa - x0: xb - x0]
        sh += cv2.GaussianBlur(amb, (0, 0), max(4, pw * 0.035)) * 0.65
    sh *= (1 - full)  # nunca oscurecer el producto
    return np.clip(sh * strength, 0, 0.92)


def compose(product_rgba, scene="gym", size=(1080, 1350), width_frac=0.78, contact_y=0.74,
            horizon=None, real_width_cm=32.0, mode="standing", focus_offset_cm=0.0,
            dof=1.0, reflection=0.0, light_dx=0.0, grain=2.2, wall_dist_cm=260):
    """Pone el producto en un ambiente. horizon: fracción de alto (None = a media altura del producto).
    real_width_cm: ancho real del producto (fija la escala física del piso)."""
    W, H = size
    prod = trim(product_rgba)
    pw = int(W * width_frac)
    ph = int(prod.height * pw / prod.width)
    if ph > H * 0.8:
        ph = int(H * 0.8)
        pw = int(prod.width * ph / prod.height)
    prod = _resize_premult(prod, (pw, ph))
    yc = int(H * contact_y)                    # línea de apoyo en pantalla
    px, py = (W - pw) // 2, yc - ph
    hor = H * horizon if horizon is not None else py + ph * 0.5
    hor = min(hor, yc - 8)
    # cámara: escala física. Ancho real -> distancia z_c del apoyo
    f = W * 1.15
    z_c = f * real_width_cm / pw
    cam_h = z_c * (yc - hor) / f
    floor_tex = tex_rubber() if scene == "gym" else tex_wood()
    floor, depth = render_floor(floor_tex, W, H, hor, f, cam_h, z_offset_cm=float(RNG.uniform(0, 400)))
    # pared: a wall_dist_cm detrás del producto
    z_wall = z_c + wall_dist_cm
    y_wall = hor + f * cam_h / z_wall
    wall = wall_gym(W, H, y_wall) if scene == "gym" else wall_home(W, H, y_wall)
    ys = np.mgrid[0:H, 0:W][0].astype(np.float32)
    is_floor = ys >= y_wall
    img = np.where(is_floor[..., None], floor, wall)
    depth = np.where(is_floor, depth, z_wall)
    # luz sobre el piso: más claro cerca del foco/ventana
    if scene == "gym":
        xs = np.mgrid[0:H, 0:W][1].astype(np.float32)
        pool = np.exp(-(((xs - W / 2) / (W * 0.6)) ** 2 + ((ys - yc) / (H * 0.35)) ** 2))
        img = np.where(is_floor[..., None], img * (0.75 + 0.75 * pool[..., None]), img)
    else:
        xs = np.mgrid[0:H, 0:W][1].astype(np.float32)
        side = 0.85 + 0.25 * np.exp(-((xs - W * 0.1) / (W * 0.8)) ** 2)
        img = np.where(is_floor[..., None], img * side[..., None], img)
        # oclusión en la unión pared-piso
        ao = np.exp(-np.abs(ys - y_wall) / (H * 0.012))
        img *= (1 - 0.18 * ao)[..., None]
    # profundidad de campo con foco en el producto
    img = depth_blur(img, depth, z_c + focus_offset_cm, strength=900 * dof)
    alpha = np.array(prod.split()[3])
    sh = _shadows(alpha, W, H, px, py, mode, 0.85 if scene == "gym" else 0.6, light_dx)
    img *= (1 - sh)[..., None]
    if reflection > 0:  # piso semibrillante: reflejo invertido y desvanecido
        ref = np.array(prod.transpose(Image.FLIP_TOP_BOTTOM)).astype(np.float32)
        ra = ref[..., 3:4] / 255 * reflection
        fade = np.linspace(1, 0, ph, dtype=np.float32)[:, None, None] ** 2
        ra = ra * fade
        y0 = yc - 2
        hh = min(ph, H - y0)
        roi = img[y0:y0 + hh, px:px + pw]
        rr = cv2.GaussianBlur(ref[:hh, :, :3], (0, 0), 2)
        img[y0:y0 + hh, px:px + pw] = roi * (1 - ra[:hh]) + rr * ra[:hh]
    # producto (sin modificar sus colores)
    pa = np.array(prod).astype(np.float32)
    a = pa[..., 3:4] / 255
    roi = img[py:py + ph, px:px + pw]
    img[py:py + ph, px:px + pw] = roi * (1 - a) + pa[..., :3] * a
    # viñeta y grano unificado (integra capas)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    vig = 1 - 0.22 * (((xx - W / 2) / (W * 0.75)) ** 2 + ((yy - H * 0.55) / (H * 0.75)) ** 2)
    img *= np.clip(vig, 0.6, 1)[..., None]
    img += RNG.normal(0, grain, img.shape).astype(np.float32)
    return Image.fromarray(img.clip(0, 255).astype(np.uint8)), {
        "horizonte_px": round(float(hor)), "camara_cm": round(float(cam_h), 1),
        "distancia_cm": round(float(z_c), 1), "producto_px": (pw, ph)}
