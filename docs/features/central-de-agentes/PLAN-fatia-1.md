# Central de Agentes, fatia 1 (fundação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar o cadastro de agente (`ai_agents` + `ai_agent_versions`) e fazer o atendimento de WhatsApp usar o prompt da versão publicada quando o número tem agente, com o resto do caminho byte a byte igual. Toda resposta nativa entregue passa a gravar um evento de prova (`ai_reply_events`: sha256 do prompt, chave, origem do texto, commit da publicação e hora da entrega), e o script de migração só cria e liga um agente quando o sha que ele calcula bate com o do evento que a publicação no ar gravou.

**Architecture:**
- **Banco:** duas tabelas novas com RLS (leitura só da agência) e escrita só por função `security definer`. A coluna `channel_connections.ai_agent_id` entra com FK composta por organização, `on delete no action` (agente ligado não se apaga), e um gatilho que só aceita agente publicado. Outro gatilho recusa `update` em versão, exceto zerar o autor.
- **Resposta:** `generateConversationAutoReply` lê a versão publicada logo depois do portão da IA. Troca só a fonte do prompt (e o modelo, se a versão tiver um) e devolve o sha256 do texto usado. Chave de prompt nula sem agente vira `missing_prompt`, nunca o prompt padrão. O webhook grava `prompt_sha256` em toda resposta nativa e `agent_id`/`agent_version` só com agente.
- **Evento de prova:** a tabela `ai_reply_events` só é escrita pelo caminho nativo, com a chave de serviço. Depois que a última parte é aceita pela Evolution, `executeConversationAIReply` grava o evento que o webhook mandou em `replyEvent`. A rota do n8n e a cutucada não mandam `replyEvent` e seguem iguais. O commit vem de `VERCEL_GIT_COMMIT_SHA`.
- **Rastro protegido:** as rotas do n8n e manual descartam do metadata recebido as chaves de rastro nativo. A prova não lê metadata de mensagem nenhuma.
- **Prova e ligação no banco:** uma função devolve o último evento de prova do caminho de hoje (sem agente), pela hora da entrega. Outra liga o número numa transação só e confere de novo:
  - a chave bruta e a efetiva;
  - o override, com a tabela de prompts travada contra escrita;
  - a versão publicada, com a linha do agente travada;
  - a publicação, a chave, a origem (padrão ou override) e o sha desse evento.

  Criar agente é serializado por organização e sha. O que a prova afirma, e por que ela não depende de o evento ser o da última resposta, está na SPEC ("O que a prova afirma").
- **Publicação no ar:** o script conhece os dois ambientes pelo banco (lista fechada: banco → projeto da Vercel → domínios → ramo). Lê, pela API da Vercel, os domínios do projeto e o deployment que **cada** domínio serve, e só segue se:
  - a lista fechada é exatamente a dos domínios que o projeto tem na Vercel;
  - todos servem o mesmo deployment, do projeto certo, do ramo certo, `READY`, com o commit da cópia;
  - em produção ele é o de produção e está promovido; no teste ele **não** é o de produção;
  - não há deployment mais novo do ramo construindo, em rollout, ou pronto sem ser o servido.

  Confere antes da prova, antes de ligar, dentro da função do banco e de novo depois de ligar. Depois de ligar, **qualquer** coisa que impeça confirmar a publicação (inclusive erro de rede) desfaz a ligação, só do agente recém-ligado, e a linha é conferida. Uma chamada de ligar que falha sem resposta do banco recebe o mesmo tratamento. Nesta fatia o script só liga número no ambiente de teste: em produção, falta conferir o endereço do webhook de cada número (SPEC, "O que a prova afirma").

**Tech Stack:** Next.js (rotas em `app/`), Supabase Postgres 15 (migrations em `supabase/migrations`), supabase-js, AI SDK (`ai`), Vitest (+ Supabase local via `npm run test:local`), TypeScript. O script roda com `npx --yes tsx@4.23.1` (versão já no cache do npx desta máquina; sem `--yes`, o npx para esperando confirmação).

**SPEC:** `docs/features/central-de-agentes/SPEC.md` (aprovada em 29/09/2026, com a revisão adversarial interna e as três rodadas do Codex integradas). Levantamentos com arquivo:linha em `docs/features/central-de-agentes/levantamento/`, incluindo `revisao-adversarial-fatia-1.md`, `devolutiva-codex-2-fatia-1.md` e `devolutiva-codex-3-fatia-1.md`.

