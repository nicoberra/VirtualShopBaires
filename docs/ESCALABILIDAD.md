# Virtual Shop Baires — Escalabilidad, seguridad y plan de crecimiento

Fecha: 2026-10-12 · Rama `escalabilidad` · Tag de restauración `antes-escalabilidad-20261012`

Este documento describe la arquitectura **verificada** (no supuesta), los límites conocidos,
lo que se cambió en esta ronda, lo que se propone y los indicadores para saber cuándo dar el
próximo paso. Donde dice "medido" hay evidencia; donde dice "cuota documentada" es el límite
que publica Google/Cloudflare, no una medición propia.

---

## 1. Arquitectura real (verificada el 2026-10-12)

| Pieza | Qué hace | Cómo se verificó |
|---|---|---|
| **Front estático** (GitHub Pages + Cloudflare, `virtualshopbaires.com.ar`) | HTML/CSS/JS puro. `sw.js` precachea CSS/JS/logo y **nunca** cachea `script.google.com`, `googleapis.com` ni Mercado Pago. | `sw.js` líneas 16-60 |
| **Catálogo** | El navegador lee **directo de Google Sheets** por la API pública `gviz` (`js/sheets.js` → `fetchHoja`): 1 request a la pestaña `Categorias` + 1 por cada categoría + `images-manifest.json`. Caché en `localStorage` 30 min (`vsb_data_v10`). **No pasa por Apps Script.** | `js/sheets.js` 143-160, 290-330 |
| **CRM / backend principal** — Apps Script `crm/Codigo.gs` (deployment `AKfycbwovdDoOy…`) | Panel CRM (`crm/panel.js`, `crm/panel-ops.js`), `createOrder` (pedidos por transferencia/efectivo → pestaña **Pedidos externos**), `mp_preferencia` (Mercado Pago → pestaña **Pedidos**), fotos a GitHub, avisos por Telegram. | `?action=version` → `{"ok":true,"version":"v2"}` |
| **Backend viejo** — `apps-script.gs` (deployment `AKfycbzDLw6AMe…`) | Registro de usuarios y newsletter (`index.html`), login y cambio de clave (`mi-cuenta.html`), **mis compras** (`mis-compras.html`, lee la pestaña **Pedidos**), estado de pedido y comprobante (`order-status.html`). | `?action=version` → `"Acción no reconocida"`; acciones por página |
| **Cloudflare Worker `vsb-api`** (`/api/*`) | Desplegado y funcionando (POST vacío → `400 "Nombre inválido"`). Valida precios contra `products_cache` en Supabase, rate limit en KV, Turnstile, emails por Resend. **Ninguna página de la tienda lo usa**: solo `admin/index.html`. `SHEETS_WEBHOOK_URL` en `wrangler.toml` apunta a un script viejo de imágenes, no al CRM. | `curl -X POST /api/orders` |
| **Otras implementaciones** | `AKfycbxS-UBfke…` (constante sin uso en `js/sheets.js`) y `AKfycby4YRmW16…` (en `wrangler.toml`): ambas devuelven el manifest de imágenes viejo. Son residuos. | `?action=version` |

**Conclusión:** hoy hay **tres backends en paralelo** y el camino de dinero real es
`checkout.html → Codigo.gs`. El Worker, que es el único con validación de precios, idempotencia
y antiabuso, está desconectado de la tienda.

### Inconsistencias funcionales detectadas (no son de seguridad, pero afectan al cliente)
- **"Mis compras" no muestra los pedidos de la web.** El checkout escribe en `Pedidos externos`
  (`Codigo.gs` → `crearPedido`) y en `Pedidos` solo los de Mercado Pago, con otras columnas;
  `apps-script.gs` → `getMyOrders` lee la pestaña `Pedidos` con el layout viejo de 28 columnas.
  → Verificar con una cuenta real; muy probablemente la página sale vacía.
- **Mercado Pago nunca confirma solo.** No existe webhook ni reconsulta a la API de MP: el pedido
  queda `Pendiente` en la pestaña `Pedidos` y hay que confirmarlo a mano. `gracias.html` solo
  muestra la referencia.
- **El stock es un sí/no**, no una cantidad (`STOCK_ACTIVO=false` además lo ignora en la tienda).
  Por lo tanto **no hay sobreventa por cantidad posible hoy**: tampoco hay descuento de stock.

