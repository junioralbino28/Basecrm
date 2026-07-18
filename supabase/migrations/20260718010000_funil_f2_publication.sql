-- =============================================================================
-- Funil Construtor — F2: compiler contract, publicação imutável e enrollments
-- =============================================================================

-- D+1 é o próximo dia no timezone local da organização. Quiet hours são uma
-- política persistida e entram no snapshot publicado.
alter table public.organization_settings
  add column if not exists automation_timezone text not null default 'America/Sao_Paulo',
  add column if not exists automation_quiet_hours_start time not null default '20:00:00',
  add column if not exists automation_quiet_hours_end time not null default '08:00:00',
  add column if not exists automation_day_delay_semantics text not null default 'next_local_day';

alter table public.organization_settings
  add constraint organization_settings_automation_day_delay_semantics_v1
    check (automation_day_delay_semantics in ('next_local_day')),
  add constraint organization_settings_automation_quiet_hours_non_empty
    check (automation_quiet_hours_start <> automation_quiet_hours_end);

alter table public.automations
  add column draft_revision bigint not null default 1,
  add constraint automations_draft_revision_positive check (draft_revision > 0);

create table public.automation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null,
  version integer not null,
  source_draft_revision bigint not null,
  definition jsonb not null,
  definition_hash text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz not null default now(),
  constraint automation_versions_version_positive check (version > 0),
  constraint automation_versions_source_revision_positive check (source_draft_revision > 0),
  constraint automation_versions_definition_object check (jsonb_typeof(definition) = 'object'),
  constraint automation_versions_definition_hash_sha256
    check (definition_hash ~ '^[a-f0-9]{64}$'),
  constraint automation_versions_automation_tenant_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id)
    on delete cascade,
  constraint automation_versions_number_unique unique (automation_id, version),
  constraint automation_versions_id_automation_tenant_unique
    unique (id, automation_id, organization_id)
);

alter table public.automations
  add constraint automations_published_version_tenant_fk
  foreign key (published_version_id, id, organization_id)
  references public.automation_versions(id, automation_id, organization_id)
  deferrable initially deferred;

-- Pais legados ainda não tinham chave candidata tenant-safe para as inscrições.
create unique index if not exists uq_conversation_threads_org_id
  on public.conversation_threads(organization_id, id);
create unique index if not exists uq_channel_connections_org_id
  on public.channel_connections(organization_id, id);

create table public.automation_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  automation_id uuid not null,
  automation_version_id uuid not null,
  deal_id uuid not null,
  contact_id uuid not null,
  thread_id uuid,
  channel_connection_id uuid,
  current_step_key uuid not null,
  status text not null default 'active',
  paused_at timestamptz,
  paused_by uuid references public.profiles(id) on delete set null,
  entered_at timestamptz not null default now(),
  exited_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_enrollments_status_known
    check (status in ('active', 'waiting', 'paused', 'done', 'exited', 'failed', 'cancelled')),
  constraint automation_enrollments_pause_state_consistent
    check ((status = 'paused') = (paused_at is not null)),
  constraint automation_enrollments_terminal_reason_consistent
    check (
      (status in ('exited', 'failed', 'cancelled')) = (exited_reason is not null)
      or status = 'done'
    ),
  constraint automation_enrollments_automation_tenant_fk
    foreign key (automation_id, organization_id)
    references public.automations(id, organization_id),
  constraint automation_enrollments_version_tenant_fk
    foreign key (automation_version_id, automation_id, organization_id)
    references public.automation_versions(id, automation_id, organization_id),
  constraint automation_enrollments_deal_tenant_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id),
  constraint automation_enrollments_contact_tenant_fk
    foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id),
  constraint automation_enrollments_thread_tenant_fk
    foreign key (organization_id, thread_id)
    references public.conversation_threads(organization_id, id),
  constraint automation_enrollments_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id),
  constraint automation_enrollments_id_tenant_unique
    unique (id, organization_id)
);

create index idx_automation_versions_automation_id
  on public.automation_versions(automation_id, version desc);
create index idx_automation_versions_organization_id
  on public.automation_versions(organization_id, published_at desc);
create index idx_automation_enrollments_automation_id
  on public.automation_enrollments(automation_id, entered_at desc);
create index idx_automation_enrollments_version_id
  on public.automation_enrollments(automation_version_id);
create index idx_automation_enrollments_deal_id
  on public.automation_enrollments(organization_id, deal_id);
create index idx_automation_enrollments_contact_id
  on public.automation_enrollments(organization_id, contact_id);
create index idx_automation_enrollments_thread_id
  on public.automation_enrollments(organization_id, thread_id)
  where thread_id is not null;
