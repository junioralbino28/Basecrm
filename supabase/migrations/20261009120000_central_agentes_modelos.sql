-- =============================================================================
-- CENTRAL DE AGENTES — bloco 2 (criar agentes e modelos da agência)
-- =============================================================================
-- SPEC: docs/features/central-de-agentes/SPEC-bloco-2.md (v2 + rodada 2 do Codex). PLAN: PLAN-bloco-2.md.
-- Seis funções para a tela, chamadas pelas rotas COM O JWT DO USUÁRIO, nunca com a chave de serviço: o papel é
-- conferido aqui dentro (is_agency_admin_role) e o autor vem de auth.uid(). Modelo e cópia não recebem texto: o
-- banco monta o texto do agente na mesma transação em que confere a revisão do modelo (FOR SHARE) ou a versão
-- publicada de origem, e a origin gravada prova a derivação. No branco, o texto vem do catálogo do código e a
-- origin só registra a escolha.
-- Sem barra invertida neste arquivo: colchete e chave entram como classe ([[], []], [{], [}]) e a quebra de
-- linha como chr(10).
-- Erros (nome na mensagem; a rota traduz pela mensagem):
--   sem_permissao (42501) · cliente_inexistente, agente_inexistente, modelo_inexistente (P0002)
--   modelo_mudou, modelo_arquivado, versao_publicada_mudou, sem_versao_publicada, sem_mudancas,
--   variavel_desconhecida (P0001; nome no detail)
--   nome_invalido, descricao_invalida, prompt_invalido, pedido_invalido, respostas_invalidas,
--   lacuna_inexistente, lacuna_ambigua, lacuna_invalida (22023; a lacuna no detail quando houver)
-- ADITIVA: uma tabela nova e funções novas; nenhuma tabela existente muda.
-- VOLTA: docs/features/central-de-agentes/volta-bloco-2.sql.
-- =============================================================================

create table if not exists public.ai_agent_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text null,
  prompt text not null,
  origin jsonb not null,
  revision integer not null default 1,
  created_by uuid null references public.profiles(id) on delete set null,
  updated_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint ai_agent_templates_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint ai_agent_templates_description_chk check (description is null or char_length(description) <= 280),
  constraint ai_agent_templates_prompt_chk check (char_length(prompt) between 1 and 50000),
  constraint ai_agent_templates_origin_chk check (jsonb_typeof(origin) = 'object' and origin ->> 'kind' in ('blank', 'agent')),
  constraint ai_agent_templates_revision_chk check (revision >= 1)
);

-- RLS: leitura só da agência. Nenhuma policy de escrita: no caminho da aplicação, só as funções escrevem.
alter table public.ai_agent_templates enable row level security;

create policy "ai_agent_templates_select_agencia"
  on public.ai_agent_templates for select
  to authenticated
  using (public.is_agency_admin_role());

-- GRANT explícito (RLS só restringe). A service_role mantém all, como nas tabelas da fase 1 (achado 6).
revoke all on table public.ai_agent_templates from anon, authenticated;
grant select on table public.ai_agent_templates to authenticated;
grant all on table public.ai_agent_templates to service_role;

-- As OCORRÊNCIAS de lacuna, COM repetição, na ordem do texto: a mesma forma da PENDENCIA de
-- lib/agents/verificarPrompt.ts ("[" + maiúscula + até 80 caracteres sem colchete nem quebra de linha + "]", não
-- seguido de "(" nem "["). Com repetição de propósito (rodada 1 do PLAN, achado 1): a conferência do resultado
-- compara ocorrências, e uma lista distinta deixaria passar "[[Nome]] e [Cliente]" respondendo "Cliente". O teste
-- local confere com ocorrenciasDeLacunas (TypeScript) nos mesmos exemplos. Sem execute para ninguém.
create or replace function public.central_agentes_lacunas(p_texto text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg('[' || r.m[1] || ']' order by r.ordem), '{}'::text[])
  from regexp_matches(
    coalesce(p_texto, ''),
    '[[]([A-ZÀ-Ý][^][' || chr(10) || ']{1,80})[]](?![([])',
    'g'
  ) with ordinality as r(m, ordem)
$$;

revoke all on function public.central_agentes_lacunas(text) from public, anon, authenticated, service_role;

-- Os marcadores {{...}} na ordem em que aparecem (com repetição): a troca das lacunas não pode criar nem desfazer
-- nenhum (achado 4 da rodada 1). Sem execute para ninguém.
create or replace function public.central_agentes_marcadores(p_texto text)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(r.m[1] order by r.ordem), '{}'::text[])
  from regexp_matches(coalesce(p_texto, ''), '([{][{][^{}]*[}][}])', 'g') with ordinality as r(m, ordem)