**Regras do projeto que valem aqui:**
- Nunca rodar teste, migration ou script contra o banco de produção sem o OK do Junior.
- Nunca dar push nem deploy sem o OK dele.
- **Nunca empurrar uma branch nova para o GitHub nesta entrega** (nem `feat/central-agentes`). Conferido na Vercel em 05/10: as cinco variáveis de banco genéricas valem para Preview **e** Production ao mesmo tempo, o projeto não tem Ignored Build Step nem `vercel.json`, e as prévias são públicas. Uma branch sem variável própria vira uma prévia pública com as credenciais de produção. O ensaio usa a branch que já tem variáveis próprias do banco de teste, `feat/aurora-implantacao` (Task 13).
- Ler o resultado da suíte num comando **separado** antes de cada commit, e conferir o `git diff --stat` (fim de linha no Windows).
- Segredo nunca impresso nem commitado.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260930000000_central_agentes_fundacao.sql` | Criar | Tabelas do agente, tabela do evento de prova, FKs compostas, gatilhos, RLS/GRANT, funções da migração (criar agente, última resposta nativa, ligar) |
| `docs/features/central-de-agentes/volta-fatia-1.sql` | Criar | Volta da migration (G23), provada no banco local |
| `test/centralAgentesFundacaoMigration.test.ts` | Criar | Prova do texto da migration (sem banco) |
| `test/centralAgentesFundacao.local.test.ts` | Criar | Prova no Supabase local: FKs, gatilhos, cascata, idempotência, matriz de acesso, prova, ligação e as corridas (sessões `pg` de verdade, com a espera pela trava observada em `pg_locks`) |
| `test/helpers/fakeSupabaseAdmin.ts` | Modificar | Banco falso: projeção do `select` e limite de linhas (opcionais), `.not`, resposta de RPC por argumento |
| `test/helpers/fakeSupabaseAdmin.test.ts` | Criar | O que o banco falso passa a imitar |
| `lib/ai/prompts/resolve.ts` | Criar | Resolução pura do prompt (override ativo → catálogo) e a variante estrita, sem `server-only` |
| `lib/ai/prompts/resolve.test.ts` | Criar | Regras da resolução |
| `lib/ai/prompts/server.ts` | Modificar | `getResolvedPrompt` delega para `resolve.ts` (comportamento igual) |
| `lib/conversations/conversationAIGate.ts` | Modificar | Leitura da conexão traz `ai_agent_id` |
| `lib/conversations/conversationAIGate.agente.test.ts` | Criar | O portão devolve `ai_agent_id` |
| `lib/agents/agentRuntime.ts` | Criar | Carrega a versão publicada de um agente da organização |
| `lib/agents/agentRuntime.test.ts` | Criar | Casos de leitura |
| `lib/conversations/aiReply.ts` | Modificar | Usa a versão do agente (prompt, modelo, origem); chave nula sem agente = `missing_prompt`; devolve o sha256 do prompt; grava o evento de prova depois da entrega quando o webhook manda `replyEvent` |
| `lib/conversations/aiReply.agente.test.ts` | Criar | Caminho do agente, caminho de hoje e a chave nula |
| `lib/conversations/aiReply.equivalencia.test.ts` | Criar | Prompt enviado ao modelo e sha idênticos, legado × agente |
| `lib/conversations/aiReplyEvents.ts` | Criar | Grava o evento de prova (sem nunca derrubar a resposta) e lê o commit da publicação que está rodando |
| `lib/conversations/aiReplyEvents.test.ts` | Criar | Colunas do evento, commit válido ou nulo, falha só avisa |
| `lib/conversations/aiReply.eventoEntregue.test.ts` | Criar | O evento só sai com a entrega feita e só quando o webhook manda `replyEvent` |
| `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` | Modificar | Guarda do prompt, chave nula, falha `agent_unavailable`, `prompt_sha256` e agente no metadata, `replyEvent` para o evento |
| `app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts` | Criar | O webhook com e sem agente |
| `lib/conversations/conversationDeliveryMetadata.ts` | Modificar | Lista e limpeza das chaves de rastro nativo |
| `lib/conversations/conversationDeliveryMetadata.test.ts` | Modificar | A limpeza tira só as chaves de rastro |
| `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts` | Modificar | A rota do n8n limpa o metadata externo |
| `app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts` | Criar | A rota do n8n não grava rastro nativo nem manda evento de prova |
| `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts` | Modificar | A rota manual limpa as chaves de rastro do metadata que o navegador manda |
| `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.rastro.test.ts` | Criar | O envio manual forjado, inclusive o local (`send_external: false`), não grava rastro nativo |
| `lib/agents/migracaoAgentes.ts` | Criar | Prova contra a produção, planejar (paginado), criar, ligar (pela função do banco; chamada sem resposta não conta como "não ligou"), ligar com conferência da publicação antes e depois (desfaz se não confirmar) e desligar (com confirmação; condicionado ao agente no desfazer) |
| `lib/agents/migracaoAgentes.test.ts` | Criar | Regras da migração, inclusive a falha na chamada de ligar e na conferência depois de ligar |
| `lib/agents/publicacaoVercel.ts` | Criar | Qual commit os domínios de um ambiente servem (alias → deployment), conferindo a lista de domínios do projeto, projeto, ramo, alvo e promoção, e recusando transição, rollout e deployment mais novo não servido |
| `lib/agents/publicacaoVercel.test.ts` | Criar | Os casos da publicação no ar, com a API falsa |
| `scripts/central-agentes/migrar-agentes.ts` | Criar | Linha de comando `--prova/--criar/--ligar/--desligar`; o ambiente (domínios, ramo, projeto) sai do banco conectado, numa lista fechada; `--ligar` em produção fica recusado nesta fatia |

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
- Create: `docs/features/central-de-agentes/volta-fatia-1.sql`
- Test: `test/centralAgentesFundacaoMigration.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_AI_PROMPT_KEY } from '@/lib/conversations/aiAgentConfig';

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

  it('o evento de prova é da mesma organização do número e da conversa, com formatos checados', () => {
    expect(semComentarios).toContain('create table if not exists public.ai_reply_events (');
    expect(semComentarios).toMatch(/foreign key \(organization_id, channel_connection_id\)\s+references public\.channel_connections \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toMatch(/foreign key \(organization_id, thread_id\)\s+references public\.conversation_threads \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toContain("check (prompt_sha256 ~ '^[0-9a-f]{64}$')");
    expect(semComentarios).toContain("release_commit is null or release_commit ~ '^[0-9a-f]{40}$'");
    expect(semComentarios).toContain('delivered_at timestamptz not null');
  });

  it('RLS ligada nas três tabelas; leitura só da agência nas do agente; nenhuma policy no evento', () => {
    expect(semComentarios).toContain('alter table public.ai_agents enable row level security;');
    expect(semComentarios).toContain('alter table public.ai_agent_versions enable row level security;');
    expect(semComentarios).toContain('alter table public.ai_reply_events enable row level security;');
    const policies = [...semComentarios.matchAll(/create policy "[^"]+"\s+on public\.(\w+) for (\w+)/g)];
    expect(policies.map((p) => `${p[1]}:${p[2]}`).sort()).toEqual(['ai_agent_versions:select', 'ai_agents:select']);
    expect(semComentarios.match(/using \(public\.is_agency_admin_role\(\)\)/g)).toHaveLength(2);
  });

  it('GRANT explícito: authenticated só lê as tabelas do agente; o evento é só da chave de serviço', () => {
    for (const tabela of ['ai_agents', 'ai_agent_versions', 'ai_reply_events']) {
      expect(semComentarios).toContain(`revoke all on table public.${tabela} from anon, authenticated;`);
      expect(semComentarios).toContain(`grant all on table public.${tabela} to service_role;`);
    }
    expect(semComentarios).toContain('grant select on table public.ai_agents to authenticated;');
    expect(semComentarios).toContain('grant select on table public.ai_agent_versions to authenticated;');
    // Caso positivo do detector abaixo: ele casa o grant que existe.
    expect(semComentarios).toMatch(/grant [a-z, ]+ on table public\.ai_reply_events to service_role/);
    expect(semComentarios).not.toMatch(/grant [a-z, ]+ on table public\.ai_reply_events to (anon|authenticated)/);
    expect(semComentarios).toContain('revoke all on sequence public.ai_reply_events_id_seq from anon, authenticated;');
  });

  it('as funções que leem ou escrevem têm cabeçalho de segurança; nenhuma fica aberta a public', () => {
    expect(semComentarios.match(/security definer\s*\nset search_path = ''/g)).toHaveLength(4);
    for (const assinatura of [
      'enforce_channel_connection_ai_agent_published()',
      'prevent_ai_agent_version_update()',
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
    }
    for (const assinatura of [
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
  });

  it('a migração confere o sha256 do prompt e é idempotente na função, no banco e sob concorrência', () => {
    const [, , criar] = corposDasFuncoes(sql);
    expect(criar).toContain("extensions.digest(p_prompt, 'sha256')");
    expect(criar).toContain("raise exception 'origin_sha256_mismatch'");
    expect(criar).toContain("a.origin ->> 'sha256' = v_sha");
    // Duas chamadas simultâneas com o mesmo (organização, sha): a segunda espera a primeira e devolve o
    // agente dela, em vez de receber o 23505 do índice único (2ª rodada do Codex, achado 8).
    expect(criar).toContain("perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_sha, 0));");
    expect(criar.indexOf('pg_advisory_xact_lock')).toBeLessThan(criar.indexOf('from public.ai_agents a'));
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

  it('a prova lê só o evento: o último do caminho de hoje, pela hora da entrega', () => {
    const [, , , ultima] = corposDasFuncoes(sql);
    expect(ultima).toContain('from public.ai_reply_events e');
    expect(ultima).toContain('e.channel_connection_id = p_connection_id');
    expect(ultima).toContain('e.agent_id is null');
    expect(ultima).toContain('order by e.delivered_at desc, e.id desc');
    // Devolve também a ORIGEM do texto (padrão ou override): a ligação exige a testemunha do mesmo caso.
    expect(ultima).toContain('e.prompt_source');
    // Mensagem manual ou do n8n não entra na prova, com o metadata que tiver (2ª rodada, achado 1).
    expect(ultima).not.toContain('conversation_messages');
    expect(ultima).not.toContain('metadata');
  });

  it('ligar confere tudo de novo numa transação só, com a tabela de prompts, o número e o agente travados', () => {
    const [, , , , ligar] = corposDasFuncoes(sql);
    const trava = ligar.indexOf('lock table public.ai_prompt_templates in share row exclusive mode;');
    expect(trava).toBeGreaterThan(-1);
    // A trava vem antes de qualquer leitura de override: a AUSÊNCIA de linha também fica protegida.
    expect(trava).toBeLessThan(ligar.indexOf('from public.ai_prompt_templates t'));
    expect(ligar).toMatch(/from public\.channel_connections c\s+where c\.id = p_connection_id\s+for update;/);
    expect(ligar).toMatch(/from public\.ai_agents a\s+where a\.id = p_agent_id\s+and a\.organization_id = v_org\s+for share;/);
    // A chave efetiva segue a regra do runtime, com a MESMA chave padrão do código (trava contra divergir).
    expect(ligar).toContain(`coalesce(nullif(btrim(v_chave_bruta), ''), '${DEFAULT_CONVERSATION_AI_PROMPT_KEY}')`);
    for (const motivo of [
      'sha_invalido',
      'publicacao_invalida',
      'conexao_inexistente',
      'ja_ligada',
      'chave_mudou',
      'chave_efetiva_diverge',
      'override_mudou',
      'origem_invalida',
      'versao_publicada_diverge',
      'prova_nao_confere',
      'publicacao_diverge',
      'ligado',
    ]) {
      expect(ligar).toContain(`return '${motivo}'`);
    }
    expect(ligar).toContain('public.central_agentes_ultima_resposta_nativa(p_connection_id)');
    // A testemunha tem que ser do mesmo caso: mesma chave, mesma origem (padrão ou override) e mesmo sha
    // (3ª rodada do Codex, achado 5).
    expect(ligar).toContain('v_prova_origem is distinct from p_prompt_source');
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
returns table (out_sha256 text, out_prompt_key text, out_prompt_source text, out_release_commit text, out_delivered_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select e.prompt_sha256, e.prompt_key, e.prompt_source, e.release_commit, e.delivered_at
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
--  - o último evento de prova do caminho de hoje: mesma publicação que o script conferiu nos domínios,
--    mesma chave efetiva, mesma origem (padrão ou override) e mesmo sha.
-- Qualquer diferença recusa, com o motivo.
create or replace function public.central_agentes_ligar_conexao(
  p_connection_id uuid,
  p_agent_id uuid,
  p_chave_bruta text,
  p_prompt_key text,
  p_prompt_source text,
  p_sha256 text,
  p_publicacao text
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
begin
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return 'sha_invalido';
  end if;
  if p_publicacao is null or p_publicacao !~ '^[0-9a-f]{40}$' then
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

  select r.out_sha256, r.out_prompt_key, r.out_prompt_source, r.out_release_commit
    into v_prova_sha, v_prova_chave, v_prova_origem, v_prova_publicacao
  from public.central_agentes_ultima_resposta_nativa(p_connection_id) r;
  if not found then
    return 'prova_nao_confere';
  end if;
  if v_prova_publicacao is distinct from p_publicacao then
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

revoke all on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text) to service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run test/centralAgentesFundacaoMigration.test.ts`
Expected: PASS (15 testes).

- [ ] **Step 5: Escrever a volta (G23)**

Criar `docs/features/central-de-agentes/volta-fatia-1.sql`:

```sql
-- VOLTA da fatia 1 da Central de Agentes (supabase/migrations/20260930000000_central_agentes_fundacao.sql).
-- ORDEM: primeiro tirar do ar o código que lê ai_agent_id e grava ai_reply_events (senão o portão da IA
-- falha e a IA para em todos os clientes); só depois rodar isto. Nunca em produção sem o OK do Junior.
-- Provada no banco local (Task 2, Step 3): aplicar -> voltar -> aplicar. Apaga junto os eventos de prova.
begin;
drop trigger if exists channel_connections_ai_agent_published on public.channel_connections;
alter table public.channel_connections drop constraint if exists channel_connections_ai_agent_fk;
drop index if exists public.channel_connections_ai_agent_id_idx;
alter table public.channel_connections drop column if exists ai_agent_id;
drop function if exists public.central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text);
drop function if exists public.central_agentes_ultima_resposta_nativa(uuid);
drop function if exists public.create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb);
drop function if exists public.enforce_channel_connection_ai_agent_published();
drop table if exists public.ai_reply_events;
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
git commit -m "feat(central-agentes): migration da fundacao (agente, versoes, evento de prova, prova e ligacao no banco)"
```

---

### Task 2: Prova no Supabase local (FKs, gatilhos, cascata, matriz de acesso, prova, ligação e corridas)

**Files:**
- Test: `test/centralAgentesFundacao.local.test.ts`

Pré-requisito: Docker aberto e `npx supabase start` (o runner `npm run test:local` recusa qualquer banco que não seja `127.0.0.1:54321`). Aplicar as migrations no local com `npx supabase db reset` se o banco local ainda não tiver a migration nova.

As corridas (2ª rodada do Codex, achados 4 e 8) são provadas com **duas sessões de verdade**: uma pelo driver `pg` (já é dependência do projeto, `lib/installer/migrations.ts`), direto no Postgres local, segurando uma transação aberta; a outra pelo PostgREST (`rpc`) ou por uma segunda sessão `pg`.

Duas correções da 3ª rodada do Codex entram aqui:
- **A espera é observada, não presumida (achado 7).** Um `Promise.race` com tempo não prova que a chamada esperou a trava: se ela só começasse depois do `commit`, devolveria o mesmo resultado e o teste ficaria verde sem exercitar nada. Agora a sessão que segura a transação consulta `pg_blocking_pids` até ver outra sessão **bloqueada por ela**, confere em `pg_locks` **qual** trava está pendente (a `ShareRowExclusiveLock` da tabela de prompts, a `transactionid` da linha do agente, a `advisory` da criação) e só então faz o `commit`.
- **A URL do Postgres é uma constante local (achado 2).** O runner `test:local` valida a URL REST, mas repassa o ambiente inteiro; uma `SUPABASE_DB_URL` remota no shell faria estes testes escreverem fora do local. Não existe mais variável de ambiente para essa URL: é `127.0.0.1:54322` (`supabase/config.toml`, `[db] port`), conferida antes de qualquer sessão. Se a porta local mudar, muda-se a constante.

- [ ] **Step 1: Escrever o teste**

```ts
// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/**
 * Postgres do `supabase start` (supabase/config.toml, [db] port). Constante de propósito, sem variável de
 * ambiente: o runner repassa o ambiente inteiro, e uma URL remota nele nunca pode fazer este teste abrir
 * sessão fora do local (3ª rodada do Codex, achado 2).
 */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
const PROMPT = 'Voce e a Aurora. {{contactName}}\n{{recentMessagesText}}';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
/** Commit da publicação que "respondeu" (VERCEL_GIT_COMMIT_SHA): 40 hex. */
const PUBLICACAO = 'a'.repeat(40);

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: as corridas so abrem sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'admin' | 'clinic_admin';

describeLocal('Central de Agentes, fundação — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let conexaoA = '';
  let agenteA = '';
  let agenteB = '';
  const usuarios: string[] = [];
  const emails: Partial<Record<'agencia' | 'staff' | 'legado' | 'clienteA' | 'clienteB', string>> = {};
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
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

  async function novaConexao(nome: string, config: Record<string, unknown> = {}, organizationId = orgA) {
    const admin = getSupabaseAdminClient();
    return requireSupabaseData(await admin
      .from('channel_connections')
      .insert({ organization_id: organizationId, provider: 'evolution', channel_type: 'whatsapp', name: `${nome} ${runId}`, config })
      .select('id')
      .single(), `insert conexao ${nome}`).id as string;
  }

  async function novaConversa(conexao: string | null, organizationId = orgA) {
    const admin = getSupabaseAdminClient();
    return requireSupabaseData(await admin
      .from('conversation_threads')
      .insert({ organization_id: organizationId, channel_connection_id: conexao, title: `Conversa ${randomUUID()} ${runId}` })
      .select('id')
      .single(), 'insert conversa').id as string;
  }

  /** Evento de prova como o caminho nativo grava (lib/conversations/aiReplyEvents.ts). */
  function evento(conexao: string, conversa: string, sha: string, deliveredAt: string, extra: Record<string, unknown> = {}) {
    return {
      organization_id: orgA,
      channel_connection_id: conexao,
      thread_id: conversa,
      prompt_sha256: sha,
      prompt_key: AURORA,
      prompt_source: 'default',
      agent_id: null,
      agent_version: null,
      release_commit: PUBLICACAO,
      delivered_at: deliveredAt,
      ...extra,
    };
  }

  /** Número com uma resposta entregue que CONFERE com `texto`, pronto para ligar. */
  async function numeroProvado(nome: string, texto: string) {
    const admin = getSupabaseAdminClient();
    const conexao = await novaConexao(nome, { aiPromptKey: AURORA });
    const conversa = await novaConversa(conexao);
    assertNoSupabaseError(await admin.from('ai_reply_events').insert(evento(conexao, conversa, sha256(texto), '2026-09-29T11:00:00Z')), `evento ${nome}`);
    return { conexao, conversa };
  }

  function ligar(conexao: string, agente: string, sha: string, troca: Record<string, unknown> = {}) {
    return getSupabaseAdminClient().rpc('central_agentes_ligar_conexao', {
      p_connection_id: conexao,
      p_agent_id: agente,
      p_chave_bruta: AURORA,
      p_prompt_key: AURORA,
      p_prompt_source: 'default',
      p_sha256: sha,
      p_publicacao: PUBLICACAO,
      ...troca,
    });
  }

  async function sessaoPg() {
    exigirPostgresLocal();
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    return client;
  }

  /**
   * Espera até outra sessão estar BLOQUEADA por `dona` (pg_blocking_pids) e devolve as travas que ela está
   * pedindo e ainda não ganhou. Prova que a chamada concorrente chegou ao banco e está esperando aquela
   * trava; não basta ela demorar. Roda na própria sessão que segura a transação.
   */
  async function esperarBloqueadoPor(dona: Client) {
    const limite = Date.now() + 5000;
    for (;;) {
      const bloqueadas = await dona.query('select a.pid from pg_stat_activity a where pg_backend_pid() = any(pg_blocking_pids(a.pid))');
      if (bloqueadas.rows.length > 0) {
        const pids = bloqueadas.rows.map((linha) => linha.pid as number);
        const travas = await dona.query(
          "select l.locktype, l.mode, coalesce(l.relation::regclass::text, '') as relacao from pg_locks l where not l.granted and l.pid = any($1::int[])",
          [pids],
        );
        return travas.rows as Array<{ locktype: string; mode: string; relacao: string }>;
      }
      if (Date.now() > limite) throw new Error('nenhuma sessao ficou esperando a trava em 5 s: a chamada concorrente nao travou');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    const fixtures = await createMinimalFixtures();
    runId = fixtures.runId;
    orgA = fixtures.orgA.organizationId;
    orgB = fixtures.orgB.organizationId;
    conexaoA = await novaConexao('Central', { aiEnabled: false });
    emails.agencia = await criarUsuario('agency_admin', orgA);
    emails.staff = await criarUsuario('agency_staff', orgA);
    emails.legado = await criarUsuario('admin', orgA);
    emails.clienteA = await criarUsuario('clinic_admin', orgA);
    emails.clienteB = await criarUsuario('clinic_admin', orgB);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    // A limpeza apaga as organizações; com agente, número e evento nelas, ela também exercita a cascata.
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

  it('criação concorrente do mesmo prompt: a segunda espera a trava da primeira e volta o MESMO agente, sem 23505 (achado 8)', async () => {
    const texto = `${PROMPT}\nConcorrente`;
    const [a, b] = await Promise.all([sessaoPg(), sessaoPg()]);
    try {
      const chamada = (sessao: Client) => sessao.query(
        'select out_agent_id, out_created from public.create_ai_agent_from_legacy_prompt($1, $2, $3, $4::jsonb)',
        [orgA, 'Concorrente', texto, JSON.stringify({ sha256: sha256(texto), promptKey: AURORA, promptSource: 'default' })],
      );
      // A cria dentro de uma transação ABERTA: segura a trava de (organização, sha) e o agente ainda não é
      // visível para ninguém.
      await a.query('begin');
      const primeira = await chamada(a);
      expect(primeira.rows[0].out_created).toBe(true);

      const segunda = chamada(b);
      // B tem que estar parada na trava ADVISORY, antes da busca. Sem ela, B passaria pela busca vazia e
      // pararia no índice único (espera `transactionid`), para depois receber 23505.
      const travas = await esperarBloqueadoPor(a);
      expect(travas.map((t) => t.locktype)).toContain('advisory');

      await a.query('commit');
      const resultado = await segunda;
      expect(resultado.rows[0]).toEqual({ out_agent_id: primeira.rows[0].out_agent_id, out_created: false });
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
    const agentes = await getSupabaseAdminClient().from('ai_agents').select('id').eq('organization_id', orgA).eq('origin->>sha256', sha256(texto));
    expect(agentes.data).toHaveLength(1);
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

  it('apagar a organização inteira leva agente, versões, número ligado e eventos juntos', async () => {
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
    const conversaC = await novaConversa(conexaoC, orgC);
    assertNoSupabaseError(await admin.from('ai_reply_events').insert({
      ...evento(conexaoC, conversaC, sha256(PROMPT), '2026-09-29T10:00:00Z'),
      organization_id: orgC,
    }), 'evento C');

    assertNoSupabaseError(await admin.from('organizations').delete().eq('id', orgC), 'apagar org C');

    const sobras = await Promise.all([
      admin.from('ai_agents').select('id').eq('id', agenteC),
      admin.from('ai_agent_versions').select('id').eq('agent_id', agenteC),
      admin.from('channel_connections').select('id').eq('id', conexaoC),
      admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoC),
    ]);
    for (const sobra of sobras) {
      expect(sobra.error).toBeNull();
      expect(sobra.data).toEqual([]);
    }
  });

  it('matriz de acesso (G2): seis identidades, três tabelas, duas organizações e as três funções', async () => {
    const identidades = {
      anonimo: createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
      agencia: await entrar(emails.agencia!),
      staff: await entrar(emails.staff!),
      legado: await entrar(emails.legado!),
      clienteA: await entrar(emails.clienteA!),
      clienteB: await entrar(emails.clienteB!),
    };
    // Lê tudo (as duas organizações): agency_admin e o legado admin. Lê vazio, sem erro: agency_staff e os
    // clientes. Se a policy passasse a usar is_agency_role() (que inclui staff), o teste do staff cai.
    const leTudo = new Set(['agencia', 'legado']);
    const alvos = [
      { org: orgA, agente: agenteA },
      { org: orgB, agente: agenteB },
    ];
    const escritas = (org: string, agente: string) => ({
      ai_agents: {
        insert: { organization_id: org, name: 'Direto' },
        update: { name: 'Mexido' },
        coluna: 'id',
        chave: agente,
      },
      ai_agent_versions: {
        insert: { agent_id: agente, organization_id: org, version: 99, prompt: 'x', source: 'publish' },
        update: { note: 'mexi' },
        coluna: 'agent_id',
        chave: agente,
      },
    });
    const funcoes: Array<[string, Record<string, unknown>]> = [
      ['create_ai_agent_from_legacy_prompt', { p_organization_id: orgA, p_name: 'X', p_prompt: 'x', p_origin: { sha256: sha256('x') } }],
      ['central_agentes_ultima_resposta_nativa', { p_connection_id: conexaoA }],
      ['central_agentes_ligar_conexao', {
        p_connection_id: conexaoA, p_agent_id: agenteA, p_chave_bruta: null, p_prompt_key: PADRAO, p_prompt_source: 'default', p_sha256: sha256(PROMPT), p_publicacao: PUBLICACAO,
      }],
    ];

    for (const [nome, cliente] of Object.entries(identidades)) {
      for (const tabela of ['ai_agents', 'ai_agent_versions'] as const) {
        const coluna = tabela === 'ai_agents' ? 'id' : 'agent_id';
        const lidos = await cliente.from(tabela).select(coluna);
        if (nome === 'anonimo') {
          expect(lidos.error?.code, `${nome} lê ${tabela}`).toBe('42501');
        } else if (leTudo.has(nome)) {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          const ids = new Set((lidos.data ?? []).map((linha) => (linha as Record<string, string>)[coluna]));
          expect(ids.has(agenteA), `${nome} vê a organização A em ${tabela}`).toBe(true);
          expect(ids.has(agenteB), `${nome} vê a organização B em ${tabela}`).toBe(true);
        } else {
          expect(lidos.error, `${nome} lê ${tabela}`).toBeNull();
          expect(lidos.data, `${nome} lê ${tabela}`).toEqual([]);
        }
        for (const alvo of alvos) {
          const caso = escritas(alvo.org, alvo.agente)[tabela];
          const tentativas = [
            await cliente.from(tabela).insert(caso.insert),
            await cliente.from(tabela).update(caso.update).eq(caso.coluna, caso.chave),
            await cliente.from(tabela).delete().eq(caso.coluna, caso.chave),
          ];
          for (const tentativa of tentativas) expect(tentativa.error?.code, `${nome} escreve em ${tabela} da org ${alvo.org}`).toBe('42501');
        }
      }
      // O evento de prova é só da chave de serviço: nem leitura para quem é agência. CRUD inteiro negado
      // (G2 pede as quatro operações; 3ª rodada do Codex, achado 9).
      const tentativasNoEvento = [
        await cliente.from('ai_reply_events').select('id'),
        await cliente.from('ai_reply_events').insert(evento(conexaoA, conexaoA, sha256(PROMPT), '2026-09-29T10:00:00Z')),
        await cliente.from('ai_reply_events').update({ prompt_key: PADRAO }).eq('channel_connection_id', conexaoA),
        await cliente.from('ai_reply_events').delete().eq('channel_connection_id', conexaoA),
      ];
      for (const tentativa of tentativasNoEvento) expect(tentativa.error?.code, `${nome} em ai_reply_events`).toBe('42501');
      for (const [funcao, args] of funcoes) {
        const chamada = await cliente.rpc(funcao, args);
        expect(chamada.error?.code, `${nome} chama ${funcao}`).toBe('42501');
      }
    }

    const admin = getSupabaseAdminClient();
    const intactos = await admin.from('ai_agents').select('id, name').in('id', [agenteA, agenteB]);
    expect(intactos.data?.map((a) => a.name)).toEqual(['Aurora', 'Aurora']);
    const ligado = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexaoA).single();
    expect(ligado.data?.ai_agent_id).toBeNull();
    const eventosDeA = await admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoA);
    expect(eventosDeA.data).toEqual([]);
  });

  it('a prova lê só o evento: última resposta pela hora da ENTREGA, sem agente, e ignora mensagem forjada', async () => {
    const admin = getSupabaseAdminClient();
    const conexao = await novaConexao('Prova');
    const conversa = await novaConversa(conexao);

    // A entrega mais nova é gravada ANTES (id menor): a ordem é pela hora da entrega, não pelo id.
    assertNoSupabaseError(await admin.from('ai_reply_events').insert([
      evento(conexao, conversa, 'b'.repeat(64), '2026-09-29T11:00:00Z'),
      evento(conexao, conversa, 'a'.repeat(64), '2026-09-29T10:00:00Z'),
    ]), 'eventos a e b');
    // Resposta dada por um agente (número ligado e depois desligado) não prova o caminho de hoje.
    assertNoSupabaseError(await admin.from('ai_reply_events').insert(
      evento(conexao, conversa, 'c'.repeat(64), '2026-09-29T12:00:00Z', { prompt_source: 'agent', prompt_key: null, agent_id: agenteA, agent_version: 1 }),
    ), 'evento com agente');
    // Mensagem manual (send_external:false) com o rastro forjado no metadata: entregue, "nativa", com sha
    // escolhido. A prova não lê mensagem nenhuma, então ela não entra (achado 1).
    assertNoSupabaseError(await admin.from('conversation_messages').insert({
      thread_id: conversa,
      organization_id: orgA,
      direction: 'outbound',
      content: 'forjada',
      sent_at: '2026-09-29T13:00:00Z',
      delivery_source: 'manual',
      delivery_status: 'sent',
      metadata: { automation_source: 'native_crm', native_ai: true, delivery_status: 'sent', reply_part_index: 0, prompt_sha256: 'f'.repeat(64) },
    }), 'mensagem forjada');

    const achada = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao });
    expect(achada.error).toBeNull();
    expect(achada.data).toEqual([{
      out_sha256: 'b'.repeat(64),
      out_prompt_key: AURORA,
      out_prompt_source: 'default',
      out_release_commit: PUBLICACAO,
      out_delivered_at: expect.stringMatching(/^2026-09-29T11:00:00/),
    }]);

    const semEvento = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexaoA });
    expect(semEvento.data).toEqual([]);
  });

  it('o evento é da organização do número e da conversa (23503) e tem formato conferido (23514)', async () => {
    const admin = getSupabaseAdminClient();
    const conversaDeB = await novaConversa(null, orgB);
    const conversaDeA = await novaConversa(conexaoA);

    const numeroDeOutra = await admin.from('ai_reply_events').insert({ ...evento(conexaoA, conversaDeB, sha256(PROMPT), '2026-09-29T10:00:00Z'), organization_id: orgB });
    expect(numeroDeOutra.error?.code, 'conexão de A num evento de B').toBe('23503');

    const conversaDeOutra = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeB, sha256(PROMPT), '2026-09-29T10:00:00Z'));
    expect(conversaDeOutra.error?.code, 'conversa de B num evento de A').toBe('23503');

    const shaTorto = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeA, 'nao-e-sha', '2026-09-29T10:00:00Z'));
    expect(shaTorto.error?.code).toBe('23514');
    const agenteSemVersao = await admin.from('ai_reply_events').insert(evento(conexaoA, conversaDeA, sha256(PROMPT), '2026-09-29T10:00:00Z', { prompt_source: 'agent', agent_id: agenteA }));
    expect(agenteSemVersao.error?.code).toBe('23514');

    const nada = await admin.from('ai_reply_events').select('id').eq('channel_connection_id', conexaoA);
    expect(nada.data).toEqual([]);
  });

  it('ligar confere tudo de novo numa transação só e recusa, com o motivo, se algo diverge', async () => {
    const admin = getSupabaseAdminClient();
    const texto = `${PROMPT}\nLigar`;
    const sha = sha256(texto);
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const conexao = await novaConexao('Ligar', { aiPromptKey: AURORA });
    const conversa = await novaConversa(conexao);
    const responder = async (dados: Record<string, unknown>, entregueEm: string) =>
      assertNoSupabaseError(await admin.from('ai_reply_events').insert({ ...evento(conexao, conversa, sha, entregueEm), ...dados }), 'evento');
    const tentar = async (troca: Record<string, unknown> = {}) => {
      const r = await ligar(conexao, agente, sha, troca);
      expect(r.error).toBeNull();
      return r.data as string;
    };

    expect(await tentar({ p_sha256: 'x' })).toBe('sha_invalido');
    expect(await tentar({ p_publicacao: 'abc' })).toBe('publicacao_invalida');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({ prompt_sha256: 'f'.repeat(64) }, '2026-09-29T10:00:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({ release_commit: 'b'.repeat(40) }, '2026-09-29T10:30:00Z');
    expect(await tentar()).toBe('publicacao_diverge');

    await responder({ prompt_key: PADRAO }, '2026-09-29T10:45:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    // Mesmo sha, mesma chave e mesma publicação, mas o texto daquela resposta veio de um override: não
    // prova o padrão (3ª rodada do Codex, achado 5).
    await responder({ prompt_source: 'override' }, '2026-09-29T10:50:00Z');
    expect(await tentar()).toBe('prova_nao_confere');

    await responder({}, '2026-09-29T11:00:00Z');
    expect(await tentar({ p_chave_bruta: null })).toBe('chave_mudou');
    expect(await tentar({ p_prompt_key: PADRAO })).toBe('chave_efetiva_diverge');
    expect(await tentar({ p_prompt_source: 'x' })).toBe('origem_invalida');

    const override = requireSupabaseData(await admin
      .from('ai_prompt_templates')
      .insert({ organization_id: orgA, key: AURORA, content: 'Outro texto', version: 1, is_active: true })
      .select('id')
      .single(), 'insert override').id;
    expect(await tentar()).toBe('override_mudou');
    assertNoSupabaseError(await admin.from('ai_prompt_templates').delete().eq('id', override), 'apagar override');

    expect(await tentar({ p_agent_id: agenteA })).toBe('versao_publicada_diverge');

    expect(await tentar()).toBe('ligado');
    const ligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBe(agente);
    expect(await tentar()).toBe('ja_ligada');
  });

  it('corrida do override (achado 4): a ligação espera a escrita em andamento e a enxerga', async () => {
    const texto = `${PROMPT}\nCorrida override`;
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const { conexao } = await numeroProvado('Corrida override', texto);
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Publicação de override em andamento (o publicador atual faz UPDATE e INSERT separados, sem transação):
      // a linha ainda não está visível, mas o INSERT já segura ROW EXCLUSIVE na tabela.
      await a.query(
        'insert into public.ai_prompt_templates (organization_id, key, content, version, is_active) values ($1, $2, $3, 1, true)',
        [orgA, AURORA, 'Override em andamento'],
      );
      // `.then` dispara o pedido agora (o construtor do supabase-js só manda quando alguém espera por ele).
      const chamada = ligar(conexao, agente, sha256(texto)).then((r) => r);
      // Sem a trava, a função não acharia a linha (IF EXISTS vazio) e ligaria. Com ela, a chamada fica
      // parada pedindo a ShareRowExclusiveLock da tabela de prompts, segurada pelo INSERT desta sessão.
      const travas = await esperarBloqueadoPor(a);
      expect(travas).toContainEqual(expect.objectContaining({
        locktype: 'relation',
        mode: 'ShareRowExclusiveLock',
        relacao: expect.stringMatching(/ai_prompt_templates$/),
      }));
      await a.query('commit');
      const resultado = await chamada;
      expect(resultado.error).toBeNull();
      expect(resultado.data).toBe('override_mudou');
      await a.query('delete from public.ai_prompt_templates where organization_id = $1 and key = $2', [orgA, AURORA]);
    } finally {
      await a.end();
    }
    const ligada = await getSupabaseAdminClient().from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBeNull();
  });

  it('corrida do ponteiro (achado 4): publicar outra versão durante a ligação é visto antes de ligar', async () => {
    const admin = getSupabaseAdminClient();
    const texto = `${PROMPT}\nCorrida ponteiro`;
    const agente = ((await criarAgente(orgA, texto)).data as Array<{ out_agent_id: string }>)[0].out_agent_id;
    const { conexao } = await numeroProvado('Corrida ponteiro', texto);
    const v2 = requireSupabaseData(await admin
      .from('ai_agent_versions')
      .insert({ agent_id: agente, organization_id: orgA, version: 2, prompt: `${texto}\nv2`, source: 'publish' })
      .select('id')
      .single(), 'insert v2').id;
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Publicação da v2 em andamento: a linha do agente está travada por esta transação.
      await a.query('update public.ai_agents set published_version_id = $1 where id = $2', [v2, agente]);
      const chamada = ligar(conexao, agente, sha256(texto)).then((r) => r);
      // A chamada já passou pela tabela de prompts e pelo número, e para no FOR SHARE do agente: espera a
      // transação desta sessão (trava `transactionid`), que é quem está mudando o ponteiro.
      const travas = await esperarBloqueadoPor(a);
      expect(travas.map((t) => t.locktype)).toContain('transactionid');
      await a.query('commit');
      const resultado = await chamada;
      expect(resultado.error).toBeNull();
      expect(resultado.data).toBe('versao_publicada_diverge');
    } finally {
      await a.end();
    }
    const ligada = await admin.from('channel_connections').select('ai_agent_id').eq('id', conexao).single();
    expect(ligada.data?.ai_agent_id).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar contra o Supabase local**

Run: `npm run test:local -- test/centralAgentesFundacao.local.test.ts`
Expected: PASS (16 testes), e o `afterAll` sem erro. Se o local não tiver a migration, rodar antes `npx supabase db reset` (apaga só o banco local). Se as corridas falharem com `ECONNREFUSED` na porta 54322, conferir `npx supabase status` e a porta em `supabase/config.toml` (`[db] port`); a URL é constante de propósito e não tem variável de ambiente.

Se "apagar a organização inteira" falhar com 23503 em `channel_connections_ai_agent_fk`, **parar**: a premissa da SPEC de que `no action` deixa a cascata passar está errada, e a decisão volta para o Junior antes de qualquer outra task.

Se uma corrida falhar com "nenhuma sessao ficou esperando a trava", a chamada concorrente não travou: conferir que a função começa por `lock table`, que o `for share` está na leitura do agente e que a criação pede a trava advisory antes da busca. Se a trava pendente for de outro tipo (por exemplo `transactionid` na criação), a função está esperando no lugar errado. Nos dois casos o defeito é da função, não do teste.

O papel `postgres` do banco local precisa enxergar `pg_stat_activity` e `pg_locks` das outras sessões; as duas visões mostram `pid` e trava para qualquer papel (só o texto da consulta é escondido), então não depende de permissão extra.

- [ ] **Step 3: Provar a volta no banco local (G23): aplicar → voltar → aplicar**

Run: `docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < docs/features/central-de-agentes/volta-fatia-1.sql`
Expected: `COMMIT`, sem erro.

Run: `docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/20260930000000_central_agentes_fundacao.sql`
Expected: termina sem erro (a migration reaplica sobre o banco voltado).

Run: `npm run test:local -- test/centralAgentesFundacao.local.test.ts`
Expected: PASS (16 testes) de novo. Se o PostgREST acusar tabela ou função inexistente logo depois da volta, o cache de esquema dele ficou velho: `docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"` e rodar de novo.

- [ ] **Step 4: Commit**

```bash
git add test/centralAgentesFundacao.local.test.ts
git diff --cached --stat
git commit -m "test(central-agentes): FKs, gatilhos, cascata, matriz de acesso, prova por evento, ligacao e corridas no Supabase local"
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

### Task 8: O webhook com agente (guarda, chave nula, falha, metadata) e o evento de prova

O evento de prova (`ai_reply_events`) nasce aqui (2ª rodada do Codex, achados 1, 3 e 5). O webhook manda `replyEvent` no payload; `executeConversationAIReply` só grava o evento **depois** de a última parte ser aceita pela Evolution, com a hora da entrega lida ali, e nunca derruba a resposta por causa disso. A rota do n8n e a cutucada não mandam `replyEvent` e não gravam evento. O commit da publicação vem de `VERCEL_GIT_COMMIT_SHA` (disponível em tempo de execução quando "Enable access to System Environment Variables" está ligado no projeto da Vercel; Task 13 confere).

**Files:**
- Create: `lib/conversations/aiReplyEvents.ts`
- Test: `lib/conversations/aiReplyEvents.test.ts`
- Modify: `lib/conversations/aiReply.ts` (tipo `ConversationAIReplyPayload`, linha 147; `executeConversationAIReply`: depois do laço de envio, linhas 905-915, e depois do insert das mensagens, linha 960)
- Test: `lib/conversations/aiReply.eventoEntregue.test.ts`
- Modify: `app/api/public/channels/evolution/[connectionId]/webhook/route.ts:227-239, 289-298, 305-307`
- Test: `app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts`

- [ ] **Step 1: Escrever os testes do evento que falham**

`lib/conversations/aiReplyEvents.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { lerCommitDaPublicacao, registrarEventoDeResposta } from './aiReplyEvents';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

const dados = {
  organizationId: ORG,
  channelConnectionId: CONN,
  threadId: THREAD,
  deliveredAt: '2026-09-29T12:00:01.000Z',
  promptSha256: SHA,
  promptKey: 'task_conversations_whatsapp_auto_reply',
  promptSource: 'default' as const,
  agentId: null,
  agentVersion: null,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('commit da publicação', () => {
  it('lê VERCEL_GIT_COMMIT_SHA quando é um sha de 40 hex', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
    expect(lerCommitDaPublicacao()).toBe(COMMIT);
  });

  it('fora da Vercel (ou com valor torto) é nulo, nunca inventado', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(lerCommitDaPublicacao()).toBeNull();
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    expect(lerCommitDaPublicacao()).toBeNull();
  });
});

describe('registrar o evento de resposta', () => {
  it('grava uma linha com as colunas do evento', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
    const admin = createFakeSupabaseAdmin();
    await registrarEventoDeResposta(admin as never, dados);
    expect(admin.rowsOf('ai_reply_events')).toEqual([expect.objectContaining({
      organization_id: ORG,
      channel_connection_id: CONN,
      thread_id: THREAD,
      prompt_sha256: SHA,
      prompt_key: 'task_conversations_whatsapp_auto_reply',
      prompt_source: 'default',
      agent_id: null,
      agent_version: null,
      release_commit: COMMIT,
      delivered_at: '2026-09-29T12:00:01.000Z',
    })]);
  });

  it('com agente, grava agente e versão e a chave nula', async () => {
    const admin = createFakeSupabaseAdmin();
    await registrarEventoDeResposta(admin as never, { ...dados, promptKey: null, promptSource: 'agent', agentId: 'agente-1', agentVersion: 3 });
    expect(admin.rowsOf('ai_reply_events')[0]).toMatchObject({ prompt_key: null, prompt_source: 'agent', agent_id: 'agente-1', agent_version: 3, release_commit: null });
  });

  it('falha do banco só avisa: a resposta já saiu e não pode cair por causa do registro', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.failOn('ai_reply_events', 'insert', 'boom');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(registrarEventoDeResposta(admin as never, dados)).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.objectContaining({ error: 'boom' }));
  });
});
```

`lib/conversations/aiReply.eventoEntregue.test.ts` (mesmo arranjo de `aiReply.threadStateGuard.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Central de Agentes: o evento de prova (ai_reply_events) só é gravado com a entrega feita e só quando quem
 * chama manda `replyEvent` (o webhook). Rota do n8n e cutucada não mandam, e não gravam.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);
const COMMIT = 'c'.repeat(40);

let fake: FakeSupabaseAdmin;
let envioFalha = false;
let enviadoEm: number[] = [];

vi.mock('@/lib/conversations/conversationAIGate', () => ({
  loadFreshConversationAIGate: vi.fn(async () => ({
    ok: true,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
  })),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({ apiUrl: 'https://evolution.example', apiKey: 'chave-de-teste', source: 'connection' })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: vi.fn(async () => {
    if (envioFalha) throw new Error('Evolution fora do ar');
    await new Promise((resolve) => setTimeout(resolve, 5));
    enviadoEm.push(Date.now());
    return { providerMessageId: `msg-${enviadoEm.length}`, attemptLabel: 'number_text', raw: {} };
  }),
}));
vi.mock('@/lib/conversations/server', () => ({
  loadConversationThreadInboxItem: vi.fn(async () => {
    const row = fake.rowsOf('conversation_threads').find((thread) => thread.id === THREAD);
    return row ? { id: row.id, status: row.status, metadata: row.metadata } : null;
  }),
}));

import { executeConversationAIReply } from './aiReply';

const replyEvent = { promptSha256: SHA, promptKey: 'task_conversations_whatsapp_auto_reply', promptSource: 'default' as const, agentId: null, agentVersion: null };

function seed() {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD, organization_id: ORG, channel_connection_id: CONN, contact_id: null, deal_id: null,
      contact_name: 'Marina', contact_phone: '5521999990000', status: 'ai_active', assigned_user_id: null,
      metadata: { lastDirection: 'inbound', unreadCount: 1 },
    }],
  });
}