---

## 2. Seguridad — hallazgos y estado

| # | Gravedad | Hallazgo | Dónde | Estado |
|---|---|---|---|---|
| 1 | 🔴 Alta | El total de Mercado Pago se armaba con el precio que mandaba el navegador. | `crm/Codigo.gs` → `crearPreferencia` | **Corregido** (ver §3) |
| 2 | 🔴 Alta | XSS almacenado: nombre, email, productos, notas de clientes se insertaban con `innerHTML` sin escapar en el CRM. | `crm/panel.js`, `crm/panel-ops.js` | **Corregido** (ver §3) |
| 3 | 🟡 Media | El total de los pedidos por transferencia también venía del navegador. | `crm/Codigo.gs` → `crearPedido` | **Corregido** (mismo mecanismo que 1) |
| 4 | 🟡 Media | Contraseñas de clientes en texto plano en la pestaña `Clientes` y `Usuarios`. | `Codigo.gs` → `registrar`/`login`; `apps-script.gs` → `registerUser`/`loginUser` | **Corregido** (§3.4): hash con sal, migración automática en el login |
| 5 | 🟡 Media | `createOrder` y `mp_preferencia` son públicos sin rate limit ni Turnstile: spam de pedidos y de avisos. | `Codigo.gs` → `doPost` | **Corregido** (§3.4): honeypot, límites por email y global, idempotencia. Turnstile pendiente (requiere crear el widget) |
| 6 | 🟢 Baja | Precio en texto con punto de miles ("$ 12.500") se interpreta como 12,5 **en la tienda** (`js/sheets.js` → `precioBase`). En el servidor ya se corrigió. Hoy no afecta porque las celdas son numéricas. | `js/sheets.js` ~192 | Pendiente (cambio chico) |
| 7 | 🟢 Baja | Comprobantes en Drive se comparten "cualquiera con el enlace" (hoy desactivado: `COMPROB_FOLDER_ID` vacío). | `Codigo.gs` → `comprobanteSubir` | Propuesta: carpeta privada + enlace firmado desde el CRM |
| 8 | 🟢 Baja | Rate limit del login del panel por prefijo de clave, no por cliente (Apps Script no expone IP). | `Codigo.gs` → `loginPanel` | Mitigación: passphrase larga en `PANEL_PASS` |
| ✅ | — | Sin secretos en el repo ni en el historial de git; `GH_TOKEN` fine-grained solo `Contents`; `wrangler.toml` sin secretos; el service worker no cachea APIs. | — | OK, mantener |

**Datos personales (Ley 25.326):** la planilla guarda nombre, DNI, dirección, teléfono y email.
Recomendación mínima: acceso a la planilla solo con la cuenta del dueño y 2FA, backup semanal
(Drive → "Hacer una copia" o Apps Script con trigger), y un texto de política de privacidad en
`faq.html`/checkout. No se guardan datos de tarjetas (los maneja Mercado Pago).

---

## 3. Qué se cambió en esta ronda (rama `escalabilidad`)

### 3.1 Precios calculados en el servidor
`crm/Codigo.gs`, bloque "PRECIOS EN EL SERVIDOR":
- `_calcularPedidoServidor(items, envioId, descuentoPct)` busca cada producto en la planilla por
  **categoría + nombre + color + talle** (misma regla que la tienda: columna `descuento` si es
  número > 0, si no `Precio`), acota la cantidad a 1–99, suma el envío con la tabla
  `ZONAS_ENVIO_SRV` (Capital 5.500 · GBA 1 7.000 · GBA 2 9.000 · GBA 3 15.000) y aplica el 10 %
  de transferencia con la misma fórmula de redondeo del checkout.
- `crearPreferencia` (Mercado Pago): **ignora el precio del cliente**; si un producto no está en
  el catálogo devuelve error y no crea la preferencia. Devuelve `total` calculado.
- `crearPedido` (transferencia/efectivo): recalcula subtotal/descuento/total. Si algún producto no
  se encuentra, conserva los valores del navegador y marca el pedido con
  `⚠ PRECIOS SIN VERIFICAR` en observaciones para revisarlo a mano.
