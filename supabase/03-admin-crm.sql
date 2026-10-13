-- ============================================================
-- Virtual Shop Baires · Supabase · Etapa 1c: acceso del CRM
-- El CRM entra con un usuario de Supabase Auth marcado como admin
-- (app_metadata.role = 'admin', que el usuario NO puede cambiarse a sí mismo).
-- Ese usuario puede leer y escribir todo; nadie más.
-- ============================================================

-- ¿El que hace la consulta es admin? (lee app_metadata, nunca user_metadata)
create or replace function public.es_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
revoke execute on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

grant select, insert, update, delete on public.categorias, public.productos, public.variantes to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop policy if exists "admin todo categorias" on public.categorias;
drop policy if exists "admin todo productos"  on public.productos;
drop policy if exists "admin todo variantes"  on public.variantes;
create policy "admin todo categorias" on public.categorias for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "admin todo productos" on public.productos for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
create policy "admin todo variantes" on public.variantes for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

select 'permisos de admin listos' as estado;
