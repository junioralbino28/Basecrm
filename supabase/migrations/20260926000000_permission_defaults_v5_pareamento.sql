-- =============================================================================
-- PAREAMENTO — `whatsapp.manage_connection` sai do cliente, entra `whatsapp.pair_devices`
-- =============================================================================
-- Decisão do Junior (26/09/2026): "as conexões, configuração de IA, webhook, ficam APENAS na
-- agência, os clientes não têm essas telas. Mas isso de OAuth da agenda e conectar whatsapp
-- com QR code pode deixar" com o admin do cliente.
--
-- O admin do cliente perde `whatsapp.manage_connection` (Evolution, IA por número, webhook —
-- a rota de API negava só pela tela; agora nega pelo padrão do cargo) e ganha
-- `whatsapp.pair_devices`: escanear o QR do WhatsApp e conectar/desconectar o Google Agenda
-- do número, sem alcançar a configuração técnica.
--
-- v1, v2, v3 e v4 permanecem imutáveis. A v5 é materializada em paralelo e só vira ativa
-- depois de validar o produto cartesiano completo, no mesmo padrão da C2A e da C2B.

-- PAREAMENTO_ROLE_PERMISSION_DEFAULTS_V5:START
-- Gerado por scripts/generate-e2-role-permission-defaults.mjs.
-- Fonte: ROLE_PERMISSION_DEFAULTS + getDefaultPermissionMap em lib/auth/permissions.ts.
insert into public.role_permission_defaults (defaults_version, role, permission_key, enabled)
values
  (5, 'agency_admin', 'dashboard.view', true),
  (5, 'agency_admin', 'overview.view', true),
  (5, 'agency_admin', 'contacts.view', true),
  (5, 'agency_admin', 'contacts.edit', true),
  (5, 'agency_admin', 'contacts.delete', true),
  (5, 'agency_admin', 'contacts.import_export', true),
  (5, 'agency_admin', 'funnels.view', true),
  (5, 'agency_admin', 'funnels.move', true),
  (5, 'agency_admin', 'funnels.manage', true),
  (5, 'agency_admin', 'deals.manage', true),
  (5, 'agency_admin', 'conversations.access', true),
  (5, 'agency_admin', 'conversations.reply', true),
  (5, 'agency_admin', 'whatsapp.access', true),
  (5, 'agency_admin', 'whatsapp.manage_connection', true),
  (5, 'agency_admin', 'whatsapp.pair_devices', true),
  (5, 'agency_admin', 'activities.view', true),
  (5, 'agency_admin', 'activities.manage', true),
  (5, 'agency_admin', 'tasks.view', true),
  (5, 'agency_admin', 'tasks.manage', true),
  (5, 'agency_admin', 'call_list.access', true),
  (5, 'agency_admin', 'atendimentos.view', true),
  (5, 'agency_admin', 'atendimentos.manage', true),
  (5, 'agency_admin', 'agenda.view', true),
  (5, 'agency_admin', 'agenda.manage', true),
  (5, 'agency_admin', 'reports.view', true),
  (5, 'agency_admin', 'reports.finance', true),
  (5, 'agency_admin', 'reports.professionals', true),
  (5, 'agency_admin', 'ai.use', true),
  (5, 'agency_admin', 'ai.configure', true),
  (5, 'agency_admin', 'ai.pause', true),
  (5, 'agency_admin', 'automation.edit', true),
  (5, 'agency_admin', 'automation.operate', true),
  (5, 'agency_admin', 'tags.assign', true),
  (5, 'agency_admin', 'tags.manage', true),
  (5, 'agency_admin', 'lead_sources.assign', true),
  (5, 'agency_admin', 'lead_sources.manage', true),
  (5, 'agency_admin', 'settings.general', true),
  (5, 'agency_admin', 'settings.products', true),
  (5, 'agency_admin', 'settings.professionals', true),
  (5, 'agency_admin', 'settings.finance', true),
  (5, 'agency_admin', 'settings.integrations', true),
  (5, 'agency_admin', 'settings.audit', true),
  (5, 'agency_admin', 'settings.users.manage', true),
  (5, 'agency_staff', 'dashboard.view', true),
  (5, 'agency_staff', 'overview.view', true),
  (5, 'agency_staff', 'contacts.view', true),
  (5, 'agency_staff', 'contacts.edit', true),
  (5, 'agency_staff', 'contacts.delete', true),
  (5, 'agency_staff', 'contacts.import_export', true),
  (5, 'agency_staff', 'funnels.view', true),
  (5, 'agency_staff', 'funnels.move', true),
  (5, 'agency_staff', 'funnels.manage', true),
  (5, 'agency_staff', 'deals.manage', true),
  (5, 'agency_staff', 'conversations.access', true),
  (5, 'agency_staff', 'conversations.reply', true),
  (5, 'agency_staff', 'whatsapp.access', true),
  (5, 'agency_staff', 'whatsapp.manage_connection', false),
  (5, 'agency_staff', 'whatsapp.pair_devices', true),
  (5, 'agency_staff', 'activities.view', true),
  (5, 'agency_staff', 'activities.manage', true),
  (5, 'agency_staff', 'tasks.view', true),
  (5, 'agency_staff', 'tasks.manage', true),
  (5, 'agency_staff', 'call_list.access', true),
  (5, 'agency_staff', 'atendimentos.view', true),
  (5, 'agency_staff', 'atendimentos.manage', true),
  (5, 'agency_staff', 'agenda.view', true),
  (5, 'agency_staff', 'agenda.manage', true),
  (5, 'agency_staff', 'reports.view', true),
  (5, 'agency_staff', 'reports.finance', true),
  (5, 'agency_staff', 'reports.professionals', true),
  (5, 'agency_staff', 'ai.use', true),
  (5, 'agency_staff', 'ai.configure', true),
  (5, 'agency_staff', 'ai.pause', true),
  (5, 'agency_staff', 'automation.edit', true),
  (5, 'agency_staff', 'automation.operate', true),
  (5, 'agency_staff', 'tags.assign', true),
  (5, 'agency_staff', 'tags.manage', true),
  (5, 'agency_staff', 'lead_sources.assign', true),
  (5, 'agency_staff', 'lead_sources.manage', true),
  (5, 'agency_staff', 'settings.general', true),
  (5, 'agency_staff', 'settings.products', true),
  (5, 'agency_staff', 'settings.professionals', true),
  (5, 'agency_staff', 'settings.finance', false),
  (5, 'agency_staff', 'settings.integrations', true),
  (5, 'agency_staff', 'settings.audit', false),
  (5, 'agency_staff', 'settings.users.manage', false),
  (5, 'clinic_admin', 'dashboard.view', true),
  (5, 'clinic_admin', 'overview.view', true),
  (5, 'clinic_admin', 'contacts.view', true),
  (5, 'clinic_admin', 'contacts.edit', true),
  (5, 'clinic_admin', 'contacts.delete', true),
  (5, 'clinic_admin', 'contacts.import_export', true),
  (5, 'clinic_admin', 'funnels.view', true),
  (5, 'clinic_admin', 'funnels.move', true),
  (5, 'clinic_admin', 'funnels.manage', true),
  (5, 'clinic_admin', 'deals.manage', true),
  (5, 'clinic_admin', 'conversations.access', true),
  (5, 'clinic_admin', 'conversations.reply', true),
  (5, 'clinic_admin', 'whatsapp.access', true),
  (5, 'clinic_admin', 'whatsapp.manage_connection', false),
  (5, 'clinic_admin', 'whatsapp.pair_devices', true),
  (5, 'clinic_admin', 'activities.view', true),
  (5, 'clinic_admin', 'activities.manage', true),
  (5, 'clinic_admin', 'tasks.view', true),
  (5, 'clinic_admin', 'tasks.manage', true),
  (5, 'clinic_admin', 'call_list.access', true),
  (5, 'clinic_admin', 'atendimentos.view', true),
  (5, 'clinic_admin', 'atendimentos.manage', true),
  (5, 'clinic_admin', 'agenda.view', true),
  (5, 'clinic_admin', 'agenda.manage', true),
  (5, 'clinic_admin', 'reports.view', true),
  (5, 'clinic_admin', 'reports.finance', true),
  (5, 'clinic_admin', 'reports.professionals', true),
  (5, 'clinic_admin', 'ai.use', true),
  (5, 'clinic_admin', 'ai.configure', false),
  (5, 'clinic_admin', 'ai.pause', true),
  (5, 'clinic_admin', 'automation.edit', true),
  (5, 'clinic_admin', 'automation.operate', true),
  (5, 'clinic_admin', 'tags.assign', true),
  (5, 'clinic_admin', 'tags.manage', true),
  (5, 'clinic_admin', 'lead_sources.assign', true),
  (5, 'clinic_admin', 'lead_sources.manage', true),
  (5, 'clinic_admin', 'settings.general', true),
  (5, 'clinic_admin', 'settings.products', true),
  (5, 'clinic_admin', 'settings.professionals', true),
  (5, 'clinic_admin', 'settings.finance', true),
  (5, 'clinic_admin', 'settings.integrations', false),
  (5, 'clinic_admin', 'settings.audit', true),
  (5, 'clinic_admin', 'settings.users.manage', true),
  (5, 'clinic_staff', 'dashboard.view', true),
  (5, 'clinic_staff', 'overview.view', true),
  (5, 'clinic_staff', 'contacts.view', true),
  (5, 'clinic_staff', 'contacts.edit', true),
  (5, 'clinic_staff', 'contacts.delete', false),
  (5, 'clinic_staff', 'contacts.import_export', false),
  (5, 'clinic_staff', 'funnels.view', true),
  (5, 'clinic_staff', 'funnels.move', true),
  (5, 'clinic_staff', 'funnels.manage', false),
  (5, 'clinic_staff', 'deals.manage', true),
  (5, 'clinic_staff', 'conversations.access', true),
  (5, 'clinic_staff', 'conversations.reply', true),
  (5, 'clinic_staff', 'whatsapp.access', false),
  (5, 'clinic_staff', 'whatsapp.manage_connection', false),
  (5, 'clinic_staff', 'whatsapp.pair_devices', false),
  (5, 'clinic_staff', 'activities.view', true),
  (5, 'clinic_staff', 'activities.manage', true),
  (5, 'clinic_staff', 'tasks.view', true),
  (5, 'clinic_staff', 'tasks.manage', true),
  (5, 'clinic_staff', 'call_list.access', true),
  (5, 'clinic_staff', 'atendimentos.view', true),
  (5, 'clinic_staff', 'atendimentos.manage', true),
  (5, 'clinic_staff', 'agenda.view', true),
  (5, 'clinic_staff', 'agenda.manage', true),
  (5, 'clinic_staff', 'reports.view', false),
  (5, 'clinic_staff', 'reports.finance', false),
  (5, 'clinic_staff', 'reports.professionals', false),
  (5, 'clinic_staff', 'ai.use', true),
  (5, 'clinic_staff', 'ai.configure', false),
  (5, 'clinic_staff', 'ai.pause', false),
  (5, 'clinic_staff', 'automation.edit', false),
  (5, 'clinic_staff', 'automation.operate', false),
  (5, 'clinic_staff', 'tags.assign', true),
  (5, 'clinic_staff', 'tags.manage', false),
  (5, 'clinic_staff', 'lead_sources.assign', true),
  (5, 'clinic_staff', 'lead_sources.manage', false),
  (5, 'clinic_staff', 'settings.general', false),
  (5, 'clinic_staff', 'settings.products', false),
  (5, 'clinic_staff', 'settings.professionals', false),
  (5, 'clinic_staff', 'settings.finance', false),
  (5, 'clinic_staff', 'settings.integrations', false),
  (5, 'clinic_staff', 'settings.audit', false),
  (5, 'clinic_staff', 'settings.users.manage', false),
  (5, 'admin', 'dashboard.view', true),
  (5, 'admin', 'overview.view', true),
  (5, 'admin', 'contacts.view', true),
  (5, 'admin', 'contacts.edit', true),
  (5, 'admin', 'contacts.delete', true),
  (5, 'admin', 'contacts.import_export', true),
  (5, 'admin', 'funnels.view', true),
  (5, 'admin', 'funnels.move', true),
  (5, 'admin', 'funnels.manage', true),
  (5, 'admin', 'deals.manage', true),
  (5, 'admin', 'conversations.access', true),
  (5, 'admin', 'conversations.reply', true),
  (5, 'admin', 'whatsapp.access', true),
  (5, 'admin', 'whatsapp.manage_connection', true),
  (5, 'admin', 'whatsapp.pair_devices', true),
  (5, 'admin', 'activities.view', true),
  (5, 'admin', 'activities.manage', true),
  (5, 'admin', 'tasks.view', true),
  (5, 'admin', 'tasks.manage', true),
  (5, 'admin', 'call_list.access', true),
  (5, 'admin', 'atendimentos.view', true),
  (5, 'admin', 'atendimentos.manage', true),
  (5, 'admin', 'agenda.view', true),
  (5, 'admin', 'agenda.manage', true),
  (5, 'admin', 'reports.view', true),
  (5, 'admin', 'reports.finance', true),
  (5, 'admin', 'reports.professionals', true),
  (5, 'admin', 'ai.use', true),
  (5, 'admin', 'ai.configure', true),
  (5, 'admin', 'ai.pause', true),
  (5, 'admin', 'automation.edit', true),
  (5, 'admin', 'automation.operate', true),
  (5, 'admin', 'tags.assign', true),
  (5, 'admin', 'tags.manage', true),
  (5, 'admin', 'lead_sources.assign', true),
  (5, 'admin', 'lead_sources.manage', true),
  (5, 'admin', 'settings.general', true),
  (5, 'admin', 'settings.products', true),
  (5, 'admin', 'settings.professionals', true),
  (5, 'admin', 'settings.finance', true),
  (5, 'admin', 'settings.integrations', true),
  (5, 'admin', 'settings.audit', true),
  (5, 'admin', 'settings.users.manage', true),
  (5, 'vendedor', 'dashboard.view', true),
  (5, 'vendedor', 'overview.view', true),
  (5, 'vendedor', 'contacts.view', true),
  (5, 'vendedor', 'contacts.edit', true),
  (5, 'vendedor', 'contacts.delete', false),
  (5, 'vendedor', 'contacts.import_export', false),
  (5, 'vendedor', 'funnels.view', true),
  (5, 'vendedor', 'funnels.move', true),
  (5, 'vendedor', 'funnels.manage', false),
  (5, 'vendedor', 'deals.manage', true),
  (5, 'vendedor', 'conversations.access', true),
  (5, 'vendedor', 'conversations.reply', true),
  (5, 'vendedor', 'whatsapp.access', false),
  (5, 'vendedor', 'whatsapp.manage_connection', false),
  (5, 'vendedor', 'whatsapp.pair_devices', false),
  (5, 'vendedor', 'activities.view', true),
  (5, 'vendedor', 'activities.manage', true),
  (5, 'vendedor', 'tasks.view', true),
  (5, 'vendedor', 'tasks.manage', true),
  (5, 'vendedor', 'call_list.access', true),
  (5, 'vendedor', 'atendimentos.view', true),
  (5, 'vendedor', 'atendimentos.manage', true),
  (5, 'vendedor', 'agenda.view', true),
  (5, 'vendedor', 'agenda.manage', true),
  (5, 'vendedor', 'reports.view', false),
  (5, 'vendedor', 'reports.finance', false),
  (5, 'vendedor', 'reports.professionals', false),
  (5, 'vendedor', 'ai.use', true),
  (5, 'vendedor', 'ai.configure', false),
  (5, 'vendedor', 'ai.pause', false),
  (5, 'vendedor', 'automation.edit', false),
  (5, 'vendedor', 'automation.operate', false),
  (5, 'vendedor', 'tags.assign', true),
  (5, 'vendedor', 'tags.manage', false),
  (5, 'vendedor', 'lead_sources.assign', true),
  (5, 'vendedor', 'lead_sources.manage', false),
  (5, 'vendedor', 'settings.general', false),
  (5, 'vendedor', 'settings.products', false),
  (5, 'vendedor', 'settings.professionals', false),
  (5, 'vendedor', 'settings.finance', false),
  (5, 'vendedor', 'settings.integrations', false),
  (5, 'vendedor', 'settings.audit', false),
  (5, 'vendedor', 'settings.users.manage', false)