- `checkout.html` y `js/cart.js`: el carrito guarda `categoria` y el checkout manda producto +
  variante + cantidad + `envioZona`; ya no manda el ítem de envío con precio.
- `sw.js`: caché `vsb-store-v5` para que los navegadores tomen el `cart.js` nuevo.

**Evidencia (medido):** `node tests/precio-servidor.test.mjs` ejecuta las funciones reales del
`.gs` contra una planilla simulada — **9/9 pruebas OK**: precio manipulado a $1 → se cobra el
real; variante con descuento; búsqueda sin categoría; producto inexistente rechazado; talle
exacto; formato "$ 12.500"; envío por zona; 10 % transferencia; cantidades acotadas.
La prueba detectó y se corrigió un error del parser (punto de miles) antes de desplegar.

### 3.2 Escape de datos en el CRM
`hx()` en `crm/panel.js` y `crm/panel-ops.js` escapa `& < > " '`. Se aplica en todas las
plantillas con datos de clientes o pedidos: resumen del panel, tabla de clientes, historial,
tabla y detalle de pedidos, comprobantes (y el `href` solo acepta `http(s)`), mensajes de error
y nombres de categorías. `confirmar()` y los títulos ya usaban `textContent`.
Sintaxis verificada con `node --check` en los 5 archivos JS tocados y en `Codigo.gs`.

### 3.3 Herramientas nuevas
- `tests/precio-servidor.test.mjs` — pruebas del cálculo de precios (sin red).
- `tests/carga/` — scripts de carga (Node y k6) con **bloqueo** si la URL es de producción.


### 3.4 Segunda ronda (2026-10-12, con OK del dueño)
Evidencia: `node tests/seguridad.test.mjs` → **26/26 OK** (ejecuta `Codigo.gs` y `apps-script.gs` reales
contra planilla, caché, lock, Mercado Pago y Telegram simulados). `node tests/precio-servidor.test.mjs` → 9/9.

- **Contraseñas:** `_hashClave` = SHA-256 iterado 1.000 veces con sal de 16 caracteres por usuario, guardado
  como `s1$<sal>$<hash>` **en la misma columna** (no cambia la estructura de la planilla). Las claves viejas en
  texto plano siguen entrando y se convierten solas en el primer login. Bloqueo de 15 min tras 10 intentos
  fallidos por email. En `apps-script.gs` el navegador ya mandaba SHA-256(clave+email); ahora el servidor le
  agrega sal e iteraciones encima (bloque en `docs/apps-script-claves.gs`).
- **Antiabuso en `createOrder` y `mp_preferencia`:** campo trampa (honeypot) en el checkout; máx. 5 pedidos
  distintos por email cada 10 min; máx. 60 por minuto en total.
- **Idempotencia:** el mismo carrito del mismo email en 10 min devuelve el mismo pedido / el mismo link de pago
  (clave MD5 en `CacheService` + lock corto). Número de pedido con un dígito aleatorio extra.
- **Webhook de Mercado Pago:** la preferencia ahora lleva `notification_url` → `?action=mp_webhook`. Como Apps
  Script no expone encabezados HTTP, **no se puede validar la firma `x-signature`**; en su lugar cada aviso se
  **reconsulta** a `GET /v1/payments/{id}` con el `MP_ACCESS_TOKEN`. Solo un pago `approved` con
  `external_reference` igual a un pedido lo confirma; si pagó menos que el monto, no confirma y marca
  `⚠ PAGÓ $X DE $Y`. Idempotente por `payment.id`.
- **Conciliación:** `conciliarPagosMP()` revisa pagos aprobados de las últimas 48 h. Se activa corriendo
  `instalarConciliacion()` una vez (trigger cada 30 min).
- **Errores centralizados:** pestaña `Errores` (se crea sola) + aviso por Telegram máx. 1 por tipo cada 15 min.
- **Telegram:** `TG_TOKEN` y `TG_CHAT` se leen de Propiedades del script (antes estaban vacíos en el código).
- **Mis compras:** nueva acción `mis_pedidos` que lee `Pedidos externos` y los pedidos de Mercado Pago de
  `Pedidos` (el email ahora se guarda en las notas). Devuelve solo número, fecha, productos, total y estado —
  nunca dirección, DNI ni teléfono. `mis-compras.html` combina esto con el sistema viejo y escapa todo.

