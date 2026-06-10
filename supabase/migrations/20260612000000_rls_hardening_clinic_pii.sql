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

-- 3a. leads — era "Enable all access for authenticated users" USING(true). recebe os 202 pacientes reais → prioridade
drop policy if exists "Enable all access for authenticated users" on public.leads;

create policy "leads_select_by_tenant" on public.leads
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "leads_mutate_by_tenant_operator" on public.leads
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

-- 3b. tags — era "Enable all access for authenticated users" USING(true)
drop policy if exists "Enable all access for authenticated users" on public.tags;

create policy "tags_select_by_tenant" on public.tags
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "tags_mutate_by_tenant_operator" on public.tags
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

-- 3c. custom_field_definitions — era "Enable all access for authenticated users" USING(true)
drop policy if exists "Enable all access for authenticated users" on public.custom_field_definitions;

create policy "custom_field_definitions_select_by_tenant" on public.custom_field_definitions
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "custom_field_definitions_mutate_by_tenant_operator" on public.custom_field_definitions
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

-- 4. profile_permissions — tinha RLS ENABLE mas SEM policy (deny-all). usuário lê a própria permissão; só admin gerencia
drop policy if exists "profile_permissions_select" on public.profile_permissions;
create policy "profile_permissions_select" on public.profile_permissions
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_configure_organization(organization_id)
  );

drop policy if exists "profile_permissions_mutate_by_admin" on public.profile_permissions;
create policy "profile_permissions_mutate_by_admin" on public.profile_permissions
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));
