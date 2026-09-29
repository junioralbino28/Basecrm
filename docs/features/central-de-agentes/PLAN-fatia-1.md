# Central de Agentes, fatia 1 (fundação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar o cadastro de agente (`ai_agents` + `ai_agent_versions`) e fazer o atendimento de WhatsApp usar o prompt da versão publicada quando o número tem agente, com o resto do caminho byte a byte igual. Toda resposta nativa passa a gravar o sha256 do prompt usado, e o script de migração só cria e liga um agente quando o sha que ele calcula bate com o que a produção gravou.

**Architecture:**
- **Banco:** duas tabelas novas com RLS (leitura só da agência) e escrita só por função `security definer`. A coluna `channel_connections.ai_agent_id` entra com FK composta por organização, `on delete no action` (agente ligado não se apaga), e um gatilho que só aceita agente publicado. Outro gatilho recusa `update` em versão, exceto zerar o autor.
- **Resposta:** `generateConversationAutoReply` lê a versão publicada logo depois do portão da IA. Troca só a fonte do prompt (e o modelo, se a versão tiver um) e devolve o sha256 do texto usado. Chave de prompt nula sem agente vira `missing_prompt`, nunca o prompt padrão. O webhook grava `prompt_sha256` em toda resposta nativa e `agent_id`/`agent_version` só com agente.
- **Rastro protegido:** a rota do n8n descarta do metadata externo as chaves de rastro nativo, para ninguém forjar a prova.
- **Prova e ligação no banco:** uma função escolhe a última resposta nativa entregue do número, entre todas as conversas dele. Outra liga o número numa transação só, conferindo de novo a chave, o override, a versão publicada e essa resposta. O script só roda da cópia no commit publicado e usa a leitura estrita (erro de banco aborta).

**Tech Stack:** Next.js (rotas em `app/`), Supabase Postgres 15 (migrations em `supabase/migrations`), supabase-js, AI SDK (`ai`), Vitest (+ Supabase local via `npm run test:local`), TypeScript. O script roda com `npx --yes tsx@4.23.1` (versão já no cache do npx desta máquina; sem `--yes`, o npx para esperando confirmação).

**SPEC:** `docs/features/central-de-agentes/SPEC.md` (aprovada em 29/09/2026, com a revisão adversarial interna e a revisão do Codex integradas). Levantamentos com arquivo:linha em `docs/features/central-de-agentes/levantamento/`, incluindo `revisao-adversarial-fatia-1.md`.

**Regras do projeto que valem aqui:**
- Nunca rodar teste, migration ou script contra o banco de produção sem o OK do Junior.
- Nunca dar push nem deploy sem o OK dele.
- Ler o resultado da suíte num comando **separado** antes de cada commit, e conferir o `git diff --stat` (fim de linha no Windows).
- Segredo nunca impresso nem commitado.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260930000000_central_agentes_fundacao.sql` | Criar | Tabelas, FKs compostas, gatilhos, RLS/GRANT, funções da migração (criar agente, última resposta nativa, ligar) |
| `docs/features/central-de-agentes/volta-fatia-1.sql` | Criar | Volta da migration (G23), provada no banco local |
| `test/centralAgentesFundacaoMigration.test.ts` | Criar | Prova do texto da migration (sem banco) |
| `test/centralAgentesFundacao.local.test.ts` | Criar | Prova no Supabase local: FKs, gatilhos, cascata, idempotência, matriz de acesso, prova e ligação |
| `test/helpers/fakeSupabaseAdmin.ts` | Modificar | Banco falso: projeção do `select` e limite de linhas (opcionais), `.not`, resposta de RPC por argumento |
| `test/helpers/fakeSupabaseAdmin.test.ts` | Criar | O que o banco falso passa a imitar |
| `lib/ai/prompts/resolve.ts` | Criar | Resolução pura do prompt (override ativo → catálogo) e a variante estrita, sem `server-only` |
| `lib/ai/prompts/resolve.test.ts` | Criar | Regras da resolução |
| `lib/ai/prompts/server.ts` | Modificar | `getResolvedPrompt` delega para `resolve.ts` (comportamento igual) |
| `lib/conversations/conversationAIGate.ts` | Modificar | Leitura da conexão traz `ai_agent_id` |
| `lib/conversations/conversationAIGate.agente.test.ts` | Criar | O portão devolve `ai_agent_id` |
| `lib/agents/agentRuntime.ts` | Criar | Carrega a versão publicada de um agente da organização |
| `lib/agents/agentRuntime.test.ts` | Criar | Casos de leitura |
| `lib/conversations/aiReply.ts` | Modificar | Usa a versão do agente (prompt, modelo, origem); chave nula sem agente = `missing_prompt`; devolve o sha256 do prompt |
| `lib/conversations/aiReply.agente.test.ts` | Criar | Caminho do agente, caminho de hoje e a chave nula |
| `lib/conversations/aiReply.equivalencia.test.ts` | Criar | Prompt enviado ao modelo e sha idênticos, legado × agente |
| `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` | Modificar | Guarda do prompt, chave nula, falha `agent_unavailable`, `prompt_sha256` e agente no metadata |
| `app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts` | Criar | O webhook com e sem agente |
| `lib/conversations/conversationDeliveryMetadata.ts` | Modificar | Lista e limpeza das chaves de rastro nativo |
| `lib/conversations/conversationDeliveryMetadata.test.ts` | Modificar | A limpeza tira só as chaves de rastro |
| `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts` | Modificar | A rota do n8n limpa o metadata externo |
| `app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts` | Criar | A rota do n8n não grava rastro nativo |
| `lib/agents/migracaoAgentes.ts` | Criar | Prova contra a produção, planejar (paginado), criar, ligar (pela função do banco) e desligar (com confirmação) |
| `lib/agents/migracaoAgentes.test.ts` | Criar | Regras da migração |
| `scripts/central-agentes/migrar-agentes.ts` | Criar | Linha de comando `--prova/--criar/--ligar/--desligar`, com a trava da versão publicada |

---

## Preparação (antes da Task 1)

O worktree `Basecrm-worktrees/central-agentes` nasceu sem `node_modules`: nenhum teste roda nele antes disto.

- [ ] **Step 1: Instalar as dependências do lock**

Run: `npm ci`
Expected: termina sem erro (o `package-lock.json` está no worktree).

- [ ] **Step 2: Linha de base da suíte, antes de mudar qualquer código**

Run: `npm run test:run 2>&1 | tail -15`
Expected: anotar a contagem de testes e de falhas. Toda falha que aparecer depois tem que estar nesta lista ou ser explicada.

- [ ] **Step 3: Conferir o fim de linha**

Run: `git config core.autocrlf`
Expected: `false`. Com `true`, o checkout reescreve a árvore em CRLF e quebra os testes que leem arquivo.

---

### Task 1: Migration da fundação + prova do texto

**Files:**
- Create: `supabase/migrations/20260930000000_central_agentes_fundacao.sql`
- Test: `test/centralAgentesFundacaoMigration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Central de Agentes, fatia 1 (SPEC docs/features/central-de-agentes/SPEC.md). As provas leem os
 * CORPOS $$...$$ das funções quando o assunto é a lógica, e o arquivo quando é DDL. O comentário
 * do topo cita palavras como "drop" e "delete"; por isso as travas de destrutividade miram comandos.
 */
const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20260930000000_central_agentes_fundacao.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

function corposDasFuncoes(texto: string): string[] {
  return [...texto.matchAll(/as \$\$([\s\S]*?)\$\$;/g)].map((m) => m[1]);
}

