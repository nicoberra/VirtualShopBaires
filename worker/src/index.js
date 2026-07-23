// ============================================================
//  Virtual Shop Baires — Cloudflare Worker API
//  Deplegar con: wrangler deploy
//  Rutas manejadas:
//    POST   /api/orders                      crear pedido
//    POST   /api/orders/:id/proof            subir comprobante
//    GET    /api/orders/:number              consultar pedido
//    GET    /api/admin/orders                listar pedidos (admin)
//    POST   /api/admin/orders/:id/confirm    confirmar pago
//    POST   /api/admin/orders/:id/reject     rechazar pago
//    PATCH  /api/admin/orders/:id/status     actualizar estado del pedido
//    POST   /api/admin/sync-products         sincronizar precios desde Sheets
// ============================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://virtualshopbaires.com.ar",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ── Helpers ────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function cors() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function supabase(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Prefer": options.prefer || "",
      ...options.headers,
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseStorage(env, bucket, filename, fileBuffer, contentType) {
  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/${bucket}/${filename}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "false",
      },
      body: fileBuffer,
    }
  );
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function supabaseStorageUrl(env, bucket, filename) {
  const res = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${filename}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 604800 }), // 7 días
    }
  );
  const d = await res.json();
  return d.signedURL ? `${env.SUPABASE_URL}/storage/v1${d.signedURL}` : null;
}

// Número de pedido único: VSB-YYYYMMDD-XXXX
function generateOrderNumber(date) {
  const d = date || new Date();
  const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `VSB-${yyyymmdd}-${rand}`;
}

// ── Rate Limiting (KV) ────────────────────────────────────

async function checkRateLimit(env, key, limit = 5, windowSec = 300) {
  if (!env.RATE_LIMIT) return true; // si no hay KV configurado, permitir
  const kvKey = `rl:${key}`;
  const val = await env.RATE_LIMIT.get(kvKey);
  const count = val ? parseInt(val) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(kvKey, String(count + 1), { expirationTtl: windowSec });
  return true;
}

// ── Turnstile ─────────────────────────────────────────────

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET || !token) return !env.TURNSTILE_SECRET; // skip si no está configurado
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || "" }),
  });
  const d = await res.json();
  return d.success === true;
}

// ── Auth Admin ────────────────────────────────────────────

function isAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "").trim();
  return token && token === env.ADMIN_TOKEN;
}

// ── Validación de precios ─────────────────────────────────

async function validateItems(env, cartItems) {
  // cartItems: [{ nombre, categoria, color?, talle?, qty, precio_cliente }]
  const validated = [];
  let subtotal = 0;

  for (const item of cartItems) {
    const nombre = String(item.nombre || "").trim();
    const categoria = String(item.categoria || "").trim();
    const color = String(item.color || "").trim();
    const talle = String(item.talle || "").trim();
    const qty = Math.max(1, Math.min(99, parseInt(item.qty) || 1));

    if (!nombre || !categoria || qty < 1) {
      throw new Error(`Ítem inválido: ${JSON.stringify(item)}`);
    }

    // Buscar precio en la cache de productos (Supabase)
    const q = new URLSearchParams({
      nombre: `eq.${nombre}`,
      categoria: `eq.${categoria}`,
      color: `eq.${color}`,
      talle: `eq.${talle}`,
      stock: "eq.true",
      select: "precio,nombre,categoria,color,talle",
      limit: "1",
    });

    const { ok, data } = await supabase(env, `/products_cache?${q}`);

    if (!ok || !Array.isArray(data) || data.length === 0) {
      // Fallback: buscar sin color/talle si el producto no tiene variantes
      const q2 = new URLSearchParams({
        nombre: `eq.${nombre}`,
        categoria: `eq.${categoria}`,
        stock: "eq.true",
        select: "precio,nombre,categoria,color,talle",
        limit: "1",
      });
      const r2 = await supabase(env, `/products_cache?${q2}`);
      if (!r2.ok || !Array.isArray(r2.data) || r2.data.length === 0) {
        throw new Error(`Producto no encontrado o sin stock: "${nombre}"`);
      }
      const p = r2.data[0];
      const precio = Number(p.precio);
      validated.push({ nombre, categoria, color: color || null, talle: talle || null, qty, precio_unit: precio, subtotal: precio * qty });
      subtotal += precio * qty;
    } else {
      const p = data[0];
      const precio = Number(p.precio);
      validated.push({ nombre, categoria, color: color || null, talle: talle || null, qty, precio_unit: precio, subtotal: precio * qty });
      subtotal += precio * qty;
    }
  }

  const discountPct = Number(env.DISCOUNT_PCT) || 30;
  const discountAmount = Math.round(subtotal * discountPct / 100 * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  return { items: validated, subtotal, discountPct, discountAmount, total };
}

// ── Emails (Resend) ───────────────────────────────────────

async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html }),
  });
}

