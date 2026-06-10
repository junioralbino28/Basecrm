-- rls hardening clinic pii — fecha 4 vazamentos cross-tenant antes de carregar PII real
-- mirror de 20260311013000_core_multi_tenant_rls.sql (helpers can_*_organization já existem)
-- nota/risco conhecido fora de escopo: storage bucket deal-files ainda vaza por path (tratar em fase de storage hardening)

-- 1. profiles — profiles_select era USING(true) (schema_init): qualquer authenticated lia profiles de todas as clínicas
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.can_access_organization(organization_id)
  );

-- 2. organizations — policy "authenticated_access" era FOR ALL USING (deleted_at is null) WITH CHECK(true)
-- handle_new_user / handle_new_organization são SECURITY DEFINER (furam RLS), então o signup NÃO depende dessa policy
drop policy if exists "authenticated_access" on public.organizations;

create policy "organizations_select_by_tenant" on public.organizations
  for select
  to authenticated
  using (
    deleted_at is null
    and public.can_access_organization(id)
  );

create policy "organizations_mutate_by_tenant_admin" on public.organizations
  for all
  to authenticated
  using (public.can_configure_organization(id))
  with check (public.can_configure_organization(id));
