-- =============================================================================
-- CENTRAL DE AGENTES — fatia 1 (fundação)
-- =============================================================================
-- SPEC: docs/features/central-de-agentes/SPEC.md (aprovada pelo Junior em 29/09/2026).
-- O agente de IA vira cadastro do cliente (ai_agents) com versões publicadas imutáveis
-- (ai_agent_versions). O número aponta para o agente em channel_connections.ai_agent_id;
-- NULO = caminho de hoje, byte a byte. Toda resposta nativa entregue grava um evento de
-- prova (ai_reply_events), que a migração do prompt de hoje confere antes de ligar um número.
--
-- Só ADITIVA: não reescreve config de conexão e não remove nada. Escrita nas tabelas
-- novas só por função security definer ou pela chave de serviço; leitura das tabelas do
-- agente só da agência (agency_admin/admin); o evento, só a chave de serviço.
-- ORDEM DE PUBLICAÇÃO: esta migration entra em produção ANTES do deploy do código,
-- porque a leitura da conexão passa a pedir a coluna ai_agent_id.
-- VOLTA: docs/features/central-de-agentes/volta-fatia-1.sql (depois de tirar o código do ar).
-- =============================================================================

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  published_version_id uuid null,
  draft jsonb not null default '{}'::jsonb,
  -- Sobe a cada salvamento do rascunho (fatia 2): publicar confere a revisão que foi testada.
  draft_revision integer not null default 0,
  draft_updated_at timestamptz null,
  draft_updated_by uuid null references public.profiles(id) on delete set null,
  origin jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_agents_name_chk check (char_length(btrim(name)) between 1 and 80),
  constraint ai_agents_draft_is_object_chk check (jsonb_typeof(draft) = 'object'),
  constraint ai_agents_draft_revision_chk check (draft_revision >= 0),
  constraint ai_agents_origin_is_object_chk check (jsonb_typeof(origin) = 'object'),
  constraint ai_agents_org_id_unique unique (organization_id, id)
);

-- Idempotência da migração garantida pelo banco, não só pela função: um prompt (sha256) vira no
-- máximo um agente de migração por organização.
create unique index if not exists ai_agents_migration_origin_unique
  on public.ai_agents (organization_id, (origin ->> 'sha256'))
  where origin ->> 'kind' = 'migration';

create table if not exists public.ai_agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  organization_id uuid not null,
  version integer not null,
  prompt text not null,
  settings jsonb not null default '{}'::jsonb,
  model text null,
  source text not null,
  restored_from integer null,
  note text null,
  published_by uuid null references public.profiles(id) on delete set null,
  published_at timestamptz not null default now(),
  constraint ai_agent_versions_version_chk check (version >= 1),
  constraint ai_agent_versions_prompt_chk check (char_length(prompt) between 1 and 50000),
  constraint ai_agent_versions_settings_is_object_chk check (jsonb_typeof(settings) = 'object'),
  constraint ai_agent_versions_model_chk check (model is null or char_length(model) between 1 and 120),
  constraint ai_agent_versions_source_chk check (source in ('migration', 'publish', 'restore')),
  constraint ai_agent_versions_note_chk check (note is null or char_length(note) <= 200),
  constraint ai_agent_versions_agent_fk foreign key (organization_id, agent_id)
    references public.ai_agents (organization_id, id) on delete cascade,
  constraint ai_agent_versions_agent_version_unique unique (agent_id, version),
  constraint ai_agent_versions_org_agent_id_unique unique (organization_id, agent_id, id)
);

-- A versão publicada tem que ser do próprio agente (e da mesma organização).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_agents_published_version_fk') then
    alter table public.ai_agents
      add constraint ai_agents_published_version_fk
      foreign key (organization_id, id, published_version_id)
      references public.ai_agent_versions (organization_id, agent_id, id);
  end if;
end $$;

-- Número → agente. `no action`: agente com número ligado não se apaga (desliga-se antes). Com
-- `set null`, apagar o agente devolveria o número em silêncio ao prompt antigo. A checagem roda
-- depois das cascatas do mesmo comando, então apagar a organização inteira continua funcionando
-- (mesmo padrão das FKs compostas do funil, 20260718010000_funil_f2_publication.sql).
-- Agente de outra organização: é esta FK que recusa (23503).
alter table public.channel_connections
  add column if not exists ai_agent_id uuid null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'channel_connections_ai_agent_fk') then
    alter table public.channel_connections
      add constraint channel_connections_ai_agent_fk
      foreign key (organization_id, ai_agent_id)
      references public.ai_agents (organization_id, id)
      on delete no action;
  end if;