function responder(payload: Record<string, unknown>) {
  return executeConversationAIReply({
    admin: fake as never,
    connection: { id: CONN, organization_id: ORG, name: 'Aurora', config: { aiEnabled: true, instanceName: 'inst-teste' } },
    payload: { threadId: THREAD, replyText: 'Parte um. '.repeat(30) + '\n\n' + 'Parte dois.', ...payload } as never,
  });
}

beforeEach(() => {
  seed();
  envioFalha = false;
  enviadoEm = [];
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', COMMIT);
});
afterEach(() => vi.unstubAllEnvs());

describe('evento de prova da resposta nativa', () => {
  it('grava um evento por resposta, depois da última parte entregue, com o commit da publicação', async () => {
    const antes = Date.now();
    const r = await responder({ replyEvent, metadata: { native_ai: true }, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);

    const eventos = fake.rowsOf('ai_reply_events');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      organization_id: ORG, channel_connection_id: CONN, thread_id: THREAD,
      prompt_sha256: SHA, prompt_key: 'task_conversations_whatsapp_auto_reply', prompt_source: 'default',
      agent_id: null, agent_version: null, release_commit: COMMIT,
    });
    // Duas partes enviadas, UM evento, e a hora é a do fim da entrega (depois do último envio), não o
    // sent_at das mensagens, que é fixado antes de qualquer envio.
    expect(fake.rowsOf('conversation_messages').filter((m) => m.direction === 'outbound')).toHaveLength(2);
    const entregueEm = Date.parse(String(eventos[0].delivered_at));
    expect(entregueEm).toBeGreaterThanOrEqual(enviadoEm.at(-1)!);
    expect(entregueEm).toBeGreaterThanOrEqual(antes);
    const sentAt = Date.parse(String(fake.rowsOf('conversation_messages')[0].sent_at));
    expect(entregueEm).toBeGreaterThanOrEqual(sentAt);
  });

  it('entrega falhou: mensagem gravada como failed e NENHUM evento', async () => {
    envioFalha = true;
    const r = await responder({ replyEvent, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);
    expect('warning' in r && r.warning).toBeTruthy();
    expect(fake.rowsOf('ai_reply_events')).toEqual([]);
    expect(fake.rowsOf('conversation_messages').some((m) => (m.metadata as Record<string, unknown>).delivery_status === 'failed')).toBe(true);
  });

  it('sem replyEvent (rota do n8n, cutucada): entrega normal e nenhum evento', async () => {
    const r = await responder({ automationSource: 'n8n', metadata: { prompt_sha256: SHA } });
    expect(r.ok).toBe(true);
    expect(fake.rowsOf('ai_reply_events')).toEqual([]);
  });

  it('falha ao gravar o evento não derruba nem marca a resposta', async () => {
    fake.failOn('ai_reply_events', 'insert', 'boom');
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await responder({ replyEvent, automationSource: 'native_crm' });
    expect(r.ok).toBe(true);
    expect('warning' in r && r.warning).toBeNull();
    expect(aviso).toHaveBeenCalledWith('[Conversation AI] Failed to record reply event', expect.anything());
    aviso.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/conversations/aiReplyEvents.test.ts lib/conversations/aiReply.eventoEntregue.test.ts`
Expected: FAIL: "Failed to resolve import ./aiReplyEvents" no primeiro; no segundo, `ai_reply_events` fica vazio no primeiro caso.

- [ ] **Step 3: Criar `lib/conversations/aiReplyEvents.ts`**

```ts
import 'server-only';

import type { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Commit da publicação que está respondendo (VERCEL_GIT_COMMIT_SHA, exposto em tempo de execução pela
 * Vercel). Fora dela, ou com valor fora do formato, é nulo: a prova da migração então não confere.
 */
export function lerCommitDaPublicacao(): string | null {
  const valor = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim().toLowerCase();
  return COMMIT_SHA.test(valor) ? valor : null;
}

export type EventoDeResposta = {
  organizationId: string;
  channelConnectionId: string;
  threadId: string;
  /** Hora em que a última parte foi aceita pela Evolution (não o sent_at, fixado antes do envio). */
  deliveredAt: string;
  promptSha256: string;
  /** Chave que o runtime usou; nula quando o prompt veio de um agente. */
  promptKey: string | null;
  promptSource: 'agent' | 'override' | 'default';
  agentId: string | null;
  agentVersion: number | null;
};

/**
 * Evento de prova da Central de Agentes: uma linha por resposta nativa ENTREGUE (ai_reply_events, só
 * service_role). É o que o script de migração lê para conferir o prompt de hoje antes de ligar um número;
 * mensagem manual ou do n8n não escreve aqui, com o metadata que tiver. Nunca lança: a resposta já saiu.
 */
export async function registrarEventoDeResposta(admin: AdminClient, evento: EventoDeResposta): Promise<void> {
  const { error } = await admin.from('ai_reply_events').insert({
    organization_id: evento.organizationId,
    channel_connection_id: evento.channelConnectionId,
    thread_id: evento.threadId,
    prompt_sha256: evento.promptSha256,
    prompt_key: evento.promptKey,
    prompt_source: evento.promptSource,
    agent_id: evento.agentId,
    agent_version: evento.agentVersion,
    release_commit: lerCommitDaPublicacao(),
    delivered_at: evento.deliveredAt,
  });
  if (error) {
    console.warn('[Conversation AI] Failed to record reply event', {
      organizationId: evento.organizationId,
      connectionId: evento.channelConnectionId,
      threadId: evento.threadId,
      error: error.message,
    });
  }
}
```

- [ ] **Step 4: Implementar em `lib/conversations/aiReply.ts`**

Import, junto dos demais `@/lib/conversations/...`:

```ts
import { registrarEventoDeResposta, type EventoDeResposta } from '@/lib/conversations/aiReplyEvents';
```

No tipo `ConversationAIReplyPayload` (linha 147), depois de `closingReply?: boolean;`:

```ts
  /**
   * Central de Agentes: dados do evento de prova. Só o webhook (caminho nativo) manda; a rota do n8n e a
   * cutucada não mandam e não gravam evento. O evento só é gravado depois da entrega.
   */
  replyEvent?: Pick<EventoDeResposta, 'promptSha256' | 'promptKey' | 'promptSource' | 'agentId' | 'agentVersion'>;
```

Logo antes de `let deliveryWarning: string | null = null;` (linha 900):

```ts
  // Hora em que a ÚLTIMA parte foi aceita pela Evolution. O sent_at das mensagens é fixado antes do envio
  // (`now`), e envios simultâneos podem terminar em ordem inversa: a prova da migração ordena por isto.
  let deliveredAt: string | null = null;
```

Dentro do `try`, logo depois do laço `for (const part of replyParts) { ... }` (linha 915) e antes de `deliveryMetadata = {`:

```ts
    deliveredAt = new Date().toISOString();
```

Depois de `if (insertedMessages.error) throw new Error(insertedMessages.error.message);` (linha 960):

```ts
  // Evento de prova da Central de Agentes: só com a entrega feita e só quando quem chama é o caminho nativo.
  // Falha aqui só avisa (dentro da função), nunca derruba nem marca a resposta.
  if (payload.replyEvent && deliveredAt) {
    await registrarEventoDeResposta(admin, {
      organizationId: activeConnection.organization_id,
      channelConnectionId: activeConnection.id,
      threadId: payload.threadId,
      deliveredAt,
      ...payload.replyEvent,
    });
  }
```

- [ ] **Step 5: Rodar e ver passar (e as suítes do gerador)**

Run: `npx vitest run lib/conversations/aiReplyEvents.test.ts lib/conversations/aiReply`
Expected: PASS nos dois arquivos novos e em todos os `aiReply.*.test.ts` que já existiam (nenhum manda `replyEvent`, então nenhum grava evento).

- [ ] **Step 6: Escrever o teste do webhook que falha**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Central de Agentes, fatia 1: número com agente responde mesmo com aiPromptKey inválida (o prompt vem do
 * agente) e o gerador recebe a chave NULA, nunca `undefined` (que viraria o prompt padrão). O metadata
 * registra o sha do prompt em toda resposta nativa e agente e versão só com agente. O payload leva o
 * `replyEvent` que vira o evento de prova depois da entrega.
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
const PADRAO = 'task_conversations_whatsapp_auto_reply';

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
    const payload = executeMock.mock.calls[0][0].payload;
    expect(payload.metadata).toMatchObject({ prompt_source: 'agent', prompt_sha256: SHA, agent_id: AGENTE, agent_version: 3 });
    expect(payload.replyEvent).toEqual({ promptSha256: SHA, promptKey: null, promptSource: 'agent', agentId: AGENTE, agentVersion: 3 });
  });

  it('número sem agente e chave inválida continua sem responder (missing_prompt, como hoje)', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true, aiPromptKey: 'chave_invalida' }, null));

    await responder();

    expect(generateMock).not.toHaveBeenCalled();
  });

  it('número sem agente grava o sha do prompt, não ganha chave de agente, e o evento leva a chave usada', async () => {
    gateMock.mockResolvedValue(conexao({ aiEnabled: true }, null));
    generateMock.mockResolvedValue({ ok: true, source: 'default', promptSha256: SHA, agent: null, timing: MEDICAO, object: RESPOSTA });

    await responder();

    expect(generateMock.mock.calls[0][0].promptKey).toBe(PADRAO);
    const payload = executeMock.mock.calls[0][0].payload;
    expect(payload.metadata).toMatchObject({ prompt_source: 'default', prompt_sha256: SHA });
    expect('agent_id' in payload.metadata).toBe(false);
    expect('agent_version' in payload.metadata).toBe(false);
    expect(payload.replyEvent).toEqual({ promptSha256: SHA, promptKey: PADRAO, promptSource: 'default', agentId: null, agentVersion: null });
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

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run "app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts"`
Expected: FAIL no primeiro teste (`generateMock` não é chamado porque `promptKey` é nulo), no terceiro (`prompt_sha256` e `replyEvent` ausentes) e no quarto (`stage` sai `generation`).

- [ ] **Step 8: Implementar no `route.ts`**

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

Logo depois do bloco `metadata: { ... },` e antes de `automationSource: 'native_crm',` (linha 299):

```ts
          // Evento de prova (ai_reply_events), gravado por executeConversationAIReply depois da entrega. Sem
          // agente, a chave é a que o gerador usou (a efetiva da conexão); com agente, nula.
          replyEvent: {
            promptSha256: nativeReply.promptSha256,
            promptKey: nativeReply.agent ? null : promptKey,
            promptSource: nativeReply.source,
            agentId: nativeReply.agent?.id ?? null,
            agentVersion: nativeReply.agent?.version ?? null,
          },
```

Na classificação da falha (linhas 305-307):

```ts
      nativeFailureStage = nativeReply.reason === 'missing_api_key'
        || nativeReply.reason === 'missing_prompt'
        || nativeReply.reason === 'agent_unavailable'
        ? 'configuration'
        : 'generation';
```

- [ ] **Step 9: Rodar e ver passar (e as suítes do webhook)**

Run: `npx vitest run "app/api/public/channels/evolution/[connectionId]/webhook/"`
Expected: PASS em `route.agente.test.ts` e em todos os `route.*.test.ts` existentes (nenhum deles compara o payload inteiro nem `prompt_source`; conferido em 29/09).

Run: `npm run typecheck`
Expected: sem erros (`promptSource` do gerador é `'override' | 'default' | 'agent'`, o mesmo do evento).

- [ ] **Step 10: Commit**

```bash
git add lib/conversations/aiReplyEvents.ts lib/conversations/aiReplyEvents.test.ts lib/conversations/aiReply.ts lib/conversations/aiReply.eventoEntregue.test.ts "app/api/public/channels/evolution/[connectionId]/webhook/route.ts" "app/api/public/channels/evolution/[connectionId]/webhook/route.agente.test.ts"
git diff --cached --stat
git commit -m "feat(central-agentes): webhook responde pelo agente, registra versao e sha e grava o evento de prova depois da entrega"
```

---

### Task 9: As rotas do n8n e manual não gravam rastro nativo

A rota externa (`ai-reply`) aceita `metadata` livre (até 20 chaves), e a rota manual (`POST .../messages`, permissão `conversations.reply`) também; o merge só protege as chaves do sistema. A prova da migração já não lê metadata de mensagem nenhuma (ela lê `ai_reply_events`, Task 1), então estas duas limpezas protegem o que resta: a leitura humana da conversa e os números da fatia 6, que ainda olham `prompt_source`, `agent_id`, `agent_version` e `ai_timing` no metadata. Sem elas, quem tem o segredo do webhook, ou quem responde pela tela com `send_external: false` (gravado como entregue sem mandar nada), escreve uma "resposta nativa" com os campos que quiser (2ª rodada do Codex, achado 1).

É a única mudança desta fatia para número sem agente, além do `prompt_sha256` novo e do evento de prova, e a SPEC a declara como exceção (Runtime, item 7). No código, só o webhook escreve essas chaves e ninguém as lê em mensagem do n8n ou manual; a tela não manda nenhuma delas (conferido em 29/09: nenhuma ocorrência em `features/`, `components/` e `app/` fora do webhook e do `ai-reply`). Os fluxos do n8n são conferidos antes de publicar (Task 13).

**Files:**
- Modify: `lib/conversations/conversationDeliveryMetadata.ts`
- Modify: `lib/conversations/conversationDeliveryMetadata.test.ts`
- Modify: `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts` (import e a linha `metadata: parsed.data.metadata,`)
- Test: `app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts`
- Modify: `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts` (import e a linha 303, `let deliveryMetadata: Record<string, unknown> = parsed.data.metadata ?? {};`)
- Test: `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.rastro.test.ts`

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

  it('a lista cobre as seis chaves que a leitura humana e a visão da agência leem', () => {
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
    // Um pedido válido do n8n nunca leva evento de prova ao executor.
    expect('replyEvent' in payload).toBe(false);
  });

  it('corpo que tenta mandar o evento de prova é recusado pelo schema estrito (400) e nada é executado', async () => {
    // AIReplySchema é `.strict()`: campo fora da lista não chega ao executor (3ª rodada do Codex, achado 6).
    const response = await request({
      threadId: THREAD_ID,
      replyText: 'Oi!',
      replyEvent: { promptSha256: 'a'.repeat(64), promptKey: 'task_x', promptSource: 'default', agentId: null, agentVersion: null },
    });
    expect(response.status).toBe(400);
    expect(executeConversationAIReplyMock).not.toHaveBeenCalled();
  });

  it('sem metadata, continua sem metadata', async () => {
    await request({ threadId: THREAD_ID, replyText: 'Oi!' });
    expect(executeConversationAIReplyMock.mock.calls[0][0].payload.metadata).toBeUndefined();
  });
});
```

Criar `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.rastro.test.ts` (o arranjo é o de `route.assinatura.test.ts`, enxuto):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Envio manual com o rastro da resposta nativa forjado no metadata (2ª rodada do Codex, achado 1). A rota
 * tem que gravar a mensagem SEM essas chaves, inclusive no envio local (`send_external: false`), que fica
 * `sent` sem mandar nada ao WhatsApp.
 */
let fake: FakeSupabaseAdmin;
let entregue: Record<string, unknown> | null = null;
const requireTenantAccessMock = vi.fn();
const sendTextMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const USER = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => fake }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  resolveEvolutionCredentials: vi.fn(async () => ({ apiUrl: 'https://evolution.example.com', apiKey: 'CHAVE', source: 'connection' })),
}));
vi.mock('@/lib/channels/evolution', () => ({
  sendEvolutionTextMessage: (...args: unknown[]) => sendTextMock(...args),
}));
vi.mock('@/lib/conversations/conversationMedia', () => ({ dispatchConversationMedia: vi.fn() }));
vi.mock('@/lib/conversations/server', () => ({
  getConversationAssigneeDisplayName: () => 'Vitoria',
  loadConversationThreadInboxItem: vi.fn(async () => ({ id: THREAD })),
}));
// Executa o `deliver` de verdade e guarda o que seria persistido, sem o caminho de persistencia.
vi.mock('@/lib/conversations/dispatchConversationOutbound', () => ({
  dispatchManualConversationOutbound: async ({ message, deliver }: { message: Record<string, unknown>; deliver: () => Promise<unknown> }) => {
    entregue = message;
    await deliver();
    return { messageId: 'msg-1', status: 'sent', error: null };
  },
}));

import { POST } from './route';

const RASTRO = {
  native_ai: true,
  prompt_source: 'default',
  prompt_sha256: 'a'.repeat(64),
  agent_id: 'forjado',
  agent_version: 7,
  ai_timing: { total_ms: 1 },
};

function seed() {
  fake = createFakeSupabaseAdmin({
    conversation_threads: [{
      id: THREAD, organization_id: TENANT, status: 'human_active', metadata: {},
      channel_connection_id: CONNECTION, contact_phone: '5521999990000', assigned_user_id: USER, deal_id: null,
    }],
    channel_connections: [{
      id: CONNECTION, organization_id: TENANT, provider: 'evolution', channel_type: 'whatsapp', name: 'Recepcao',
      config: { instanceName: 'recepcao' },
    }],
    conversation_messages: [{
      id: 'msg-1', thread_id: THREAD, organization_id: TENANT, direction: 'outbound', message_type: 'text',
      author_name: 'Vitoria', content: '', metadata: {}, sent_at: '2026-09-29T12:00:00.000Z', created_at: '2026-09-29T12:00:00.000Z',
    }],
  });
}

function post(body: unknown) {
  return POST(
    new Request(`https://crm.test/api/platform/tenants/${TENANT}/conversations/${THREAD}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantId: TENANT, threadId: THREAD }) },
  );
}

const gravado = () => entregue as { metadata: Record<string, unknown> };

beforeEach(() => {
  vi.clearAllMocks();
  entregue = null;
  seed();
  sendTextMock.mockResolvedValue({ providerMessageId: 'evo-1', attemptLabel: 'number_text', raw: {} });
  requireTenantAccessMock.mockResolvedValue({
    profile: { id: USER, email: 'vitoria@cliente.com', first_name: 'Vitoria', last_name: null, nickname: 'Vitoria', role: 'clinic_staff', organization_id: TENANT },
  });
});

describe('envio manual e o rastro nativo', () => {
  it('envio local (send_external: false) com o rastro forjado: gravado SEM as seis chaves, e nada sai para o WhatsApp', async () => {
    const response = await post({ direction: 'outbound', content: 'parece nativa', send_external: false, metadata: { ...RASTRO, campanha: 'meta' } });

    expect(response.status).toBe(201);
    expect(sendTextMock).not.toHaveBeenCalled();
    const metadata = gravado().metadata;
    for (const chave of Object.keys(RASTRO)) expect(chave in metadata, chave).toBe(false);
    expect(metadata.campanha).toBe('meta');
    expect(metadata.atendente).toMatchObject({ atorId: USER });
  });

  it('envio normal com o rastro forjado: o texto sai e a mensagem é gravada sem as chaves', async () => {
    const response = await post({ direction: 'outbound', content: 'oi', metadata: RASTRO });

    expect(response.status).toBe(201);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    for (const chave of Object.keys(RASTRO)) expect(chave in gravado().metadata, chave).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/" "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.rastro.test.ts"`
Expected: FAIL: `stripNativeTraceMetadata` não existe; a rota do n8n repassa `prompt_sha256` e as outras chaves; a rota manual grava o metadata com as seis chaves.

- [ ] **Step 3: Implementar**

Em `lib/conversations/conversationDeliveryMetadata.ts`, depois de `mergeConversationDeliveryMetadata`:

```ts
/**
 * Chaves que só o caminho nativo grava (webhook → gerador). As rotas do n8n e manual aceitam metadata livre,
 * e o merge acima só protege as chaves do sistema: sem esta limpeza, quem tem o segredo do webhook, ou quem
 * responde pela tela, grava uma "resposta nativa" com os campos que quiser (a prova da migração não lê o
 * metadata, mas a leitura humana e a visão da agência leem).
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

Em `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`, o import (junto dos demais `@/lib/conversations/...`):

```ts
import { stripNativeTraceMetadata } from '@/lib/conversations/conversationDeliveryMetadata';
```

e a linha 303 passa a ser:

```ts
  // O navegador não grava rastro de resposta nativa (prompt, agente, tempo): Central de Agentes, fatia 1.
  let deliveryMetadata: Record<string, unknown> = stripNativeTraceMetadata(parsed.data.metadata) ?? {};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/" "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/"`
Expected: PASS (4 testes no metadata; 3 em `ai-reply/route.rastro.test.ts` e o `route.aiGate.test.ts` que já existia; 2 em `messages/route.rastro.test.ts` e os `route.assinatura.test.ts` e `route.idempotencia.test.ts` que já existiam).

- [ ] **Step 5: Commit**

```bash
git add lib/conversations/conversationDeliveryMetadata.ts lib/conversations/conversationDeliveryMetadata.test.ts "app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts" "app/api/public/channels/evolution/[connectionId]/ai-reply/route.rastro.test.ts" "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts" "app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.rastro.test.ts"
git diff --cached --stat
git commit -m "fix(conversas): rotas do n8n e manual nao gravam as chaves de rastro da resposta nativa"
```

---

### Task 10: Módulo de migração com prova contra a produção e a publicação no ar

A prova antiga comparava o script com ele mesmo: se o cálculo errasse, a v1 e a nova prova erravam igual e o hash batia (revisão adversarial, B1). Agora a referência é o **evento de prova** que a produção gravou (`ai_reply_events`, Tasks 1 e 8), e toda leitura é estrita. As três rodadas do Codex fecharam mais buracos, e todos entram aqui:
- quem escolhe o evento é a função do banco `central_agentes_ultima_resposta_nativa`, pela hora da **entrega**, só entre respostas do caminho de hoje (achados 11 e 12; 2ª rodada, 3 e 5);
- a prova não lê metadata de mensagem: manual e n8n não entram, com o que gravarem (2ª rodada, 1);
- o evento carrega a **chave** que respondeu, a **origem** do texto (padrão ou override) e o **commit da publicação**; a prova só confere quando os três batem com a configuração de hoje e com o que os domínios servem (2ª rodada, 2 e 7; 3ª rodada, 5);
- quem liga é `central_agentes_ligar_conexao`, que confere tudo de novo numa transação só (achado 13; 2ª rodada, 4);
- a publicação é lida por **ambiente**: todos os domínios que atendem aquele banco, o projeto, o ramo, o alvo e a promoção; e a lista fechada de domínios tem que ser a que o projeto tem na Vercel (3ª rodada, 4);
- depois de ligar, **qualquer** falha em confirmar a publicação desfaz a ligação, só do agente recém-ligado, e a linha é conferida (3ª rodada, 3);
- uma chamada de ligação que falha **sem resposta do banco** (rede, tempo esgotado, deadlock) é tratada como ligação possível: a linha é conferida e, se o número ficou com o agente, a ligação é desfeita (mesma família do achado 3);
- as conexões são lidas em páginas, o agente candidato é achado por filtro no banco (achado 18), e desligar confirma a linha (achado 19).

Situações de cada número na prova:
- `CONFERE`: o sha calculado é igual ao do evento, com a mesma chave, a mesma origem e a mesma publicação;
- `DIVERGE`: mesma chave e publicação, sha ou origem diferente (o texto mudou: override, catálogo);
- `CHAVE_DIVERGE`: o evento respondeu com outra chave (a configuração do número mudou depois da resposta);
- `PUBLICACAO_DIVERGE`: o evento veio de outra publicação (deploy ou rollback depois da resposta), ou sem commit (fora da Vercel, ou sem as variáveis de sistema);
- `SEM_RESPOSTA_AINDA`: nenhum evento do caminho de hoje para o número.

Só grupo com todos os números em `CONFERE` vira agente, e só a função do banco liga. A trava de que a cópia é o commit publicado fica no script (Task 11), porque depende do git; a leitura de qual commit os domínios servem fica em `lib/agents/publicacaoVercel.ts`, para ser testada sem rede.

Campos da API da Vercel conferidos nas respostas reais do projeto em 05/10 (só leitura): `/v4/aliases/{domínio}` devolve `deploymentId`, `projectId` e `redirect`; `/v13/deployments/{id}` devolve `id`, `projectId`, `readyState`, `readySubstate` (`PROMOTED` no deployment de produção, `STAGED` na prévia), `target` (`production` ou nulo), `createdAt` e `meta.githubCommitSha`/`githubCommitRef`; a lista `/v7/deployments` devolve `uid`, `state`, `readyState`, `readySubstate`, `created` e `createdAt`; `/v9/projects/{id}/domains` devolve `domains[].name` e `redirect`, e `pagination.next` (nulo com os quatro domínios de hoje). O filtro `branch` da lista também foi conferido: pedindo `main` e `feat/aurora-implantacao` vieram só deployments do ramo pedido, e sem filtro vieram os dois misturados.

**Files:**
- Modify: `test/helpers/fakeSupabaseAdmin.ts` (limite de linhas opcional; resposta de RPC por argumento)
- Modify: `test/helpers/fakeSupabaseAdmin.test.ts`
- Create: `lib/agents/publicacaoVercel.ts`
- Test: `lib/agents/publicacaoVercel.test.ts`
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

- [ ] **Step 5: Escrever o teste da publicação no ar que falha**

`lib/agents/publicacaoVercel.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { criarClienteVercel, lerPublicacaoNoAr, type AmbientePublicado, type ClienteVercel } from './publicacaoVercel';

const ATIVO = 'dpl_ativo';
const COMMIT = 'a'.repeat(40);
const PROJETO = 'prj_crm';
const DE_TESTE = ['teste.crm.exemplo.com'];
const DE_PRODUCAO = ['crm.exemplo.com', 'crm.outro.com.br'];
const TESTE: AmbientePublicado = { dominios: DE_TESTE, outrosDominiosDoProjeto: DE_PRODUCAO, ramo: 'feat/ensaio', projectId: PROJETO, producao: false };
const PRODUCAO: AmbientePublicado = { dominios: DE_PRODUCAO, outrosDominiosDoProjeto: DE_TESTE, ramo: 'main', projectId: PROJETO, producao: true };

type Deploy = {
  uid?: string; id?: string; projectId?: string; readyState: string; readySubstate?: string;
  target?: string | null; createdAt: number; meta?: Record<string, string>;
};

/** API falsa: domínios do projeto → alias (por domínio) → deployment ativo → lista do ramo. */
function api(opcoes: {
  ambiente?: AmbientePublicado;
  doProjeto?: Record<string, unknown>;
  alias?: Record<string, Record<string, unknown>>;
  ativo?: Partial<Deploy>;
  lista?: Deploy[];
} = {}): ClienteVercel {
  const ambiente = opcoes.ambiente ?? TESTE;
  const ativo: Deploy = {
    id: ATIVO,
    projectId: PROJETO,
    readyState: 'READY',
    readySubstate: ambiente.producao ? 'PROMOTED' : 'STAGED',
    target: ambiente.producao ? 'production' : null,
    createdAt: 1000,
    meta: { githubCommitSha: COMMIT, githubCommitRef: ambiente.ramo },
    ...opcoes.ativo,
  };
  return async (caminho) => {
    if (caminho === `/v9/projects/${PROJETO}/domains`) {
      return opcoes.doProjeto ?? { domains: [...DE_TESTE, ...DE_PRODUCAO].map((name) => ({ name, redirect: null })), pagination: { next: null } };
    }
    if (caminho.startsWith('/v4/aliases/')) {
      const dominio = decodeURIComponent(caminho.slice('/v4/aliases/'.length));
      return opcoes.alias?.[dominio] ?? { deploymentId: ATIVO, projectId: PROJETO, redirect: null };
    }
    if (caminho.startsWith(`/v13/deployments/${ATIVO}`)) return ativo;
    if (caminho.startsWith('/v7/deployments?')) return { deployments: opcoes.lista ?? [{ uid: ATIVO, readyState: 'READY', createdAt: 1000 }] };
    throw new Error(`caminho inesperado ${caminho}`);
  };
}

describe('qual commit os domínios do ambiente servem', () => {
  it('teste: alias → prévia pronta do ramo → commit', async () => {
    expect(await lerPublicacaoNoAr(api(), TESTE)).toEqual({ ok: true, commit: COMMIT, deploymentId: ATIVO, criadoEm: 1000 });
  });

  it('produção: os dois domínios servem o mesmo deployment de produção, promovido', async () => {
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO }), PRODUCAO)).toMatchObject({ ok: true, commit: COMMIT });
  });

  it('aceita o id em deployment.id e ignora deployments mais antigos ou com erro', async () => {
    const r = await lerPublicacaoNoAr(api({
      alias: { 'teste.crm.exemplo.com': { deployment: { id: ATIVO }, projectId: PROJETO } },
      lista: [
        { uid: 'dpl_velho', readyState: 'READY', createdAt: 900 },
        { uid: 'dpl_quebrado', readyState: 'ERROR', createdAt: 1100 },
        { uid: ATIVO, readyState: 'READY', createdAt: 1000 },
      ],
    }), TESTE);
    expect(r).toMatchObject({ ok: true, commit: COMMIT });
  });

  it('alias sem deployment, de outro projeto, ou que só redireciona', async () => {
    const com = (alias: Record<string, unknown>) => lerPublicacaoNoAr(api({ alias: { 'teste.crm.exemplo.com': alias } }), TESTE);
    expect(await com({ deploymentId: null, projectId: PROJETO })).toMatchObject({ ok: false, motivo: 'alias_sem_deployment' });
    expect(await com({ deploymentId: ATIVO, projectId: 'prj_outro' })).toMatchObject({ ok: false, motivo: 'projeto_diverge' });
    expect(await com({ deploymentId: ATIVO, projectId: PROJETO, redirect: 'outro.com' })).toMatchObject({ ok: false, motivo: 'alias_redireciona' });
  });

  it('domínios do mesmo ambiente servindo deployments diferentes', async () => {
    const r = await lerPublicacaoNoAr(api({
      ambiente: PRODUCAO,
      alias: { 'crm.outro.com.br': { deploymentId: 'dpl_outro', projectId: PROJETO } },
    }), PRODUCAO);
    expect(r).toMatchObject({ ok: false, motivo: 'dominios_divergem' });
  });

  it('a lista fechada tem que ser a do projeto: domínio novo na Vercel, domínio que saiu, ou lista incompleta', async () => {
    const com = (doProjeto: Record<string, unknown>) => lerPublicacaoNoAr(api({ doProjeto }), TESTE);
    const todos = [...DE_TESTE, ...DE_PRODUCAO].map((name) => ({ name, redirect: null as string | null }));
    // Domínio novo no projeto, fora da lista: serviria tráfego sem ser conferido.
    expect(await com({ domains: [...todos, { name: 'novo.exemplo.com', redirect: null }], pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem', detalhe: expect.stringContaining('novo.exemplo.com') });
    // Domínio da lista que saiu do projeto, ou que passou a só redirecionar.
    expect(await com({ domains: todos.slice(1), pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem', detalhe: expect.stringContaining(DE_TESTE[0]) });
    expect(await com({ domains: [{ name: DE_TESTE[0], redirect: 'outro.com' }, ...todos.slice(1)], pagination: { next: null } }))
      .toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem' });
    // Lista incompleta (paginada): recusa em vez de conferir pela metade.
    expect(await com({ domains: todos, pagination: { next: 123 } })).toMatchObject({ ok: false, motivo: 'dominios_do_projeto_divergem' });
    // Domínio fora da lista que só redireciona não serve conteúdo: não impede.
    expect(await com({ domains: [...todos, { name: 'www.exemplo.com', redirect: 'crm.exemplo.com' }], pagination: { next: null } }))
      .toMatchObject({ ok: true, commit: COMMIT });
  });

  it('deployment de outro projeto, sem commit de 40 hex, de outro ramo, ou ainda não pronto', async () => {
    const com = (ativo: Partial<Deploy>) => lerPublicacaoNoAr(api({ ativo }), TESTE);
    expect(await com({ projectId: 'prj_outro' })).toMatchObject({ ok: false, motivo: 'projeto_diverge' });
    expect(await com({ meta: { githubCommitRef: TESTE.ramo } })).toMatchObject({ ok: false, motivo: 'deployment_sem_commit' });
    expect(await com({ meta: { githubCommitSha: COMMIT, githubCommitRef: 'main' } })).toMatchObject({ ok: false, motivo: 'ramo_diverge' });
    expect(await com({ readyState: 'BUILDING' })).toMatchObject({ ok: false, motivo: 'nao_pronta' });
  });

  it('alvo errado: domínio de teste servido pelo deployment de PRODUÇÃO; produção não promovida ou de prévia', async () => {
    // Toda publicação de produção leva o domínio de teste junto: o "teste" passa a ser a produção.
    expect(await lerPublicacaoNoAr(api({ ativo: { target: 'production', readySubstate: 'PROMOTED' } }), TESTE))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO, ativo: { target: null, readySubstate: 'STAGED' } }), PRODUCAO))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
    expect(await lerPublicacaoNoAr(api({ ambiente: PRODUCAO, ativo: { readySubstate: 'STAGED' } }), PRODUCAO))
      .toMatchObject({ ok: false, motivo: 'alvo_diverge' });
  });

  it('transição: deployment mais novo do ramo construindo, ou qualquer rollout em andamento', async () => {
    const novo = (d: Partial<Deploy>) => lerPublicacaoNoAr(api({
      lista: [{ uid: 'dpl_novo', readyState: 'READY', createdAt: 2000, ...d }, { uid: ATIVO, readyState: 'READY', createdAt: 1000 }],
    }), TESTE);
    expect(await novo({ readyState: 'BUILDING' })).toMatchObject({ ok: false, motivo: 'em_transicao' });
    expect(await novo({ readySubstate: 'ROLLING' })).toMatchObject({ ok: false, motivo: 'em_transicao' });
    expect(await lerPublicacaoNoAr(api({ ativo: { readySubstate: 'ROLLING' } }), TESTE)).toMatchObject({ ok: false, motivo: 'em_transicao' });
  });

  it('deployment mais novo do ramo pronto e não servido (rollback, ou promoção que ainda não aconteceu)', async () => {
    const r = await lerPublicacaoNoAr(api({
      lista: [{ uid: 'dpl_novo', readyState: 'READY', createdAt: 2000 }, { uid: ATIVO, readyState: 'READY', createdAt: 1000 }],
    }), TESTE);
    expect(r).toMatchObject({ ok: false, motivo: 'mais_novo_nao_servido' });
  });
});

describe('cliente da API', () => {
  it('manda o token, acrescenta o teamId e falha em resposta fora de 2xx', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('/v4/aliases/')
      ? new Response(JSON.stringify({ deploymentId: ATIVO }), { status: 200 })
      : new Response('nope', { status: 403 })));
    const cliente = criarClienteVercel({ token: 'tok', teamId: 'team_1', fetchFn: fetchFn as never });
    expect(await cliente('/v4/aliases/x.com')).toEqual({ deploymentId: ATIVO });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.vercel.com/v4/aliases/x.com?teamId=team_1');
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toEqual({ authorization: 'Bearer tok' });
    await expect(cliente('/v7/deployments?projectId=p')).rejects.toThrow('403');
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run lib/agents/publicacaoVercel.test.ts`
Expected: FAIL com "Failed to resolve import ./publicacaoVercel".

- [ ] **Step 7: Criar `lib/agents/publicacaoVercel.ts`**

```ts
// Sem 'server-only': usado pelo script scripts/central-agentes/migrar-agentes.ts, fora do Next.
// Lê, pela API da Vercel, qual commit um ambiente está servindo AGORA (2ª rodada do Codex, achado 2;
// 3ª rodada, achado 4): `HEAD == origin/<ramo>` diz o que FOI publicado, não o que está no ar. Um
// rollback, um deploy ainda construindo ou um domínio apontando para outro deployment deixam o tráfego
// num commit diferente do ramo sem mexer no git.

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const EM_ANDAMENTO = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);

/** Um ambiente publicado: TODOS os domínios que atendem aquele banco, e de onde ele é publicado. */
export type AmbientePublicado = {
  dominios: readonly string[];
  /** Domínios do MESMO projeto que atendem o outro ambiente. Com `dominios`, formam a lista fechada do projeto. */
  outrosDominiosDoProjeto: readonly string[];
  ramo: string;
  projectId: string;
  /** Produção exige o deployment de produção, promovido. Teste exige que NÃO seja o de produção. */
  producao: boolean;
};

export type MotivoDaPublicacao =
  | 'dominios_do_projeto_divergem'
  | 'alias_sem_deployment'
  | 'alias_redireciona'
  | 'projeto_diverge'
  | 'dominios_divergem'
  | 'deployment_sem_commit'
  | 'ramo_diverge'
  | 'alvo_diverge'
  | 'nao_pronta'
  | 'em_transicao'
  | 'mais_novo_nao_servido';

export type PublicacaoNoAr =
  | { ok: true; commit: string; deploymentId: string; criadoEm: number }
  | { ok: false; motivo: MotivoDaPublicacao; detalhe: string };

/** GET autenticado na API da Vercel; devolve o JSON. Lança em resposta fora de 2xx. */
export type ClienteVercel = (caminho: string) => Promise<unknown>;

export function criarClienteVercel(opcoes: { token: string; teamId: string; fetchFn?: typeof fetch }): ClienteVercel {
  const fetchFn = opcoes.fetchFn ?? fetch;
  return async (caminho) => {
    const url = `https://api.vercel.com${caminho}${caminho.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(opcoes.teamId)}`;
    const resposta = await fetchFn(url, { headers: { authorization: `Bearer ${opcoes.token}` } });
    if (!resposta.ok) throw new Error(`Vercel ${caminho.split('?')[0]} respondeu ${resposta.status}`);
    return resposta.json();
  };
}

type DominiosDoProjeto = {
  domains?: Array<{ name?: string; redirect?: string | null }>;
  pagination?: { next?: number | null } | null;
};

type Alias = {
  deploymentId?: string | null;
  deployment?: { id?: string } | null;
  projectId?: string | null;
  redirect?: string | null;
};

type Deployment = {
  uid?: string;
  id?: string;
  projectId?: string;
  readyState?: string;
  state?: string;
  readySubstate?: string;
  target?: string | null;
  createdAt?: number;
  created?: number;
  meta?: Record<string, string>;
};

const recusa = (motivo: MotivoDaPublicacao, detalhe: string): PublicacaoNoAr => ({ ok: false, motivo, detalhe });

/**
 * Domínios do projeto → cada domínio do ambiente → alias → deployment. Só devolve `ok` se:
 *  - a lista fechada (este ambiente + o outro) é exatamente a dos domínios do projeto que servem conteúdo:
 *    um domínio novo na Vercel que ainda não entrou na lista serviria tráfego sem ser conferido;
 *  - todos os domínios servem o MESMO deployment, do projeto certo, sem redirecionar;
 *  - o deployment é do ramo, está READY, tem commit, e é do alvo certo (produção promovida, ou prévia);
 *  - não há rollout em andamento, nem deployment mais novo do ramo construindo (transição) ou pronto sem
 *    ser o servido (rollback, ou promoção que ainda não aconteceu: recusa conservadora).
 * Deployment mais novo com ERROR/CANCELED nunca foi para o ar e é ignorado.
 */
export async function lerPublicacaoNoAr(api: ClienteVercel, ambiente: AmbientePublicado): Promise<PublicacaoNoAr> {
  const doProjeto = (await api(`/v9/projects/${encodeURIComponent(ambiente.projectId)}/domains`)) as DominiosDoProjeto;
  if (doProjeto.pagination?.next) {
    return recusa('dominios_do_projeto_divergem', 'a lista de dominios do projeto veio incompleta (paginada)');
  }
  // Domínio que só redireciona não serve conteúdo; os demais têm que estar na lista fechada, e vice-versa.
  const servem = (doProjeto.domains ?? []).filter((d) => d.name && !d.redirect).map((d) => d.name as string);
  const conhecidos = [...ambiente.dominios, ...ambiente.outrosDominiosDoProjeto];
  const foraDaLista = servem.filter((d) => !conhecidos.includes(d));
  const faltando = conhecidos.filter((d) => !servem.includes(d));
  if (foraDaLista.length > 0 || faltando.length > 0) {
    return recusa(
      'dominios_do_projeto_divergem',
      `fora da lista: ${foraDaLista.join(', ') || '-'}; faltando no projeto: ${faltando.join(', ') || '-'}`,
    );
  }

  let deploymentId: string | null = null;
  for (const dominio of ambiente.dominios) {
    const alias = (await api(`/v4/aliases/${encodeURIComponent(dominio)}`)) as Alias;
    if (alias.redirect) return recusa('alias_redireciona', `${dominio} redireciona para ${alias.redirect}`);
    if (alias.projectId !== ambiente.projectId) return recusa('projeto_diverge', `${dominio} e do projeto ${alias.projectId ?? '?'}`);
    const id = alias.deploymentId ?? alias.deployment?.id ?? null;
    if (!id) return recusa('alias_sem_deployment', dominio);
    if (deploymentId && id !== deploymentId) return recusa('dominios_divergem', `${dominio} serve ${id}; outro dominio serve ${deploymentId}`);
    deploymentId = id;
  }
  if (!deploymentId) return recusa('alias_sem_deployment', 'ambiente sem dominio');

  const ativo = (await api(`/v13/deployments/${encodeURIComponent(deploymentId)}`)) as Deployment;
  const commit = (ativo.meta?.githubCommitSha ?? '').toLowerCase();
  const ramo = ativo.meta?.githubCommitRef ?? '';
  const estado = ativo.readyState ?? ativo.state ?? '';
  const criadoEm = ativo.createdAt ?? ativo.created ?? 0;
  if (ativo.projectId !== ambiente.projectId) return recusa('projeto_diverge', `${deploymentId} e do projeto ${ativo.projectId ?? '?'}`);
  if (!COMMIT_SHA.test(commit)) return recusa('deployment_sem_commit', deploymentId);
  if (ramo !== ambiente.ramo) return recusa('ramo_diverge', `${deploymentId} veio de ${ramo || '?'}, nao de ${ambiente.ramo}`);
  if (estado !== 'READY') return recusa('nao_pronta', `${deploymentId} ${estado}`);
  if (ativo.readySubstate === 'ROLLING') return recusa('em_transicao', `${deploymentId} em rollout`);
  const deProducao = ativo.target === 'production';
  if (ambiente.producao && !(deProducao && ativo.readySubstate === 'PROMOTED')) {
    return recusa('alvo_diverge', `${deploymentId} nao e o deployment de producao promovido (target=${ativo.target ?? 'previa'}, ${ativo.readySubstate ?? '?'})`);
  }
  if (!ambiente.producao && deProducao) {
    return recusa('alvo_diverge', `${deploymentId} e o deployment de PRODUCAO: o dominio de teste nao esta na previa`);
  }

  const lista = (await api(
    `/v7/deployments?projectId=${encodeURIComponent(ambiente.projectId)}&branch=${encodeURIComponent(ambiente.ramo)}&limit=20`,
  )) as { deployments?: Deployment[] };
  for (const d of lista.deployments ?? []) {
    const id = d.uid ?? d.id ?? '';
    const quando = d.createdAt ?? d.created ?? 0;
    const estadoDele = d.readyState ?? d.state ?? '';
    if (id === deploymentId || quando <= criadoEm) continue;
    if (EM_ANDAMENTO.has(estadoDele) || d.readySubstate === 'ROLLING') return recusa('em_transicao', `${id} ${d.readySubstate === 'ROLLING' ? 'em rollout' : estadoDele}`);
    if (estadoDele === 'READY') return recusa('mais_novo_nao_servido', `${id} esta pronto e e mais novo que o que os dominios servem`);
  }
  return { ok: true, commit, deploymentId, criadoEm };
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run lib/agents/publicacaoVercel.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 9: Escrever o teste do módulo de migração que falha**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin, type FakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import type { PublicacaoNoAr } from './publicacaoVercel';
import {
  criarAgentes,
  desligarConexao,
  lerAgenteDaConexao,
  ligarComConferencia,
  ligarConexao,
  planejarMigracao,
  sha256Hex,
  ultimaRespostaNativa,
} from './migracaoAgentes';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const TEXTO_AURORA = getPromptCatalogMap()[AURORA].defaultTemplate;
const SHA_AURORA = sha256Hex(TEXTO_AURORA);
const PUBLICACAO = 'a'.repeat(40);
const ENTREGUE_EM = '2026-09-30T11:00:00+00:00';

function conexao(id: string, org: string, config: Record<string, unknown>, aiAgentId: string | null = null) {
  return { id, organization_id: org, name: `Numero ${id}`, provider: 'evolution', channel_type: 'whatsapp', config, ai_agent_id: aiAgentId };
}

type Evento = { sha: string; chave?: string; origem?: string; publicacao?: string | null };

/** O último evento de prova de cada número, como a função do banco devolveria. */
function comEventos(admin: FakeSupabaseAdmin, porNumero: Record<string, Evento>) {
  admin.rpcResults.central_agentes_ultima_resposta_nativa = (args: Record<string, unknown>) => {
    const e = porNumero[String(args.p_connection_id)];
    return e
      ? [{
        out_sha256: e.sha,
        out_prompt_key: e.chave ?? AURORA,
        out_prompt_source: e.origem ?? 'default',
        out_release_commit: e.publicacao === undefined ? PUBLICACAO : e.publicacao,
        out_delivered_at: ENTREGUE_EM,
      }]
      : [];
  };
  return admin;
}

describe('prova contra a produção', () => {
  it('lê sha, chave, origem, publicação e hora da entrega pela função do banco', async () => {
    const admin = comEventos(createFakeSupabaseAdmin(), { c1: { sha: 'b'.repeat(64) } });
    expect(await ultimaRespostaNativa(admin as never, { id: 'c1' })).toEqual({
      sha256: 'b'.repeat(64), promptKey: AURORA, promptSource: 'default', releaseCommit: PUBLICACAO, deliveredAt: ENTREGUE_EM,
    });
    expect(admin.rpcCalls).toEqual([{ name: 'central_agentes_ultima_resposta_nativa', args: { p_connection_id: 'c1' } }]);
  });

  it('sem evento devolve null', async () => {
    expect(await ultimaRespostaNativa(comEventos(createFakeSupabaseAdmin(), {}) as never, { id: 'c1' })).toBeNull();
  });

  it('erro da função aborta em vez de devolver vazio', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcErrors.central_agentes_ultima_resposta_nativa = 'boom';
    await expect(ultimaRespostaNativa(admin as never, { id: 'c1' })).rejects.toThrow('boom');
  });
});

describe('migração do prompt de hoje para agentes', () => {
  it('agrupa por organização e prompt, e marca cada número com a situação na produção', async () => {
    const admin = comEventos(createFakeSupabaseAdmin({
      channel_connections: [
        conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA, aiAgentName: 'Aurora' }),
        conexao('c2', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c3', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c4', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c5', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c6', OUTRA, { aiEnabled: true, aiPromptKey: AURORA }),
        conexao('c7', ORG, { aiEnabled: true, aiPromptKey: AURORA }),
      ],
    }), {
      c1: { sha: SHA_AURORA },
      c2: { sha: 'f'.repeat(64) },
      c3: { sha: SHA_AURORA, chave: PADRAO },
      c4: { sha: SHA_AURORA, publicacao: 'b'.repeat(40) },
      c5: { sha: SHA_AURORA, publicacao: null },
      // Mesmo sha, mas aquela resposta saiu de um override: não prova o texto padrão de hoje.
      c7: { sha: SHA_AURORA, origem: 'override' },
    });
    const plano = await planejarMigracao(admin as never, { publicacao: PUBLICACAO });
    expect(plano.grupos).toHaveLength(2);
    const doOrg = plano.grupos.find((g) => g.organizationId === ORG)!;
    expect(doOrg).toMatchObject({ promptKey: AURORA, promptSource: 'default', sha256: SHA_AURORA, nome: 'Aurora', pronto: false });
    expect(doOrg.conexoes).toEqual([
      { id: 'c1', name: 'Numero c1', situacao: 'CONFERE', respostaEm: ENTREGUE_EM },
      { id: 'c2', name: 'Numero c2', situacao: 'DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c3', name: 'Numero c3', situacao: 'CHAVE_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c4', name: 'Numero c4', situacao: 'PUBLICACAO_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c5', name: 'Numero c5', situacao: 'PUBLICACAO_DIVERGE', respostaEm: ENTREGUE_EM },
      { id: 'c7', name: 'Numero c7', situacao: 'DIVERGE', respostaEm: ENTREGUE_EM },
    ]);
    const daOutra = plano.grupos.find((g) => g.organizationId === OUTRA)!;
    expect(daOutra.conexoes[0]).toMatchObject({ situacao: 'SEM_RESPOSTA_AINDA', respostaEm: null });
  });

  it('com todos os números em CONFERE o grupo fica pronto', async () => {
    const admin = comEventos(createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
    }), { c1: { sha: SHA_AURORA } });
    const plano = await planejarMigracao(admin as never, { publicacao: PUBLICACAO });
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
    const plano = await planejarMigracao(admin as never, { publicacao: PUBLICACAO });
    expect(plano.grupos).toHaveLength(0);
    expect(plano.ignoradas.map((i) => [i.id, i.motivo])).toEqual([
      ['invalida', 'chave_invalida'],
      ['ligada', 'ja_ligada'],
      ['sem-ia', 'sem_ia'],
    ]);
    const forcado = await planejarMigracao(admin as never, { incluir: ['sem-ia'], publicacao: PUBLICACAO });
    expect(forcado.grupos.map((g) => g.conexoes[0].id)).toEqual(['sem-ia']);
  });

  it('erro ao ler o override aborta o plano (nunca cai no catálogo)', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })] });
    admin.failOn('ai_prompt_templates', 'select', 'boom');
    await expect(planejarMigracao(admin as never, { publicacao: PUBLICACAO })).rejects.toThrow('boom');
  });

  it('lê todas as conexões, em páginas, acima do limite de linhas do PostgREST', async () => {
    const conexoes = Array.from({ length: 1001 }, (_, i) => conexao(`c${String(i).padStart(4, '0')}`, ORG, { aiEnabled: false }));
    const admin = createFakeSupabaseAdmin({ channel_connections: conexoes }, { maxLinhas: 1000 });
    const plano = await planejarMigracao(admin as never, { publicacao: PUBLICACAO });
    expect(plano.ignoradas).toHaveLength(1001);
  });

  it('criarAgentes só cria grupo pronto, só da organização pedida, com o sha do próprio conteúdo', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcResults.create_ai_agent_from_legacy_prompt = [{ out_agent_id: 'a1', out_version_id: 'v1', out_created: true }];
    const pronto = {
      organizationId: ORG, promptKey: AURORA, promptSource: 'default' as const, conteudo: 'X', sha256: sha256Hex('X'), nome: 'Aurora', pronto: true,
      conexoes: [{ id: 'c1', name: 'n', situacao: 'CONFERE' as const, respostaEm: ENTREGUE_EM }],
    };
    const naoPronto = {
      ...pronto, conteudo: 'Y', sha256: sha256Hex('Y'), pronto: false,
      conexoes: [{ id: 'c2', name: 'm', situacao: 'DIVERGE' as const, respostaEm: ENTREGUE_EM }],
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

  it('ligarConexao acha o agente no banco e manda para a função a chave bruta, a efetiva, a origem, o sha e a publicação', async () => {
    const semear = () => createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [
        { id: 'a1', organization_id: ORG, published_version_id: 'v1', origin: { kind: 'migration', sha256: SHA_AURORA } },
        { id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } },
      ],
    });

    const certo = semear();
    certo.rpcResults.central_agentes_ligar_conexao = 'ligado';
    expect(await ligarConexao(certo as never, 'c1', { publicacao: PUBLICACAO })).toEqual({ ok: true, agentId: 'a1' });
    expect(certo.rpcCalls).toEqual([{
      name: 'central_agentes_ligar_conexao',
      args: { p_connection_id: 'c1', p_agent_id: 'a1', p_chave_bruta: AURORA, p_prompt_key: AURORA, p_prompt_source: 'default', p_sha256: SHA_AURORA, p_publicacao: PUBLICACAO },
    }]);

    const recusado = semear();
    recusado.rpcResults.central_agentes_ligar_conexao = 'publicacao_diverge';
    expect(await ligarConexao(recusado as never, 'c1', { publicacao: PUBLICACAO })).toEqual({ ok: false, motivo: 'publicacao_diverge' });

    // A chamada falhou sem resposta do banco: o resultado diz qual agente estava sendo ligado, para quem
    // chamou conferir a linha (a transação pode ter sido gravada antes de a resposta se perder).
    const semResposta = semear();
    semResposta.rpcErrors.central_agentes_ligar_conexao = 'fetch failed';
    expect(await ligarConexao(semResposta as never, 'c1', { publicacao: PUBLICACAO }))
      .toEqual({ ok: false, motivo: 'chamada_falhou', agentId: 'a1', detalhe: 'fetch failed' });
    // Resposta sem o resultado da função também não prova nada.
    const vazia = semear();
    expect(await ligarConexao(vazia as never, 'c1', { publicacao: PUBLICACAO }))
      .toMatchObject({ ok: false, motivo: 'chamada_falhou', agentId: 'a1' });
  });

  it('ligarConexao sem agente criado para aquele sha não chama a função', async () => {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [{ id: 'a2', organization_id: ORG, published_version_id: 'v2', origin: { kind: 'migration', sha256: 'f'.repeat(64) } }],
    });
    expect(await ligarConexao(admin as never, 'c1', { publicacao: PUBLICACAO })).toEqual({ ok: false, motivo: 'agente_nao_criado' });
    expect(admin.rpcCalls).toEqual([]);
  });

  it('desligarConexao confirma a linha desligada e distingue número inexistente', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true }, 'a1')] });
    expect(await desligarConexao(admin as never, 'c1')).toEqual({ ok: true });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
    expect(await desligarConexao(admin as never, 'nao-existe')).toEqual({ ok: false, detalhe: 'conexao_inexistente' });
  });

  it('desligarConexao condicionado só desliga se o número ainda está com AQUELE agente', async () => {
    const admin = createFakeSupabaseAdmin({ channel_connections: [conexao('c1', ORG, { aiEnabled: true }, 'outro-agente')] });
    expect(await desligarConexao(admin as never, 'c1', { seAgente: 'a1' })).toEqual({ ok: false, detalhe: 'nao_estava_com_esse_agente' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('outro-agente');
    expect(await lerAgenteDaConexao(admin as never, 'c1')).toEqual({ existe: true, agentId: 'outro-agente' });
    expect(await lerAgenteDaConexao(admin as never, 'nao-existe')).toEqual({ existe: false, agentId: null });
  });
});

