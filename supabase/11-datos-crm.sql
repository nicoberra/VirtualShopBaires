-- Datos del CRM (pedidos, clientes, cuentas de la tienda, suscriptores, dispositivos,
-- notificaciones y errores). Cada fila de una pestaña de la planilla es una fila acá,
-- encabezado incluido (orden 0). Solo la usa el servidor del CRM con la clave secreta:
-- la tienda y el navegador no pueden leerla (RLS sin políticas + sin permisos para anon).
create table if not exists public.crm_filas (
  id      bigint generated always as identity primary key,
  hoja    text not null,
  orden   double precision not null default 0,
  valores jsonb not null default '[]'::jsonb,
  creado  timestamptz not null default now()
);

create index if not exists crm_filas_hoja_orden on public.crm_filas (hoja, orden, id);

alter table public.crm_filas enable row level security;
revoke all on public.crm_filas from anon, authenticated;
grant select, insert, update, delete on public.crm_filas to service_role;

-- Comprobación: debe devolver 0 filas y rls = true
select (select count(*) from public.crm_filas) as filas,
       (select relrowsecurity from pg_class where relname = 'crm_filas') as rls;