Pendiente: **Turnstile** (crear el widget en Cloudflare y poner `TURNSTILE_SECRET` en Propiedades), y
`order-status.html` ("Ver detalle") sigue leyendo el sistema viejo, así que para pedidos nuevos puede no
encontrar el pedido.

---

## 4. Límites y cuellos de botella por escenario

### 4.1 Cuotas documentadas (cuenta Gmail gratuita)
| Recurso | Cuota | Dónde pega |
|---|---|---|
| Apps Script — ejecuciones simultáneas | **30** | Checkouts + CRM abierto + avisos. Superado → `"Service invoked too many times"` / timeouts. |
| Apps Script — tiempo por ejecución | 6 min | Hoy ninguna acción se acerca (`ext_productos_list` lee todas las pestañas: es la más pesada). |
| Apps Script — URL Fetch | **20.000/día** | 1 por pedido (Telegram) + 1 por preferencia MP + fotos a GitHub. |
| Apps Script — MailApp | 100/día | No se usa hoy (los mails están en el Worker/Resend). |
| LockService | espera máx. 30 s en el código | Solo en fotos/variantes. `crearPedido` **no** usa lock (no hace falta: `appendRow` es atómico y el nº de pedido es `VSB-<ms>`). |
| Sheets `gviz` (catálogo) | Sin cuota publicada; limita por IP/volumen | 1 + N requests por visitante nuevo (N = nº de categorías, ~20). |
| Cloudflare Workers (free) | 100.000 req/día | Sobra para 2.000 pedidos/día. |
| Workers KV (free) | 100.000 lecturas/día, **1.000 escrituras/día** | El rate limit escribe 1 por intento → a 1.000+ pedidos/día hay que pasar a Workers Paid (USD 5/mes). |
| Supabase (free) | 500 MB, **se pausa tras 7 días sin uso** | Hoy no recibe tráfico de la tienda: puede estar pausado. |

### 4.2 Escenarios
| Escenario | Qué pasa hoy | Riesgo |
|---|---|---|
| **50 visitantes simultáneos** | ~1.000 requests a `gviz` en el primer minuto; Apps Script casi sin carga. | Bajo. |
| **200 simultáneos** | ~4.000 requests/min a `gviz`. Posibles 429 esporádicos en el catálogo (la tienda muestra "cargando" y falla sin reintento). | Medio. |
| **1.000 – 5.000 simultáneos** (campaña) | 20.000–100.000 requests/min a `gviz`: muy probable throttling → catálogo vacío para parte de los visitantes. GitHub Pages/Cloudflare sirven el HTML sin problema. | **Alto.** Es el primer cuello de botella real. |
| **20 pedidos/día** | Trivial. | — |
| **100 pedidos/día, picos de 10 en el mismo minuto** | 10 ejecuciones simultáneas de ~1–3 s: OK. | Bajo. |
| **500 pedidos/día, picos de 30–50/min** | Se alcanza el límite de **30 simultáneas** en picos; algunos checkouts fallan con error genérico; el cliente puede reintentar y **duplicar** el pedido (no hay idempotencia por carrito). | **Alto.** |
| **2.000 pedidos/día** | Apps Script no es viable como backend de pedidos (simultaneidad + 20k URL Fetch + CRM leyendo miles de filas). | Migrar (§6, etapa 2). |
| **Productos 500 → 2.000** | `gviz` por categoría y `localStorage` (5 MB) aguantan ~2.000 productos con fotos externas. El CRM `ext_productos_list` lee todo cada vez (~segundos). | Medio a 2.000. |
| **10.000 productos** | `localStorage` y el JSON en memoria (varios MB) hacen lenta la tienda en celular; el CRM supera varios segundos por listado. | Alto: catálogo paginado/JSON por categoría (§6). |
| **Clientes: miles → decenas de miles** | `listar('Clientes')` carga toda la pestaña en cada apertura del CRM (`panel.js` → `loadClientes`). A 10k filas: 3–8 s por carga y riesgo de 6 min nunca, pero UX mala. Búsqueda `login` recorre fila por fila. | Medio. Paginación en el CRM e índice por email. |
| **Webhooks de MP repetidos / fuera de orden** | **No hay webhook.** Cuando se agregue, debe ser idempotente por `payment.id` (§5.3). | — |