function bankInfoHtml(env) {
  return `
    <div style="background:#f5f7fa;border:2px solid #CC1212;border-radius:10px;padding:20px;margin:20px 0;">
      <h3 style="color:#CC1212;margin:0 0 12px;">Datos para la transferencia</h3>
      <p><strong>Alias:</strong> ${env.BANK_ALIAS || "(configurar BANK_ALIAS)"}</p>
      <p><strong>CBU:</strong> ${env.BANK_CBU || "(configurar BANK_CBU)"}</p>
      <p><strong>Titular:</strong> ${env.BANK_HOLDER || "(configurar BANK_HOLDER)"}</p>
      <p><strong>Banco:</strong> ${env.BANK_BANK || "(configurar BANK_BANK)"}</p>
    </div>`;
}

async function sendOrderConfirmationEmail(env, order) {
  const itemsHtml = order.items.map(i =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i.nombre}${i.color ? ` — ${i.color}` : ""}${i.talle ? ` / ${i.talle}` : ""}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${i.precio_unit.toLocaleString("es-AR")}</td>
    </tr>`
  ).join("");

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1A1A1A;">
  <div style="background:#CC1212;padding:20px;text-align:center;">
    <h1 style="color:#fff;margin:0;">Virtual Shop Baires</h1>
    <p style="color:#fff;margin:8px 0 0;">Confirmación de pedido</p>
  </div>
  <div style="padding:24px;">
    <h2>Hola, ${order.customer_name}!</h2>
    <p>Recibimos tu pedido <strong>#${order.order_number}</strong>. Para confirmarlo, realizá la transferencia por el total indicado.</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f5f7fa;">
        <th style="padding:8px;text-align:left;">Producto</th>
        <th style="padding:8px;text-align:center;">Cant.</th>
        <th style="padding:8px;text-align:right;">Precio</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div style="text-align:right;margin-top:12px;">
      <p>Subtotal: $${order.subtotal.toLocaleString("es-AR")}</p>
      <p style="color:#CC1212;">Descuento transferencia (${order.discount_pct}%): -$${order.discount_amount.toLocaleString("es-AR")}</p>
      <p style="font-size:1.3rem;font-weight:700;color:#1B2B4B;">TOTAL A TRANSFERIR: $${order.total.toLocaleString("es-AR")}</p>
    </div>
    ${bankInfoHtml(env)}
    <p>Una vez realizada la transferencia, subí el comprobante desde este link:</p>
    <p><a href="${env.SITE_URL}/order-status.html?order=${order.order_number}&email=${encodeURIComponent(order.customer_email)}" style="background:#CC1212;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;">Ver mi pedido y subir comprobante</a></p>
    <p style="color:#6B7280;font-size:0.85rem;">El pedido expira en ${env.ORDER_EXPIRY_HOURS || 48} horas si no se recibe el comprobante.</p>
  </div>
  <div style="background:#1A1A1A;padding:16px;text-align:center;color:#9CA3AF;font-size:0.8rem;">
    © ${new Date().getFullYear()} Virtual Shop Baires — virtualshopbaires.com.ar
  </div>
</body></html>`;

  await sendEmail(env, { to: order.customer_email, subject: `Pedido #${order.order_number} — Virtual Shop Baires`, html });
}

