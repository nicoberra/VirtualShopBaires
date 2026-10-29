-- Cantidad de stock por variante (unidades). Vacío = sin contar.
-- La carga el CRM (servidor con service_role). La tienda NO la ve: la clave pública
-- solo tiene permiso por columna (ver 01-productos.sql), y esta columna no se le da.
alter table public.variantes
  add column if not exists stock_cantidad integer
  check (stock_cantidad is null or stock_cantidad >= 0);

select 'stock_cantidad lista' as estado,
       count(*) as variantes,
       has_column_privilege('anon', 'public.variantes', 'stock_cantidad', 'select') as la_ve_la_tienda
from public.variantes;