end $$;

create index if not exists channel_connections_ai_agent_id_idx
  on public.channel_connections (ai_agent_id)
  where ai_agent_id is not null;

-- Ligar exige versão publicada (G25 da SPEC, invariante G20): nunca responder com agente vazio.
-- A organização NÃO é conferida aqui: agente de outra organização cai na FK composta acima (23503),
-- e este gatilho fica só com o caso "agente sem versão publicada" (P0001).
create or replace function public.enforce_channel_connection_ai_agent_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_agent_id is not null then
    if not exists (
      select 1
      from public.ai_agents a
      where a.id = new.ai_agent_id
        and a.published_version_id is not null
    ) then
      raise exception 'ai_agent_not_published' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_channel_connection_ai_agent_published() from public, anon, authenticated;

drop trigger if exists channel_connections_ai_agent_published on public.channel_connections;
create trigger channel_connections_ai_agent_published
  before insert or update of ai_agent_id on public.channel_connections
  for each row execute function public.enforce_channel_connection_ai_agent_published();

-- Versão não muda depois de gravada. Só UPDATE é recusado: recusar DELETE travaria a cascata de apagar
-- um agente sem número e de apagar a organização. A versão publicada é protegida pela FK do ponteiro, e
-- os papéis comuns não escrevem nem apagam (GRANT); a chave de serviço ainda apaga versão antiga não
-- publicada. A única mudança aceita é zerar o autor: apagar o usuário que publicou faz o Postgres rodar
-- `update ... set published_by = null` (FK on delete set null), e recusar isso travaria a exclusão dele.
create or replace function public.prevent_ai_agent_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.published_by is null
     and (to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by') then
    return new;
  end if;
  raise exception 'ai_agent_version_immutable' using errcode = 'P0001';
end;
$$;

revoke all on function public.prevent_ai_agent_version_update() from public, anon, authenticated;

drop trigger if exists ai_agent_versions_immutable on public.ai_agent_versions;
create trigger ai_agent_versions_immutable
  before update on public.ai_agent_versions
  for each row execute function public.prevent_ai_agent_version_update();

-- RLS: leitura só da agência. Nenhuma policy de escrita: só funções security definer escrevem.
alter table public.ai_agents enable row level security;
alter table public.ai_agent_versions enable row level security;

drop policy if exists "ai_agents_select_agencia" on public.ai_agents;
create policy "ai_agents_select_agencia"
  on public.ai_agents for select
  to authenticated
  using (public.is_agency_admin_role());

drop policy if exists "ai_agent_versions_select_agencia" on public.ai_agent_versions;
create policy "ai_agent_versions_select_agencia"
  on public.ai_agent_versions for select
  to authenticated
  using (public.is_agency_admin_role());

-- GRANT explícito (RLS só restringe; sem grant a tela quebra com permission denied).
revoke all on table public.ai_agents from anon, authenticated;
revoke all on table public.ai_agent_versions from anon, authenticated;
grant select on table public.ai_agents to authenticated;
grant select on table public.ai_agent_versions to authenticated;
grant all on table public.ai_agents to service_role;
grant all on table public.ai_agent_versions to service_role;

-- Evento de prova (2ª rodada do Codex, achados 1, 3 e 5): uma linha por resposta nativa ENTREGUE,
-- gravada só pelo caminho nativo (webhook → executeConversationAIReply), com a chave de serviço. As
-- rotas manual e do n8n gravam mensagem com metadata livre, mas não escrevem aqui; por isso a prova
-- da migração lê esta tabela, e não o metadata das mensagens.
--  - delivered_at: hora em que a última parte foi aceita pela Evolution (o sent_at da mensagem é
--    fixado ANTES do envio, e envios simultâneos podem terminar em ordem inversa);
--  - release_commit: VERCEL_GIT_COMMIT_SHA da publicação que respondeu (nulo fora da Vercel);
--  - release_deployment: VERCEL_DEPLOYMENT_ID do deployment que respondeu (nulo fora da Vercel). Um
--    redeploy do mesmo commit é outro deployment, e pode ter outras variáveis de ambiente; e um evento
--    gravado NESTE banco pelo deployment D prova que D lê e escreve neste banco (4ª rodada, achado 12);
--  - prompt_key: a chave que o runtime usou; é o que prende a prova à configuração de hoje.
create table if not exists public.ai_reply_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  channel_connection_id uuid not null,
  thread_id uuid not null,
  prompt_sha256 text not null,
  prompt_key text null,
  prompt_source text not null,
  agent_id uuid null,
  agent_version integer null,
  release_commit text null,
  release_deployment text null,
  delivered_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ai_reply_events_sha_chk check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_reply_events_source_chk check (prompt_source in ('agent', 'override', 'default')),
  -- Resposta pelo agente tem agente e versão; resposta pelo caminho de hoje tem a chave que usou.
  constraint ai_reply_events_agent_chk check (
    (prompt_source = 'agent') = (agent_id is not null)
    and (agent_id is null) = (agent_version is null)
  ),
  constraint ai_reply_events_key_chk check (
    (prompt_source = 'agent' or prompt_key is not null)
    and (prompt_key is null or prompt_key ~ '^task_[a-z0-9_]{1,115}$')
  ),
  constraint ai_reply_events_release_chk check (release_commit is null or release_commit ~ '^[0-9a-f]{40}$'),
  constraint ai_reply_events_deployment_chk check (release_deployment is null or release_deployment ~ '^dpl_[A-Za-z0-9]{1,64}$'),
  -- Mesma organização do número e da conversa (achado 3): evento de uma organização apontando para
  -- número ou conversa de outra é recusado (23503). As duas chaves únicas (organization_id, id) já
  -- existem (20260718010000_funil_f2_publication.sql).
  constraint ai_reply_events_connection_fk foreign key (organization_id, channel_connection_id)
    references public.channel_connections (organization_id, id) on delete cascade,
  constraint ai_reply_events_thread_fk foreign key (organization_id, thread_id)
    references public.conversation_threads (organization_id, id) on delete cascade
);