async function sendProofReceivedEmail(env, order) {
  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#CC1212;padding:20px;text-align:center;">
    <h1 style="color:#fff;margin:0;">Virtual Shop Baires</h1>
  </div>
  <div style="padding:24px;">
    <h2>Comprobante recibido ✓</h2>
    <p>Hola <strong>${order.customer_name}</strong>, recibimos tu comprobante de pago para el pedido <strong>#${order.order_number}</strong>.</p>
    <p>Estamos verificando el pago. Te avisaremos por email cuando esté confirmado (generalmente en menos de 24 horas hábiles).</p>
    <p><a href="${env.SITE_URL}/order-status.html?order=${order.order_number}&email=${encodeURIComponent(order.customer_email)}">Ver estado de mi pedido →</a></p>
  </div>
</body></html>`;
  await sendEmail(env, { to: order.customer_email, subject: `Comprobante recibido — Pedido #${order.order_number}`, html });
}

async function sendPaymentConfirmedEmail(env, order) {
  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:#CC1212;padding:20px;text-align:center;">
    <h1 style="color:#fff;margin:0;">Virtual Shop Baires</h1>
  </div>
  <div style="padding:24px;">
    <h2 style="color:#1B2B4B;">¡Pago confirmado! 🎉</h2>
    <p>Hola <strong>${order.customer_name}</strong>, tu pago del pedido <strong>#${order.order_number}</strong> fue confirmado.</p>
    <p>Estamos preparando tu pedido. Te avisaremos cuando esté listo para envío.</p>
    <p><a href="${env.SITE_URL}/order-status.html?order=${order.order_number}&email=${encodeURIComponent(order.customer_email)}">Seguir mi pedido →</a></p>
  </div>
</body></html>`;
  await sendEmail(env, { to: order.customer_email, subject: `¡Pago confirmado! Pedido #${order.order_number}`, html });
}

async function sendAdminNotification(env, subject, html) {
  await sendEmail(env, { to: env.ADMIN_EMAIL, subject, html });
}

// ── Google Sheets Sync ────────────────────────────────────

async function syncToSheets(env, order) {
  if (!env.SHEETS_WEBHOOK_URL) return;
  try {
    await fetch(env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "newOrder", order }),
    });
  } catch (e) {
    console.warn("Sheets sync error:", e.message);
  }
}

// ── HANDLER: Crear pedido ─────────────────────────────────

async function handleCreateOrder(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ok = await checkRateLimit(env, ip, 5, 300);
  if (!ok) return err("Demasiados pedidos. Intentá en 5 minutos.", 429);

  let body;
  try { body = await request.json(); } catch { return err("Body inválido"); }

  const { turnstileToken, customer, items: cartItems } = body;

  // Validar Turnstile
  const turnstileOk = await verifyTurnstile(env, turnstileToken, ip);
  if (!turnstileOk) return err("Verificación de seguridad fallida. Recargá la página.", 403);

  // Validar cliente
  const name = String(customer?.name || "").trim();
  const email = String(customer?.email || "").trim().toLowerCase();
  const phone = String(customer?.phone || "").trim();
  const address = String(customer?.address || "").trim();
  const notes = String(customer?.notes || "").trim();

  if (!name || name.length < 2) return err("Nombre inválido");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Email inválido");
  if (!phone || phone.length < 7) return err("Teléfono inválido");

  // Validar ítems
  if (!Array.isArray(cartItems) || cartItems.length === 0) return err("El carrito está vacío");
  if (cartItems.length > 50) return err("Demasiados productos en el carrito");

  let pricing;
  try {
    pricing = await validateItems(env, cartItems);
  } catch (e) {
    return err(`Error de validación: ${e.message}`);
  }

  if (pricing.total <= 0) return err("Total inválido");

  // Crear pedido en Supabase
  const orderNumber = generateOrderNumber();
  const expiryHours = Number(env.ORDER_EXPIRY_HOURS) || 48;
  const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000).toISOString();

  const orderData = {
    order_number: orderNumber,
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    customer_address: address,
    customer_notes: notes,
    items: pricing.items,
    subtotal: pricing.subtotal,
    discount_pct: pricing.discountPct,
    discount_amount: pricing.discountAmount,
    total: pricing.total,
    payment_method: "bank_transfer",
    payment_status: "pending_transfer",
    order_status: "pending_payment",
    expires_at: expiresAt,
  };

  const { ok: createOk, data: created } = await supabase(env, "/orders", {
    method: "POST",
    body: JSON.stringify(orderData),
    prefer: "return=representation",
    headers: { "Prefer": "return=representation" },
  });

  if (!createOk) {
    console.error("Supabase create order error:", JSON.stringify(created));
    return err("Error al crear el pedido. Intentá de nuevo.", 500);
  }

  const order = Array.isArray(created) ? created[0] : created;

  // Enviar emails y sincronizar (no bloquean la respuesta)
  Promise.all([
    sendOrderConfirmationEmail(env, order),
    sendAdminNotification(env,
      `Nuevo pedido #${orderNumber} — $${pricing.total.toLocaleString("es-AR")}`,
      `<p>Nuevo pedido recibido: <strong>#${orderNumber}</strong></p>
       <p>Cliente: ${name} (${email})</p>
       <p>Total: $${pricing.total.toLocaleString("es-AR")}</p>
       <p><a href="${env.SITE_URL}/admin/">Ver panel admin →</a></p>`
    ),
    syncToSheets(env, order),
  ]).catch(e => console.warn("Post-order tasks error:", e.message));

  // Responder con datos del pedido + datos bancarios
  return json({
    order_number: orderNumber,
    order_id: order.id,
    total: pricing.total,
    subtotal: pricing.subtotal,
    discount_pct: pricing.discountPct,
    discount_amount: pricing.discountAmount,
    items: pricing.items,
    expires_at: expiresAt,
    bank: {
      alias: env.BANK_ALIAS || "",
      cbu: env.BANK_CBU || "",
      holder: env.BANK_HOLDER || "",
      bank: env.BANK_BANK || "",
    },
  });
}