on conflict (defaults_version, role, permission_key) do update
set enabled = excluded.enabled;
-- PAREAMENTO_ROLE_PERMISSION_DEFAULTS_V5:END

do $$
declare
  v_v1_rows integer;
  v_v2_rows integer;
  v_v3_rows integer;
  v_v4_rows integer;
  v_v5_rows integer;
  v_v1_permissions integer;
  v_v2_permissions integer;
  v_v3_permissions integer;
  v_v4_permissions integer;
  v_v5_permissions integer;
  v_active_version integer;
begin
  select active_version
  into v_active_version
  from public.permission_defaults_state
  where singleton
  for update;

  if not found or v_active_version <> 4 then
    raise exception 'snapshot ativo inesperado antes do pareamento: %', v_active_version;
  end if;

  update public.permission_defaults_state
  set active_version = 5,
      updated_at = now()
  where singleton;

  select
    count(*) filter (where defaults_version = 1),
    count(*) filter (where defaults_version = 2),
    count(*) filter (where defaults_version = 3),
    count(*) filter (where defaults_version = 4),
    count(*) filter (where defaults_version = 5),
    count(distinct permission_key) filter (where defaults_version = 1),
    count(distinct permission_key) filter (where defaults_version = 2),
    count(distinct permission_key) filter (where defaults_version = 3),
    count(distinct permission_key) filter (where defaults_version = 4),
    count(distinct permission_key) filter (where defaults_version = 5)
  into
    v_v1_rows,
    v_v2_rows,
    v_v3_rows,
    v_v4_rows,
    v_v5_rows,
    v_v1_permissions,
    v_v2_permissions,
    v_v3_permissions,
    v_v4_permissions,
    v_v5_permissions
  from public.role_permission_defaults;

  select active_version
  into v_active_version
  from public.permission_defaults_state
  where singleton;

  if v_v1_rows <> 222
    or v_v2_rows <> 222
    or v_v3_rows <> 246
    or v_v4_rows <> 252
    or v_v5_rows <> 258
    or v_v1_permissions <> 37
    or v_v2_permissions <> 37
    or v_v3_permissions <> 41
    or v_v4_permissions <> 42
    or v_v5_permissions <> 43
    or v_active_version <> 5
  then
    raise exception
      'snapshots inválidos: v1=%/%, v2=%/%, v3=%/%, v4=%/%, v5=%/%, ativo=%',
      v_v1_rows,
      v_v1_permissions,
      v_v2_rows,
      v_v2_permissions,
      v_v3_rows,
      v_v3_permissions,
      v_v4_rows,
      v_v4_permissions,
      v_v5_rows,
      v_v5_permissions,
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
  ) or exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 5
    group by role
    having count(*) <> 43
  ) then
    raise exception 'snapshot de permissões incompleto por cargo';
  end if;

  -- Prova da decisão dentro da própria migration: a v4 congelada guarda o mundo antigo
  -- (clinic_admin configurava a conexão; pareamento nem existia) e a v5 carrega o novo.
  if not exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 4
      and role = 'clinic_admin'
      and permission_key = 'whatsapp.manage_connection'
      and enabled
  ) then
    raise exception 'clinic_admin deveria continuar com whatsapp.manage_connection na v4';
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 5
      and role = 'clinic_admin'
      and permission_key = 'whatsapp.manage_connection'
      and enabled
  ) then
    raise exception 'clinic_admin ficou com whatsapp.manage_connection na v5';
  end if;

  if not exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 5
      and role = 'clinic_admin'
      and permission_key = 'whatsapp.pair_devices'
      and enabled
  ) then
    raise exception 'clinic_admin ficou sem whatsapp.pair_devices na v5';
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 5
      and role = 'clinic_staff'
      and permission_key = 'whatsapp.pair_devices'
      and enabled
  ) then
    raise exception 'clinic_staff nao deveria parear na v5';
  end if;

  -- 27/09/2026 ("1 tambem"): a aba Integrações inteira — API, MCP e webhooks — é da agência.
  -- A v4 congelada guarda o mundo antigo (clinic_admin via a aba); a v5 nega.
  if not exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 4
      and role = 'clinic_admin'
      and permission_key = 'settings.integrations'
      and enabled
  ) then
    raise exception 'clinic_admin deveria continuar com settings.integrations na v4';
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    where defaults_version = 5
      and role = 'clinic_admin'
      and permission_key = 'settings.integrations'
      and enabled
  ) then
    raise exception 'clinic_admin ficou com settings.integrations na v5';
  end if;
end;
$$;
