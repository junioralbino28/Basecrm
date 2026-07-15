-- =============================================================================
-- E2 S1 — enforcement de permissões no banco
-- =============================================================================
-- Escopo: defaults v1 + has_permission + Atendimentos + 3 RPCs de relatório.
-- Fora deste S1 (E2.2): policies das quatro tabelas de configuração financeira.
--
-- Rollback controlado (não executar sem o mesmo duplo portão):
--   1. restaurar as policies de 20260614000000_atendimentos.sql;
--   2. restaurar os três RPCs efetivos de 20260621000000/20260624000000;
--   3. revogar/remover has_permission e role_permission_defaults.
-- A migration é transacional no fluxo Supabase; snapshot, helper e consumidores
-- são instalados juntos para não existir janela fail-open.
-- =============================================================================

-- Snapshot corrente, de versão única. A troca por snapshots paralelos +
-- ponteiro ativo fica deliberadamente para a primeira mudança de defaults.
create table if not exists public.role_permission_defaults (
  defaults_version integer not null,
  role text not null,
  permission_key text not null,
  enabled boolean not null,
  primary key (role, permission_key),
  constraint role_permission_defaults_version_positive
    check (defaults_version > 0),
  constraint role_permission_defaults_known_role
    check (role in (
      'agency_admin',
      'agency_staff',
      'clinic_admin',
      'clinic_staff',
      'admin',
      'vendedor'
    ))
);

comment on table public.role_permission_defaults is
  'Snapshot gerado dos defaults de lib/auth/permissions.ts; v1 usa uma única versão corrente.';

alter table public.role_permission_defaults enable row level security;

-- Nenhuma policy: clientes não leem nem alteram a matriz diretamente.
revoke all on table public.role_permission_defaults from public;
revoke all on table public.role_permission_defaults from anon;
revoke all on table public.role_permission_defaults from authenticated;
grant select on table public.role_permission_defaults to service_role;

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

-- Trava de completude do snapshot implantado: 6 cargos × 35 chaves, todos v1.
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

  if v_rows <> 210
    or v_roles <> 6
    or v_permissions <> 35
    or v_wrong_version <> 0
  then
    raise exception 'snapshot E2 v1 incompleto: rows=%, roles=%, permissions=%, wrong_version=%',
      v_rows, v_roles, v_permissions, v_wrong_version;
  end if;

  if exists (
    select 1
    from public.role_permission_defaults
    group by role
    having count(*) <> 35
  ) then
    raise exception 'snapshot E2 v1 não contém 35 permissões por cargo';
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

  -- O default válido é pré-condição: override não pode criar chave órfã.
  select d.enabled
  into v_default
  from public.role_permission_defaults d
  where d.defaults_version = 1
    and d.role = public.normalize_profile_role(v_profile_role)
    and d.permission_key = has_permission.permission_key;

  if not found then
    return false;
  end if;

  select pp.enabled, pp.organization_id
  into v_override, v_override_organization_id
  from public.profile_permissions pp
  where pp.user_id = v_user_id
    and pp.permission_key = has_permission.permission_key;

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

-- =============================================================================
-- Atendimentos: policies por comando evitam o OR permissivo do antigo FOR ALL.
-- =============================================================================
drop policy if exists "atendimentos_select_by_tenant" on public.atendimentos;
drop policy if exists "atendimentos_mutate_by_tenant_operator" on public.atendimentos;
drop policy if exists "atendimentos_select_by_tenant_permission" on public.atendimentos;
drop policy if exists "atendimentos_insert_by_tenant_permission" on public.atendimentos;
drop policy if exists "atendimentos_update_by_tenant_permission" on public.atendimentos;
drop policy if exists "atendimentos_delete_by_tenant_permission" on public.atendimentos;

create policy "atendimentos_select_by_tenant_permission"
  on public.atendimentos
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('atendimentos.view')
  );

create policy "atendimentos_insert_by_tenant_permission"
  on public.atendimentos
  for insert
  to authenticated
  with check (
    public.can_operate_organization(organization_id)
    and public.has_permission('atendimentos.manage')
  );

create policy "atendimentos_update_by_tenant_permission"
  on public.atendimentos
  for update
  to authenticated
  using (
    public.can_operate_organization(organization_id)
    and public.has_permission('atendimentos.manage')
  )
  with check (
    public.can_operate_organization(organization_id)
    and public.has_permission('atendimentos.manage')
  );

create policy "atendimentos_delete_by_tenant_permission"
  on public.atendimentos
  for delete
  to authenticated
  using (
    public.can_operate_organization(organization_id)
    and public.has_permission('atendimentos.manage')
  );

-- =============================================================================
-- RPCs financeiros: SECURITY DEFINER exige tenant AND permissão explícitos.
-- =============================================================================

-- Os corpos abaixo partem das versões efetivas de junho. Receita vem de
-- 20260621000000; comissão e líquido preservam os fixes de 20260624000000.