create index if not exists ai_reply_events_prova_idx
  on public.ai_reply_events (channel_connection_id, delivered_at desc, id desc)
  where agent_id is null;

-- Só a chave de serviço lê e escreve (G13): nenhuma policy e nenhum grant para os papéis comuns.
alter table public.ai_reply_events enable row level security;
revoke all on table public.ai_reply_events from anon, authenticated;
revoke all on sequence public.ai_reply_events_id_seq from anon, authenticated;
grant all on table public.ai_reply_events to service_role;

-- Migração do prompt de hoje (script scripts/central-agentes/migrar-agentes.ts, service_role).
-- Idempotente pelo sha256 do conteúdo; confere que o sha256 recebido é o do prompt gravado.
create or replace function public.create_ai_agent_from_legacy_prompt(
  p_organization_id uuid,
  p_name text,
  p_prompt text,
  p_origin jsonb
)
returns table (out_agent_id uuid, out_version_id uuid, out_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sha text;
  v_agent_id uuid;
  v_version_id uuid;
begin
  v_sha := p_origin ->> 'sha256';
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'origin_sha256_required' using errcode = 'P0001';
  end if;
  if encode(extensions.digest(p_prompt, 'sha256'), 'hex') <> v_sha then
    raise exception 'origin_sha256_mismatch' using errcode = 'P0001';
  end if;

  -- Serializa por (organização, sha) (2ª rodada do Codex, achado 8): duas chamadas simultâneas não
  -- passam as duas pela busca vazia. A segunda espera a primeira terminar e, com o READ COMMITTED,
  -- a busca abaixo já enxerga o agente dela.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_sha, 0));

  select a.id, a.published_version_id
    into v_agent_id, v_version_id
  from public.ai_agents a
  where a.organization_id = p_organization_id
    and a.origin ->> 'kind' = 'migration'
    and a.origin ->> 'sha256' = v_sha
  limit 1;

  if v_agent_id is not null then
    out_agent_id := v_agent_id;
    out_version_id := v_version_id;
    out_created := false;
    return next;
    return;
  end if;

  insert into public.ai_agents (organization_id, name, origin)
  values (p_organization_id, p_name, p_origin || jsonb_build_object('kind', 'migration'))
  returning id into v_agent_id;

  insert into public.ai_agent_versions (agent_id, organization_id, version, prompt, settings, model, source)
  values (v_agent_id, p_organization_id, 1, p_prompt, '{}'::jsonb, null, 'migration')
  returning id into v_version_id;

  update public.ai_agents
     set published_version_id = v_version_id,
         updated_at = now()
   where id = v_agent_id;

  out_agent_id := v_agent_id;
  out_version_id := v_version_id;
  out_created := true;
  return next;
