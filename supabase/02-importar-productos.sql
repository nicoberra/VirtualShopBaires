-- ============================================================
-- Virtual Shop Baires · Supabase · Etapa 1b: cargar productos
-- Descarga supabase/import-productos.json (datos PÚBLICOS de la tienda:
-- sin SKU ni costos) y llena categorias / productos / variantes.
-- Reemplaza lo que haya. Los SKU se completan después desde el CRM
-- con migrarProductosASupabase() cuando esté SUPABASE_SECRET.
-- ============================================================
create extension if not exists http with schema extensions;

create temp table imp on commit drop as
select x.*, array(select jsonb_array_elements_text(x.imagenes_j)) as imagenes
from jsonb_to_recordset((
  select content::jsonb -> 'filas'
  from extensions.http_get('https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/supabase/import-productos.json')
)) as x(categoria text, nombre text, precio numeric, precio_descuento numeric, stock boolean, color text, talle text,
        descripcion text, destacado boolean, subcategoria text, imagen_url text, fila int, imagenes_j jsonb);

insert into public.categorias (nombre, orden, visible)
select c, ord - 1, true
from jsonb_array_elements_text((
  select content::jsonb -> 'categorias'
  from extensions.http_get('https://raw.githubusercontent.com/nicoberra/VirtualShopBaires/main/supabase/import-productos.json')
)) with ordinality as t(c, ord)
on conflict (nombre) do update set orden = excluded.orden;

delete from public.productos;

insert into public.productos (categoria, nombre, descripcion, subcategoria, destacado, imagenes, orden)
select i.categoria, i.nombre,
       coalesce((array_agg(nullif(i.descripcion, '') order by i.fila) filter (where nullif(i.descripcion, '') is not null))[1], ''),
       (array_agg(i.subcategoria order by i.fila) filter (where i.subcategoria is not null))[1],
       bool_or(i.destacado),
       (array_agg(i.imagenes order by i.fila))[1],
       min(c.orden) * 10000 + min(i.fila)
from imp i join public.categorias c on c.nombre = i.categoria
group by i.categoria, i.nombre;

insert into public.variantes (producto_id, color, talle, precio, precio_descuento, stock, imagen_url, orden)
select p.id, coalesce(i.color, ''), coalesce(i.talle, ''), i.precio, i.precio_descuento, i.stock, i.imagen_url,
       row_number() over (partition by p.id order by i.fila) - 1
from imp i join public.productos p on p.categoria = i.categoria and p.nombre = i.nombre;

select (select count(*) from public.categorias) as categorias,
       (select count(*) from public.productos)  as productos,
       (select count(*) from public.variantes)  as variantes,
       (select count(*) from public.variantes where stock) as con_stock;