describe('migration da fundação da Central de Agentes', () => {
  it('existe', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
  });

  it('o detector de corpo acha as cinco funções (caso positivo)', () => {
    expect(corposDasFuncoes(sql)).toHaveLength(5);
  });

  it('cria as duas tabelas com a FK composta por organização e a revisão do rascunho', () => {
    expect(semComentarios).toContain('create table if not exists public.ai_agents (');
    expect(semComentarios).toContain('create table if not exists public.ai_agent_versions (');
    expect(semComentarios).toContain('constraint ai_agents_org_id_unique unique (organization_id, id)');
    expect(semComentarios).toMatch(/foreign key \(organization_id, agent_id\)\s+references public\.ai_agents \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toContain('draft_revision integer not null default 0');
  });

  it('a versão publicada tem que ser do próprio agente', () => {
    expect(semComentarios).toMatch(/foreign key \(organization_id, id, published_version_id\)\s+references public\.ai_agent_versions \(organization_id, agent_id, id\)/);
  });

  it('liga o número por FK composta e não deixa apagar agente ligado', () => {
    expect(semComentarios).toContain('add column if not exists ai_agent_id uuid null');
    expect(semComentarios).toMatch(/foreign key \(organization_id, ai_agent_id\)\s+references public\.ai_agents \(organization_id, id\)\s+on delete no action/);
    expect(semComentarios).not.toMatch(/set null \(ai_agent_id\)/);
  });

  it('RLS ligada, leitura só da agência, nenhuma policy de escrita', () => {
    expect(semComentarios).toContain('alter table public.ai_agents enable row level security;');
    expect(semComentarios).toContain('alter table public.ai_agent_versions enable row level security;');
    const policies = [...semComentarios.matchAll(/create policy "[^"]+"\s+on public\.(ai_agents|ai_agent_versions) for (\w+)/g)];
    expect(policies).toHaveLength(2);
    for (const p of policies) expect(p[2]).toBe('select');
    expect(semComentarios.match(/using \(public\.is_agency_admin_role\(\)\)/g)).toHaveLength(2);
  });

  it('GRANT explícito: authenticated só lê, service_role tudo', () => {
    expect(semComentarios).toContain('revoke all on table public.ai_agents from anon, authenticated;');
    expect(semComentarios).toContain('revoke all on table public.ai_agent_versions from anon, authenticated;');
    expect(semComentarios).toContain('grant select on table public.ai_agents to authenticated;');
    expect(semComentarios).toContain('grant select on table public.ai_agent_versions to authenticated;');
    expect(semComentarios).toContain('grant all on table public.ai_agents to service_role;');
    expect(semComentarios).toContain('grant all on table public.ai_agent_versions to service_role;');
  });

  it('as funções que leem ou escrevem têm cabeçalho de segurança; nenhuma fica aberta a public', () => {
    expect(semComentarios.match(/security definer\s*\nset search_path = ''/g)).toHaveLength(4);
    for (const assinatura of [
      'enforce_channel_connection_ai_agent_published()',
      'prevent_ai_agent_version_update()',
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
    }
    for (const assinatura of [
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
  });

  it('a migração confere o sha256 do prompt e é idempotente na função e no banco', () => {
    const [, , criar] = corposDasFuncoes(sql);
    expect(criar).toContain("extensions.digest(p_prompt, 'sha256')");
    expect(criar).toContain("raise exception 'origin_sha256_mismatch'");
    expect(criar).toContain("a.origin ->> 'sha256' = v_sha");
    expect(semComentarios).toContain('create unique index if not exists ai_agents_migration_origin_unique');
  });

  it('o gatilho da conexão só cuida de agente sem versão; a organização fica com a FK composta (23503)', () => {
    const [gatilho] = corposDasFuncoes(sql);
    expect(gatilho).toContain('a.published_version_id is not null');
    expect(gatilho).not.toContain('a.organization_id');
    expect(semComentarios).toContain('before insert or update of ai_agent_id on public.channel_connections');
  });

  it('versão é imutável: o gatilho recusa update, exceto zerar o autor, e não recusa delete (senão travaria a cascata)', () => {
    const [, versoes] = corposDasFuncoes(sql);
    expect(versoes).toContain("raise exception 'ai_agent_version_immutable'");
    // Apagar o usuário que publicou faz o Postgres rodar `update ... set published_by = null` (FK on delete
    // set null). Sem esta exceção, o gatilho travaria a exclusão do usuário.
    expect(versoes).toContain("(to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by')");
    expect(semComentarios).toContain('before update on public.ai_agent_versions');
    expect(semComentarios).not.toMatch(/before (update or delete|delete) on public\.ai_agent_versions/);
  });

  it('a prova lê a última resposta nativa ENTREGUE do número, uma linha por resposta, sem voltar para trás', () => {
    const [, , , ultima] = corposDasFuncoes(sql);
    expect(ultima).toContain('t.channel_connection_id = p_connection_id');
    expect(ultima).toContain("m.metadata ->> 'automation_source' = 'native_crm'");
    expect(ultima).toContain("m.metadata ->> 'native_ai' = 'true'");
    expect(ultima).toContain("m.metadata ->> 'delivery_status' = 'sent'");
    expect(ultima).toContain("coalesce(m.metadata ->> 'reply_part_index', '0') = '0'");
    expect(ultima).toContain('order by m.sent_at desc, m.created_at desc, m.id desc');
    // O sha é validado no resultado, não no filtro: resposta mais nova sem sha devolve sha nulo (falha
    // fechada) em vez de a função pular para uma resposta anterior que tenha sha.
    expect(ultima).not.toMatch(/where[\s\S]*prompt_sha256[\s\S]*order by/);
  });

  it('ligar confere tudo de novo numa transação só, com a linha do número travada', () => {
    const [, , , , ligar] = corposDasFuncoes(sql);
    expect(ligar).toMatch(/from public\.channel_connections c\s+where c\.id = p_connection_id\s+for update;/);
    expect(ligar).toContain("return 'chave_mudou'");
    expect(ligar).toContain("return 'override_mudou'");
    expect(ligar).toContain("return 'versao_publicada_diverge'");
    expect(ligar).toContain('public.central_agentes_ultima_resposta_nativa(p_connection_id)');
    expect(ligar).toContain("return 'prova_nao_confere'");
    expect(ligar).toContain("return 'ligado'");
  });

  it('não é destrutiva, e o único update em conexão é o do ai_agent_id, dentro da função de ligar', () => {
    expect(semComentarios).not.toMatch(/\bdrop\s+table\b/i);
    expect(semComentarios).not.toMatch(/\bdrop\s+function\b/i);
    expect(semComentarios).not.toMatch(/\btruncate\b/i);
    expect(semComentarios).not.toMatch(/\bdelete\s+from\b/i);
    const updatesDeConexao = [...semComentarios.matchAll(/update\s+public\.channel_connections\s+set\s+(\w+)/gi)].map((m) => m[1]);
    expect(updatesDeConexao).toEqual(['ai_agent_id']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/centralAgentesFundacaoMigration.test.ts`
Expected: FAIL em "existe" (arquivo não encontrado) e nos demais.

- [ ] **Step 3: Escrever a migration**

A ordem das cinco funções no arquivo importa para o teste: gatilho da conexão, gatilho das versões, criar agente, última resposta nativa, ligar.

```sql
-- =============================================================================
-- CENTRAL DE AGENTES — fatia 1 (fundação)
-- =============================================================================
-- SPEC: docs/features/central-de-agentes/SPEC.md (aprovada pelo Junior em 29/09/2026).
-- O agente de IA vira cadastro do cliente (ai_agents) com versões publicadas imutáveis
-- (ai_agent_versions). O número aponta para o agente em channel_connections.ai_agent_id;
-- NULO = caminho de hoje, byte a byte.
--
-- Só ADITIVA: não reescreve config de conexão e não remove nada. Escrita nas tabelas
-- novas só por função security definer; leitura só da agência (agency_admin/admin).
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

-- Prova da migração: sha e data da ÚLTIMA resposta nativa ENTREGUE do número, entre TODAS as conversas
-- dele, uma linha por resposta (parte 0). A resposta nativa não grava channel_connection_id na mensagem;
-- o número vem da conversa. O sha é validado no resultado, não no filtro: se a resposta mais nova não
-- tem sha válido, volta sha nulo e a prova falha fechada, sem pular para uma resposta anterior.
create or replace function public.central_agentes_ultima_resposta_nativa(p_connection_id uuid)
returns table (out_sha256 text, out_sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when m.metadata ->> 'prompt_sha256' ~ '^[0-9a-f]{64}$' then m.metadata ->> 'prompt_sha256' end,
    m.sent_at
  from public.conversation_messages m
  join public.conversation_threads t
    on t.id = m.thread_id
   and t.organization_id = m.organization_id
  where t.channel_connection_id = p_connection_id
    and m.direction = 'outbound'
    and m.metadata ->> 'automation_source' = 'native_crm'
    and m.metadata ->> 'native_ai' = 'true'
    and m.metadata ->> 'delivery_status' = 'sent'
    and coalesce(m.metadata ->> 'reply_part_index', '0') = '0'
  order by m.sent_at desc, m.created_at desc, m.id desc
  limit 1;
$$;

revoke all on function public.central_agentes_ultima_resposta_nativa(uuid) from public, anon, authenticated;
grant execute on function public.central_agentes_ultima_resposta_nativa(uuid) to service_role;

-- Liga o número ao agente numa transação só, conferindo de novo o que o script conferiu: a chave da
-- conexão, o override ativo, a versão publicada do agente e a última resposta da produção. A linha do
-- número fica travada até o fim, e qualquer mudança no caminho recusa, com o motivo.
create or replace function public.central_agentes_ligar_conexao(
  p_connection_id uuid,
  p_agent_id uuid,
  p_chave_bruta text,
  p_prompt_key text,
  p_prompt_source text,
  p_sha256 text
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
  v_override uuid;
  v_producao text;
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return 'sha_invalido';
  end if;

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
  if (v_config ->> 'aiPromptKey') is distinct from p_chave_bruta then
    return 'chave_mudou';
  end if;

  if p_prompt_source = 'default' then
    if exists (
      select 1
      from public.ai_prompt_templates t
      where t.organization_id = v_org
        and t.key = p_prompt_key
        and t.is_active
        and t.content <> ''
    ) then
      return 'override_mudou';
    end if;
  elsif p_prompt_source = 'override' then
    select t.id
      into v_override
    from public.ai_prompt_templates t
    where t.organization_id = v_org
      and t.key = p_prompt_key
      and t.is_active
      and encode(extensions.digest(t.content, 'sha256'), 'hex') = p_sha256
    limit 1
    for share;
    if not found then
      return 'override_mudou';
    end if;
  else
    return 'origem_invalida';
  end if;

  if not exists (
    select 1
    from public.ai_agents a
    join public.ai_agent_versions v
      on v.id = a.published_version_id
     and v.agent_id = a.id
     and v.organization_id = a.organization_id
    where a.id = p_agent_id
      and a.organization_id = v_org
      and encode(extensions.digest(v.prompt, 'sha256'), 'hex') = p_sha256
  ) then
    return 'versao_publicada_diverge';
  end if;

  select r.out_sha256
    into v_producao
  from public.central_agentes_ultima_resposta_nativa(p_connection_id) r;
  if v_producao is distinct from p_sha256 then
    return 'prova_nao_confere';
  end if;

  update public.channel_connections
     set ai_agent_id = p_agent_id
   where id = p_connection_id;
  return 'ligado';
end;
$$;

revoke all on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text) to service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/centralAgentesFundacaoMigration.test.ts`
Expected: PASS (14 testes).

- [ ] **Step 5: Escrever a volta (G23)**

Criar `docs/features/central-de-agentes/volta-fatia-1.sql`:

```sql
-- VOLTA da fatia 1 da Central de Agentes (supabase/migrations/20260930000000_central_agentes_fundacao.sql).
-- ORDEM: primeiro tirar do ar o código que lê ai_agent_id (senão o portão da IA falha e a IA para em
-- todos os clientes); só depois rodar isto. Nunca em produção sem o OK do Junior. Provada no banco local
-- (Task 2, Step 3): aplicar -> voltar -> aplicar.
begin;
drop trigger if exists channel_connections_ai_agent_published on public.channel_connections;
alter table public.channel_connections drop constraint if exists channel_connections_ai_agent_fk;
drop index if exists public.channel_connections_ai_agent_id_idx;
alter table public.channel_connections drop column if exists ai_agent_id;
drop function if exists public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text);
drop function if exists public.central_agentes_ultima_resposta_nativa(uuid);
drop function if exists public.create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb);
drop function if exists public.enforce_channel_connection_ai_agent_published();
drop table if exists public.ai_agent_versions cascade;
drop table if exists public.ai_agents cascade;
drop function if exists public.prevent_ai_agent_version_update();
delete from supabase_migrations.schema_migrations where version = '20260930000000';
commit;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930000000_central_agentes_fundacao.sql test/centralAgentesFundacaoMigration.test.ts docs/features/central-de-agentes/volta-fatia-1.sql
git diff --cached --stat
git commit -m "feat(central-agentes): migration da fundacao (ai_agents, versoes, ai_agent_id, prova e ligacao no banco)"
```

---

### Task 2: Prova no Supabase local (FKs, gatilhos, cascata, matriz de acesso, prova e ligação)

**Files:**
- Test: `test/centralAgentesFundacao.local.test.ts`

Pré-requisito: Docker aberto e `npx supabase start` (o runner `npm run test:local` recusa qualquer banco que não seja `127.0.0.1:54321`). Aplicar as migrations no local com `npx supabase db reset` se o banco local ainda não tiver a migration nova.

- [ ] **Step 1: Escrever o teste**

```ts
// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
const PROMPT = 'Voce e a Aurora. {{contactName}}\n{{recentMessagesText}}';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';

describeLocal('Central de Agentes, fundação — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let conexaoA = '';
  let agenteA = '';
  let agenteB = '';
  const usuarios: string[] = [];
  let emailAgencia = '';
  let emailClienteA = '';
  let emailClienteB = '';
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: 'agency_admin' | 'clinic_admin', organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `central.${role}.${runId}.${randomUUID()}@example.com`;
    const criado = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { role, organization_id: organizationId },
    });
    if (criado.error || !criado.data.user?.id) throw new Error(`Falha ao criar ${role}: ${criado.error?.message}`);
    usuarios.push(criado.data.user.id);
    assertNoSupabaseError(await admin.from('profiles').upsert({
      id: criado.data.user.id,
      email,
      name: `Central ${role} ${runId}`,
      first_name: 'Central',
      organization_id: organizationId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), `upsert profile ${role}`);
    return email;
  }

  async function entrar(email: string) {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password: senha });
    expect(login.error).toBeNull();
    return client;
  }

  async function criarAgente(organizationId: string, prompt = PROMPT) {
    return getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: 'Aurora',
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: AURORA, promptSource: 'default' },
    });
  }

  async function novaConexao(nome: string, config: Record<string, unknown> = {}) {
    const admin = getSupabaseAdminClient();
    return requireSupabaseData(await admin
      .from('channel_connections')
      .insert({ organization_id: orgA, provider: 'evolution', channel_type: 'whatsapp', name: `${nome} ${runId}`, config })
      .select('id')
      .single(), `insert conexao ${nome}`).id as string;
  }

  /** Metadata de resposta nativa entregue, parte 0, como o webhook grava. */
  function nativa(sha: string | null, extra: Record<string, unknown> = {}) {
    return {
      automation_source: 'native_crm',
      native_ai: true,
      delivery_status: 'sent',
      reply_part_index: 0,
      ...(sha ? { prompt_sha256: sha } : {}),
      ...extra,
    };
  }

  function mensagem(threadId: string, sentAt: string, metadata: Record<string, unknown>, direction = 'outbound') {
    return { thread_id: threadId, organization_id: orgA, direction, content: 'x', sent_at: sentAt, metadata };
  }

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    conexaoA = await novaConexao('Central', { aiEnabled: false });
    emailAgencia = await criarUsuario('agency_admin', orgA);
    emailClienteA = await criarUsuario('clinic_admin', orgA);
    emailClienteB = await criarUsuario('clinic_admin', orgB);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    // A limpeza apaga as organizações; com agente e número nelas, ela também exercita a cascata.
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('cria o agente com a v1 publicada e é idempotente pelo sha256', async () => {
    const primeira = await criarAgente(orgA);
    expect(primeira.error).toBeNull();
    const [linha] = primeira.data as Array<{ out_agent_id: string; out_version_id: string; out_created: boolean }>;
    expect(linha.out_created).toBe(true);
    agenteA = linha.out_agent_id;

    const segunda = await criarAgente(orgA);
    const [repetida] = segunda.data as Array<{ out_agent_id: string; out_created: boolean }>;
    expect(repetida).toMatchObject({ out_agent_id: agenteA, out_created: false });

    const admin = getSupabaseAdminClient();
    const versao = await admin.from('ai_agent_versions').select('version, prompt, settings, model, source').eq('agent_id', agenteA);
    expect(versao.error).toBeNull();
    expect(versao.data).toEqual([{ version: 1, prompt: PROMPT, settings: {}, model: null, source: 'migration' }]);

    const agente = await admin.from('ai_agents').select('draft_revision, published_version_id').eq('id', agenteA).single();
    expect(agente.data).toEqual({ draft_revision: 0, published_version_id: linha.out_version_id });
  });

  it('recusa origem cujo sha256 não é o do prompt', async () => {
    const resultado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: orgA,
      p_name: 'Aurora',
      p_prompt: PROMPT,
      p_origin: { sha256: sha256(`${PROMPT} `) },
    });
    expect(resultado.error?.message).toContain('origin_sha256_mismatch');
  });

  it('liga o número ao agente publicado da mesma organização e desliga de volta', async () => {
    const admin = getSupabaseAdminClient();
    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: agenteA }).eq('id', conexaoA), 'ligar');
    const ligada = await admin.from('channel_connections').select('ai_agent_id, config').eq('id', conexaoA).single();
    expect(ligada.data).toMatchObject({ ai_agent_id: agenteA, config: { aiEnabled: false } });

    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', conexaoA), 'desligar');
    const desligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(desligada.data?.ai_agent_id).toBeNull();
  });

  it('a FK composta recusa ligar o número ao agente de outra organização (23503)', async () => {
    const outro = await criarAgente(orgB, `${PROMPT}\nB`);
    agenteB = (outro.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const tentativa = await getSupabaseAdminClient().from('channel_connections').update({ ai_agent_id: agenteB }).eq('id', conexaoA);
    expect(tentativa.error?.code).toBe('23503');
  });

  it('o gatilho recusa ligar a agente sem versão publicada (P0001)', async () => {
    const admin = getSupabaseAdminClient();
    const vazio = await admin.from('ai_agents').insert({ organization_id: orgA, name: 'Sem versao' }).select('id').single();
    const vazioId = requireSupabaseData(vazio, 'insert agente vazio').id;
    const tentativa = await admin.from('channel_connections').update({ ai_agent_id: vazioId }).eq('id', conexaoA);
    expect(tentativa.error?.code).toBe('P0001');
    expect(tentativa.error?.message).toContain('ai_agent_not_published');
  });

  it('agente com número ligado não se apaga; desligado, apaga junto com as versões', async () => {
    const admin = getSupabaseAdminClient();
    const descartavel = await criarAgente(orgA, `${PROMPT}\nDescartavel`);
    const descartavelId = (descartavel.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: descartavelId }).eq('id', conexaoA), 'ligar descartavel');

    const ligado = await admin.from('ai_agents').delete().eq('id', descartavelId);
    expect(ligado.error?.code).toBe('23503');
    const aindaLigada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(aindaLigada.data?.ai_agent_id).toBe(descartavelId);

    assertNoSupabaseError(await admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', conexaoA), 'desligar descartavel');
    assertNoSupabaseError(await admin.from('ai_agents').delete().eq('id', descartavelId), 'apagar agente desligado');
    const versoes = await admin.from('ai_agent_versions').select('id').eq('agent_id', descartavelId);
    expect(versoes.error).toBeNull();
    expect(versoes.data).toEqual([]);
  });

  it('versão não aceita update', async () => {
    const tentativa = await getSupabaseAdminClient().from('ai_agent_versions').update({ note: 'mexi' }).eq('agent_id', agenteA);
    expect(tentativa.error?.message).toContain('ai_agent_version_immutable');
  });

  it('apagar o usuário que publicou uma versão não trava: o autor vira nulo e o resto não muda', async () => {
    const admin = getSupabaseAdminClient();
    await criarUsuario('agency_admin', orgA);
    const autorId = usuarios.at(-1)!;
    const versao = await admin
      .from('ai_agent_versions')
      .insert({ agent_id: agenteA, organization_id: orgA, version: 2, prompt: `${PROMPT}\nv2`, source: 'publish', published_by: autorId })
      .select('id')
      .single();
    const versaoId = requireSupabaseData(versao, 'insert versao com autor').id;

    const apagado = await admin.auth.admin.deleteUser(autorId);
    expect(apagado.error).toBeNull();

    const depois = await admin.from('ai_agent_versions').select('published_by, prompt, version').eq('id', versaoId).single();
    expect(depois.data).toEqual({ published_by: null, prompt: `${PROMPT}\nv2`, version: 2 });
  });

  it('apagar a organização inteira leva agente, versões e número ligado juntos', async () => {
    const admin = getSupabaseAdminClient();
    const org = await admin.from('organizations').insert({ name: `Vitest Org C ${runId}` }).select('id').single();
    const orgC = requireSupabaseData(org, 'insert org C').id;
    const criado = await criarAgente(orgC, `${PROMPT}\nC`);
    const agenteC = (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const conexao = await admin
      .from('channel_connections')
      .insert({ organization_id: orgC, provider: 'evolution', channel_type: 'whatsapp', name: `Central C ${runId}`, config: {}, ai_agent_id: agenteC })
      .select('id')
      .single();
    const conexaoC = requireSupabaseData(conexao, 'insert conexao C ligada').id;

    assertNoSupabaseError(await admin.from('organizations').delete().eq('id', orgC), 'apagar org C');

    const sobras = await Promise.all([
      admin.from('ai_agents').select('id').eq('id', agenteC),
      admin.from('ai_agent_versions').select('id').eq('agent_id', agenteC),
      admin.from('channel_connections').select('id').eq('id', conexaoC),
    ]);
    for (const sobra of sobras) {
      expect(sobra.error).toBeNull();
      expect(sobra.data).toEqual([]);
    }
  });

  it('matriz de acesso (G2): anônimo, agência, cliente A e cliente B, nas duas tabelas e nas três funções', async () => {
    const identidades = {
      anonimo: createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
      agencia: await entrar(emailAgencia),
      clienteA: await entrar(emailClienteA),
      clienteB: await entrar(emailClienteB),
    };
    const escritas = {
      ai_agents: {
        insert: { organization_id: orgA, name: 'Direto' },
        update: { name: 'Mexido' },
        coluna: 'id',
      },
      ai_agent_versions: {
        insert: { agent_id: agenteA, organization_id: orgA, version: 99, prompt: 'x', source: 'publish' },
        update: { note: 'mexi' },
        coluna: 'agent_id',
      },
    };
    const funcoes: Array<[string, Record<string, unknown>]> = [
      ['create_ai_agent_from_legacy_prompt', { p_organization_id: orgA, p_name: 'X', p_prompt: 'x', p_origin: { sha256: sha256('x') } }],
      ['central_agentes_ultima_resposta_nativa', { p_connection_id: conexaoA }],
      ['central_agentes_ligar_conexao', {
        p_connection_id: conexaoA, p_agent_id: agenteA, p_chave_bruta: null, p_prompt_key: AURORA, p_prompt_source: 'default', p_sha256: sha256(PROMPT),
      }],
    ];

    for (const [nome, cliente] of Object.entries(identidades)) {
      for (const [tabela, caso] of Object.entries(escritas)) {
        const lidos = await cliente.from(tabela).select('id');
        if (nome === 'anonimo') {
          expect(lidos.error?.code, `${nome} lê ${tabela}`).toBe('42501');
        } else if (nome === 'agencia') {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          expect(lidos.data?.length, `${nome} lê ${tabela}`).toBeGreaterThan(0);
        } else {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          expect(lidos.data, `${nome} lê ${tabela}`).toEqual([]);
        }
        const tentativas = [
          await cliente.from(tabela).insert(caso.insert),
          await cliente.from(tabela).update(caso.update).eq(caso.coluna, agenteA),
          await cliente.from(tabela).delete().eq(caso.coluna, agenteA),
        ];
        for (const tentativa of tentativas) expect(tentativa.error?.code, `${nome} escreve em ${tabela}`).toBe('42501');
      }
      for (const [funcao, args] of funcoes) {
        const chamada = await cliente.rpc(funcao, args);
        expect(chamada.error?.code, `${nome} chama ${funcao}`).toBe('42501');
      }
    }

    const admin = getSupabaseAdminClient();
    const intacto = await admin.from('ai_agents').select('name').eq('id', agenteA).single();
    expect(intacto.data?.name).toBe('Aurora');
    const ligado = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(ligado.data?.ai_agent_id).toBeNull();
  });

  it('a última resposta nativa entregue do número vem de qualquer uma das conversas dele (mais de 100) e falha fechada', async () => {
    const admin = getSupabaseAdminClient();
    const conexao = await novaConexao('Prova');
    const conversas = requireSupabaseData(await admin
      .from('conversation_threads')
      .insert(Array.from({ length: 120 }, (_, i) => ({
        organization_id: orgA,
        channel_connection_id: conexao,
        title: `Prova ${i} ${runId}`,
        last_message_at: new Date(Date.UTC(2026, 8, 29, 12, i)).toISOString(),
      })))
      .select('id, title'), 'insert 120 conversas') as Array<{ id: string; title: string }>;
    // A resposta mais nova fica na conversa com o last_message_at mais ANTIGO: um limite por conversa
    // recente a deixaria de fora e usaria uma resposta anterior como prova.
    const primeira = conversas.find((c) => c.title.startsWith('Prova 0 '))!.id;
    assertNoSupabaseError(await admin.from('conversation_messages').insert([
      ...conversas.slice(1).map((c, i) => mensagem(c.id, `2026-09-29T10:${String(i % 60).padStart(2, '0')}:00Z`, nativa('a'.repeat(64)))),
      mensagem(primeira, '2026-09-29T11:00:00Z', nativa('b'.repeat(64))),
      mensagem(primeira, '2026-09-29T11:00:00Z', nativa('b'.repeat(64), { reply_part_index: 1 })),
      mensagem(primeira, '2026-09-29T11:30:00Z', nativa('c'.repeat(64), { delivery_status: 'failed' })),
      mensagem(primeira, '2026-09-29T11:40:00Z', nativa('d'.repeat(64), { automation_source: 'n8n' })),
      mensagem(primeira, '2026-09-29T11:50:00Z', nativa('e'.repeat(64)), 'inbound'),
    ]), 'insert mensagens da prova');

    const achada = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao });
    expect(achada.error).toBeNull();
    expect(achada.data).toEqual([{ out_sha256: 'b'.repeat(64), out_sent_at: expect.stringMatching(/^2026-09-29T11:00:00/) }]);

    // Falha fechada: a resposta entregue mais nova sem sha válido devolve sha nulo; a função não volta
    // para uma resposta anterior que tenha sha.
    assertNoSupabaseError(await admin.from('conversation_messages').insert(
      mensagem(primeira, '2026-09-29T12:00:00Z', nativa(null)),
    ), 'insert resposta sem sha');
    const semSha = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao });
    expect(semSha.data).toEqual([{ out_sha256: null, out_sent_at: expect.stringMatching(/^2026-09-29T12:00:00/) }]);
  });

  it('ligar confere tudo de novo numa transação só e recusa, com o motivo, se algo mudou', async () => {
    const admin = getSupabaseAdminClient();
    const texto = `${PROMPT}\nLigar`;
    const sha = sha256(texto);
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const conexao = await novaConexao('Ligar', { aiPromptKey: AURORA });
    const conversa = requireSupabaseData(await admin
      .from('conversation_threads')
      .insert({ organization_id: orgA, channel_connection_id: conexao, title: `Ligar ${runId}` })
      .select('id')
      .single(), 'insert conversa ligar').id as string;
    const responder = async (shaDaResposta: string, sentAt: string) =>
      assertNoSupabaseError(await admin.from('conversation_messages').insert(mensagem(conversa, sentAt, nativa(shaDaResposta))), 'insert resposta');
    const ligar = async (troca: Record<string, unknown> = {}) => {
      const r = await admin.rpc('central_agentes_ligar_conexao', {
        p_connection_id: conexao,
        p_agent_id: agente,
        p_chave_bruta: AURORA,
        p_prompt_key: AURORA,
        p_prompt_source: 'default',
        p_sha256: sha,
        ...troca,
      });
      expect(r.error).toBeNull();
      return r.data as string;
    };

    await responder('f'.repeat(64), '2026-09-29T10:00:00Z');
    expect(await ligar()).toBe('prova_nao_confere');

    await responder(sha, '2026-09-29T11:00:00Z');
    expect(await ligar({ p_chave_bruta: null })).toBe('chave_mudou');

    const override = requireSupabaseData(await admin
      .from('ai_prompt_templates')
      .insert({ organization_id: orgA, key: AURORA, content: 'Outro texto', version: 1, is_active: true })
      .select('id')
      .single(), 'insert override').id;
    expect(await ligar()).toBe('override_mudou');
    assertNoSupabaseError(await admin.from('ai_prompt_templates').delete().eq('id', override), 'apagar override');

    expect(await ligar({ p_agent_id: agenteA })).toBe('versao_publicada_diverge');

    expect(await ligar()).toBe('ligado');
    const ligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBe(agente);
    expect(await ligar()).toBe('ja_ligada');
  });
});
```

- [ ] **Step 2: Rodar contra o Supabase local**

Run: `npm run test:local -- test/centralAgentesFundacao.local.test.ts`
Expected: PASS (12 testes), e o `afterAll` sem erro. Se o local não tiver a migration, rodar antes `npx supabase db reset` (apaga só o banco local).

Se "apagar a organização inteira" falhar com 23503 em `channel_connections_ai_agent_fk`, **parar**: a premissa da SPEC de que `no action` deixa a cascata passar está errada, e a decisão volta para o Junior antes de qualquer outra task.

- [ ] **Step 3: Provar a volta no banco local (G23): aplicar → voltar → aplicar**

Run: `docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < docs/features/central-de-agentes/volta-fatia-1.sql`
Expected: `COMMIT`, sem erro.

Run: `docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/20260930000000_central_agentes_fundacao.sql`
Expected: termina sem erro (a migration reaplica sobre o banco voltado).

Run: `npm run test:local -- test/centralAgentesFundacao.local.test.ts`
Expected: PASS (12 testes) de novo. Se o PostgREST acusar tabela ou função inexistente logo depois da volta, o cache de esquema dele ficou velho: `docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"` e rodar de novo.