// ── HANDLER: Subir comprobante ────────────────────────────

async function handleUploadProof(request, env, orderNumber) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ok = await checkRateLimit(env, `proof:${ip}`, 10, 600);
  if (!ok) return err("Demasiados intentos. Esperá unos minutos.", 429);

  // Verificar que el pedido existe y es el correcto
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").toLowerCase().trim();

  if (!email) return err("Email requerido");

  const q = new URLSearchParams({ order_number: `eq.${orderNumber}`, customer_email: `eq.${email}`, select: "id,order_number,customer_name,customer_email,payment_status,total" });
  const { ok: findOk, data: found } = await supabase(env, `/orders?${q}`);

  if (!findOk || !Array.isArray(found) || found.length === 0) return err("Pedido no encontrado", 404);
  const order = found[0];

  if (!["pending_transfer", "proof_uploaded"].includes(order.payment_status)) {
    return err("Este pedido ya no acepta comprobantes");
  }

  // Recibir el archivo
  const formData = await request.formData().catch(() => null);
  if (!formData) return err("Formulario inválido");
  const file = formData.get("proof");
  if (!file || typeof file === "string") return err("No se recibió archivo");

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowedTypes.includes(file.type)) return err("Tipo de archivo no permitido (JPG, PNG, PDF)");
  if (file.size > 10 * 1024 * 1024) return err("Archivo muy grande (máx 10MB)");

  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const filename = `${orderNumber}/${Date.now()}.${ext}`;
  const buffer = await file.arrayBuffer();

  const { ok: uploadOk } = await supabaseStorage(env, "payment-proofs", filename, buffer, file.type);
  if (!uploadOk) return err("Error al subir el archivo", 500);

  // Obtener URL firmada
  const signedUrl = await supabaseStorageUrl(env, "payment-proofs", filename);

  // Actualizar pedido
  await supabase(env, `/orders?id=eq.${order.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      proof_url: signedUrl || filename,
      proof_uploaded_at: new Date().toISOString(),
      payment_status: "proof_uploaded",
      order_status: "payment_review",
    }),
  });

  // Notificar
  Promise.all([
    sendProofReceivedEmail(env, order),
    sendAdminNotification(env,
      `Comprobante subido — Pedido #${orderNumber}`,
      `<p>El cliente <strong>${order.customer_name}</strong> subió el comprobante del pedido <strong>#${orderNumber}</strong>.</p>
       <p>Total: $${order.total?.toLocaleString("es-AR") || "?"}</p>
       <p><a href="${env.SITE_URL}/admin/">Ir al panel admin →</a></p>`
    ),
  ]).catch(() => {});

  return json({ success: true, message: "Comprobante recibido. Te avisaremos cuando confirmemos el pago." });
}

