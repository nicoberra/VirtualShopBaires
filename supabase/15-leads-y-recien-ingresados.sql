-- ============================================================
-- Virtual Shop Baires · Supabase · Leads de Instagram + "recién ingresados"
--
-- 1) public.leads: los "Avisame cuando entra" de ofertas.html.
--    La tienda (clave publishable / anon) SOLO puede insertar. Nadie puede leerlos
--    desde el navegador: los lee el CRM a través del servidor (Codigo.gs, clave secreta).
--    Antispam en la base: un mismo WhatsApp no genera duplicados (se actualiza el mismo lead,
--    como mucho una vez cada 10 minutos) y si entran más de 40 en 10 minutos se descartan.
--
-- 2) variantes.stock_desde: cuándo volvió a entrar cada variante (se completa sola cuando el
--    stock pasa de "sin stock" a "con stock"). ofertas.html lo usa para "Recién ingresados".
--
-- Se puede correr más de una vez.
-- ============================================================

-- ── 1) LEADS ──────────────────────────────────────────────────
create table if not exists public.leads (
  id           bigint generated always as identity primary key,
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now(),
  nombre       text not null check (char_length(btrim(nombre)) between 2 and 80),
  whatsapp     text not null check (whatsapp ~ '^[0-9]{10,15}$'),
  categorias   text[] not null default '{}' check (cardinality(categorias) <= 30),
  utm_source   text check (char_length(utm_source)   <= 100),
  utm_medium   text check (char_length(utm_medium)   <= 100),
  utm_campaign text check (char_length(utm_campaign) <= 100),
  utm_content  text check (char_length(utm_content)  <= 100),
  utm_term     text check (char_length(utm_term)     <= 100),
  origen       text check (char_length(origen) <= 120),
  veces        integer not null default 1
);
create unique index if not exists leads_whatsapp_uq on public.leads (whatsapp);
create index if not exists leads_actualizado_idx on public.leads (actualizado desc);

alter table public.leads enable row level security;

-- Solo insertar (y solo estas columnas); nada de leer, editar ni borrar desde la tienda
revoke all on public.leads from anon, authenticated;
grant insert (nombre, whatsapp, categorias, utm_source, utm_medium, utm_campaign, utm_content, utm_term, origen)
  on public.leads to anon;
grant select, insert, update, delete on public.leads to service_role;

drop policy if exists "tienda deja leads" on public.leads;
create policy "tienda deja leads" on public.leads
  for insert to anon
  with check (whatsapp ~ '^[0-9]{10,15}$' and char_length(btrim(nombre)) between 2 and 80);

-- Antes de guardar: limpia, limita y evita duplicados por WhatsApp.
-- security definer porque necesita LEER la tabla (la tienda no puede); es función de trigger,
-- así que no se puede llamar desde la API.
create or replace function public.leads_antes_de_guardar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previo public.leads%rowtype;
begin
  new.nombre := left(btrim(new.nombre), 80);
  new.categorias := coalesce((
    select array_agg(c order by c) from (
      select distinct left(btrim(c), 80) as c from unnest(new.categorias) as c where btrim(c) <> ''
    ) s), '{}');
  new.categorias := new.categorias[1:30];

  -- Límite general: más de 40 en 10 minutos = bots, se descarta sin error
  if (select count(*) from public.leads where actualizado > now() - interval '10 minutes') >= 40 then
    return null;
  end if;

  select * into previo from public.leads where whatsapp = new.whatsapp for update;
  if found then
    -- Límite por WhatsApp: el mismo número cada 10 minutos como mucho
    if previo.actualizado > now() - interval '10 minutes' then return null; end if;
    update public.leads set
      nombre       = new.nombre,
      categorias   = (select coalesce(array_agg(distinct c order by c), '{}') from unnest(previo.categorias || new.categorias) as c),
      utm_source   = coalesce(new.utm_source,   previo.utm_source),
      utm_medium   = coalesce(new.utm_medium,   previo.utm_medium),
      utm_campaign = coalesce(new.utm_campaign, previo.utm_campaign),
      utm_content  = coalesce(new.utm_content,  previo.utm_content),
      utm_term     = coalesce(new.utm_term,     previo.utm_term),
      origen       = coalesce(new.origen,       previo.origen),
      actualizado  = now(),
      veces        = previo.veces + 1
    where id = previo.id;
    return null;   -- ya existía: se actualizó, no se crea otro
  end if;

  new.creado := now(); new.actualizado := now(); new.veces := 1;
  return new;
end $$;
revoke execute on function public.leads_antes_de_guardar() from public, anon, authenticated;

drop trigger if exists t_leads_antes on public.leads;
create trigger t_leads_antes before insert on public.leads
  for each row execute function public.leads_antes_de_guardar();

-- ── 2) RECIÉN INGRESADOS ──────────────────────────────────────
alter table public.variantes add column if not exists stock_desde timestamptz;

create or replace function public.variantes_stock_desde()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.stock and (tg_op = 'INSERT' or not coalesce(old.stock, false)) then
    new.stock_desde := now();
  end if;
  return new;
end $$;
revoke execute on function public.variantes_stock_desde() from public, anon, authenticated;

drop trigger if exists t_var_stock_desde on public.variantes;
create trigger t_var_stock_desde before insert or update on public.variantes
  for each row execute function public.variantes_stock_desde();

-- Las que hoy tienen stock: se toma su última modificación como fecha de ingreso
-- (sin tocar "actualizado", por eso se apaga un momento el trigger que lo actualiza)
alter table public.variantes disable trigger t_var_act;
update public.variantes set stock_desde = actualizado where stock and stock_desde is null;
alter table public.variantes enable trigger t_var_act;

-- La tienda puede leer esta fecha (igual que el resto de las columnas públicas de la variante)
grant select (stock_desde) on public.variantes to anon;

notify pgrst, 'reload schema';

-- ── Comprobación ──────────────────────────────────────────────
select 'leads lista' as estado,
       has_table_privilege('anon', 'public.leads', 'select')        as tienda_puede_leer_leads,      -- debe ser false
       has_any_column_privilege('anon', 'public.leads', 'insert')   as tienda_puede_cargar_leads,    -- debe ser true
       has_column_privilege('anon', 'public.variantes', 'stock_desde', 'select') as tienda_ve_stock_desde, -- true
       (select count(*) from public.variantes where stock and stock_desde is not null) as variantes_con_fecha;