- [ ] **Step 4: Commit**

```bash
git add test/centralAgentesFundacao.local.test.ts
git diff --cached --stat
git commit -m "test(central-agentes): FKs, gatilhos, cascata, matriz de acesso, prova e ligacao no Supabase local"
```

---

### Task 3: Resolução pura do prompt e a leitura estrita

**Files:**
- Create: `lib/ai/prompts/resolve.ts`
- Modify: `lib/ai/prompts/server.ts` (arquivo inteiro)
- Test: `lib/ai/prompts/resolve.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from './catalog';
import { buscarPromptResolvido, buscarPromptResolvidoEstrito, escolherPrompt } from './resolve';
import { getResolvedPrompt } from './server';

const ORG = '11111111-1111-4111-8111-111111111111';
const PADRAO = 'task_conversations_whatsapp_auto_reply';

describe('resolução do prompt (regra de sempre, agora num lugar só)', () => {
  it('override ativo com conteúdo vence o catálogo', () => {
    const r = escolherPrompt(PADRAO, { key: PADRAO, content: 'Proprio', version: 3, is_active: true, updated_at: '2026-09-29T00:00:00Z' });
    expect(r).toEqual({ key: PADRAO, content: 'Proprio', source: 'override', version: 3, updatedAt: '2026-09-29T00:00:00Z' });
  });

  it('override vazio cai no catálogo', () => {
    const r = escolherPrompt(PADRAO, { key: PADRAO, content: '', version: 1, is_active: true, updated_at: 'x' });
    expect(r).toEqual({ key: PADRAO, content: getPromptCatalogMap()[PADRAO].defaultTemplate, source: 'default' });
  });

  it('chave fora do catálogo e sem override = null', () => {
    expect(escolherPrompt('task_nao_existe', null)).toBeNull();
  });

  it('falha ao ler o override cai no catálogo, como hoje', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    const r = await buscarPromptResolvido(admin as never, ORG, PADRAO);
    expect(r?.source).toBe('default');
  });

  it('getResolvedPrompt (servidor) devolve exatamente o mesmo que a função pura', async () => {
    const admin = createFakeSupabaseAdmin({
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Override X', version: 2, is_active: true, updated_at: 'y' }],
    });
    expect(await getResolvedPrompt(admin as never, ORG, PADRAO)).toEqual(await buscarPromptResolvido(admin as never, ORG, PADRAO));
  });

  it('a leitura estrita lança quando o banco falha (o script nunca cai no catálogo por erro)', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    await expect(buscarPromptResolvidoEstrito(admin as never, ORG, PADRAO)).rejects.toThrow('boom');
  });

  it('a leitura estrita devolve o mesmo que a tolerante quando o banco responde', async () => {
    const admin = createFakeSupabaseAdmin({
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Override X', version: 2, is_active: true, updated_at: 'y' }],
    });
    expect(await buscarPromptResolvidoEstrito(admin as never, ORG, PADRAO)).toEqual(await buscarPromptResolvido(admin as never, ORG, PADRAO));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/ai/prompts/resolve.test.ts`
Expected: FAIL com "Failed to resolve import ./resolve".

- [ ] **Step 3: Criar `lib/ai/prompts/resolve.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPromptCatalogMap } from './catalog';

// Sem 'server-only' de propósito: o script da Central de Agentes (scripts/central-agentes) usa esta
// MESMA regra para calcular o prompt de hoje. O runtime usa a leitura tolerante; o script, a estrita.

export type PromptResolution = {
  key: string;
  content: string;
  source: 'override' | 'default';
  version?: number;
  updatedAt?: string;
};

export type DbPromptRow = {
  key: string;
  content: string;
  version: number;
  is_active: boolean;
  updated_at: string;
};

/** Override ativo com conteúdo vence; senão o texto do catálogo; chave fora do catálogo e sem override = null. */
export function escolherPrompt(key: string, row: DbPromptRow | null): PromptResolution | null {
  if (row?.content) {
    return { key, content: row.content, source: 'override', version: row.version, updatedAt: row.updated_at };
  }
  const fallback = getPromptCatalogMap()[key];
  if (!fallback) return null;
  return { key, content: fallback.defaultTemplate, source: 'default' };
}

function lerOverrideAtivo(supabase: SupabaseClient, organizationId: string, key: string) {
  return supabase
    .from('ai_prompt_templates')
    .select('key, content, version, is_active, updated_at')
    .eq('organization_id', organizationId)
    .eq('key', key)
    .eq('is_active', true)
    .maybeSingle();
}

export async function buscarPromptResolvido(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  const { data, error } = await lerOverrideAtivo(supabase, organizationId, key);

  if (error) {
    // Não quebrar IA por falha em prompt override; apenas log e fallback.
    console.warn('[ai/prompts] Failed to load override; using default.', { key, message: error.message });
  }

  return escolherPrompt(key, (data as DbPromptRow | null) ?? null);
}

/**
 * Mesma regra, sem tolerância: erro de banco LANÇA. É a leitura do script de migração, que nunca pode
 * gravar o texto do catálogo no lugar de um override só porque a consulta falhou.
 */
export async function buscarPromptResolvidoEstrito(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  const { data, error } = await lerOverrideAtivo(supabase, organizationId, key);
  if (error) {
    throw new Error(`Falha ao ler o prompt ${key} da organizacao ${organizationId}: ${error.message}`);
  }
  return escolherPrompt(key, (data as DbPromptRow | null) ?? null);
}
```

- [ ] **Step 4: Trocar o corpo de `lib/ai/prompts/server.ts` (arquivo inteiro)**

```ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPromptResolvido, type PromptResolution } from './resolve';

export type { PromptResolution };

/**
 * Prompt resolvido da organização: override ativo em ai_prompt_templates, senão o texto do catálogo.
 * A regra mora em ./resolve (sem server-only) para o script da Central de Agentes usar a mesma.
 */
export async function getResolvedPrompt(
  supabase: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<PromptResolution | null> {
  return buscarPromptResolvido(supabase, organizationId, key);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/ai/prompts/`
Expected: PASS (inclui `catalog.aurora.test.ts`, sem mudança).

- [ ] **Step 6: Commit**

```bash
git add lib/ai/prompts/resolve.ts lib/ai/prompts/resolve.test.ts lib/ai/prompts/server.ts
git diff --cached --stat
git commit -m "refactor(prompts): resolucao pura do prompt e leitura estrita para o script"
```

---

### Task 4: O portão da IA traz `ai_agent_id`

O banco falso devolve a linha inteira, qualquer que seja o `select`, e o `tsconfig.json` exclui os arquivos `*.test.*` do typecheck. Sem o passo 1, o teste deste portão passaria sem a mudança que ele quer provar (revisão do Codex, achado 17). Por isso o banco falso ganha uma projeção opcional, ligada só neste teste; os testes antigos continuam vendo o que viam.

**Files:**
- Modify: `test/helpers/fakeSupabaseAdmin.ts` (opções, `select` com projeção)
- Create: `test/helpers/fakeSupabaseAdmin.test.ts`
- Modify: `lib/conversations/conversationAIGate.ts:7-24`
- Test: `lib/conversations/conversationAIGate.agente.test.ts`

- [ ] **Step 1: Teste do banco falso que falha**

