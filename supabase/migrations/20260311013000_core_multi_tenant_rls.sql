create or replace function public.normalize_profile_role(role_value text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when role_value in ('agency_admin', 'agency_staff', 'clinic_admin', 'clinic_staff', 'admin', 'vendedor') then role_value
    else 'vendedor'
  end
$$;

create or replace function public.current_profile_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.normalize_profile_role(public.current_profile_role())
$$;

create or replace function public.is_agency_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_app_role() in ('agency_admin', 'agency_staff', 'admin')
$$;

create or replace function public.is_agency_admin_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_app_role() in ('agency_admin', 'admin')
$$;

create or replace function public.can_access_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_agency_role()
    or public.current_profile_organization_id() = org_id
$$;

create or replace function public.can_operate_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_agency_role()
    or (
      public.current_profile_organization_id() = org_id
      and public.current_profile_app_role() in ('clinic_admin', 'clinic_staff', 'vendedor')
    )
$$;

create or replace function public.can_configure_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_agency_admin_role()
    or (
      public.current_profile_organization_id() = org_id
      and public.current_profile_app_role() in ('clinic_admin')
    )
$$;

create or replace function public.can_access_deal(target_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    where d.id = target_deal_id
      and public.can_access_organization(d.organization_id)
  )
$$;

create or replace function public.can_operate_deal(target_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    where d.id = target_deal_id
      and public.can_operate_organization(d.organization_id)
  )
$$;

create or replace function public.is_same_organization_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_configure_organization(org_id)
$$;

drop policy if exists "Enable read access for authenticated users" on public.boards;
drop policy if exists "Enable insert access for authenticated users" on public.boards;
drop policy if exists "Enable update access for authenticated users" on public.boards;
drop policy if exists "Enable delete access for authenticated users" on public.boards;

create policy "boards_select_by_tenant"
  on public.boards
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "boards_insert_by_tenant_admin"
  on public.boards
  for insert
  to authenticated
  with check (public.can_configure_organization(organization_id));

create policy "boards_update_by_tenant_admin"
  on public.boards
  for update
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

create policy "boards_delete_by_tenant_admin"
  on public.boards
  for delete
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "Enable read access for authenticated users" on public.board_stages;
drop policy if exists "Enable insert access for authenticated users" on public.board_stages;
drop policy if exists "Enable update access for authenticated users" on public.board_stages;
drop policy if exists "Enable delete access for authenticated users" on public.board_stages;

create policy "board_stages_select_by_tenant"
  on public.board_stages
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "board_stages_insert_by_tenant_admin"
  on public.board_stages
  for insert
  to authenticated
  with check (public.can_configure_organization(organization_id));

create policy "board_stages_update_by_tenant_admin"
  on public.board_stages
  for update
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

create policy "board_stages_delete_by_tenant_admin"
  on public.board_stages
  for delete
  to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.crm_companies;

create policy "crm_companies_select_by_tenant"
  on public.crm_companies
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "crm_companies_mutate_by_tenant_operator"
  on public.crm_companies
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.contacts;

create policy "contacts_select_by_tenant"
  on public.contacts
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "contacts_mutate_by_tenant_operator"
  on public.contacts
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.products;

create policy "products_select_by_tenant"
  on public.products
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "products_mutate_by_tenant_admin"
  on public.products
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.deals;

create policy "deals_select_by_tenant"
  on public.deals
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "deals_mutate_by_tenant_operator"
  on public.deals
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.deal_items;

create policy "deal_items_select_by_tenant"
  on public.deal_items
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "deal_items_mutate_by_tenant_operator"
  on public.deal_items
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop policy if exists "Enable all access for authenticated users" on public.activities;

create policy "activities_select_by_tenant"
  on public.activities
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "activities_mutate_by_tenant_operator"
  on public.activities
  for all
  to authenticated
  using (public.can_operate_organization(organization_id))
  with check (public.can_operate_organization(organization_id));

drop policy if exists "Admins can manage org settings" on public.organization_settings;
drop policy if exists "Members can view org settings" on public.organization_settings;

create policy "organization_settings_select_by_tenant"
  on public.organization_settings
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "organization_settings_mutate_by_tenant_admin"
  on public.organization_settings
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop policy if exists "Admins can manage api keys" on public.api_keys;

create policy "api_keys_select_by_tenant_admin"
  on public.api_keys
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

create policy "api_keys_mutate_by_tenant_admin"
  on public.api_keys
  for all
  to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

drop policy if exists "deal_notes_access" on public.deal_notes;
create policy "deal_notes_access_by_tenant"
  on public.deal_notes
  for all
  to authenticated
  using (public.can_access_deal(deal_id))
  with check (public.can_operate_deal(deal_id));

drop policy if exists "deal_files_access" on public.deal_files;
create policy "deal_files_access_by_tenant"
  on public.deal_files
  for all
  to authenticated
  using (public.can_access_deal(deal_id))
  with check (public.can_operate_deal(deal_id));
