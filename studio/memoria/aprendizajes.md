# Aprendizajes del estudio (general, no de marca)

Consultar la sección relevante antes de una tarea similar. Agregar entradas cortas y fechadas.

## Entorno
- 2026-10-31 · Contenedor: 4 CPU, 15 GB RAM, sin GPU, ~30 GB libres. FFmpeg 6.1 con x264/x265/
  SVT-AV1/VP9/libwebp, loudnorm, vidstab, zscale, libplacebo, drawtext y subtitles.
- El contenedor es efímero: correr `bash studio/setup.sh` al inicio (idempotente).
- Proxy: PyPI, GitHub Releases (modelos rembg) y apt funcionan. Los errores de
  `mobile.events.data.microsoft.com` son telemetría de onnxruntime y se ignoran.
- `/usr/bin/time` no está instalado: usar el `time` de bash.
- La herramienta de seguridad bloquea `rm -rf` con globs relativos tras `cd`: escribir las
  corridas nuevas en una subcarpeta (`02_export/v2`) en lugar de borrar.

## Recorte de fondo
- `birefnet-general-lite` (por defecto) > `isnet-general-use` en bordes finos (patas, cables).
  Tarda ~20 s/imagen en CPU contra ~6 s. Usar isnet solo para lotes grandes de fotos de catálogo simples.
- Fotos de ambiente o collages (packaging con logos, fotos de uso y miniaturas) → la máscara sale
  "nublada". La métrica `calidad de máscara` lo detecta (>15 % = FAIL). El halo y la nitidez NO lo detectan.
- Un modelo de saliencia no distingue el producto de un mueble vecino. Hace falta `--box` o SAM.
- Descontaminar bordes (resolver I = aF + (1−a)B) elimina los halos blancos del fondo original.
- Reescalar RGBA en alfa premultiplicado evita bordes oscuros.

## Video
- Revisar la ROTACIÓN por metadato: `videos/hero4.mp4` figura como 1280×720, pero es vertical
  (−90°). FFmpeg la aplica sola al decodificar; `studio probe` y QC ahora la informan.
- `zoompan` de FFmpeg tiembla en zooms lentos. El slideshow renderiza en Python con warpAffine
  sub-píxel sobre un lienzo 9 % más grande y pasa los cuadros a FFmpeg por pipe.
- Zonas seguras en 9:16: la UI tapa ~12 % arriba, ~20 % abajo y la columna derecha.
  Logo a 10 % y textos a 72 %; el producto va entre ambos (`area` en product_shot).
- Rendimiento: un reel de 12 s con 4 recortes BiRefNet tarda ~1,5 min. Reencuadrar 15 s a 9:16 con blur tarda ~35 s.
