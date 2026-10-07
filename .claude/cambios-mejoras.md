# Cambios y Mejoras — Virtual Shop Baires
Rama: `mejoras-ui-seguridad` | Fecha: 2026-10-07

---

## ETAPA 0 — Seguridad CRM (commits 5664cbd, ebd31de)
**Estado: ✅ Commiteado — pendiente que el usuario republique Apps Script**

### Problema resuelto
Cualquier persona con la URL del Apps Script podía leer y modificar datos del CRM sin autenticación.

### Cambios realizados
| Archivo | Cambio |
|---|---|
| `crm/Codigo.gs` | Token verificado en TODOS los endpoints admin vía `ADMIN_ACTIONS` |
| `crm/Codigo.gs` | `loginPanel()` con rate limiting: 5 intentos → bloqueo 15 min |
| `crm/panel.js` | `crm()` inyecta token automáticamente; `{ok:false,error:'auth'}` → reload |
| `crm/panel-ops.js` | Contraseña hardcodeada `'2208'` ELIMINADA; login async contra backend |
| `crm/panel-ops.js` | `sessionStorage` en lugar de `localStorage` (expira al cerrar pestaña) |

### ⚠️ Paso pendiente del usuario
El backend de Apps Script aún NO está protegido hasta que se republique manualmente:
1. Abrir https://script.google.com → proyecto del CRM
2. Desplegar → Administrar implementaciones → Editar → Nueva versión → Implementar
3. La URL no cambia — solo se actualiza el código que corre

---

## UI Store — Rendimiento y Animaciones (commit 6122008)
**Estado: ✅ Commiteado**

### Logo WebP
- `logo.webp` generado: **61 KB vs 525 KB** (ahorro del 88%)
- `js/mejoras-ui.js`: swap automático logo.png → logo.webp con detección de soporte
- Originales PNG intactos (og:image y datos estructurados siguen usando PNG)

### Tokens de animación CSS (`css/styles.css`, bloque al final)
- `--dur-fast: 150ms`, `--dur-normal: 250ms`, `--dur-slow: 350ms`
- `--ease-enter: cubic-bezier(0.22, 1, 0.36, 1)` (hovers, entradas)
- `--ease-move: cubic-bezier(0.25, 1, 0.5, 1)` (slides, drawers)

### Hover premium (solo mouse — `@media (hover:hover) and (pointer:fine)`)
- Product cards: `translateY(-6px) scale(1.01)` + shadow roja sutil
- Feature items y category cards: `translateY(-3px)`
- Botones con `transition` explícita (no más `transition: all`)
- Social icons con spring suave

### Accesibilidad
- `focus-visible` visible (outline rojo 2.5px) en toda la tienda
- `:focus:not(:focus-visible)` sin outline para usuarios de mouse

### Mobile hero
- CTAs a ancho completo con `flex-direction: column` en <768px
- `font-size: clamp(1.6rem, 6vw, 2.2rem)` para el título

### prefers-reduced-motion
- CSS + JS pausan videos `.hero-vid` y el camión del topbar
- Todas las transiciones CSS reducidas a 0.01ms
- Feedback de estado del usuario (focus, hover) se mantiene

### Cart feedback
- `cart-action-btn.vsb-adding`: bounce animation (350ms) al agregar producto
- Detectado via `MutationObserver` en `#cart-label`

### Service Worker
- Actualizado a `vsb-store-v3` con `logo.webp` y `mejoras-ui.js` cacheados

---

## CRM — Animaciones y UX (commit 5f2de9e)
**Estado: ✅ Commiteado**

### `crm/panel.css` (bloque al final)
| Animación | Descripción |
|---|---|
| Login entry | `crm-login-in`: fade + translateY(18px) → 0 al cargar |
| Login shake | `crm-shake`: 7-step horizontal shake 420ms al fallar |
| Toast | `transition` explícita: transform + opacity (no más `all`) |
| Modal entry | `crm-modal-in`: scale(0.95) + translateY(-10px) → normal |
| Skeleton | `.crm-skeleton` con shimmer gradient animado |
| Section nav | `.section-panel` con entrada suave al navegar |

### `crm/panel.js` y `crm/panel-ops.js`
- `shakeLoginBox()`: agrega `.crm-shake` al `#login-box` cuando el login falla
- Respeta `prefers-reduced-motion` (la animación CSS no corre en ese caso)

---

## Archivos nuevos
| Archivo | Descripción |
|---|---|
| `js/mejoras-ui.js` | WebP swap, reduced-motion handler, cart bounce observer |
| `logo.webp` | Logo optimizado (61 KB, generado desde logo.png de 525 KB) |

## Archivos modificados
| Archivo | Qué cambió |
|---|---|
| `css/styles.css` | +115 líneas al final: tokens, hover, focus, mobile, reduced-motion |
| `crm/panel.css` | +100 líneas al final: animaciones CRM, skeleton, toast fix |
| `crm/panel.js` | +12 líneas: shakeLoginBox() en doLogin() |
| `crm/panel-ops.js` | +12 líneas: shakeLoginBox() en doLogin() |
| `sw.js` | Cache v3 con nuevos archivos |
| `*.html` (10 páginas) | `<script src="js/mejoras-ui.js">` agregado tras main.js |

---

## Pendientes para próxima sesión
- [ ] Skeleton loaders en CRM (conectar `.crm-skeleton` a las funciones de carga de datos)
- [ ] Toasts mejorados con íconos (check ✓ / error ✗)
- [ ] Modales: Esc para cerrar + focus trap
- [ ] Touch targets 44px en CRM mobile (revisar botones pequeños)
- [ ] Accesibilidad: contraste AA (revisar grises sobre fondo claro)
- [ ] Copiar archivos a carpeta Escritorio (actualizar.ps1) — DESPUÉS del "publicá"
- [ ] **El usuario debe republica Apps Script manualmente** (ver instrucciones ETAPA 0 arriba)
