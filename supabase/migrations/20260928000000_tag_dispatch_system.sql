-- =============================================================================
-- Despacho de régua por etiqueta + aplicação de etiqueta por processo (28/09)
--
-- Decisão do Junior (27/09): o lead anda sozinho no funil. A etiqueta é o elo:
-- quem aplica pode ser humano (RPC assign_deal_tag, intocada) ou um processo
-- (IA do atendimento, automação, API — RPC nova assign_deal_tag_system).
-- QUALQUER etiqueta aplicada inscreve o negócio nas automações publicadas cujo
-- gatilho é aquela etiqueta (trigger AFTER INSERT). Sem automação publicada
-- para a etiqueta, nada muda — comportamento de hoje preservado byte a byte.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) assign_deal_tag_system — espelho da assign_deal_tag para chamadas de
--    processo (service_role apenas; sem sessão de usuário).
--    ESPELHO CONSCIENTE: a lógica de cardinalidade/auditoria/array legado deve
--    mudar SEMPRE em par com public.assign_deal_tag (20260722010000).
--    Diferenças intencionais: sem gate de auth.uid()/permissão (o EXECUTE é
--    restrito a service_role), provenance parametrizada ('ai'|'automation'|'api')
--    e applied_by/removed_by nulos (não há usuário).
-- -----------------------------------------------------------------------------
create or replace function public.assign_deal_tag_system(
  p_organization_id uuid,
  p_deal_id uuid,
  p_tag_id uuid,
  p_provenance text default 'ai'
)
returns public.deal_tag_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag public.tags;
  v_category public.tag_categories;
  v_assignment public.deal_tag_assignments;
  v_make_primary boolean;
  v_removed_legacy text;
begin
  if p_provenance not in ('ai', 'automation', 'api') then
    raise exception using errcode = '22023',
      message = 'Proveniência inválida para aplicação por processo.';
  end if;

  perform 1 from public.deals
  where organization_id = p_organization_id and id = p_deal_id
  for update;
  if not found then
    raise exception using errcode = '23503',
      message = 'Negócio não encontrado nesta organização.';
  end if;

  select t.* into strict v_tag
  from public.tags t
  where t.organization_id = p_organization_id
    and t.id = p_tag_id
    and t.category_id is not null
    and t.archived_at is null;
  select c.* into strict v_category
  from public.tag_categories c
  where c.organization_id = p_organization_id
    and c.id = v_tag.category_id
    and c.archived_at is null;

  select * into v_assignment
  from public.deal_tag_assignments
  where organization_id = p_organization_id
    and deal_id = p_deal_id
    and tag_id = p_tag_id
    and removed_at is null
  for update;

  if v_assignment.id is not null then
    return v_assignment;
  end if;

  if v_category.cardinality = 'single' then
    for v_removed_legacy in
      update public.deal_tag_assignments a
      set removed_at = now(), removed_by = null, is_primary = false
      from public.tags old_tag
      where a.organization_id = p_organization_id
        and a.deal_id = p_deal_id
        and a.category_id = v_tag.category_id
        and a.removed_at is null
        and old_tag.id = a.tag_id
      returning old_tag.legacy_value
    loop
      update public.deals
      set tags = array_remove(coalesce(tags, '{}'::text[]), v_removed_legacy)
      where organization_id = p_organization_id and id = p_deal_id;
    end loop;
  end if;

  v_make_primary := not exists (
    select 1 from public.deal_tag_assignments
    where organization_id = p_organization_id
      and deal_id = p_deal_id
      and category_id = v_tag.category_id
      and removed_at is null
  );

  insert into public.deal_tag_assignments (
    organization_id, deal_id, category_id, tag_id, is_primary,
    provenance, applied_at, applied_by, recorded_at
  ) values (
    p_organization_id, p_deal_id, v_tag.category_id, p_tag_id, v_make_primary,
    p_provenance, now(), null, now()
  ) returning * into v_assignment;

  update public.deals
  set tags = case
    when array_position(coalesce(tags, '{}'::text[]), v_tag.legacy_value) is null
      then array_append(coalesce(tags, '{}'::text[]), v_tag.legacy_value)
    else tags
  end
  where organization_id = p_organization_id and id = p_deal_id;

  return v_assignment;
end;
$$;