end;
$$;

revoke all on function public.create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb) to service_role;

-- Prova da migração (2ª rodada do Codex, achados 1, 3 e 5): o ÚLTIMO EVENTO de prova do número pelo
-- caminho de hoje (sem agente), pela hora em que a entrega terminou. Lê só ai_reply_events: mensagem
-- manual ou do n8n não entra, com o metadata que tiver. Resposta dada por um agente (número ligado e
-- depois desligado) não prova o caminho de hoje. As FKs compostas do evento garantem que ele é da
-- organização do número e da conversa.
-- Não é "a última resposta entregue": uma resposta cujo registro falhou não tem evento. A prova do TEXTO
-- não depende disso (3ª rodada, achado 5): o evento é uma testemunha de que A PUBLICAÇÃO R, com a chave K
-- e a origem O (padrão ou override), chega ao texto de sha S. Para o padrão isso só depende de R e de K;
-- para o override, a ligação confere o conteúdo ativo direto. E a ligação confere de novo, na hora, a
-- publicação, a chave e o override.
create or replace function public.central_agentes_ultima_resposta_nativa(p_connection_id uuid)
returns table (out_sha256 text, out_prompt_key text, out_prompt_source text, out_release_commit text, out_release_deployment text, out_delivered_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.prompt_sha256, e.prompt_key, e.prompt_source, e.release_commit, e.release_deployment, e.delivered_at
  from public.ai_reply_events e
  where e.channel_connection_id = p_connection_id
    and e.agent_id is null
  order by e.delivered_at desc, e.id desc
  limit 1;
$$;

revoke all on function public.central_agentes_ultima_resposta_nativa(uuid) from public, anon, authenticated;
grant execute on function public.central_agentes_ultima_resposta_nativa(uuid) to service_role;

-- Liga o número ao agente numa transação só, conferindo de novo o que o script conferiu (revisão do
-- Codex, achado 13; 2ª rodada, achados 2, 4 e 7):
--  - a chave bruta da conexão, e a efetiva pela mesma regra do runtime (resolveConversationAIAgentConfig);
--  - o override, com a tabela de prompts travada contra escrita até o fim: FOR SHARE protegeria a linha
--    que existe, mas não a AUSÊNCIA de linha;
--  - a versão publicada do agente, com a linha do agente travada (FOR SHARE): o ponteiro não muda entre a
--    conferência e a ligação;
--  - o último evento de prova do caminho de hoje: mesma publicação (commit E deployment) que o script
--    conferiu nos domínios, mesma chave efetiva, mesma origem (padrão ou override) e mesmo sha.
-- Qualquer diferença recusa, com o motivo.
create or replace function public.central_agentes_ligar_conexao(
  p_connection_id uuid,
  p_agent_id uuid,
  p_chave_bruta text,
  p_prompt_key text,
  p_prompt_source text,
  p_sha256 text,
  p_publicacao text,
  p_deployment text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_config jsonb;
  v_agente_atual uuid;
  v_chave_bruta text;
  v_chave_efetiva text;
  v_versao_publicada uuid;
  v_versao_sha text;
  v_prova_sha text;
  v_prova_chave text;
  v_prova_origem text;
  v_prova_publicacao text;
  v_prova_deployment text;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return 'sha_invalido';
  end if;
  if p_publicacao is null or p_publicacao !~ '^[0-9a-f]{40}$'
     or p_deployment is null or p_deployment !~ '^dpl_[A-Za-z0-9]{1,64}$' then
    return 'publicacao_invalida';
  end if;

  -- Primeiro comando: espera qualquer escrita de override em andamento terminar e segura as próximas
  -- até o fim desta transação. Leitura continua livre; a ligação dura milissegundos, uma por vez.
  lock table public.ai_prompt_templates in share row exclusive mode;

  select c.organization_id, c.config, c.ai_agent_id
    into v_org, v_config, v_agente_atual
  from public.channel_connections c
  where c.id = p_connection_id
  for update;
  if not found then
    return 'conexao_inexistente';
  end if;
  if v_agente_atual is not null then
    return 'ja_ligada';
  end if;

  v_chave_bruta := case when jsonb_typeof(v_config -> 'aiPromptKey') = 'string' then v_config ->> 'aiPromptKey' end;
  if v_chave_bruta is distinct from p_chave_bruta then
    return 'chave_mudou';
  end if;
  -- Espelho de resolveConversationAIAgentConfig (lib/conversations/aiAgentConfig.ts): a chave aparada, ou
  -- a padrão quando vazia. A validade da chave no catálogo fica com o script; aqui, a chave que respondeu
  -- na produção (conferida no fim) prende a prova à configuração de hoje. Espaço fora do comum no começo
  -- ou no fim da chave faz o banco e o código divergirem, e aí a ligação é recusada, nunca feita errada.
  v_chave_efetiva := coalesce(nullif(btrim(v_chave_bruta), ''), 'task_conversations_whatsapp_auto_reply');
  if v_chave_efetiva is distinct from p_prompt_key then
    return 'chave_efetiva_diverge';
  end if;

  if p_prompt_source = 'default' then
    if exists (
      select 1
      from public.ai_prompt_templates t
      where t.organization_id = v_org
        and t.key = v_chave_efetiva
        and t.is_active
        and t.content <> ''
    ) then
      return 'override_mudou';
    end if;
  elsif p_prompt_source = 'override' then
    if not exists (
      select 1
      from public.ai_prompt_templates t
      where t.organization_id = v_org
        and t.key = v_chave_efetiva
        and t.is_active
        and encode(extensions.digest(t.content, 'sha256'), 'hex') = p_sha256
    ) then
      return 'override_mudou';
    end if;
  else
    return 'origem_invalida';
  end if;

  -- A linha do agente fica travada (FOR SHARE): publicar outra versão espera esta transação acabar, e o
  -- ponteiro lido aqui é o que vale na hora de ligar. Dois passos, para o ponteiro travado ser o mesmo
  -- que escolhe a versão conferida.
  select a.published_version_id
    into v_versao_publicada
  from public.ai_agents a
  where a.id = p_agent_id
    and a.organization_id = v_org
  for share;
  if not found or v_versao_publicada is null then
    return 'versao_publicada_diverge';
  end if;
  select encode(extensions.digest(v.prompt, 'sha256'), 'hex')
    into v_versao_sha
  from public.ai_agent_versions v
  where v.id = v_versao_publicada
    and v.agent_id = p_agent_id
    and v.organization_id = v_org;
  if v_versao_sha is distinct from p_sha256 then
    return 'versao_publicada_diverge';
  end if;

  select r.out_sha256, r.out_prompt_key, r.out_prompt_source, r.out_release_commit, r.out_release_deployment
    into v_prova_sha, v_prova_chave, v_prova_origem, v_prova_publicacao, v_prova_deployment
  from public.central_agentes_ultima_resposta_nativa(p_connection_id) r;
  if not found then
    return 'prova_nao_confere';
  end if;
  -- O evento tem que ter vindo do MESMO deployment que os domínios servem (commit e id): um redeploy do
  -- mesmo commit pode ter outras variáveis de ambiente (4ª rodada, achado 12).
  if v_prova_publicacao is distinct from p_publicacao or v_prova_deployment is distinct from p_deployment then
    return 'publicacao_diverge';
  end if;
  -- A testemunha tem que ser do MESMO caso (3ª rodada do Codex, achado 5): mesma chave, mesma origem e
  -- mesmo sha. Com a origem igual, "a publicação R, com a chave K, sem override, usa o texto de sha S" não
  -- depende de quando o evento foi gravado. Um evento de override com o mesmo sha não prova o padrão.
  if v_prova_chave is distinct from v_chave_efetiva
     or v_prova_origem is distinct from p_prompt_source
     or v_prova_sha is distinct from p_sha256 then
    return 'prova_nao_confere';
  end if;

  update public.channel_connections
     set ai_agent_id = p_agent_id
   where id = p_connection_id;
  return 'ligado';
end;
$$;

revoke all on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text, text) to service_role;