describe('ligar com conferência da publicação antes e depois (3ª rodada do Codex, achado 3)', () => {
  const NO_AR: PublicacaoNoAr = { ok: true, commit: PUBLICACAO, deploymentId: 'dpl_1', criadoEm: 1 };

  /** Número pronto para ligar; a função do banco falsa liga de verdade a linha, como a real. */
  function pronto() {
    const admin = createFakeSupabaseAdmin({
      channel_connections: [conexao('c1', ORG, { aiEnabled: true, aiPromptKey: AURORA })],
      ai_agents: [{ id: 'a1', organization_id: ORG, published_version_id: 'v1', origin: { kind: 'migration', sha256: SHA_AURORA } }],
    });
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      admin.tables.channel_connections[0].ai_agent_id = args.p_agent_id;
      return 'ligado';
    };
    return admin;
  }

  /** Leituras da publicação em sequência; uma função na fila é chamada (para lançar). */
  function publicacoes(...fila: Array<PublicacaoNoAr | (() => never)>) {
    let i = 0;
    return async () => {
      const proxima = fila[Math.min(i++, fila.length - 1)];
      return typeof proxima === 'function' ? proxima() : proxima;
    };
  }

  it('publicação igual antes e depois: fica ligado', async () => {
    const admin = pronto();
    expect(await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, NO_AR), PUBLICACAO))
      .toEqual({ estado: 'ligado', agentId: 'a1', publicacao: PUBLICACAO });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('a1');
  });

  it('publicação que não confere ANTES: nem chama o banco', async () => {
    const admin = pronto();
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes({ ok: false, motivo: 'em_transicao', detalhe: 'dpl_2 BUILDING' }), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'nao_ligou' });
    const outra = await ligarComConferencia(admin as never, 'c1', publicacoes({ ...NO_AR, commit: 'b'.repeat(40) }), PUBLICACAO);
    expect(outra).toMatchObject({ estado: 'nao_ligou' });
    expect(admin.rpcCalls).toEqual([]);
  });

  it('a leitura depois de ligar LANÇA (rede, 500): a ligação é desfeita e a linha conferida', async () => {
    const admin = pronto();
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, () => { throw new Error('Vercel /v4/aliases respondeu 500'); }), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a publicação mudou, ou ficou inconclusiva, depois de ligar: desfaz', async () => {
    for (const depois of [{ ...NO_AR, commit: 'b'.repeat(40) }, { ok: false as const, motivo: 'mais_novo_nao_servido' as const, detalhe: 'dpl_2' }]) {
      const admin = pronto();
      const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR, depois), PUBLICACAO);
      expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
      expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
    }
  });

  it('não deu para desfazer: devolve INCERTO, nunca "desfeito"', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => { throw new Error('rede'); });
    const original = admin.rpcResults.central_agentes_ligar_conexao as (a: Record<string, unknown>) => unknown;
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      const saida = original(args);
      admin.failOn('channel_connections', 'update', 'boom');
      return saida;
    };
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toMatchObject({ estado: 'incerto', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('a1');
  });

  it('o desfazer não derruba uma ligação diferente feita por outra pessoa nesse meio-tempo', async () => {
    const admin = pronto();
    const leitura = publicacoes(NO_AR, () => {
      // Entre a nossa ligação e a conferência, alguém ligou o número a OUTRO agente.
      admin.tables.channel_connections[0].ai_agent_id = 'agente-de-outra-pessoa';
      throw new Error('rede');
    });
    const r = await ligarComConferencia(admin as never, 'c1', leitura, PUBLICACAO);
    expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBe('agente-de-outra-pessoa');
  });

  it('a chamada de ligação falha DEPOIS de o banco gravar (resposta perdida): desfaz e confere a linha', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = (args: Record<string, unknown>) => {
      admin.tables.channel_connections[0].ai_agent_id = args.p_agent_id;
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'desfeito', agentId: 'a1' });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a chamada de ligação devolve erro SEM gravar (deadlock, por exemplo): não ligou, com a linha conferida', async () => {
    const admin = pronto();
    admin.rpcErrors.central_agentes_ligar_conexao = 'deadlock detected';
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'nao_ligou', motivo: expect.stringContaining('deadlock detected') });
    expect(admin.tables.channel_connections[0].ai_agent_id).toBeNull();
  });

  it('a chamada de ligação falha e a linha não pode ser lida: INCERTO', async () => {
    const admin = pronto();
    admin.rpcResults.central_agentes_ligar_conexao = () => {
      admin.failOn('channel_connections', 'select', 'sem rede');
      throw new Error('fetch failed');
    };
    const r = await ligarComConferencia(admin as never, 'c1', publicacoes(NO_AR), PUBLICACAO);
    expect(r).toMatchObject({ estado: 'incerto', agentId: 'a1' });
  });
});
```

- [ ] **Step 10: Rodar e ver falhar**

Run: `npx vitest run lib/agents/migracaoAgentes.test.ts`
Expected: FAIL com "Failed to resolve import ./migracaoAgentes".

- [ ] **Step 11: Criar `lib/agents/migracaoAgentes.ts`**

```ts
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buscarPromptResolvidoEstrito } from '@/lib/ai/prompts/resolve';
import { resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import type { PublicacaoNoAr } from '@/lib/agents/publicacaoVercel';

// Sem 'server-only': usado pelo script scripts/central-agentes/migrar-agentes.ts, fora do Next.
// Toda leitura aqui é ESTRITA: erro de banco lança e aborta o script. Nunca cair no catálogo por erro.

export function sha256Hex(texto: string) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** Página da leitura de conexões: abaixo do `max_rows` do PostgREST (1.000 no local). */
const PAGINA = 500;

type ConexaoLida = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
  ai_agent_id: string | null;
};

