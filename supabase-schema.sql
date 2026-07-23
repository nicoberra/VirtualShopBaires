-- ============================================================
--  SUPABASE SCHEMA — Virtual Shop Baires
--  Ejecutar en el SQL Editor de Supabase
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
--  TABLA: products_cache
--  Espejo de Google Sheets para validación de precios en el backend.
--  El Worker la actualiza periódicamente o en cada deploy del Apps Script.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products_cache (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  precio NUMERIC(12,2) NOT NULL,
  precio_original NUMERIC(12,2),
  color TEXT DEFAULT '',
  talle TEXT DEFAULT '',
  stock BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(nombre, categoria, color, talle)
);

-- ---------------------------------------------------------------------------
--  TABLA: orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number TEXT UNIQUE NOT NULL,  -- VSB-YYYYMMDD-XXXX

  -- Cliente
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT DEFAULT '',
  customer_notes TEXT DEFAULT '',

  -- Ítems validados (precio del backend, no del browser)
  items JSONB NOT NULL,

  -- Precios calculados server-side
  subtotal NUMERIC(12,2) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 30,
  discount_amount NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,

  -- Pago
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
  payment_status TEXT NOT NULL DEFAULT 'pending_transfer',
  -- pending_transfer | proof_uploaded | payment_confirmed | payment_rejected | expired | cancelled

  -- Ciclo del pedido
  order_status TEXT NOT NULL DEFAULT 'pending_payment',
  -- pending_payment | payment_review | preparing_order | ready_for_pickup | shipped | delivered | cancelled

  -- Comprobante
  proof_url TEXT,
  proof_uploaded_at TIMESTAMPTZ,

  -- Admin
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  rejection_reason TEXT,
  admin_notes TEXT,

  -- Envío
  tracking_number TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ  -- created_at + 48h para pagar
);

-- ---------------------------------------------------------------------------
--  ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_cache ENABLE ROW LEVEL SECURITY;

-- products_cache: lectura pública (precios no son secretos), escritura solo service_role
CREATE POLICY "products_read_public" ON products_cache
  FOR SELECT USING (true);
CREATE POLICY "products_write_service" ON products_cache
  FOR ALL USING (auth.role() = 'service_role');

-- orders: solo service_role (el Worker usa la service key; el frontend nunca accede directo)
CREATE POLICY "orders_service_only" ON orders
  FOR ALL USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
--  ÍNDICES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_number ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_nombre ON products_cache (nombre, categoria);

-- ---------------------------------------------------------------------------
--  STORAGE: bucket para comprobantes
--  Ejecutar en Supabase Dashboard → Storage → New bucket
--  O via SQL:
-- ---------------------------------------------------------------------------
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('payment-proofs', 'payment-proofs', false);
--
-- CREATE POLICY "proof_upload_service" ON storage.objects
--   FOR INSERT USING (auth.role() = 'service_role' AND bucket_id = 'payment-proofs');
-- CREATE POLICY "proof_read_service" ON storage.objects
--   FOR SELECT USING (auth.role() = 'service_role' AND bucket_id = 'payment-proofs');

-- ---------------------------------------------------------------------------
--  TRIGGER: updated_at automático
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
