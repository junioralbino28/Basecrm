-- =============================================================================
-- Funil Construtor — F1: authoring multi-tenant e permissões
-- =============================================================================
-- Draft e execução são separados desde a base. Esta migration cria apenas o
-- authoring; versões imutáveis e estado de execução entram em F2/F3.
-- =============================================================================

-- As duas permissões novas precisam existir no snapshot server-side antes das
-- policies abaixo. O bloco é gerado da mesma fonte usada pelo frontend.
-- E2_ROLE_PERMISSION_DEFAULTS:START
-- Gerado por scripts/generate-e2-role-permission-defaults.mjs.
-- Fonte: ROLE_PERMISSION_DEFAULTS + getDefaultPermissionMap em lib/auth/permissions.ts.
insert into public.role_permission_defaults (defaults_version, role, permission_key, enabled)
values
  (1, 'agency_admin', 'dashboard.view', true),
  (1, 'agency_admin', 'overview.view', true),
  (1, 'agency_admin', 'contacts.view', true),
  (1, 'agency_admin', 'contacts.edit', true),
  (1, 'agency_admin', 'contacts.delete', true),
  (1, 'agency_admin', 'contacts.import_export', true),
  (1, 'agency_admin', 'funnels.view', true),
  (1, 'agency_admin', 'funnels.move', true),
  (1, 'agency_admin', 'funnels.manage', true),
  (1, 'agency_admin', 'deals.manage', true),
  (1, 'agency_admin', 'conversations.access', true),
  (1, 'agency_admin', 'conversations.reply', true),
  (1, 'agency_admin', 'whatsapp.access', true),
  (1, 'agency_admin', 'whatsapp.manage_connection', true),
  (1, 'agency_admin', 'activities.view', true),
  (1, 'agency_admin', 'activities.manage', true),
  (1, 'agency_admin', 'tasks.view', true),
  (1, 'agency_admin', 'tasks.manage', true),
  (1, 'agency_admin', 'call_list.access', true),
  (1, 'agency_admin', 'atendimentos.view', true),
  (1, 'agency_admin', 'atendimentos.manage', true),
  (1, 'agency_admin', 'agenda.view', true),
  (1, 'agency_admin', 'agenda.manage', true),
  (1, 'agency_admin', 'reports.view', true),
  (1, 'agency_admin', 'reports.finance', true),
  (1, 'agency_admin', 'reports.professionals', true),
  (1, 'agency_admin', 'ai.use', true),
  (1, 'agency_admin', 'ai.configure', true),
  (1, 'agency_admin', 'automation.edit', true),
  (1, 'agency_admin', 'automation.operate', true),
  (1, 'agency_admin', 'settings.general', true),
  (1, 'agency_admin', 'settings.products', true),
  (1, 'agency_admin', 'settings.professionals', true),
  (1, 'agency_admin', 'settings.finance', true),
  (1, 'agency_admin', 'settings.integrations', true),
  (1, 'agency_admin', 'settings.audit', true),
  (1, 'agency_admin', 'settings.users.manage', true),
  (1, 'agency_staff', 'dashboard.view', true),
  (1, 'agency_staff', 'overview.view', true),
  (1, 'agency_staff', 'contacts.view', true),
  (1, 'agency_staff', 'contacts.edit', true),
  (1, 'agency_staff', 'contacts.delete', true),
  (1, 'agency_staff', 'contacts.import_export', true),
  (1, 'agency_staff', 'funnels.view', true),
  (1, 'agency_staff', 'funnels.move', true),
  (1, 'agency_staff', 'funnels.manage', true),
  (1, 'agency_staff', 'deals.manage', true),
  (1, 'agency_staff', 'conversations.access', true),
  (1, 'agency_staff', 'conversations.reply', true),
  (1, 'agency_staff', 'whatsapp.access', true),
  (1, 'agency_staff', 'whatsapp.manage_connection', false),
  (1, 'agency_staff', 'activities.view', true),
  (1, 'agency_staff', 'activities.manage', true),
  (1, 'agency_staff', 'tasks.view', true),
  (1, 'agency_staff', 'tasks.manage', true),
  (1, 'agency_staff', 'call_list.access', true),
  (1, 'agency_staff', 'atendimentos.view', true),
  (1, 'agency_staff', 'atendimentos.manage', true),
  (1, 'agency_staff', 'agenda.view', true),
  (1, 'agency_staff', 'agenda.manage', true),
  (1, 'agency_staff', 'reports.view', true),
  (1, 'agency_staff', 'reports.finance', true),
  (1, 'agency_staff', 'reports.professionals', true),
  (1, 'agency_staff', 'ai.use', true),
  (1, 'agency_staff', 'ai.configure', true),
  (1, 'agency_staff', 'automation.edit', true),
  (1, 'agency_staff', 'automation.operate', true),
  (1, 'agency_staff', 'settings.general', true),
  (1, 'agency_staff', 'settings.products', true),
  (1, 'agency_staff', 'settings.professionals', true),
  (1, 'agency_staff', 'settings.finance', false),
  (1, 'agency_staff', 'settings.integrations', true),
  (1, 'agency_staff', 'settings.audit', false),
  (1, 'agency_staff', 'settings.users.manage', false),
  (1, 'clinic_admin', 'dashboard.view', true),
  (1, 'clinic_admin', 'overview.view', true),
  (1, 'clinic_admin', 'contacts.view', true),
  (1, 'clinic_admin', 'contacts.edit', true),
  (1, 'clinic_admin', 'contacts.delete', true),
  (1, 'clinic_admin', 'contacts.import_export', true),
  (1, 'clinic_admin', 'funnels.view', true),
  (1, 'clinic_admin', 'funnels.move', true),
  (1, 'clinic_admin', 'funnels.manage', true),
  (1, 'clinic_admin', 'deals.manage', true),
  (1, 'clinic_admin', 'conversations.access', true),
  (1, 'clinic_admin', 'conversations.reply', true),
  (1, 'clinic_admin', 'whatsapp.access', true),
  (1, 'clinic_admin', 'whatsapp.manage_connection', true),
  (1, 'clinic_admin', 'activities.view', true),
  (1, 'clinic_admin', 'activities.manage', true),
  (1, 'clinic_admin', 'tasks.view', true),
  (1, 'clinic_admin', 'tasks.manage', true),
  (1, 'clinic_admin', 'call_list.access', true),
  (1, 'clinic_admin', 'atendimentos.view', true),
  (1, 'clinic_admin', 'atendimentos.manage', true),
  (1, 'clinic_admin', 'agenda.view', true),
  (1, 'clinic_admin', 'agenda.manage', true),
  (1, 'clinic_admin', 'reports.view', true),
  (1, 'clinic_admin', 'reports.finance', true),
  (1, 'clinic_admin', 'reports.professionals', true),
  (1, 'clinic_admin', 'ai.use', true),
  (1, 'clinic_admin', 'ai.configure', true),
  (1, 'clinic_admin', 'automation.edit', true),
  (1, 'clinic_admin', 'automation.operate', true),
  (1, 'clinic_admin', 'settings.general', true),
  (1, 'clinic_admin', 'settings.products', true),
  (1, 'clinic_admin', 'settings.professionals', true),
  (1, 'clinic_admin', 'settings.finance', true),
  (1, 'clinic_admin', 'settings.integrations', true),
  (1, 'clinic_admin', 'settings.audit', true),
  (1, 'clinic_admin', 'settings.users.manage', true),
  (1, 'clinic_staff', 'dashboard.view', true),
  (1, 'clinic_staff', 'overview.view', true),
  (1, 'clinic_staff', 'contacts.view', true),
  (1, 'clinic_staff', 'contacts.edit', true),
  (1, 'clinic_staff', 'contacts.delete', false),
  (1, 'clinic_staff', 'contacts.import_export', false),
  (1, 'clinic_staff', 'funnels.view', true),
  (1, 'clinic_staff', 'funnels.move', true),
  (1, 'clinic_staff', 'funnels.manage', false),
  (1, 'clinic_staff', 'deals.manage', true),
  (1, 'clinic_staff', 'conversations.access', true),
  (1, 'clinic_staff', 'conversations.reply', true),
  (1, 'clinic_staff', 'whatsapp.access', false),
  (1, 'clinic_staff', 'whatsapp.manage_connection', false),
  (1, 'clinic_staff', 'activities.view', true),
  (1, 'clinic_staff', 'activities.manage', true),
  (1, 'clinic_staff', 'tasks.view', true),
  (1, 'clinic_staff', 'tasks.manage', true),
  (1, 'clinic_staff', 'call_list.access', true),
  (1, 'clinic_staff', 'atendimentos.view', true),
  (1, 'clinic_staff', 'atendimentos.manage', true),
  (1, 'clinic_staff', 'agenda.view', true),
  (1, 'clinic_staff', 'agenda.manage', true),
  (1, 'clinic_staff', 'reports.view', false),
  (1, 'clinic_staff', 'reports.finance', false),
  (1, 'clinic_staff', 'reports.professionals', false),
  (1, 'clinic_staff', 'ai.use', true),
  (1, 'clinic_staff', 'ai.configure', false),
  (1, 'clinic_staff', 'automation.edit', false),
  (1, 'clinic_staff', 'automation.operate', true),
  (1, 'clinic_staff', 'settings.general', false),
  (1, 'clinic_staff', 'settings.products', false),
  (1, 'clinic_staff', 'settings.professionals', false),
  (1, 'clinic_staff', 'settings.finance', false),
  (1, 'clinic_staff', 'settings.integrations', false),
  (1, 'clinic_staff', 'settings.audit', false),
  (1, 'clinic_staff', 'settings.users.manage', false),
  (1, 'admin', 'dashboard.view', true),
  (1, 'admin', 'overview.view', true),
  (1, 'admin', 'contacts.view', true),
  (1, 'admin', 'contacts.edit', true),
  (1, 'admin', 'contacts.delete', true),
  (1, 'admin', 'contacts.import_export', true),
  (1, 'admin', 'funnels.view', true),
  (1, 'admin', 'funnels.move', true),
  (1, 'admin', 'funnels.manage', true),
  (1, 'admin', 'deals.manage', true),
  (1, 'admin', 'conversations.access', true),
  (1, 'admin', 'conversations.reply', true),
  (1, 'admin', 'whatsapp.access', true),
  (1, 'admin', 'whatsapp.manage_connection', true),
  (1, 'admin', 'activities.view', true),
  (1, 'admin', 'activities.manage', true),
  (1, 'admin', 'tasks.view', true),
  (1, 'admin', 'tasks.manage', true),
  (1, 'admin', 'call_list.access', true),
  (1, 'admin', 'atendimentos.view', true),
  (1, 'admin', 'atendimentos.manage', true),
  (1, 'admin', 'agenda.view', true),
  (1, 'admin', 'agenda.manage', true),
  (1, 'admin', 'reports.view', true),
  (1, 'admin', 'reports.finance', true),
  (1, 'admin', 'reports.professionals', true),
  (1, 'admin', 'ai.use', true),
  (1, 'admin', 'ai.configure', true),
  (1, 'admin', 'automation.edit', true),
  (1, 'admin', 'automation.operate', true),
  (1, 'admin', 'settings.general', true),
  (1, 'admin', 'settings.products', true),
  (1, 'admin', 'settings.professionals', true),
  (1, 'admin', 'settings.finance', true),
  (1, 'admin', 'settings.integrations', true),
  (1, 'admin', 'settings.audit', true),
  (1, 'admin', 'settings.users.manage', true),
  (1, 'vendedor', 'dashboard.view', true),
  (1, 'vendedor', 'overview.view', true),
  (1, 'vendedor', 'contacts.view', true),
  (1, 'vendedor', 'contacts.edit', true),
  (1, 'vendedor', 'contacts.delete', false),
  (1, 'vendedor', 'contacts.import_export', false),
  (1, 'vendedor', 'funnels.view', true),
  (1, 'vendedor', 'funnels.move', true),
  (1, 'vendedor', 'funnels.manage', false),
  (1, 'vendedor', 'deals.manage', true),
  (1, 'vendedor', 'conversations.access', true),
  (1, 'vendedor', 'conversations.reply', true),
  (1, 'vendedor', 'whatsapp.access', false),
  (1, 'vendedor', 'whatsapp.manage_connection', false),
  (1, 'vendedor', 'activities.view', true),
  (1, 'vendedor', 'activities.manage', true),
  (1, 'vendedor', 'tasks.view', true),
  (1, 'vendedor', 'tasks.manage', true),
  (1, 'vendedor', 'call_list.access', true),
  (1, 'vendedor', 'atendimentos.view', true),
  (1, 'vendedor', 'atendimentos.manage', true),
  (1, 'vendedor', 'agenda.view', true),
  (1, 'vendedor', 'agenda.manage', true),
  (1, 'vendedor', 'reports.view', false),
  (1, 'vendedor', 'reports.finance', false),
  (1, 'vendedor', 'reports.professionals', false),
  (1, 'vendedor', 'ai.use', true),
  (1, 'vendedor', 'ai.configure', false),
  (1, 'vendedor', 'automation.edit', false),
  (1, 'vendedor', 'automation.operate', true),
  (1, 'vendedor', 'settings.general', false),
  (1, 'vendedor', 'settings.products', false),
  (1, 'vendedor', 'settings.professionals', false),
  (1, 'vendedor', 'settings.finance', false),
  (1, 'vendedor', 'settings.integrations', false),
  (1, 'vendedor', 'settings.audit', false),
  (1, 'vendedor', 'settings.users.manage', false)