### 4.3 Concurrencia y dinero (estado actual)
- Alta de pedido: `appendRow` es atómico; dos checkouts simultáneos crean dos filas distintas. OK.
- Nº de pedido `VSB-<timestamp ms>`: colisión posible solo en el mismo milisegundo (improbable, pero
  no imposible en picos). Propuesta: sufijo aleatorio de 4 caracteres.
- Idempotencia: si el cliente reintenta tras un timeout, se crean dos pedidos. Propuesta en §5.2.
- Stock: no hay cantidad, no hay descuento → no hay carrera. Si se activa stock por cantidad,
  debe hacerse con `LockService` + lectura/escritura de la celda dentro del lock (o en Supabase
  con transacción).
- Pago aprobado: hoy es manual (sin webhook). No hay riesgo de doble cobro; sí de pedidos pagos
  que nadie ve si no se mira el panel de MP.

---

## 5. Propuestas (esperan OK antes de implementar)

### 5.1 Contraseñas con hash (migración segura, sin cortar a nadie)
1. Nueva columna `clave_hash` en `Clientes`/`Usuarios`. Hash = SHA-256 con sal por usuario
   (`Utilities.computeDigest`, sal aleatoria de 16 bytes, 10.000 iteraciones) y guardar `sal$hash`.
2. `registrar`/`registerUser`: guardan solo el hash.
3. `login`/`loginUser`: si hay `clave_hash` comparan hash; si solo hay `clave` en texto, comparan
   texto y **en ese mismo login** escriben el hash y borran el texto. Así la migración es gradual
   y sin pedirle nada al cliente.
4. Al terminar (cuando ya no queden claves en texto), eliminar la columna `clave`.
Impacto: una columna nueva en la planilla (pido OK porque cambia la estructura).

### 5.2 Antiabuso e idempotencia en `createOrder` / `mp_preferencia`
- **Idempotencia:** el checkout manda un `idem` (UUID generado al cargar el carrito). El servidor
  guarda `idem → orderNumber` en `CacheService` (6 h); si llega repetido, devuelve el mismo pedido
  en vez de crear otro. Sin cambios en la planilla.
- **Rate limit** en `CacheService`: máx. 5 pedidos por email cada 10 min y 60 pedidos por minuto en
  total (contador global). Al superarlo: `"Demasiados intentos, esperá unos minutos"`.
- **Honeypot** en el formulario (campo oculto que los bots completan).
- **Turnstile** (ya está cargado en `checkout.html` pero sin widget): agregar el widget y validar el
  token en `Codigo.gs` con `UrlFetchApp` (gasta 1 URL Fetch por pedido; a 2.000 pedidos/día sigue
  dentro de la cuota). Requiere crear el widget en Cloudflare (lo hace el dueño) y poner la clave
  secreta en Propiedades del script.

### 5.3 Webhook de Mercado Pago (confirmación automática)
- Acción `mp_webhook` en `Codigo.gs`: recibe la notificación, **reconsulta** `GET /v1/payments/{id}`
  con el `MP_ACCESS_TOKEN` (no confía en el body), y solo si `status=approved` y
  `external_reference` coincide, marca el pedido como `Confirmado`. Idempotente por `payment.id`
  (guardar `mp_pay_<id>` en `CacheService` 24 h + columna `pago_id` en `Pedidos`).
- Conciliación: trigger cada 30 min que lista pagos aprobados de las últimas 24 h en MP y confirma
  los que falten (cubre webhooks perdidos). Alternativa sin webhook: solo la conciliación.
- Requiere: configurar la URL de notificación en la app de MP (lo hace el dueño) y una columna
  `pago_id` (pido OK).

### 5.4 Errores centralizados
- Envolver `doGet/doPost` con captura global: registrar en una pestaña `Errores` (fecha, acción,
  mensaje) y avisar por Telegram **solo** la primera vez por tipo de error cada 15 min
  (clave en `CacheService`) para no hacer spam.
- Tienda: si el CRM no responde en 12 s, mostrar "No pudimos registrar el pedido, no se te cobró
  nada; probá de nuevo o escribinos por WhatsApp" y mantener el carrito.

---

## 6. Plan de crecimiento por etapas (costo casi cero mientras alcance)