create index idx_automation_enrollments_channel_id
  on public.automation_enrollments(organization_id, channel_connection_id)
  where channel_connection_id is not null;
create index idx_automation_enrollments_active
  on public.automation_enrollments(organization_id, status, updated_at)
  where status in ('active', 'waiting', 'paused');

alter table public.automation_versions enable row level security;
alter table public.automation_enrollments enable row level security;

create policy "automation_versions_select_by_tenant_operator"
  on public.automation_versions
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

create policy "automation_enrollments_select_by_tenant_operator"
  on public.automation_enrollments
  for select
  to authenticated
  using (
    public.can_access_organization(organization_id)
    and (
      public.has_permission('automation.edit')
      or public.has_permission('automation.operate')
    )
  );

-- Versões não são corrigidas in-place, inclusive por service_role. Rollback
-- sempre cria uma nova publicação.
create or replace function public.prevent_automation_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception using
      errcode = '55000',
      message = 'versões publicadas são imutáveis';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_automation_version_mutation() from public;
revoke all on function public.prevent_automation_version_mutation() from anon;
revoke all on function public.prevent_automation_version_mutation() from authenticated;

create trigger prevent_automation_version_mutation
  before update or delete on public.automation_versions
  for each row execute function public.prevent_automation_version_mutation();

-- Campos de controle não podem ser alterados pelo CRUD do draft. Publicação e
-- operação passam por RPCs internos. Alterações semânticas incrementam revision.
create or replace function public.guard_automation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and (
      new.published_version_id is distinct from old.published_version_id
      or new.lifecycle_status is distinct from old.lifecycle_status
      or new.delivery_mode is distinct from old.delivery_mode
    )
  then
    raise exception using
      errcode = '42501',
      message = 'campos de controle exigem operação interna';
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
    and pg_trigger_depth() = 1
    and new.draft_revision is distinct from old.draft_revision
  then
    raise exception using
      errcode = '42501',
      message = 'draft_revision é gerenciada pelo banco';
  end if;

  if new.name is distinct from old.name
    or new.trigger_type is distinct from old.trigger_type
    or new.trigger_config is distinct from old.trigger_config
  then
    new.draft_revision := old.draft_revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_automation_update() from public;
revoke all on function public.guard_automation_update() from anon;
revoke all on function public.guard_automation_update() from authenticated;

create trigger guard_automation_update
  before update on public.automations
  for each row execute function public.guard_automation_update();

create or replace function public.guard_automation_child_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.automation_id is distinct from old.automation_id then
    raise exception using
      errcode = '23514',
      message = 'automation_id é imutável';
  end if;
  if tg_table_name = 'automation_steps'
    and new.step_key is distinct from old.step_key
  then
    raise exception using
      errcode = '23514',
      message = 'step_key é imutável';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_automation_child_identity() from public;
revoke all on function public.guard_automation_child_identity() from anon;
revoke all on function public.guard_automation_child_identity() from authenticated;

create trigger guard_automation_step_identity
  before update on public.automation_steps
  for each row execute function public.guard_automation_child_identity();
create trigger guard_automation_edge_identity
  before update on public.automation_step_edges
  for each row execute function public.guard_automation_child_identity();

create or replace function public.bump_automation_draft_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation_id uuid;
begin
  if tg_op = 'DELETE' then
    v_automation_id := old.automation_id;
  else
    v_automation_id := new.automation_id;
  end if;

  update public.automations
  set draft_revision = draft_revision + 1,
      updated_at = now()
  where id = v_automation_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_automation_draft_revision() from public;
revoke all on function public.bump_automation_draft_revision() from anon;
revoke all on function public.bump_automation_draft_revision() from authenticated;

create trigger bump_automation_revision_from_step
  after insert or update or delete on public.automation_steps
  for each row execute function public.bump_automation_draft_revision();
create trigger bump_automation_revision_from_edge
  after insert or update or delete on public.automation_step_edges
  for each row execute function public.bump_automation_draft_revision();

-- Conteúdo linked usa optimistic concurrency por revision.
create or replace function public.increment_message_template_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body
    or new.channel is distinct from old.channel
    or new.media_asset_variant_id is distinct from old.media_asset_variant_id
    or new.variables is distinct from old.variables
  then
    new.revision := old.revision + 1;
  elsif new.revision is distinct from old.revision then
    raise exception using
      errcode = '42501',
      message = 'revision é gerenciada pelo banco';
  end if;
  return new;
end;
$$;

revoke all on function public.increment_message_template_revision() from public;
revoke all on function public.increment_message_template_revision() from anon;
revoke all on function public.increment_message_template_revision() from authenticated;