on conflict (role, permission_key) do update
set defaults_version = excluded.defaults_version,
    enabled = excluded.enabled;
-- E2_ROLE_PERMISSION_DEFAULTS:END

do $$
declare
  v_rows integer;
  v_roles integer;
  v_permissions integer;
  v_wrong_version integer;
begin
  select
    count(*),
    count(distinct role),
    count(distinct permission_key),
    count(*) filter (where defaults_version <> 1)
  into v_rows, v_roles, v_permissions, v_wrong_version
  from public.role_permission_defaults;

  if v_rows <> 222
    or v_roles <> 6
    or v_permissions <> 37
    or v_wrong_version <> 0
  then
    raise exception 'snapshot de permissões F1 incompleto: rows=%, roles=%, permissions=%, wrong_version=%',
      v_rows, v_roles, v_permissions, v_wrong_version;
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    group by role
    having count(*) <> 37
  ) then
    raise exception 'snapshot F1 não contém 37 permissões por cargo';
  end if;
end;
$$;

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  lifecycle_status text not null default 'draft',
  delivery_mode text not null default 'simulation',
  trigger_type text not null default 'tag_added',
  trigger_config jsonb not null default '{}'::jsonb,
  published_version_id uuid,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_name_not_blank check (btrim(name) <> ''),
  constraint automations_lifecycle_status_known
    check (lifecycle_status in ('draft', 'published', 'paused', 'archived')),
  constraint automations_delivery_mode_known
    check (delivery_mode in ('simulation', 'test', 'live')),
  constraint automations_trigger_type_v1
    check (trigger_type in ('tag_added')),
  constraint automations_trigger_config_object
    check (jsonb_typeof(trigger_config) = 'object'),
  constraint automations_id_organization_unique unique (id, organization_id)
);

