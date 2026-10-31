# Studio — centro de producción multimedia

Herramientas para editar fotos de producto, videos para redes y piezas de marca de
Virtual Shop Baires desde Claude Code. Todo corre en CPU.

## Arranque (cada sesión nueva)

El contenedor de Claude Code en la nube es **efímero**: lo instalado se pierde al cerrar la sesión.
El código, los presets y la memoria quedan en el repo. Para reinstalar:

```bash
bash studio/setup.sh            # capa mínima: ~1-2 min la primera vez
bash studio/setup.sh advanced   # + torch CPU, whisper, demucs, librosa, scenedetect (~3 GB)
studio doctor                   # verifica todo
```

## Estructura

```
studio/
  studio.py            CLI única (atajo: `studio`)
  lib/common.py        presets, ffprobe, rotación, fuentes
  lib/images.py        recorte, descontaminación de bordes, composición, encuadre, mejora
  lib/video.py         reencuadre, codificación por perfil, slideshow de productos
  lib/qc.py            control de calidad automático + hojas de contacto
  presets.json         formatos de destino y perfiles de exportación
  memoria/             aprendizajes y preferencias por marca (leer antes de trabajar)
  proyectos/<nombre>/  00_original · 01_trabajo · 02_export · qc · NOTAS.md  (no se versiona)
```

Los originales **nunca** se modifican: se copian a `00_original/` y se trabaja sobre copias.

## Comandos

| Tarea | Comando |
|---|---|
| Nuevo proyecto | `studio new campaña-verano` |
| Analizar archivo | `studio probe archivo.mp4` |
| PNG transparente | `studio img cutout foto.jpg -o out.png --trim` |
| Ficha Mercado Libre (1200², fondo blanco) | `studio img product foto.jpg -o ml.jpg --fmt ml` |
| Producto en feed 4:5 con degradé | `studio img product foto.jpg -o feed.jpg --fmt feed45 --bg "grad:#FFFFFF:#E6EBF2"` |
| Producto en foto de ambiente | `... --box x0,y0,x1,y1` (zona del producto en píxeles) |
| Cambiar formato sin deformar | `studio img fit foto.jpg -o story.jpg --fmt story --mode blur\|pad\|crop` |
| Corrección suave de luz/color | `studio img enhance foto.jpg -o out.jpg [--denoise 5]` |
| Video a Reel 9:16 | `studio vid encode in.mp4 -o reel.mp4 --fmt reel --mode blur\|crop [--x 0.3]` |
| Recortar tramo | `studio vid encode in.mp4 -o out.mp4 --start 2.5 --end 9` |
| Hero para el sitio | `studio vid encode in.mp4 -o hero.mp4 --profile web --mute` |
| Reel de productos | `studio vid slideshow a.jpg b.jpg -o reel.mp4 --logo "Logo (2).png" --textos "A\|B" --cta "Comprá online" --cta-sub "virtualshopbaires.com.ar" [--audio m.mp3]` |
| QC manual | `studio qc archivo [--expect reel --fps 30 --max-dur 60]` |

Formatos (`--fmt`): `reel` `story` 1080×1920 · `feed45` 1080×1350 · `feed11` 1080×1080 ·
`yt` 1920×1080 · `ml` / `web` 1200×1200 · `whatsapp` 720×1280 · o `WxH`.

Perfiles de video (`--profile`): `social` (CRF 18, −14 LUFS) · `web` (CRF 24, liviano) ·
`wa` · `master` (CRF 14). Todos: H.264 High, yuv420p, BT.709, faststart, GOP 2 s, AAC 48 kHz.

## Control de calidad

Todo comando de edición corre QC sobre su resultado y guarda `qc/<archivo>_qc.json` + previews.

**Imágenes:** dimensiones esperadas, alfa real, **calidad de máscara** (% de sujeto
semitransparente: <8 % limpio, >15 % FAIL), halos de borde, sujeto cortado, nitidez,
sombras quemadas, resolución mínima. En `product` también se evalúa el recorte intermedio
(`01_trabajo/*_recorte.png`), y si da FAIL **no se entrega**.

**Video:** resolución, fps, SAR, pix_fmt, dimensiones pares, faststart, rotación por
metadato, decodificación completa (cuadros corruptos), cuadros negros, imágenes congeladas,
sonoridad integrada y true peak, desfase audio/video, duración máxima. Además genera una
hoja de contacto de 12 cuadros.

Las métricas no reemplazan la revisión visual: antes de entregar, Claude mira las previews
(`*_qc_alfa.jpg` muestra el recorte sobre damero, negro y blanco; `*_qc_contacto.jpg` es la
hoja de contacto del video).

## Capacidades y límites (verificados)

- Sin GPU: la superresolución con Real-ESRGAN y la interpolación de cuadros son lentas en CPU.
  Se instalan solo si un trabajo lo justifica.
- Recorte automático: excelente en fotos de catálogo. En fotos de ambiente o collages, el
  modelo puede quedarse con objetos vecinos (por ejemplo, un sillón junto a la mesa). Para
  separar un objeto entre varios hace falta `--box` o segmentación por punto (SAM, capa avanzada).
- Las partes del producto que no se ven en la foto original no se reconstruyen. Si alguna
  vez se hace, se informa como reconstrucción estimada.