Criar `test/helpers/fakeSupabaseAdmin.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from './fakeSupabaseAdmin';

describe('banco falso: projeção do select (opcional)', () => {
  const linhas = { t: [{ id: '1', a: 'x', b: 'y' }] };

  it('com projetarSelect, devolve só as colunas pedidas', async () => {
    const { data } = await createFakeSupabaseAdmin(linhas, { projetarSelect: true }).from('t').select('id, a');
    expect(data).toEqual([{ id: '1', a: 'x' }]);
  });

  it('sem a opção, devolve a linha inteira, como sempre', async () => {
    const { data } = await createFakeSupabaseAdmin(linhas).from('t').select('id');
    expect(data).toEqual([{ id: '1', a: 'x', b: 'y' }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: FAIL no primeiro teste (a linha volta inteira).

- [ ] **Step 3: Projeção opcional no banco falso**

Em `test/helpers/fakeSupabaseAdmin.ts`, antes de `createFakeSupabaseAdmin`:

```ts
/** Opções do banco falso. Tudo desligado por padrão: os testes antigos continuam vendo o que viam. */
export type FakeSupabaseAdminOptions = {
  /** Devolve só as colunas pedidas no `.select()` (nomes simples separados por vírgula), como o PostgREST. */
  projetarSelect?: boolean;
};
```

A assinatura passa a ser:

```ts
export function createFakeSupabaseAdmin(seed: Record<string, Row[]> = {}, opcoes: FakeSupabaseAdminOptions = {}) {
```

Dentro de `from(table)`, junto das outras variáveis:

```ts
    let projecao: string[] | null = null;
```

O `select` do builder:

```ts
      select: (columns?: string) => {
        if (opcoes.projetarSelect && columns && columns.trim() !== '*') {
          projecao = columns.split(',').map((column) => column.trim()).filter(Boolean);
        }
        return builder;
      },
```

E o fim da leitura em `run()` (onde hoje está o `return` com `structuredClone`):

```ts
      // Como o banco de verdade, a leitura devolve CÓPIA: quem leu fica com a foto daquele instante,
      // e uma escrita posterior de outro processo não muda o que ele tem em mãos.
      const copias = selected.map((row) => structuredClone(row));
      const colunas = projecao;
      return Promise.resolve({
        data: colunas ? copias.map((row) => Object.fromEntries(colunas.map((column) => [column, row[column]]))) : copias,
        error: null,
      });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Escrever o teste do portão que falha**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { loadFreshConversationAIGate } from './conversationAIGate';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';

// projetarSelect: a linha volta só com as colunas que o código pede. Sem `ai_agent_id` no select,
// o teste fica vermelho, que é o que ele precisa provar.
function semear(aiAgentId: string | null) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true }, ai_agent_id: aiAgentId }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true }],
  }, { projetarSelect: true });
}

describe('portão da IA e o agente do número', () => {
  it('devolve o ai_agent_id da conexão', async () => {
    const gate = await loadFreshConversationAIGate({ admin: semear('33333333-3333-4333-8333-333333333333') as never, connectionId: CONN, organizationId: ORG });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.connection.ai_agent_id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('número sem agente devolve null', async () => {
    const gate = await loadFreshConversationAIGate({ admin: semear(null) as never, connectionId: CONN, organizationId: ORG });
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.connection.ai_agent_id ?? null).toBeNull();
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run lib/conversations/conversationAIGate.agente.test.ts`
Expected: FAIL no primeiro teste: `ai_agent_id` chega `undefined`, porque o `select` de hoje não pede a coluna.

- [ ] **Step 7: Mudar o tipo e a leitura**

Em `lib/conversations/conversationAIGate.ts`, o tipo:

```ts
export type FreshConversationAIConnection = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
  /** Central de Agentes (fatia 1): número com agente usa o prompt da versão publicada. Nulo = caminho de hoje. */
  ai_agent_id?: string | null;
};
```

e a consulta:

```ts
  const connectionResult = await input.admin
    .from('channel_connections')
    .select('id, organization_id, name, config, ai_agent_id')
    .eq('id', input.connectionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
```

- [ ] **Step 8: Rodar e ver passar (e a suíte do portão)**

Run: `npx vitest run lib/conversations/conversationAIGate test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS nos testes novos e no `conversationAIGate.test.ts` existente.

- [ ] **Step 9: Commit**

```bash
git add test/helpers/fakeSupabaseAdmin.ts test/helpers/fakeSupabaseAdmin.test.ts lib/conversations/conversationAIGate.ts lib/conversations/conversationAIGate.agente.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): portao da IA le o agente do numero (banco falso com projecao opcional)"
```

---

### Task 5: Carregar a versão publicada do agente

**Files:**
- Create: `lib/agents/agentRuntime.ts`
- Test: `lib/agents/agentRuntime.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { carregarVersaoPublicada } from './agentRuntime';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';

function semear(overrides: { publishedVersionId?: string | null; versoes?: Record<string, unknown>[] } = {}) {
  return createFakeSupabaseAdmin({
    ai_agents: [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: overrides.publishedVersionId === undefined ? V1 : overrides.publishedVersionId }],
    ai_agent_versions: overrides.versoes ?? [
      { id: V1, agent_id: AGENTE, organization_id: ORG, version: 1, prompt: 'Prompt da v1', model: null, settings: {} },
    ],
  });
}

describe('versão publicada do agente', () => {
  it('carrega prompt, versão e modelo da versão publicada', async () => {
    const r = await carregarVersaoPublicada(semear() as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: true, versao: { agentId: AGENTE, versionId: V1, version: 1, prompt: 'Prompt da v1', model: null } });
  });

  it('agente de outra organização não é encontrado', async () => {
    const r = await carregarVersaoPublicada(semear() as never, { organizationId: OUTRA, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_found' });
  });

  it('agente sem versão publicada', async () => {
    const r = await carregarVersaoPublicada(semear({ publishedVersionId: null }) as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_published' });
  });

  it('ponteiro para versão que não existe', async () => {
    const r = await carregarVersaoPublicada(semear({ versoes: [] }) as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_not_published' });
  });

  it('erro de leitura', async () => {
    const admin = semear();
    admin.failOn('ai_agents', 'select', 'boom');
    const r = await carregarVersaoPublicada(admin as never, { organizationId: ORG, agentId: AGENTE });
    expect(r).toEqual({ ok: false, motivo: 'agent_read_error' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agents/agentRuntime.test.ts`
Expected: FAIL com "Failed to resolve import ./agentRuntime".

- [ ] **Step 3: Criar `lib/agents/agentRuntime.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type VersaoPublicadaDoAgente = {
  agentId: string;
  versionId: string;
  version: number;
  prompt: string;
  model: string | null;
};

export type ResultadoVersaoPublicada =
  | { ok: true; versao: VersaoPublicadaDoAgente }
  | { ok: false; motivo: 'agent_not_found' | 'agent_not_published' | 'agent_read_error' };

/**
 * Versão publicada do agente, sempre filtrando pela organização (G4). Duas leituras simples em vez de
 * embed do PostgREST: ai_agents e ai_agent_versions têm duas relações entre si (agente → versões e o
 * ponteiro da publicada), e o embed ficaria ambíguo.
 */
export async function carregarVersaoPublicada(
  admin: SupabaseClient,
  input: { organizationId: string; agentId: string },
): Promise<ResultadoVersaoPublicada> {
  const agente = await admin
    .from('ai_agents')
    .select('id, organization_id, published_version_id')
    .eq('id', input.agentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (agente.error) return { ok: false, motivo: 'agent_read_error' };
  if (!agente.data) return { ok: false, motivo: 'agent_not_found' };

  const publicadaId = (agente.data as { published_version_id: string | null }).published_version_id;
  if (!publicadaId) return { ok: false, motivo: 'agent_not_published' };

  const versao = await admin
    .from('ai_agent_versions')
    .select('id, agent_id, organization_id, version, prompt, model')
    .eq('id', publicadaId)
    .eq('agent_id', input.agentId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();
  if (versao.error) return { ok: false, motivo: 'agent_read_error' };

  const linha = versao.data as { id: string; version: number; prompt: string | null; model: string | null } | null;
  if (!linha || typeof linha.prompt !== 'string' || linha.prompt.length === 0) {
    return { ok: false, motivo: 'agent_not_published' };
  }

  return {
    ok: true,
    versao: {
      agentId: input.agentId,
      versionId: linha.id,
      version: linha.version,
      prompt: linha.prompt,
      model: linha.model ?? null,
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/agents/agentRuntime.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/agents/agentRuntime.ts lib/agents/agentRuntime.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): leitura da versao publicada do agente"
```

---

### Task 6: A resposta usa a versão do agente quando o número tem agente

**Files:**
- Modify: `lib/conversations/aiReply.ts` (linha 3; tipo do parâmetro na linha 380; logo depois da linha 407; linhas 440-454; retorno em 617-621)
- Test: `lib/conversations/aiReply.agente.test.ts`

Atenção: `promptKey` tem valor padrão na desestruturação (linha 393, `promptKey = 'task_conversations_whatsapp_auto_reply'`). Passar `undefined` cai no prompt da clínica. Por isso o webhook vai passar `null` quando a chave da conexão for inválida, e o gerador responde `missing_prompt` quando não houver chave nem agente. Quem não passa a chave continua recebendo a padrão, como hoje.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const capturado = vi.hoisted(() => ({ prompts: [] as string[], modelos: [] as string[] }));
const getResolvedPromptMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async (args: { prompt: string }) => {
      capturado.prompts.push(args.prompt);
      return { output: { replyText: 'Oi!', shouldHandoff: false } };
    }),
  };
});
vi.mock('@/lib/ai/config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/config')>();
  return {
    ...real,
    getModel: vi.fn((_provider: string, _key: string, modelId: string) => {
      capturado.modelos.push(modelId);
      return { modelId };
    }),
  };
});
vi.mock('@/lib/ai/prompts/server', () => ({ getResolvedPrompt: getResolvedPromptMock }));

import { generateConversationAutoReply } from './aiReply';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V2 = '44444444-4444-4444-8444-444444444444';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function semear(opcoes: { aiAgentId?: string | null; agentes?: Record<string, unknown>[]; versoes?: Record<string, unknown>[] }) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true }, ai_agent_id: opcoes.aiAgentId ?? null }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true, ai_provider: 'anthropic', ai_model: 'claude-sonnet-5', ai_anthropic_key: 'sk-ant-teste' }],
    organizations: [{ id: ORG, name: 'Empresa' }],
    ai_agents: opcoes.agentes ?? [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: V2 }],
    ai_agent_versions: opcoes.versoes ?? [{ id: V2, agent_id: AGENTE, organization_id: ORG, version: 2, prompt: 'AGENTE {{recentMessagesText}}', model: null }],
  });
}

function gerar(admin: ReturnType<typeof semear>, promptKey?: string | null) {
  return generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: [{ id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'oi', sent_at: '2026-09-29T12:00:00.000Z', metadata: {} }] as never,
    promptKey,
  });
}

beforeEach(() => {
  capturado.prompts.length = 0;
  capturado.modelos.length = 0;
  getResolvedPromptMock.mockReset();
  getResolvedPromptMock.mockResolvedValue({ key: PADRAO, content: 'LEGADO {{recentMessagesText}}', source: 'default' });
});