$$;

revoke all on function public.central_agentes_marcadores(text) from public, anon, authenticated, service_role;

-- Agente novo a partir do padrão em branco (o texto vem do catálogo do código, pela rota). A origin só registra a
-- escolha e o sha do texto gravado; não afirma de onde o texto veio.
create or replace function public.create_ai_agent_blank(
  p_organization_id uuid,
  p_name text,
  p_prompt text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_desconhecida text;
  v_id uuid;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if p_prompt is null or char_length(p_prompt) < 1 or char_length(p_prompt) > 50000 then
    raise exception 'prompt_invalido' using errcode = '22023';
  end if;
  -- FOR SHARE: uma exclusao logica concorrente (update de deleted_at) espera esta transacao, e uma que ja
  -- aconteceu reavalia o filtro (rodada 1 do PLAN, achado 2).
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  v_desconhecida := public.central_agentes_variavel_desconhecida(p_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;

  insert into public.ai_agents
    (organization_id, name, draft, draft_revision, draft_updated_at, draft_updated_by, origin, created_by)
  values
    (p_organization_id, v_nome, jsonb_build_object('prompt', p_prompt), 1, now(), auth.uid(),
     jsonb_build_object('kind', 'blank', 'promptSha256', encode(extensions.digest(p_prompt, 'sha256'), 'hex')),
     auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_ai_agent_blank(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_ai_agent_blank(uuid, text, text) to authenticated;

-- Agente novo a partir de um modelo: o banco monta o texto. Ordem fixa (rodada 2, ponto 2): modelo, arquivado,
-- REVISÃO, e só então as chaves; a troca é literal (replace) e o resultado é conferido.
create or replace function public.create_ai_agent_from_template(
  p_organization_id uuid,
  p_name text,
  p_template_id uuid,
  p_expected_template_revision integer,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_modelo_prompt text;
  v_modelo_revisao integer;
  v_modelo_arquivado timestamptz;
  v_lacunas text[];
  v_respondidas text[] := '{}'::text[];
  v_restantes text[];
  v_texto text;
  v_chave text;
  v_valor jsonb;
  v_resposta text;
  v_desconhecida text;
  v_id uuid;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  -- FOR SHARE: uma exclusao logica concorrente (update de deleted_at) espera esta transacao, e uma que ja
  -- aconteceu reavalia o filtro (rodada 1 do PLAN, achado 2).
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;

  select t.prompt, t.revision, t.archived_at
    into v_modelo_prompt, v_modelo_revisao, v_modelo_arquivado
  from public.ai_agent_templates t
  where t.id = p_template_id
  for share;
  if not found then
    raise exception 'modelo_inexistente' using errcode = 'P0002';
  end if;
  if v_modelo_arquivado is not null then
    raise exception 'modelo_arquivado' using errcode = 'P0001';
  end if;
  if v_modelo_revisao is distinct from p_expected_template_revision then
    raise exception 'modelo_mudou' using errcode = 'P0001';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'respostas_invalidas' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_answers)) > 50 then
    raise exception 'respostas_invalidas' using errcode = '22023';
  end if;

  v_lacunas := public.central_agentes_lacunas(v_modelo_prompt);
  v_texto := v_modelo_prompt;
  for v_chave, v_valor in select e.key, e.value from jsonb_each(p_answers) e order by e.key loop
    if not (v_chave = any (v_lacunas)) then
      raise exception 'lacuna_inexistente' using errcode = '22023', detail = left(v_chave, 90);
    end if;
    if jsonb_typeof(v_valor) <> 'string' then
      raise exception 'respostas_invalidas' using errcode = '22023', detail = v_chave;
    end if;
    v_resposta := btrim(v_valor #>> '{}');
    continue when v_resposta = '';
    if char_length(v_resposta) > 500 or v_resposta ~ '[][{}]' then
      raise exception 'respostas_invalidas' using errcode = '22023', detail = v_chave;
    end if;
    if position(v_chave || '(' in v_modelo_prompt) > 0 or position(v_chave || '[' in v_modelo_prompt) > 0 then
      raise exception 'lacuna_ambigua' using errcode = '22023', detail = v_chave;
    end if;
    v_texto := replace(v_texto, v_chave, v_resposta);
    v_respondidas := v_respondidas || v_chave;
  end loop;

  -- O resultado, não só o valor (achado 4 da SPEC): os mesmos {{...}} do modelo, na ordem, e exatamente as
  -- OCORRÊNCIAS de lacuna do modelo menos todas as ocorrências das respondidas, com repetição e na ordem.
  if public.central_agentes_marcadores(v_texto) is distinct from public.central_agentes_marcadores(v_modelo_prompt) then
    raise exception 'lacuna_invalida' using errcode = '22023';
  end if;
  select coalesce(array_agg(u.l order by u.o), '{}'::text[])
    into v_restantes
  from unnest(v_lacunas) with ordinality as u(l, o)
  where not (u.l = any (v_respondidas));
  if public.central_agentes_lacunas(v_texto) is distinct from v_restantes then
    raise exception 'lacuna_invalida' using errcode = '22023';
  end if;
  if char_length(v_texto) > 50000 then
    raise exception 'prompt_invalido' using errcode = '22023';
  end if;
  v_desconhecida := public.central_agentes_variavel_desconhecida(v_texto);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;

  insert into public.ai_agents
    (organization_id, name, draft, draft_revision, draft_updated_at, draft_updated_by, origin, created_by)
  values
    (p_organization_id, v_nome, jsonb_build_object('prompt', v_texto), 1, now(), auth.uid(),
     jsonb_build_object(
       'kind', 'template',
       'templateId', p_template_id,
       'templateRevision', v_modelo_revisao,
       'templateSha256', encode(extensions.digest(v_modelo_prompt, 'sha256'), 'hex'),
       'answered', to_jsonb(v_respondidas),
       'promptSha256', encode(extensions.digest(v_texto, 'sha256'), 'hex')
     ),
     auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_ai_agent_from_template(uuid, text, uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_ai_agent_from_template(uuid, text, uuid, integer, jsonb) to authenticated;

-- Agente novo copiando a versão PUBLICADA de outro agente (de qualquer cliente). Organização e agente de origem são
-- conferidos juntos; a versão publicada tem que ser a que a tela mostrou.
create or replace function public.create_ai_agent_from_copy(
  p_organization_id uuid,
  p_name text,
  p_source_organization_id uuid,
  p_source_agent_id uuid,
  p_expected_source_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_publicada uuid;
  v_versao integer;
  v_prompt text;
  v_sha text;
  v_desconhecida text;
  v_id uuid;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  -- FOR SHARE: uma exclusao logica concorrente (update de deleted_at) espera esta transacao, e uma que ja
  -- aconteceu reavalia o filtro (rodada 1 do PLAN, achado 2).
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;

  select a.published_version_id
    into v_publicada
  from public.ai_agents a
  where a.id = p_source_agent_id
    and a.organization_id = p_source_organization_id
  for share;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  if v_publicada is null then
    raise exception 'sem_versao_publicada' using errcode = 'P0001';
  end if;
  select v.version, v.prompt
    into v_versao, v_prompt
  from public.ai_agent_versions v
  where v.id = v_publicada;
  if v_versao is distinct from p_expected_source_version then
    raise exception 'versao_publicada_mudou' using errcode = 'P0001';
  end if;
  -- Uma versão antiga pode ter variável que deixou de ser aceita (rodada 1 do PLAN, achado 3), como o restaurar já
  -- confere (20261007120000_central_agentes_editor.sql).
  v_desconhecida := public.central_agentes_variavel_desconhecida(v_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;

  v_sha := encode(extensions.digest(v_prompt, 'sha256'), 'hex');
  insert into public.ai_agents
    (organization_id, name, draft, draft_revision, draft_updated_at, draft_updated_by, origin, created_by)
  values
    (p_organization_id, v_nome, jsonb_build_object('prompt', v_prompt), 1, now(), auth.uid(),
     jsonb_build_object(
       'kind', 'copy',
       'organizationId', p_source_organization_id,
       'agentId', p_source_agent_id,
       'version', v_versao,
       'sha256', v_sha,
       'promptSha256', v_sha
     ),
     auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_ai_agent_from_copy(uuid, text, uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.create_ai_agent_from_copy(uuid, text, uuid, uuid, integer) to authenticated;

-- Cria (id nulo) ou salva um modelo. Revisão inteira: trava, confere e sobe (achado 3 da rodada 1).
create or replace function public.save_ai_agent_template(
  p_template_id uuid,
  p_expected_revision integer,
  p_name text,
  p_description text,
  p_prompt text
)
returns table (out_id uuid, out_revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_descricao text;
  v_revisao integer;
  v_arquivado timestamptz;
  v_desconhecida text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  v_descricao := nullif(btrim(coalesce(p_description, '')), '');
  if v_descricao is not null and char_length(v_descricao) > 280 then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;
  if p_prompt is null or char_length(p_prompt) < 1 or char_length(p_prompt) > 50000 then
    raise exception 'prompt_invalido' using errcode = '22023';
  end if;
  v_desconhecida := public.central_agentes_variavel_desconhecida(p_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;

  if p_template_id is null then
    insert into public.ai_agent_templates (name, description, prompt, origin, revision, created_by, updated_by)
    values (v_nome, v_descricao, p_prompt, jsonb_build_object('kind', 'blank'), 1, auth.uid(), auth.uid())
    returning id into out_id;
    out_revision := 1;
    return next;
    return;
  end if;

  select t.revision, t.archived_at
    into v_revisao, v_arquivado
  from public.ai_agent_templates t
  where t.id = p_template_id
  for update;
  if not found then
    raise exception 'modelo_inexistente' using errcode = 'P0002';
  end if;
  if v_arquivado is not null then
    raise exception 'modelo_arquivado' using errcode = 'P0001';
  end if;
  if v_revisao is distinct from p_expected_revision then
    raise exception 'modelo_mudou' using errcode = 'P0001';
  end if;

  update public.ai_agent_templates
     set name = v_nome,
         description = v_descricao,
         prompt = p_prompt,
         revision = v_revisao + 1,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_template_id;
  out_id := p_template_id;
  out_revision := v_revisao + 1;
  return next;
end;
$$;

revoke all on function public.save_ai_agent_template(uuid, integer, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.save_ai_agent_template(uuid, integer, text, text, text) to authenticated;

-- Modelo novo a partir da versão publicada de um agente (o texto vai igual; a agência troca o que é do cliente por
-- lacunas na tela do modelo).
create or replace function public.create_ai_agent_template_from_agent(
  p_organization_id uuid,
  p_agent_id uuid,
  p_expected_version integer,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_descricao text;
  v_publicada uuid;
  v_versao integer;
  v_prompt text;
  v_desconhecida text;
  v_id uuid;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  v_descricao := nullif(btrim(coalesce(p_description, '')), '');
  if v_descricao is not null and char_length(v_descricao) > 280 then
    raise exception 'descricao_invalida' using errcode = '22023';
  end if;

  select a.published_version_id
    into v_publicada
  from public.ai_agents a
  where a.id = p_agent_id
    and a.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  if v_publicada is null then
    raise exception 'sem_versao_publicada' using errcode = 'P0001';
  end if;
  select v.version, v.prompt
    into v_versao, v_prompt
  from public.ai_agent_versions v
  where v.id = v_publicada;
  if v_versao is distinct from p_expected_version then
    raise exception 'versao_publicada_mudou' using errcode = 'P0001';
  end if;
  v_desconhecida := public.central_agentes_variavel_desconhecida(v_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;

  insert into public.ai_agent_templates (name, description, prompt, origin, revision, created_by, updated_by)
  values (
    v_nome, v_descricao, v_prompt,
    jsonb_build_object(
      'kind', 'agent',
      'organizationId', p_organization_id,
      'agentId', p_agent_id,
      'version', v_versao,
      'sha256', encode(extensions.digest(v_prompt, 'sha256'), 'hex')
    ),
    1, auth.uid(), auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_ai_agent_template_from_agent(uuid, uuid, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_ai_agent_template_from_agent(uuid, uuid, integer, text, text) to authenticated;

-- Arquiva ou restaura um modelo. Revisão inteira, como salvar.
create or replace function public.set_ai_agent_template_archived(
  p_template_id uuid,
  p_archived boolean,
  p_expected_revision integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revisao integer;
  v_arquivado timestamptz;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'pedido_invalido' using errcode = '22023';
  end if;

  select t.revision, t.archived_at
    into v_revisao, v_arquivado
  from public.ai_agent_templates t
  where t.id = p_template_id
  for update;
  if not found then
    raise exception 'modelo_inexistente' using errcode = 'P0002';
  end if;
  if v_revisao is distinct from p_expected_revision then
    raise exception 'modelo_mudou' using errcode = 'P0001';
  end if;
  if (v_arquivado is not null) = p_archived then
    raise exception 'sem_mudancas' using errcode = 'P0001';
  end if;

  update public.ai_agent_templates
     set archived_at = case when p_archived then now() else null end,
         revision = v_revisao + 1,
         updated_by = auth.uid(),
         updated_at = now()
   where id = p_template_id;
  return v_revisao + 1;
end;
$$;

revoke all on function public.set_ai_agent_template_archived(uuid, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.set_ai_agent_template_archived(uuid, boolean, integer) to authenticated;