comment on column public.automations.published_version_id is
  'Versão imutável ativa; a FK é instalada em F2 depois de automation_versions.';

create table public.automation_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null,
  step_key uuid not null default gen_random_uuid(),
  step_type text not null,
  config jsonb not null default '{}'::jsonb,
  sort_key integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_steps_type_known
    check (step_type in ('send_message', 'delay', 'wait_for_event', 'create_task', 'move_stage', 'move_pipeline', 'condition')),
  constraint automation_steps_config_object
    check (jsonb_typeof(config) = 'object'),
  constraint automation_steps_sort_key_non_negative
    check (sort_key >= 0),
  constraint automation_steps_automation_tenant_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id)
    on delete cascade,
  constraint automation_steps_key_unique unique (automation_id, step_key),
  constraint automation_steps_id_automation_tenant_unique
    unique (id, automation_id, organization_id)
);

create table public.automation_step_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null,
  from_step_id uuid not null,
  outcome text not null,
  to_step_id uuid not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_step_edges_outcome_known
    check (outcome in ('success', 'answered', 'timeout', 'failed', 'true', 'false', 'otherwise')),
  constraint automation_step_edges_order_non_negative
    check ("order" >= 0),
  constraint automation_step_edges_no_self_loop
    check (from_step_id <> to_step_id),
  constraint automation_step_edges_automation_tenant_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id)
    on delete cascade,
  constraint automation_step_edges_from_tenant_fk
    foreign key (from_step_id, automation_id, organization_id)
    references public.automation_steps(id, automation_id, organization_id)
    on delete cascade,
  constraint automation_step_edges_to_tenant_fk
    foreign key (to_step_id, automation_id, organization_id)
    references public.automation_steps(id, automation_id, organization_id)
    on delete cascade,
  constraint automation_step_edges_outcome_unique
    unique (from_step_id, outcome)
);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  channel text not null default 'whatsapp',
  body text not null,
  media_asset_variant_id uuid,
  variables jsonb not null default '[]'::jsonb,
  revision integer not null default 1,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_name_not_blank check (btrim(name) <> ''),
  constraint message_templates_body_not_blank check (btrim(body) <> ''),
  constraint message_templates_channel_v1 check (channel in ('whatsapp')),
  constraint message_templates_variables_array check (jsonb_typeof(variables) = 'array'),
  constraint message_templates_revision_positive check (revision > 0),
  constraint message_templates_id_organization_unique unique (id, organization_id)
);

