-- =============================================================================
-- E3 — snapshots paralelos de defaults de permissão + ponteiro ativo
-- =============================================================================

alter table public.role_permission_defaults
  drop constraint role_permission_defaults_pkey;

alter table public.role_permission_defaults
  add constraint role_permission_defaults_pkey
    primary key (defaults_version, role, permission_key);

create table public.permission_defaults_state (
  singleton boolean primary key default true,
  active_version integer not null,
  updated_at timestamptz not null default now(),
  constraint permission_defaults_state_singleton check (singleton),
  constraint permission_defaults_state_version_positive check (active_version > 0)
);

alter table public.permission_defaults_state enable row level security;

revoke all on table public.permission_defaults_state from public;
revoke all on table public.permission_defaults_state from anon;
revoke all on table public.permission_defaults_state from authenticated;
grant select on table public.permission_defaults_state to service_role;

insert into public.permission_defaults_state (singleton, active_version)
values (true, 1);

-- E3_ROLE_PERMISSION_DEFAULTS_V2:START
-- Gerado por scripts/generate-e2-role-permission-defaults.mjs.
-- Fonte: ROLE_PERMISSION_DEFAULTS + getDefaultPermissionMap em lib/auth/permissions.ts.
insert into public.role_permission_defaults (defaults_version, role, permission_key, enabled)
values
  (2, 'agency_admin', 'dashboard.view', true),
  (2, 'agency_admin', 'overview.view', true),
  (2, 'agency_admin', 'contacts.view', true),
  (2, 'agency_admin', 'contacts.edit', true),
  (2, 'agency_admin', 'contacts.delete', true),
  (2, 'agency_admin', 'contacts.import_export', true),
  (2, 'agency_admin', 'funnels.view', true),
  (2, 'agency_admin', 'funnels.move', true),
  (2, 'agency_admin', 'funnels.manage', true),
  (2, 'agency_admin', 'deals.manage', true),
  (2, 'agency_admin', 'conversations.access', true),
  (2, 'agency_admin', 'conversations.reply', true),
  (2, 'agency_admin', 'whatsapp.access', true),
  (2, 'agency_admin', 'whatsapp.manage_connection', true),
  (2, 'agency_admin', 'activities.view', true),
  (2, 'agency_admin', 'activities.manage', true),
  (2, 'agency_admin', 'tasks.view', true),
  (2, 'agency_admin', 'tasks.manage', true),
  (2, 'agency_admin', 'call_list.access', true),
  (2, 'agency_admin', 'atendimentos.view', true),
  (2, 'agency_admin', 'atendimentos.manage', true),
  (2, 'agency_admin', 'agenda.view', true),
  (2, 'agency_admin', 'agenda.manage', true),
  (2, 'agency_admin', 'reports.view', true),
  (2, 'agency_admin', 'reports.finance', true),
  (2, 'agency_admin', 'reports.professionals', true),
  (2, 'agency_admin', 'ai.use', true),
  (2, 'agency_admin', 'ai.configure', true),
  (2, 'agency_admin', 'automation.edit', true),
  (2, 'agency_admin', 'automation.operate', true),
  (2, 'agency_admin', 'settings.general', true),
  (2, 'agency_admin', 'settings.products', true),
  (2, 'agency_admin', 'settings.professionals', true),
  (2, 'agency_admin', 'settings.finance', true),
  (2, 'agency_admin', 'settings.integrations', true),
  (2, 'agency_admin', 'settings.audit', true),
  (2, 'agency_admin', 'settings.users.manage', true),
  (2, 'agency_staff', 'dashboard.view', true),
  (2, 'agency_staff', 'overview.view', true),
  (2, 'agency_staff', 'contacts.view', true),
  (2, 'agency_staff', 'contacts.edit', true),
  (2, 'agency_staff', 'contacts.delete', true),
  (2, 'agency_staff', 'contacts.import_export', true),
  (2, 'agency_staff', 'funnels.view', true),
  (2, 'agency_staff', 'funnels.move', true),
  (2, 'agency_staff', 'funnels.manage', true),
  (2, 'agency_staff', 'deals.manage', true),
  (2, 'agency_staff', 'conversations.access', true),
  (2, 'agency_staff', 'conversations.reply', true),
  (2, 'agency_staff', 'whatsapp.access', true),
  (2, 'agency_staff', 'whatsapp.manage_connection', false),
  (2, 'agency_staff', 'activities.view', true),
  (2, 'agency_staff', 'activities.manage', true),
  (2, 'agency_staff', 'tasks.view', true),
  (2, 'agency_staff', 'tasks.manage', true),
  (2, 'agency_staff', 'call_list.access', true),
  (2, 'agency_staff', 'atendimentos.view', true),
  (2, 'agency_staff', 'atendimentos.manage', true),
  (2, 'agency_staff', 'agenda.view', true),
  (2, 'agency_staff', 'agenda.manage', true),
  (2, 'agency_staff', 'reports.view', true),
  (2, 'agency_staff', 'reports.finance', true),
  (2, 'agency_staff', 'reports.professionals', true),
  (2, 'agency_staff', 'ai.use', true),
  (2, 'agency_staff', 'ai.configure', true),
  (2, 'agency_staff', 'automation.edit', true),
  (2, 'agency_staff', 'automation.operate', true),
  (2, 'agency_staff', 'settings.general', true),
  (2, 'agency_staff', 'settings.products', true),
  (2, 'agency_staff', 'settings.professionals', true),
  (2, 'agency_staff', 'settings.finance', false),
  (2, 'agency_staff', 'settings.integrations', true),
  (2, 'agency_staff', 'settings.audit', false),
  (2, 'agency_staff', 'settings.users.manage', false),
  (2, 'clinic_admin', 'dashboard.view', true),
  (2, 'clinic_admin', 'overview.view', true),
  (2, 'clinic_admin', 'contacts.view', true),
  (2, 'clinic_admin', 'contacts.edit', true),
  (2, 'clinic_admin', 'contacts.delete', true),
  (2, 'clinic_admin', 'contacts.import_export', true),
  (2, 'clinic_admin', 'funnels.view', true),
  (2, 'clinic_admin', 'funnels.move', true),
  (2, 'clinic_admin', 'funnels.manage', true),
  (2, 'clinic_admin', 'deals.manage', true),
  (2, 'clinic_admin', 'conversations.access', true),
  (2, 'clinic_admin', 'conversations.reply', true),
  (2, 'clinic_admin', 'whatsapp.access', true),
  (2, 'clinic_admin', 'whatsapp.manage_connection', true),
  (2, 'clinic_admin', 'activities.view', true),
  (2, 'clinic_admin', 'activities.manage', true),
  (2, 'clinic_admin', 'tasks.view', true),
  (2, 'clinic_admin', 'tasks.manage', true),
  (2, 'clinic_admin', 'call_list.access', true),
  (2, 'clinic_admin', 'atendimentos.view', true),
  (2, 'clinic_admin', 'atendimentos.manage', true),
  (2, 'clinic_admin', 'agenda.view', true),
  (2, 'clinic_admin', 'agenda.manage', true),
  (2, 'clinic_admin', 'reports.view', true),
  (2, 'clinic_admin', 'reports.finance', true),
  (2, 'clinic_admin', 'reports.professionals', true),
  (2, 'clinic_admin', 'ai.use', true),
  (2, 'clinic_admin', 'ai.configure', true),
  (2, 'clinic_admin', 'automation.edit', true),
  (2, 'clinic_admin', 'automation.operate', true),
  (2, 'clinic_admin', 'settings.general', true),
  (2, 'clinic_admin', 'settings.products', true),
  (2, 'clinic_admin', 'settings.professionals', true),
  (2, 'clinic_admin', 'settings.finance', true),
  (2, 'clinic_admin', 'settings.integrations', true),
  (2, 'clinic_admin', 'settings.audit', true),
  (2, 'clinic_admin', 'settings.users.manage', true),
  (2, 'clinic_staff', 'dashboard.view', true),
  (2, 'clinic_staff', 'overview.view', true),
  (2, 'clinic_staff', 'contacts.view', true),
  (2, 'clinic_staff', 'contacts.edit', true),
  (2, 'clinic_staff', 'contacts.delete', false),
  (2, 'clinic_staff', 'contacts.import_export', false),
  (2, 'clinic_staff', 'funnels.view', true),
  (2, 'clinic_staff', 'funnels.move', true),
  (2, 'clinic_staff', 'funnels.manage', false),
  (2, 'clinic_staff', 'deals.manage', true),
  (2, 'clinic_staff', 'conversations.access', true),
  (2, 'clinic_staff', 'conversations.reply', true),
  (2, 'clinic_staff', 'whatsapp.access', false),
  (2, 'clinic_staff', 'whatsapp.manage_connection', false),
  (2, 'clinic_staff', 'activities.view', true),
  (2, 'clinic_staff', 'activities.manage', true),
  (2, 'clinic_staff', 'tasks.view', true),
  (2, 'clinic_staff', 'tasks.manage', true),
  (2, 'clinic_staff', 'call_list.access', true),
  (2, 'clinic_staff', 'atendimentos.view', true),
  (2, 'clinic_staff', 'atendimentos.manage', true),
  (2, 'clinic_staff', 'agenda.view', true),
  (2, 'clinic_staff', 'agenda.manage', true),
  (2, 'clinic_staff', 'reports.view', false),
  (2, 'clinic_staff', 'reports.finance', false),
  (2, 'clinic_staff', 'reports.professionals', false),
  (2, 'clinic_staff', 'ai.use', true),
  (2, 'clinic_staff', 'ai.configure', false),
  (2, 'clinic_staff', 'automation.edit', false),
  (2, 'clinic_staff', 'automation.operate', false),
  (2, 'clinic_staff', 'settings.general', false),
  (2, 'clinic_staff', 'settings.products', false),
  (2, 'clinic_staff', 'settings.professionals', false),
  (2, 'clinic_staff', 'settings.finance', false),
  (2, 'clinic_staff', 'settings.integrations', false),
  (2, 'clinic_staff', 'settings.audit', false),
  (2, 'clinic_staff', 'settings.users.manage', false),
  (2, 'admin', 'dashboard.view', true),
  (2, 'admin', 'overview.view', true),
  (2, 'admin', 'contacts.view', true),
  (2, 'admin', 'contacts.edit', true),
  (2, 'admin', 'contacts.delete', true),
  (2, 'admin', 'contacts.import_export', true),
  (2, 'admin', 'funnels.view', true),
  (2, 'admin', 'funnels.move', true),
  (2, 'admin', 'funnels.manage', true),
  (2, 'admin', 'deals.manage', true),
  (2, 'admin', 'conversations.access', true),
  (2, 'admin', 'conversations.reply', true),
  (2, 'admin', 'whatsapp.access', true),
  (2, 'admin', 'whatsapp.manage_connection', true),
  (2, 'admin', 'activities.view', true),
  (2, 'admin', 'activities.manage', true),
  (2, 'admin', 'tasks.view', true),
  (2, 'admin', 'tasks.manage', true),
  (2, 'admin', 'call_list.access', true),
  (2, 'admin', 'atendimentos.view', true),
  (2, 'admin', 'atendimentos.manage', true),
  (2, 'admin', 'agenda.view', true),
  (2, 'admin', 'agenda.manage', true),
  (2, 'admin', 'reports.view', true),
  (2, 'admin', 'reports.finance', true),
  (2, 'admin', 'reports.professionals', true),
  (2, 'admin', 'ai.use', true),
  (2, 'admin', 'ai.configure', true),
  (2, 'admin', 'automation.edit', true),
  (2, 'admin', 'automation.operate', true),
  (2, 'admin', 'settings.general', true),
  (2, 'admin', 'settings.products', true),
  (2, 'admin', 'settings.professionals', true),
  (2, 'admin', 'settings.finance', true),
  (2, 'admin', 'settings.integrations', true),
  (2, 'admin', 'settings.audit', true),
  (2, 'admin', 'settings.users.manage', true),
  (2, 'vendedor', 'dashboard.view', true),
  (2, 'vendedor', 'overview.view', true),
  (2, 'vendedor', 'contacts.view', true),
  (2, 'vendedor', 'contacts.edit', true),
  (2, 'vendedor', 'contacts.delete', false),
  (2, 'vendedor', 'contacts.import_export', false),
  (2, 'vendedor', 'funnels.view', true),
  (2, 'vendedor', 'funnels.move', true),
  (2, 'vendedor', 'funnels.manage', false),
  (2, 'vendedor', 'deals.manage', true),
  (2, 'vendedor', 'conversations.access', true),
  (2, 'vendedor', 'conversations.reply', true),
  (2, 'vendedor', 'whatsapp.access', false),
  (2, 'vendedor', 'whatsapp.manage_connection', false),
  (2, 'vendedor', 'activities.view', true),
  (2, 'vendedor', 'activities.manage', true),
  (2, 'vendedor', 'tasks.view', true),
  (2, 'vendedor', 'tasks.manage', true),
  (2, 'vendedor', 'call_list.access', true),
  (2, 'vendedor', 'atendimentos.view', true),
  (2, 'vendedor', 'atendimentos.manage', true),
  (2, 'vendedor', 'agenda.view', true),
  (2, 'vendedor', 'agenda.manage', true),
  (2, 'vendedor', 'reports.view', false),
  (2, 'vendedor', 'reports.finance', false),
  (2, 'vendedor', 'reports.professionals', false),
  (2, 'vendedor', 'ai.use', true),
  (2, 'vendedor', 'ai.configure', false),
  (2, 'vendedor', 'automation.edit', false),
  (2, 'vendedor', 'automation.operate', false),
  (2, 'vendedor', 'settings.general', false),
  (2, 'vendedor', 'settings.products', false),
  (2, 'vendedor', 'settings.professionals', false),
  (2, 'vendedor', 'settings.finance', false),
  (2, 'vendedor', 'settings.integrations', false),
  (2, 'vendedor', 'settings.audit', false),
  (2, 'vendedor', 'settings.users.manage', false)