revoke all on function public.assign_deal_tag_system(uuid, uuid, uuid, text) from public;
revoke all on function public.assign_deal_tag_system(uuid, uuid, uuid, text) from anon;
revoke all on function public.assign_deal_tag_system(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.assign_deal_tag_system(uuid, uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- B) enroll_published_automations_for_deal_tag — inscreve o negócio em toda
--    automação PUBLICADA da organização cujo gatilho (dependência 'trigger',
--    escopo 'published', da versão publicada ATUAL) é a etiqueta aplicada.
--    Dedupe: pula automação com inscrição viva (active/waiting/paused) para o
--    mesmo negócio. Contato vem do negócio; conversa e canal, da thread mais
--    recente do negócio. Falha em UMA automação não impede as demais.
-- -----------------------------------------------------------------------------
create or replace function public.enroll_published_automations_for_deal_tag(
  p_organization_id uuid,
  p_deal_id uuid,
  p_tag_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_automation record;
  v_contact_id uuid;
  v_thread_id uuid;
  v_channel_connection_id uuid;
  v_enrolled integer := 0;
begin
  select contact_id into v_contact_id
  from public.deals
  where organization_id = p_organization_id and id = p_deal_id;

  select t.id, t.channel_connection_id
  into v_thread_id, v_channel_connection_id
  from public.conversation_threads t
  where t.organization_id = p_organization_id
    and t.deal_id = p_deal_id
  order by t.last_message_at desc nulls last, t.updated_at desc
  limit 1;

  for v_automation in
    select a.id
    from public.automation_tag_dependencies dep
    join public.automations a
      on a.id = dep.automation_id
     and a.organization_id = dep.organization_id
     and a.lifecycle_status = 'published'
     and a.published_version_id = dep.automation_version_id
    where dep.organization_id = p_organization_id
      and dep.tag_id = p_tag_id
      and dep.dependency_type = 'trigger'
      and dep.source_scope = 'published'
  loop
    if exists (
      select 1 from public.automation_enrollments e
      where e.organization_id = p_organization_id
        and e.automation_id = v_automation.id
        and e.deal_id = p_deal_id
        and e.status in ('active', 'waiting', 'paused')
    ) then
      continue;
    end if;

    begin
      perform public.create_automation_enrollment(
        v_automation.id,
        p_deal_id,
        v_contact_id,
        v_thread_id,
        v_channel_connection_id
      );
      v_enrolled := v_enrolled + 1;
    exception when others then
      -- A etiqueta nunca pode deixar de entrar porque UMA régua recusou a
      -- inscrição (ex.: despublicada entre a leitura e a chamada).
      raise warning 'enroll_published_automations_for_deal_tag: automacao % nao inscrita para deal %: %',
        v_automation.id, p_deal_id, sqlerrm;
    end;
  end loop;

  return v_enrolled;
end;
$$;

revoke all on function public.enroll_published_automations_for_deal_tag(uuid, uuid, uuid) from public;
revoke all on function public.enroll_published_automations_for_deal_tag(uuid, uuid, uuid) from anon;
revoke all on function public.enroll_published_automations_for_deal_tag(uuid, uuid, uuid) from authenticated;
grant execute on function public.enroll_published_automations_for_deal_tag(uuid, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- C) Gatilho: etiqueta aplicada (por QUALQUER via que insira atribuição ativa)
--    despacha a inscrição. Erro no despacho não derruba a aplicação da tag.
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_tag_added_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.enroll_published_automations_for_deal_tag(
      new.organization_id, new.deal_id, new.tag_id
    );
  exception when others then
    raise warning 'dispatch_tag_added_enrollment: despacho falhou para deal % tag %: %',
      new.deal_id, new.tag_id, sqlerrm;
  end;
  return new;
end;
$$;

-- Import em massa e migração legada NÃO inscrevem (500 leads importados não
-- podem virar 500 réguas disparando de surpresa; inscrição por import é
-- decisão futura, explícita).
drop trigger if exists trg_dispatch_tag_added_enrollment on public.deal_tag_assignments;
create trigger trg_dispatch_tag_added_enrollment
  after insert on public.deal_tag_assignments
  for each row
  when (new.removed_at is null and new.provenance in ('human', 'ai', 'automation', 'api'))
  execute function public.dispatch_tag_added_enrollment();