comment on column public.message_templates.media_asset_variant_id is
  'Referência reservada; a FK entra em F8 com o pipeline de mídia.';

create index idx_automations_organization_id
  on public.automations(organization_id, updated_at desc);
create index idx_automations_published_version_id
  on public.automations(published_version_id)
  where published_version_id is not null;
create index idx_automation_steps_automation_id
  on public.automation_steps(automation_id, sort_key, id);
create index idx_automation_steps_organization_id
  on public.automation_steps(organization_id);
create index idx_automation_step_edges_automation_id
  on public.automation_step_edges(automation_id, from_step_id, "order");
create index idx_automation_step_edges_to_step_id
  on public.automation_step_edges(to_step_id);
create index idx_automation_step_edges_organization_id
  on public.automation_step_edges(organization_id);
create index idx_message_templates_organization_id
  on public.message_templates(organization_id, updated_at desc);
create index idx_message_templates_created_by
  on public.message_templates(created_by)
  where created_by is not null;

alter table public.automations enable row level security;
alter table public.automation_steps enable row level security;
alter table public.automation_step_edges enable row level security;
alter table public.message_templates enable row level security;

create policy "automations_select_by_tenant_operator"
  on public.automations
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create policy "automations_insert_by_tenant_editor"
  on public.automations
  for insert
  to authenticated
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
    and (created_by is null or created_by = (select auth.uid()))
  );