-- 1. Faturamento bruto/líquido recebido, por mês e semana.
create or replace function public.get_revenue_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null
    or not public.can_access_organization(v_org)
    or not public.has_permission('reports.finance') then
    raise exception using
      errcode = '42501',
      message = 'acesso negado';
  end if;

  select json_build_object(
    'faturamento', coalesce(sum(a.valor - a.desconto), 0),
    'total_atendimentos', count(*),
    'por_mes', coalesce((
      select json_agg(m order by m->>'mes')
      from (
        select json_build_object(
          'mes', to_char(date_trunc('month', a2.paid_at at time zone 'America/Sao_Paulo'), 'YYYY-MM'),
          'faturamento', coalesce(sum(a2.valor - a2.desconto), 0)
        ) as m
        from public.atendimentos a2
        where a2.organization_id = v_org
          and a2.recebido = true
          and a2.paid_at >= p_start
          and a2.paid_at <= p_end
        group by date_trunc('month', a2.paid_at at time zone 'America/Sao_Paulo')
      ) sub
    ), '[]'::json),
    'por_semana', coalesce((
      select json_agg(s order by s->>'semana')
      from (
        select json_build_object(
          'semana', to_char(date_trunc('week', a3.paid_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD'),
          'faturamento', coalesce(sum(a3.valor - a3.desconto), 0),
          'atendimentos', count(*)
        ) as s
        from public.atendimentos a3
        where a3.organization_id = v_org
          and a3.recebido = true
          and a3.paid_at >= p_start
          and a3.paid_at <= p_end
        group by date_trunc('week', a3.paid_at at time zone 'America/Sao_Paulo')
      ) sub2
    ), '[]'::json)
  )
  into result
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  return result;
end;
$$;

revoke all on function public.get_revenue_report(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_revenue_report(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_revenue_report(timestamptz, timestamptz, uuid) to authenticated;

-- 2. Comissão por profissional, incluindo sem_profissional e regras corrigidas.
create or replace function public.get_commission_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_period_start text;
  v_period_end text;
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null
    or not public.can_access_organization(v_org)
    or not public.has_permission('reports.professionals') then
    raise exception using
      errcode = '42501',
      message = 'acesso negado';
  end if;

  -- períodos YYYY-MM cobertos pelo range, no fuso da clínica (comparação
  -- lexicográfica funciona no formato YYYY-MM)
  v_period_start := to_char(p_start at time zone 'America/Sao_Paulo', 'YYYY-MM');
  v_period_end := to_char(p_end at time zone 'America/Sao_Paulo', 'YYYY-MM');

  select json_build_object(
    'total_comissao', coalesce(sum(linha.comissao), 0),
    'por_profissional', coalesce(
      json_agg(
        json_build_object(
          'professional_id', linha.professional_id,
          'professional_name', linha.professional_name,
          'atendimentos', linha.atendimentos,
          'comissao', linha.comissao,
          'faturamento_base', linha.faturamento_base,
          'pago', linha.pago
        )
        order by linha.comissao desc
      ),
      '[]'::json
    ),
    -- MEDIUM-8: atendimentos recebidos SEM dentista no range (não entram na
    -- tabela por-profissional acima — INNER join). Reconcilia "Receita" da
    -- tabela com "Recebido bruto" do Financeiro.
    'sem_profissional', (
      select json_build_object(
        'atendimentos', count(*),
        'faturamento', coalesce(sum(sp.valor - sp.desconto), 0)
      )
      from public.atendimentos sp
      where sp.organization_id = v_org
        and sp.professional_id is null
        and sp.recebido = true
        and sp.paid_at >= p_start
        and sp.paid_at <= p_end
    )
  )
  into result
  from (
    select
      p.id as professional_id,
      p.name as professional_name,
      count(a.id) as atendimentos,
      coalesce(sum((a.valor - a.desconto) * regra.percent / 100), 0) as comissao,
      coalesce(sum(a.valor - a.desconto), 0) as faturamento_base,
      coalesce((
        select sum(cp.amount)
        from public.commission_payments cp
        where cp.organization_id = v_org
          and cp.professional_id = p.id
          and cp.period >= v_period_start
          and cp.period <= v_period_end
      ), 0) as pago
    from public.atendimentos a
    join public.professionals p
      on p.id = a.professional_id
     and p.organization_id = v_org
    left join lateral (
      select c.percent
      from public.commission_rules c
      where c.organization_id = v_org
        -- regra casa se: específica do profissional (e, se ela tem especialidade,
        -- a especialidade do DENTISTA bate) OU coringa por especialidade do
        -- dentista (sem professional_id). NÃO existe especialidade por
        -- atendimento no schema (atendimentos.specialty não existe;
        -- professionals.specialty é a única) — "especialidade da regra casa com
        -- a especialidade do dentista" até isso mudar.
        and (
          (c.professional_id = a.professional_id
            and (c.specialty is null or c.specialty = p.specialty))
          or (c.professional_id is null and c.specialty = p.specialty)
        )
      -- HIGH-3: desempate por especificidade — regra do profissional vence a
      -- coringa por especialidade; dentro de cada nível, a que casa a
      -- especialidade (specialty NOT NULL) vence a genérica; empate → mais recente.
      order by
        (c.professional_id is not null) desc,
        (c.specialty is not null and c.specialty = p.specialty) desc,
        c.created_at desc
      limit 1
    ) regra on true
    where a.organization_id = v_org
      and a.recebido = true
      and a.paid_at >= p_start
      and a.paid_at <= p_end
    group by p.id, p.name
  ) linha;

  return result;
end;
$$;

revoke all on function public.get_commission_report(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_commission_report(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_commission_report(timestamptz, timestamptz, uuid) to authenticated;

-- 3. Resultado líquido com taxa normalizada e contas fixas pró-rateadas.
create or replace function public.get_net_result(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_faturamento numeric;
  v_comissoes numeric;
  v_taxas numeric;
  v_contas_mensal numeric;
  v_contas numeric;
  v_meses integer;
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null
    or not public.can_access_organization(v_org)
    or not public.has_permission('reports.finance') then
    raise exception using
      errcode = '42501',
      message = 'acesso negado';
  end if;

  -- Faturamento: atendimentos recebidos no range (valor − desconto)
  select coalesce(sum(a.valor - a.desconto), 0)
  into v_faturamento
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Comissões: regra ÚNICA por atendimento. Mesma lógica do get_commission_report:
  -- regra específica do profissional, especialidade do DENTISTA desempata (HIGH-3).
  select coalesce(sum((a.valor - a.desconto) * regra.percent / 100), 0)
  into v_comissoes
  from public.atendimentos a
  join public.professionals p
    on p.id = a.professional_id
   and p.organization_id = v_org
  left join lateral (
    select c.percent
    from public.commission_rules c
    where c.organization_id = v_org
      and (
        (c.professional_id = a.professional_id
          and (c.specialty is null or c.specialty = p.specialty))
        or (c.professional_id is null and c.specialty = p.specialty)
      )
    order by
      (c.professional_id is not null) desc,
      (c.specialty is not null and c.specialty = p.specialty) desc,
      c.created_at desc
    limit 1
  ) regra on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Taxas de cartão: payment_method_fees casando forma + bandeira + parcelas.
  -- HIGH-2: bandeira comparada normalizada (lower(trim)) — config grava free-text
  -- ('Visa') e atendimento grava lowercase ('visa'); sem isso o left join zerava
  -- a taxa em silêncio. coalesce p/ ambos os lados (sem cartão → '').
  select coalesce(sum((a.valor - a.desconto) * taxa.fee_percent / 100), 0)
  into v_taxas
  from public.atendimentos a
  left join lateral (
    select f.fee_percent
    from public.payment_method_fees f
    where f.organization_id = v_org
      and f.payment_type = a.payment_method
      and lower(trim(coalesce(f.card_brand, ''))) = lower(trim(coalesce(a.card_brand, '')))
      and f.installments = a.installments
    order by f.created_at desc
    limit 1
  ) taxa on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Contas fixas MENSAIS ativas (soma de uma mensalidade).
  select coalesce(sum(fc.amount), 0)
  into v_contas_mensal
  from public.fixed_costs fc
  where fc.organization_id = v_org
    and fc.active = true;

  -- HIGH-1: nº de meses-calendário cobertos pelo range no fuso SP (inclusivo).
  -- date_trunc('month') de start e end; diferença em meses + 1. "Este ano" →
  -- 12×; "7 dias" dentro de um mês → 1×; range cruzando 2 meses → 2×.
  v_meses := (
    (extract(year from date_trunc('month', p_end at time zone 'America/Sao_Paulo'))::int * 12
      + extract(month from date_trunc('month', p_end at time zone 'America/Sao_Paulo'))::int)
    - (extract(year from date_trunc('month', p_start at time zone 'America/Sao_Paulo'))::int * 12
      + extract(month from date_trunc('month', p_start at time zone 'America/Sao_Paulo'))::int)
  ) + 1;
  if v_meses < 1 then
    v_meses := 1;
  end if;

  v_contas := v_contas_mensal * v_meses;

  result := json_build_object(
    'faturamento', v_faturamento,
    'comissoes', v_comissoes,
    'taxas', v_taxas,
    'contas_fixas', v_contas,
    'contas_fixas_mensal', v_contas_mensal,
    'meses_periodo', v_meses,
    'liquido', v_faturamento - v_comissoes - v_taxas - v_contas
  );

  return result;
end;
$$;

revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_net_result(timestamptz, timestamptz, uuid) to authenticated;