export type SituacaoNaProducao = 'CONFERE' | 'DIVERGE' | 'CHAVE_DIVERGE' | 'PUBLICACAO_DIVERGE' | 'SEM_RESPOSTA_AINDA';

export type ConexaoDoGrupo = {
  id: string;
  name: string;
  situacao: SituacaoNaProducao;
  /** Hora da entrega da resposta usada na prova (`delivered_at` do evento). */
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

export type RespostaDaProducao = {
  sha256: string;
  promptKey: string | null;
  /** De onde veio o texto daquela resposta: 'default' (catálogo) ou 'override'. */
  promptSource: string;
  /** Commit da publicação que respondeu (VERCEL_GIT_COMMIT_SHA); nulo fora da Vercel. */
  releaseCommit: string | null;
  deliveredAt: string;
};

/**
 * O ÚLTIMO EVENTO de prova deste número pelo caminho de hoje (ai_reply_events), escolhido pela função do
 * banco central_agentes_ultima_resposta_nativa, pela hora da entrega. Não é "a última resposta entregue":
 * uma resposta cujo registro falhou não tem evento. A prova do texto não depende disso: o evento é a
 * testemunha de que a publicação R, com a chave K e a origem O (padrão ou override), chega ao texto de sha S;
 * o script confere que a cópia é R e que os domínios servem R, e a função de ligar confere de novo, na hora,
 * a chave e o override.
 */
export async function ultimaRespostaNativa(
  admin: SupabaseClient,
  conexao: { id: string },
): Promise<RespostaDaProducao | null> {
  const { data, error } = await admin.rpc('central_agentes_ultima_resposta_nativa', { p_connection_id: conexao.id });
  if (error) throw new Error(`Falha ao ler a ultima resposta do numero ${conexao.id}: ${error.message}`);
  const [linha] = (data ?? []) as Array<{
    out_sha256: string; out_prompt_key: string | null; out_prompt_source: string; out_release_commit: string | null; out_delivered_at: string;
  }>;
  if (!linha) return null;
  return {
    sha256: linha.out_sha256,
    promptKey: linha.out_prompt_key,
    promptSource: linha.out_prompt_source,
    releaseCommit: linha.out_release_commit,
    deliveredAt: linha.out_delivered_at,
  };
}

function situacaoNaProducao(
  calculado: { sha256: string; promptKey: string; promptSource: 'override' | 'default'; publicacao: string },
  producao: RespostaDaProducao | null,
): SituacaoNaProducao {
  if (!producao) return 'SEM_RESPOSTA_AINDA';
  if (producao.releaseCommit !== calculado.publicacao) return 'PUBLICACAO_DIVERGE';
  if (producao.promptKey !== calculado.promptKey) return 'CHAVE_DIVERGE';
  // O evento tem que ser do MESMO caso: mesmo sha E mesma origem. Um evento de override com o mesmo sha
  // não prova o texto padrão (3ª rodada do Codex, achado 5).
  return producao.sha256 === calculado.sha256 && producao.promptSource === calculado.promptSource ? 'CONFERE' : 'DIVERGE';
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

/**
 * Só leitura. Um grupo por (organização, sha256 do prompt efetivo de hoje), com a situação de cada número.
 * `publicacao` é o commit que os domínios servem, lido pelo script na Vercel: o evento tem que ter vindo dele.
 */
export async function planejarMigracao(
  admin: SupabaseClient,
  filtro: { organizationId?: string; incluir?: string[]; publicacao: string },
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
      situacao: situacaoNaProducao({ sha256, promptKey, promptSource: resolvido.source, publicacao: filtro.publicacao }, producao),
      respostaEm: producao?.deliveredAt ?? null,
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
  | 'publicacao_invalida'
  | 'conexao_inexistente'
  | 'ja_ligada'
  | 'chave_mudou'
  | 'chave_efetiva_diverge'
  | 'override_mudou'
  | 'origem_invalida'
  | 'versao_publicada_diverge'
  | 'prova_nao_confere'
  | 'publicacao_diverge';

export type ResultadoLigar =
  | { ok: true; agentId: string }
  | { ok: false; motivo: MotivoDoBanco | 'chave_invalida' | 'prompt_inexistente' | 'agente_nao_criado' }
  /**
   * A chamada da função falhou sem dizer o que o banco fez (rede, tempo esgotado, deadlock). A transação
   * pode ter sido gravada antes de a resposta se perder: quem chamou tem que conferir a linha.
   */
  | { ok: false; motivo: 'chamada_falhou'; agentId: string; detalhe: string };

/**
 * Calcula o prompt de hoje, acha o agente de migração com o mesmo sha e pede ao banco para ligar. A função
 * do banco confere tudo de novo numa transação só (chave bruta e efetiva, override, versão publicada e o
 * último evento de prova, com a publicação que o script conferiu nos domínios), com a tabela de prompts,
 * o número e o agente travados, e devolve o motivo quando recusa.
 */
export async function ligarConexao(
  admin: SupabaseClient,
  connectionId: string,
  opcoes: { publicacao: string },
): Promise<ResultadoLigar> {
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

  // Daqui para baixo o banco pode ter gravado. Erro devolvido ou lançado pela chamada NÃO prova que a
  // transação não aconteceu (a resposta pode ter se perdido depois do commit): devolve `chamada_falhou`
  // com o agente, em vez de lançar, para quem chamou conferir a linha.
  let resposta: { data: unknown; error: { message: string } | null };
  try {
    resposta = await admin.rpc('central_agentes_ligar_conexao', {
      p_connection_id: connectionId,
      p_agent_id: agentId,
      p_chave_bruta: typeof config.aiPromptKey === 'string' ? config.aiPromptKey : null,
      p_prompt_key: promptKey,
      p_prompt_source: resolvido.source,
      p_sha256: sha256,
      p_publicacao: opcoes.publicacao,
    });
  } catch (erro) {
    return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
  if (resposta.error) return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: resposta.error.message };
  if (typeof resposta.data !== 'string') {
    return { ok: false, motivo: 'chamada_falhou', agentId, detalhe: 'a funcao nao devolveu o resultado' };
  }
  if (resposta.data === 'ligado') return { ok: true, agentId };
  return { ok: false, motivo: resposta.data as MotivoDoBanco };
}

/**
 * Volta o número ao caminho de hoje, confirmando a linha. O config da conexão nunca foi tocado.
 * Com `seAgente`, só desliga se o número ainda está com AQUELE agente: é o desfazer de uma ligação
 * recém-feita, que não pode derrubar uma ligação diferente feita por outra pessoa nesse meio-tempo.
 */
export async function desligarConexao(
  admin: SupabaseClient,
  connectionId: string,
  opcoes: { seAgente?: string } = {},
): Promise<{ ok: true } | { ok: false; detalhe: string }> {
  let consulta = admin.from('channel_connections').update({ ai_agent_id: null }).eq('id', connectionId);
  if (opcoes.seAgente) consulta = consulta.eq('ai_agent_id', opcoes.seAgente);
  const { data, error } = await consulta.select('id');
  if (error) return { ok: false, detalhe: error.message };
  if (data && data.length > 0) return { ok: true };
  return { ok: false, detalhe: opcoes.seAgente ? 'nao_estava_com_esse_agente' : 'conexao_inexistente' };
}

/** A qual agente o número está ligado agora (nulo = caminho de hoje). Erro de leitura lança. */
export async function lerAgenteDaConexao(
  admin: SupabaseClient,
  connectionId: string,
): Promise<{ existe: boolean; agentId: string | null }> {
  const { data, error } = await admin.from('channel_connections').select('id, ai_agent_id').eq('id', connectionId).maybeSingle();
  if (error) throw new Error(`Falha ao ler o numero ${connectionId}: ${error.message}`);
  const linha = data as { ai_agent_id: string | null } | null;
  return { existe: Boolean(linha), agentId: linha?.ai_agent_id ?? null };
}

export type ResultadoLigarConferido =
  | { estado: 'ligado'; agentId: string; publicacao: string }
  /** Nada ficou ligado por esta chamada: recusa, ou chamada que falhou com a linha conferida sem o agente. */
  | { estado: 'nao_ligou'; motivo: string }
  /** Ligou (ou pode ter ligado), não deu para confirmar, e a ligação foi desfeita, com a linha conferida. */
  | { estado: 'desfeito'; agentId: string; motivo: string }
  /** Ligou (ou pode ter ligado) e NÃO deu para confirmar o desfazer: o número pode estar ligado. */
  | { estado: 'incerto'; agentId: string; motivo: string; detalhe: string };

/**
 * Desfaz a ligação daquele agente e confere a linha. `ligouComCerteza` é falso quando a chamada de ligar
 * falhou sem resposta: aí o número pode nunca ter ficado com o agente.
 *  - a linha continua com o agente, ou não pôde ser lida → `incerto`;
 *  - a linha não está com o agente e havia ligação (certa, ou achada pelo desfazer) → `desfeito`;
 *  - a linha não está com o agente e a chamada que falhou nunca chegou a gravar → `nao_ligou`.
 * O desfazer é condicionado ao agente: uma ligação diferente, feita por outra pessoa nesse meio-tempo, fica.
 */
async function desfazerEConferir(
  admin: SupabaseClient,
  connectionId: string,
  agentId: string,
  motivo: string,
  ligouComCerteza: boolean,
): Promise<ResultadoLigarConferido> {
  try {
    const desfez = await desligarConexao(admin, connectionId, { seAgente: agentId });
    const agora = await lerAgenteDaConexao(admin, connectionId);
    if (agora.agentId === agentId) {
      return { estado: 'incerto', agentId, motivo, detalhe: 'o numero continua ligado a esse agente' };
    }
    return ligouComCerteza || desfez.ok ? { estado: 'desfeito', agentId, motivo } : { estado: 'nao_ligou', motivo };
  } catch (erro) {
    return { estado: 'incerto', agentId, motivo, detalhe: erro instanceof Error ? erro.message : String(erro) };
  }
}

/**
 * Liga com a publicação conferida antes e depois (2ª rodada do Codex, achado 2; 3ª rodada, achado 3).
 * Antes de chamar o banco, um erro de leitura lança: nada foi ligado. Da chamada em diante o número PODE
 * estar ligado, então qualquer coisa que impeça confirmar desfaz a ligação, só daquele agente, e a linha é
 * lida de novo para conferir:
 *  - a chamada de ligar falhou sem resposta do banco (a transação pode ter sido gravada);
 *  - a publicação mudou, ficou inconclusiva, ou a leitura dela lançou (rede, 500).
 * Se o processo morrer entre a ligação e a conferência, o número fica ligado com uma prova que valia
 * segundos antes; o `--prova` seguinte mostra o número como `ja_ligada` e o operador decide.
 */
export async function ligarComConferencia(
  admin: SupabaseClient,
  connectionId: string,
  lerPublicacao: () => Promise<PublicacaoNoAr>,
  commit: string,
): Promise<ResultadoLigarConferido> {
  const antes = await lerPublicacao();
  if (!antes.ok) return { estado: 'nao_ligou', motivo: `publicacao ${antes.motivo} (${antes.detalhe})` };
  if (antes.commit !== commit) {
    return { estado: 'nao_ligou', motivo: `os dominios servem ${antes.commit.slice(0, 7)} e esta copia esta em ${commit.slice(0, 7)}` };
  }

  const ligada = await ligarConexao(admin, connectionId, { publicacao: antes.commit });
  if (!ligada.ok) {
    if (ligada.motivo !== 'chamada_falhou') return { estado: 'nao_ligou', motivo: ligada.motivo };
    return desfazerEConferir(
      admin,
      connectionId,
      ligada.agentId,
      `a chamada de ligacao falhou sem resposta do banco (${ligada.detalhe})`,
      false,
    );
  }

  let motivo: string;
  try {
    const depois = await lerPublicacao();
    if (depois.ok && depois.commit === antes.commit) return { estado: 'ligado', agentId: ligada.agentId, publicacao: antes.commit };
    motivo = depois.ok
      ? `a publicacao mudou para ${depois.commit.slice(0, 7)} durante a ligacao`
      : `publicacao ${depois.motivo} depois de ligar (${depois.detalhe})`;
  } catch (erro) {
    motivo = `nao foi possivel ler a publicacao depois de ligar (${erro instanceof Error ? erro.message : String(erro)})`;
  }
  return desfazerEConferir(admin, connectionId, ligada.agentId, motivo, true);
}
```

- [ ] **Step 12: Rodar e ver passar**

Run: `npx vitest run lib/agents/ test/helpers/fakeSupabaseAdmin.test.ts`
Expected: PASS (agentRuntime, publicacaoVercel com 11 testes, migracaoAgentes com 22 testes, e o banco falso).

- [ ] **Step 13: Commit**

```bash
git add test/helpers/fakeSupabaseAdmin.ts test/helpers/fakeSupabaseAdmin.test.ts lib/agents/publicacaoVercel.ts lib/agents/publicacaoVercel.test.ts lib/agents/migracaoAgentes.ts lib/agents/migracaoAgentes.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): migracao com prova por evento, publicacao no ar por ambiente e ligacao que desfaz se nao confirmar"
```

---

### Task 11: Script de linha de comando

A prova compara o prompt calculado nesta cópia com o que a produção gravou. Isso só vale se a cópia for o código que está **no ar**, e são duas travas, porque uma não cobre a outra:
- **git:** `--prova`, `--criar` e `--ligar` fazem `git fetch` do ramo do ambiente e só seguem com `HEAD == origin/<ramo>` e sem mudança local nos arquivos que decidem o prompt (revisão do Codex, achado 10). Isso diz o que FOI publicado;
- **Vercel:** leem pela API qual deployment **cada domínio do ambiente** serve (`lib/agents/publicacaoVercel.ts`) e só seguem se todos servem o mesmo deployment, do projeto e do ramo certos, com o commit do HEAD, sem transição, rollout ou deployment mais novo não servido. Depois de um rollback, o ramo e o HEAD continuam no commit A e o domínio responde com B: só a Vercel mostra isso (2ª rodada do Codex, achado 2).

**O ambiente sai do banco conectado, numa lista fechada** (3ª rodada do Codex, achado 4). Antes o operador passava `--ramo-publicado` e `--dominio`, e nada amarrava o domínio informado ao banco em uso. Agora o script conhece dois bancos, cada um com o projeto da Vercel, o ramo e **todos** os domínios que o atendem; para qualquer outro banco (inclusive o local) `--prova`, `--criar` e `--ligar` são recusados, porque não há publicação para conferir. A lista é conferida contra a Vercel a cada leitura: se o projeto tiver um domínio que não está nela, ou perder um que está, o script recusa com `dominios_do_projeto_divergem` até a lista ser atualizada.

| Banco | Ambiente | Ramo | Domínios (todos conferidos) |
|---|---|---|---|
| `eqidsihasmwwamkaqfka` | produção | `main` | `crm.basea2.com`, `crm.cennohub.com.br`, `basecrm.vercel.app` |
| `zvwngsrflkicbbzfmrgy` | teste | `feat/aurora-implantacao` | `teste.crm.basea2.com` |

(Conferido em 05/10 na API: os três domínios de produção servem o mesmo deployment de produção, e o de teste serve a prévia da branch de ensaio.)

`--ligar` confere a publicação **três vezes**: antes de ligar, dentro da função do banco (o evento tem que ter vindo desse commit) e de novo depois de ligar. Depois de ligar, qualquer coisa que impeça confirmar (commit diferente, resposta inconclusiva, erro de rede) desfaz a ligação; se nem o desfazer puder ser confirmado, o script sai com código **3** e diz que o número pode estar ligado (3ª rodada, achado 3). A chamada de ligar que falha sem resposta do banco recebe o mesmo tratamento, porque a transação pode ter sido gravada antes de a resposta se perder. A lógica está em `ligarComConferencia` (Task 10), com teste; o script só traduz o resultado em mensagem e código de saída.

**Nesta fatia, `--ligar` só roda no ambiente de teste.** Em produção ele é recusado por código (`LIGAR_EM_PRODUCAO_LIBERADO = false`). Falta uma conferência que a trava da publicação não faz: em que endereço o webhook de cada número está registrado na Evolution. Quem grava esse endereço é a origem de quem clica em conectar ou no healthcheck do número (`registerCrmWebhook`, com `requestOrigin`), então ele pode estar fora da lista fechada (uma prévia, ou o endereço automático que a Vercel dá a cada branch e a cada deployment) e ser servido por outro código. A fatia 2 acrescenta essa leitura (`GET /webhook/find` da Evolution) antes de liberar a ligação em produção. No ensaio, a resposta real pedida logo antes de ligar mostra qual publicação atendeu o número (`release_commit` do evento).

**Files:**
- Create: `scripts/central-agentes/migrar-agentes.ts`

- [ ] **Step 1: Criar o script**

```ts
/**
 * Central de Agentes, fatia 1 — migração do prompt de hoje para agentes.
 *
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova [--org <uuid>] [--incluir <id,id>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --criar --org <uuid> --confirmar-banco <ref> [--incluir <id,id>]
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --ligar <connectionId> --confirmar-banco <ref>
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --desligar <connectionId> --confirmar-banco <ref>
 *
 * O ambiente (ramo publicado, projeto da Vercel e TODOS os domínios que atendem o banco) sai do banco
 * conectado, numa lista fechada (AMBIENTES). A prova só vale com esta cópia exatamente no commit publicado
 * (HEAD == origin/<ramo>, depois de um fetch), sem mudança local nos arquivos que decidem o prompt, E com
 * todos os domínios do ambiente servindo esse mesmo commit (lido na API da Vercel, recusando transição,
 * rollout e deployment mais novo não servido).
 *
 * Credenciais no ambiente (nunca impressas): NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_URL, SUPABASE_SECRET_KEY ou
 * SUPABASE_SERVICE_ROLE_KEY, VERCEL_TOKEN e VERCEL_TEAM_ID. Toda escrita exige --confirmar-banco com a
 * referência do projeto que o script imprime, para nunca escrever no banco errado.
 *
 * Saída: 0 = feito; 1 = recusado ou desfeito (nada ficou ligado); 2 = uso ou trava; 3 = INCERTO (o número
 * pode ter ficado ligado: rodar --desligar e conferir).
 *
 * Nesta fatia, --ligar só roda no ambiente de teste; em produção é recusado (LIGAR_EM_PRODUCAO_LIBERADO).
 */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  criarAgentes,
  desligarConexao,
  ligarComConferencia,
  planejarMigracao,
  type ConexaoIgnorada,
  type GrupoPlanejado,
} from '@/lib/agents/migracaoAgentes';
import { criarClienteVercel, lerPublicacaoNoAr, type AmbientePublicado } from '@/lib/agents/publicacaoVercel';

const ARQUIVOS_DO_PROMPT = ['lib/ai/prompts', 'lib/agents', 'lib/conversations/aiAgentConfig.ts'];
const PROJETO_VERCEL = 'prj_Bxf5A1vWELuIIHh6P1HHMUC42ErV';
const DOMINIOS_DE_PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const DOMINIOS_DE_TESTE = ['teste.crm.basea2.com'];

/**
 * Os dois bancos que têm publicação para conferir. Lista FECHADA: banco → projeto → ramo → todos os domínios
 * que atendem aquele banco. As duas listas juntas têm que ser os domínios do projeto na Vercel: se o projeto
 * ganhar ou perder um domínio, toda leitura da publicação recusa (dominios_do_projeto_divergem) até a lista
 * daqui ser atualizada.
 */
const AMBIENTES: Record<string, AmbientePublicado & { nome: string }> = {
  eqidsihasmwwamkaqfka: {
    nome: 'producao',
    dominios: DOMINIOS_DE_PRODUCAO,
    outrosDominiosDoProjeto: DOMINIOS_DE_TESTE,
    ramo: 'main',
    projectId: PROJETO_VERCEL,
    producao: true,
  },
  zvwngsrflkicbbzfmrgy: {
    nome: 'teste',
    dominios: DOMINIOS_DE_TESTE,
    outrosDominiosDoProjeto: DOMINIOS_DE_PRODUCAO,
    ramo: 'feat/aurora-implantacao',
    projectId: PROJETO_VERCEL,
    producao: false,
  },
};

/**
 * Ligar número em PRODUÇÃO fica para a fatia 2. A trava da publicação só enxerga os domínios do projeto, e o
 * webhook de cada número é registrado na Evolution com a origem de quem clicou em conectar ou no healthcheck
 * (lib/channels/evolutionWebhookRegistration.ts): pode ser um endereço fora da lista, servido por outro
 * código. Antes de virar `true`, o script tem que ler esse endereço na Evolution e exigir um domínio da lista.
 */
const LIGAR_EM_PRODUCAO_LIBERADO = false;

function argumento(nome: string) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(nome);

/** `<ref>.supabase.co` → ref; local → 'local'. Qualquer outro host volta inteiro e não casa com ambiente nenhum. */
function referenciaDoBanco(url: string) {
  const host = new URL(url).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return 'local';
  const projeto = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
  return projeto ? projeto[1] : host;
}

function git(args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function imprimirPlano(plano: { grupos: GrupoPlanejado[]; ignoradas: ConexaoIgnorada[] }) {
  for (const g of plano.grupos) {
    console.log(`AGENTE  org=${g.organizationId} chave=${g.promptKey} origem=${g.promptSource} sha256=${g.sha256.slice(0, 12)} caracteres=${g.conteudo.length} nome=${g.nome} pronto=${g.pronto ? 'sim' : 'nao'}`);
    for (const c of g.conexoes) {
      console.log(`        numero ${c.id} (${c.name}) producao=${c.situacao}${c.respostaEm ? ` evento_entregue=${c.respostaEm}` : ''}`);
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

  const admin = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });

  const desligar = argumento('--desligar');
  if (desligar) {
    const r = await desligarConexao(admin, desligar);
    console.log(r.ok ? `DESLIGADO numero=${desligar}` : `NAO DESLIGOU numero=${desligar} (${r.detalhe})`);
    process.exit(r.ok ? 0 : 1);
  }

  if (!(tem('--prova') || tem('--criar') || tem('--ligar'))) {
    console.error('Use --prova, --criar, --ligar <id> ou --desligar <id>.');
    process.exit(2);
  }

  const ambiente = AMBIENTES[ref];
  if (!ambiente) {
    console.error(`Recusado: o banco ${ref} nao tem publicacao para conferir. --prova, --criar e --ligar so rodam contra ${Object.keys(AMBIENTES).join(' ou ')}.`);
    process.exit(2);
  }
  console.log(`Ambiente: ${ambiente.nome} | ramo ${ambiente.ramo} | dominios ${ambiente.dominios.join(', ')}`);
  if (tem('--ligar') && ambiente.producao && !LIGAR_EM_PRODUCAO_LIBERADO) {
    console.error('Recusado: ligar numero em producao entra na fatia 2 (falta conferir na Evolution o endereco do webhook de cada numero). Nesta fatia, --ligar so roda no ambiente de teste.');
    process.exit(2);
  }

  git(['fetch', 'origin', ambiente.ramo]);
  const publicado = git(['rev-parse', `origin/${ambiente.ramo}`]);
  if (publicado !== commit) {
    console.error(`Recusado: esta copia esta em ${commit.slice(0, 7)} e ${ambiente.ramo} publicado esta em ${publicado.slice(0, 7)}. A prova so vale com o codigo publicado.`);
    process.exit(2);
  }
  if (promptAlterado) {
    console.error(`Recusado: ha mudanca local em arquivo que decide o prompt (${ARQUIVOS_DO_PROMPT.join(', ')}).`);
    process.exit(2);
  }
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) {
    console.error('Faltam VERCEL_TOKEN e VERCEL_TEAM_ID no ambiente (lidos do cofre em processo, nunca impressos).');
    process.exit(2);
  }
  const api = criarClienteVercel({ token, teamId });
  const lerPublicacao = () => lerPublicacaoNoAr(api, ambiente);

  const ligar = argumento('--ligar');
  if (ligar) {
    // Confere a publicação antes, liga pela função do banco, confere de novo e desfaz se não confirmar.
    const r = await ligarComConferencia(admin, ligar, lerPublicacao, commit);
    if (r.estado === 'ligado') {
      console.log(`LIGADO numero=${ligar} agente=${r.agentId} publicacao=${r.publicacao.slice(0, 7)}`);
      return;
    }
    if (r.estado === 'nao_ligou') {
      console.log(`NAO LIGOU numero=${ligar} motivo=${r.motivo}`);
      process.exit(1);
    }
    if (r.estado === 'desfeito') {
      console.error(`DESFEITO numero=${ligar}: ${r.motivo}. A ligacao ao agente ${r.agentId} foi desfeita e a linha conferida.`);
      process.exit(1);
    }
    console.error(`ATENCAO numero=${ligar}: ${r.motivo}, e NAO foi possivel confirmar o desfazer (${r.detalhe}). O numero PODE ESTAR LIGADO ao agente ${r.agentId}. Rode --desligar ${ligar} --confirmar-banco ${ref} e confira antes de qualquer outra coisa.`);
    process.exit(3);
  }

  const p = await lerPublicacao();
  if (!p.ok) {
    console.error(`Recusado: a publicacao do ambiente ${ambiente.nome} nao esta parada no ramo ${ambiente.ramo} (${p.motivo}: ${p.detalhe}).`);
    process.exit(2);
  }
  if (p.commit !== commit) {
    console.error(`Recusado: os dominios servem ${p.commit.slice(0, 7)} (${p.deploymentId}) e esta copia esta em ${commit.slice(0, 7)}.`);
    process.exit(2);
  }
  console.log(`Publicacao: ${ambiente.dominios.join(', ')} servem ${p.commit.slice(0, 7)} (${p.deploymentId})`);

  const organizationId = argumento('--org');
  const incluir = (argumento('--incluir') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (tem('--criar')) {
    if (!organizationId) {
      console.error('--criar exige --org <uuid>: um cliente por vez.');
      process.exit(2);
    }
    const plano = await planejarMigracao(admin, { organizationId, incluir, publicacao: p.commit });
    imprimirPlano(plano);
    const r = await criarAgentes(admin, { organizationId, grupos: plano.grupos, catalogCommit: commit });
    for (const c of r.criados) console.log(`${c.criado ? 'CRIADO' : 'JA EXISTIA'} agente=${c.agentId} org=${c.organizationId}`);
    for (const pulado of r.pulados) console.log(`PULADO sha256=${pulado.sha256.slice(0, 12)} numeros=${pulado.conexoes.join(',')}`);
    return;
  }

  imprimirPlano(await planejarMigracao(admin, { organizationId, incluir, publicacao: p.commit }));
}

main().catch((erro) => {
  // Só chega aqui erro ANTES de qualquer ligação (ligarComConferencia trata tudo o que acontece depois dela).
  console.error(erro instanceof Error ? erro.message : String(erro));
  process.exit(1);
});
```

- [ ] **Step 2: Conferir que compila e que as travas funcionam sem tocar banco de cliente nem Vercel**

Run: `npm run typecheck`
Expected: sem erros (`tsconfig.json` inclui `**/*.ts`, então `scripts/` é conferido).

Run (sem credenciais no ambiente): `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova`
Expected: "Faltam NEXT_PUBLIC_SUPABASE_URL..." e saída 2.

Com as credenciais do Supabase **local** no ambiente:
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --prova` → "Recusado: o banco local nao tem publicacao para conferir" e saída 2, sem `git fetch` e sem chamada à Vercel.
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --criar --org <uuid> --confirmar-banco outro` → "Escrita recusada: passe --confirmar-banco local" e saída 2.
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --desligar 00000000-0000-4000-8000-000000000000 --confirmar-banco local` → "NAO DESLIGOU ... (conexao_inexistente)" e saída 1.

A recusa de ligar em produção, **sem tocar a produção**: com `NEXT_PUBLIC_SUPABASE_URL=https://eqidsihasmwwamkaqfka.supabase.co`, `SUPABASE_SECRET_KEY=x` (uma chave que não vale) e **sem** `VERCEL_TOKEN` no ambiente:
- `npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --ligar 00000000-0000-4000-8000-000000000000 --confirmar-banco eqidsihasmwwamkaqfka` → "Ambiente: producao ..." e "Recusado: ligar numero em producao entra na fatia 2", saída 2.

Nenhum pedido sai da máquina nesse comando: a recusa vem antes do `git fetch`, da Vercel e de qualquer leitura do banco. Se a mensagem não aparecer, o script para logo adiante em "Faltam VERCEL_TOKEN e VERCEL_TEAM_ID", também sem tocar o banco; aí o defeito é a ordem da recusa, e se corrige antes de seguir.

As travas do git e da Vercel só são exercitadas contra o banco de teste, na Task 13 (o script recusa qualquer outro banco antes de chegar nelas); a lógica delas está coberta pelos testes de `publicacaoVercel` e de `ligarComConferencia` (Task 10).

- [ ] **Step 3: Commit**

```bash
git add scripts/central-agentes/migrar-agentes.ts
git diff --cached --stat
git commit -m "feat(central-agentes): script de migracao com ambiente pelo banco, trava da versao publicada e da publicacao no ar, e ligacao so no teste"
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
Expected: PASS (16 testes).

- [ ] **Step 3: Atualizar a SPEC e o cérebro** com o que a implementação mostrou (apenas se algo mudou) e commitar.

---

### Task 13: Publicação (cada passo com o OK do Junior)

**O ensaio usa a branch que já é o ambiente de teste, `feat/aurora-implantacao`. Nenhuma branch nova vai para o GitHub** (3ª rodada do Codex, achado 1). Fatos lidos na API da Vercel e do Supabase em 05/10 (só leitura):
- as cinco variáveis de banco genéricas do projeto valem para **Preview e Production ao mesmo tempo** (alvo `[preview, production]`, sem branch). Só `feat/aurora-implantacao` e `feat/funil-construtor` têm variáveis de Preview próprias;
- o projeto não tem Ignored Build Step (`commandForIgnoringBuildStep` nulo) nem `vercel.json`, e a documentação da Vercel não lista `[vercel skip]` na mensagem do commit como jeito de pular build (os mecanismos documentados são o Ignored Build Step e `git.deploymentEnabled`). O plano anterior dependia disso para o primeiro push de uma branch nova;
- as prévias são públicas (`ssoProtection` nulo).

Logo, uma branch nova viraria uma prévia pública com as credenciais de produção. A branch de ensaio já tem as variáveis do banco de teste, está no mesmo commit do `main` (`335f32b`, então o push é fast-forward) e é a prévia que `teste.crm.basea2.com` serve. É também a branch que o rito (`06-References/basecrm-rito-publicacao/LEIA-ME.md`) e o `poll_deploys.py` já esperam, então os dois servem **como estão**. A diferença para o rito: aqui o push para a branch de ensaio vem **antes** (é o ensaio) e o push de produção é só `HEAD:main`.

O evento de prova precisa do commit da publicação em tempo de execução (`VERCEL_GIT_COMMIT_SHA`). A Vercel só o expõe com "Enable access to System Environment Variables" marcado; em 05/10 a API do projeto devolveu `autoExposeSystemEnvs: true`. Se um dia vier desligado, o evento sai com `release_commit` nulo, a prova dá `PUBLICACAO_DIVERGE` em todo número e nada liga (falha fechada).

- [ ] **Step 0: Ler o ambiente antes de qualquer push ou escrita (só leitura)**

  Run: `python 06-References/basecrm-rito-publicacao/ler_config_publicacao.py` (no cérebro; lê o cofre em processo e nunca imprime token nem valor de variável).

  Só seguir se **tudo** abaixo for verdade; qualquer diferença para aqui e volta para o Junior:
  1. `autoExposeSystemEnvs = True`; `rollingRelease = null` no projeto e `{"rollingRelease": null}` nas duas leituras de rollout;
  2. existe o grupo de variáveis `alvo=[preview] branch='feat/aurora-implantacao'` com as cinco chaves de banco (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`);
  3. os domínios do projeto que servem conteúdo são exatamente os quatro da lista fechada do script (`dominios que servem conteudo == lista fechada: True`), e a lista por ramo só traz deployments do ramo pedido (`todos do ramo pedido: True`);
  4. `teste.crm.basea2.com` aponta para um deployment com `ref feat/aurora-implantacao` e `target None` (prévia), e os três domínios de produção (`crm.basea2.com`, `crm.cennohub.com.br`, `basecrm.vercel.app`) apontam para o mesmo deployment de produção, `PROMOTED`;
  5. `git fetch origin`, depois `git merge-base --is-ancestor origin/feat/aurora-implantacao HEAD` e `git merge-base --is-ancestor origin/main HEAD` (os dois pushes serão fast-forward).

- [ ] **Step 1: Banco de teste (`zvwngsrflkicbbzfmrgy`) e prévia na branch de ensaio**
  1. Aplicar a migration no banco de teste pelo MCP do Supabase (`apply_migration`) e corrigir a `version` em `supabase_migrations.schema_migrations` para `20260930000000`.
  2. `git push origin HEAD:feat/aurora-implantacao` (OK dele). **Nunca** `git push origin HEAD:feat/central-agentes` nem qualquer nome novo.
  3. Esperar a prévia READY pela API da Vercel: `GET /v7/deployments?projectId=<projeto>&branch=feat/aurora-implantacao`, o item com o sha do HEAD, com o token lido do cofre em processo. Nesse momento `teste.crm.basea2.com` ainda aponta para a prévia antiga.
  4. Provar pelo pedido real de login que a prévia **nova** usa `zvwngsrflkicbbzfmrgy`: o `prova_login.py` com a URL do deployment novo (ele ganha o domínio como argumento opcional; sem argumento, continua provando os três de hoje). Só então apontar `teste.crm.basea2.com` para ela (`POST /v2/deployments/{id}/aliases`).
  5. Provocar uma mensagem de teste no número do ensaio e conferir, com o `sqlteste.py`:
     - a resposta gravou `prompt_sha256`, com `prompt_source` igual ao de antes e sem `agent_id`;
     - `ai_reply_events` ganhou UMA linha para a resposta, com `agent_id` nulo, `prompt_key` igual à chave efetiva do número, `delivered_at` depois do `sent_at` da mensagem e `release_commit` **igual ao sha do deployment da prévia**.
  6. `--prova --org <organização do ensaio>`, com as credenciais do banco de teste e da Vercel no ambiente, lidas do cofre em processo e nunca impressas. O script tem que imprimir `Ambiente: teste | ramo feat/aurora-implantacao | dominios teste.crm.basea2.com` e `Publicacao: ... servem <sha da prévia>`, e o número tem que sair `CONFERE`.
  7. `--criar --org <organização do ensaio> --confirmar-banco zvwngsrflkicbbzfmrgy`.
  8. `--ligar <conexão do ensaio> --confirmar-banco zvwngsrflkicbbzfmrgy` → `LIGADO`.
  9. Provocar outra mensagem e conferir: `prompt_source = 'agent'`, `agent_version = 1`, o **mesmo** `prompt_sha256` da resposta do item 5, e um evento novo com `agent_id` preenchido e `prompt_key` nulo.
  10. `--desligar <conexão do ensaio> --confirmar-banco zvwngsrflkicbbzfmrgy` e conferir que a próxima resposta volta sem `agent_id`, com o mesmo sha, e que o `--prova` volta a `CONFERE` para o número (o evento do agente não entra na prova).
  11. **Trava da publicação, ao vivo.** Com o número desligado, um commit vazio (`git commit --allow-empty -m "chore(central-agentes): ensaio da trava de publicacao"`) e `git push origin HEAD:feat/aurora-implantacao`:
      - enquanto a prévia nova constrói, `--ligar` tem que responder `NAO LIGOU ... publicacao em_transicao`;
      - com ela READY e o alias ainda na antiga, `NAO LIGOU ... publicacao mais_novo_nao_servido`;
      - depois de reapontar o alias (itens 3 e 4 de novo), o `--prova` tem que dar `PUBLICACAO_DIVERGE` (o evento veio do commit anterior) e voltar a `CONFERE` só depois de uma resposta real nova.

      O commit vazio fica no histórico e vai para o `main` na publicação; é a prova de que a trava enxerga uma troca de publicação de verdade.
  12. A falha **na chamada de ligar** ou **depois** de ligar (erro de rede, resposta perdida) não dá para provocar no ensaio sem injetar erro. Ela é coberta pelos nove testes de `ligarComConferencia` (Task 10): desfaz, confere a linha, e devolve `incerto` (saída 3) quando não consegue confirmar.
- [ ] **Step 2: Produção — migration ANTES do deploy**
  1. Leitura, com o OK dele: quais números têm `config.webhookUrl` (automação n8n), e se os fluxos deles mandam no metadata do `/ai-reply` alguma das seis chaves de rastro, que passam a ser descartadas (revisão do Codex, achado 9).
  2. **G23: backup nosso e restauração testada, antes da escrita** (revisão do Codex, achado 20; 3ª rodada, achado 8). O gate pede backup **e** restauração testada. Lido em 05/10 na API de gerenciamento: a organização do Supabase está no plano **Free** (`plan: free`), a lista de backups do projeto de produção vem vazia e `pitr_enabled` é falso. A documentação do Supabase confirma que projeto Free não tem backup automático e recomenda `supabase db dump`. Então não existe backup da plataforma para conferir; o backup é o que tirarmos:
     1. **Dump** de produção com a CLI, numa pasta fora do Git e fora da pasta sincronizada (o arquivo de dados tem dado pessoal de lead). A URL é a do pooler em modo sessão, montada em processo com a senha do banco lida do cofre. Se a senha não estiver no cofre, **parar**: redefinir a senha derruba quem conecta direto no Postgres, e isso é decisão do Junior.
        - `npx supabase db dump --db-url "<url>" -f roles.sql --role-only`
        - `npx supabase db dump --db-url "<url>" -f schema.sql`
        - `npx supabase db dump --db-url "<url>" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"`
     2. **Restauração em alvo isolado**: uma stack local temporária, vazia, só para isso (as portas são as mesmas da `crmia`, então ela para durante o ensaio):
        - `npx supabase stop` no repositório; numa pasta temporária `ensaio-g23`: `npx supabase init`; antes do `start`, deixar `[db] major_version` do `supabase/config.toml` dela igual à versão do Postgres de produção (`select version()` pelo `sqlprod.py`, só leitura; o local do repositório usa 15); depois `npx supabase start`;
        - copiar os três arquivos para o container do banco temporário (`docker cp`) e restaurar com o comando da documentação: `psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname <url local>`;
        - comparar a contagem de linhas, produção (`sqlprod.py`, só leitura) × restaurado, em `organizations`, `profiles`, `contacts`, `deals`, `channel_connections`, `conversation_threads`, `conversation_messages` e `ai_prompt_templates`. Tem que bater.
     3. **A migration na cópia restaurada**: aplicar `20260930000000_central_agentes_fundacao.sql` nela e, em seguida, o `volta-fatia-1.sql`. Os dois têm que terminar sem erro sobre o esquema e os dados reais (a volta no banco local, Task 2, só provou sobre o esquema das migrations).
     4. Registrar no cérebro a evidência, sem dado pessoal: data, tamanho dos três arquivos, as contagens e o resultado dos dois scripts. Derrubar a stack temporária (`npx supabase stop --no-backup` na pasta dela) e religar a `crmia`.
     5. O dump fica guardado até a fatia estar validada em produção; depois o Junior decide se apaga ou mantém como primeiro backup externo.

     Enquanto isso não estiver feito e registrado, o G23 é **PENDENTE** e a migration não vai para produção. Se a restauração falhar na primeira tentativa, o defeito é do procedimento e se corrige nele; não se pula a etapa.
  3. Aplicar a migration no banco de produção (`eqidsihasmwwamkaqfka`) e corrigir a `version`, como no teste.
  4. Conferir que a coluna e a tabela existem (`select ai_agent_id from public.channel_connections limit 1` e `select count(*) from public.ai_reply_events`, sem erro).
  5. Só então: `git fetch origin`, `git merge-base --is-ancestor origin/main HEAD` e `git push origin HEAD:main`. A branch de ensaio já está neste commit; nenhuma outra branch é empurrada.
  6. Esperar produção READY e **devolver `teste.crm.basea2.com` para a prévia**, porque toda publicação de produção leva esse domínio junto: `python poll_deploys.py <sha-curto>`, como está (a prévia desse sha na branch de ensaio já existe). Provar os dois bancos pelo `prova_login.py`.
- [ ] **Step 3: Produção adormecida**
  - a próxima resposta real da Aurora sai como antes (`prompt_source = 'default'`, sem `agent_id`), agora com `prompt_sha256` e com um evento em `ai_reply_events` cujo `release_commit` é o sha do deploy de produção (conferir com o `sqlprod.py`, só leitura);
  - depois de uma resposta real de cada uma, `--prova` com as credenciais de produção, só leitura, com o relatório guardado no cérebro. O script tem que imprimir `Ambiente: producao | ramo main | dominios crm.basea2.com, crm.cennohub.com.br, basecrm.vercel.app`, e Aurora e Julia têm que sair `CONFERE`;
  - operação (revisão do Codex, ponto 2): num número com agente, uma falha do agente (`agent_unavailable`) cai na automação n8n do cliente, se houver, como qualquer falha da IA nativa.
- [ ] **Step 4:** Ligar Aurora e Julia em produção **não** faz parte desta fatia, e o script recusa por código (`LIGAR_EM_PRODUCAO_LIBERADO = false`, Task 11). Fica para a entrega da fatia 2, junto do editor, do 409 no PATCH de `aiPromptKey`, da trava do catálogo, do aviso na Central de I.A e da leitura, na Evolution, do endereço em que o webhook de cada número está registrado (tem que ser um domínio da lista fechada; quem grava esse endereço é a origem de quem clica em conectar ou no healthcheck). O `--prova` de produção do Step 3 é só leitura e não autoriza ligação. Enquanto a fatia 2 não entra, **não publicar override pela Central de I.A nem mexer no catálogo das duas chaves no mesmo horário em que um `--ligar` roda**: a função trava a tabela de prompts durante a ligação (milissegundos), mas o congelamento operacional evita a surpresa de um `override_mudou` no meio da entrega. Pelo mesmo motivo, não rodar conectar nem healthcheck de um número real por um endereço fora da lista fechada (uma prévia, ou o endereço automático da Vercel): isso muda o endereço do webhook dele na Evolution.

**Se precisar voltar depois do deploy de produção:** primeiro o código (promover o deployment de produção anterior na Vercel). O código antigo não lê a coluna nem as tabelas novas, então o banco pode ficar como está. O `volta-fatia-1.sql` só roda depois disso, com o OK dele, e apaga os eventos de prova junto.
