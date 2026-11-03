-- Último precio de los productos SIN stock, para mostrarlo en la tienda ("Último precio: $X").
-- La clave pública sigue sin ver las variantes agotadas (el checkout del servidor depende de eso):
-- esta vista expone SOLO categoría, nombre y el precio más bajo que tenían, y nada más.
-- security_invoker = false a propósito: la vista lee las variantes agotadas con permisos del dueño,
-- pero devuelve únicamente estas tres columnas y solo de productos sin ninguna variante con stock.
create or replace view public.precios_sin_stock
with (security_invoker = false) as
select p.categoria,
       p.nombre,
       min(case when v.precio_descuento > 0 and v.precio_descuento < v.precio then v.precio_descuento else v.precio end) as precio
from public.productos p
join public.variantes v on v.producto_id = p.id
group by p.id, p.categoria, p.nombre
having not bool_or(v.stock)
   and min(case when v.precio_descuento > 0 and v.precio_descuento < v.precio then v.precio_descuento else v.precio end) > 0;

revoke all on public.precios_sin_stock from anon, authenticated;
grant select on public.precios_sin_stock to anon;
notify pgrst, 'reload schema';

select 'precios_sin_stock lista' as estado, count(*) as productos_sin_stock_con_precio from public.precios_sin_stock;
