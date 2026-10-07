-- =============================================================================
-- CENTRAL DE AGENTES — fatia 2 (editor com versões e Publicar)
-- =============================================================================
-- SPEC: docs/features/central-de-agentes/SPEC.md, "Fatia 2" e "Decisões de desenho" (Rascunho; Publicar e
-- Restaurar). PLAN: docs/features/central-de-agentes/PLAN-fatia-2.md.
-- Três funções de escrita para a tela, chamadas pelas rotas COM O JWT DO USUÁRIO (createClient), nunca com
-- a chave de serviço: o papel é conferido aqui dentro (is_agency_admin_role: agency_admin e o legado admin)
-- e o autor vem de auth.uid(), nunca de parâmetro. Cada uma trava a linha do agente (FOR UPDATE) e só escreve
-- se a revisão do rascunho, e para publicar e restaurar também a versão publicada, forem as que a tela
-- mostrou; senão levanta um erro com nome, que a rota devolve como 409.
-- Erros (nome na mensagem; a rota traduz pela mensagem):
--   sem_permissao (42501) · agente_inexistente, versao_inexistente (P0002)
--   rascunho_mudou, versao_publicada_mudou, rascunho_vazio, sem_mudancas, versao_ja_publicada,
--   variavel_desconhecida (P0001; o nome da variável vai no detail)
--   prompt_invalido, nota_invalida (22023)
-- Só ADITIVA: nenhuma tabela, coluna ou dado muda. A versão nova copia settings e model da publicada (a fatia
-- 2 só edita o prompt; as fatias 4 e 5 abrem os outros campos com lista fechada).
-- VOLTA: docs/features/central-de-agentes/volta-fatia-2.sql.
-- =============================================================================

