"""Edición y codificación de video con FFmpeg (+ render de cuadros en Python cuando
FFmpeg no da suficiente suavidad, p. ej. zooms lentos sobre fotos)."""
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .common import PRESETS, ffprobe, find_font, hex_rgb, parse_rate, run
from . import images as I

X264_COMMON = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
               "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
               "-movflags", "+faststart"]


def info(path):
    d = ffprobe(path)
    v = next((s for s in d["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)
    return d, v, a


def reframe_filter(W, H, mode="blur", x="center", bg_color="black"):
    """Filtro FFmpeg para pasar a WxH sin deformar.
    blur: video completo sobre fondo desenfocado de sí mismo (ideal 16:9 -> 9:16)
    crop: cubre y recorta (x='center' o fracción 0..1 para mover el encuadre)
    pad:  barras de color
    """
    if mode == "crop":
        xe = "(iw-ow)/2" if x == "center" else f"(iw-ow)*{float(x)}"
        return (f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,"
                f"crop={W}:{H}:{xe}:(ih-oh)/2")
    if mode == "pad":
        return (f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={bg_color}")
    return (f"split=2[bg][fg];"
            f"[bg]scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},"
            f"gblur=sigma=12,eq=brightness=-0.06:saturation=1.1,scale={W}:{H}[bgb];"
            f"[fg]scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];"
            f"[bgb][fgs]overlay=(W-w)/2:(H-h)/2")


def encode(src, out, profile="social", size=None, mode="blur", x="center",
           start=None, end=None, fps=None, mute=False, extra_vf=None):
    prof = PRESETS["perfiles_video"][profile]
    _, v, a = info(src)
    src_fps = parse_rate(v.get("avg_frame_rate") or v.get("r_frame_rate", "30/1"))
    target_fps = fps or (min(src_fps, prof["fps_max"]) if src_fps else 30)
    vf = []
    if size:
        vf.append(reframe_filter(*size, mode=mode, x=x))
    if extra_vf:
        vf.append(extra_vf)
    vf.append(f"fps={target_fps:g},setsar=1,format=yuv420p")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if start is not None:
        cmd += ["-ss", str(start)]
    if end is not None:
        cmd += ["-to", str(end)]
    chain = ",".join(vf)
    # los grafos con ramas ([bg][fg]) requieren -filter_complex y mapear el audio a mano
    if ";" in chain:
        cmd += ["-i", str(src), "-filter_complex", f"[0:v]{chain}[v]", "-map", "[v]", "-map", "0:a?"]
    else:
        cmd += ["-i", str(src), "-vf", chain]
    cmd += X264_COMMON + ["-crf", str(prof["crf"]), "-preset", prof["preset"],
                          "-g", str(int(round(target_fps * 2)))]
    if a is not None and not mute:
        cmd += ["-af", f"loudnorm=I={prof['lufs']}:TP=-1.5:LRA=11,aresample=48000",
                "-c:a", "aac", "-b:a", f"{prof['audio_k']}k", "-ac", "2"]
    else:
        cmd += ["-an"]
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    run(cmd + [str(out)])
    return out


# ---------------------------------------------------------------- slideshow de productos
# Zonas seguras 9:16: la UI de Reels/TikTok/Shorts tapa ~12% arriba y ~20% abajo
# (usuario, descripción, botones a la derecha). Logo y textos van dentro de esa franja.
SAFE_TOP = 0.10
SAFE_TEXT_Y = 0.72
def _ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def _text_layer(size, text, font_path, px, color=(255, 255, 255), pill=None, y_frac=0.82, max_w=0.86):
    """Capa RGBA con texto centrado (y 'pastilla' de fondo opcional). Ajusta tamaño para entrar."""
    W, H = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    while px > 18:
        f = ImageFont.truetype(font_path, px)
        bb = d.textbbox((0, 0), text, font=f)
        if bb[2] - bb[0] <= W * max_w:
            break
        px -= 2
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x, y = (W - tw) // 2 - bb[0], int(H * y_frac) - th // 2 - bb[1]
    if pill:
        pad_x, pad_y = int(px * 0.7), int(px * 0.45)
        r = (x + bb[0] - pad_x, y + bb[1] - pad_y, x + bb[2] + pad_x, y + bb[3] + pad_y)
        d.rounded_rectangle(r, radius=(r[3] - r[1]) // 2, fill=pill)
    d.text((x, y), text, font=f, fill=color)
    return layer


def _logo(path, width):
    lg = I.load(path).convert("RGBA")
    k = width / lg.width
    return lg.resize((width, round(lg.height * k)), Image.LANCZOS)


def slideshow(imgs, out, size=(1080, 1920), per=2.8, trans=0.45, fps=30, zoom=0.07,
              product=True, bg="grad:#FFFFFF:#E9EDF3", texts=None, logo=None,
              cta=None, cta_sub=None, brand="#1B2B4B", accent="#CC1212", audio=None,
              profile="social"):
    """Video de productos: cada foto con zoom lento sub-píxel (sin 'temblor' de zoompan),
    fundidos encadenados, textos animados opcionales y placa final con logo + CTA."""
    W, H = size
    S = 1.0 + zoom + 0.02                       # margen de resolución para el zoom
    BW, BH = int(W * S), int(H * S)
    font_b = find_font("Inter", "Bold") or find_font("DejaVuSans", "Bold")
    font_s = find_font("Inter", "SemiBold") or font_b
    clips = []
    for i, p in enumerate(imgs):
        if product:
            # el producto ocupa el centro; arriba queda aire para el logo y abajo para el texto
            # zona libre entre el logo y el texto (en coords del lienzo ampliado S)
            area = (0.10, 0.20, 0.90, 0.64 if texts else 0.76)
            canvas, _ = I.product_shot(p, (BW, BH), bg=bg, margin=0.10, area=area)
        else:
            canvas = I.fit(I.load(p), (BW, BH), mode="blur").convert("RGBA")
        base = np.array(canvas.convert("RGB"))
        txt = None
        if texts and i < len(texts) and texts[i]:
            txt = np.array(_text_layer(size, texts[i], font_b, int(W * 0.065),
                                       color=(255, 255, 255), pill=hex_rgb(brand) + (235,),
                                       y_frac=SAFE_TEXT_Y))
        clips.append((base, txt, i % 2 == 0))
    if cta:
        card = I.make_background((BW, BH), f"grad:{brand}:#0E1830")
        if logo:
            lg = _logo(logo, int(BW * 0.62))
            card.alpha_composite(lg, ((BW - lg.width) // 2, int(BH * 0.30) - lg.height // 2))
        t1 = _text_layer((BW, BH), cta, font_b, int(BW * 0.075), color=(255, 255, 255),
                         pill=hex_rgb(accent) + (255,), y_frac=0.60)
        card.alpha_composite(t1)
        if cta_sub:
            card.alpha_composite(_text_layer((BW, BH), cta_sub, font_s, int(BW * 0.045),
                                             color=(225, 230, 240), y_frac=0.70))
        clips.append((np.array(card.convert("RGB")), None, True))
    logo_l = None
    if logo and product:
        lg = np.array(_logo(logo, int(W * 0.40)))
        logo_l = (lg, (W - lg.shape[1]) // 2, int(H * SAFE_TOP))

    n = len(clips)
    total = n * per - (n - 1) * trans
    nframes = int(round(total * fps))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(fps), "-i", "-"]
    if audio:
        cmd += ["-i", str(audio)]
    prof = PRESETS["perfiles_video"][profile]
    cmd += X264_COMMON + ["-crf", str(prof["crf"]), "-preset", prof["preset"], "-g", str(fps * 2)]
    if audio:
        cmd += ["-map", "0:v", "-map", "1:a", "-shortest",
                "-af", f"afade=t=in:d=0.3,afade=t=out:st={total - 1.2:.2f}:d=1.2,"
                       f"loudnorm=I={prof['lufs']}:TP=-1.5:LRA=11,aresample=48000",
                "-c:a", "aac", "-b:a", f"{prof['audio_k']}k"]
    cmd += [str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    def render(ci, t_local):
        base, txt, zin = clips[ci]
        u = _ease(t_local / per)
        z = 1.0 + zoom * (u if zin else 1 - u)          # alterna zoom-in / zoom-out
        # escala de BW,BH -> W,H con zoom z, centrado (warpAffine = interpolación sub-píxel)
        k = (W / BW) * z
        M = np.float32([[k, 0, W / 2 - k * BW / 2], [0, k, H / 2 - k * BH / 2]])
        fr = cv2.warpAffine(base, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        fr = fr.astype(np.float32)
        if txt is not None:      # texto: entra subiendo y con fundido a 0.35 s, sale al final
            a_in = _ease((t_local - 0.35) / 0.45)
            a_out = 1 - _ease((t_local - (per - trans - 0.15)) / 0.3)
            al = min(a_in, a_out)
            if al > 0:
                dy = int((1 - a_in) * H * 0.025)
                t = np.roll(txt, dy, axis=0).astype(np.float32)
                ta = t[..., 3:4] / 255 * al
                fr = fr * (1 - ta) + t[..., :3] * ta
        return fr

    try:
        for f in range(nframes):
            t = f / fps
            ci = min(int(t // (per - trans)), n - 1)
            tl = t - ci * (per - trans)
            fr = render(ci, tl)
            if ci + 1 < n and tl > per - trans:          # fundido con el siguiente
                w = _ease((tl - (per - trans)) / trans)
                fr = fr * (1 - w) + render(ci + 1, tl - (per - trans)) * w
            if logo_l is not None and not (cta and ci == n - 1):
                lg, lx, ly = logo_l
                fade = 1.0
                if cta and ci == n - 2 and tl > per - trans:
                    fade = 1 - _ease((tl - (per - trans)) / trans)
                la = lg[..., 3:4].astype(np.float32) / 255 * fade
                roi = fr[ly:ly + lg.shape[0], lx:lx + lg.shape[1]]
                fr[ly:ly + lg.shape[0], lx:lx + lg.shape[1]] = roi * (1 - la) + lg[..., :3] * la
            proc.stdin.write(fr.clip(0, 255).astype(np.uint8).tobytes())
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read().decode()
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falló:\n{err[-1500:]}")
    return out, {"duracion": round(total, 2), "cuadros": nframes, "clips": n}