// ── HANDLER: Consultar pedido ─────────────────────────────

async function handleGetOrder(request, env, orderNumber) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").toLowerCase().trim();

  if (!email) return err("Email requerido");

  const q = new URLSearchParams({
    order_number: `eq.${orderNumber}`,
    customer_email: `eq.${email}`,
    select: "order_number,customer_name,items,subtotal,discount_pct,discount_amount,total,payment_status,order_status,created_at,expires_at,proof_uploaded_at,confirmed_at,shipped_at,delivered_at,tracking_number",
  });

  const { ok, data } = await supabase(env, `/orders?${q}`);
  if (!ok || !Array.isArray(data) || data.length === 0) return err("Pedido no encontrado", 404);

  return json(data[0]);
}

// ── HANDLER: Admin — listar pedidos ──────────────────────

async function handleAdminOrders(request, env) {
  if (!isAdmin(request, env)) return err("No autorizado", 401);

  const url = new URL(request.url);
  const status = url.searchParams.get("payment_status");
  const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));
  const offset = parseInt(url.searchParams.get("offset") || "0");

  const params = new URLSearchParams({
    select: "id,order_number,customer_name,customer_email,customer_phone,items,subtotal,discount_amount,total,payment_status,order_status,created_at,proof_uploaded_at,confirmed_at,proof_url,admin_notes,tracking_number",
    order: "created_at.desc",
    limit: String(limit),
    offset: String(offset),
  });
  if (status) params.set("payment_status", `eq.${status}`);

  const { ok, data } = await supabase(env, `/orders?${params}`, {
    headers: { "Range-Unit": "items", "Range": `${offset}-${offset + limit - 1}` },
  });

  if (!ok) return err("Error consultando pedidos", 500);
  return json(data);
}

// ── HANDLER: Admin — confirmar pago ──────────────────────

async function handleConfirmPayment(request, env, orderId) {
  if (!isAdmin(request, env)) return err("No autorizado", 401);
  const body = await request.json().catch(() => ({}));
  const notes = String(body.notes || "").trim();

  const { ok, data } = await supabase(env, `/orders?id=eq.${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({
      payment_status: "payment_confirmed",
      order_status: "preparing_order",
      confirmed_at: new Date().toISOString(),
      confirmed_by: "admin",
      admin_notes: notes || null,
    }),
    headers: { "Prefer": "return=representation" },
  });

  if (!ok) return err("Error actualizando pedido", 500);
  const order = Array.isArray(data) ? data[0] : data;

  // Notificar al cliente
  if (order?.customer_email) {
    sendPaymentConfirmedEmail(env, order).catch(() => {});
    syncToSheets(env, { ...order, action: "paymentConfirmed" }).catch(() => {});
  }

  return json({ success: true });
}

// ── HANDLER: Admin — rechazar pago ───────────────────────

async function handleRejectPayment(request, env, orderId) {
  if (!isAdmin(request, env)) return err("No autorizado", 401);
  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason || "Comprobante inválido").trim();

  const { ok, data } = await supabase(env, `/orders?id=eq.${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({
      payment_status: "payment_rejected",
      order_status: "payment_review",
      rejection_reason: reason,
    }),
    headers: { "Prefer": "return=representation" },
  });

  if (!ok) return err("Error actualizando pedido", 500);
  const order = Array.isArray(data) ? data[0] : data;

  if (order?.customer_email) {
    const html = `
      <p>Hola <strong>${order.customer_name}</strong>, el comprobante de tu pedido <strong>#${order.order_number}</strong> no pudo ser verificado.</p>
      <p><strong>Motivo:</strong> ${reason}</p>
      <p>Por favor, subí un nuevo comprobante o comunicate con nosotros por WhatsApp.</p>
      <p><a href="${env.SITE_URL}/order-status.html?order=${order.order_number}&email=${encodeURIComponent(order.customer_email)}">Ver mi pedido →</a></p>`;
    sendEmail(env, {
      to: order.customer_email,
      subject: `Problema con tu comprobante — Pedido #${order.order_number}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">${html}</body></html>`,
    }).catch(() => {});
    syncToSheets(env, { ...order, action: "paymentRejected" }).catch(() => {});
  }

  return json({ success: true });
}

