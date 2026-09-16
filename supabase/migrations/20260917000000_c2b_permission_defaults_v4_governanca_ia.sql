-- =============================================================================
-- C2B — governança do motor de IA: `ai.configure` sai do cliente, entra `ai.pause`
-- =============================================================================
-- Decisão do Junior (17/09/2026): provedor, chave de API, modelo e prompt da IA são da
-- AGÊNCIA. A chave é dela e o custo corre por ela; o prompt é o comportamento que ela vende
-- e pelo qual responde. O admin do cliente perde `ai.configure` e ganha `ai.pause` — pausar
-- ou retomar o atendimento automático sem alterar a configuração.
--
-- v1, v2 e v3 permanecem imutáveis. A v4 é materializada em paralelo e só vira ativa depois
-- de validar o produto cartesiano completo, no mesmo padrão da C2A.
--
-- Efeito medido antes de escrever: produção tem 0 linhas em `profile_permissions`, então
-- nenhuma exceção por usuário sobrevive a esta troca — o padrão por cargo é o que vale.

-- C2B_ROLE_PERMISSION_DEFAULTS_V4:START
-- Gerado por scripts/generate-e2-role-permission-defaults.mjs.
-- Fonte: ROLE_PERMISSION_DEFAULTS + getDefaultPermissionMap em lib/auth/permissions.ts.
insert into public.role_permission_defaults (defaults_version, role, permission_key, enabled)
values
  (4, 'agency_admin', 'dashboard.view', true),
  (4, 'agency_admin', 'overview.view', true),
  (4, 'agency_admin', 'contacts.view', true),
  (4, 'agency_admin', 'contacts.edit', true),
  (4, 'agency_admin', 'contacts.delete', true),
  (4, 'agency_admin', 'contacts.import_export', true),
  (4, 'agency_admin', 'funnels.view', true),
  (4, 'agency_admin', 'funnels.move', true),
  (4, 'agency_admin', 'funnels.manage', true),
  (4, 'agency_admin', 'deals.manage', true),
  (4, 'agency_admin', 'conversations.access', true),
  (4, 'agency_admin', 'conversations.reply', true),
  (4, 'agency_admin', 'whatsapp.access', true),
  (4, 'agency_admin', 'whatsapp.manage_connection', true),
  (4, 'agency_admin', 'activities.view', true),
  (4, 'agency_admin', 'activities.manage', true),
  (4, 'agency_admin', 'tasks.view', true),
  (4, 'agency_admin', 'tasks.manage', true),
  (4, 'agency_admin', 'call_list.access', true),
  (4, 'agency_admin', 'atendimentos.view', true),
  (4, 'agency_admin', 'atendimentos.manage', true),
  (4, 'agency_admin', 'agenda.view', true),
  (4, 'agency_admin', 'agenda.manage', true),
  (4, 'agency_admin', 'reports.view', true),
  (4, 'agency_admin', 'reports.finance', true),
  (4, 'agency_admin', 'reports.professionals', true),
  (4, 'agency_admin', 'ai.use', true),
  (4, 'agency_admin', 'ai.configure', true),
  (4, 'agency_admin', 'ai.pause', true),
  (4, 'agency_admin', 'automation.edit', true),
  (4, 'agency_admin', 'automation.operate', true),
  (4, 'agency_admin', 'tags.assign', true),
  (4, 'agency_admin', 'tags.manage', true),
  (4, 'agency_admin', 'lead_sources.assign', true),
  (4, 'agency_admin', 'lead_sources.manage', true),
  (4, 'agency_admin', 'settings.general', true),
  (4, 'agency_admin', 'settings.products', true),
  (4, 'agency_admin', 'settings.professionals', true),
  (4, 'agency_admin', 'settings.finance', true),
  (4, 'agency_admin', 'settings.integrations', true),
  (4, 'agency_admin', 'settings.audit', true),
  (4, 'agency_admin', 'settings.users.manage', true),
  (4, 'agency_staff', 'dashboard.view', true),
  (4, 'agency_staff', 'overview.view', true),
  (4, 'agency_staff', 'contacts.view', true),
  (4, 'agency_staff', 'contacts.edit', true),
  (4, 'agency_staff', 'contacts.delete', true),
  (4, 'agency_staff', 'contacts.import_export', true),
  (4, 'agency_staff', 'funnels.view', true),
  (4, 'agency_staff', 'funnels.move', true),
  (4, 'agency_staff', 'funnels.manage', true),
  (4, 'agency_staff', 'deals.manage', true),
  (4, 'agency_staff', 'conversations.access', true),
  (4, 'agency_staff', 'conversations.reply', true),
  (4, 'agency_staff', 'whatsapp.access', true),
  (4, 'agency_staff', 'whatsapp.manage_connection', false),
  (4, 'agency_staff', 'activities.view', true),
  (4, 'agency_staff', 'activities.manage', true),
  (4, 'agency_staff', 'tasks.view', true),
  (4, 'agency_staff', 'tasks.manage', true),
  (4, 'agency_staff', 'call_list.access', true),
  (4, 'agency_staff', 'atendimentos.view', true),
  (4, 'agency_staff', 'atendimentos.manage', true),
  (4, 'agency_staff', 'agenda.view', true),
  (4, 'agency_staff', 'agenda.manage', true),
  (4, 'agency_staff', 'reports.view', true),
  (4, 'agency_staff', 'reports.finance', true),
  (4, 'agency_staff', 'reports.professionals', true),
  (4, 'agency_staff', 'ai.use', true),
  (4, 'agency_staff', 'ai.configure', true),
  (4, 'agency_staff', 'ai.pause', true),
  (4, 'agency_staff', 'automation.edit', true),
  (4, 'agency_staff', 'automation.operate', true),
  (4, 'agency_staff', 'tags.assign', true),
  (4, 'agency_staff', 'tags.manage', true),
  (4, 'agency_staff', 'lead_sources.assign', true),
  (4, 'agency_staff', 'lead_sources.manage', true),
  (4, 'agency_staff', 'settings.general', true),
  (4, 'agency_staff', 'settings.products', true),
  (4, 'agency_staff', 'settings.professionals', true),
  (4, 'agency_staff', 'settings.finance', false),
  (4, 'agency_staff', 'settings.integrations', true),
  (4, 'agency_staff', 'settings.audit', false),
  (4, 'agency_staff', 'settings.users.manage', false),
  (4, 'clinic_admin', 'dashboard.view', true),
  (4, 'clinic_admin', 'overview.view', true),
  (4, 'clinic_admin', 'contacts.view', true),
  (4, 'clinic_admin', 'contacts.edit', true),
  (4, 'clinic_admin', 'contacts.delete', true),
  (4, 'clinic_admin', 'contacts.import_export', true),
  (4, 'clinic_admin', 'funnels.view', true),
  (4, 'clinic_admin', 'funnels.move', true),
  (4, 'clinic_admin', 'funnels.manage', true),
  (4, 'clinic_admin', 'deals.manage', true),
  (4, 'clinic_admin', 'conversations.access', true),
  (4, 'clinic_admin', 'conversations.reply', true),
  (4, 'clinic_admin', 'whatsapp.access', true),
  (4, 'clinic_admin', 'whatsapp.manage_connection', true),
  (4, 'clinic_admin', 'activities.view', true),
  (4, 'clinic_admin', 'activities.manage', true),
  (4, 'clinic_admin', 'tasks.view', true),
  (4, 'clinic_admin', 'tasks.manage', true),
  (4, 'clinic_admin', 'call_list.access', true),
  (4, 'clinic_admin', 'atendimentos.view', true),
  (4, 'clinic_admin', 'atendimentos.manage', true),
  (4, 'clinic_admin', 'agenda.view', true),
  (4, 'clinic_admin', 'agenda.manage', true),
  (4, 'clinic_admin', 'reports.view', true),
  (4, 'clinic_admin', 'reports.finance', true),
  (4, 'clinic_admin', 'reports.professionals', true),
  (4, 'clinic_admin', 'ai.use', true),
  (4, 'clinic_admin', 'ai.configure', false),
  (4, 'clinic_admin', 'ai.pause', true),
  (4, 'clinic_admin', 'automation.edit', true),
  (4, 'clinic_admin', 'automation.operate', true),
  (4, 'clinic_admin', 'tags.assign', true),
  (4, 'clinic_admin', 'tags.manage', true),
  (4, 'clinic_admin', 'lead_sources.assign', true),
  (4, 'clinic_admin', 'lead_sources.manage', true),
  (4, 'clinic_admin', 'settings.general', true),
  (4, 'clinic_admin', 'settings.products', true),
  (4, 'clinic_admin', 'settings.professionals', true),
  (4, 'clinic_admin', 'settings.finance', true),
  (4, 'clinic_admin', 'settings.integrations', true),
  (4, 'clinic_admin', 'settings.audit', true),
  (4, 'clinic_admin', 'settings.users.manage', true),
  (4, 'clinic_staff', 'dashboard.view', true),
  (4, 'clinic_staff', 'overview.view', true),
  (4, 'clinic_staff', 'contacts.view', true),
  (4, 'clinic_staff', 'contacts.edit', true),
  (4, 'clinic_staff', 'contacts.delete', false),
  (4, 'clinic_staff', 'contacts.import_export', false),
  (4, 'clinic_staff', 'funnels.view', true),
  (4, 'clinic_staff', 'funnels.move', true),
  (4, 'clinic_staff', 'funnels.manage', false),
  (4, 'clinic_staff', 'deals.manage', true),
  (4, 'clinic_staff', 'conversations.access', true),
  (4, 'clinic_staff', 'conversations.reply', true),
  (4, 'clinic_staff', 'whatsapp.access', false),
  (4, 'clinic_staff', 'whatsapp.manage_connection', false),
  (4, 'clinic_staff', 'activities.view', true),
  (4, 'clinic_staff', 'activities.manage', true),
  (4, 'clinic_staff', 'tasks.view', true),
  (4, 'clinic_staff', 'tasks.manage', true),
  (4, 'clinic_staff', 'call_list.access', true),
  (4, 'clinic_staff', 'atendimentos.view', true),
  (4, 'clinic_staff', 'atendimentos.manage', true),
  (4, 'clinic_staff', 'agenda.view', true),
  (4, 'clinic_staff', 'agenda.manage', true),
  (4, 'clinic_staff', 'reports.view', false),
  (4, 'clinic_staff', 'reports.finance', false),
  (4, 'clinic_staff', 'reports.professionals', false),
  (4, 'clinic_staff', 'ai.use', true),
  (4, 'clinic_staff', 'ai.configure', false),
  (4, 'clinic_staff', 'ai.pause', false),
  (4, 'clinic_staff', 'automation.edit', false),
  (4, 'clinic_staff', 'automation.operate', false),
  (4, 'clinic_staff', 'tags.assign', true),
  (4, 'clinic_staff', 'tags.manage', false),
  (4, 'clinic_staff', 'lead_sources.assign', true),
  (4, 'clinic_staff', 'lead_sources.manage', false),
  (4, 'clinic_staff', 'settings.general', false),
  (4, 'clinic_staff', 'settings.products', false),
  (4, 'clinic_staff', 'settings.professionals', false),
  (4, 'clinic_staff', 'settings.finance', false),
  (4, 'clinic_staff', 'settings.integrations', false),
  (4, 'clinic_staff', 'settings.audit', false),
  (4, 'clinic_staff', 'settings.users.manage', false),
  (4, 'admin', 'dashboard.view', true),
  (4, 'admin', 'overview.view', true),
  (4, 'admin', 'contacts.view', true),
  (4, 'admin', 'contacts.edit', true),
  (4, 'admin', 'contacts.delete', true),
  (4, 'admin', 'contacts.import_export', true),
  (4, 'admin', 'funnels.view', true),
  (4, 'admin', 'funnels.move', true),
  (4, 'admin', 'funnels.manage', true),
  (4, 'admin', 'deals.manage', true),
  (4, 'admin', 'conversations.access', true),
  (4, 'admin', 'conversations.reply', true),
  (4, 'admin', 'whatsapp.access', true),
  (4, 'admin', 'whatsapp.manage_connection', true),
  (4, 'admin', 'activities.view', true),
  (4, 'admin', 'activities.manage', true),
  (4, 'admin', 'tasks.view', true),
  (4, 'admin', 'tasks.manage', true),
  (4, 'admin', 'call_list.access', true),
  (4, 'admin', 'atendimentos.view', true),
  (4, 'admin', 'atendimentos.manage', true),
  (4, 'admin', 'agenda.view', true),
  (4, 'admin', 'agenda.manage', true),
  (4, 'admin', 'reports.view', true),
  (4, 'admin', 'reports.finance', true),
  (4, 'admin', 'reports.professionals', true),
  (4, 'admin', 'ai.use', true),
  (4, 'admin', 'ai.configure', true),
  (4, 'admin', 'ai.pause', true),
  (4, 'admin', 'automation.edit', true),
  (4, 'admin', 'automation.operate', true),
  (4, 'admin', 'tags.assign', true),
  (4, 'admin', 'tags.manage', true),
  (4, 'admin', 'lead_sources.assign', true),
  (4, 'admin', 'lead_sources.manage', true),
  (4, 'admin', 'settings.general', true),
  (4, 'admin', 'settings.products', true),
  (4, 'admin', 'settings.professionals', true),
  (4, 'admin', 'settings.finance', true),
  (4, 'admin', 'settings.integrations', true),
  (4, 'admin', 'settings.audit', true),
  (4, 'admin', 'settings.users.manage', true),
  (4, 'vendedor', 'dashboard.view', true),
  (4, 'vendedor', 'overview.view', true),
  (4, 'vendedor', 'contacts.view', true),
  (4, 'vendedor', 'contacts.edit', true),
  (4, 'vendedor', 'contacts.delete', false),
  (4, 'vendedor', 'contacts.import_export', false),
  (4, 'vendedor', 'funnels.view', true),
  (4, 'vendedor', 'funnels.move', true),
  (4, 'vendedor', 'funnels.manage', false),
  (4, 'vendedor', 'deals.manage', true),
  (4, 'vendedor', 'conversations.access', true),
  (4, 'vendedor', 'conversations.reply', true),
  (4, 'vendedor', 'whatsapp.access', false),
  (4, 'vendedor', 'whatsapp.manage_connection', false),
  (4, 'vendedor', 'activities.view', true),
  (4, 'vendedor', 'activities.manage', true),
  (4, 'vendedor', 'tasks.view', true),
  (4, 'vendedor', 'tasks.manage', true),
  (4, 'vendedor', 'call_list.access', true),
  (4, 'vendedor', 'atendimentos.view', true),
  (4, 'vendedor', 'atendimentos.manage', true),
  (4, 'vendedor', 'agenda.view', true),
  (4, 'vendedor', 'agenda.manage', true),
  (4, 'vendedor', 'reports.view', false),
  (4, 'vendedor', 'reports.finance', false),
  (4, 'vendedor', 'reports.professionals', false),
  (4, 'vendedor', 'ai.use', true),
  (4, 'vendedor', 'ai.configure', false),
  (4, 'vendedor', 'ai.pause', false),
  (4, 'vendedor', 'automation.edit', false),
  (4, 'vendedor', 'automation.operate', false),
  (4, 'vendedor', 'tags.assign', true),
  (4, 'vendedor', 'tags.manage', false),
  (4, 'vendedor', 'lead_sources.assign', true),
  (4, 'vendedor', 'lead_sources.manage', false),
  (4, 'vendedor', 'settings.general', false),
  (4, 'vendedor', 'settings.products', false),
  (4, 'vendedor', 'settings.professionals', false),
  (4, 'vendedor', 'settings.finance', false),
  (4, 'vendedor', 'settings.integrations', false),
  (4, 'vendedor', 'settings.audit', false),
  (4, 'vendedor', 'settings.users.manage', false)