-- As 12 variáveis que o runtime troca (lib/conversations/aiReply.ts, objeto passado a renderPromptTemplate): a
-- mesma lista de lib/agents/verificarPrompt.ts (VARIAVEIS_DO_PROMPT), e o teste dela trava as duas iguais.
-- Devolve o primeiro marcador {{...}} cujo nome, sem espaço, tab e quebra de linha ASCII nas pontas (a mesma
-- regra da tela; um NBSP não é aparado em nenhum dos dois lados), não é uma delas; null quando todos
-- são. Publicar e restaurar chamam esta função antes de gravar: a regra que a tela mostra como erro vale também
-- para quem chamar a função direto, sem passar pela rota. Sem execute para ninguém: só as duas a usam.
create or replace function public.central_agentes_variavel_desconhecida(p_prompt text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select marcador.nome
  from (
    select regexp_replace(r.m[1], '^[ \t\r\n]+|[ \t\r\n]+$', '', 'g') as nome, r.ordem
    from regexp_matches(coalesce(p_prompt, ''), '\{\{([^{}]*)\}\}', 'g') with ordinality as r(m, ordem)
  ) marcador
  where marcador.nome <> all (array[
    'organizationName', 'contactName', 'contactPhone', 'currentDateTime', 'currentDateTimeLocal', 'timezone',
    'meetingHostName', 'meetingChannelText', 'conversationStageContext', 'recentMessagesText', 'calendarContext',
    'availableTagsContext'
  ])
  order by marcador.ordem
  limit 1
$$;

revoke all on function public.central_agentes_variavel_desconhecida(text) from public, anon, authenticated, service_role;

-- Salva o rascunho (nesta fatia, só o prompt) e devolve a revisão nova.
create or replace function public.save_ai_agent_draft(
  p_organization_id uuid,
  p_agent_id uuid,
  p_expected_revision integer,
  p_prompt text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revisao integer;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_prompt is null or char_length(p_prompt) < 1 or char_length(p_prompt) > 50000 then
    raise exception 'prompt_invalido' using errcode = '22023';
  end if;

  select a.draft_revision
    into v_revisao
  from public.ai_agents a
  where a.id = p_agent_id
    and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  if v_revisao is distinct from p_expected_revision then
    raise exception 'rascunho_mudou' using errcode = 'P0001';
  end if;

  update public.ai_agents
     set draft = jsonb_build_object('prompt', p_prompt),
         draft_revision = v_revisao + 1,
         draft_updated_at = now(),
         draft_updated_by = auth.uid(),
         updated_at = now()
   where id = p_agent_id;
  return v_revisao + 1;
end;
$$;

revoke all on function public.save_ai_agent_draft(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.save_ai_agent_draft(uuid, uuid, integer, text) to authenticated;

-- Publica o rascunho como versão N+1 e move o ponteiro, numa transação só. A rota já rodou a verificação ao
-- vivo sobre ESTE rascunho (mesma revisão); a trava e a conferência da revisão garantem que o publicado é o
-- verificado.
create or replace function public.publish_ai_agent_version(
  p_organization_id uuid,
  p_agent_id uuid,
  p_expected_version integer,
  p_expected_revision integer,
  p_note text
)
returns table (out_version integer, out_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publicada_id uuid;
  v_rascunho jsonb;
  v_revisao integer;
  v_versao_atual integer;
  v_prompt_atual text;
  v_settings jsonb;
  v_modelo text;
  v_prompt text;
  v_nota text;
  v_nova_id uuid;
  v_desconhecida text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nota := nullif(btrim(coalesce(p_note, '')), '');
  if v_nota is not null and char_length(v_nota) > 200 then
    raise exception 'nota_invalida' using errcode = '22023';
  end if;

  select a.published_version_id, a.draft, a.draft_revision
    into v_publicada_id, v_rascunho, v_revisao
  from public.ai_agents a
  where a.id = p_agent_id
    and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;

  v_versao_atual := 0;
  if v_publicada_id is not null then
    select v.version, v.prompt, v.settings, v.model
      into v_versao_atual, v_prompt_atual, v_settings, v_modelo
    from public.ai_agent_versions v
    where v.id = v_publicada_id;
  end if;
  if v_versao_atual is distinct from p_expected_version then
    raise exception 'versao_publicada_mudou' using errcode = 'P0001';
  end if;
  if v_revisao is distinct from p_expected_revision then
    raise exception 'rascunho_mudou' using errcode = 'P0001';
  end if;

  v_prompt := case when jsonb_typeof(v_rascunho -> 'prompt') = 'string' then v_rascunho ->> 'prompt' end;
  if v_prompt is null or char_length(v_prompt) < 1 or char_length(v_prompt) > 50000 then
    raise exception 'rascunho_vazio' using errcode = 'P0001';
  end if;
  v_desconhecida := public.central_agentes_variavel_desconhecida(v_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;
  if v_prompt_atual is not null and v_prompt = v_prompt_atual then
    raise exception 'sem_mudancas' using errcode = 'P0001';
  end if;

  insert into public.ai_agent_versions
    (agent_id, organization_id, version, prompt, settings, model, source, note, published_by)
  values
    (p_agent_id, p_organization_id, v_versao_atual + 1, v_prompt, coalesce(v_settings, '{}'::jsonb), v_modelo,
     'publish', v_nota, auth.uid())
  returning id into v_nova_id;

  update public.ai_agents
     set published_version_id = v_nova_id,
         updated_at = now()
   where id = p_agent_id;

  out_version := v_versao_atual + 1;
  out_version_id := v_nova_id;
  return next;
end;
$$;

revoke all on function public.publish_ai_agent_version(uuid, uuid, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.publish_ai_agent_version(uuid, uuid, integer, integer, text) to authenticated;

-- Restaura: publica o conteúdo (prompt, settings, model) da versão escolhida como versão N+1, com
-- source = 'restore' e restored_from, e passa esse texto para o rascunho. Sem isso, a tela mostraria
-- "Rascunho com mudanças" com o texto que acabou de sair, e um Publicar desfaria a restauração. A revisão
-- conferida garante que o rascunho descartado é o que a tela mostrou.
create or replace function public.restore_ai_agent_version(
  p_organization_id uuid,
  p_agent_id uuid,
  p_version integer,
  p_expected_version integer,
  p_expected_revision integer,
  p_note text
)
returns table (out_version integer, out_version_id uuid, out_draft_revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publicada_id uuid;
  v_revisao integer;
  v_versao_atual integer;
  v_prompt_atual text;
  v_settings_atual jsonb;
  v_modelo_atual text;
  v_prompt text;
  v_settings jsonb;
  v_modelo text;
  v_nota text;
  v_nova_id uuid;
  v_desconhecida text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nota := nullif(btrim(coalesce(p_note, '')), '');
  if v_nota is not null and char_length(v_nota) > 200 then
    raise exception 'nota_invalida' using errcode = '22023';
  end if;

  select a.published_version_id, a.draft_revision
    into v_publicada_id, v_revisao
  from public.ai_agents a
  where a.id = p_agent_id
    and a.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;

  v_versao_atual := 0;
  if v_publicada_id is not null then
    select v.version, v.prompt, v.settings, v.model
      into v_versao_atual, v_prompt_atual, v_settings_atual, v_modelo_atual
    from public.ai_agent_versions v
    where v.id = v_publicada_id;
  end if;
  if v_versao_atual is distinct from p_expected_version then
    raise exception 'versao_publicada_mudou' using errcode = 'P0001';
  end if;
  if v_revisao is distinct from p_expected_revision then
    raise exception 'rascunho_mudou' using errcode = 'P0001';
  end if;
  if p_version = v_versao_atual then
    raise exception 'versao_ja_publicada' using errcode = 'P0001';
  end if;

  select v.prompt, v.settings, v.model
    into v_prompt, v_settings, v_modelo
  from public.ai_agent_versions v
  where v.agent_id = p_agent_id
    and v.organization_id = p_organization_id
    and v.version = p_version;
  if not found then
    raise exception 'versao_inexistente' using errcode = 'P0002';
  end if;
  -- Uma versão antiga pode usar uma variável que saiu do runtime: publicá-la de novo deixaria o marcador cru.
  v_desconhecida := public.central_agentes_variavel_desconhecida(v_prompt);
  if v_desconhecida is not null then
    raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida;
  end if;
  -- Restaurar um conteúdo igual ao publicado só criaria uma versão repetida no histórico.
  if v_prompt = v_prompt_atual and v_settings = v_settings_atual and v_modelo is not distinct from v_modelo_atual then
    raise exception 'sem_mudancas' using errcode = 'P0001';
  end if;

  insert into public.ai_agent_versions
    (agent_id, organization_id, version, prompt, settings, model, source, restored_from, note, published_by)
  values
    (p_agent_id, p_organization_id, v_versao_atual + 1, v_prompt, v_settings, v_modelo,
     'restore', p_version, v_nota, auth.uid())
  returning id into v_nova_id;

  update public.ai_agents
     set published_version_id = v_nova_id,
         draft = jsonb_build_object('prompt', v_prompt),
         draft_revision = v_revisao + 1,
         draft_updated_at = now(),
         draft_updated_by = auth.uid(),
         updated_at = now()
   where id = p_agent_id;

  out_version := v_versao_atual + 1;
  out_version_id := v_nova_id;
  out_draft_revision := v_revisao + 1;
  return next;
end;
$$;

revoke all on function public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text) to authenticated;
