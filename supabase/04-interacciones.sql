-- ============================================================
-- Virtual Shop Baires · Supabase · Interacciones de la tienda
-- La tienda solo puede INSERTAR (ver ficha, agregar al carrito, favorito).
-- Nadie puede leerlas desde el navegador: las lee el servidor (clave secreta)
-- para ordenar los productos por popularidad.
-- ============================================================
create table if not exists public.interacciones (
  id        bigint generated always as identity primary key,
  categoria text not null default '' check (char_length(categoria) <= 80),
  nombre    text not null check (char_length(nombre) between 1 and 200),
  tipo      text not null check (tipo in ('vista', 'carrito', 'favorito')),
  creado    timestamptz not null default now()
);
create index if not exists interacciones_creado_idx on public.interacciones (creado);

alter table public.interacciones enable row level security;

-- Solo insertar, nada de leer/editar/borrar desde la tienda
revoke all on public.interacciones from anon, authenticated;
grant insert (categoria, nombre, tipo) on public.interacciones to anon;
grant select, insert, update, delete on public.interacciones to service_role;

drop policy if exists "tienda registra interacciones" on public.interacciones;
create policy "tienda registra interacciones" on public.interacciones
  for insert to anon
  with check (tipo in ('vista', 'carrito', 'favorito'));

select 'interacciones lista' as estado;