describe('resposta com agente no número (fatia 1)', () => {
  it('usa o prompt da versão publicada e informa origem, versão e o sha256 do texto usado', async () => {
    const r = await gerar(semear({ aiAgentId: AGENTE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(capturado.prompts[0]).toMatch(/^AGENTE /);
    expect(getResolvedPromptMock).not.toHaveBeenCalled();
    expect(r.source).toBe('agent');
    expect(r.agent).toEqual({ id: AGENTE, version: 2 });
    expect(r.promptSha256).toBe(sha256('AGENTE {{recentMessagesText}}'));
    expect(capturado.modelos[0]).toBe('claude-sonnet-5');
  });

  it('usa o modelo da versão quando ela tem um', async () => {
    await gerar(semear({
      aiAgentId: AGENTE,
      versoes: [{ id: V2, agent_id: AGENTE, organization_id: ORG, version: 2, prompt: 'AGENTE', model: 'claude-haiku-4-5' }],
    }));
    expect(capturado.modelos[0]).toBe('claude-haiku-4-5');
  });

  it('agente ligado mas sem versão publicada: falha sem chamar o modelo', async () => {
    const r = await gerar(semear({
      aiAgentId: AGENTE,
      agentes: [{ id: AGENTE, organization_id: ORG, name: 'Aurora', published_version_id: null }],
    }));
    expect(r).toEqual({ ok: false, reason: 'agent_unavailable' });
    expect(capturado.prompts).toHaveLength(0);
  });

  it('número sem agente segue o caminho de hoje (chave padrão) e também informa o sha256', async () => {
    const r = await gerar(semear({ aiAgentId: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getResolvedPromptMock).toHaveBeenCalledWith(expect.anything(), ORG, PADRAO);
    expect(capturado.prompts[0]).toMatch(/^LEGADO /);
    expect(r.source).toBe('default');
    expect(r.agent).toBeNull();
    expect(r.promptSha256).toBe(sha256('LEGADO {{recentMessagesText}}'));
  });

  it('chave nula e sem agente: missing_prompt, nunca o prompt padrão', async () => {
    const r = await gerar(semear({ aiAgentId: null }), null);
    expect(r).toEqual({ ok: false, reason: 'missing_prompt' });
    expect(getResolvedPromptMock).not.toHaveBeenCalled();
    expect(capturado.prompts).toHaveLength(0);
  });

  it('chave nula com agente: responde pelo agente', async () => {
    const r = await gerar(semear({ aiAgentId: AGENTE }), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe('agent');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/conversations/aiReply.agente.test.ts`
Expected: FAIL: o prompt capturado começa com "LEGADO" no primeiro teste; `r.agent` e `r.promptSha256` são `undefined`; a chave nula chama `getResolvedPrompt`.

- [ ] **Step 3: Implementar em `lib/conversations/aiReply.ts`**

Linha 3:

```ts
import { createHash, randomUUID } from 'node:crypto';
```

Import, junto dos demais `@/lib/...`:

```ts
import { carregarVersaoPublicada, type VersaoPublicadaDoAgente } from '@/lib/agents/agentRuntime';
```

Tipo do parâmetro (linha 380):

```ts
  /**
   * Chave do prompt da conexão. Ausente = chave padrão, como sempre. `null` = a conexão tem uma chave
   * inválida: sem agente, a resposta falha com `missing_prompt` em vez de cair no prompt padrão.
   */
  promptKey?: string | null;
```

Logo depois de `const generationConnectionConfig = generationGate.connection.config;` (linha 407):

```ts
  // Central de Agentes (fatia 1): número com agente usa a versão publicada. Só o prompt (e o modelo, se a
  // versão tiver um) muda de fonte; variáveis, histórico, render e esquema de saída seguem iguais.
  const agentId = generationGate.connection.ai_agent_id ?? null;
  let agentVersion: VersaoPublicadaDoAgente | null = null;
  if (agentId) {
    const agente = await carregarVersaoPublicada(admin as never, { organizationId, agentId });
    if (!agente.ok) {
      console.warn('[Conversation AI] Linked agent unavailable', { organizationId, connectionId, agentId, reason: agente.motivo });
      return { ok: false as const, reason: 'agent_unavailable' as const };
    }
    agentVersion = agente.versao;
  }
```

No `getModel` (linhas 440-445), trocar o terceiro argumento:

```ts
  const model = getModel(
    provider,
    apiKey,
    agentVersion?.model || orgSettings?.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google,
    { fetch: fetchContador.fetch },
  );
```

Na resolução do prompt (linhas 447-454):

```ts
  // Com agente, o prompt é o da versão publicada. Sem agente e sem chave válida (`null`), falha como o
  // webhook falhava antes de chamar o gerador, em vez de cair no prompt padrão (corrida de desligar o
  // agente durante o debounce).
  const resolvedPrompt = agentVersion
    ? { content: agentVersion.prompt, source: 'agent' as const }
    : promptKey
      ? await getResolvedPrompt(admin as any, organizationId, promptKey)
      : null;
  if (!resolvedPrompt) {
    return { ok: false as const, reason: 'missing_prompt' };
  }
  // Impressão digital do texto usado, antes de trocar as variáveis. Prova, na resposta real, qual prompt
  // respondeu, e é o que o script de migração compara antes de ligar um número a um agente.
  const promptSha256 = createHash('sha256').update(resolvedPrompt.content, 'utf8').digest('hex');
```

No retorno de sucesso (linhas 617-621), logo depois de `source: resolvedPrompt.source,`:

```ts
    promptSha256,
    agent: agentVersion ? { id: agentVersion.agentId, version: agentVersion.version } : null,
```

- [ ] **Step 4: Rodar e ver passar (e as outras suítes do gerador)**

Run: `npx vitest run lib/conversations/aiReply`
Expected: PASS em `aiReply.agente.test.ts` e em todos os `aiReply.*.test.ts` que já existiam.

Run: `npm run typecheck`
Expected: sem erros. Se algum consumidor tipar `source` como `'override' | 'default'`, acrescentar `'agent'` ali.

- [ ] **Step 5: Commit**

```bash
git add lib/conversations/aiReply.ts lib/conversations/aiReply.agente.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): resposta usa a versao publicada do agente e registra o sha do prompt"
```

---

### Task 7: Prova de equivalência byte a byte (legado × agente)

O prompt da Aurora tem `{{availableTagsContext}}` (`lib/ai/prompts/catalog.ts:231`). Com ele, o gerador lê o catálogo de etiquetas (`aiReply.ts:484-485`, `loadTagCatalog`), que filtra `.not('category_id', 'is', null)` (`lib/conversations/etiquetasSugeridas.ts:54`). O banco falso não tem `.not`: sem os passos 1 a 4, o teste da Aurora quebra com TypeError antes de comparar os prompts (revisão do Codex, achado 8).

**Files:**
- Modify: `test/helpers/fakeSupabaseAdmin.ts` (o `.not`)
- Modify: `test/helpers/fakeSupabaseAdmin.test.ts`
- Test: `lib/conversations/aiReply.equivalencia.test.ts`

- [ ] **Step 1: Teste do banco falso que falha**

Acrescentar em `test/helpers/fakeSupabaseAdmin.test.ts`:

```ts
describe('banco falso: .not com a semântica de NULL do SQL', () => {
  const semear = () => createFakeSupabaseAdmin({
    tags: [
      { id: 't1', category_id: 'c1' },
      { id: 't2', category_id: null },
      { id: 't3' },
      { id: 't4', category_id: 'c2' },
    ],
  });

  it("not('col', 'is', null) fica só com quem tem valor", async () => {
    const { data } = await semear().from('tags').select('id').not('category_id', 'is', null);
    expect(data.map((row) => row.id)).toEqual(['t1', 't4']);
  });

  it("not('col', 'eq', x) deixa de fora o igual e também o nulo, como no SQL", async () => {
    const { data } = await semear().from('tags').select('id').not('category_id', 'eq', 'c1');
    expect(data.map((row) => row.id)).toEqual(['t4']);
  });

  it('operador que o banco falso não conhece falha alto, em vez de filtrar errado', () => {
    expect(() => semear().from('tags').select('id').not('category_id', 'in', '(c1)')).toThrow('não suportado');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: FAIL com "not is not a function".

- [ ] **Step 3: Ensinar `.not` ao banco falso**

Em `test/helpers/fakeSupabaseAdmin.ts`, no builder, depois de `is`:

```ts
      not: (column: string, operator: string, value: unknown) => {
        // Como no SQL: NOT (col IS NULL) é "tem valor"; NOT (col = x) também deixa de fora a linha nula.
        if (operator === 'is') {
          filters.push((row) => (readColumn(row, column) ?? null) !== value);
          return builder;
        }
        if (operator === 'eq') {
          filters.push((row) => {
            const current = readColumn(row, column);
            return current !== null && current !== undefined && current !== value;
          });
          return builder;
        }
        throw new Error(`fakeSupabaseAdmin: .not com operador '${operator}' não suportado`);
      },
```

e acrescentar `not` à lista do comentário do topo do arquivo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Escrever o teste de equivalência**

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const capturado = vi.hoisted(() => ({ prompts: [] as string[], modelos: [] as string[] }));

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async (args: { prompt: string }) => {
      capturado.prompts.push(args.prompt);
      return { output: { replyText: 'ok', shouldHandoff: false } };
    }),
  };
});
vi.mock('@/lib/ai/config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/config')>();
  return {
    ...real,
    getModel: vi.fn((_provider: string, _key: string, modelId: string) => {
      capturado.modelos.push(modelId);
      return { modelId };
    }),
  };
});

import { generateConversationAutoReply } from './aiReply';
import { buscarPromptResolvido } from '@/lib/ai/prompts/resolve';
import { resolveConversationAIAgentConfig } from './aiAgentConfig';

/**
 * Regra de ouro da Central de Agentes: até alguém mexer, Aurora e Julia respondem igual. Aqui se captura o
 * PROMPT QUE SAI PARA O MODELO pelos dois caminhos — o de hoje (número sem agente) e o do agente com a v1
 * migrada (conteúdo = o que a resolução de hoje devolve) — e se exige string idêntica e o mesmo sha256
 * gravado no metadata. O prompt real passa pela resolução de verdade (catálogo e override); só o modelo
 * é trocado por um espião. O relógio fica congelado: a Aurora recebe {{currentDateTime}}.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const V1 = '44444444-4444-4444-8444-444444444444';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const HISTORICO = [
  { id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'Oi, vi o anuncio', sent_at: '2026-09-29T14:58:00.000Z', metadata: {} },
  { id: 'm2', direction: 'outbound', message_type: 'text', author_name: 'Aurora', content: 'Oi! Aqui e a Aurora.', sent_at: '2026-09-29T14:58:30.000Z', metadata: {} },
  { id: 'm3', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'Tenho uma loja', sent_at: '2026-09-29T14:59:00.000Z', metadata: {} },
];

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

function semear(config: Record<string, unknown>, extras: Record<string, Record<string, unknown>[]>, aiAgentId: string | null) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true, ...config }, ai_agent_id: aiAgentId }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true, ai_provider: 'anthropic', ai_model: 'claude-sonnet-5', ai_anthropic_key: 'sk-ant-teste' }],
    organizations: [{ id: ORG, name: 'Empresa Teste' }],
    ...extras,
  });
}

async function enviado(admin: ReturnType<typeof semear>, config: Record<string, unknown>) {
  capturado.prompts.length = 0;
  capturado.modelos.length = 0;
  const r = await generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: HISTORICO as never,
    // Como o webhook: a chave resolvida da conexão, `null` quando inválida.
    promptKey: resolveConversationAIAgentConfig({ aiEnabled: true, ...config }).promptKey,
    closing: null,
    threadMetadata: {},
  });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`geração falhou: ${r.reason}`);
  return { prompt: capturado.prompts[0], modelo: capturado.modelos[0], resultado: r };
}

async function provar(config: Record<string, unknown>, extras: Record<string, Record<string, unknown>[]> = {}, adulterar = (t: string) => t) {
  const legado = await enviado(semear(config, extras, null), config);
  const chave = resolveConversationAIAgentConfig({ aiEnabled: true, ...config }).promptKey!;
  const conteudo = (await buscarPromptResolvido(semear(config, extras, null) as never, ORG, chave))!.content;
  const agente = await enviado(semear(config, {
    ...extras,
    ai_agents: [{ id: AGENTE, organization_id: ORG, name: 'Agente', published_version_id: V1 }],
    ai_agent_versions: [{ id: V1, agent_id: AGENTE, organization_id: ORG, version: 1, prompt: adulterar(conteudo), model: null }],
  }, AGENTE), config);
  return { legado, agente, conteudo };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-29T15:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('equivalência byte a byte: número sem agente × agente com a v1 migrada', () => {
  it('Aurora (chave da Cenoura Hub, sem override)', async () => {
    const { legado, agente, conteudo } = await provar({ aiPromptKey: AURORA });
    expect(agente.prompt).toBe(legado.prompt);
    expect(sha256(agente.prompt)).toBe(sha256(legado.prompt));
    expect(agente.modelo).toBe(legado.modelo);
    expect(agente.resultado.source).toBe('agent');
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
    expect(legado.resultado.promptSha256).toBe(sha256(conteudo));
  });

  it('Julia (número sem chave: prompt padrão, sem override)', async () => {
    const { legado, agente } = await provar({});
    expect(agente.prompt).toBe(legado.prompt);
    expect(agente.modelo).toBe(legado.modelo);
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
  });

  it('cliente com override ativo em ai_prompt_templates', async () => {
    const extras = {
      ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: 'Texto proprio {{contactName}}\n{{recentMessagesText}}', version: 3, is_active: true, updated_at: '2026-09-01T00:00:00Z' }],
    };
    const { legado, agente } = await provar({}, extras);
    expect(legado.resultado.source).toBe('override');
    expect(agente.prompt).toBe(legado.prompt);
    expect(agente.resultado.promptSha256).toBe(legado.resultado.promptSha256);
  });

  it('o teste enxerga diferença (caso positivo): um espaço a mais na versão muda o prompt e o sha', async () => {
    const { legado, agente } = await provar({ aiPromptKey: AURORA }, {}, (t) => `${t} `);
    expect(agente.prompt).not.toBe(legado.prompt);
    expect(agente.resultado.promptSha256).not.toBe(legado.resultado.promptSha256);
  });
});
```

- [ ] **Step 6: Rodar**

Run: `npx vitest run lib/conversations/aiReply.equivalencia.test.ts`
Expected: PASS (4 testes). Se algum dos três primeiros falhar, **parar**: o caminho do agente não é equivalente e a Task 6 tem que ser revista antes de qualquer outra.

- [ ] **Step 7: Commit**

```bash
git add test/helpers/fakeSupabaseAdmin.ts test/helpers/fakeSupabaseAdmin.test.ts lib/conversations/aiReply.equivalencia.test.ts
git diff --cached --stat
git commit -m "test(central-agentes): prova byte a byte do prompt enviado e do sha (legado x agente)"
```

---

### Task 8: O webhook com agente (guarda, chave nula, falha e metadata)

**Files:**
- Modify: `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:227-239, 289-298, 305-307`
- Test: `app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Central de Agentes, fatia 1: número com agente responde mesmo com aiPromptKey inválida (o prompt vem do
 * agente) e o gerador recebe a chave NULA, nunca `undefined` (que viraria o prompt padrão). O metadata
 * registra o sha do prompt em toda resposta nativa e agente e versão só com agente.
 */
const generateMock = vi.fn();
const executeMock = vi.fn();
const gateMock = vi.fn();
const recordFailureMock = vi.fn();
let debounceRow: { status: string; metadata: Record<string, unknown> } = { status: 'ai_active', metadata: {} };

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => buildFakeAdmin() }));
vi.mock('@/lib/conversations/aiReply', () => ({
  generateConversationAutoReply: (...args: unknown[]) => generateMock(...args),
  executeConversationAIReply: (...args: unknown[]) => executeMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: (...args: unknown[]) => gateMock(...args),
}));
vi.mock('@/lib/conversations/conversationAIFailure', () => ({
  recordConversationAIFailure: (...args: unknown[]) => recordFailureMock(...args),
}));
vi.mock('@/lib/conversations/conversationRateLimit', () => ({ consumeConversationRateLimit: vi.fn() }));
vi.mock('@/lib/conversations/n8nAutomation', () => ({ notifyConversationAutomation: vi.fn() }));

import { processDeferredAIReply } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const MESSAGE = '44444444-4444-4444-8444-444444444444';
const AGENTE = '55555555-5555-4555-8555-555555555555';
const SHA = 'a'.repeat(64);

function buildFakeAdmin() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        update: () => builder,
        maybeSingle: () => Promise.resolve({ data: debounceRow, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: table === 'conversation_messages' ? [] : null, error: null }).then(resolve);
        },
      });
      return builder;
    },
  };
}

function conexao(config: Record<string, unknown>, aiAgentId: string | null) {
  return { ok: true, connection: { id: CONNECTION, organization_id: TENANT, name: 'Aurora', config, ai_agent_id: aiAgentId } };
}

async function responder(aiPendingToken = `${MESSAGE}:${Date.now()}`) {
  debounceRow = { status: 'ai_active', metadata: { aiPendingToken } };
  await processDeferredAIReply({
    connectionId: CONNECTION,
    organizationId: TENANT,
    connectionName: 'Aurora',
    connectionProvider: 'evolution',
    connectionChannelType: 'whatsapp',
    connectionConfig: { aiEnabled: true },
    threadId: THREAD,
    contactId: null,
    dealId: null,
    contactName: 'Pedro',
    canonicalPhone: '5511999990000',
    insertedMessageId: MESSAGE,
    inboundText: 'oi',
    aiPendingToken,
    aiDebounceMs: 0,
    automationWebhookUrl: '',
    expectedSecret: 'secret',
    requestSecret: 'secret',
    requestOrigin: 'http://localhost:3000',
  });
}

const RESPOSTA = {
  replyText: 'Oi! Aqui e a Aurora.', summary: null, shouldHandoff: false, handoffType: null, handoffReason: null,
  requestedScheduleAt: null, requestedScheduleText: null, leadEmail: null, leadSegment: null, leadName: null,
  leadCompany: null, capacityGate: null, suggestedTags: null, conversationEnded: false,
};
const MEDICAO = { total_ms: 1, setup_ms: 0, calendar_ms: 0, model_ms: 1, model_http_calls: 1, model_http_errors: [], generations: 1, repaired: false };

beforeEach(() => {
  generateMock.mockReset();
  executeMock.mockReset();
  gateMock.mockReset();
  recordFailureMock.mockReset();
  executeMock.mockResolvedValue({ ok: true, warning: null, status: 'ai_active', thread: { metadata: {} } });
  recordFailureMock.mockResolvedValue({ ok: true });
});

describe('webhook e o agente do número', () => {
  it('número com agente responde mesmo com chave inválida, passa a chave nula e grava agente, versão e sha', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true, aiPromptKey: 'chave_invalida' }, AGENTE));
    generateMock.mockResolvedValue({ ok: true, source: 'agent', promptSha256: SHA, agent: { id: AGENTE, version: 3 }, timing: MEDICAO, object: RESPOSTA });

    await responder();

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0].promptKey).toBeNull();
    const metadata = executeMock.mock.calls[0][0].payload.metadata;
    expect(metadata).toMatchObject({ prompt_source: 'agent', prompt_sha256: SHA, agent_id: AGENTE, agent_version: 3 });
  });

  it('número sem agente e chave inválida continua sem responder (missing_prompt, como hoje)', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true, aiPromptKey: 'chave_invalida' }, null));

    await responder();

    expect(generateMock).not.toHaveBeenCalled();
  });

  it('número sem agente grava o sha do prompt e não ganha chave de agente', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true }, null));
    generateMock.mockResolvedValue({ ok: true, source: 'default', promptSha256: SHA, agent: null, timing: MEDICAO, object: RESPOSTA });

    await responder();

    expect(generateMock.mock.calls[0][0].promptKey).toBe('task_conversations_whatsapp_auto_reply');
    const metadata = executeMock.mock.calls[0][0].payload.metadata;
    expect(metadata).toMatchObject({ prompt_source: 'default', prompt_sha256: SHA });
    expect('agent_id' in metadata).toBe(false);
    expect('agent_version' in metadata).toBe(false);
  });

  it('agente indisponível conta como falha de configuração', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true }, AGENTE));
    generateMock.mockResolvedValue({ ok: false, reason: 'agent_unavailable' });

    await responder();

    expect(executeMock).not.toHaveBeenCalled();
    expect(recordFailureMock).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'configuration',
      errorMessage: 'skipped: agent_unavailable',
    }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts"`
Expected: FAIL no primeiro teste (`generateMock` não é chamado porque `promptKey` é nulo), no terceiro (`prompt_sha256` ausente) e no quarto (`stage` sai `generation`).

- [ ] **Step 3: Implementar no `route.ts`**

A chamada da geração (linhas 227-239) passa a ser:

```ts
    // Central de Agentes: número com agente responde pelo agente mesmo com a chave da conexão inválida.
    // A chave vai como está (`null` quando inválida): `undefined` faria o gerador cair no prompt padrão.
    const nativeReply = (promptKey || freshConnection.ai_agent_id) ? await generateConversationAutoReply({
      admin,
      organizationId,
      connectionId,
      contactName,
      contactPhone: canonicalPhone,
      recentMessages,
      promptKey,
      closing: closingEligibility?.eligible
        ? { handoff: closingEligibility.handoff, repliesUsed: closingEligibility.repliesUsed }
        : null,
      threadMetadata: latestThreadMetadata,
    }) : { ok: false as const, reason: 'missing_prompt' as const };
```

No metadata (linha 292), logo depois de `prompt_source: nativeReply.source,`:

```ts
            // Impressão digital do prompt usado: prova qual texto respondeu, com ou sem agente.
            prompt_sha256: nativeReply.promptSha256,
            // Central de Agentes: qual versão respondeu. Só aparece em número com agente, para não criar chave
            // nula nas respostas de hoje (chave JSON nula parece presente em `metadata ? 'x'`).
            ...(nativeReply.agent ? { agent_id: nativeReply.agent.id, agent_version: nativeReply.agent.version } : {}),
```

Na classificação da falha (linhas 305-307):

```ts
      nativeFailureStage = nativeReply.reason === 'missing_api_key'
        || nativeReply.reason === 'missing_prompt'
        || nativeReply.reason === 'agent_unavailable'
        ? 'configuration'
        : 'generation';
```

- [ ] **Step 4: Rodar e ver passar (e as suítes do webhook)**

Run: `npx vitest run "app/api/public/channels/evolution/[connectionId]/webhook/"`
Expected: PASS em `route.agente.test.ts` e em todos os `route.*.test.ts` existentes (nenhum deles compara o metadata inteiro nem `prompt_source`; conferido em 29/09).

- [ ] **Step 5: Commit**

```bash
git add "app/api/public/channels/evolution/[connectionId]/webhook/route.ts" "app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts"
git diff --cached --stat
git commit -m "feat(central-agentes): webhook responde pelo agente e registra versao e sha do prompt"
```

---

### Task 9: A rota do n8n não grava rastro nativo

A rota externa (`ai-reply`) aceita `metadata` livre (até 20 chaves), e o merge só protege as chaves do sistema. O rastro nativo entra pela mesma porta (`payload.metadata`), então a proteção tem que ficar na rota do n8n. Sem ela, quem tem o segredo do webhook grava `prompt_sha256` e forja a prova da migração.

É a única mudança desta fatia para número sem agente, além do `prompt_sha256` novo, e a SPEC a declara como exceção (Runtime, item 7; revisão do Codex, achado 9). No código, só o webhook escreve essas chaves e ninguém as lê em mensagem do n8n; os fluxos do n8n são conferidos antes de publicar (Task 13).

**Files:**
- Modify: `lib/conversations/conversationDeliveryMetadata.ts`
- Modify: `lib/conversations/conversationDeliveryMetadata.test.ts`
- Modify: `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts` (import e a linha `metadata: parsed.data.metadata,`)
- Test: `app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Em `lib/conversations/conversationDeliveryMetadata.test.ts`, trocar o import e acrescentar um `describe` depois do que já existe:

```ts
import { describe, expect, it } from 'vitest';
import {
  NATIVE_TRACE_METADATA_KEYS,
  mergeConversationDeliveryMetadata,
  stripNativeTraceMetadata,
} from './conversationDeliveryMetadata';
```

```ts
describe('rastro da resposta nativa', () => {
  it('tira só as chaves de rastro do metadata externo', () => {
    expect(stripNativeTraceMetadata({
      native_ai: true,
      prompt_source: 'agent',
      prompt_sha256: 'a'.repeat(64),
      agent_id: 'forjado',
      agent_version: 9,
      ai_timing: { total_ms: 1 },
      campaign: 'meta-cenno',
    })).toEqual({ campaign: 'meta-cenno' });
  });

  it('a lista cobre as seis chaves que a prova da migração e a visão da agência leem', () => {
    expect([...NATIVE_TRACE_METADATA_KEYS].sort()).toEqual(
      ['agent_id', 'agent_version', 'ai_timing', 'native_ai', 'prompt_sha256', 'prompt_source'],
    );
  });

  it('sem metadata, devolve undefined', () => {
    expect(stripNativeTraceMetadata(undefined)).toBeUndefined();
  });
});
```

Criar `app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeConversationAIReplyMock = vi.fn();
const maybeSingleMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: maybeSingleMock }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/conversations/aiReply', () => ({
  executeConversationAIReply: (...args: unknown[]) => executeConversationAIReplyMock(...args),
}));

import { POST } from './route';

const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = 'segredo-da-conexao';

function request(body: Record<string, unknown>) {
  return POST(new Request(
    `http://localhost:3000/api/public/channels/evolution/${CONNECTION_ID}/ai-reply`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': SECRET },
      body: JSON.stringify(body),
    },
  ), { params: Promise.resolve({ connectionId: CONNECTION_ID }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 60 }], error: null });
  maybeSingleMock.mockResolvedValue({
    data: {
      id: CONNECTION_ID,
      organization_id: '11111111-1111-4111-8111-111111111111',
      name: 'Comercial',
      config: { webhookSecret: SECRET, aiEnabled: true },
    },
    error: null,
  });
  executeConversationAIReplyMock.mockResolvedValue({ ok: true, warning: null });
});