| Etapa | Cuándo (indicador) | Qué | Costo/mes | Trabajo |
|---|---|---|---|---|
| **0 — Ahora** | — | Lo de §3 + propuestas 5.2 y 5.4. Catálogo: subir `catalogo.json` al repo desde el CRM (botón "Publicar catálogo", igual que el manifest de fotos) y que `sheets.js` lo lea **primero** desde el CDN y use `gviz` solo como respaldo. Esto elimina el cuello de botella de `gviz` (Cloudflare sirve JSON estático a cualquier escala). | USD 0 | 1–2 días |
| **1 — Worker como puerta única** | > 200 pedidos/día **o** picos > 15 checkouts/min **o** errores de cuota en `Errores` | `checkout.html` llama a `/api/orders` (el Worker ya valida precios, rate limit en KV, Turnstile) y el Worker escribe en la planilla vía `SHEETS_WEBHOOK_URL` → CRM. Apps Script deja de ser el que recibe tráfico público. Reemplazar `products_cache` por el `catalogo.json` publicado (sin Supabase). | USD 0 (free) → USD 5 con Workers Paid si KV supera 1.000 escrituras/día | 3–5 días |
| **2 — Pedidos y stock en Postgres** | > 500 pedidos/día **o** stock por cantidad **o** > 5.000 clientes | Pedidos, clientes y stock en Supabase (Postgres con transacciones y RLS; el esquema `supabase-schema.sql` ya existe). La planilla pasa a ser **vista/export**, no fuente de verdad. CRM lee paginado desde el Worker. | Supabase Pro USD 25 + Workers Paid USD 5 | 2–3 semanas |
| **3 — Solo si hace falta** | > 2.000 pedidos/día sostenidos | Colas (Cloudflare Queues) para emails/avisos, réplicas de lectura, observabilidad (Sentry/Logpush). | USD 50–150 | según necesidad |

Costos en ARS: multiplicar por la cotización del día (no se asume un tipo de cambio en este
documento). Nada de microservicios ni servidores propios: todo es serverless y gratuito hasta
la etapa 1 inclusive.

### Indicadores a mirar (una vez por semana)
- Filas en `Pedidos externos` + `Pedidos` por día (umbral etapa 1: 200/día).
- Pedidos con `⚠ PRECIOS SIN VERIFICAR` (debe ser 0; si aparece, un producto fue renombrado o borrado).
- Errores por cuota en la pestaña `Errores` (propuesta 5.4): cualquier aparición = etapa 1.
- Tiempo de respuesta p95 de `createOrder` medido en staging (`tests/carga`): umbral 5 s.
- Tamaño de `localStorage` del catálogo (DevTools → Application): umbral 2 MB = catálogo por categoría.

---

## 7. Pruebas de carga — qué hay y qué falta

Listo en `tests/carga/` (Node sin dependencias y k6). **No se ejecutaron**: no existe entorno de
staging y los scripts bloquean producción. Para correrlas el dueño tiene que crear (ver
`tests/carga/README.md`): copia de la planilla con datos ficticios, implementación separada de
`Codigo.gs` apuntando a esa copia, con `MP_ACCESS_TOKEN` de **prueba** y sin Telegram.
Hasta tener esa medición, **no se afirma ninguna capacidad concreta**; los escenarios de §4.2
se basan en cuotas documentadas.

---

## 8. Cómo desplegar esta ronda (lo hace el dueño)

1. **Apps Script:** abrir el proyecto del CRM → reemplazar `Codigo.gs` por el archivo completo
   `crm/Codigo.gs` del repo → **Implementar → Administrar implementaciones → ✏️ → Versión: Nueva
   versión → Implementar**. La URL `/exec` **no cambia** (es la misma implementación), así que no
   hay que tocar `CRM_URL` ni `wrangler.toml`.
2. **Web:** merge de la rama `escalabilidad` a `main` (GitHub Pages publica solo).
   Orden recomendado: primero el Apps Script, después el merge (el `.gs` nuevo acepta los dos
   formatos de ítems, el viejo y el nuevo).
3. **Verificación posterior** (la hago yo con tu OK porque crea un pedido Pendiente real y un aviso
   por Telegram): checkout con un producto, transferencia → total correcto en la planilla; y
   `mp_preferencia` con precio manipulado → el total devuelto es el del catálogo.
