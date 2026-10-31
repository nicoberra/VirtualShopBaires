"""Utilidades compartidas: presets, ffprobe, ejecución de comandos, colores de marca."""
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRESETS = json.loads((ROOT / "presets.json").read_text())
FONT_DIRS = ["/usr/share/fonts", "/usr/local/share/fonts"]


def run(cmd, check=True, capture=True):
    """Ejecuta un comando y devuelve CompletedProcess. Lanza error legible si falla."""
    r = subprocess.run(cmd, capture_output=capture, text=True)
    if check and r.returncode != 0:
        tail = (r.stderr or "")[-1500:]
        raise RuntimeError(f"Falló: {' '.join(map(str, cmd))[:300]}\n{tail}")
    return r


def has(tool):
    return shutil.which(tool) is not None


def ffprobe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", str(path)])
    return json.loads(r.stdout)


def fmt_size(fmt):
    """'reel' -> (1080,1920); '1080x1350' -> (1080,1350)."""
    if fmt in PRESETS["formatos"]:
        p = PRESETS["formatos"][fmt]
        return p["w"], p["h"]
    w, h = fmt.lower().split("x")
    return int(w), int(h)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def find_font(name="Inter", weight="Bold"):
    """Busca un .ttf/.otf por nombre; cae a DejaVu si no existe."""
    want = f"{name}-{weight}".lower().replace(" ", "")
    cands = []
    for d in FONT_DIRS:
        for p in Path(d).rglob("*"):
            if p.suffix.lower() in (".ttf", ".otf"):
                cands.append(p)
    for p in cands:
        if p.stem.lower().replace(" ", "") == want:
            return str(p)
    for p in cands:
        if p.stem.lower().startswith(name.lower()) and weight.lower() in p.stem.lower():
            return str(p)
    for p in cands:
        if p.stem == "DejaVuSans-Bold":
            return str(p)
    return str(cands[0]) if cands else None


def parse_rate(r):
    try:
        n, d = r.split("/")
        return float(n) / float(d) if float(d) else 0.0
    except Exception:
        return 0.0


def rotation(stream):
    """Rotación declarada (side data / tag). FFmpeg la aplica al decodificar."""
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            return int(float(sd["rotation"]))
    return int(float(stream.get("tags", {}).get("rotate", 0) or 0))


def display_size(stream):
    """(ancho, alto) tal como se ve, considerando rotación de 90/270°."""
    w, h = stream["width"], stream["height"]
    return (h, w) if abs(rotation(stream)) % 180 == 90 else (w, h)