describe('rota do n8n e o rastro nativo', () => {
  it('descarta as chaves de rastro e mantém o resto do metadata', async () => {
    const response = await request({
      threadId: THREAD_ID,
      replyText: 'Oi!',
      metadata: {
        native_ai: true,
        prompt_source: 'agent',
        prompt_sha256: 'a'.repeat(64),
        agent_id: 'forjado',
        agent_version: 99,
        ai_timing: { total_ms: 1 },
        campanha: 'meta',
      },
    });

    expect(response.status).toBe(200);
    const payload = executeConversationAIReplyMock.mock.calls[0][0].payload;
    expect(payload.metadata).toEqual({ campanha: 'meta' });
    expect(payload.automationSource).toBe('n8n');
  });

  it('sem metadata, continua sem metadata', async () => {
    await request({ threadId: THREAD_ID, replyText: 'Oi!' });
    expect(executeConversationAIReplyMock.mock.calls[0][0].payload.metadata).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/"`
Expected: FAIL: `stripNativeTraceMetadata` não existe, e a rota repassa `prompt_sha256` e as outras chaves.

- [ ] **Step 3: Implementar**

Em `lib/conversations/conversationDeliveryMetadata.ts`, depois de `mergeConversationDeliveryMetadata`:

```ts
/**
 * Chaves que só o caminho nativo grava (webhook → gerador). A rota externa do n8n aceita metadata livre, e
 * o merge acima só protege as chaves do sistema: sem esta limpeza, quem tem o segredo do webhook forjaria a
 * prova da migração da Central de Agentes (`prompt_sha256`) e os números da visão da agência.
 */
export const NATIVE_TRACE_METADATA_KEYS = [
  'native_ai',
  'prompt_source',
  'prompt_sha256',
  'agent_id',
  'agent_version',
  'ai_timing',
] as const;

export function stripNativeTraceMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return undefined;
  const cleaned = { ...metadata };
  for (const key of NATIVE_TRACE_METADATA_KEYS) delete cleaned[key];
  return cleaned;
}
```

Em `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts`, o import:

```ts
import { stripNativeTraceMetadata } from '@/lib/conversations/conversationDeliveryMetadata';
```

e, no payload de `executeConversationAIReply`, trocar `metadata: parsed.data.metadata,` por:

```ts
        metadata: stripNativeTraceMetadata(parsed.data.metadata),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/"`
Expected: PASS (4 testes no metadata, 2 em `route.rastro.test.ts`, e o `route.aiGate.test.ts` que já existia).

- [ ] **Step 5: Commit**

```bash
git add lib/conversations/conversationDeliveryMetadata.ts lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts" "app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts"
git diff --cached --stat
git commit -m "fix(conversas): rota do n8n nao grava as chaves de rastro da resposta nativa"
```

---

### Task 10: Módulo de migração com prova contra a produção

A prova antiga comparava o script com ele mesmo: se o cálculo errasse, a v1 e a nova prova erravam igual e o hash batia (revisão adversarial, B1). Agora a referência é o `prompt_sha256` que a **produção** gravou na última resposta nativa de cada número (Task 8), e toda leitura é estrita. A revisão do Codex fechou mais quatro buracos, e todos entram aqui:
- quem escolhe a resposta é a função do banco `central_agentes_ultima_resposta_nativa`, que olha todas as conversas do número (achado 11);
- vale a última resposta entregue, uma linha por resposta, e sem sha válido a prova falha fechada (achado 12);
- quem liga é `central_agentes_ligar_conexao`, que confere tudo de novo numa transação só (achado 13);
- as conexões são lidas em páginas, o agente candidato é achado por filtro no banco (achado 18), e desligar confirma a linha (achado 19).

Situações de cada número na prova:
- `CONFERE`: o sha calculado é igual ao da última resposta nativa entregue;
- `DIVERGE`: os dois sha são diferentes;
- `RESPOSTA_SEM_SHA`: a última resposta entregue não tem sha válido (a prova não volta para uma resposta anterior);
- `SEM_RESPOSTA_AINDA`: nenhuma resposta nativa entregue nas conversas do número.

Só grupo com todos os números em `CONFERE` vira agente, e só a função do banco liga. A trava de que a cópia é o commit publicado fica no script (Task 11), porque depende do git.

**Files:**
- Modify: `test/helpers/fakeSupabaseAdmin.ts` (limite de linhas opcional; resposta de RPC por argumento)
- Modify: `test/helpers/fakeSupabaseAdmin.test.ts`
- Create: `lib/agents/migracaoAgentes.ts`
- Test: `lib/agents/migracaoAgentes.test.ts`

- [ ] **Step 1: Testes do banco falso que falham**

Acrescentar em `test/helpers/fakeSupabaseAdmin.test.ts`:

```ts
describe('banco falso: limite de linhas e RPC por argumento', () => {
  it('maxLinhas corta a leitura como o limite de linhas do PostgREST', async () => {
    const linhas = { t: Array.from({ length: 5 }, (_, i) => ({ id: String(i) })) };
    const { data } = await createFakeSupabaseAdmin(linhas, { maxLinhas: 3 }).from('t').select('id');
    expect(data).toHaveLength(3);
  });

  it('rpcResults aceita uma função dos argumentos', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcResults.eco = (args: Record<string, unknown>) => [{ recebido: args.x }];
    expect((await admin.rpc('eco', { x: 7 })).data).toEqual([{ recebido: 7 }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: FAIL nos dois testes novos.

- [ ] **Step 3: Limite de linhas e RPC por argumento no banco falso**

Em `FakeSupabaseAdminOptions` (Task 4), acrescentar:

```ts
  /** Corta toda leitura neste número de linhas, como o `max_rows` do PostgREST (1.000 no local). */
  maxLinhas?: number;
```

Em `run()`, logo depois de `if (limitCount !== null) selected = selected.slice(0, limitCount);`:

```ts
      if (opcoes.maxLinhas !== undefined) selected = selected.slice(0, opcoes.maxLinhas);
```

E o `rpc` passa a aceitar resultado em função dos argumentos:

```ts
  function rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ name, args });
    const message = rpcErrors[name];
    if (message) return Promise.resolve({ data: null, error: { message } });
    const result = rpcResults[name];
    const data = typeof result === 'function' ? (result as (a: Record<string, unknown>) => unknown)(args) : result ?? null;
    return Promise.resolve({ data, error: null });
  }
```

(o comentário de `rpcResults` passa a dizer "valor fixo, ou função dos argumentos").

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Escrever o teste do módulo que falha**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import {
  criarAgentes,
  desligarConexao,
  ligarConexao,
  planejarMigracao,
  sha256Hex,
  ultimaRespostaNativa,
} from './migracaoAgentes';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const TEXTO_AURORA = getPromptCatalogMap()[AURORA].defaultTemplate;
const SHA_AURORA = sha256Hex(TEXTO_AURORA);
const RESPOSTA_EM = '2026-09-30T11:00:00+00:00';

function conexao(id: string, org: string, config: Record<string, unknown>, aiAgentId: string | null = null) {
  return { id, organization_id: org, name: `Numero ${id}`, provider: 'evolution', channel_type: 'whatsapp', config, ai_agent_id: aiAgentId };
}

/** A última resposta nativa entregue de cada número, como a função do banco devolveria (null = sem sha). */
function comRespostas(admin: FakeSupabaseAdmin, porNumero: Record<string, string | null>) {
  admin.rpcResults.central_agentes_ultima_resposta_nativa = (args: Record<string, unknown>) => {
    const id = String(args.p_connection_id);
    return id in porNumero ? [{ out_sha256: porNumero[id], out_sent_at: RESPOSTA_EM }] : [];
  };
  return admin;
}

describe('prova contra a produção', () => {
  it('lê o sha e a data pela função do banco', async () => {
    const admin = comRespostas(createFakeSupabaseAdmin(), { c1: 'b'.repeat(64) });
    expect(await ultimaRespostaNativa(admin as never, { id: 'c1' })).toEqual({ sha256: 'b'.repeat(64), sentAt: RESPOSTA_EM });
    expect(admin.rpcCalls).toEqual([{ name: 'central_agentes_ultima_resposta_nativa', args: { p_connection_id: 'c1' } }]);
  });

  it('sem resposta devolve null; resposta com sha fora do formato devolve sha nulo', async () => {
    const admin = comRespostas(createFakeSupabaseAdmin(), { c2: 'nao-e-sha', c3: null });
    expect(await ultimaRespostaNativa(admin as never, { id: 'c1' })).toBeNull();
    expect(await ultimaRespostaNativa(admin as never, { id: 'c2' })).toEqual({ sha256: null, sentAt: RESPOSTA_EM });
    expect(await ultimaRespostaNativa(admin as never, { id: 'c3' })).toEqual({ sha256: null, sentAt: RESPOSTA_EM });
  });

  it('erro da função aborta em vez de devolver vazio', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcErrors.central_agentes_ultima_resposta_nativa = 'boom';
    await expect(ultimaRespostaNativa(admin as never, { id: 'c1' })).rejects.toThrow('boom');
  });
});

describe('migração do prompt de hoje para agentes', () => {
  it('agrupa por organização e prompt, e marca cada número com a situação na produção', async () => {
    const admin = comRespostas(createFakeSupabaseAdmin({
      channel_connections: [
        conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA, aiAgentName: 'Aurora' }),
        conexao('c2', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c3', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c4', OUTRA, { aiEnabled: true, aiPromptKey: AURORA }),
      ],
    }), { c1: SHA_AURORA, c2: 'f'.repeat(64), c3: null });
    const plano = await planejarMigracao(admin as never);
    expect(plano.grupos).toHaveLength(2);
    const doOrg = plano.grupos.find((g) => g.organizationId === ORG)!;
    expect(doOrg).toMatchObject({ promptKey: AURORA, promptSource: 'default', sha256: SHA_AURORA, nome: 'Aurora', pronto: false });
    expect(doOrg.conexoes).toEqual([
      { id: 'c1', name: 'Numero c1', situacao: 'CONFERE', respostaEm: RESPOSTA_EM },
      { id: 'c2', name: 'Numero c2', situacao: 'DIVERGE', respostaEm: RESPOSTA_EM },
      { id: 'c3', name: 'Numero c3', situacao: 'RESPOSTA_SEM_SHA', respostaEm: RESPOSTA_EM },
    ]);
    const daOutra = plano.grupos.find((g) => g.organizationId === OUTRA)!;
    expect(daOutra.conexoes[0]).toMatchObject({ situacao: 'SEM_RESPOSTA_AINDA', respostaEm: null });
  });

  it('com todos os números em CONFERE o grupo fica pronto', async () => {
    const admin = comRespostas(createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
    }), { c1: SHA_AURORA });
    const plano = await planejarMigracao(admin as never);
    expect(plano.grupos[0]).toMatchObject({ pronto: true });
  });

  it('ignora número já ligado, sem IA e com chave inválida; --incluir força o sem IA', async () => {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [
        conexao('ligada', ORG, { aiEnabled: true, aiPromptKey: AURORA }, 'agente-x'),
        conexao('sem-ia', ORG, { aiEnabled: false }),
        conexao('invalida', ORG, { aiEnabled: true, aiPromptKey: 'chave_invalida' }),
      ],
    });
    const plano = await planejarMigracao(admin as never);
    expect(plano.grupos).toHaveLength(0);
    expect(plano.ignoradas.map((i) => [i.id, i.motivo])).toEqual([
      ['invalida', 'chave_invalida'],
      ['ligada', 'ja_ligada'],
      ['sem-ia', 'sem_ia'],
    ]);
    const forcado = await planejarMigracao(admin as never, { incluir: ['sem-ia'] });
    expect(forcado.grupos.map((g) => g.conexoes[0].id)).toEqual(['sem-ia']);
  });

  it('erro ao ler o override aborta o plano (nunca cai no catálogo)', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })] });
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    await expect(planejarMigracao(admin as never)).rejects.toThrow('boom');
  });

  it('lê todas as conexões, em páginas, acima do limite de linhas do PostgREST', async () => {
    const conexoes = Array.from({ length: 1001 }, (_, i) => conexao(`c${String(i).padStart(4, '0')}`, ORG, { aiEnabled: false }));
    const admin = createFakeSupabaseAdmin({ channel_connections: conexoes }, { maxLinhas: 1000 });
    const plano = await planejarMigracao(admin as never);
    expect(plano.ignoradas).toHaveLength(1001);
  });

  it('criarAgentes só cria grupo pronto, só da organização pedida, com o sha do próprio conteúdo', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcResults.create_ai_agent_from_legacy_prompt = [{ out_agent_id: 'a1', out_version_id: 'v1', out_created: true }];
    const pronto = {
      organizationId: ORG, promptKey: AURORA, promptSource: 'default' as const, conteudo: 'X', sha256: sha256Hex('X'), nome: 'Aurora', pronto: true,
      conexoes: [{ id: 'c1', name: 'n', situacao: 'CONFERE' as const, respostaEm: RESPOSTA_EM }],
    };
    const naoPronto = {
      ...pronto, conteudo: 'Y', sha256: sha256Hex('Y'), pronto: false,
      conexoes: [{ id: 'c2', name: 'm', situacao: 'DIVERGE' as const, respostaEm: RESPOSTA_EM }],
    };

    const r = await criarAgentes(admin as never, { organizationId: ORG, grupos: [pronto, naoPronto], catalogCommit: 'abc1234' });
    expect(r.criados).toEqual([{ organizationId: ORG, agentId: 'a1', criado: true }]);
    expect(r.pulados).toEqual([{ sha256: sha256Hex('Y'), conexoes: ['c2:DIVERGE'] }]);
    expect(admin.rpcCalls).toEqual([{
      name: 'create_ai_agent_from_legacy_prompt',
      args: {
        p_organization_id: ORG,
        p_name: 'Aurora',
        p_prompt: 'X',
        p_origin: { sha256: sha256Hex('X'), promptKey: AURORA, promptSource: 'default', conexoes: ['c1'], catalogCommit: 'abc1234' },
      },
    }]);

    await expect(criarAgentes(admin as never, { organizationId: OUTRA, grupos: [pronto], catalogCommit: null }))
      .rejects.toThrow('outra organizacao');
  });

  it('ligarConexao acha o agente no banco e manda para a função a chave bruta, a origem e o sha', async () => {
    const semear = () => createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [
        { id: 'a1', organization_id: ORG, published_version_id: 'v1', origin: { kind: 'migration', sha256: SHA_AURORA } },
        { id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } },
      ],
    });

    const certo = semear();
    certo.rpcResults.central_agentes_ligar_conexao = 'ligado';
    expect(await ligarConexao(certo as never, 'c1')).toEqual({ ok: true, agentId: 'a1' });
    expect(certo.rpcCalls).toEqual([{
      name: 'central_agentes_ligar_conexao',
      args: { p_connection_id: 'c1', p_agent_id: 'a1', p_chave_bruta: AURORA, p_prompt_key: AURORA, p_prompt_source: 'default', p_sha256: SHA_AURORA },
    }]);

    const recusado = semear();
    recusado.rpcResults.central_agentes_ligar_conexao = 'prova_nao_confere';
    expect(await ligarConexao(recusado as never, 'c1')).toEqual({ ok: false, motivo: 'prova_nao_confere' });
  });

  it('ligarConexao sem agente criado para aquele sha não chama a função', async () => {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [{ id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } }],
    });
    expect(await ligarConexao(admin as never, 'c1')).toEqual({ ok: false, motivo: 'agente_nao_criado' });
    expect(admin.rpcCalls).toEqual([]);
  });

  it('desligarConexao confirma a linha desligada e distingue número inexistente', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true }, 'a1')] });
    expect(await desligarConexao(admin as never, 'c1')).toEqual({ ok: true });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
    expect(await desligarConexao(admin as never, 'nao-existe')).toEqual({ ok: false, detalhe: 'conexao_inexistente' });
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run lib/agents/migracaoAgentes.test.ts`
Expected: FAIL com "Failed to resolve import ./migracaoAgentes".

- [ ] **Step 7: Criar `lib/agents/migracaoAgentes.ts`**

```ts
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPromptResolvidoEstrito } from '@/lib/ai/prompts/resolve';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';

// Sem 'server-only': usado pelo script scripts/central-agentes/migrar-agentes.ts, fora do Next.
// Toda leitura aqui é ESTRITA: erro de banco lança e aborta o script. Nunca cair no catálogo por erro.

export function sha256Hex(texto: string) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Página da leitura de conexões: abaixo do `max_rows` do PostgREST (1.000 no local). */
const PAGINA = 500;

type ConexaoLida = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
  ai_agent_id: string | null;
};

export type SituacaoNaProducao = 'CONFERE' | 'DIVERGE' | 'RESPOSTA_SEM_SHA' | 'SEM_RESPOSTA_AINDA';

export type ConexaoDoGrupo = {
  id: string;
  name: string;
  situacao: SituacaoNaProducao;
  /** `sent_at` da resposta nativa usada na prova. */
  respostaEm: string | null;
};

export type GrupoPlanejado = {
  organizationId: string;
  promptKey: string;
  promptSource: 'override' | 'default';
  conteudo: string;
  sha256: string;
  nome: string;
  conexoes: ConexaoDoGrupo[];
  /** Só com todos os números em CONFERE o grupo pode virar agente. */
  pronto: boolean;
};

export type ConexaoIgnorada = {
  id: string;
  name: string;
  organizationId: string;
  motivo: 'ja_ligada' | 'sem_ia' | 'chave_invalida' | 'prompt_inexistente';
};

/**
 * O sha que a PRODUÇÃO gravou na última resposta nativa entregue deste número (metadata.prompt_sha256).
 * É a prova independente: o script calcula o prompt com o código da cópia onde roda, e a trava do
 * script garante que essa cópia é o commit publicado. Quem escolhe a resposta é a função do banco
 * central_agentes_ultima_resposta_nativa, entre TODAS as conversas do número. Sem sha válido nela,
 * volta `sha256: null` e a prova falha fechada.
 */
export async function ultimaRespostaNativa(
  admin: SupabaseClient,
  conexao: { id: string },
): Promise<{ sha256: string | null; sentAt: string } | null> {
  const { data, error } = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao.id });
  if (error) throw new Error(`Falha ao ler a ultima resposta do numero ${conexao.id}: ${error.message}`);
  const [linha] = (data ?? []) as Array<{ out_sha256: string | null; out_sent_at: string }>;
  if (!linha) return null;
  const sha256 = typeof linha.out_sha256 === 'string' && SHA256_HEX.test(linha.out_sha256) ? linha.out_sha256 : null;
  return { sha256, sentAt: linha.out_sent_at };
}

function situacaoNaProducao(shaCalculado: string, producao: { sha256: string | null } | null): SituacaoNaProducao {
  if (!producao) return 'SEM_RESPOSTA_AINDA';
  if (!producao.sha256) return 'RESPOSTA_SEM_SHA';
  return producao.sha256 === shaCalculado ? 'CONFERE' : 'DIVERGE';
}

/** Todas as conexões de WhatsApp, em páginas por id: o PostgREST corta leitura grande sem erro. */
async function lerConexoes(admin: SupabaseClient, organizationId?: string): Promise<ConexaoLida[]> {
  const todas: ConexaoLida[] = [];
  let depoisDe: string | null = null;
  for (;;) {
    let consulta = admin
      .from('channel_connections')
      .select('id, organization_id, name, config, ai_agent_id')
      .eq('provider', 'evolution')
      .eq('channel_type', 'whatsapp');
    if (organizationId) consulta = consulta.eq('organization_id', organizationId);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA);
    if (error) throw new Error(`Falha ao ler conexoes: ${error.message}`);
    const pagina = (data ?? []) as ConexaoLida[];
    todas.push(...pagina);
    if (pagina.length < PAGINA) return todas;
    depoisDe = pagina[pagina.length - 1].id;
  }
}

/** Só leitura. Um grupo por (organização, sha256 do prompt efetivo de hoje), com a situação de cada número. */
export async function planejarMigracao(
  admin: SupabaseClient,
  filtro: { organizationId?: string; incluir?: string[] } = {},
): Promise<{ grupos: GrupoPlanejado[]; ignoradas: ConexaoIgnorada[] }> {
  const incluir = new Set(filtro.incluir ?? []);
  const grupos = new Map<string, GrupoPlanejado>();
  const ignoradas: ConexaoIgnorada[] = [];

  for (const conexao of await lerConexoes(admin, filtro.organizationId)) {
    const base = { id: conexao.id, name: conexao.name, organizationId: conexao.organization_id };
    const config = conexao.config ?? {};
    if (conexao.ai_agent_id) {
      ignoradas.push({ ...base, motivo: 'ja_ligada' });
      continue;
    }
    if (!incluir.has(conexao.id) && config.aiEnabled !== true && typeof config.aiPromptKey !== 'string') {
      ignoradas.push({ ...base, motivo: 'sem_ia' });
      continue;
    }
    const { agentName, promptKey } = resolveConversationAIAgentConfig(config);
    if (!promptKey) {
      // Hoje este número responde missing_prompt; virar agente faria ele passar a responder.
      ignoradas.push({ ...base, motivo: 'chave_invalida' });
      continue;
    }
    const resolvido = await buscarPromptResolvidoEstrito(admin, conexao.organization_id, promptKey);
    if (!resolvido) {
      ignoradas.push({ ...base, motivo: 'prompt_inexistente' });
      continue;
    }
    const sha256 = sha256Hex(resolvido.content);
    const producao = await ultimaRespostaNativa(admin, conexao);
    const item: ConexaoDoGrupo = {
      id: conexao.id,
      name: conexao.name,
      situacao: situacaoNaProducao(sha256, producao),
      respostaEm: producao?.sentAt ?? null,
    };

    const chave = `${conexao.organization_id}:${sha256}`;
    const existente = grupos.get(chave);
    if (existente) {
      existente.conexoes.push(item);
      continue;
    }
    grupos.set(chave, {
      organizationId: conexao.organization_id,
      promptKey,
      promptSource: resolvido.source,
      conteudo: resolvido.content,
      sha256,
      nome: agentName,
      conexoes: [item],
      pronto: false,
    });
  }

  const lista = [...grupos.values()];
  for (const grupo of lista) grupo.pronto = grupo.conexoes.every((c) => c.situacao === 'CONFERE');
  return { grupos: lista, ignoradas };
}

/**
 * Cria (ou reencontra, pela idempotência do banco) o agente com a v1 de cada grupo PRONTO da organização
 * pedida. Grupo com algum número fora de CONFERE volta em `pulados`. Não liga número.
 */
export async function criarAgentes(
  admin: SupabaseClient,
  entrada: { organizationId: string; grupos: GrupoPlanejado[]; catalogCommit: string | null },
) {
  const deOutra = entrada.grupos.find((g) => g.organizationId !== entrada.organizationId);
  if (deOutra) {
    throw new Error(`Grupo de outra organizacao (${deOutra.organizationId}) na criacao de ${entrada.organizationId}.`);
  }

  const criados: Array<{ organizationId: string; agentId: string; criado: boolean }> = [];
  const pulados: Array<{ sha256: string; conexoes: string[] }> = [];
  for (const grupo of entrada.grupos) {
    if (!grupo.pronto) {
      pulados.push({ sha256: grupo.sha256, conexoes: grupo.conexoes.map((c) => `${c.id}:${c.situacao}`) });
      continue;
    }
    const { data, error } = await admin.rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: grupo.organizationId,
      p_name: grupo.nome,
      p_prompt: grupo.conteudo,
      p_origin: {
        sha256: grupo.sha256,
        promptKey: grupo.promptKey,
        promptSource: grupo.promptSource,
        conexoes: grupo.conexoes.map((c) => c.id),
        catalogCommit: entrada.catalogCommit,
      },
    });
    if (error) throw new Error(`Falha ao criar agente (${grupo.organizationId}): ${error.message}`);
    const [linha] = (data ?? []) as Array<{ out_agent_id: string; out_created: boolean }>;
    if (!linha) throw new Error(`Funcao nao devolveu o agente (${grupo.organizationId})`);
    criados.push({ organizationId: grupo.organizationId, agentId: linha.out_agent_id, criado: linha.out_created });
  }
  return { criados, pulados };
}

/** Motivos com que a função do banco central_agentes_ligar_conexao recusa. */
export type MotivoDoBanco =
  | 'sha_invalido'
  | 'conexao_inexistente'
  | 'ja_ligada'
  | 'chave_mudou'
  | 'override_mudou'
  | 'origem_invalida'
  | 'versao_publicada_diverge'
  | 'prova_nao_confere';

export type ResultadoLigar =
  | { ok: true; agentId: string }
  | { ok: false; motivo: MotivoDoBanco | 'chave_invalida' | 'prompt_inexistente' | 'agente_nao_criado' };

/**
 * Calcula o prompt de hoje, acha o agente de migração com o mesmo sha e pede ao banco para ligar. A função
 * do banco confere tudo de novo numa transação só (chave, override, versão publicada e a última resposta da
 * produção), com a linha do número travada, e devolve o motivo quando recusa.
 */
export async function ligarConexao(admin: SupabaseClient, connectionId: string): Promise<ResultadoLigar> {
  const lida = await admin
    .from('channel_connections')
    .select('id, organization_id, name, config, ai_agent_id')
    .eq('id', connectionId)
    .maybeSingle();
  if (lida.error) throw new Error(`Falha ao ler o numero ${connectionId}: ${lida.error.message}`);
  const conexao = lida.data as ConexaoLida | null;
  if (!conexao) return { ok: false, motivo: 'conexao_inexistente' };
  if (conexao.ai_agent_id) return { ok: false, motivo: 'ja_ligada' };

  const config = conexao.config ?? {};
  const { promptKey } = resolveConversationAIAgentConfig(config);
  if (!promptKey) return { ok: false, motivo: 'chave_invalida' };
  const resolvido = await buscarPromptResolvidoEstrito(admin, conexao.organization_id, promptKey);
  if (!resolvido) return { ok: false, motivo: 'prompt_inexistente' };
  const sha256 = sha256Hex(resolvido.content);

  const candidato = await admin
    .from('ai_agents')
    .select('id')
    .eq('organization_id', conexao.organization_id)
    .eq('origin->>kind', 'migration')
    .eq('origin->>sha256', sha256)
    .maybeSingle();
  if (candidato.error) throw new Error(`Falha ao ler o agente candidato: ${candidato.error.message}`);
  const agentId = (candidato.data as { id: string } | null)?.id;
  if (!agentId) return { ok: false, motivo: 'agente_nao_criado' };

  const { data, error } = await admin.rpc('central_agentes_ligar_conexao', {
    p_connection_id: connectionId,
    p_agent_id: agentId,
    p_chave_bruta: typeof config.aiPromptKey === 'string' ? config.aiPromptKey : null,
    p_prompt_key: promptKey,
    p_prompt_source: resolvido.source,
    p_sha256: sha256,
  });
  if (error) throw new Error(`Falha ao ligar o numero ${connectionId}: ${error.message}`);
  if (data === 'ligado') return { ok: true, agentId };
  return { ok: false, motivo: data as MotivoDoBanco };
}

/** Volta o número ao caminho de hoje, confirmando a linha. O config da conexão nunca foi tocado. */
export async function desligarConexao(admin: SupabaseClient, connectionId: string): Promise<{ ok: true } | { ok: false; detalhe: string }> {
  const { data, error } = await admin
    .from('channel_connections')
    .update({ ai_agent_id: null })
    .eq('id', connectionId)
    .select('id');
  if (error) return { ok: false, detalhe: error.message };
  if (!data || data.length === 0) return { ok: false, detalhe: 'conexao_inexistente' };
  return { ok: true };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run lib/agents/ test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS (agentRuntime, migracaoAgentes com 12 testes, e o banco falso).

- [ ] **Step 9: Commit**

```bash
git add test/helpers/fakeSupabaseAdmin.ts test/helpers/fakeSupabaseAdmin.test.ts lib/agents/migracaoAgentes.ts lib/agents/migracaoAgentes.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): migracao com prova e ligacao pelas funcoes do banco"
```

---

### Task 11: Script de linha de comando

A prova compara o prompt calculado nesta cópia com o que a produção gravou. Isso só vale se a cópia for o código publicado: comparar só o sha deixava passar uma publicação nova feita depois da última resposta (revisão do Codex, achado 10). Por isso `--prova`, `--criar` e `--ligar` exigem `--ramo-publicado`, fazem `git fetch` e só seguem com `HEAD == origin/<ramo>` e sem mudança local nos arquivos que decidem o prompt. Premissa: o ambiente só publica a partir desse ramo; se a publicação estiver atrás dele, a última resposta veio do texto antigo e a prova dá `DIVERGE`.

**Files:**
- Create: `scripts/central-agentes/migrar-agentes.ts`

- [ ] **Step 1: Criar o script**

```ts
/**
 * Central de Agentes, fatia 1 — migração do prompt de hoje para agentes.
 *
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova --ramo-publicado <ramo> [--org <uuid>] [--incluir <id,id>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --criar --org <uuid> --ramo-publicado <ramo> --confirmar-banco <ref> [--incluir <id,id>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --ligar <connectionId> --ramo-publicado <ramo> --confirmar-banco <ref>
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --desligar <connectionId> --confirmar-banco <ref>
 *
 * <ramo> é o que o ambiente publica: `main` em produção; a branch da prévia no teste. A prova só vale com
 * esta cópia exatamente no commit publicado (HEAD == origin/<ramo>, depois de um fetch) e sem mudança local
 * nos arquivos que decidem o prompt. Premissa: o ambiente só publica a partir desse ramo; se a publicação
 * estiver atrás dele, a última resposta veio do texto antigo e a prova dá DIVERGE, nunca um CONFERE falso.
 *
 * Credenciais no ambiente (nunca impressas): NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_URL, e
 * SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY. Toda escrita exige --confirmar-banco com a
 * referência do projeto que o script imprime, para nunca escrever no banco errado.
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  criarAgentes,
  desligarConexao,
  ligarConexao,
  planejarMigracao,
  type ConexaoIgnorada,
  type GrupoPlanejado,
} from '@/lib/agents/migracaoAgentes';

const ARQUIVOS_DO_PROMPT = ['lib/ai/prompts', 'lib/agents', 'lib/conversations/aiAgentConfig.ts'];

function argumento(nome: string) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(nome);

function referenciaDoBanco(url: string) {
  const host = new URL(url).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return 'local';
  return host.split('.')[0];
}

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function imprimirPlano(plano: { grupos: GrupoPlanejado[]; ignoradas: ConexaoIgnorada[] }) {
  for (const g of plano.grupos) {
    console.log(`AGENTE  org=${g.organizationId} chave=${g.promptKey} origem=${g.promptSource} sha256=${g.sha256.slice(0, 12)} caracteres=${g.conteudo.length} nome=${g.nome} pronto=${g.pronto ? 'sim' : 'nao'}`);
    for (const c of g.conexoes) {
      console.log(`        numero ${c.id} (${c.name}) producao=${c.situacao}${c.respostaEm ? ` resposta=${c.respostaEm}` : ''}`);
    }
  }
  for (const i of plano.ignoradas) console.log(`IGNORADA ${i.id} (${i.name}) org=${i.organizationId} motivo=${i.motivo}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error('Faltam NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL e SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY no ambiente.');
    process.exit(2);
  }
  const ref = referenciaDoBanco(url);
  const commit = git(['rev-parse', 'HEAD']);
  const promptAlterado = git(['status', '--porcelain', '--', ...ARQUIVOS_DO_PROMPT]) !== '';
  console.log(`Banco: ${ref}`);
  console.log(`Commit: ${commit}${promptAlterado ? ' (arquivos do prompt com mudanca local)' : ''}`);

  const escreve = tem('--criar') || tem('--ligar') || tem('--desligar');
  if (escreve && argumento('--confirmar-banco') !== ref) {
    console.error(`Escrita recusada: passe --confirmar-banco ${ref} para confirmar o banco.`);
    process.exit(2);
  }

  if (tem('--prova') || tem('--criar') || tem('--ligar')) {
    const ramo = argumento('--ramo-publicado');
    if (!ramo) {
      console.error('Passe --ramo-publicado <ramo>: main em producao; a branch da previa no teste.');
      process.exit(2);
    }
    git(['fetch', 'origin', ramo]);
    const publicado = git(['rev-parse', `origin/${ramo}`]);
    if (publicado !== commit) {
      console.error(`Recusado: esta copia esta em ${commit.slice(0, 7)} e ${ramo} publicado esta em ${publicado.slice(0, 7)}. A prova so vale com o codigo publicado.`);
      process.exit(2);
    }
    if (promptAlterado) {
      console.error(`Recusado: ha mudanca local em arquivo que decide o prompt (${ARQUIVOS_DO_PROMPT.join(', ')}).`);
      process.exit(2);
    }
  }

  const admin = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  const organizationId = argumento('--org');
  const incluir = (argumento('--incluir') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (tem('--criar')) {
    if (!organizationId) {
      console.error('--criar exige --org <uuid>: um cliente por vez.');
      process.exit(2);
    }
    const plano = await planejarMigracao(admin, { organizationId, incluir });
    imprimirPlano(plano);
    const r = await criarAgentes(admin, { organizationId, grupos: plano.grupos, catalogCommit: commit });
    for (const c of r.criados) console.log(`${c.criado ? 'CRIADO' : 'JA EXISTIA'} agente=${c.agentId} org=${c.organizationId}`);
    for (const p of r.pulados) console.log(`PULADO sha256=${p.sha256.slice(0, 12)} numeros=${p.conexoes.join(',')}`);
    return;
  }

  if (tem('--prova')) {
    imprimirPlano(await planejarMigracao(admin, { organizationId, incluir }));
    return;
  }

  const ligar = argumento('--ligar');
  if (ligar) {
    const r = await ligarConexao(admin, ligar);
    console.log(r.ok ? `LIGADO numero=${ligar} agente=${r.agentId}` : `NAO LIGOU numero=${ligar} motivo=${r.motivo}`);
    process.exit(r.ok ? 0 : 1);
  }

  const desligar = argumento('--desligar');
  if (desligar) {
    const r = await desligarConexao(admin, desligar);
    console.log(r.ok ? `DESLIGADO numero=${desligar}` : `NAO DESLIGOU numero=${desligar} (${r.detalhe})`);
    process.exit(r.ok ? 0 : 1);
  }

  console.error('Use --prova, --criar, --ligar <id> ou --desligar <id>.');
  process.exit(2);
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
```

- [ ] **Step 2: Conferir que compila e que as travas funcionam sem tocar banco**

Run: `npm run typecheck`
Expected: sem erros (`tsconfig.json` inclui `**/*.ts`, então `scripts/` é conferido).

Run (sem credenciais no ambiente): `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova`
Expected: "Faltam NEXT_PUBLIC_SUPABASE_URL..." e saída 2.

Com as credenciais do Supabase local no ambiente:
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova` → "Passe --ramo-publicado" e saída 2.
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova --ramo-publicado main` → "Recusado: esta copia esta em ..." e saída 2 (a branch local está à frente do `main`).
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --criar --confirmar-banco local --ramo-publicado main` → recusado antes de ler o banco.