on conflict (defaults_version, role, permission_key) do update
set enabled = excluded.enabled;
-- C2B_ROLE_PERMISSION_DEFAULTS_V4:END

do $$
declare
  v_v1_rows integer;
  v_v2_rows integer;
  v_v3_rows integer;
  v_v4_rows integer;
  v_v1_permissions integer;
  v_v2_permissions integer;
  v_v3_permissions integer;
  v_v4_permissions integer;
  v_active_version integer;
begin
  select active_version
  into v_active_version
  from public.permission_defaults_state
  where singleton
  for update;

  if not found or v_active_version <> 3 then
    raise exception 'snapshot ativo inesperado antes da C2B: %', v_active_version;
  end if;

  update public.permission_defaults_state
  set active_version = 4,
      updated_at = now()
  where singleton;

  select
    count(*) filter (where defaults_version = 1),
    count(*) filter (where defaults_version = 2),
    count(*) filter (where defaults_version = 3),
    count(*) filter (where defaults_version = 4),
    count(distinct permission_key) filter (where defaults_version = 1),
    count(distinct permission_key) filter (where defaults_version = 2),
    count(distinct permission_key) filter (where defaults_version = 3),
    count(distinct permission_key) filter (where defaults_version = 4)
  into
    v_v1_rows,
    v_v2_rows,
    v_v3_rows,
    v_v4_rows,
    v_v1_permissions,
    v_v2_permissions,
    v_v3_permissions,
    v_v4_permissions
  from public.role_permission_defaults;

  select active_version
  into v_active_version
  from public.permission_defaults_state
  where singleton;

  if v_v1_rows <> 222
    or v_v2_rows <> 222
    or v_v3_rows <> 246
    or v_v4_rows <> 252
    or v_v1_permissions <> 37
    or v_v2_permissions <> 37
    or v_v3_permissions <> 41
    or v_v4_permissions <> 42
    or v_active_version <> 4
  then
    raise exception
      'snapshots inválidos: v1=%/%, v2=%/%, v3=%/%, v4=%/%, ativo=%',
      v_v1_rows,
      v_v1_permissions,
      v_v2_rows,
      v_v2_permissions,
      v_v3_rows,
      v_v3_permissions,
      v_v4_rows,
      v_v4_permissions,
      v_active_version;
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version in (1, 2)
    group by defaults_version, role
    having count(*) <> 37
  ) or exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 3
    group by role
    having count(*) <> 41
  ) or exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 4
    group by role
    having count(*) <> 42
  ) then
    raise exception 'snapshot de permissões incompleto por cargo';
  end if;

  -- A prova que interessa: na v4 ativa, o admin do cliente NÃO configura e PODE pausar.
  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 4
      and role = 'clinic_admin'
      and permission_key = 'ai.configure'
      and enabled
  ) then
    raise exception 'clinic_admin continua com ai.configure na v4';
  end if;

  if not exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 4
      and role = 'clinic_admin'
      and permission_key = 'ai.pause'
      and enabled
  ) then
    raise exception 'clinic_admin ficou sem ai.pause na v4';
  end if;
end;
$$;