on conflict (defaults_version, role, permission_key) do update
set enabled = excluded.enabled;
-- E3_ROLE_PERMISSION_DEFAULTS_V2:END

update public.permission_defaults_state
set active_version = 2,
    updated_at = now()
where singleton;

do $$
declare
  v_v1_rows integer;
  v_v2_rows integer;
  v_v1_roles integer;
  v_v2_roles integer;
  v_v1_permissions integer;
  v_v2_permissions integer;
  v_active_version integer;
begin
  select
    count(*) filter (where defaults_version = 1),
    count(*) filter (where defaults_version = 2),
    count(distinct role) filter (where defaults_version = 1),
    count(distinct role) filter (where defaults_version = 2),
    count(distinct permission_key) filter (where defaults_version = 1),
    count(distinct permission_key) filter (where defaults_version = 2)
  into
    v_v1_rows,
    v_v2_rows,
    v_v1_roles,
    v_v2_roles,
    v_v1_permissions,
    v_v2_permissions
  from public.role_permission_defaults;

  select active_version
  into v_active_version
  from public.permission_defaults_state
  where singleton;

  if v_v1_rows <> 222
    or v_v2_rows <> 222
    or v_v1_roles <> 6
    or v_v2_roles <> 6
    or v_v1_permissions <> 37
    or v_v2_permissions <> 37
    or v_active_version <> 2
  then
    raise exception
      'snapshots incompletos: v1_rows=%, v2_rows=%, v1_roles=%, v2_roles=%, v1_permissions=%, v2_permissions=%, active_version=%',
      v_v1_rows,
      v_v2_rows,
      v_v1_roles,
      v_v2_roles,
      v_v1_permissions,
      v_v2_permissions,
      v_active_version;
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version in (1, 2)
    group by defaults_version, role
    having count(*) <> 37
  ) then
    raise exception 'snapshot v1 ou v2 não contém 37 permissões por cargo';
  end if;
