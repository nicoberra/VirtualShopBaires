-- ============================================================
-- Virtual Shop Baires · Supabase · Etapa 1: productos
-- Pegar COMPLETO en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Acceso:
--   · Público (clave publishable, desde la tienda): SOLO lectura de categorías
--     visibles, productos y variantes CON STOCK. Nunca ve sku_costo.
--   · CRM (clave secreta, solo desde Apps Script): lectura y escritura total.
-- ============================================================

-- ── Tablas ───────────────────────────────────────────────────
create table if not exists public.categorias (
  nombre      text primary key,
  orden       int  not null default 0,
  visible     boolean not null default true,
  actualizado timestamptz not null default now()
);

create table if not exists public.productos (
  id           bigint generated always as identity primary key,
  categoria    text not null references public.categorias(nombre) on update cascade,
  nombre       text not null,
  descripcion  text not null default '',
  subcategoria text,
  destacado    boolean not null default false,
  imagenes     text[] not null default '{}',
  orden        int not null default 0,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  unique (categoria, nombre)
);

create table if not exists public.variantes (
  id               bigint generated always as identity primary key,
  producto_id      bigint not null references public.productos(id) on delete cascade,
  color            text not null default '',
  talle            text not null default '',
  precio           numeric(12,2) not null check (precio >= 0),
  precio_descuento numeric(12,2) check (precio_descuento is null or precio_descuento >= 0),
  stock            boolean not null default true,
  sku_costo        text,            -- interno: nunca se publica
  imagen_url       text,
  orden            int not null default 0,
  actualizado      timestamptz not null default now()
);

create index if not exists productos_categoria_idx on public.productos (categoria);
create index if not exists variantes_producto_idx  on public.variantes (producto_id);

-- ── "actualizado" se completa solo ───────────────────────────
create or replace function public.tocar_actualizado()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.actualizado := now(); return new; end $$;
revoke execute on function public.tocar_actualizado() from public, anon, authenticated;

drop trigger if exists t_cat_act  on public.categorias;
drop trigger if exists t_prod_act on public.productos;
drop trigger if exists t_var_act  on public.variantes;
create trigger t_cat_act  before update on public.categorias for each row execute function public.tocar_actualizado();
create trigger t_prod_act before update on public.productos  for each row execute function public.tocar_actualizado();
create trigger t_var_act  before update on public.variantes  for each row execute function public.tocar_actualizado();

-- ── Seguridad por filas (RLS) ────────────────────────────────
alter table public.categorias enable row level security;
alter table public.productos  enable row level security;
alter table public.variantes  enable row level security;

drop policy if exists "publico ve categorias visibles" on public.categorias;
drop policy if exists "publico ve productos"           on public.productos;
drop policy if exists "publico ve variantes con stock" on public.variantes;
create policy "publico ve categorias visibles" on public.categorias for select to anon using (visible);
create policy "publico ve productos"           on public.productos  for select to anon using (true);
create policy "publico ve variantes con stock" on public.variantes  for select to anon using (stock);

-- ── Permisos (la exposición automática está apagada: se da solo lo necesario) ──
revoke all on public.categorias, public.productos, public.variantes from anon, authenticated;
grant select on public.categorias, public.productos to anon;
grant select (id, producto_id, color, talle, precio, precio_descuento, stock, imagen_url, orden)
  on public.variantes to anon;                       -- sin sku_costo

grant select, insert, update, delete on public.categorias, public.productos, public.variantes to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ── Verificación rápida ──────────────────────────────────────
select 'ok' as estado,
       (select count(*) from public.categorias) as categorias,
       (select count(*) from public.productos)  as productos,
       (select count(*) from public.variantes)  as variantes;