create trigger increment_message_template_revision
  before update on public.message_templates
  for each row execute function public.increment_message_template_revision();

create or replace function public.guard_automation_enrollment_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.automation_id is distinct from old.automation_id
    or new.automation_version_id is distinct from old.automation_version_id
    or new.deal_id is distinct from old.deal_id
    or new.contact_id is distinct from old.contact_id
  then
    raise exception using
      errcode = '23514',
      message = 'identidade da inscrição é imutável';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_automation_enrollment_identity() from public;
revoke all on function public.guard_automation_enrollment_identity() from anon;
revoke all on function public.guard_automation_enrollment_identity() from authenticated;

create trigger guard_automation_enrollment_identity
  before update on public.automation_enrollments
  for each row execute function public.guard_automation_enrollment_identity();
create trigger update_automation_enrollments_updated_at
  before update on public.automation_enrollments
  for each row execute function public.update_updated_at_column();

-- Publicação atômica. O compilador roda no servidor; a RPC revalida actor,
-- revision, hash, identidade, agenda e snapshots linked sob lock.
create or replace function public.publish_automation_version(
  p_automation_id uuid,
  p_expected_draft_revision bigint,
  p_definition_canonical text,
  p_definition_hash text,
  p_created_by uuid
)
returns table (
  id uuid,
  version integer,
  definition_hash text,
  published_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation public.automations%rowtype;
  v_actor public.profiles%rowtype;
  v_default boolean;
  v_override boolean;
  v_override_org uuid;
  v_can_edit boolean;
  v_definition jsonb;
  v_hash text;
  v_version integer;
  v_version_id uuid := gen_random_uuid();
  v_published_at timestamptz := now();
begin
  select *
  into v_automation
  from public.automations
  where public.automations.id = p_automation_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'automação não encontrada';
  end if;
  if v_automation.lifecycle_status = 'archived' then
    raise exception using errcode = '55000', message = 'automação arquivada não pode ser publicada';
  end if;
  if v_automation.draft_revision <> p_expected_draft_revision then
    raise exception using errcode = '40001', message = 'draft mudou durante a publicação';
  end if;

  select *
  into v_actor
  from public.profiles
  where public.profiles.id = p_created_by;
  if not found then
    raise exception using errcode = '42501', message = 'ator inválido';
  end if;
  if public.normalize_profile_role(v_actor.role) not in ('agency_admin', 'agency_staff', 'admin')
    and v_actor.organization_id <> v_automation.organization_id
  then
    raise exception using errcode = '42501', message = 'ator não acessa o tenant';
  end if;

  select d.enabled
  into v_default
  from public.role_permission_defaults d
  where d.defaults_version = 1
    and d.role = public.normalize_profile_role(v_actor.role)
    and d.permission_key = 'automation.edit';
  if not found then
    raise exception using errcode = '42501', message = 'permissão de edição ausente';
  end if;

  select pp.enabled, pp.organization_id
  into v_override, v_override_org
  from public.profile_permissions pp
  where pp.user_id = p_created_by
    and pp.permission_key = 'automation.edit';

  if found then
    v_can_edit := case
      when v_override_org = v_actor.organization_id then v_override
      else false
    end;
  else
    v_can_edit := v_default;
  end if;
  if not coalesce(v_can_edit, false) then
    raise exception using errcode = '42501', message = 'automation.edit é obrigatória';
  end if;

  begin
    v_definition := p_definition_canonical::jsonb;
  exception when others then
    raise exception using errcode = '22023', message = 'definition canônica inválida';
  end;

  v_hash := encode(extensions.digest(p_definition_canonical, 'sha256'), 'hex');
  if v_hash <> p_definition_hash or p_definition_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'definition_hash inválido';
  end if;
  if jsonb_typeof(v_definition) <> 'object'
    or v_definition->>'automationId' <> v_automation.id::text
    or v_definition->>'organizationId' <> v_automation.organization_id::text
    or v_definition->>'name' <> v_automation.name
    or v_definition->>'deliveryMode' <> v_automation.delivery_mode
    or v_definition#>>'{trigger,type}' <> v_automation.trigger_type
    or coalesce(jsonb_array_length(v_definition->'steps'), 0) = 0
  then
    raise exception using errcode = '22023', message = 'definition diverge do draft';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_definition->'steps') step
    where step->>'stepKey' = v_definition->>'entryStepKey'
  ) then
    raise exception using errcode = '22023', message = 'entryStepKey não existe na definição';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_definition#>>'{schedule,timezone}'
  ) then
    raise exception using errcode = '22023', message = 'timezone inválida';
  end if;
  if not exists (
    select 1
    from public.organization_settings settings
    where settings.organization_id = v_automation.organization_id
      and settings.automation_timezone = v_definition#>>'{schedule,timezone}'
      and settings.automation_quiet_hours_start::text = v_definition#>>'{schedule,quietHoursStart}'
      and settings.automation_quiet_hours_end::text = v_definition#>>'{schedule,quietHoursEnd}'
      and settings.automation_day_delay_semantics = v_definition#>>'{schedule,dayDelaySemantics}'
  ) then
    raise exception using errcode = '40001', message = 'agenda da organização mudou durante a publicação';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_definition->'steps') step
    where step->>'type' = 'send_message'
      and step#>>'{config,linkMode}' = 'linked'
      and not exists (
        select 1
        from public.message_templates template
        where template.organization_id = v_automation.organization_id
          and template.id = (step#>>'{config,templateId}')::uuid
          and template.revision = (step#>>'{config,templateRevision}')::integer
          and template.channel = step#>>'{config,channel}'
          and template.body = step#>>'{config,body}'
          and template.media_asset_variant_id is not distinct from
            nullif(step#>>'{config,mediaAssetVariantId}', '')::uuid
      )
  ) then
    raise exception using errcode = '40001', message = 'template linked mudou durante a publicação';
  end if;

  select coalesce(max(public.automation_versions.version), 0) + 1
  into v_version
  from public.automation_versions
  where automation_id = p_automation_id;

  insert into public.automation_versions (
    id,
    organization_id,
    automation_id,
    version,
    source_draft_revision,
    definition,
    definition_hash,
    created_by,
    published_at
  )
  values (
    v_version_id,
    v_automation.organization_id,
    v_automation.id,
    v_version,
    v_automation.draft_revision,
    v_definition,
    p_definition_hash,
    p_created_by,
    v_published_at
  );

  update public.automations
  set published_version_id = v_version_id,
      lifecycle_status = 'published',
      updated_at = v_published_at
  where public.automations.id = p_automation_id;

  return query
  select v_version_id, v_version, p_definition_hash, v_published_at;
end;
$$;

revoke all on function public.publish_automation_version(uuid, bigint, text, text, uuid) from public;
revoke all on function public.publish_automation_version(uuid, bigint, text, text, uuid) from anon;
revoke all on function public.publish_automation_version(uuid, bigint, text, text, uuid) from authenticated;
grant execute on function public.publish_automation_version(uuid, bigint, text, text, uuid) to service_role;

-- A inscrição recebe somente IDs de domínio; tenant, versão e cursor inicial
-- são derivados da automação publicada dentro da transação.
create or replace function public.create_automation_enrollment(
  p_automation_id uuid,
  p_deal_id uuid,
  p_contact_id uuid,
  p_thread_id uuid,
  p_channel_connection_id uuid
)
returns public.automation_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation public.automations%rowtype;
  v_definition jsonb;
  v_entry_step_key uuid;
  v_enrollment public.automation_enrollments%rowtype;
begin
  select *
  into v_automation
  from public.automations
  where public.automations.id = p_automation_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'automação não encontrada';
  end if;
  if v_automation.lifecycle_status <> 'published'
    or v_automation.published_version_id is null
  then
    raise exception using errcode = '55000', message = 'automação não está publicada';
  end if;

  select definition
  into v_definition
  from public.automation_versions
  where id = v_automation.published_version_id
    and automation_id = v_automation.id
    and organization_id = v_automation.organization_id;
  if not found then
    raise exception using errcode = '55000', message = 'versão publicada inválida';
  end if;

  begin
    v_entry_step_key := (v_definition->>'entryStepKey')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'entryStepKey inválida';
  end;
  if not exists (
    select 1
    from jsonb_array_elements(v_definition->'steps') step
    where step->>'stepKey' = v_entry_step_key::text
  ) then
    raise exception using errcode = '22023', message = 'entryStepKey ausente da versão';
  end if;

  insert into public.automation_enrollments (
    organization_id,
    automation_id,
    automation_version_id,
    deal_id,
    contact_id,
    thread_id,
    channel_connection_id,
    current_step_key
  )
  values (
    v_automation.organization_id,
    v_automation.id,
    v_automation.published_version_id,
    p_deal_id,
    p_contact_id,
    p_thread_id,
    p_channel_connection_id,
    v_entry_step_key
  )
  returning * into v_enrollment;

  return v_enrollment;
end;
$$;

revoke all on function public.create_automation_enrollment(uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.create_automation_enrollment(uuid, uuid, uuid, uuid, uuid) from anon;
revoke all on function public.create_automation_enrollment(uuid, uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.create_automation_enrollment(uuid, uuid, uuid, uuid, uuid) to service_role;