end;
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_profile_role text;
  v_profile_organization_id uuid;
  v_active_version integer;
  v_default boolean;
  v_override boolean;
  v_override_organization_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null or permission_key is null or btrim(permission_key) = '' then
    return false;
  end if;

  select p.role, p.organization_id
  into v_profile_role, v_profile_organization_id
  from public.profiles p
  where p.id = v_user_id;

  if not found or v_profile_organization_id is null then
    return false;
  end if;

  select state.active_version
  into v_active_version
  from public.permission_defaults_state state
  where state.singleton;

  if not found then
    return false;
  end if;

  -- O default ativo continua sendo pré-condição: override não cria chave órfã.
  select defaults.enabled
  into v_default
  from public.role_permission_defaults defaults
  where defaults.defaults_version = v_active_version
    and defaults.role = public.normalize_profile_role(v_profile_role)
    and defaults.permission_key = has_permission.permission_key;

  if not found then
    return false;
  end if;

  select override.enabled, override.organization_id
  into v_override, v_override_organization_id
  from public.profile_permissions override
  where override.user_id = v_user_id
    and override.permission_key = has_permission.permission_key;

  if found then
    if v_override_organization_id is distinct from v_profile_organization_id then
      return false;
    end if;
    return v_override;
  end if;

  return v_default;
end;
$$;

revoke all on function public.has_permission(text) from public;
revoke all on function public.has_permission(text) from anon;
grant execute on function public.has_permission(text) to authenticated;