create policy "automations_update_by_tenant_editor"
  on public.automations
  for update
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "automations_delete_by_tenant_editor"
  on public.automations
  for delete
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "automation_steps_select_by_tenant_editor"
  on public.automation_steps
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "automation_steps_mutate_by_tenant_editor"
  on public.automation_steps
  for all
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "automation_step_edges_select_by_tenant_editor"
  on public.automation_step_edges
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "automation_step_edges_mutate_by_tenant_editor"
  on public.automation_step_edges
  for all
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  );

create policy "message_templates_select_by_tenant_operator"
  on public.message_templates
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create policy "message_templates_mutate_by_tenant_editor"
  on public.message_templates
  for all
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('automation.edit')
    and (created_by is null or created_by = (select auth.uid()))
  );

create or replace function public.prevent_authoring_organization_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception using
      errcode = '23514',
      message = 'organization_id é imutável';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_authoring_organization_change() from public;
revoke all on function public.prevent_authoring_organization_change() from anon;
revoke all on function public.prevent_authoring_organization_change() from authenticated;

create trigger prevent_automations_organization_change
  before update on public.automations
  for each row execute function public.prevent_authoring_organization_change();
create trigger prevent_automation_steps_organization_change
  before update on public.automation_steps
  for each row execute function public.prevent_authoring_organization_change();
create trigger prevent_automation_step_edges_organization_change
  before update on public.automation_step_edges
  for each row execute function public.prevent_authoring_organization_change();
create trigger prevent_message_templates_organization_change
  before update on public.message_templates
  for each row execute function public.prevent_authoring_organization_change();

create trigger update_automations_updated_at
  before update on public.automations
  for each row execute function public.update_updated_at_column();
create trigger update_automation_steps_updated_at
  before update on public.automation_steps
  for each row execute function public.update_updated_at_column();
create trigger update_automation_step_edges_updated_at
  before update on public.automation_step_edges
  for each row execute function public.update_updated_at_column();
create trigger update_message_templates_updated_at
  before update on public.message_templates
  for each row execute function public.update_updated_at_column();