// ── HANDLER: Admin — actualizar estado del pedido ─────────

async function handleUpdateOrderStatus(request, env, orderId) {
  if (!isAdmin(request, env)) return err("No autorizado", 401);
  const body = await request.json().catch(() => ({}));
  const validStatuses = ["pending_payment", "payment_review", "preparing_order", "ready_for_pickup", "shipped", "delivered", "cancelled"];
  if (!validStatuses.includes(body.order_status)) return err("Estado inválido");

  const patch = { order_status: body.order_status };
  if (body.tracking_number) patch.tracking_number = body.tracking_number;
  if (body.order_status === "shipped") patch.shipped_at = new Date().toISOString();
  if (body.order_status === "delivered") patch.delivered_at = new Date().toISOString();
  if (body.admin_notes) patch.admin_notes = body.admin_notes;

  const { ok } = await supabase(env, `/orders?id=eq.${orderId}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!ok) return err("Error actualizando pedido", 500);
  return json({ success: true });
}

// ── HANDLER: Sincronizar productos desde Sheets ───────────

async function handleSyncProducts(request, env) {
  // Este endpoint es llamado por el Apps Script luego de publicar
  // También puede llamarse con: wrangler secret put ADMIN_TOKEN y luego curl
  if (!isAdmin(request, env)) return err("No autorizado", 401);

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.products)) return err("Formato inválido. Enviar { products: [...] }");

  let synced = 0;
  const errors = [];

  for (const p of body.products) {
    const { ok, data } = await supabase(env, "/products_cache", {
      method: "POST",
      body: JSON.stringify({
        nombre: String(p.nombre || "").trim(),
        categoria: String(p.categoria || "").trim(),
        precio: Number(p.precio) || 0,
        precio_original: p.precio_original ? Number(p.precio_original) : null,
        color: String(p.color || "").trim(),
        talle: String(p.talle || "").trim(),
        stock: p.stock !== false,
      }),
      headers: { "Prefer": "resolution=merge-duplicates" },
    });
    if (ok) synced++;
    else errors.push({ producto: p.nombre, error: JSON.stringify(data) });
  }

  return json({ synced, errors, total: body.products.length });
}

// ── Router principal ──────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return cors();

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    const method = request.method;

    // POST /api/orders
    if (path === "/api/orders" && method === "POST")
      return handleCreateOrder(request, env);

    // POST /api/orders/:number/proof
    const proofMatch = path.match(/^\/api\/orders\/([^/]+)\/proof$/);
    if (proofMatch && method === "POST")
      return handleUploadProof(request, env, proofMatch[1]);

    // GET /api/orders/:number
    const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
    if (orderMatch && method === "GET")
      return handleGetOrder(request, env, orderMatch[1]);

    // GET /api/admin/orders
    if (path === "/api/admin/orders" && method === "GET")
      return handleAdminOrders(request, env);

    // POST /api/admin/orders/:id/confirm
    const confirmMatch = path.match(/^\/api\/admin\/orders\/([^/]+)\/confirm$/);
    if (confirmMatch && method === "POST")
      return handleConfirmPayment(request, env, confirmMatch[1]);

    // POST /api/admin/orders/:id/reject
    const rejectMatch = path.match(/^\/api\/admin\/orders\/([^/]+)\/reject$/);
    if (rejectMatch && method === "POST")
      return handleRejectPayment(request, env, rejectMatch[1]);

    // PATCH /api/admin/orders/:id/status
    const statusMatch = path.match(/^\/api\/admin\/orders\/([^/]+)\/status$/);
    if (statusMatch && method === "PATCH")
      return handleUpdateOrderStatus(request, env, statusMatch[1]);

    // POST /api/admin/sync-products
    if (path === "/api/admin/sync-products" && method === "POST")
      return handleSyncProducts(request, env);

    return json({ error: "Not found" }, 404);
  },
};
