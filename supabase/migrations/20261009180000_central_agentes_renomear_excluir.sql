-- =============================================================================
-- CENTRAL DE AGENTES — renomear e excluir agente (09/10/2026)
-- =============================================================================
-- SPEC: docs/features/central-de-agentes/SPEC-renomear-excluir.md (v2, rodada 1 do Codex respondida).
-- Decisão do Junior (09/10 ~16h55): excluir DE VEZ; agente com número ligado não exclui; confirmação antes.
-- Duas funções para a tela, chamadas pelas rotas COM O JWT DO USUÁRIO: o papel é conferido aqui dentro
-- (is_agency_admin_role) e o autor vem de auth.uid(). A exclusão grava o registro em ai_agent_deletions na
-- mesma transação: sem o registro, nada é apagado.
-- Sem barra invertida neste arquivo.
-- Erros (nome na mensagem; a rota traduz pela mensagem):
--   sem_permissao (42501) · cliente_inexistente, agente_inexistente (P0002) · nome_invalido (22023) ·
--   agente_mudou, agente_com_numero (P0001)
-- ADITIVA: uma tabela nova e duas funções; nenhuma tabela existente muda.
-- VOLTA: docs/features/central-de-agentes/volta-renomear-excluir.sql.
-- =============================================================================

-- Registro das exclusões: gravado DENTRO da função, na mesma transação do delete. Sem ele, nada é apagado.
-- Só a chave de serviço lê (RLS ligada, sem policy). deleted_by e agent_id sem FK: o registro sobrevive à
-- remoção da pessoa e do agente.
create table if not exists public.ai_agent_deletions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null,
  agent_name text not null,
  draft_revision integer not null,
  published_version_id uuid null,
  versions_deleted integer not null,
  deleted_by uuid null,
  deleted_at timestamptz not null default now()
);
alter table public.ai_agent_deletions enable row level security;
revoke all on table public.ai_agent_deletions from anon, authenticated;
grant all on table public.ai_agent_deletions to service_role;

create or replace function public.rename_ai_agent(p_organization_id uuid, p_agent_id uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  update public.ai_agents a set name = v_nome, updated_at = now()
   where a.organization_id = p_organization_id and a.id = p_agent_id;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  return v_nome;
end;
$$;

revoke all on function public.rename_ai_agent(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.rename_ai_agent(uuid, uuid, text) to authenticated;

create or replace function public.delete_ai_agent(
  p_organization_id uuid,
  p_agent_id uuid,
  p_expected_name text,
  p_expected_draft_revision integer,
  p_expected_published_version_id uuid
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_revisao integer;
  v_publicada uuid;
  v_numeros integer;
  v_versoes integer;
  v_restricao text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  -- FOR UPDATE: salvar rascunho, publicar, renomear e ligar número (que trava o agente FOR SHARE) esperam
  -- esta transação, ou esta espera a deles; depois da espera, a comparação abaixo vê o estado novo.
  select a.name, a.draft_revision, a.published_version_id
    into v_nome, v_revisao, v_publicada
  from public.ai_agents a
  where a.organization_id = p_organization_id and a.id = p_agent_id
  for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  if v_nome is distinct from p_expected_name
     or v_revisao is distinct from p_expected_draft_revision
     or v_publicada is distinct from p_expected_published_version_id then
    raise exception 'agente_mudou' using errcode = 'P0001';
  end if;
  select count(*) into v_numeros from public.channel_connections c
   where c.organization_id = p_organization_id and c.ai_agent_id = p_agent_id;
  if v_numeros > 0 then
    raise exception 'agente_com_numero' using errcode = 'P0001', detail = v_numeros::text;
  end if;
  select count(*) into v_versoes from public.ai_agent_versions v
   where v.organization_id = p_organization_id and v.agent_id = p_agent_id;
  -- Defesa a mais, não o caminho comum: com as travas acima, um número ligado por outra transação é visto pela
  -- contagem. Só a FK do número vira o erro da tela; qualquer outra violação sobe como veio.
  begin
    delete from public.ai_agents a where a.organization_id = p_organization_id and a.id = p_agent_id;
  exception when foreign_key_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'channel_connections_ai_agent_fk' then
      raise exception 'agente_com_numero' using errcode = 'P0001';
    end if;
    raise;
  end;
  insert into public.ai_agent_deletions
    (organization_id, agent_id, agent_name, draft_revision, published_version_id, versions_deleted, deleted_by)
  values
    (p_organization_id, p_agent_id, v_nome, v_revisao, v_publicada, v_versoes, auth.uid());
  return v_versoes;
end;
$$;

revoke all on function public.delete_ai_agent(uuid, uuid, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_ai_agent(uuid, uuid, text, integer, uuid) to authenticated;
