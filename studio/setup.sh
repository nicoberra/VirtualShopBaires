#!/usr/bin/env bash
# Instalador idempotente del estudio multimedia.
#   bash studio/setup.sh            -> capa mínima (apt + venv + modelos de recorte)
#   bash studio/setup.sh advanced   -> además torch CPU, whisper, demucs, librosa, scenedetect
# El contenedor de Claude Code en la nube es efímero: correr esto al inicio de cada sesión
# que vaya a editar multimedia (tarda ~1-2 min la capa mínima).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${STUDIO_VENV:-/opt/studio-venv}"
MODE="${1:-minimal}"

log(){ printf '\033[1;34m[studio]\033[0m %s\n' "$*"; }

# 1. Herramientas de sistema (gratuitas, de los repos de Ubuntu)
need=()
command -v ffmpeg   >/dev/null || need+=(ffmpeg)
command -v convert  >/dev/null || need+=(imagemagick)
command -v exiftool >/dev/null || need+=(libimage-exiftool-perl)
command -v vips     >/dev/null || need+=(libvips-tools)
command -v sox      >/dev/null || need+=(sox)
fc-list : family 2>/dev/null | grep -i "inter" >/dev/null || need+=(fonts-inter)
if [ ${#need[@]} -gt 0 ]; then
  log "apt: ${need[*]}"
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO apt-get update -qq && DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "${need[@]}" >/dev/null
fi

# 2. Entorno Python aislado (no toca el Python del sistema)
if [ ! -x "$VENV/bin/python" ]; then
  log "creando venv en $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
fi
log "pip: capa mínima"
"$VENV/bin/pip" install -q -r "$HERE/requirements.txt"

if [ "$MODE" = "advanced" ]; then
  log "pip: capa avanzada (torch CPU, whisper, demucs...)"
  "$VENV/bin/pip" install -q -r "$HERE/requirements-advanced.txt"
fi

# 3. Modelos de segmentación (se descargan una vez, ~180 MB c/u)
log "modelos de recorte (birefnet-general-lite, isnet-general-use)"
"$VENV/bin/python" - <<'PY' 2>/dev/null
from rembg import new_session
for m in ("birefnet-general-lite", "isnet-general-use"):
    new_session(m)
PY

# 4. Atajo de línea de comandos
cat > /usr/local/bin/studio 2>/dev/null <<EOF || true
#!/usr/bin/env bash
exec "$VENV/bin/python" "$HERE/studio.py" "\$@"
EOF
chmod +x /usr/local/bin/studio 2>/dev/null || true

log "listo. Probá: studio doctor"