- [ ] **Step 3: Commit**

```bash
git add scripts/central-agentes/migrar-agentes.ts
git diff --cached --stat
git commit -m "feat(central-agentes): script de migracao com trava de banco, de organizacao e da versao publicada"
```

---

### Task 12: Suíte completa, tipos e lint

- [ ] **Step 1: Rodar tudo (sem encadear commit)**

Run: `npm run test:run 2>&1 | tail -30`
Expected: a mesma contagem de falhas da linha de base da Preparação. Cada falha nova tem que ser explicada antes de seguir.

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm run lint`
Expected: sem avisos (`--max-warnings 0`).

- [ ] **Step 2: Local**

Run: `npm run test:local -- test/centralAgentesFundacao.local.test.ts`
Expected: PASS (12 testes).

- [ ] **Step 3: Atualizar a SPEC e o cérebro** com o que a implementação mostrou (apenas se algo mudou) e commitar.

---

### Task 13: Publicação (cada passo com o OK do Junior)

**Não seguir ao pé da letra** o rito `06-References/basecrm-rito-publicacao/LEIA-ME.md` (revisão do Codex, achado 7). Ele é da branch `feat/aurora-implantacao`:
- o passo 3 dele empurra para `main` **e** para a branch da Aurora;
- o `poll_deploys.py` só procura a prévia da branch da Aurora (linha 39) e espera também a produção.

Desta entrega valem os comandos abaixo. Do rito, só se usam:
- o `prova_login.py`;
- os `sqlteste.py`/`sqlprod.py` para leitura;
- o `poll_deploys.py` na produção, depois de a branch dele virar argumento com padrão `feat/aurora-implantacao` (assim o uso de hoje não muda).

- [ ] **Step 1: Banco de teste (`zvwngsrflkicbbzfmrgy`)**
  1. Aplicar a migration no banco de teste pelo MCP do Supabase (`apply_migration`) e corrigir a `version` em `supabase_migrations.schema_migrations` para `20260930000000`.
  2. Primeiro push da branch, sem build: um commit vazio com `[vercel skip]` na mensagem, e `git push origin HEAD:feat/central-agentes` (OK dele). Sem variáveis próprias, a prévia de uma branch nova recebe as variáveis genéricas de Preview, que apontam para o banco de **produção** (aprendizado de 19/09).
  3. Com a branch já no GitHub, criar na Vercel as variáveis de Preview restritas à branch `feat/central-agentes`, iguais às da `feat/aurora-implantacao` (URL e chaves do banco de teste). Lidas e gravadas em processo, nunca impressas.
  4. Commit vazio sem `[vercel skip]` e push da branch: agora a Vercel constrói a prévia.
  5. Esperar a prévia READY pela API da Vercel: `GET /v6/deployments?projectId=<projeto>&target=preview`, filtrando `meta.githubCommitRef = feat/central-agentes` e o sha, com o token lido do cofre em processo.
  6. Provar pelo pedido real de login que a prévia usa `zvwngsrflkicbbzfmrgy` (o `prova_login.py`, apontado para a URL da prévia). Só então apontar `teste.crm.basea2.com` para ela (`POST /v2/deployments/{id}/aliases`).
  7. Provocar uma mensagem de teste no número do ensaio e conferir que a resposta gravou `prompt_sha256`, com `prompt_source` igual ao de antes e sem `agent_id`.
  8. `--prova --org <organização do ensaio> --ramo-publicado feat/central-agentes`, com as credenciais do banco de teste no ambiente, lidas do cofre em processo e nunca impressas. O número tem que sair `CONFERE`.
  9. `--criar --org <organização do ensaio> --ramo-publicado feat/central-agentes --confirmar-banco zvwngsrflkicbbzfmrgy`.
  10. `--ligar <conexão do ensaio> --ramo-publicado feat/central-agentes --confirmar-banco zvwngsrflkicbbzfmrgy`.
  11. Provocar outra mensagem e conferir: `prompt_source = 'agent'`, `agent_version = 1` e o **mesmo** `prompt_sha256` da resposta do passo 7.
  12. `--desligar <conexão do ensaio> --confirmar-banco zvwngsrflkicbbzfmrgy` e conferir que a próxima resposta volta sem `agent_id`, com o mesmo sha.
- [ ] **Step 2: Produção — migration ANTES do deploy**
  1. Leitura, com o OK dele: quais números têm `config.webhookUrl` (automação n8n), e se os fluxos deles mandam no metadata do `/ai-reply` alguma das seis chaves de rastro, que passam a ser descartadas (revisão do Codex, achado 9).
  2. **G23, antes da escrita** (revisão do Codex, achado 20):
     - registrar a data do último backup do projeto de produção e se o PITR está ligado (painel do Supabase ou `get_project` do MCP, só leitura);
     - sem backup do dia, não aplicar;
     - a volta (`volta-fatia-1.sql`) já foi provada no banco local (Task 2, Step 3).
  3. Aplicar a migration no banco de produção (`eqidsihasmwwamkaqfka`) e corrigir a `version`, como no teste.
  4. Conferir que a coluna existe (`select ai_agent_id from public.channel_connections limit 1` sem erro).
  5. Só então: `git fetch origin`, `git merge-base --is-ancestor origin/main HEAD` e `git push origin HEAD:main`. Não empurrar para nenhuma outra branch.
  6. Esperar produção READY e **devolver `teste.crm.basea2.com` para a prévia**, porque toda publicação de produção leva esse domínio junto. O `poll_deploys.py` com a branch como argumento faz as duas coisas. Provar os dois bancos pelo `prova_login.py`.
- [ ] **Step 3: Produção adormecida**
  - a próxima resposta real da Aurora sai como antes (`prompt_source = 'default'`, sem `agent_id`) e agora com `prompt_sha256`;
  - depois de uma resposta real de cada uma, `--prova --ramo-publicado main`, só leitura, com o relatório guardado no cérebro. Aurora e Julia têm que sair `CONFERE`;
  - operação (revisão do Codex, ponto 2): num número com agente, uma falha do agente (`agent_unavailable`) cai na automação n8n do cliente, se houver, como qualquer falha da IA nativa.
- [ ] **Step 4:** Ligar Aurora e Julia em produção **não** faz parte desta fatia. Fica para a entrega da fatia 2, junto do editor, do 409 no PATCH de `aiPromptKey`, da trava do catálogo e do aviso na Central de I.A.
