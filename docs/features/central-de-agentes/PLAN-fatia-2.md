# Central de Agentes, fatia 2 — editor com versões e Publicar: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status:** v2, 07/10/2026 (sessão `a723714c`). Escrito depois da fatia 1 em produção (`main` = `6a29238`). A v2 traz a rodada 1 do Codex aplicada; ela foi parcial, porque o Codex bateu no limite de uso no meio. Os achados e as decisões estão na seção 6 da autorrevisão, no fim do arquivo. Falta o parecer consolidado dele. Produção só com o OK do Junior, dado para esta fatia (o OK da fatia 1 não vale aqui).

**Goal:** a agência abre a Central de Agentes de um cliente, entra num agente, lê o prompt formatado, edita, vê a verificação ao vivo, publica uma versão nova (as respostas que começarem depois da publicação já a usam), compara versões e restaura uma anterior com um clique; e Aurora (e depois a Julia) passam a ser ligadas em produção.

**Architecture:** três funções SQL novas (`save_ai_agent_draft`, `publish_ai_agent_version`, `restore_ai_agent_version`), `security definer` com `search_path=''`, chamadas pelas rotas **com o JWT do usuário**: o papel é conferido por dentro e o autor vem de `auth.uid()`. Cada uma trava a linha do agente e só escreve se a revisão do rascunho (e a versão publicada) forem as que a tela mostrou; diferença vira 409. A verificação ao vivo é uma função pura em `lib/agents/`, usada pela tela enquanto se edita e recalculada pela rota de publicar sobre o rascunho **gravado**. As telas ficam em `/platform/tenants/[tenantId]/agents` e `/agents/[agentId]`, no mesmo padrão das telas do cliente que já existem. A ligação em produção continua pelo script da fatia 1, que passa a ler na Evolution o endereço do webhook de cada número antes de ligar.

**Tech Stack:** Next.js (App Router) + React + TypeScript, Supabase (Postgres 17, PostgREST, RLS), zod, Vitest (+ Testing Library), Supabase local (`npx supabase start`) para os testes `*.local.test.ts`, Evolution API (só leitura de `GET /webhook/find/{instancia}` no script).

---

## Antes de começar: o que a fatia 1 deixou e o que esta fatia muda

**Já existe (fatia 1, em produção desde 07/10 01h51):**
- tabelas `ai_agents` (com `draft jsonb`, `draft_revision`, `draft_updated_at`, `draft_updated_by`, `published_version_id`) e `ai_agent_versions` (imutável por gatilho, `source in ('migration','publish','restore')`, `restored_from`, `note` ≤ 200, `published_by`, `published_at`), com leitura só para `is_agency_admin_role()` (agency_admin e o legado admin) e **nenhum** caminho de escrita para `authenticated`;
- `channel_connections.ai_agent_id` (FK composta, `no action`) e o gatilho que recusa ligar a agente sem versão publicada;
- o runtime: número com agente usa `version.prompt` da versão publicada (`lib/agents/agentRuntime.ts`), grava `prompt_source = 'agent'`, `agent_id`, `agent_version` e `prompt_sha256` no metadata e um evento em `ai_reply_events` depois da entrega;
- o script `scripts/central-agentes/migrar-agentes.ts` (`--prova`, `--criar`, `--ligar`, `--desligar`) com `LIGAR_EM_PRODUCAO_LIBERADO = false`.

**Não existe ainda, e esta fatia cria:** a função de publicar (a SPEC a previa; a migration da fatia 1 não a criou), o salvar rascunho, o restaurar, as rotas de API, as telas, a verificação ao vivo, o aviso na Central de I.A, o 409 no PATCH da conexão, a trava do catálogo e a leitura do webhook na Evolution.

**Estado medido em 07/10 (só leitura), que muda a ordem da ligação em produção:**

| Número | Conexão | Webhook na Evolution | Agente |
|---|---|---|---|
| Aurora, Cenno Hub, `20532687-e868-48c4-977b-f6f7cac72131`, instância `whatsapp-ia-bba4d621` | `open` | ligado, `https://crm.basea2.com/api/public/channels/evolution/2053…/webhook` | nenhum em produção (no banco de teste há a Aurora `6dabf010…` com a v1) |
| Julia, Dra. Jéssica, `9529670e-fc99-431d-944a-8f7140b7178c`, instância `whatsapp-ia-4abae75a` | `open` | **desligado** por decisão do Junior em 15/09, apontando para uma prévia | nenhum |

Consequência: a **Aurora** pode ser ligada em produção depois do deploy desta fatia e de uma resposta real nova; a **Julia** só depois de o Junior decidir religar o webhook dela, num domínio da lista fechada, e de uma resposta real dela. O script recusa ligar a Julia enquanto o webhook estiver desligado ou fora da lista (Task 12), e isso é o comportamento esperado, não um defeito.

**Prompt da Aurora em produção:** sha `e7b24641f3222182ea90e0b57ec01913715bf4badc657aeebf8f419173b02161` (20.202 caracteres, publicado em `6a29238`, com a lista de serviços aprovada). A Julia (`task_conversations_whatsapp_auto_reply`): sha `b4287844d2ad…`, 2.569 caracteres.

## O que esta fatia NÃO faz (fica para as próximas)

- Criar agente pela tela, apagar agente, renomear o cadastro: não estão na SPEC da fatia 2 (agente novo vem da biblioteca, fase 2). A lista mostra os agentes que existem.
- Ligar ou desligar número pela tela: continua pelo script (`--ligar`/`--desligar`), com as travas da fatia 1 e a leitura da Evolution desta fatia.
- Testar sem enviar: fatia 3. O botão aparece desabilitado com "Chega na próxima entrega".
- Ajustes de comportamento, modelo e custo, conhecimento, números: fatias 4, 5 e 6, e fases 2 e 3. As seções aparecem na lateral, desabilitadas, com a mesma frase.
- Editar `settings` e `model` da versão: a versão nova copia os da publicada (hoje `{}` e nulo). O `publish` não recebe esses campos; a fatia 4 abre os ajustes com a lista fechada de chaves.

**SPEC:** `docs/features/central-de-agentes/SPEC.md` (espelho no cérebro: `06-References/central-de-agentes-2026-09-29/SPEC-fase-1.md`), seções "Decisões de desenho", "Fatia 2", "Critérios de aceite" e "Portões de segurança". Mockup aprovado em 29/09: `06-References/central-de-agentes-2026-09-29/central-de-agentes.html`, seção "A Central de Agentes". Os scripts do rito de publicação vivem no cérebro, em `06-References/basecrm-rito-publicacao/` (Tasks 14 e 15).

**Regras do projeto que valem aqui:**
- Nunca rodar teste, migration ou script contra o banco de produção sem o OK do Junior **para esta fatia**.
- Nunca dar push na `main` nem deploy de produção sem o OK dele.
- **Nunca empurrar `feat/central-agentes` para o GitHub.** Uma prévia dela nasceria com as variáveis genéricas, que apontam para a produção. O ensaio vai por `feat/aurora-implantacao` (Task 15, Parte A).
- Ler o resultado da suíte num comando **separado** antes de cada commit, e conferir o `git diff --cached --stat` (fim de linha no Windows; `core.autocrlf` tem que ser `false`).
- Segredo nunca impresso nem commitado; `.secrets` e `.env*` só lidos em processo.
- Nada de ramo por cliente (`if (cliente === X)`): toda capacidade é campo que todo cliente ganha. Texto de tela sem "clínica" (`test/vocabularioCliente.test.ts`).
- Comandos em Git Bash com caminho que tem espaço: entre aspas; para `docker exec` com caminho POSIX nos argumentos, `MSYS_NO_PATHCONV=1`.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20261007120000_central_agentes_editor.sql` | criar (Task 1) | As três funções de escrita (`save_ai_agent_draft`, `publish_ai_agent_version`, `restore_ai_agent_version`), `security definer`, só `authenticated`, e a auxiliar `central_agentes_variavel_desconhecida` (sem `execute` para ninguém) |
| `docs/features/central-de-agentes/volta-fatia-2.sql` | criar (Task 1) | Volta da migration (derruba as quatro funções e a linha do histórico) |
| `test/centralAgentesEditorMigration.test.ts` | criar (Task 1) | Teste estático do cabeçalho, das travas, dos grants e da volta |
| `test/centralAgentesEditor.local.test.ts` | criar (Tasks 2 e 4) | Comportamento com chamada de verdade, matriz G2, corrida observada, camada de servidor |
| `lib/agents/verificarPrompt.ts` | criar (Task 3) | Verificação ao vivo (função pura; tela e servidor) |
| `lib/agents/leituraDoPrompt.ts` | criar (Task 3) | Divide o prompt em seções e marca as variáveis |
| `lib/agents/tiposDoEditor.ts` | criar (Task 4) | Formas que as rotas devolvem e a tela lê |
| `lib/agents/editorAgentes.ts` | criar (Task 4) | Ler pela RLS, salvar, publicar com verificação, restaurar, traduzir erros |
| `lib/agents/rotaDoEditor.ts` | criar (Task 5) | Porta comum das rotas (origem, ids, `adminOnly`, clientes) e os esquemas `.strict()` |
| `app/api/platform/tenants/[tenantId]/agents/**/route.ts` (7 rotas) | criar (Task 5) | Lista, agente, rascunho, publicar, restaurar, versões, versão |
| `lib/platform/tenantAccess.adminOnly.test.ts` | criar (Task 5) | Trava o 403 do `adminOnly` para o admin do cliente, a equipe do cliente e a equipe da agência (nenhum teste do repositório cobria) |
| `features/agents/formatos.ts`, `agentesApi.ts`, `TenantAgentsPage.tsx` | criar (Task 6) | Datas em Brasília, cliente da API, tela da lista |
| `app/(protected)/platform/tenants/[tenantId]/agents/page.tsx` | criar (Task 6) | Rota de tela da lista |
| `components/navigation/rotaAtiva.ts` | criar (Task 6) | Item "Agentes" aceso na tela de detalhe |
| `components/navigation/navConfig.ts`, `usePlatformTenantWorkspaceNav.ts`, `components/Layout.tsx`, `components/navigation/NavigationRail.tsx` | modificar (Task 6) | Item "Agentes" só para a agência |
| `lib/tenancy/workspaceRoutes.ts` (+ teste) | modificar (Tasks 6 e 8) | `/agents` na lista do cliente; `LISTAS_COM_DETALHE` (uma lista só, usada pelo menu e pela troca de cliente); trocar de cliente no editor cai na lista |
| `lib/agents/compararVersoes.ts`, `features/agents/HistoricoDeVersoes.tsx` | criar (Task 7) | Comparação linha a linha e campo a campo; histórico e Restaurar |
| `features/agents/AgentEditorPage.tsx`, `LeituraDoPrompt.tsx`, `PainelDaVerificacao.tsx`, `DialogoPublicar.tsx` | criar (Task 8) | O editor |
| `app/(protected)/platform/tenants/[tenantId]/agents/[agentId]/page.tsx` | criar (Task 8) | Rota de tela do editor |
| `lib/agents/numerosDaChave.ts`, `app/api/settings/ai-prompts/[key]/route.ts`, `features/settings/components/AIFeaturesSection.tsx` | criar e modificar (Task 9) | Aviso na Central de I.A, contado no servidor |
| `lib/agents/migracaoAgentes.ts` | modificar (Task 9) | Só exportar `lerConexoes` (leitura paginada da fatia 1), reusada na contagem |
| `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts` (+ `route.patch.test.ts`) | modificar (Task 10) | 409 para `aiPromptKey` em número ligado, antes de qualquer gravação e com a gravação condicionada |
| `lib/ai/prompts/migrated-prompts.lock.json`, `lib/ai/prompts/catalog.ts` (comentários) | criar e modificar (Task 11) | Trava das chaves migradas |
| `lib/agents/webhookDoNumero.ts`, `lib/agents/modoDaMigracao.ts`, `lib/agents/publicacaoVercel.ts`, `scripts/central-agentes/migrar-agentes.ts` | criar e modificar (Task 12) | Leitura do webhook na Evolution, `--webhook`, modo único com id obrigatório, `--somente` no `--criar`, produção liberada |
| Cérebro: `dump_producao.ps1`, `prova_dump_local.ps1`, `conferir_pos_dump.ps1`, `sqlprod.py`, `sqlteste.py`, `rota_b_senha.ps1`, `g23-restauracao/*` | modificar e criar (Task 14) | Backup com os quatro requisitos; contagem que para no erro; senha sempre na pasta do dump |
| Cérebro: `poll_deploys.py`, `alias_teste.py`, `rodar_migrar_prod.py`, `ligacoes-aprovadas.json`, `migracoes-aprovadas.json` | modificar e criar (Task 15) | Ensaio só na prévia; alias que falha com erro e é relido; escrita em produção só com OK registrado e commitado |

---

## Tasks

### Task 0: Linha de base, antes de mudar qualquer coisa

**Files:** nenhum.

- [ ] **Step 1: Conferir a cópia**

Run (no worktree `Basecrm-worktrees/central-agentes`):
```bash
git fetch origin
git status -sb
git rev-parse --short HEAD origin/main origin/feat/aurora-implantacao
git config core.autocrlf
```
Expected: `## feat/central-agentes` sem nada pendente; os três shas iguais (`6a29238` em 07/10, ou o que a `main` tiver se algo entrou depois: nesse caso, `git merge --ff-only origin/main` antes de seguir); `core.autocrlf` = `false` (se vier `true`, parar: um checkout reescreveria a árvore em CRLF e quebraria os testes de texto; ver PROJECT LEARNINGS).

- [ ] **Step 2: Suíte e tipos verdes antes**

Run: `npx vitest run` e, em outro comando, `npx tsc --noEmit`.
Expected: a suíte com 0 falhas (2.227 testes em 07/10 02h08) e o `tsc` sem erro. Anotar o número de testes: ele é a referência do "nada quebrou" no fim.

- [ ] **Step 3: Supabase local com a fatia 1**

Run: `npx supabase status` e depois:
```bash
docker exec -i supabase_db_crmia psql -U postgres -d postgres -At -c "select to_regclass('public.ai_agents') is not null, (select max(version) from supabase_migrations.schema_migrations)"
```
Expected: `t|20260930000000` (ou uma versão maior que já esteja na `main`). Se der `f`, rodar `npx supabase db reset` (apaga só o banco local) e repetir.

---

### Task 1: Migration do editor (salvar rascunho, publicar, restaurar), teste estático e volta

**Files:**
- Create: `supabase/migrations/20261007120000_central_agentes_editor.sql`
- Create: `docs/features/central-de-agentes/volta-fatia-2.sql`
- Test: `test/centralAgentesEditorMigration.test.ts`

Decisões que o código abaixo fixa (SPEC, "Decisões de desenho", linhas Rascunho e Publicar/Restaurar):
- as três funções são `security definer` com `search_path=''`, conferem `public.is_agency_admin_role()` **antes de ler qualquer coisa** e tiram o autor de `auth.uid()`; nenhuma recebe autor por parâmetro;
- `execute` só para `authenticated` (as rotas chamam com o JWT do usuário); `public`, `anon` e `service_role` revogados. `service_role` não precisa: com ele `auth.uid()` é nulo e a função recusaria;
- cada uma trava a linha do agente **da organização informada** (`for update`) e confere a `draft_revision` que a tela leu; publicar e restaurar conferem também a versão publicada esperada. Diferença levanta erro com nome, e a rota devolve 409;
- o rascunho desta fatia guarda só `{"prompt": ...}`; a versão nova copia `settings` e `model` da publicada (hoje `{}` e nulo). A fatia 4 abre os ajustes com a lista fechada de chaves;
- restaurar publica o conteúdo da versão escolhida como versão nova (`source = 'restore'`, `restored_from`) e **passa esse texto para o rascunho** (revisão + 1): senão a tela mostraria "Rascunho com mudanças" com o texto que acabou de sair, e um Publicar desfaria a restauração. Por isso restaurar também confere a revisão: o rascunho descartado é o que a tela mostrou. Restaurar um conteúdo igual ao publicado (prompt, settings e model) é recusado com `sem_mudancas`, para o histórico não ganhar versões repetidas.
- publicar e restaurar recusam texto com marcador `{{...}}` fora das 12 variáveis (`variavel_desconhecida`, P0001, com o nome no `detail`). A regra mora numa função auxiliar, `central_agentes_variavel_desconhecida(text)`, sem `execute` para ninguém, e vale também para quem chamar a função direto, sem passar pela rota. Revisão do Codex, 07/10: com a verificação só na rota, um `agency_admin` publicaria pelo próprio JWT o que a tela bloqueia. Os **avisos** continuam só na rota, porque são confirmáveis por definição e a versão guarda o autor. A lista das 12 no SQL é travada igual à da tela pelo teste da Task 3.
- Os erros têm nome estável na **mensagem**, e a rota traduz pela mensagem: `sem_permissao` (42501), `agente_inexistente` e `versao_inexistente` (P0002), `rascunho_mudou`, `versao_publicada_mudou`, `rascunho_vazio`, `sem_mudancas`, `versao_ja_publicada`, `variavel_desconhecida` (P0001), `prompt_invalido` e `nota_invalida` (22023).

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/centralAgentesEditorMigration.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Central de Agentes, fatia 2 (SPEC docs/features/central-de-agentes/SPEC.md, "Fatia 2"). As provas leem o
 * CABEÇALHO e o CORPO $$...$$ de cada função; o teste local (centralAgentesEditor.local.test.ts) prova o
 * comportamento com chamada de verdade.
 */
const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20261007120000_central_agentes_editor.sql');
const VOLTA = resolve(process.cwd(), 'docs/features/central-de-agentes/volta-fatia-2.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

const FUNCOES = {
  save_ai_agent_draft: '(uuid, uuid, integer, text)',
  publish_ai_agent_version: '(uuid, uuid, integer, integer, text)',
  restore_ai_agent_version: '(uuid, uuid, integer, integer, integer, text)',
} as const;
type NomeDaFuncao = keyof typeof FUNCOES;
const NOMES = Object.keys(FUNCOES) as NomeDaFuncao[];

function cabecalho(nome: NomeDaFuncao): string {
  return semComentarios.match(new RegExp(`create or replace function public\\.${nome}\\(([\\s\\S]*?)as \\$\\$`))?.[1] ?? '';
}
function corpo(nome: NomeDaFuncao): string {
  return semComentarios.match(new RegExp(`create or replace function public\\.${nome}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1] ?? '';
}

describe('migration do editor da Central de Agentes (fatia 2)', () => {
  it('existe, e a volta também', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(existsSync(VOLTA)).toBe(true);
  });

  it('o detector acha as três funções (caso positivo)', () => {
    for (const nome of NOMES) expect(corpo(nome).length, nome).toBeGreaterThan(200);
  });

  it('cabeçalho de segurança: security definer e search_path vazio nas três', () => {
    for (const nome of NOMES) {
      expect(cabecalho(nome), nome).toMatch(/security definer/);
      expect(cabecalho(nome), nome).toMatch(/set search_path = ''/);
    }
  });

  it('o papel é conferido por dentro ANTES de qualquer leitura, e o autor vem de auth.uid(), nunca de parâmetro', () => {
    for (const nome of NOMES) {
      const b = corpo(nome);
      const papel = b.indexOf('if not public.is_agency_admin_role() then');
      const leitura = b.indexOf('from public.ai_agents');
      expect(papel, nome).toBeGreaterThan(-1);
      expect(leitura, nome).toBeGreaterThan(papel);
      expect(b, nome).toContain("raise exception 'sem_permissao' using errcode = '42501'");
      expect(b, nome).toMatch(/auth\.uid\(\)/);
      expect(cabecalho(nome), nome).not.toMatch(/p_(published_by|author|autor|user|usuario)/);
    }
  });

  it('as três travam a linha do agente DA ORGANIZAÇÃO informada e conferem a revisão do rascunho', () => {
    for (const nome of NOMES) {
      const b = corpo(nome);
      expect(b, nome).toMatch(/where a\.id = p_agent_id\s+and a\.organization_id = p_organization_id\s+for update;/);
      expect(b, nome).toContain("raise exception 'agente_inexistente' using errcode = 'P0002'");
      expect(b, nome).toContain("raise exception 'rascunho_mudou' using errcode = 'P0001'");
    }
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      expect(corpo(nome), nome).toContain("raise exception 'versao_publicada_mudou' using errcode = 'P0001'");
    }
  });

  it('publicar e restaurar criam versão nova e movem o ponteiro; ninguém altera versão existente', () => {
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      expect(corpo(nome), nome).toMatch(/insert into public\.ai_agent_versions/);
      expect(corpo(nome), nome).toMatch(/set published_version_id = v_nova_id/);
    }
    expect(corpo('publish_ai_agent_version')).toContain("'publish'");
    expect(corpo('restore_ai_agent_version')).toContain("'restore'");
    expect(corpo('restore_ai_agent_version')).toMatch(/restored_from/);
    for (const nome of NOMES) expect(corpo(nome), nome).not.toMatch(/update public\.ai_agent_versions/);
  });

  it('restaurar traz o texto restaurado para o rascunho e sobe a revisão', () => {
    const b = corpo('restore_ai_agent_version');
    expect(b).toMatch(/draft = jsonb_build_object\('prompt', v_prompt\)/);
    expect(b).toMatch(/draft_revision = v_revisao \+ 1/);
  });

  it('grant: revoga de public, anon, authenticated e service_role e só então dá execute a authenticated', () => {
    for (const [nome, assinatura] of Object.entries(FUNCOES)) {
      const revoke = `revoke all on function public.${nome}${assinatura} from public, anon, authenticated, service_role;`;
      const grant = `grant execute on function public.${nome}${assinatura} to authenticated;`;
      expect(semComentarios, nome).toContain(revoke);
      expect(semComentarios, nome).toContain(grant);
      expect(semComentarios.indexOf(revoke), nome).toBeLessThan(semComentarios.indexOf(grant));
    }
  });

  it('a regra das 12 variáveis vale no banco: função auxiliar sem execute para ninguém, chamada antes de gravar', () => {
    const auxiliar = semComentarios.match(
      /create or replace function public\.central_agentes_variavel_desconhecida\(p_prompt text\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/,
    );
    expect(auxiliar, 'função auxiliar').not.toBeNull();
    const [, cab, corpoAuxiliar] = auxiliar!;
    expect(cab).toMatch(/language sql/);
    expect(cab).toMatch(/immutable/);
    expect(cab).toMatch(/security invoker/);
    expect(cab).toMatch(/set search_path = ''/);
    expect(corpoAuxiliar).toContain("regexp_matches(coalesce(p_prompt, ''), '\\{\\{([^{}]*)\\}\\}', 'g')");
    expect(semComentarios).toContain(
      'revoke all on function public.central_agentes_variavel_desconhecida(text) from public, anon, authenticated, service_role;',
    );
    expect(semComentarios).not.toMatch(/grant execute on function public\.central_agentes_variavel_desconhecida/);
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      const b = corpo(nome);
      const chamada = b.indexOf('public.central_agentes_variavel_desconhecida(v_prompt)');
      expect(chamada, nome).toBeGreaterThan(-1);
      expect(chamada, nome).toBeLessThan(b.indexOf('insert into public.ai_agent_versions'));
      expect(b, nome).toContain("raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida");
    }
  });

  it('não é destrutiva: nenhuma tabela, coluna ou dado muda', () => {
    expect(semComentarios).not.toMatch(/\bdrop\s+(table|column|function|trigger|policy|index|schema)\b/i);
    expect(semComentarios).not.toMatch(/\balter\s+table\b/i);
    expect(semComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(semComentarios).not.toMatch(/\btruncate\b/i);
    expect(semComentarios).not.toMatch(/\bcreate\s+(table|policy|trigger)\b/i);
  });

  it('a volta derruba só as quatro funções e o registro da versão, numa transação', () => {
    const volta = existsSync(VOLTA) ? readFileSync(VOLTA, 'utf8').replace(/--.*$/gm, '') : '';
    const comandos = volta.split(';').map((c) => c.trim()).filter(Boolean);
    expect(comandos).toEqual([
      'begin',
      'drop function if exists public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text)',
      'drop function if exists public.publish_ai_agent_version(uuid, uuid, integer, integer, text)',
      'drop function if exists public.save_ai_agent_draft(uuid, uuid, integer, text)',
      'drop function if exists public.central_agentes_variavel_desconhecida(text)',
      "delete from supabase_migrations.schema_migrations where version = '20261007120000'",
      'commit',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run test/centralAgentesEditorMigration.test.ts`
Expected: FAIL em todos, a começar por "existe, e a volta também" (arquivos ausentes).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261007120000_central_agentes_editor.sql` (LF, sem CR; conferir com `grep -c $'\r'` = 0 depois de salvar):

```sql
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
-- Devolve o primeiro marcador {{...}} cujo nome, sem os espaços das pontas, não é uma delas; null quando todos
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
    select regexp_replace(r.m[1], '^\s+|\s+$', '', 'g') as nome, r.ordem
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
```

- [ ] **Step 4: Escrever a volta**

Criar `docs/features/central-de-agentes/volta-fatia-2.sql`:

```sql
-- VOLTA da fatia 2 da Central de Agentes (supabase/migrations/20261007120000_central_agentes_editor.sql).
-- ORDEM: primeiro tirar do ar o código das telas e das rotas da Central (sem as funções, Salvar, Publicar e
-- Restaurar respondem erro); só depois rodar isto. Nunca em produção sem o OK do Junior.
-- Provada no banco local (Task 2, Step 3): aplicar, voltar, aplicar.
-- Não apaga versões publicadas pela tela: elas continuam versões válidas do agente, e o runtime as lê.
begin;
drop function if exists public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text);
drop function if exists public.publish_ai_agent_version(uuid, uuid, integer, integer, text);
drop function if exists public.save_ai_agent_draft(uuid, uuid, integer, text);
drop function if exists public.central_agentes_variavel_desconhecida(text);
delete from supabase_migrations.schema_migrations where version = '20261007120000';
commit;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run test/centralAgentesEditorMigration.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 6: Aplicar no banco local**

Run:
```bash
docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/20261007120000_central_agentes_editor.sql
docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261007120000', 'central_agentes_editor') on conflict do nothing"
docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
```
Expected: `CREATE FUNCTION` e `REVOKE` quatro vezes e `GRANT` três (a auxiliar não ganha), sem erro; o `insert` de 1 linha; o `NOTIFY`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261007120000_central_agentes_editor.sql docs/features/central-de-agentes/volta-fatia-2.sql test/centralAgentesEditorMigration.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): funcoes de salvar rascunho, publicar e restaurar (fatia 2)"
```
O `git diff --cached --stat` tem que listar só esses três arquivos, com o número de linhas esperado (nenhum arquivo inteiro reescrito por fim de linha).

---

### Task 2: Teste local das três funções (comportamento, matriz de acesso, corrida) e prova da volta

**Files:**
- Test: `test/centralAgentesEditor.local.test.ts`

O que este teste prova, com chamada de verdade no Supabase local (`npm run test:local`), e que o teste estático da Task 1 não alcança:
- salvar sobe a revisão, grava o autor de `auth.uid()` e recusa revisão velha (a "outra aba");
- publicar cria N+1, move o ponteiro e copia `settings`/`model` da publicada. A cópia é provada com uma publicada de valores **diferentes do padrão** (a v1 da migração tem `{}` e nulo, os mesmos de uma inserção que omitisse os campos). Recusa versão esperada velha, revisão velha, rascunho igual ao publicado e rascunho vazio;
- restaurar cria versão nova com `source = 'restore'` e `restored_from`, traz o texto para o rascunho e recusa a própria publicada, conteúdo repetido e versão que não existe;
- variável fora das 12 é recusada pela própria função, ao publicar e ao restaurar, mesmo numa chamada direta pelo JWT de quem é da agência (`variavel_desconhecida`, com o nome no `details`);
- agente de outra organização é `agente_inexistente` (G4);
- matriz G2: o privilégio **efetivo**, lido no catálogo (`has_function_privilege`), é `execute` só de `authenticated` nas três funções e de ninguém na auxiliar. Na chamada, o anônimo e a chave de serviço caem no "permission denied for function" do Postgres. `agency_staff` e os dois clientes chegam à função e recebem `sem_permissao`. Só `agency_admin` e o legado `admin` passam do papel. Os dois 42501 têm o mesmo código: sem separar a mensagem e sem o catálogo, o teste não provaria o `revoke` (revisão do Codex, 07/10). Nada muda no banco;
- corrida: com uma publicação aberta em outra sessão, a segunda chega ao banco, **espera a trava da linha** (vista em `pg_blocking_pids` e `pg_locks`, como nas corridas da fatia 1) e recebe `versao_publicada_mudou`.

- [ ] **Step 1: Escrever o teste**

Criar `test/centralAgentesEditor.local.test.ts`:

```ts
// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { assertNoSupabaseError, getSupabaseAdminClient } from './helpers/supabaseAdmin';
import { getAnonKey, getSupabaseUrl } from './helpers/env';

const isLocalSupabase = process.env.SUPABASE_TEST_TARGET === 'local'
  && getSupabaseUrl() === 'http://127.0.0.1:54321'
  && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const describeLocal = describe.skipIf(!isLocalSupabase);

/** Postgres do `supabase start`. Constante de propósito: a corrida nunca abre sessão fora do local. */
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');
const BASE = 'Voce e a Aurora. {{contactName}}\n{{recentMessagesText}}';

function exigirPostgresLocal() {
  const alvo = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(alvo.hostname) || alvo.port !== '54322' || alvo.pathname !== '/postgres') {
    throw new Error('RECUSADO: a corrida so abre sessao no Postgres local (127.0.0.1:54322).');
  }
}

type Papel = 'agency_admin' | 'agency_staff' | 'admin' | 'clinic_admin';
type LinhaPublicada = { out_version: number; out_version_id: string };
type LinhaRestaurada = LinhaPublicada & { out_draft_revision: number };

describeLocal('Central de Agentes, editor (fatia 2) — Supabase local', () => {
  let runId = '';
  let orgA = '';
  let orgB = '';
  let idAgencia = '';
  let agencia: SupabaseClient;
  const usuarios: string[] = [];
  const emails: Partial<Record<'agencia' | 'staff' | 'legado' | 'clienteA' | 'clienteB', string>> = {};
  const senha = `Vitest!${randomUUID()}`;

  async function criarUsuario(role: Papel, organizationId: string) {
    const admin = getSupabaseAdminClient();
    const email = `editor.${role}.${runId}.${randomUUID()}@example.com`;
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
      name: `Editor ${role} ${runId}`,
      first_name: 'Editor',
      organization_id: organizationId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' }), `upsert profile ${role}`);
    return { email, id: criado.data.user.id };
  }

  async function entrar(email: string) {
    const client = createClient(getSupabaseUrl(), getAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const login = await client.auth.signInWithPassword({ email, password: senha });
    expect(login.error).toBeNull();
    return client;
  }

  /** Agente com a v1 como a migração cria. O texto leva um sufixo único: a criação é idempotente por (cliente, sha). */
  async function novoAgente(organizationId: string, sufixo: string) {
    const prompt = `${BASE}\n${sufixo} ${randomUUID()}`;
    const criado = await getSupabaseAdminClient().rpc('create_ai_agent_from_legacy_prompt', {
      p_organization_id: organizationId,
      p_name: 'Aurora',
      p_prompt: prompt,
      p_origin: { sha256: sha256(prompt), promptKey: 'task_conversations_whatsapp_cenno_aurora', promptSource: 'default' },
    });
    expect(criado.error).toBeNull();
    return { agente: (criado.data as Array<{ out_agent_id: string }>)[0].out_agent_id, v1: prompt };
  }

  async function estado(agente: string) {
    const admin = getSupabaseAdminClient();
    const a = await admin
      .from('ai_agents')
      .select('draft, draft_revision, draft_updated_by, published_version_id')
      .eq('id', agente)
      .single();
    const v = await admin
      .from('ai_agent_versions')
      .select('id, version, prompt, settings, model, source, restored_from, note, published_by')
      .eq('agent_id', agente)
      .order('version');
    expect(a.error).toBeNull();
    expect(v.error).toBeNull();
    return { agente: a.data!, versoes: v.data! };
  }

  const salvar = (cliente: SupabaseClient, org: string, agente: string, revisao: number, prompt: string) =>
    cliente.rpc('save_ai_agent_draft', {
      p_organization_id: org,
      p_agent_id: agente,
      p_expected_revision: revisao,
      p_prompt: prompt,
    });
  const publicar = (cliente: SupabaseClient, org: string, agente: string, versao: number, revisao: number, nota: string | null = null) =>
    cliente.rpc('publish_ai_agent_version', {
      p_organization_id: org,
      p_agent_id: agente,
      p_expected_version: versao,
      p_expected_revision: revisao,
      p_note: nota,
    });
  const restaurar = (cliente: SupabaseClient, org: string, agente: string, alvo: number, versao: number, revisao: number, nota: string | null = null) =>
    cliente.rpc('restore_ai_agent_version', {
      p_organization_id: org,
      p_agent_id: agente,
      p_version: alvo,
      p_expected_version: versao,
      p_expected_revision: revisao,
      p_note: nota,
    });

  async function sessaoPg() {
    exigirPostgresLocal();
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    return client;
  }

  /** Espera outra sessão ficar BLOQUEADA por `dona` e devolve as travas que ela pede e não ganhou. */
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
    const criado = await criarUsuario('agency_admin', orgA);
    emails.agencia = criado.email;
    idAgencia = criado.id;
    emails.staff = (await criarUsuario('agency_staff', orgA)).email;
    emails.legado = (await criarUsuario('admin', orgA)).email;
    emails.clienteA = (await criarUsuario('clinic_admin', orgA)).email;
    emails.clienteB = (await criarUsuario('clinic_admin', orgB)).email;
    agencia = await entrar(emails.agencia);
  }, 120_000);

  afterAll(async () => {
    const admin = getSupabaseAdminClient();
    for (const id of usuarios) await admin.auth.admin.deleteUser(id);
    if (runId) await cleanupFixtures(runId);
  }, 120_000);

  it('salvar rascunho sobe a revisão, grava o autor e recusa a revisão que outra aba já passou', async () => {
    const { agente } = await novoAgente(orgA, 'salvar');
    const primeira = await salvar(agencia, orgA, agente, 0, `${BASE}\nrascunho 1`);
    expect(primeira.error).toBeNull();
    expect(primeira.data).toBe(1);

    const depois = await estado(agente);
    expect(depois.agente.draft).toEqual({ prompt: `${BASE}\nrascunho 1` });
    expect(depois.agente.draft_revision).toBe(1);
    expect(depois.agente.draft_updated_by).toBe(idAgencia);

    const daOutraAba = await salvar(agencia, orgA, agente, 0, `${BASE}\nrascunho da outra aba`);
    expect(daOutraAba.error?.code).toBe('P0001');
    expect(daOutraAba.error?.message).toBe('rascunho_mudou');
    expect((await estado(agente)).agente.draft).toEqual({ prompt: `${BASE}\nrascunho 1` });
  });

  it('publicar cria N+1, move o ponteiro, copia ajustes e modelo da publicada e grava nota e autor', async () => {
    const { agente } = await novoAgente(orgA, 'publicar');
    // A v1 da migração tem {} e nulo, os mesmos valores de uma inserção que omitisse os dois campos. Para provar a
    // CÓPIA, a publicada passa a ser uma v2 com valores diferentes do padrão, gravada direto no Postgres local.
    const pg = await sessaoPg();
    try {
      const v2 = await pg.query(
        "insert into public.ai_agent_versions (agent_id, organization_id, version, prompt, settings, model, source) values ($1, $2, 2, $3, $4::jsonb, 'modelo-de-teste', 'publish') returning id",
        [agente, orgA, `${BASE}\nv2 direta`, JSON.stringify({ origemDoTeste: true })],
      );
      await pg.query('update public.ai_agents set published_version_id = $1 where id = $2', [v2.rows[0].id, agente]);
    } finally {
      await pg.end();
    }
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv3`)).error).toBeNull();

    const publicada = await publicar(agencia, orgA, agente, 2, 1, '  abertura nova  ');
    expect(publicada.error).toBeNull();
    const linha = (publicada.data as LinhaPublicada[])[0];
    expect(linha.out_version).toBe(3);

    const { agente: depois, versoes } = await estado(agente);
    expect(depois.published_version_id).toBe(linha.out_version_id);
    expect(depois.draft_revision).toBe(1);
    expect(versoes.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versoes[2]).toMatchObject({
      id: linha.out_version_id,
      prompt: `${BASE}\nv3`,
      settings: { origemDoTeste: true },
      model: 'modelo-de-teste',
      source: 'publish',
      restored_from: null,
      note: 'abertura nova',
      published_by: idAgencia,
    });
  });

  it('publicar recusa versão esperada velha, revisão velha, rascunho igual ao publicado e rascunho vazio', async () => {
    const { agente } = await novoAgente(orgA, 'recusas');
    const vazio = await publicar(agencia, orgA, agente, 1, 0);
    expect(vazio.error?.message).toBe('rascunho_vazio');

    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 1)).error).toBeNull();

    // A tela mostrava a v1: outra pessoa publicou a v2 no meio.
    const versaoVelha = await publicar(agencia, orgA, agente, 1, 1);
    expect(versaoVelha.error?.code).toBe('P0001');
    expect(versaoVelha.error?.message).toBe('versao_publicada_mudou');

    // O rascunho que está no banco é o texto da v2: publicar de novo não muda nada.
    const igual = await publicar(agencia, orgA, agente, 2, 1);
    expect(igual.error?.message).toBe('sem_mudancas');

    expect((await salvar(agencia, orgA, agente, 1, `${BASE}\nv3`)).error).toBeNull();
    // A tela verificou a revisão 1; o banco está na 2.
    const revisaoVelha = await publicar(agencia, orgA, agente, 2, 1);
    expect(revisaoVelha.error?.code).toBe('P0001');
    expect(revisaoVelha.error?.message).toBe('rascunho_mudou');

    expect((await estado(agente)).versoes.map((v) => v.version)).toEqual([1, 2]);
  });

  it('restaurar publica a versão escolhida como nova, com restored_from, e traz o texto para o rascunho', async () => {
    const { agente, v1 } = await novoAgente(orgA, 'restaurar');
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 1)).error).toBeNull();

    const restaurada = await restaurar(agencia, orgA, agente, 1, 2, 1, 'voltar a abertura');
    expect(restaurada.error).toBeNull();
    const linha = (restaurada.data as LinhaRestaurada[])[0];
    expect(linha.out_version).toBe(3);
    expect(linha.out_draft_revision).toBe(2);

    const { agente: depois, versoes } = await estado(agente);
    expect(depois.published_version_id).toBe(linha.out_version_id);
    expect(depois.draft).toEqual({ prompt: v1 });
    expect(depois.draft_revision).toBe(2);
    expect(versoes[2]).toMatchObject({
      version: 3,
      prompt: v1,
      source: 'restore',
      restored_from: 1,
      note: 'voltar a abertura',
      published_by: idAgencia,
    });

    const aPropria = await restaurar(agencia, orgA, agente, 3, 3, 2);
    expect(aPropria.error?.message).toBe('versao_ja_publicada');
    const repetida = await restaurar(agencia, orgA, agente, 1, 3, 2);
    expect(repetida.error?.message).toBe('sem_mudancas');
    const inexistente = await restaurar(agencia, orgA, agente, 9, 3, 2);
    expect(inexistente.error?.code).toBe('P0002');
    expect(inexistente.error?.message).toBe('versao_inexistente');
    const revisaoVelha = await restaurar(agencia, orgA, agente, 2, 3, 1);
    expect(revisaoVelha.error?.message).toBe('rascunho_mudou');

    expect((await estado(agente)).versoes.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('variável fora das 12 é recusada pela própria função, ao publicar e ao restaurar, mesmo chamando direto', async () => {
    const { agente } = await novoAgente(orgA, 'variavel');
    // Chamada direta pelo JWT de quem é da agência, sem passar pela rota que roda a verificação ao vivo.
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\n{{ nomeDoLead }}`)).error).toBeNull();
    const publicada = await publicar(agencia, orgA, agente, 1, 1);
    expect(publicada.error?.code).toBe('P0001');
    expect(publicada.error?.message).toBe('variavel_desconhecida');
    expect(publicada.error?.details).toBe('nomeDoLead');

    // Espaços nas pontas não contam, como no runtime e na tela.
    expect((await salvar(agencia, orgA, agente, 1, `${BASE}\n{{ contactName }}`)).error).toBeNull();
    expect((await publicar(agencia, orgA, agente, 1, 2)).error).toBeNull();

    // Uma versão antiga com uma variável que saiu do runtime: restaurar também recusa.
    const pg = await sessaoPg();
    try {
      await pg.query(
        "insert into public.ai_agent_versions (agent_id, organization_id, version, prompt, source) values ($1, $2, 99, $3, 'publish')",
        [agente, orgA, `${BASE}\n{{variavelQueSaiu}}`],
      );
    } finally {
      await pg.end();
    }
    const restaurada = await restaurar(agencia, orgA, agente, 99, 2, 2);
    expect(restaurada.error?.message).toBe('variavel_desconhecida');
    expect(restaurada.error?.details).toBe('variavelQueSaiu');

    const { agente: depois } = await estado(agente);
    expect(depois.draft_revision).toBe(2);
  });

  it('o agente tem que ser da organização informada (G4)', async () => {
    const { agente: deB } = await novoAgente(orgB, 'outra organizacao');
    const chamadas = [
      await salvar(agencia, orgA, deB, 0, 'x'),
      await publicar(agencia, orgA, deB, 1, 0),
      await restaurar(agencia, orgA, deB, 1, 1, 0),
    ];
    for (const chamada of chamadas) {
      expect(chamada.error?.code).toBe('P0002');
      expect(chamada.error?.message).toBe('agente_inexistente');
    }
    const { agente } = await estado(deB);
    expect(agente.draft_revision).toBe(0);
  });

  it('limites: prompt vazio ou acima de 50 mil caracteres e nota acima de 200', async () => {
    const { agente } = await novoAgente(orgA, 'limites');
    for (const prompt of ['', 'x'.repeat(50_001)]) {
      const r = await salvar(agencia, orgA, agente, 0, prompt);
      expect(r.error?.code).toBe('22023');
      expect(r.error?.message).toBe('prompt_invalido');
    }
    expect((await salvar(agencia, orgA, agente, 0, 'x'.repeat(50_000))).error).toBeNull();
    const nota = await publicar(agencia, orgA, agente, 1, 1, 'n'.repeat(201));
    expect(nota.error?.code).toBe('22023');
    expect(nota.error?.message).toBe('nota_invalida');
  });

  it('matriz de acesso (G2): execute só de authenticated, lido no catálogo; dentro, só agency_admin e o legado admin passam do papel', async () => {
    // O 42501 do Postgres (sem execute) e o da função (sem_permissao) têm o mesmo código: a chamada sozinha não prova
    // o revoke. O catálogo mostra o privilégio efetivo, com herança de papel (revisão do Codex, 07/10).
    const pg = await sessaoPg();
    try {
      const privilegio = (funcao: string) =>
        pg.query(
          "select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as autenticado, has_function_privilege('service_role', $1, 'execute') as servico",
          [funcao],
        );
      for (const funcao of [
        'public.save_ai_agent_draft(uuid, uuid, integer, text)',
        'public.publish_ai_agent_version(uuid, uuid, integer, integer, text)',
        'public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text)',
      ]) {
        expect((await privilegio(funcao)).rows[0], funcao).toEqual({ anon: false, autenticado: true, servico: false });
      }
      expect((await privilegio('public.central_agentes_variavel_desconhecida(text)')).rows[0]).toEqual({
        anon: false,
        autenticado: false,
        servico: false,
      });
    } finally {
      await pg.end();
    }

    const { agente } = await novoAgente(orgA, 'matriz');
    const antes = await estado(agente);
    const identidades: Record<string, SupabaseClient> = {
      anonimo: createClient(getSupabaseUrl(), getAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } }),
      agencia,
      staff: await entrar(emails.staff!),
      legado: await entrar(emails.legado!),
      clienteA: await entrar(emails.clienteA!),
      clienteB: await entrar(emails.clienteB!),
      servico: getSupabaseAdminClient(),
    };
    // Quem passa do papel para na versão/revisão esperada (999), sem escrever nada.
    const passaDoPapel = new Set(['agencia', 'legado']);
    // Sem execute: o Postgres recusa antes de entrar na função.
    const semExecute = new Set(['anonimo', 'servico']);
    for (const [nome, cliente] of Object.entries(identidades)) {
      const chamadas = [
        await salvar(cliente, orgA, agente, 999, 'x'),
        await publicar(cliente, orgA, agente, 999, 999),
        await restaurar(cliente, orgA, agente, 1, 999, 999),
      ];
      for (const chamada of chamadas) {
        if (passaDoPapel.has(nome)) {
          expect(chamada.error?.code, nome).toBe('P0001');
        } else if (semExecute.has(nome)) {
          expect(chamada.error?.code, nome).toBe('42501');
          expect(chamada.error?.message, nome).toMatch(/permission denied for function/);
        } else {
          expect(chamada.error?.code, nome).toBe('42501');
          expect(chamada.error?.message, nome).toBe('sem_permissao');
        }
      }
    }
    expect(await estado(agente)).toEqual(antes);
  });

  it('corrida: com uma publicação aberta em outra sessão, a segunda espera a trava da linha e recebe versao_publicada_mudou', async () => {
    const { agente } = await novoAgente(orgA, 'corrida');
    expect((await salvar(agencia, orgA, agente, 0, `${BASE}\nv2`)).error).toBeNull();
    const a = await sessaoPg();
    try {
      await a.query('begin');
      // Esta sessão age como o mesmo agency_admin, do jeito que o PostgREST chama: papel authenticated e as claims do JWT.
      await a.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: idAgencia, role: 'authenticated' })]);
      await a.query('set local role authenticated');
      const primeira = await a.query('select * from public.publish_ai_agent_version($1, $2, 1, 1, $3)', [orgA, agente, 'primeira']);
      expect(primeira.rows[0].out_version).toBe(2);
      // Volta ao papel da sessão para ler pg_stat_activity e pg_locks; a trava da linha continua com a transação.
      await a.query('reset role');

      const segunda = publicar(agencia, orgA, agente, 1, 1, 'segunda').then((r) => r);
      const travas = await esperarBloqueadoPor(a);
      expect(travas.map((t) => t.locktype)).toContain('transactionid');
      await a.query('commit');

      const resultado = await segunda;
      expect(resultado.error?.code).toBe('P0001');
      expect(resultado.error?.message).toBe('versao_publicada_mudou');
    } finally {
      await a.end();
    }
    const { versoes } = await estado(agente);
    expect(versoes.map((v) => [v.version, v.note, v.published_by])).toEqual([[1, null, null], [2, 'primeira', idAgencia]]);
  });
});
```

- [ ] **Step 2: Rodar contra o Supabase local**

Run: `npm run test:local -- test/centralAgentesEditor.local.test.ts`
Expected: PASS (9 testes). Se algum der `skipped`, o runner não achou o Supabase local: rodar `npx supabase start` e repetir. Se der `function public.save_ai_agent_draft(...) does not exist`, a Task 1, Step 6, não foi aplicada no banco local. Se a matriz falhar em `servico` com `sem_permissao` em vez de "permission denied", a chave de serviço herda `execute` por algum papel: parar e investigar o `revoke`, nunca afrouxar o teste.

- [ ] **Step 3: Provar a volta no banco local (aplicar, voltar, aplicar)**

Run, um comando por vez, lendo cada saída:
```bash
docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < docs/features/central-de-agentes/volta-fatia-2.sql
docker exec -i supabase_db_crmia psql -U postgres -d postgres -At -c "select count(*) from pg_proc where proname in ('save_ai_agent_draft','publish_ai_agent_version','restore_ai_agent_version','central_agentes_variavel_desconhecida'); select count(*) from supabase_migrations.schema_migrations where version = '20261007120000'"
```
Expected: `BEGIN`, quatro `DROP FUNCTION`, `DELETE 1`, `COMMIT`; depois `0` e `0`.

Reaplicar e conferir:
```bash
docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/migrations/20261007120000_central_agentes_editor.sql
docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261007120000', 'central_agentes_editor') on conflict do nothing"
docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
npm run test:local -- test/centralAgentesEditor.local.test.ts
```
Expected: as funções voltam, o `insert` grava 1 linha e o teste passa de novo (9 testes). Anotar no registro da fatia: "volta provada no banco local em <data e hora>".

- [ ] **Step 4: Commit**

```bash
git add test/centralAgentesEditor.local.test.ts
git diff --cached --stat
git commit -m "test(central-agentes): salvar, publicar e restaurar no Supabase local, com matriz G2 e corrida observada"
```

---

### Task 3: Verificação ao vivo e leitura formatada (funções puras)

**Files:**
- Create: `lib/agents/verificarPrompt.ts`
- Create: `lib/agents/leituraDoPrompt.ts`
- Test: `lib/agents/verificarPrompt.test.ts`
- Test: `lib/agents/leituraDoPrompt.test.ts`

As duas funções não leem banco nem rede: a tela roda enquanto se edita, e a rota de publicar roda a verificação de novo sobre o rascunho **gravado** (Task 4). Medido no catálogo em 07/10 (`main` = `6a29238`), e é o que o teste trava:

| Prompt | Caracteres | Variáveis | `replyText` | `{{conversationStageContext}}` | Títulos de seção |
|---|---|---|---|---|---|
| Aurora (`task_conversations_whatsapp_cenno_aurora`) | 20.202 | as 12 | sim | sim | 11 |
| Julia (`task_conversations_whatsapp_auto_reply`) | 2.569 | 4 | sim | não | 5 |

Nenhum dos dois tem trecho `[Texto com maiúscula]` nem marcador `{{...}}` fora das 12. Sem agenda no número, o runtime manda `AGENDA_NAO_CONFIGURADA. Nao ofereca nem confirme horarios.` no lugar de `{{calendarContext}}` (`lib/conversations/aiReply.ts:273`); o aviso diz isso.

- [ ] **Step 1: Escrever os testes que falham**

Criar `lib/agents/verificarPrompt.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import { VARIAVEIS_DO_PROMPT, avisosNaoConfirmados, verificarPrompt } from './verificarPrompt';

const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const AURORA = catalogo.task_conversations_whatsapp_cenno_aurora.defaultTemplate;
const JULIA = catalogo.task_conversations_whatsapp_auto_reply.defaultTemplate;
const PUBLICADO = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

const codigos = (itens: Array<{ codigo: string }>) => itens.map((i) => i.codigo);

/** As chaves do objeto que aiReply.ts passa a renderPromptTemplate, lidas do código-fonte. */
function variaveisDoRuntime(): string[] {
  const fonte = readFileSync(resolve(process.cwd(), 'lib/conversations/aiReply.ts'), 'utf8');
  const chamadas = fonte.split('renderPromptTemplate(').length - 1;
  // Uma chamada só hoje. Se a fatia 3 criar outra, confira se ela troca as mesmas variáveis e ajuste aqui.
  expect(chamadas, 'chamadas de renderPromptTemplate em aiReply.ts').toBe(1);
  const inicio = fonte.indexOf('renderPromptTemplate(resolvedPrompt.content, {');
  expect(inicio, 'a chamada mudou de forma: atualize este leitor').toBeGreaterThan(-1);
  const fim = fonte.indexOf('\n  });', inicio);
  const bloco = fonte.slice(inicio, fim).split('\n').slice(1);
  const chaves: string[] = [];
  for (const linha of bloco) {
    const semComentario = linha.replace(/\/\/.*$/, '');
    const m = /^ {4}([A-Za-z_]\w*)\s*(?::|,\s*$)/.exec(semComentario);
    if (m) chaves.push(m[1]);
  }
  return chaves;
}

describe('verificarPrompt', () => {
  it('a lista das 12 variáveis é exatamente a que o runtime troca (lida de aiReply.ts)', () => {
    const doRuntime = variaveisDoRuntime();
    expect(doRuntime).toHaveLength(12);
    expect([...doRuntime].sort()).toEqual([...VARIAVEIS_DO_PROMPT].sort());
  });

  it('marcador fora das 12 é erro (bloqueia Publicar); espaços dentro das chaves continuam valendo', () => {
    const ok = verificarPrompt({ rascunho: `${PUBLICADO} {{ contactName }}`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(ok.erros).toEqual([]);

    const r = verificarPrompt({
      rascunho: `${PUBLICADO} {{nomeDoLead}} {{nome-do-lead}} {{}} {{nomeDoLead}}`,
      publicado: PUBLICADO,
      numerosLigadosComAgenda: 0,
    });
    expect(codigos(r.erros)).toEqual([
      'variavel_desconhecida:nomeDoLead',
      'variavel_desconhecida:nome-do-lead',
      'variavel_desconhecida:',
    ]);
    expect(r.erros.every((e) => e.nivel === 'erro')).toBe(true);
  });

  it('pendência, agenda sem número e tamanho pedem confirmação; link de markdown e colchete minúsculo não', () => {
    const pendencia = verificarPrompt({
      rascunho: `${PUBLICADO}\nAtenda a [Nome da empresa] e veja [o site](https://exemplo.com) [ok], [Guia](https://exemplo.com/guia) e [Manual][ref].`,
      publicado: PUBLICADO,
      numerosLigadosComAgenda: 0,
    });
    expect(codigos(pendencia.avisos)).toEqual(['pendencia']);
    expect(pendencia.avisos[0].mensagem).toContain('[Nome da empresa]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[o site]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[Guia]');
    expect(pendencia.avisos[0].mensagem).not.toContain('[Manual]');

    const comAgenda = `${PUBLICADO}\n{{calendarContext}}`;
    expect(codigos(verificarPrompt({ rascunho: comAgenda, publicado: comAgenda, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['agenda_sem_numero']);
    expect(verificarPrompt({ rascunho: comAgenda, publicado: comAgenda, numerosLigadosComAgenda: 1 }).avisos).toEqual([]);

    const longo = `${PUBLICADO}\n${'x'.repeat(30_000)}`;
    expect(codigos(verificarPrompt({ rascunho: longo, publicado: PUBLICADO, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['tamanho']);
  });

  it('regressão: perder o que a publicada tinha é aviso; nunca ter tido é só informação', () => {
    const semNada = 'Voce e a Aurora.';
    const perdeu = verificarPrompt({ rascunho: semNada, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(codigos(perdeu.avisos)).toEqual(['perdeu:contactName', 'perdeu:conversationStageContext', 'perdeu:replyText']);
    expect(perdeu.avisos[1].mensagem).toContain('encerrar a conversa depois do repasse');
    expect(perdeu.informacoes).toEqual([]);

    const nuncaTeve = verificarPrompt({ rascunho: semNada, publicado: semNada, numerosLigadosComAgenda: 0 });
    expect(nuncaTeve.avisos).toEqual([]);
    expect(codigos(nuncaTeve.informacoes)).toEqual(['sem_encerramento', 'sem_replyText']);
  });

  it('replyText conta só como linha de campo: tirar o campo e deixar uma menção solta ainda avisa', () => {
    const base = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}';
    const soMencao = verificarPrompt({ rascunho: `${base}\nNunca escreva replyText no meio da frase.`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(codigos(soMencao.avisos)).toEqual(['perdeu:replyText']);

    // O campo em JSON, numa linha própria, também é a instrução.
    const emJson = verificarPrompt({ rascunho: `${base}\n  "replyText": "texto para o lead"`, publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(emJson.avisos).toEqual([]);
  });

  it('a lista das 12 no banco (função auxiliar da migration da Task 1) é a mesma da tela', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261007120000_central_agentes_editor.sql'), 'utf8');
    const funcao = /create or replace function public\.central_agentes_variavel_desconhecida[\s\S]*?array\[([\s\S]*?)\]/.exec(sql);
    expect(funcao, 'a função auxiliar tem que estar na migration (caso positivo do leitor)').not.toBeNull();
    const doBanco = [...funcao![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(doBanco).toHaveLength(12);
    expect([...doBanco].sort()).toEqual([...VARIAVEIS_DO_PROMPT].sort());
  });

  it('agente que nunca publicou: sem aviso de regressão', () => {
    const r = verificarPrompt({ rascunho: 'Voce e a Aurora.\n- replyText: resposta curta', publicado: null, numerosLigadosComAgenda: 0 });
    expect(r.avisos).toEqual([]);
    expect(codigos(r.informacoes)).toEqual(['sem_encerramento']);
  });

  it('avisosNaoConfirmados devolve só os avisos que o pedido não confirmou', () => {
    const r = verificarPrompt({ rascunho: 'Voce e a Aurora.', publicado: PUBLICADO, numerosLigadosComAgenda: 0 });
    expect(avisosNaoConfirmados(r, ['perdeu:contactName'])).toEqual(['perdeu:conversationStageContext', 'perdeu:replyText']);
    expect(avisosNaoConfirmados(r, codigos(r.avisos))).toEqual([]);
  });

  it('os prompts de hoje: a Aurora não dispara nada; a Julia mostra só a informação do encerramento', () => {
    const aurora = verificarPrompt({ rascunho: AURORA, publicado: AURORA, numerosLigadosComAgenda: 1 });
    expect(aurora).toEqual({ erros: [], avisos: [], informacoes: [] });

    const julia = verificarPrompt({ rascunho: JULIA, publicado: JULIA, numerosLigadosComAgenda: 0 });
    expect(julia.erros).toEqual([]);
    expect(julia.avisos).toEqual([]);
    expect(codigos(julia.informacoes)).toEqual(['sem_encerramento']);
  });

  it('a Aurora antes de ser ligada a um número com agenda: só o aviso da agenda', () => {
    expect(codigos(verificarPrompt({ rascunho: AURORA, publicado: AURORA, numerosLigadosComAgenda: 0 }).avisos)).toEqual(['agenda_sem_numero']);
  });
});
```

Criar `lib/agents/leituraDoPrompt.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import { dividirEmSecoes, juntarSecoes, pedacosDaLinha } from './leituraDoPrompt';

const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const AURORA = catalogo.task_conversations_whatsapp_cenno_aurora.defaultTemplate;
const JULIA = catalogo.task_conversations_whatsapp_auto_reply.defaultTemplate;

describe('leitura formatada do prompt', () => {
  it('divide a Aurora e a Julia pelos títulos em maiúscula, com a abertura antes do primeiro', () => {
    expect(dividirEmSecoes(AURORA).map((s) => s.titulo)).toEqual([
      null,
      'O QUE A CENOURA HUB FAZ',
      'REGRAS DE CONVERSA',
      'GATE DE CAPACIDADE E CONSULTORIA',
      'ETIQUETAS DO FUNIL',
      'CONTATO POR ENGANO',
      'CONVERSA ENCERRADA',
      'OBJETIVO E REUNIAO',
      'ENCERRAMENTO',
      'CONTEXTO',
      'HISTORICO RECENTE',
      'RETORNE APENAS UM OBJETO COM',
    ]);
    expect(dividirEmSecoes(JULIA).map((s) => s.titulo)).toEqual([
      null,
      'REGRAS',
      'QUEBRA DE OBJECAO DE AVALIACAO PAGA',
      'CONTEXTO',
      'HISTORICO RECENTE',
      'RETORNE APENAS UM OBJETO COM',
    ]);
  });

  it('separa a nota entre parênteses e o texto que vem depois dos dois-pontos', () => {
    const [, secao] = dividirEmSecoes('Abertura\nETIQUETAS DO FUNIL (decisao de 27/09): use so as do catalogo\n- Respondeu');
    expect(secao).toMatchObject({
      titulo: 'ETIQUETAS DO FUNIL',
      nota: 'decisao de 27/09',
      complemento: 'use so as do catalogo',
      linhas: ['- Respondeu'],
    });
  });

  it('não perde nada: juntar as seções devolve o texto original, byte a byte', () => {
    for (const texto of [AURORA, JULIA, '', 'REGRAS:\n- uma', 'sem titulo nenhum\n\n']) {
      expect(juntarSecoes(dividirEmSecoes(texto))).toBe(texto);
    }
  });

  it('marca as variáveis da linha, conhecidas e desconhecidas', () => {
    expect(pedacosDaLinha('Oferece {{calendarContext}} e {{ nomeErrado }}.')).toEqual([
      { tipo: 'texto', texto: 'Oferece ' },
      { tipo: 'variavel', texto: '{{calendarContext}}', nome: 'calendarContext', conhecida: true },
      { tipo: 'texto', texto: ' e ' },
      { tipo: 'variavel', texto: '{{ nomeErrado }}', nome: 'nomeErrado', conhecida: false },
      { tipo: 'texto', texto: '.' },
    ]);
    expect(pedacosDaLinha('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/agents/verificarPrompt.test.ts lib/agents/leituraDoPrompt.test.ts`
Expected: FAIL com `Failed to resolve import "./verificarPrompt"` e `"./leituraDoPrompt"`.

- [ ] **Step 3: Implementar `lib/agents/verificarPrompt.ts`**

```ts
/**
 * Verificação ao vivo do prompt de um agente (Central de Agentes, fatia 2; SPEC, "Verificação ao vivo").
 * Função pura, a mesma na tela e no servidor: a tela roda enquanto se edita; a rota de publicar roda de novo
 * sobre o rascunho GRAVADO e é ela que decide (erro bloqueia; aviso só passa confirmado).
 */

/**
 * As 12 variáveis que o runtime troca (lib/conversations/aiReply.ts, objeto passado a renderPromptTemplate).
 * verificarPrompt.test.ts lê aiReply.ts e trava esta lista.
 */
export const VARIAVEIS_DO_PROMPT = [
  'organizationName',
  'contactName',
  'contactPhone',
  'currentDateTime',
  'currentDateTimeLocal',
  'timezone',
  'meetingHostName',
  'meetingChannelText',
  'conversationStageContext',
  'recentMessagesText',
  'calendarContext',
  'availableTagsContext',
] as const;
export type VariavelDoPrompt = (typeof VARIAVEIS_DO_PROMPT)[number];

export const LIMITE_DE_AVISO_DE_TAMANHO = 30_000;

export type NivelDoItem = 'erro' | 'aviso' | 'info';
export type ItemDaVerificacao = { codigo: string; nivel: NivelDoItem; mensagem: string };
export type ResultadoDaVerificacao = {
  erros: ItemDaVerificacao[];
  avisos: ItemDaVerificacao[];
  informacoes: ItemDaVerificacao[];
};
export type EntradaDaVerificacao = {
  /** O texto que vai ser publicado. */
  rascunho: string;
  /** O texto da versão publicada hoje; null se o agente nunca publicou. */
  publicado: string | null;
  /** Quantos números ligados a este agente têm a agenda ligada. */
  numerosLigadosComAgenda: number;
};

const CONHECIDAS = new Set<string>(VARIAVEIS_DO_PROMPT);
/** Tudo entre {{ e }}. O runtime só troca `[\w.]+` e deixa o resto literal; qualquer marcador fora das 12 é erro. */
const MARCADOR = /\{\{([^{}]*)\}\}/g;
/**
 * "[Texto com maiúscula]" que não é link de markdown: cara de pendência ("[Nome da empresa]"). Link em linha
 * ("[Guia](url)") e link de referência ("[Guia][ref]") não contam.
 */
const PENDENCIA = /\[([A-ZÀ-Ý][^[\]\n]{1,80})\](?![([])/g;
/**
 * A instrução de saída é a LINHA DE CAMPO, no começo da linha: "- replyText: ..." (como nos dois prompts do catálogo
 * em 07/10) ou "replyText:" / "\"replyText\":". Uma menção solta ("nunca escreva replyText") não conta: senão
 * tirar o campo e deixar a menção apagaria o aviso perdeu:replyText (revisão do Codex, 07/10).
 */
const REPLY_TEXT = /^[ \t]*(?:-[ \t]*)?"?replyText"?[ \t]*:/m;

export function usaVariavel(texto: string, nome: VariavelDoPrompt): boolean {
  return new RegExp(`\\{\\{\\s*${nome}\\s*\\}\\}`).test(texto);
}

const MENSAGEM_DA_PERDA: Partial<Record<VariavelDoPrompt, string>> = {
  conversationStageContext:
    'O rascunho tirou {{conversationStageContext}}: sem ele o agente deixa de encerrar a conversa depois do repasse para uma pessoa.',
  calendarContext: 'O rascunho tirou {{calendarContext}}: o agente deixa de ver os horários livres da agenda.',
  recentMessagesText: 'O rascunho tirou {{recentMessagesText}}: o agente deixa de ler as últimas mensagens da conversa.',
};

export function verificarPrompt(entrada: EntradaDaVerificacao): ResultadoDaVerificacao {
  const { rascunho, publicado, numerosLigadosComAgenda } = entrada;
  const erros: ItemDaVerificacao[] = [];
  const avisos: ItemDaVerificacao[] = [];
  const informacoes: ItemDaVerificacao[] = [];

  const desconhecidas = new Map<string, string>();
  for (const m of rascunho.matchAll(MARCADOR)) {
    const nome = m[1].trim();
    if (!CONHECIDAS.has(nome) && !desconhecidas.has(nome)) desconhecidas.set(nome, m[0]);
  }
  for (const [nome, marcador] of desconhecidas) {
    erros.push({
      codigo: `variavel_desconhecida:${nome}`,
      nivel: 'erro',
      mensagem: `${marcador} não é uma das 12 variáveis do agente. Corrija antes de publicar.`,
    });
  }

  const pendencias = [...new Set([...rascunho.matchAll(PENDENCIA)].map((m) => m[0]))];
  if (pendencias.length > 0) {
    const mais = pendencias.length > 3 ? ` e mais ${pendencias.length - 3}` : '';
    avisos.push({
      codigo: 'pendencia',
      nivel: 'aviso',
      mensagem: `Trecho com cara de pendência: ${pendencias.slice(0, 3).join(', ')}${mais}.`,
    });
  }
  if (usaVariavel(rascunho, 'calendarContext') && numerosLigadosComAgenda === 0) {
    avisos.push({
      codigo: 'agenda_sem_numero',
      nivel: 'aviso',
      mensagem: 'O prompt usa {{calendarContext}}, mas nenhum número ligado a este agente tem a agenda ligada: a IA vai receber "agenda não configurada" e não vai oferecer horários.',
    });
  }
  if (rascunho.length > LIMITE_DE_AVISO_DE_TAMANHO) {
    avisos.push({
      codigo: 'tamanho',
      nivel: 'aviso',
      mensagem: `O prompt tem ${rascunho.length.toLocaleString('pt-BR')} caracteres, acima de 30 mil: cada resposta fica mais cara e mais lenta.`,
    });
  }

  if (publicado !== null) {
    for (const nome of VARIAVEIS_DO_PROMPT) {
      if (usaVariavel(publicado, nome) && !usaVariavel(rascunho, nome)) {
        avisos.push({
          codigo: `perdeu:${nome}`,
          nivel: 'aviso',
          mensagem: MENSAGEM_DA_PERDA[nome] ?? `O rascunho tirou {{${nome}}}, que a versão publicada usa.`,
        });
      }
    }
    if (REPLY_TEXT.test(publicado) && !REPLY_TEXT.test(rascunho)) {
      avisos.push({
        codigo: 'perdeu:replyText',
        nivel: 'aviso',
        mensagem: 'O rascunho tirou a instrução de replyText, que diz à IA onde escrever a resposta.',
      });
    }
  }

  if (!usaVariavel(rascunho, 'conversationStageContext') && (publicado === null || !usaVariavel(publicado, 'conversationStageContext'))) {
    informacoes.push({
      codigo: 'sem_encerramento',
      nivel: 'info',
      mensagem: 'Este agente não faz encerramento depois do repasse: o prompt não tem {{conversationStageContext}}.',
    });
  }
  if (!REPLY_TEXT.test(rascunho) && (publicado === null || !REPLY_TEXT.test(publicado))) {
    informacoes.push({
      codigo: 'sem_replyText',
      nivel: 'info',
      mensagem: 'O prompt não tem a linha de campo replyText; a resposta segue só o formato que o sistema pede.',
    });
  }

  return { erros, avisos, informacoes };
}

/** Avisos que o pedido de publicar não confirmou. A rota recusa publicar enquanto sobrar algum. */
export function avisosNaoConfirmados(resultado: ResultadoDaVerificacao, confirmados: readonly string[]): string[] {
  const ok = new Set(confirmados);
  return resultado.avisos.map((a) => a.codigo).filter((codigo) => !ok.has(codigo));
}
```

- [ ] **Step 4: Implementar `lib/agents/leituraDoPrompt.ts`**

```ts
import { VARIAVEIS_DO_PROMPT } from './verificarPrompt';

/**
 * Leitura formatada do prompt no editor (mockup aprovado em 29/09: seções com título, texto corrido e as
 * variáveis como etiquetas). Os prompts de hoje marcam seção com uma linha em MAIÚSCULAS terminada em
 * dois-pontos, às vezes com uma nota entre parênteses ("ETIQUETAS DO FUNIL (decisao de 27/09):").
 * Nada se perde: juntarSecoes(dividirEmSecoes(t)) === t, e o teste confere.
 */
export type SecaoDoPrompt = {
  /** A linha original do título; null na abertura (o que vem antes do primeiro título). */
  cabecalho: string | null;
  titulo: string | null;
  nota: string | null;
  /** Texto que veio na mesma linha do título, depois dos dois-pontos. */
  complemento: string | null;
  linhas: string[];
};

/** Medido nos dois prompts em 07/10: acha os 11 títulos da Aurora e os 5 da Julia, e nenhuma linha de texto. */
const TITULO = /^([A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,.&'"+–-]*[A-ZÀ-Ý0-9)])(\s*\([^)]*\))?\s*:\s*(.*)$/;
const CONHECIDAS = new Set<string>(VARIAVEIS_DO_PROMPT);

function lerTitulo(linha: string) {
  const m = TITULO.exec(linha);
  return m && /[A-ZÀ-Ý]{3}/.test(m[1]) ? m : null;
}

export function dividirEmSecoes(prompt: string): SecaoDoPrompt[] {
  const secoes: SecaoDoPrompt[] = [{ cabecalho: null, titulo: null, nota: null, complemento: null, linhas: [] }];
  for (const linha of prompt.split('\n')) {
    const m = lerTitulo(linha);
    if (m) {
      secoes.push({
        cabecalho: linha,
        titulo: m[1].trim(),
        nota: m[2] ? m[2].trim().replace(/^\(/, '').replace(/\)$/, '') : null,
        complemento: m[3]?.trim() || null,
        linhas: [],
      });
    } else {
      secoes[secoes.length - 1].linhas.push(linha);
    }
  }
  return secoes;
}

export function juntarSecoes(secoes: SecaoDoPrompt[]): string {
  return secoes.flatMap((s) => (s.cabecalho === null ? s.linhas : [s.cabecalho, ...s.linhas])).join('\n');
}

export type PedacoDaLinha =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'variavel'; texto: string; nome: string; conhecida: boolean };

export function pedacosDaLinha(linha: string): PedacoDaLinha[] {
  const pedacos: PedacoDaLinha[] = [];
  for (const parte of linha.split(/(\{\{[^{}]*\}\})/)) {
    if (!parte) continue;
    const m = /^\{\{([^{}]*)\}\}$/.exec(parte);
    if (m) {
      const nome = m[1].trim();
      pedacos.push({ tipo: 'variavel', texto: parte, nome, conhecida: CONHECIDAS.has(nome) });
    } else {
      pedacos.push({ tipo: 'texto', texto: parte });
    }
  }
  return pedacos;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/agents/verificarPrompt.test.ts lib/agents/leituraDoPrompt.test.ts`
Expected: PASS (10 + 4 testes). Se o teste das 12 variáveis falhar com "a chamada mudou de forma", alguém mexeu na chamada de `renderPromptTemplate` em `aiReply.ts`: ajuste o leitor do teste e confira a lista, nunca a lista sozinha.

- [ ] **Step 6: Commit**

```bash
git add lib/agents/verificarPrompt.ts lib/agents/verificarPrompt.test.ts lib/agents/leituraDoPrompt.ts lib/agents/leituraDoPrompt.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): verificacao ao vivo do prompt e leitura por secoes (funcoes puras, travadas contra aiReply.ts e o catalogo)"
```

---

### Task 4: Camada de servidor (ler, salvar, publicar com verificação, restaurar)

**Files:**
- Create: `lib/agents/tiposDoEditor.ts`
- Create: `lib/agents/editorAgentes.ts`
- Test: `lib/agents/editorAgentes.test.ts`
- Modify (acrescentar testes): `test/centralAgentesEditor.local.test.ts`

Decisões que o código fixa:
- **Dois clientes do Supabase, com papéis separados.** `usuario` (o JWT de quem pediu, `createClient`) lê `ai_agents` e `ai_agent_versions` pela RLS (só agência) e chama as três funções de escrita. `admin` (chave de serviço) só lê o que a RLS não abre ao usuário: os números (`channel_connections` não tem policy para `authenticated`; SPEC, achados, item 6), os nomes de quem publicou e o nome do cliente. O `admin` nunca escreve.
- **Toda leitura filtra pela organização da rota** (G4): a policy das duas tabelas libera a agência para todas as organizações.
- **A `config` do número nunca sai do servidor** (G22: ela guarda a chave da Evolution). Do número sai só `id`, `nome` e `temAgenda`.
- **Publicar roda a verificação de novo sobre o rascunho GRAVADO**, confere revisão e versão antes (409 cedo), recusa com 422 se houver erro ou aviso não confirmado e só então chama a função, que confere tudo de novo com a linha travada.
- **Erro do banco vira resposta pela mensagem com nome** (Task 1). Erro sem nome conhecido vira 500 com mensagem genérica, e o detalhe vai só para o log do servidor (G10), no padrão de `app/api/settings/automations-live/route.ts`.

- [ ] **Step 1: Criar os tipos (sem teste próprio; os testes das Tasks 4 a 8 os usam)**

Criar `lib/agents/tiposDoEditor.ts`:

```ts
/** Formas que as rotas da Central de Agentes devolvem e a tela lê (fatia 2). */
export type OrigemDaVersao = 'migration' | 'publish' | 'restore';

export type VersaoResumo = {
  id: string;
  versao: number;
  origem: OrigemDaVersao;
  restauradaDe: number | null;
  nota: string | null;
  publicadaEm: string;
  /** Nome de quem publicou; null na migração (feita pelo script) ou quando a pessoa foi removida. */
  publicadaPor: string | null;
};

export type VersaoCompleta = VersaoResumo & {
  prompt: string;
  ajustes: Record<string, unknown>;
  modelo: string | null;
};

/** Uma página do histórico, da mais nova para a mais antiga; `temMais` diz se há versões mais antigas. */
export type PaginaDeVersoes = { versoes: VersaoResumo[]; temMais: boolean };

export type NumeroDoAgente = { id: string; nome: string; temAgenda: boolean };

export type AgenteNaLista = {
  id: string;
  nome: string;
  publicada: VersaoResumo | null;
  rascunhoPendente: boolean;
  numeros: NumeroDoAgente[];
};

export type AgenteNoEditor = {
  id: string;
  nome: string;
  cliente: { id: string; nome: string };
  publicada: VersaoCompleta | null;
  rascunho: { prompt: string | null; revisao: number; atualizadoEm: string | null; atualizadoPor: string | null };
  numeros: NumeroDoAgente[];
};
```

- [ ] **Step 2: Escrever o teste de unidade que falha**

Criar `lib/agents/editorAgentes.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { lerAgente, listarVersoes, publicarComVerificacao, restaurarVersao, salvarRascunho, traduzirErroDoBanco } from './editorAgentes';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const V1 = '33333333-3333-4333-8333-333333333333';
const PUBLICADO = 'Voce e a Aurora. {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

type Linha = Record<string, unknown>;

/** Banco em memória com o pedaço da API do supabase-js que a camada usa: select, eq, lt, in, order, limit, maybeSingle, await. */
function fakeCliente(tabelas: Record<string, Linha[]>, rpc = vi.fn()) {
  return {
    rpc,
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return consulta;
        },
        lt: (coluna: string, valor: number) => {
          linhas = linhas.filter((l) => (l[coluna] as number) < valor);
          return consulta;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return consulta;
        },
        order: (coluna: string, opcoes?: { ascending?: boolean }) => {
          const sinal = opcoes?.ascending === false ? -1 : 1;
          linhas.sort((a, b) => ((a[coluna] as number) - (b[coluna] as number)) * sinal);
          return consulta;
        },
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return consulta;
        },
        maybeSingle: () => Promise.resolve({ data: linhas[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas, error: null }).then(ok, falhou),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

function cenario(rascunho: string | null, revisao = 1) {
  const rpc = vi.fn().mockResolvedValue({ data: [{ out_version: 2, out_version_id: 'v2' }], error: null });
  const usuario = fakeCliente({
    ai_agents: [{
      id: AGENTE, organization_id: TENANT, name: 'Aurora', published_version_id: V1,
      draft: rascunho === null ? {} : { prompt: rascunho }, draft_revision: revisao, draft_updated_at: null, draft_updated_by: null,
    }],
    ai_agent_versions: [{
      id: V1, agent_id: AGENTE, organization_id: TENANT, version: 1, prompt: PUBLICADO, settings: {}, model: null,
      source: 'migration', restored_from: null, note: null, published_at: '2026-10-07T04:51:00Z', published_by: null,
    }],
  }, rpc);
  const admin = fakeCliente({
    organizations: [{ id: TENANT, name: 'Cenno Hub' }],
    channel_connections: [{ id: 'n1', organization_id: TENANT, ai_agent_id: AGENTE, name: 'Comercial', config: { apiKey: 'NAO-PODE-SAIR' } }],
    profiles: [],
  });
  return { clientes: { usuario, admin }, rpc };
}

const pedido = (extra: Partial<Parameters<typeof publicarComVerificacao>[1]> = {}) => ({
  tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: null, confirmarAvisos: [], ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('traduzirErroDoBanco', () => {
  it.each([
    ['rascunho_mudou', 409, 'RASCUNHO_MUDOU'],
    ['versao_publicada_mudou', 409, 'VERSAO_PUBLICADA_MUDOU'],
    ['agente_inexistente', 404, 'AGENTE_INEXISTENTE'],
    ['versao_inexistente', 404, 'VERSAO_INEXISTENTE'],
    ['rascunho_vazio', 422, 'RASCUNHO_VAZIO'],
    ['sem_mudancas', 422, 'SEM_MUDANCAS'],
    ['versao_ja_publicada', 422, 'VERSAO_JA_PUBLICADA'],
    ['variavel_desconhecida', 422, 'VARIAVEL_DESCONHECIDA'],
    ['prompt_invalido', 400, 'PROMPT_INVALIDO'],
    ['nota_invalida', 400, 'NOTA_INVALIDA'],
    ['sem_permissao', 403, 'SEM_PERMISSAO'],
  ])('%s vira %i', (mensagem, status, codigo) => {
    expect(traduzirErroDoBanco({ code: 'P0001', message: mensagem }, 'teste')).toMatchObject({ ok: false, status, codigo });
  });

  it('42501 de privilégio do Postgres vira 403', () => {
    expect(traduzirErroDoBanco({ code: '42501', message: 'permission denied for function save_ai_agent_draft' }, 'teste'))
      .toMatchObject({ status: 403, codigo: 'SEM_PERMISSAO' });
  });

  it('erro sem nome vira 500 sem o detalhe para o navegador; o detalhe vai para o log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = traduzirErroDoBanco({ code: 'XX000', message: 'relation "x" does not exist' }, 'ler agente');
    expect(r).toMatchObject({ status: 500, codigo: 'ERRO_INTERNO' });
    expect(r.erro).not.toContain('relation');
    expect(log).toHaveBeenCalledWith('[central-agentes]', 'ler agente', { code: 'XX000', message: 'relation "x" does not exist' });
  });
});

describe('listarVersoes', () => {
  it('pagina da mais nova para a mais antiga: a primeira página diz que há mais, e antesDe traz o resto', async () => {
    const versoes = Array.from({ length: 55 }, (_, i) => ({
      id: `v${i + 1}`, agent_id: AGENTE, organization_id: TENANT, version: i + 1, prompt: PUBLICADO, settings: {}, model: null,
      source: i === 0 ? 'migration' : 'publish', restored_from: null, note: null, published_at: '2026-10-07T04:51:00Z', published_by: null,
    }));
    const clientes = {
      usuario: fakeCliente({ ai_agents: [{ id: AGENTE, organization_id: TENANT }], ai_agent_versions: versoes }),
      admin: fakeCliente({ profiles: [] }),
    };

    const primeira = await listarVersoes(clientes, TENANT, AGENTE);
    if (!primeira.ok) throw new Error(primeira.erro);
    expect(primeira.dados.versoes.map((v) => v.versao)).toEqual(Array.from({ length: 50 }, (_, i) => 55 - i));
    expect(primeira.dados.temMais).toBe(true);

    const segunda = await listarVersoes(clientes, TENANT, AGENTE, { antesDe: 6 });
    if (!segunda.ok) throw new Error(segunda.erro);
    expect(segunda.dados.versoes.map((v) => v.versao)).toEqual([5, 4, 3, 2, 1]);
    expect(segunda.dados.temMais).toBe(false);
  });
});

describe('lerAgente', () => {
  it('devolve o número sem a config dele', async () => {
    const { clientes } = cenario(null);
    const r = await lerAgente(clientes, TENANT, AGENTE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.numeros).toEqual([{ id: 'n1', nome: 'Comercial', temAgenda: false }]);
    expect(JSON.stringify(r)).not.toContain('NAO-PODE-SAIR');
    expect(r.dados.publicada).toMatchObject({ versao: 1, origem: 'migration', publicadaPor: null, prompt: PUBLICADO });
  });

  it('agente de outra organização é 404', async () => {
    const { clientes } = cenario(null);
    const outro = '44444444-4444-4444-8444-444444444444';
    expect(await lerAgente(clientes, TENANT, outro)).toMatchObject({ ok: false, status: 404, codigo: 'AGENTE_INEXISTENTE' });
  });
});

describe('publicarComVerificacao', () => {
  it('erro na verificação bloqueia: 422 com a verificação, sem chamar o banco', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO} {{nomeDoLead}}`);
    const r = await publicarComVerificacao(clientes, pedido());
    expect(r).toMatchObject({ ok: false, status: 422, codigo: 'VERIFICACAO_BLOQUEIA' });
    if (r.ok) return;
    expect(r.verificacao?.erros.map((e) => e.codigo)).toEqual(['variavel_desconhecida:nomeDoLead']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('aviso só passa confirmado; confirmado, publica exatamente a versão e a revisão verificadas', async () => {
    const semNome = 'Voce e a Aurora.\n{{conversationStageContext}}\n- replyText: resposta curta';
    const { clientes, rpc } = cenario(semNome);

    const semConfirmar = await publicarComVerificacao(clientes, pedido());
    expect(semConfirmar).toMatchObject({ ok: false, status: 422, codigo: 'AVISOS_NAO_CONFIRMADOS' });
    if (semConfirmar.ok) return;
    expect(semConfirmar.verificacao?.avisos.map((a) => a.codigo)).toEqual(['perdeu:contactName']);
    expect(rpc).not.toHaveBeenCalled();

    const confirmado = await publicarComVerificacao(clientes, pedido({ nota: 'tirei o nome', confirmarAvisos: ['perdeu:contactName'] }));
    expect(confirmado).toEqual({ ok: true, dados: { versao: 2, versaoId: 'v2' } });
    expect(rpc).toHaveBeenCalledWith('publish_ai_agent_version', {
      p_organization_id: TENANT,
      p_agent_id: AGENTE,
      p_expected_version: 1,
      p_expected_revision: 1,
      p_note: 'tirei o nome',
    });
  });

  it('revisão ou versão diferente da que a tela mostrou: 409 antes de verificar', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO}\nmais`, 2);
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 1 }))).toMatchObject({ status: 409, codigo: 'RASCUNHO_MUDOU' });
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 2, versaoEsperada: 2 }))).toMatchObject({ status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sem rascunho: 422 RASCUNHO_VAZIO, sem chamar o banco', async () => {
    const { clientes, rpc } = cenario(null, 0);
    expect(await publicarComVerificacao(clientes, pedido({ revisao: 0 }))).toMatchObject({ status: 422, codigo: 'RASCUNHO_VAZIO' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('o banco recusou na hora (corrida): o erro com nome vira 409', async () => {
    const { clientes, rpc } = cenario(`${PUBLICADO}\nmais`);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'versao_publicada_mudou' } });
    expect(await publicarComVerificacao(clientes, pedido())).toMatchObject({ status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU' });
  });
});

describe('salvarRascunho e restaurarVersao', () => {
  it('salvar devolve a revisão nova; resposta sem número vira 500', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 2, error: null }).mockResolvedValueOnce({ data: null, error: null });
    const usuario = fakeCliente({}, rpc);
    const clientes = { usuario, admin: fakeCliente({}) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await salvarRascunho(clientes, { tenantId: TENANT, agentId: AGENTE, revisao: 1, prompt: 'x' })).toEqual({ ok: true, dados: { revisao: 2 } });
    expect(rpc).toHaveBeenCalledWith('save_ai_agent_draft', { p_organization_id: TENANT, p_agent_id: AGENTE, p_expected_revision: 1, p_prompt: 'x' });
    expect(await salvarRascunho(clientes, { tenantId: TENANT, agentId: AGENTE, revisao: 1, prompt: 'x' })).toMatchObject({ status: 500 });
  });

  it('restaurar devolve versão, id e revisão novos', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ out_version: 3, out_version_id: 'v3', out_draft_revision: 2 }], error: null });
    const clientes = { usuario: fakeCliente({}, rpc), admin: fakeCliente({}) };
    expect(await restaurarVersao(clientes, { tenantId: TENANT, agentId: AGENTE, versao: 1, versaoEsperada: 2, revisao: 1, nota: null }))
      .toEqual({ ok: true, dados: { versao: 3, versaoId: 'v3', revisao: 2 } });
    expect(rpc).toHaveBeenCalledWith('restore_ai_agent_version', {
      p_organization_id: TENANT, p_agent_id: AGENTE, p_version: 1, p_expected_version: 2, p_expected_revision: 1, p_note: null,
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run lib/agents/editorAgentes.test.ts`
Expected: FAIL com `Failed to resolve import "./editorAgentes"`.

- [ ] **Step 4: Implementar `lib/agents/editorAgentes.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import { avisosNaoConfirmados, verificarPrompt, type ResultadoDaVerificacao } from './verificarPrompt';
import type {
  AgenteNaLista,
  AgenteNoEditor,
  NumeroDoAgente,
  OrigemDaVersao,
  PaginaDeVersoes,
  VersaoCompleta,
  VersaoResumo,
} from './tiposDoEditor';

/**
 * Leitura e escrita da Central de Agentes (fatia 2). Quem chama são as rotas de
 * app/api/platform/tenants/[tenantId]/agents/**, depois de requireTenantAccess(..., { adminOnly: true }).
 *  - `usuario` (JWT de quem pediu): lê ai_agents e ai_agent_versions pela RLS (só agência) e chama as três funções
 *    de escrita, que conferem o papel por dentro e tiram o autor de auth.uid().
 *  - `admin` (chave de serviço): só o que a RLS não abre ao usuário, e nunca escreve: os números (channel_connections
 *    não tem policy para authenticated), os nomes de quem publicou e o nome do cliente.
 * Toda leitura filtra pela organização da rota (G4): a policy das tabelas do agente não filtra por organização.
 * A config do número nunca sai daqui (G22: guarda a chave da Evolution).
 */
export type Clientes = { usuario: SupabaseClient; admin: SupabaseClient };
export type Falha = { ok: false; status: number; codigo: string; erro: string; verificacao?: ResultadoDaVerificacao };
export type Resultado<T> = { ok: true; dados: T } | Falha;

const falha = (status: number, codigo: string, erro: string, extra: Partial<Falha> = {}): Falha => ({
  ok: false,
  status,
  codigo,
  erro,
  ...extra,
});

/** Erros com nome das funções da migration 20261007120000 (o nome vem na mensagem). */
const ERROS_DO_BANCO: Record<string, { status: number; codigo: string; erro: string }> = {
  sem_permissao: { status: 403, codigo: 'SEM_PERMISSAO', erro: 'Só a agência edita agentes.' },
  agente_inexistente: { status: 404, codigo: 'AGENTE_INEXISTENTE', erro: 'Agente não encontrado neste cliente.' },
  versao_inexistente: { status: 404, codigo: 'VERSAO_INEXISTENTE', erro: 'Essa versão não existe neste agente.' },
  rascunho_mudou: {
    status: 409,
    codigo: 'RASCUNHO_MUDOU',
    erro: 'O rascunho foi alterado em outra aba ou por outra pessoa enquanto você editava.',
  },
  versao_publicada_mudou: {
    status: 409,
    codigo: 'VERSAO_PUBLICADA_MUDOU',
    erro: 'Outra versão foi publicada enquanto você editava. A tela foi atualizada com a versão atual.',
  },
  rascunho_vazio: { status: 422, codigo: 'RASCUNHO_VAZIO', erro: 'Não há rascunho para publicar.' },
  sem_mudancas: { status: 422, codigo: 'SEM_MUDANCAS', erro: 'Não há mudança em relação à versão publicada.' },
  versao_ja_publicada: { status: 422, codigo: 'VERSAO_JA_PUBLICADA', erro: 'Essa já é a versão publicada.' },
  variavel_desconhecida: {
    status: 422,
    codigo: 'VARIAVEL_DESCONHECIDA',
    erro: 'O texto usa uma variável {{...}} que o sistema não conhece. Corrija antes de publicar.',
  },
  prompt_invalido: { status: 400, codigo: 'PROMPT_INVALIDO', erro: 'O prompt precisa ter de 1 a 50 mil caracteres.' },
  nota_invalida: { status: 400, codigo: 'NOTA_INVALIDA', erro: 'A nota pode ter no máximo 200 caracteres.' },
};

const MENSAGEM_ERRO_INTERNO = 'Não foi possível concluir agora. Tente de novo em instantes; se continuar, avise o suporte.';

/** Traduz o erro do banco. Sem nome conhecido: 500 com mensagem genérica, e o detalhe só no log do servidor (G10). */
export function traduzirErroDoBanco(
  erro: { code?: string | null; message?: string | null } | null,
  contexto: string,
): Falha {
  const conhecido = erro?.message ? ERROS_DO_BANCO[erro.message] : undefined;
  if (conhecido) return falha(conhecido.status, conhecido.codigo, conhecido.erro);
  if (erro?.code === '42501') return falha(403, 'SEM_PERMISSAO', ERROS_DO_BANCO.sem_permissao.erro);
  console.error('[central-agentes]', contexto, { code: erro?.code ?? null, message: erro?.message ?? null });
  return falha(500, 'ERRO_INTERNO', MENSAGEM_ERRO_INTERNO);
}

type LinhaDoAgente = {
  id: string;
  name: string;
  published_version_id: string | null;
  draft: Record<string, unknown> | null;
  draft_revision: number;
  draft_updated_at: string | null;
  draft_updated_by: string | null;
};
type LinhaDaVersao = {
  id: string;
  version: number;
  source: OrigemDaVersao;
  restored_from: number | null;
  note: string | null;
  published_at: string;
  published_by: string | null;
  prompt?: string;
  settings?: Record<string, unknown>;
  model?: string | null;
};

const CAMPOS_DO_AGENTE = 'id, name, published_version_id, draft, draft_revision, draft_updated_at, draft_updated_by';
const CAMPOS_DA_VERSAO = 'id, version, source, restored_from, note, published_at, published_by';
const CAMPOS_DA_VERSAO_COMPLETA = `${CAMPOS_DA_VERSAO}, prompt, settings, model`;
const ALGUEM = 'Alguém da equipe';

function promptDoRascunho(draft: unknown): string | null {
  const prompt = (draft as Record<string, unknown> | null)?.prompt;
  return typeof prompt === 'string' ? prompt : null;
}

function nomeDaPessoa(p: { nickname?: string | null; first_name?: string | null; last_name?: string | null; name?: string | null }) {
  const apelido = p.nickname?.trim();
  if (apelido) return apelido;
  const completo = [p.first_name, p.last_name].map((s) => s?.trim()).filter(Boolean).join(' ');
  return completo || p.name?.trim() || ALGUEM;
}

async function nomesDasPessoas(admin: SupabaseClient, ids: Array<string | null>) {
  const unicos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unicos.length === 0) return new Map<string, string>();
  const { data, error } = await admin.from('profiles').select('id, nickname, first_name, last_name, name').in('id', unicos);
  if (error) throw new Error(`profiles: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.id as string, nomeDaPessoa(p)]));
}

async function numerosDosAgentes(admin: SupabaseClient, tenantId: string, agentIds: string[]) {
  const porAgente = new Map<string, NumeroDoAgente[]>();
  if (agentIds.length === 0) return porAgente;
  const { data, error } = await admin
    .from('channel_connections')
    .select('id, name, config, ai_agent_id')
    .eq('organization_id', tenantId)
    .in('ai_agent_id', agentIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`channel_connections: ${error.message}`);
  for (const c of data ?? []) {
    const agente = c.ai_agent_id as string;
    const lista = porAgente.get(agente) ?? [];
    lista.push({
      id: c.id as string,
      nome: (c.name as string | null) || 'Número sem nome',
      temAgenda: resolveConversationCalendarConfig(c.config as Record<string, unknown> | null) !== null,
    });
    porAgente.set(agente, lista);
  }
  return porAgente;
}

async function lerCliente(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin.from('organizations').select('id, name').eq('id', tenantId).maybeSingle();
  if (error) throw new Error(`organizations: ${error.message}`);
  return data ? { id: data.id as string, nome: (data.name as string | null) || 'Cliente' } : null;
}

function resumoDaVersao(v: LinhaDaVersao, nomes: Map<string, string>): VersaoResumo {
  return {
    id: v.id,
    versao: v.version,
    origem: v.source,
    restauradaDe: v.restored_from,
    nota: v.note,
    publicadaEm: v.published_at,
    publicadaPor: v.published_by ? nomes.get(v.published_by) ?? ALGUEM : null,
  };
}

function versaoCompleta(v: LinhaDaVersao, nomes: Map<string, string>): VersaoCompleta {
  return { ...resumoDaVersao(v, nomes), prompt: v.prompt ?? '', ajustes: v.settings ?? {}, modelo: v.model ?? null };
}

const comoFalha = (erro: unknown, contexto: string) =>
  traduzirErroDoBanco({ message: erro instanceof Error ? erro.message : String(erro) }, contexto);

export async function listarAgentes(
  c: Clientes,
  tenantId: string,
): Promise<Resultado<{ cliente: { id: string; nome: string }; agentes: AgenteNaLista[] }>> {
  try {
    const cliente = await lerCliente(c.admin, tenantId);
    if (!cliente) return falha(404, 'CLIENTE_INEXISTENTE', 'Cliente não encontrado.');
    const agentes = await c.usuario
      .from('ai_agents')
      .select(CAMPOS_DO_AGENTE)
      .eq('organization_id', tenantId)
      .order('created_at', { ascending: true });
    if (agentes.error) return traduzirErroDoBanco(agentes.error, 'listar agentes');
    const linhas = (agentes.data ?? []) as LinhaDoAgente[];
    const publicadas = linhas.map((a) => a.published_version_id).filter((id): id is string => Boolean(id));
    let versoes: LinhaDaVersao[] = [];
    if (publicadas.length > 0) {
      const lidas = await c.usuario
        .from('ai_agent_versions')
        .select(`${CAMPOS_DA_VERSAO}, prompt`)
        .eq('organization_id', tenantId)
        .in('id', publicadas);
      if (lidas.error) return traduzirErroDoBanco(lidas.error, 'listar versoes publicadas');
      versoes = (lidas.data ?? []) as LinhaDaVersao[];
    }
    const porId = new Map(versoes.map((v) => [v.id, v]));
    const [nomes, numeros] = await Promise.all([
      nomesDasPessoas(c.admin, versoes.map((v) => v.published_by)),
      numerosDosAgentes(c.admin, tenantId, linhas.map((a) => a.id)),
    ]);
    return {
      ok: true,
      dados: {
        cliente,
        agentes: linhas.map((a) => {
          const publicada = a.published_version_id ? porId.get(a.published_version_id) ?? null : null;
          const rascunho = promptDoRascunho(a.draft);
          return {
            id: a.id,
            nome: a.name,
            publicada: publicada ? resumoDaVersao(publicada, nomes) : null,
            rascunhoPendente: rascunho !== null && rascunho !== (publicada?.prompt ?? null),
            numeros: numeros.get(a.id) ?? [],
          };
        }),
      },
    };
  } catch (erro) {
    return comoFalha(erro, 'listar agentes');
  }
}

export async function lerAgente(c: Clientes, tenantId: string, agentId: string): Promise<Resultado<AgenteNoEditor>> {
  try {
    const cliente = await lerCliente(c.admin, tenantId);
    if (!cliente) return falha(404, 'CLIENTE_INEXISTENTE', 'Cliente não encontrado.');
    const lido = await c.usuario
      .from('ai_agents')
      .select(CAMPOS_DO_AGENTE)
      .eq('organization_id', tenantId)
      .eq('id', agentId)
      .maybeSingle();
    if (lido.error) return traduzirErroDoBanco(lido.error, 'ler agente');
    if (!lido.data) return traduzirErroDoBanco({ message: 'agente_inexistente' }, 'ler agente');
    const agente = lido.data as LinhaDoAgente;
    let publicada: LinhaDaVersao | null = null;
    if (agente.published_version_id) {
      const versao = await c.usuario
        .from('ai_agent_versions')
        .select(CAMPOS_DA_VERSAO_COMPLETA)
        .eq('organization_id', tenantId)
        .eq('agent_id', agentId)
        .eq('id', agente.published_version_id)
        .maybeSingle();
      if (versao.error) return traduzirErroDoBanco(versao.error, 'ler versao publicada');
      publicada = (versao.data as LinhaDaVersao | null) ?? null;
    }
    const [nomes, numeros] = await Promise.all([
      nomesDasPessoas(c.admin, [publicada?.published_by ?? null, agente.draft_updated_by]),
      numerosDosAgentes(c.admin, tenantId, [agentId]),
    ]);
    return {
      ok: true,
      dados: {
        id: agente.id,
        nome: agente.name,
        cliente,
        publicada: publicada ? versaoCompleta(publicada, nomes) : null,
        rascunho: {
          prompt: promptDoRascunho(agente.draft),
          revisao: agente.draft_revision,
          atualizadoEm: agente.draft_updated_at,
          atualizadoPor: agente.draft_updated_by ? nomes.get(agente.draft_updated_by) ?? ALGUEM : null,
        },
        numeros: numeros.get(agentId) ?? [],
      },
    };
  } catch (erro) {
    return comoFalha(erro, 'ler agente');
  }
}

async function agenteExiste(c: Clientes, tenantId: string, agentId: string): Promise<Falha | null> {
  const lido = await c.usuario.from('ai_agents').select('id').eq('organization_id', tenantId).eq('id', agentId).maybeSingle();
  if (lido.error) return traduzirErroDoBanco(lido.error, 'conferir agente');
  return lido.data ? null : traduzirErroDoBanco({ message: 'agente_inexistente' }, 'conferir agente');
}

export const VERSOES_POR_PAGINA = 50;

/**
 * Uma página do histórico, da mais nova para a mais antiga. `antesDe` traz as versões de número menor que ele (a
 * página seguinte); sem ele, a primeira. A tela pede mais enquanto `temMais` for verdadeiro: qualquer versão do
 * agente continua comparável e restaurável, por mais longo que o histórico fique (SPEC: "quaisquer duas").
 */
export async function listarVersoes(
  c: Clientes,
  tenantId: string,
  agentId: string,
  pagina: { antesDe?: number; limite?: number } = {},
): Promise<Resultado<PaginaDeVersoes>> {
  try {
    const naoExiste = await agenteExiste(c, tenantId, agentId);
    if (naoExiste) return naoExiste;
    const limite = Math.min(Math.max(pagina.limite ?? VERSOES_POR_PAGINA, 1), 100);
    let consulta = c.usuario
      .from('ai_agent_versions')
      .select(CAMPOS_DA_VERSAO)
      .eq('organization_id', tenantId)
      .eq('agent_id', agentId);
    if (pagina.antesDe !== undefined) consulta = consulta.lt('version', pagina.antesDe);
    // Um a mais que o limite: é assim que se sabe se existe a página seguinte.
    const lidas = await consulta.order('version', { ascending: false }).limit(limite + 1);
    if (lidas.error) return traduzirErroDoBanco(lidas.error, 'listar versoes');
    const linhas = (lidas.data ?? []) as LinhaDaVersao[];
    const versoes = linhas.slice(0, limite);
    const nomes = await nomesDasPessoas(c.admin, versoes.map((v) => v.published_by));
    return {
      ok: true,
      dados: { versoes: versoes.map((v) => resumoDaVersao(v, nomes)), temMais: linhas.length > limite },
    };
  } catch (erro) {
    return comoFalha(erro, 'listar versoes');
  }
}

export async function lerVersao(c: Clientes, tenantId: string, agentId: string, versao: number): Promise<Resultado<VersaoCompleta>> {
  try {
    const lida = await c.usuario
      .from('ai_agent_versions')
      .select(CAMPOS_DA_VERSAO_COMPLETA)
      .eq('organization_id', tenantId)
      .eq('agent_id', agentId)
      .eq('version', versao)
      .maybeSingle();
    if (lida.error) return traduzirErroDoBanco(lida.error, 'ler versao');
    if (!lida.data) return traduzirErroDoBanco({ message: 'versao_inexistente' }, 'ler versao');
    const linha = lida.data as LinhaDaVersao;
    const nomes = await nomesDasPessoas(c.admin, [linha.published_by]);
    return { ok: true, dados: versaoCompleta(linha, nomes) };
  } catch (erro) {
    return comoFalha(erro, 'ler versao');
  }
}

export async function salvarRascunho(
  c: Clientes,
  p: { tenantId: string; agentId: string; revisao: number; prompt: string },
): Promise<Resultado<{ revisao: number }>> {
  const r = await c.usuario.rpc('save_ai_agent_draft', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_expected_revision: p.revisao,
    p_prompt: p.prompt,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'salvar rascunho');
  if (typeof r.data !== 'number') return traduzirErroDoBanco({ message: 'salvar rascunho sem revisao de volta' }, 'salvar rascunho');
  return { ok: true, dados: { revisao: r.data } };
}

type LinhaDeVolta = { out_version?: number; out_version_id?: string; out_draft_revision?: number } | null;
const primeiraLinha = (data: unknown): LinhaDeVolta => (Array.isArray(data) ? data[0] ?? null : (data as LinhaDeVolta));

/**
 * Publica o rascunho GRAVADO. Confere revisão e versão contra o que a tela mostrou (409 cedo), roda a verificação
 * ao vivo de novo (erro = 422; aviso não confirmado = 422 com a verificação, para a tela pedir a confirmação) e só então
 * chama a função, que trava a linha e confere tudo de novo: o que foi publicado é o que foi verificado.
 */
export async function publicarComVerificacao(
  c: Clientes,
  p: { tenantId: string; agentId: string; versaoEsperada: number; revisao: number; nota: string | null; confirmarAvisos: string[] },
): Promise<Resultado<{ versao: number; versaoId: string }>> {
  const lido = await lerAgente(c, p.tenantId, p.agentId);
  if (!lido.ok) return lido;
  const agente = lido.dados;
  if (agente.rascunho.revisao !== p.revisao) return traduzirErroDoBanco({ message: 'rascunho_mudou' }, 'publicar');
  if ((agente.publicada?.versao ?? 0) !== p.versaoEsperada) return traduzirErroDoBanco({ message: 'versao_publicada_mudou' }, 'publicar');
  if (agente.rascunho.prompt === null) return traduzirErroDoBanco({ message: 'rascunho_vazio' }, 'publicar');

  const verificacao = verificarPrompt({
    rascunho: agente.rascunho.prompt,
    publicado: agente.publicada?.prompt ?? null,
    numerosLigadosComAgenda: agente.numeros.filter((n) => n.temAgenda).length,
  });
  if (verificacao.erros.length > 0) {
    return falha(422, 'VERIFICACAO_BLOQUEIA', 'A verificação encontrou erro no rascunho. Corrija antes de publicar.', { verificacao });
  }
  if (avisosNaoConfirmados(verificacao, p.confirmarAvisos).length > 0) {
    return falha(422, 'AVISOS_NAO_CONFIRMADOS', 'Confirme os avisos da verificação antes de publicar.', { verificacao });
  }

  const r = await c.usuario.rpc('publish_ai_agent_version', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_expected_version: p.versaoEsperada,
    p_expected_revision: p.revisao,
    p_note: p.nota,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'publicar');
  const linha = primeiraLinha(r.data);
  if (!linha?.out_version || !linha.out_version_id) return traduzirErroDoBanco({ message: 'publicar sem linha de volta' }, 'publicar');
  return { ok: true, dados: { versao: linha.out_version, versaoId: linha.out_version_id } };
}

export async function restaurarVersao(
  c: Clientes,
  p: { tenantId: string; agentId: string; versao: number; versaoEsperada: number; revisao: number; nota: string | null },
): Promise<Resultado<{ versao: number; versaoId: string; revisao: number }>> {
  const r = await c.usuario.rpc('restore_ai_agent_version', {
    p_organization_id: p.tenantId,
    p_agent_id: p.agentId,
    p_version: p.versao,
    p_expected_version: p.versaoEsperada,
    p_expected_revision: p.revisao,
    p_note: p.nota,
  });
  if (r.error) return traduzirErroDoBanco(r.error, 'restaurar');
  const linha = primeiraLinha(r.data);
  if (!linha?.out_version || !linha.out_version_id || typeof linha.out_draft_revision !== 'number') {
    return traduzirErroDoBanco({ message: 'restaurar sem linha de volta' }, 'restaurar');
  }
  return { ok: true, dados: { versao: linha.out_version, versaoId: linha.out_version_id, revisao: linha.out_draft_revision } };
}
```

- [ ] **Step 5: Rodar o teste de unidade e ver passar**

Run: `npx vitest run lib/agents/editorAgentes.test.ts`
Expected: PASS (23 testes: 13 de tradução, 1 de histórico, 2 de leitura, 5 de publicar, 2 de salvar e restaurar).

- [ ] **Step 6: Acrescentar ao teste local as provas com banco de verdade**

Em `test/centralAgentesEditor.local.test.ts`:

1. Trocar a linha de import dos ajudantes por esta (acrescenta `requireSupabaseData`) e acrescentar a importação da camada de servidor logo abaixo:

```ts
import { assertNoSupabaseError, getSupabaseAdminClient, requireSupabaseData } from './helpers/supabaseAdmin';
import { lerAgente, listarAgentes, publicarComVerificacao, salvarRascunho } from '@/lib/agents/editorAgentes';
```

2. Logo depois de `const BASE = ...`, acrescentar:

```ts
/** Agenda válida para ConversationCalendarConfigSchema (lib/conversations/meetingAvailability.ts). */
const AGENDA_LIGADA = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  ownerId: '33333333-3333-4333-8333-333333333333',
  minimumNoticeMinutes: 60,
  schedulingHorizonDays: 7,
  humanConfirmationWeekdays: ['saturday'],
  weeklyHours: { monday: [{ start: '09:00', end: '18:00' }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
};
```

3. Antes do `});` que fecha o `describeLocal`, acrescentar:

```ts
  it('servidor: lista e lê o agente com a versão publicada, o rascunho e os números, sem a config do número', async () => {
    const admin = getSupabaseAdminClient();
    const { agente, v1 } = await novoAgente(orgA, 'servidor');
    const conexao = requireSupabaseData(await admin
      .from('channel_connections')
      .insert({
        organization_id: orgA,
        provider: 'evolution',
        channel_type: 'whatsapp',
        name: `Numero ${runId}`,
        config: { apiKey: 'NAO-PODE-SAIR', calendar: AGENDA_LIGADA },
        ai_agent_id: agente,
      })
      .select('id')
      .single(), 'insert conexao ligada').id as string;
    const clientes = { usuario: agencia, admin };

    const lista = await listarAgentes(clientes, orgA);
    if (!lista.ok) throw new Error(lista.erro);
    expect(lista.dados.agentes.find((a) => a.id === agente)).toMatchObject({
      nome: 'Aurora',
      rascunhoPendente: false,
      publicada: { versao: 1, origem: 'migration', publicadaPor: null },
      numeros: [{ id: conexao, nome: `Numero ${runId}`, temAgenda: true }],
    });
    expect(JSON.stringify(lista)).not.toContain('NAO-PODE-SAIR');

    const lido = await lerAgente(clientes, orgA, agente);
    if (!lido.ok) throw new Error(lido.erro);
    expect(lido.dados.publicada?.prompt).toBe(v1);
    expect(lido.dados.rascunho).toEqual({ prompt: null, revisao: 0, atualizadoEm: null, atualizadoPor: null });
    expect(JSON.stringify(lido)).not.toContain('NAO-PODE-SAIR');

    // Agente de A pedido como se fosse de B (G4).
    expect(await lerAgente(clientes, orgB, agente)).toMatchObject({ ok: false, status: 404 });
  });

  it('servidor: publicar verifica o rascunho gravado, pede a confirmação do aviso e publica a mesma revisão', async () => {
    const admin = getSupabaseAdminClient();
    const { agente } = await novoAgente(orgA, 'servidor publicar');
    const clientes = { usuario: agencia, admin };
    // A v1 tem {{contactName}}; o rascunho tira.
    const texto = 'Voce e a Aurora.\n{{recentMessagesText}}';
    expect(await salvarRascunho(clientes, { tenantId: orgA, agentId: agente, revisao: 0, prompt: texto })).toEqual({ ok: true, dados: { revisao: 1 } });

    const listada = await listarAgentes(clientes, orgA);
    if (!listada.ok) throw new Error(listada.erro);
    expect(listada.dados.agentes.find((a) => a.id === agente)?.rascunhoPendente).toBe(true);

    const semConfirmar = await publicarComVerificacao(clientes, { tenantId: orgA, agentId: agente, versaoEsperada: 1, revisao: 1, nota: null, confirmarAvisos: [] });
    expect(semConfirmar).toMatchObject({ ok: false, status: 422, codigo: 'AVISOS_NAO_CONFIRMADOS' });

    const confirmado = await publicarComVerificacao(clientes, {
      tenantId: orgA, agentId: agente, versaoEsperada: 1, revisao: 1, nota: 'tirei o nome', confirmarAvisos: ['perdeu:contactName'],
    });
    expect(confirmado).toMatchObject({ ok: true, dados: { versao: 2 } });

    const lido = await lerAgente(clientes, orgA, agente);
    if (!lido.ok) throw new Error(lido.erro);
    expect(lido.dados.publicada).toMatchObject({ versao: 2, origem: 'publish', nota: 'tirei o nome', prompt: texto });
    expect(lido.dados.publicada?.publicadaPor).toEqual(expect.any(String));
  });
```

- [ ] **Step 7: Rodar o teste local inteiro**

Run: `npm run test:local -- test/centralAgentesEditor.local.test.ts`
Expected: PASS (11 testes: os 9 da Task 2 e os 2 da camada de servidor).

- [ ] **Step 8: Commit**

```bash
git add lib/agents/tiposDoEditor.ts lib/agents/editorAgentes.ts lib/agents/editorAgentes.test.ts test/centralAgentesEditor.local.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): camada de servidor do editor (le pela RLS, publica com verificacao no rascunho gravado, traduz erros do banco)"
```

---

### Task 5: Rotas de API (só agência, corpo estrito, 409 e 422 com nome)

**Files:**
- Create: `lib/agents/rotaDoEditor.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/draft/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/publish/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/restore/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/versions/route.ts`
- Create: `app/api/platform/tenants/[tenantId]/agents/[agentId]/versions/[version]/route.ts`
- Test: `app/api/platform/tenants/[tenantId]/agents/route.test.ts`
- Test: `lib/platform/tenantAccess.adminOnly.test.ts` (nenhum teste do repositório cobria `adminOnly`; as rotas desta fatia são as primeiras a usá-lo)

| Método e caminho (`/api/platform/tenants/[tenantId]/agents/...`) | Corpo (zod `.strict()`) | Resposta |
|---|---|---|
| `GET` (raiz) | — | `{ cliente, agentes }` |
| `GET [agentId]` | — | `{ agente }` |
| `PUT [agentId]/draft` | `{ prompt, revisao }` | `{ revisao }`; 409 `RASCUNHO_MUDOU` |
| `POST [agentId]/publish` | `{ versaoEsperada, revisao, nota?, confirmarAvisos? }` | `{ versao, versaoId }`; 409; 422 com `verificacao` |
| `POST [agentId]/restore` | `{ versao, versaoEsperada, revisao, nota? }` | `{ versao, versaoId, revisao }`; 409; 422 |
| `GET [agentId]/versions` | consulta `?antesDe=N` opcional (estrita) | `{ versoes, temMais }`, 50 por página, da mais nova para a mais antiga |
| `GET [agentId]/versions/[version]` | — | `{ versao }` |

Regras que valem para as sete: ids do endereço conferidos como UUID (400 antes de qualquer leitura); `requireTenantAccess(tenantId, { adminOnly: true })` (agency_admin e o legado admin; `agency_staff` e o cliente recebem 403); as que escrevem conferem a origem (`isAllowedOrigin`, padrão do repositório); erro sai como `{ error, code }`. Os esquemas ficam em `lib/` e não no `route.ts`: o Next valida os nomes exportados por um arquivo de rota.

- [ ] **Step 1: Escrever o teste que falha**

Criar `app/api/platform/tenants/[tenantId]/agents/route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const USUARIO = { papel: 'usuario' };
const ADMIN = { papel: 'admin' };
const CLIENTES = { usuario: USUARIO, admin: ADMIN };

const mocks = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(),
  isAllowedOrigin: vi.fn(),
  listarAgentes: vi.fn(),
  lerAgente: vi.fn(),
  listarVersoes: vi.fn(),
  lerVersao: vi.fn(),
  salvarRascunho: vi.fn(),
  publicarComVerificacao: vi.fn(),
  restaurarVersao: vi.fn(),
}));

vi.mock('@/lib/platform/tenantAccess', () => ({ requireTenantAccess: mocks.requireTenantAccess }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: mocks.isAllowedOrigin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => USUARIO,
  createStaticAdminClient: () => ADMIN,
}));
vi.mock('@/lib/agents/editorAgentes', () => ({
  listarAgentes: mocks.listarAgentes,
  lerAgente: mocks.lerAgente,
  listarVersoes: mocks.listarVersoes,
  lerVersao: mocks.lerVersao,
  salvarRascunho: mocks.salvarRascunho,
  publicarComVerificacao: mocks.publicarComVerificacao,
  restaurarVersao: mocks.restaurarVersao,
}));

import { GET as listar } from './route';
import { GET as ler } from './[agentId]/route';
import { PUT as salvar } from './[agentId]/draft/route';
import { POST as publicar } from './[agentId]/publish/route';
import { POST as restaurar } from './[agentId]/restore/route';
import { GET as versoes } from './[agentId]/versions/route';
import { GET as versao } from './[agentId]/versions/[version]/route';

function pedir(metodo: string, corpo?: unknown) {
  return new Request('http://localhost/api/platform/tenants/x/agents', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    ...(corpo === undefined ? {} : { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }),
  });
}
const doCliente = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) });
const doAgente = (agentId = AGENTE) => ({ params: Promise.resolve({ tenantId: TENANT, agentId }) });
const daVersao = (version: string) => ({ params: Promise.resolve({ tenantId: TENANT, agentId: AGENTE, version }) });

const todas = () => [
  { nome: 'listar', chamar: () => listar(pedir('GET'), doCliente()), lib: mocks.listarAgentes },
  { nome: 'ler', chamar: () => ler(pedir('GET'), doAgente()), lib: mocks.lerAgente },
  { nome: 'salvar', chamar: () => salvar(pedir('PUT', { prompt: 'x', revisao: 0 }), doAgente()), lib: mocks.salvarRascunho },
  { nome: 'publicar', chamar: () => publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente()), lib: mocks.publicarComVerificacao },
  { nome: 'restaurar', chamar: () => restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1 }), doAgente()), lib: mocks.restaurarVersao },
  { nome: 'versoes', chamar: () => versoes(pedir('GET'), doAgente()), lib: mocks.listarVersoes },
  { nome: 'versao', chamar: () => versao(pedir('GET'), daVersao('1')), lib: mocks.lerVersao },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAllowedOrigin.mockReturnValue(true);
  mocks.requireTenantAccess.mockResolvedValue({ profile: { id: 'p1', role: 'agency_admin', organization_id: 'org-agencia' } });
  for (const fn of [mocks.listarAgentes, mocks.lerAgente, mocks.listarVersoes, mocks.lerVersao, mocks.salvarRascunho, mocks.publicarComVerificacao, mocks.restaurarVersao]) {
    fn.mockResolvedValue({ ok: true, dados: { lido: true } });
  }
});

describe('rotas da Central de Agentes', () => {
  it('todas pedem agência (adminOnly): o admin do cliente recebe 403 e nada é lido nem escrito', async () => {
    mocks.requireTenantAccess.mockResolvedValue({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    for (const c of todas()) {
      const r = await c.chamar();
      expect(r.status, c.nome).toBe(403);
      expect(c.lib, c.nome).not.toHaveBeenCalled();
    }
    expect(mocks.requireTenantAccess).toHaveBeenCalledTimes(7);
    for (const chamada of mocks.requireTenantAccess.mock.calls) expect(chamada).toEqual([TENANT, { adminOnly: true }]);
  });

  it('id inválido no endereço: 400 antes de qualquer acesso', async () => {
    expect((await listar(pedir('GET'), doCliente('abc'))).status).toBe(400);
    expect((await ler(pedir('GET'), doAgente('abc'))).status).toBe(400);
    expect((await salvar(pedir('PUT', { prompt: 'x', revisao: 0 }), doAgente('../x'))).status).toBe(400);
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
  });

  it('escrita de outra origem: 403; leitura não depende da origem', async () => {
    mocks.isAllowedOrigin.mockReturnValue(false);
    for (const c of todas().filter((t) => ['salvar', 'publicar', 'restaurar'].includes(t.nome))) {
      expect((await c.chamar()).status, c.nome).toBe(403);
      expect(c.lib, c.nome).not.toHaveBeenCalled();
    }
    expect((await listar(pedir('GET'), doCliente())).status).toBe(200);
  });

  it('campo fora da lista, tipo errado ou corpo ilegível: 400, e nada é escrito', async () => {
    const casos: Array<[string, Promise<Response>]> = [
      ['salvar com autor', salvar(pedir('PUT', { prompt: 'x', revisao: 0, autor: 'eu' }), doAgente())],
      ['salvar vazio', salvar(pedir('PUT', { prompt: '', revisao: 0 }), doAgente())],
      ['salvar revisao negativa', salvar(pedir('PUT', { prompt: 'x', revisao: -1 }), doAgente())],
      ['salvar sem json', salvar(pedir('PUT', 'nao e json'), doAgente())],
      ['salvar acima do teto', salvar(pedir('PUT', { prompt: 'x'.repeat(50_001), revisao: 0 }), doAgente())],
      ['publicar com publishedBy', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, publishedBy: 'x' }), doAgente())],
      // G5/G19: nesta fatia o publicar não recebe ajustes nem modelo (a versão nova copia os da publicada);
      // a fatia 4 abre esses campos com lista fechada de chaves. Até lá, mandar qualquer um é 400.
      ['publicar com settings', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, settings: { temperatura: 2 } }), doAgente())],
      ['publicar com model', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, model: 'outro-modelo' }), doAgente())],
      ['publicar nota longa', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, nota: 'n'.repeat(201) }), doAgente())],
      ['restaurar com extra', restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1, extra: true }), doAgente())],
      ['restaurar versao 0', restaurar(pedir('POST', { versao: 0, versaoEsperada: 2, revisao: 1 }), doAgente())],
    ];
    for (const [nome, resposta] of casos) expect((await resposta).status, nome).toBe(400);
    expect(mocks.salvarRascunho).not.toHaveBeenCalled();
    expect(mocks.publicarComVerificacao).not.toHaveBeenCalled();
    expect(mocks.restaurarVersao).not.toHaveBeenCalled();
  });

  it('salvar usa o cliente do usuário e devolve a revisão; o 409 do banco passa com código e mensagem', async () => {
    mocks.salvarRascunho.mockResolvedValueOnce({ ok: true, dados: { revisao: 1 } });
    const ok = await salvar(pedir('PUT', { prompt: 'texto', revisao: 0 }), doAgente());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revisao: 1 });
    expect(mocks.salvarRascunho).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, revisao: 0, prompt: 'texto' });

    mocks.salvarRascunho.mockResolvedValueOnce({ ok: false, status: 409, codigo: 'RASCUNHO_MUDOU', erro: 'O rascunho foi alterado.' });
    const conflito = await salvar(pedir('PUT', { prompt: 'texto', revisao: 0 }), doAgente());
    expect(conflito.status).toBe(409);
    expect(await conflito.json()).toEqual({ error: 'O rascunho foi alterado.', code: 'RASCUNHO_MUDOU' });
  });

  it('publicar repassa nota aparada e avisos confirmados; o 422 devolve a verificação para a tela', async () => {
    await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, nota: '  abertura nova  ', confirmarAvisos: ['tamanho'] }), doAgente());
    expect(mocks.publicarComVerificacao).toHaveBeenLastCalledWith(CLIENTES, {
      tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: 'abertura nova', confirmarAvisos: ['tamanho'],
    });
    await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(mocks.publicarComVerificacao).toHaveBeenLastCalledWith(CLIENTES, {
      tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: null, confirmarAvisos: [],
    });

    const verificacao = { erros: [], avisos: [{ codigo: 'tamanho', nivel: 'aviso', mensagem: 'grande' }], informacoes: [] };
    mocks.publicarComVerificacao.mockResolvedValueOnce({ ok: false, status: 422, codigo: 'AVISOS_NAO_CONFIRMADOS', erro: 'Confirme.', verificacao });
    const r = await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Confirme.', code: 'AVISOS_NAO_CONFIRMADOS', verificacao });

    // O 409 ao PUBLICAR (outra versão saiu no meio) passa com código e mensagem, como o do salvar.
    mocks.publicarComVerificacao.mockResolvedValueOnce({
      ok: false, status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU', erro: 'Outra versão foi publicada enquanto você editava.',
    });
    const conflito = await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(conflito.status).toBe(409);
    expect(await conflito.json()).toEqual({ error: 'Outra versão foi publicada enquanto você editava.', code: 'VERSAO_PUBLICADA_MUDOU' });
  });

  it('restaurar repassa versão, versão esperada e revisão', async () => {
    mocks.restaurarVersao.mockResolvedValueOnce({ ok: true, dados: { versao: 3, versaoId: 'v3', revisao: 2 } });
    const r = await restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1, nota: 'voltar' }), doAgente());
    expect(await r.json()).toEqual({ versao: 3, versaoId: 'v3', revisao: 2 });
    expect(mocks.restaurarVersao).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, versao: 1, versaoEsperada: 2, revisao: 1, nota: 'voltar' });
  });

  it('leituras devolvem o que a camada leu, no formato da tela; número de versão inválido é 400', async () => {
    expect(await (await listar(pedir('GET'), doCliente())).json()).toEqual({ lido: true });
    expect(await (await ler(pedir('GET'), doAgente())).json()).toEqual({ agente: { lido: true } });
    expect(await (await versoes(pedir('GET'), doAgente())).json()).toEqual({ lido: true });
    expect(mocks.listarVersoes).toHaveBeenLastCalledWith(CLIENTES, TENANT, AGENTE, { antesDe: undefined });
    const paginaSeguinte = new Request('http://localhost/api/platform/tenants/x/agents/y/versions?antesDe=6');
    expect((await versoes(paginaSeguinte, doAgente())).status).toBe(200);
    expect(mocks.listarVersoes).toHaveBeenLastCalledWith(CLIENTES, TENANT, AGENTE, { antesDe: 6 });
    for (const consulta of ['antesDe=abc', 'antesDe=0', 'limite=500']) {
      const r = await versoes(new Request(`http://localhost/api/platform/tenants/x/agents/y/versions?${consulta}`), doAgente());
      expect(r.status, consulta).toBe(400);
    }
    expect(await (await versao(pedir('GET'), daVersao('2'))).json()).toEqual({ versao: { lido: true } });
    expect(mocks.lerVersao).toHaveBeenCalledWith(CLIENTES, TENANT, AGENTE, 2);

    expect((await versao(pedir('GET'), daVersao('abc'))).status).toBe(400);
    expect((await versao(pedir('GET'), daVersao('1.5'))).status).toBe(400);
    expect(mocks.lerVersao).toHaveBeenCalledTimes(1);
  });
});
```

Criar `lib/platform/tenantAccess.adminOnly.test.ts` (prova o elo que o teste das rotas simula: com `adminOnly`, quem pertence ao cliente mas não é agência recebe 403):

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ role: 'clinic_admin', org: 'org-a' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        single: async () => ({ data: { id: 'u1', role: estado.role, organization_id: estado.org }, error: null }),
      };
      return consulta;
    },
  }),
}));
vi.mock('@/lib/auth/permissions.server', () => ({ loadPermissionOverrides: async () => ({}) }));

import { requireTenantAccess } from './tenantAccess';

describe('requireTenantAccess com adminOnly', () => {
  it.each(['clinic_admin', 'clinic_staff', 'agency_staff'])('%s do próprio cliente recebe 403', async (role) => {
    estado.role = role;
    estado.org = 'org-a';
    const r = await requireTenantAccess('org-a', { adminOnly: true });
    expect('error' in r ? r.error.status : 200).toBe(403);
  });

  it.each(['agency_admin', 'admin'])('%s entra em qualquer cliente', async (role) => {
    estado.role = role;
    estado.org = 'org-agencia';
    const r = await requireTenantAccess('org-a', { adminOnly: true });
    expect('error' in r).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/api/platform/tenants/[tenantId]/agents/route.test.ts" lib/platform/tenantAccess.adminOnly.test.ts`
Expected: o das rotas FAIL com `Failed to resolve import "./route"`; o de `tenantAccess` já PASSA (5 testes): ele trava o comportamento de hoje, do qual as rotas novas dependem. Medido em 07/10 sobre `6a29238`: 5 passam; trocando a linha `if (options.adminOnly && !isPlatformAdmin)` por `if (false && ...)`, os três casos de 403 falham e os dois de agência continuam passando. O teste pega a regressão que importa.

- [ ] **Step 3: Implementar a porta comum `lib/agents/rotaDoEditor.ts`**

```ts
import 'server-only';
import { z } from 'zod';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import type { Clientes, Falha } from './editorAgentes';

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const Uuid = z.string().uuid();
export const NumeroDaVersao = z.coerce.number().int().min(1).max(1_000_000);

/** Consulta do histórico (G5/G19): só `antesDe`, para pedir a página seguinte; outro parâmetro é 400. */
export const ConsultaDoHistorico = z.object({ antesDe: NumeroDaVersao.optional() }).strict();

/** Corpos aceitos (G5/G19): campo fora da lista é 400, nunca ignorado. O autor nunca vem do corpo. */
export const RascunhoSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  revisao: z.number().int().min(0),
}).strict();

export const PublicarSchema = z.object({
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
  confirmarAvisos: z.array(z.string().min(1).max(120)).max(50).optional(),
}).strict();

export const RestaurarSchema = z.object({
  versao: z.number().int().min(1),
  versaoEsperada: z.number().int().min(0),
  revisao: z.number().int().min(0),
  nota: z.string().max(200).optional(),
}).strict();

type Recusa = { ok: false; resposta: Response };
const recusa = (body: unknown, status: number): Recusa => ({ ok: false, resposta: json(body, status) });

/**
 * Porta das rotas da Central de Agentes (G3). Na ordem: origem (só nas que escrevem), id do cliente válido,
 * requireTenantAccess com adminOnly (agency_admin e o legado admin; agency_staff e o cliente recebem 403) e os dois
 * clientes do Supabase: o do usuário (JWT) para ler pela RLS e escrever pelas funções, e o de serviço só para leitura.
 */
export async function abrirRotaDoCliente(
  req: Request,
  params: { tenantId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; clientes: Clientes } | Recusa> {
  if (opcoes.escreve && !isAllowedOrigin(req)) return recusa({ error: 'Forbidden' }, 403);
  if (!Uuid.safeParse(params.tenantId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const auth = await requireTenantAccess(params.tenantId, { adminOnly: true });
  if ('error' in auth) return { ok: false, resposta: auth.error };
  return { ok: true, tenantId: params.tenantId, clientes: { usuario: await createClient(), admin: createStaticAdminClient() } };
}

export async function abrirRotaDoAgente(
  req: Request,
  params: { tenantId: string; agentId: string },
  opcoes: { escreve: boolean },
): Promise<{ ok: true; tenantId: string; agentId: string; clientes: Clientes } | Recusa> {
  if (!Uuid.safeParse(params.agentId).success) return recusa({ error: 'Endereço inválido.' }, 400);
  const aberta = await abrirRotaDoCliente(req, params, opcoes);
  if (!aberta.ok) return aberta;
  return { ...aberta, agentId: params.agentId };
}

export async function lerCorpo<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; corpo: T } | Recusa> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recusa({ error: 'Pedido inválido.', details: parsed.error.flatten() }, 400);
  return { ok: true, corpo: parsed.data };
}

export function responderFalha(f: Falha) {
  return json({ error: f.erro, code: f.codigo, ...(f.verificacao ? { verificacao: f.verificacao } : {}) }, f.status);
}
```

- [ ] **Step 4: Criar as sete rotas**

`app/api/platform/tenants/[tenantId]/agents/route.ts`:

```ts
import { listarAgentes } from '@/lib/agents/editorAgentes';
import { abrirRotaDoCliente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Central de Agentes, fatia 2: os agentes do cliente. Só agência. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const aberta = await abrirRotaDoCliente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const r = await listarAgentes(aberta.clientes, aberta.tenantId);
  return r.ok ? json(r.dados) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/route.ts`:

```ts
import { lerAgente } from '@/lib/agents/editorAgentes';
import { abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** O agente para o editor: versão publicada completa, rascunho e números ligados (sem a config deles). */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const r = await lerAgente(aberta.clientes, aberta.tenantId, aberta.agentId);
  return r.ok ? json({ agente: r.dados }) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/draft/route.ts`:

```ts
import { salvarRascunho } from '@/lib/agents/editorAgentes';
import { RascunhoSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Salva o rascunho com a revisão que a tela leu; se outra aba salvou antes, 409 em vez de sobrescrever. */
export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, RascunhoSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await salvarRascunho(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    revisao: corpo.corpo.revisao,
    prompt: corpo.corpo.prompt,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/publish/route.ts`:

```ts
import { publicarComVerificacao } from '@/lib/agents/editorAgentes';
import { PublicarSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/**
 * Publica o rascunho gravado como versão N+1. A verificação ao vivo roda de novo aqui; aviso só passa confirmado
 * (422 com a verificação). Versão publicada ou revisão diferentes das que a tela mostrou: 409, e a tela recarrega.
 */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, PublicarSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await publicarComVerificacao(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    versaoEsperada: corpo.corpo.versaoEsperada,
    revisao: corpo.corpo.revisao,
    nota: corpo.corpo.nota?.trim() || null,
    confirmarAvisos: corpo.corpo.confirmarAvisos ?? [],
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/restore/route.ts`:

```ts
import { restaurarVersao } from '@/lib/agents/editorAgentes';
import { RestaurarSchema, abrirRotaDoAgente, json, lerCorpo, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Restaura: publica o conteúdo da versão escolhida como versão nova e traz o texto dela para o rascunho. */
export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: true });
  if (!aberta.ok) return aberta.resposta;
  const corpo = await lerCorpo(req, RestaurarSchema);
  if (!corpo.ok) return corpo.resposta;
  const r = await restaurarVersao(aberta.clientes, {
    tenantId: aberta.tenantId,
    agentId: aberta.agentId,
    versao: corpo.corpo.versao,
    versaoEsperada: corpo.corpo.versaoEsperada,
    revisao: corpo.corpo.revisao,
    nota: corpo.corpo.nota?.trim() || null,
  });
  return r.ok ? json(r.dados) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/versions/route.ts`:

```ts
import { listarVersoes } from '@/lib/agents/editorAgentes';
import { ConsultaDoHistorico, abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/**
 * Histórico do agente, uma página por vez, da mais nova para a mais antiga (sem o texto; a comparação lê cada
 * versão). `?antesDe=N` traz a página seguinte. Devolve `{ versoes, temMais }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string }> }) {
  const aberta = await abrirRotaDoAgente(req, await ctx.params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const consulta = ConsultaDoHistorico.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!consulta.success) return json({ error: 'Pedido inválido.' }, 400);
  const r = await listarVersoes(aberta.clientes, aberta.tenantId, aberta.agentId, { antesDe: consulta.data.antesDe });
  return r.ok ? json(r.dados) : responderFalha(r);
}
```

`app/api/platform/tenants/[tenantId]/agents/[agentId]/versions/[version]/route.ts`:

```ts
import { lerVersao } from '@/lib/agents/editorAgentes';
import { NumeroDaVersao, abrirRotaDoAgente, json, responderFalha } from '@/lib/agents/rotaDoEditor';

/** Uma versão inteira (texto, ajustes e modelo), para comparar e restaurar. */
export async function GET(req: Request, ctx: { params: Promise<{ tenantId: string; agentId: string; version: string }> }) {
  const params = await ctx.params;
  const aberta = await abrirRotaDoAgente(req, params, { escreve: false });
  if (!aberta.ok) return aberta.resposta;
  const numero = NumeroDaVersao.safeParse(params.version);
  if (!numero.success) return json({ error: 'Versão inválida.' }, 400);
  const r = await lerVersao(aberta.clientes, aberta.tenantId, aberta.agentId, numero.data);
  return r.ok ? json({ versao: r.dados }) : responderFalha(r);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run "app/api/platform/tenants/[tenantId]/agents/route.test.ts" lib/platform/tenantAccess.adminOnly.test.ts`
Expected: PASS (8 + 5 testes).

Run, em outro comando: `npx tsc --noEmit`
Expected: sem erro. Se o Next reclamar de export em `route.ts` no build da Task 13, conferir que nenhum `route.ts` desta Task exporta outra coisa além do método HTTP.

- [ ] **Step 6: Commit**

```bash
git add lib/agents/rotaDoEditor.ts "app/api/platform/tenants/[tenantId]/agents" lib/platform/tenantAccess.adminOnly.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): rotas de API do editor (so agencia, corpo estrito, 409 e 422 com nome, escrita pelo JWT do usuario)"
```

O `--stat` tem que listar só `lib/agents/rotaDoEditor.ts`, as sete rotas e os dois testes.

---

### Task 6: Tela da lista, rota de tela e item "Agentes" no menu (só para a agência)

**Files:**
- Create: `features/agents/formatos.ts` · Test: `features/agents/formatos.test.ts`
- Create: `features/agents/agentesApi.ts`
- Create: `features/agents/TenantAgentsPage.tsx` · Test: `features/agents/TenantAgentsPage.test.tsx`
- Create: `app/(protected)/platform/tenants/[tenantId]/agents/page.tsx`
- Create: `components/navigation/rotaAtiva.ts` · Test: `components/navigation/rotaAtiva.test.ts`
- Modify: `lib/tenancy/workspaceRoutes.ts` (lista `TENANT_SCOPED_BASE_ROUTES` e a nova `LISTAS_COM_DETALHE`, exportada)
- Modify: `components/navigation/navConfig.ts` (import, `SecondaryNavId`, `getTenantWorkspaceNav`)
- Modify: `components/navigation/usePlatformTenantWorkspaceNav.ts`
- Modify: `components/Layout.tsx:108-111` e `components/navigation/NavigationRail.tsx:26-29` (item aceso na tela de detalhe)
- Test: `components/navigation/navConfig.agentes.test.ts`, `components/navigation/usePlatformTenantWorkspaceNav.agentes.test.tsx`

Três travas para a tela ser só da agência, porque `/platform/tenants/<id>/...` também é navegado por usuário de cliente (o menu escopado é de todos): o item de menu sai só de `isAgencyAdminRole` (nunca das permissões da API), a página mostra `AccessDenied` para os outros papéis e a API devolve 403 (Task 5). Texto de tela sem "clínica" (`test/vocabularioCliente.test.ts`). Botão principal com `text-on-brand` (branco sobre o laranja da marca reprova contraste: `docs/design/tema-cenno.md`, §0, item A). Os componentes de `components/ui/` no padrão shadcn (`Button`, `Card`, `Badge`, `Tabs`) usam cores que o projeto não define; as telas desta fatia usam classes explícitas.

- [ ] **Step 1: Testes que falham — datas, menu e item aceso**

Criar `features/agents/formatos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { descreverVersao, formatarDataHora } from './formatos';

const base = { id: 'v', nota: null, publicadaEm: '2026-10-07T04:51:00Z' };

describe('formatos do editor', () => {
  it('mostra a hora de Brasília, não a UTC do banco', () => {
    expect(formatarDataHora('2026-10-07T04:51:00Z')).toBe('07/10/2026 às 01:51');
    expect(formatarDataHora('2026-10-07T03:05:00Z')).toBe('07/10/2026 às 00:05');
  });

  it('descreve a versão do jeito da SPEC: "Versão N publicada em [data] por [pessoa]"', () => {
    expect(descreverVersao({ ...base, versao: 1, origem: 'migration', restauradaDe: null, publicadaPor: null }))
      .toBe('Versão 1 publicada em 07/10/2026 às 01:51 pela migração');
    expect(descreverVersao({ ...base, versao: 2, origem: 'publish', restauradaDe: null, publicadaPor: 'Junior' }))
      .toBe('Versão 2 publicada em 07/10/2026 às 01:51 por Junior');
    expect(descreverVersao({ ...base, versao: 3, origem: 'restore', restauradaDe: 1, publicadaPor: 'Junior' }))
      .toBe('Versão 3 (restaurada da versão 1) publicada em 07/10/2026 às 01:51 por Junior');
    expect(descreverVersao({ ...base, versao: 4, origem: 'publish', restauradaDe: null, publicadaPor: null }))
      .toBe('Versão 4 publicada em 07/10/2026 às 01:51 por alguém que saiu da equipe');
  });
});
```

Criar `components/navigation/navConfig.agentes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTenantWorkspaceNav } from './navConfig';

describe('item Agentes no menu do cliente', () => {
  it('aparece só com canAccessAgents e aponta para a lista do cliente', () => {
    const sem = getTenantWorkspaceNav({ tenantId: 't1', canAccessConversations: true });
    expect(sem.map((i) => i.id)).not.toContain('tenant_agents');

    const so = getTenantWorkspaceNav({ tenantId: 't1', canAccessAgents: true });
    expect(so).toEqual([expect.objectContaining({ id: 'tenant_agents', label: 'Agentes', href: '/platform/tenants/t1/agents' })]);
  });

  it('fica logo depois de Automações', () => {
    const todos = getTenantWorkspaceNav({
      tenantId: 't1', canAccessAgents: true, canAccessAutomations: true, canAccessConversations: true, canAccessWhatsapp: true,
    });
    expect(todos.map((i) => i.id)).toEqual(['tenant_automations', 'tenant_agents', 'tenant_conversations', 'tenant_whatsapp_connect']);
  });
});
```

Criar `components/navigation/usePlatformTenantWorkspaceNav.agentes.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const TENANT = 'bd43a9bc-5bab-410a-a5a6-c214f3836f0e';
const estado = vi.hoisted(() => ({ role: 'agency_admin' as string }));

vi.mock('next/navigation', () => ({ usePathname: () => `/platform/tenants/${TENANT}/dashboard` }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: estado.role, organization_id: 'org' } }) }));
vi.mock('@/context/TenantContext', () => ({ useTenant: () => ({ tenant: null }) }));
// A API do cliente devolve todas as permissões ligadas: o item de agentes NÃO pode depender delas.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { access: { canAccessWhatsApp: true, canAccessConversations: true, canAccessAutomations: true }, tenant: { id: TENANT, channel_connections: [] } },
    isLoading: false,
  }),
}));

import { usePlatformTenantWorkspaceNav } from './usePlatformTenantWorkspaceNav';

describe('menu do cliente: Agentes só para a agência', () => {
  it.each([
    ['agency_admin', true],
    ['admin', true],
    ['agency_staff', false],
    ['clinic_admin', false],
    ['clinic_staff', false],
  ])('%s: item Agentes = %s, mesmo com todas as permissões da API ligadas', (role, temItem) => {
    estado.role = role;
    const { result } = renderHook(() => usePlatformTenantWorkspaceNav());
    expect(result.current.items.some((i) => i.id === 'tenant_agents')).toBe(temItem);
  });
});
```

Criar `components/navigation/rotaAtiva.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { abreDetalheDoItem } from './rotaAtiva';

describe('item do menu aceso na tela de detalhe', () => {
  const lista = '/platform/tenants/t1/agents';

  it('acende "Agentes" no editor de um agente', () => {
    expect(abreDetalheDoItem('/platform/tenants/t1/agents/a1', lista)).toBe(true);
  });

  it('não acende em caminho que só começa igual, em outra lista nem na própria lista (essa é igualdade exata)', () => {
    expect(abreDetalheDoItem('/platform/tenants/t1/agentsx', lista)).toBe(false);
    expect(abreDetalheDoItem('/platform/tenants/t1/automations/x', '/platform/tenants/t1/automations')).toBe(false);
    expect(abreDetalheDoItem(lista, lista)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run features/agents/formatos.test.ts components/navigation/navConfig.agentes.test.ts components/navigation/usePlatformTenantWorkspaceNav.agentes.test.tsx components/navigation/rotaAtiva.test.ts`
Expected: FAIL (módulos `./formatos` e `./rotaAtiva` inexistentes; `tenant_agents` ausente do menu).

- [ ] **Step 3: Implementar `features/agents/formatos.ts`**

```ts
import type { VersaoResumo } from '@/lib/agents/tiposDoEditor';

/** Data e hora de Brasília, sempre: o banco guarda em UTC. Ex.: "07/10/2026 às 01:51". */
export function formatarDataHora(iso: string): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${partes.day}/${partes.month}/${partes.year} às ${partes.hour}:${partes.minute}`;
}

/** "Versão N publicada em [data] por [pessoa]" (SPEC, fatia 2). */
export function descreverVersao(v: VersaoResumo): string {
  const quem =
    v.origem === 'migration' ? 'pela migração' : v.publicadaPor ? `por ${v.publicadaPor}` : 'por alguém que saiu da equipe';
  const restaurada = v.origem === 'restore' && v.restauradaDe ? ` (restaurada da versão ${v.restauradaDe})` : '';
  return `Versão ${v.versao}${restaurada} publicada em ${formatarDataHora(v.publicadaEm)} ${quem}`;
}
```

- [ ] **Step 4: Implementar `components/navigation/rotaAtiva.ts`**

```ts
import { LISTAS_COM_DETALHE } from '@/lib/tenancy/workspaceRoutes';

/**
 * Telas de detalhe acendem o item da lista no menu: em /platform/tenants/<id>/agents/<agentId>, o item "Agentes"
 * (/platform/tenants/<id>/agents) fica marcado. Os demais itens continuam acendendo por igualdade exata.
 * A lista é a mesma da troca de cliente (Task 8): uma tela de detalhe nova entra num lugar só.
 */
export function abreDetalheDoItem(pathname: string, href: string): boolean {
  return LISTAS_COM_DETALHE.some((lista) => href.endsWith(lista)) && pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 5: Ligar o item no menu**

Em `components/navigation/navConfig.ts`:

1. No import do `lucide-react`, acrescentar `Bot,` depois de `Workflow,`.
2. Em `SecondaryNavId`, trocar a última linha `  | 'tenant_automations';` por:

```ts
  | 'tenant_automations'
  | 'tenant_agents';
```

3. Trocar a função `getTenantWorkspaceNav` inteira por:

```ts
export function getTenantWorkspaceNav(options: {
  tenantId?: string | null;
  hasConnectedWhatsapp?: boolean;
  canAccessWhatsapp?: boolean;
  canAccessConversations?: boolean;
  canAccessAutomations?: boolean;
  /** Central de Agentes: só agency_admin e o legado admin. Vem do papel, nunca das permissões da API. */
  canAccessAgents?: boolean;
}): SecondaryNavItem[] {
  const {
    tenantId,
    hasConnectedWhatsapp = false,
    canAccessWhatsapp = false,
    canAccessConversations = false,
    canAccessAutomations = false,
    canAccessAgents = false,
  } = options;
  if (!tenantId) return [];
  if (!canAccessWhatsapp && !canAccessConversations && !canAccessAutomations && !canAccessAgents) return [];

  return [
    ...(canAccessAutomations
      ? [{ id: 'tenant_automations', label: 'Automações', href: `/platform/tenants/${tenantId}/automations`, icon: Workflow } satisfies SecondaryNavItem]
      : []),
    ...(canAccessAgents
      ? [{ id: 'tenant_agents', label: 'Agentes', href: `/platform/tenants/${tenantId}/agents`, icon: Bot } satisfies SecondaryNavItem]
      : []),
    ...(canAccessConversations
      ? [{ id: 'tenant_conversations', label: 'Conversas', href: `/platform/tenants/${tenantId}/conversations`, icon: MessagesSquare } satisfies SecondaryNavItem]
      : []),
    ...(canAccessWhatsapp
      ? [{
          id: hasConnectedWhatsapp ? 'tenant_whatsapp' : 'tenant_whatsapp_connect',
          label: 'Conexoes',
          href: `/platform/tenants/${tenantId}/whatsapp`,
          icon: MessageCircle,
        } satisfies SecondaryNavItem]
      : []),
  ];
}
```

Em `components/navigation/usePlatformTenantWorkspaceNav.ts`, logo depois da linha `const canAccessAutomations = ...`, acrescentar:

```ts
  // Central de Agentes: só a agência (agency_admin e o legado admin). O mesmo menu aparece para usuário de cliente,
  // então este item NUNCA pode sair das permissões que a API devolve.
  const canAccessAgents = Boolean(tenantId) && isAgencyAdmin;
```

e, na chamada `getTenantWorkspaceNav({ ... })`, acrescentar `canAccessAgents,` depois de `canAccessAutomations,`.

Em `lib/tenancy/workspaceRoutes.ts`, acrescentar `'/agents',` na lista `TENANT_SCOPED_BASE_ROUTES`, logo depois de `'/automations',`. A lista casa por igualdade exata (`TENANT_SCOPED_BASE_ROUTES.has(pathname)`), então o editor, com o id no caminho, não entra nela: a troca de cliente no editor é tratada na Task 8. Logo depois do fechamento do `new Set([...])`, acrescentar:

```ts
/**
 * Listas que têm tela de detalhe sob o cliente ('/agents' -> '/agents/<agentId>'). Uma lista só, usada pelo menu
 * (item aceso no detalhe: components/navigation/rotaAtiva.ts) e pela troca de cliente (getTenantWorkspaceRelativeHref).
 */
export const LISTAS_COM_DETALHE: readonly string[] = ['/agents'];
```

Em `components/Layout.tsx`:
- acrescentar `import { abreDetalheDoItem } from '@/components/navigation/rotaAtiva';` junto dos outros imports de `@/components/navigation/...` (linhas 69-72);
- trocar `isSidebarRouteActive` (linhas 108-111) por:

```ts
const isSidebarRouteActive = (pathname: string, to: string): boolean =>
  pathname === to ||
  abreDetalheDoItem(pathname, to) ||
  (to.endsWith('/boards') && pathname.endsWith('/pipeline')) ||
  (to.endsWith('/pipeline') && pathname.endsWith('/boards'));
```

Em `components/navigation/NavigationRail.tsx`:
- acrescentar `import { abreDetalheDoItem } from './rotaAtiva';` depois de `import { useTenantScopedHrefBuilder } from './useTenantScopedHref';`;
- trocar `isHrefActive` (linhas 26-29) por:

```ts
  const isHrefActive = (href: string) =>
    pathname === href ||
    abreDetalheDoItem(pathname, href) ||
    (href === '/boards' && pathname === '/pipeline') ||
    (href === '/pipeline' && pathname === '/boards');
```

- [ ] **Step 6: Rodar os testes do Step 1 e os de navegação que já existiam**

Run: `npx vitest run features/agents/formatos.test.ts components/navigation lib/tenancy test/automationPermissions.test.ts components/Layout.navOrder.test.tsx test/vocabularioCliente.test.ts`
Expected: PASS. O `workspaceRoutes.test.ts` ainda não vê `/agents` em disco (a página entra no Step 9); depois do Step 9 ele passa a exigir a entrada, que já está na lista.

- [ ] **Step 7: Teste da tela da lista**

Criar `features/agents/TenantAgentsPage.test.tsx`:

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const estado = vi.hoisted(() => ({ role: 'agency_admin' as string, loading: false }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: { role: estado.role }, loading: estado.loading }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import { TenantAgentsPage } from './TenantAgentsPage';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = {
  id: '22222222-2222-4222-8222-222222222222',
  nome: 'Aurora',
  publicada: { id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z', publicadaPor: null },
  rascunhoPendente: true,
  numeros: [{ id: 'n1', nome: 'Comercial', temAgenda: true }],
};

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  estado.role = 'agency_admin';
  estado.loading = false;
});
afterEach(() => vi.unstubAllGlobals());

describe('TenantAgentsPage', () => {
  it('quem não é da agência vê acesso restrito e nada é pedido', () => {
    estado.role = 'clinic_admin';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lista os agentes com a versão publicada, o rascunho pendente e os números', async () => {
    const fetchMock = vi.fn(() => responder({ cliente: { id: TENANT, nome: 'Cenno Hub' }, agentes: [AGENTE] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantAgentsPage tenantId={TENANT} />);

    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByText('Rascunho com mudanças')).toBeInTheDocument();
    expect(screen.getByText('Números: Comercial')).toBeInTheDocument();
    expect(screen.getByText(/Cenno Hub/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Aurora/ })).toHaveAttribute('href', `/platform/tenants/${TENANT}/agents/${AGENTE.id}`);
    expect(fetchMock).toHaveBeenCalledWith(`/api/platform/tenants/${TENANT}/agents`, expect.objectContaining({ credentials: 'include' }));
  });

  it('sem agentes mostra o estado vazio', async () => {
    vi.stubGlobal('fetch', vi.fn(() => responder({ cliente: { id: TENANT, nome: 'Cenno Hub' }, agentes: [] })));
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(await screen.findByText(/Nenhum agente neste cliente ainda/)).toBeInTheDocument();
  });

  it('falha ao carregar mostra o erro', async () => {
    vi.stubGlobal('fetch', vi.fn(() => responder({ error: 'Cliente não encontrado.' }, 404)));
    render(<TenantAgentsPage tenantId={TENANT} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cliente não encontrado.');
  });
});
```

Run: `npx vitest run features/agents/TenantAgentsPage.test.tsx`
Expected: FAIL com `Failed to resolve import "./TenantAgentsPage"`.

- [ ] **Step 8: Implementar o cliente da API e a tela da lista**

Criar `features/agents/agentesApi.ts`:

```ts
import type { AgenteNaLista, AgenteNoEditor, PaginaDeVersoes, VersaoCompleta } from '@/lib/agents/tiposDoEditor';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';

/** Erro de uma rota da Central, com o código e, no 422 de publicar, a verificação feita pelo servidor. */
export class ErroDaApi extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigo: string | null,
    readonly verificacao: ResultadoDaVerificacao | null,
  ) {
    super(message);
  }
}

async function pedir<T>(url: string, init: RequestInit = {}): Promise<T> {
  const resposta = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new ErroDaApi(corpo?.error || `Falha (HTTP ${resposta.status}).`, resposta.status, corpo?.code ?? null, corpo?.verificacao ?? null);
  }
  return corpo as T;
}

const base = (tenantId: string) => `/api/platform/tenants/${tenantId}/agents`;

export const agentesApi = {
  listar: (tenantId: string) =>
    pedir<{ cliente: { id: string; nome: string }; agentes: AgenteNaLista[] }>(base(tenantId)),
  ler: (tenantId: string, agentId: string) =>
    pedir<{ agente: AgenteNoEditor }>(`${base(tenantId)}/${agentId}`),
  salvarRascunho: (tenantId: string, agentId: string, corpo: { prompt: string; revisao: number }) =>
    pedir<{ revisao: number }>(`${base(tenantId)}/${agentId}/draft`, { method: 'PUT', body: JSON.stringify(corpo) }),
  publicar: (
    tenantId: string,
    agentId: string,
    corpo: { versaoEsperada: number; revisao: number; nota?: string; confirmarAvisos: string[] },
  ) => pedir<{ versao: number; versaoId: string }>(`${base(tenantId)}/${agentId}/publish`, { method: 'POST', body: JSON.stringify(corpo) }),
  /** Uma página do histórico; `antesDe` (o menor número já carregado) traz a seguinte. */
  listarVersoes: (tenantId: string, agentId: string, antesDe?: number) =>
    pedir<PaginaDeVersoes>(`${base(tenantId)}/${agentId}/versions${antesDe ? `?antesDe=${antesDe}` : ''}`),
  lerVersao: (tenantId: string, agentId: string, versao: number) =>
    pedir<{ versao: VersaoCompleta }>(`${base(tenantId)}/${agentId}/versions/${versao}`),
  restaurar: (
    tenantId: string,
    agentId: string,
    corpo: { versao: number; versaoEsperada: number; revisao: number; nota?: string },
  ) => pedir<{ versao: number; versaoId: string; revisao: number }>(`${base(tenantId)}/${agentId}/restore`, { method: 'POST', body: JSON.stringify(corpo) }),
};
```

Criar `features/agents/TenantAgentsPage.tsx`:

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, Loader2, RefreshCcw } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { AgenteNaLista } from '@/lib/agents/tiposDoEditor';
import { agentesApi } from './agentesApi';
import { descreverVersao } from './formatos';

/** Central de Agentes: os agentes de um cliente. Só agency_admin e o legado admin (a API também recusa os outros). */
export function TenantAgentsPage({ tenantId }: { tenantId: string }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="A Central de Agentes é da agência. Fale com quem administra a sua conta." />;
  }
  return <ListaDeAgentes tenantId={tenantId} />;
}

type Estado = { carregando: boolean; erro: string | null; cliente: string | null; agentes: AgenteNaLista[] };

function ListaDeAgentes({ tenantId }: { tenantId: string }) {
  const [estado, setEstado] = React.useState<Estado>({ carregando: true, erro: null, cliente: null, agentes: [] });

  const carregar = React.useCallback(async () => {
    setEstado((atual) => ({ ...atual, carregando: true, erro: null }));
    try {
      const r = await agentesApi.listar(tenantId);
      setEstado({ carregando: false, erro: null, cliente: r.cliente.nome, agentes: r.agentes });
    } catch (erro) {
      setEstado({ carregando: false, erro: erro instanceof Error ? erro.message : 'Falha ao carregar os agentes.', cliente: null, agentes: [] });
    }
  }, [tenantId]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Central de Agentes{estado.cliente ? ` · ${estado.cliente}` : ''}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Agentes do cliente</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Cada agente responde pelos números ligados a ele. Edite, publique e volte versões sem publicar código.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void carregar()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-brand-400 dark:border-white/10 dark:bg-card dark:text-slate-200"
        >
          <RefreshCcw size={16} aria-hidden="true" />
          Atualizar
        </button>
      </header>

      {estado.carregando ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 size={20} className="animate-spin text-slate-500" aria-label="Carregando" />
        </div>
      ) : estado.erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {estado.erro}
        </div>
      ) : estado.agentes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-600 dark:border-white/15 dark:text-slate-300">
          Nenhum agente neste cliente ainda. Por enquanto, os agentes chegam pela migração do prompt de hoje; criar pela biblioteca vem na fase 2.
        </div>
      ) : (
        <ul className="space-y-3">
          {estado.agentes.map((agente) => (
            <li key={agente.id}>
              <Link
                href={`/platform/tenants/${tenantId}/agents/${agente.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-400 hover:shadow-md dark:border-white/10 dark:bg-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                    <Bot size={18} aria-hidden="true" />
                    {agente.nome}
                  </span>
                  {agente.rascunhoPendente ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      Rascunho com mudanças
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {agente.publicada ? descreverVersao(agente.publicada) : 'Sem versão publicada'}
                </p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {agente.numeros.length === 0 ? 'Nenhum número ligado' : `Números: ${agente.numeros.map((n) => n.nome).join(', ')}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 9: A rota de tela da lista**

Criar `app/(protected)/platform/tenants/[tenantId]/agents/page.tsx`:

```tsx
import { TenantAgentsPage } from '@/features/agents/TenantAgentsPage';

export default async function PlatformTenantAgentsRoute({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <TenantAgentsPage tenantId={tenantId} />;
}
```

- [ ] **Step 10: Rodar e ver passar**

Run: `npx vitest run features/agents components/navigation lib/tenancy test/automationPermissions.test.ts components/Layout.navOrder.test.tsx test/vocabularioCliente.test.ts`
Expected: PASS, inclusive `lib/tenancy/workspaceRoutes.test.ts` com a linha nova `/agents ganha o prefixo do cliente ao trocar de cliente`.

Run, em outro comando: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 11: Commit**

```bash
git add features/agents components/navigation lib/tenancy/workspaceRoutes.ts components/Layout.tsx "app/(protected)/platform/tenants/[tenantId]/agents/page.tsx"
git diff --cached --stat
git commit -m "feat(central-agentes): lista de agentes do cliente e item Agentes no menu, so para a agencia"
```

O `--stat` tem que listar só os arquivos desta Task; `components/Layout.tsx` com poucas linhas mudadas (se aparecer o arquivo inteiro, é fim de linha: parar e conferir `git config core.autocrlf`).

---

### Task 7: Histórico de versões, comparação e Restaurar

**Files:**
- Create: `lib/agents/compararVersoes.ts` · Test: `lib/agents/compararVersoes.test.ts`
- Create: `features/agents/HistoricoDeVersoes.tsx` · Test: `features/agents/HistoricoDeVersoes.test.tsx`

SPEC: "lista de versões com autor, data e nota. Compara quaisquer duas (texto linha a linha e ajustes campo a campo). 'Restaurar' pede confirmação e publica como versão nova." A comparação é feita na tela, com as duas versões lidas inteiras pela rota da Task 5. O texto é comparado por subsequência comum mais longa (LCS) linha a linha. Acima de 4 milhões de células (linhas de A × linhas de B, uns 16 MB) a tela não destaca as linhas, para não travar o navegador, e mostra as duas versões inteiras lado a lado: a comparação de quaisquer duas continua disponível. A Aurora tem 134 linhas.

O histórico vem em páginas de 50, da versão mais nova para a mais antiga. "Carregar versões anteriores" traz a página seguinte até a primeira versão, e qualquer uma pode ser marcada para comparar ou restaurada. Revisão do Codex, 07/10: com a lista cortada em 200, as versões mais antigas deixavam de ser alcançáveis. Enquanto uma restauração não responde, os botões de restaurar ficam bloqueados.

O componente é montado pelo editor na aba "Versões" (Task 8).

- [ ] **Step 1: Teste da comparação (falha)**

Criar `lib/agents/compararVersoes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compararAjustes, compararLinhas } from './compararVersoes';

describe('compararLinhas', () => {
  it('texto igual: todas as linhas iguais', () => {
    expect(compararLinhas('a\nb', 'a\nb')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'igual', texto: 'b' },
    ]);
  });

  it('linha trocada vira removida e adicionada, no lugar', () => {
    expect(compararLinhas('a\nb\nc', 'a\nX\nc')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'removida', texto: 'b' },
      { tipo: 'adicionada', texto: 'X' },
      { tipo: 'igual', texto: 'c' },
    ]);
  });

  it('linha removida no meio e linha acrescentada no fim', () => {
    expect(compararLinhas('a\nb\nc', 'a\nc')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'removida', texto: 'b' },
      { tipo: 'igual', texto: 'c' },
    ]);
    expect(compararLinhas('a', 'a\nb')).toEqual([
      { tipo: 'igual', texto: 'a' },
      { tipo: 'adicionada', texto: 'b' },
    ]);
  });

  it('grande demais para comparar na tela: devolve null', () => {
    const grande = 'x\n'.repeat(2001);
    expect(compararLinhas(grande, `${grande}y`)).toBeNull();
  });
});

describe('compararAjustes', () => {
  it('ajustes e modelo iguais: nenhuma diferença', () => {
    expect(compararAjustes({ ajustes: {}, modelo: null }, { ajustes: {}, modelo: null })).toEqual([]);
  });

  it('mostra campo a campo o que mudou, e o modelo', () => {
    expect(compararAjustes(
      { ajustes: { dividir: { partes: 3 } }, modelo: null },
      { ajustes: { dividir: { partes: 2 }, agrupar: { segundos: 7 } }, modelo: 'modelo-x' },
    )).toEqual([
      { campo: 'agrupar', antes: '(sem valor)', depois: '{"segundos":7}' },
      { campo: 'dividir', antes: '{"partes":3}', depois: '{"partes":2}' },
      { campo: 'modelo', antes: 'o padrão da organização', depois: 'modelo-x' },
    ]);
  });
});
```

Run: `npx vitest run lib/agents/compararVersoes.test.ts`
Expected: FAIL com `Failed to resolve import "./compararVersoes"`.

- [ ] **Step 2: Implementar `lib/agents/compararVersoes.ts`**

```ts
export type LinhaDaComparacao = { tipo: 'igual' | 'removida' | 'adicionada'; texto: string };

/** Acima disto (linhas de A × linhas de B) a tela não compara linha a linha: a tabela teria uns 16 MB. */
export const LIMITE_DE_CELULAS = 4_000_000;

/** Comparação linha a linha pela subsequência comum mais longa. Null quando o texto é grande demais para a tela. */
export function compararLinhas(antes: string, depois: string): LinhaDaComparacao[] | null {
  const a = antes.split('\n');
  const b = depois.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > LIMITE_DE_CELULAS) return null;

  const largura = m + 1;
  const tabela = new Uint32Array((n + 1) * largura);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabela[i * largura + j] = a[i] === b[j]
        ? tabela[(i + 1) * largura + j + 1] + 1
        : Math.max(tabela[(i + 1) * largura + j], tabela[i * largura + j + 1]);
    }
  }

  const saida: LinhaDaComparacao[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      saida.push({ tipo: 'igual', texto: a[i] });
      i += 1;
      j += 1;
    } else if (tabela[(i + 1) * largura + j] >= tabela[i * largura + j + 1]) {
      saida.push({ tipo: 'removida', texto: a[i] });
      i += 1;
    } else {
      saida.push({ tipo: 'adicionada', texto: b[j] });
      j += 1;
    }
  }
  while (i < n) saida.push({ tipo: 'removida', texto: a[i++] });
  while (j < m) saida.push({ tipo: 'adicionada', texto: b[j++] });
  return saida;
}

export type DiferencaDeAjuste = { campo: string; antes: string; depois: string };
type LadoDosAjustes = { ajustes: Record<string, unknown>; modelo: string | null };

const mostrar = (valor: unknown) => (valor === undefined ? '(sem valor)' : JSON.stringify(valor));

/** Ajustes campo a campo (ordem alfabética) e o modelo por último. Nesta fatia as versões têm ajustes {} e modelo nulo. */
export function compararAjustes(antes: LadoDosAjustes, depois: LadoDosAjustes): DiferencaDeAjuste[] {
  const campos = [...new Set([...Object.keys(antes.ajustes), ...Object.keys(depois.ajustes)])].sort();
  const diferencas = campos
    .filter((campo) => JSON.stringify(antes.ajustes[campo]) !== JSON.stringify(depois.ajustes[campo]))
    .map((campo) => ({ campo, antes: mostrar(antes.ajustes[campo]), depois: mostrar(depois.ajustes[campo]) }));
  if (antes.modelo !== depois.modelo) {
    diferencas.push({
      campo: 'modelo',
      antes: antes.modelo ?? 'o padrão da organização',
      depois: depois.modelo ?? 'o padrão da organização',
    });
  }
  return diferencas;
}
```

Run: `npx vitest run lib/agents/compararVersoes.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 3: Teste do histórico (falha)**

Criar `features/agents/HistoricoDeVersoes.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));

import { HistoricoDeVersoes } from './HistoricoDeVersoes';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE_ID = '22222222-2222-4222-8222-222222222222';
const BASE = `/api/platform/tenants/${TENANT}/agents/${AGENTE_ID}`;
const VERSOES = [
  { id: 'v2', versao: 2, origem: 'publish', restauradaDe: null, nota: 'abertura nova', publicadaEm: '2026-10-07T15:00:00Z', publicadaPor: 'Junior' },
  { id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z', publicadaPor: null },
];
const COMPLETA = {
  1: { ...VERSOES[1], prompt: 'Oi\nlinha velha\nfim', ajustes: {}, modelo: null },
  2: { ...VERSOES[0], prompt: 'Oi\nlinha nova\nfim', ajustes: {}, modelo: null },
};

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

function fetchFalso(
  restaurar: () => Promise<Response>,
  extra: Record<string, () => Promise<Response>> = {},
) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url)}`;
    if (extra[chave]) return extra[chave]();
    if (chave === `GET ${BASE}/versions`) return responder({ versoes: VERSOES, temMais: false });
    if (chave === `GET ${BASE}/versions/1`) return responder({ versao: COMPLETA[1] });
    if (chave === `GET ${BASE}/versions/2`) return responder({ versao: COMPLETA[2] });
    if (chave === `POST ${BASE}/restore`) return restaurar();
    throw new Error(`fetch inesperado: ${chave}`);
  });
}

beforeEach(() => toast.mockClear());
afterEach(() => vi.unstubAllGlobals());

function montar(onMudou = vi.fn()) {
  render(<HistoricoDeVersoes tenantId={TENANT} agentId={AGENTE_ID} versaoPublicada={2} revisao={3} onMudou={onMudou} />);
  return onMudou;
}

describe('HistoricoDeVersoes', () => {
  it('lista as versões com autor, data e nota, e marca a publicada', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({})));
    montar();
    expect(await screen.findByText('Versão 2 publicada em 07/10/2026 às 12:00 por Junior')).toBeInTheDocument();
    expect(screen.getByText('Nota: abertura nova')).toBeInTheDocument();
    expect(screen.getByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByText('Publicada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurar a versão 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restaurar a versão 2' })).toBeNull();
  });

  it('compara duas versões linha a linha e diz que ajustes e modelo são iguais', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({})));
    montar();
    await screen.findByText(/Versão 2 publicada/);
    fireEvent.click(screen.getByLabelText('Comparar a versão 1'));
    fireEvent.click(screen.getByLabelText('Comparar a versão 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Comparar a versão 1 com a 2' }));

    expect(await screen.findByText('linha velha')).toHaveAttribute('data-tipo', 'removida');
    expect(screen.getByText('linha nova')).toHaveAttribute('data-tipo', 'adicionada');
    expect(screen.getByText('Ajustes e modelo iguais nas duas versões.')).toBeInTheDocument();
  });

  it('histórico longo: "Carregar versões anteriores" traz a página seguinte, e a versão antiga fica comparável e restaurável', async () => {
    const fetchMock = fetchFalso(() => responder({}), {
      [`GET ${BASE}/versions`]: () => responder({ versoes: [VERSOES[0]], temMais: true }),
      [`GET ${BASE}/versions?antesDe=2`]: () => responder({ versoes: [VERSOES[1]], temMais: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    montar();
    await screen.findByText(/Versão 2 publicada/);
    expect(screen.queryByRole('button', { name: 'Restaurar a versão 1' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Carregar versões anteriores' }));
    expect(await screen.findByRole('button', { name: 'Restaurar a versão 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('Comparar a versão 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar versões anteriores' })).toBeNull();
  });

  it('texto grande demais para destacar: as duas versões aparecem lado a lado, inteiras', async () => {
    const linhas = (marca: string) => Array.from({ length: 2100 }, (_, i) => `${marca} ${i}`).join('\n');
    vi.stubGlobal('fetch', fetchFalso(() => responder({}), {
      [`GET ${BASE}/versions/1`]: () => responder({ versao: { ...COMPLETA[1], prompt: linhas('velha') } }),
      [`GET ${BASE}/versions/2`]: () => responder({ versao: { ...COMPLETA[2], prompt: linhas('nova') } }),
    }));
    montar();
    await screen.findByText(/Versão 2 publicada/);
    fireEvent.click(screen.getByLabelText('Comparar a versão 1'));
    fireEvent.click(screen.getByLabelText('Comparar a versão 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Comparar a versão 1 com a 2' }));

    expect(await screen.findByText(/grande demais para destacar linha a linha/)).toBeInTheDocument();
    expect(screen.getByLabelText('Texto da versão 1').textContent).toContain('velha 2099');
    expect(screen.getByLabelText('Texto da versão 2').textContent).toContain('nova 2099');
  });

  it('restaurar pede confirmação e manda a versão escolhida, a publicada e a revisão que a tela mostrou', async () => {
    const fetchMock = fetchFalso(() => responder({ versao: 3, versaoId: 'v3', revisao: 4 }));
    vi.stubGlobal('fetch', fetchMock);
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));

    expect(screen.getByText('Restaurar a versão 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));

    await waitFor(() => expect(onMudou).toHaveBeenCalled());
    const chamada = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/restore'));
    expect(JSON.parse(String(chamada?.[1]?.body))).toEqual({ versao: 1, versaoEsperada: 2, revisao: 3 });
    expect(toast).toHaveBeenCalledWith(
      'Versão 1 restaurada como versão 3. As respostas que começarem a partir de agora já saem com ela.',
      'success',
    );
  });

  it('enquanto a restauração não responde, nenhuma outra pode ser pedida (um POST só)', async () => {
    let soltar: (r: Response) => void = () => undefined;
    const pendente = new Promise<Response>((ok) => {
      soltar = ok;
    });
    const fetchMock = fetchFalso(() => pendente);
    vi.stubGlobal('fetch', fetchMock);
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));

    const botao = await screen.findByRole('button', { name: 'Restaurar a versão 1' });
    await waitFor(() => expect(botao).toBeDisabled());
    fireEvent.click(botao);
    expect(screen.queryByText('Restaurar a versão 1?')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/restore'))).toHaveLength(1);

    soltar(new Response(JSON.stringify({ versao: 3, versaoId: 'v3', revisao: 4 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(onMudou).toHaveBeenCalled());
  });

  it('restaurar quando outra versão foi publicada no meio (409): avisa e recarrega', async () => {
    vi.stubGlobal('fetch', fetchFalso(() => responder({ error: 'Outra versão foi publicada.', code: 'VERSAO_PUBLICADA_MUDOU' }, 409)));
    const onMudou = montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar a versão 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Outra versão foi publicada.', 'error'));
    expect(onMudou).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run features/agents/HistoricoDeVersoes.test.tsx`
Expected: FAIL com `Failed to resolve import "./HistoricoDeVersoes"`.

- [ ] **Step 4: Implementar `features/agents/HistoricoDeVersoes.tsx`**

```tsx
'use client';

import React from 'react';
import { GitCompare, History, Loader2, RotateCcw } from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/context/ToastContext';
import { compararAjustes, compararLinhas } from '@/lib/agents/compararVersoes';
import type { VersaoCompleta, VersaoResumo } from '@/lib/agents/tiposDoEditor';
import { ErroDaApi, agentesApi } from './agentesApi';
import { descreverVersao } from './formatos';

const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';

/** Histórico do agente: autor, data e nota de cada versão; comparar quaisquer duas; restaurar uma como versão nova. */
export function HistoricoDeVersoes(props: {
  tenantId: string;
  agentId: string;
  versaoPublicada: number;
  revisao: number;
  onMudou: () => void;
}) {
  const { tenantId, agentId, versaoPublicada, revisao, onMudou } = props;
  const { addToast } = useToast();
  const [versoes, setVersoes] = React.useState<VersaoResumo[] | null>(null);
  const [temMais, setTemMais] = React.useState(false);
  const [carregandoMais, setCarregandoMais] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [selecionadas, setSelecionadas] = React.useState<number[]>([]);
  const [comparacao, setComparacao] = React.useState<{ antes: VersaoCompleta; depois: VersaoCompleta } | null>(null);
  const [comparando, setComparando] = React.useState(false);
  const [restaurar, setRestaurar] = React.useState<number | null>(null);
  // O ConfirmModal fecha logo depois do onConfirm: sem esta trava, a mesma restauração podia ser pedida de novo
  // antes de a primeira responder (revisão do Codex, 07/10).
  const [restaurando, setRestaurando] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setErro(null);
    try {
      const pagina = await agentesApi.listarVersoes(tenantId, agentId);
      setVersoes(pagina.versoes);
      setTemMais(pagina.temMais);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o histórico.');
    }
  }, [tenantId, agentId]);

  // Página seguinte: as versões de número menor que a última carregada. Qualquer versão continua alcançável.
  const carregarMais = async () => {
    if (!versoes?.length) return;
    setCarregandoMais(true);
    try {
      const pagina = await agentesApi.listarVersoes(tenantId, agentId, versoes[versoes.length - 1].versao);
      setVersoes((atual) => [...(atual ?? []), ...pagina.versoes]);
      setTemMais(pagina.temMais);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao carregar as versões anteriores.', 'error');
    } finally {
      setCarregandoMais(false);
    }
  };

  // Recarrega quando a versão publicada muda (publicar ou restaurar no editor).
  React.useEffect(() => {
    void carregar();
  }, [carregar, versaoPublicada]);

  const alternar = (versao: number) =>
    setSelecionadas((atual) => (atual.includes(versao) ? atual.filter((v) => v !== versao) : [...atual, versao].slice(-2)));

  const [menor, maior] = [...selecionadas].sort((x, y) => x - y);

  const comparar = async () => {
    setComparando(true);
    try {
      const [antes, depois] = await Promise.all([
        agentesApi.lerVersao(tenantId, agentId, menor),
        agentesApi.lerVersao(tenantId, agentId, maior),
      ]);
      setComparacao({ antes: antes.versao, depois: depois.versao });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao comparar as versões.', 'error');
    } finally {
      setComparando(false);
    }
  };

  const confirmarRestauracao = async (versao: number) => {
    setRestaurando(true);
    try {
      const r = await agentesApi.restaurar(tenantId, agentId, { versao, versaoEsperada: versaoPublicada, revisao });
      // O runtime lê a versão antes de gerar: uma resposta que já estava em curso ainda sai com a anterior.
      addToast(
        `Versão ${versao} restaurada como versão ${r.versao}. As respostas que começarem a partir de agora já saem com ela.`,
        'success',
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao restaurar.', 'error');
      if (!(e instanceof ErroDaApi && e.status === 409)) return;
    } finally {
      setRestaurando(false);
    }
    setComparacao(null);
    setSelecionadas([]);
    onMudou();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <History size={16} aria-hidden="true" />
            Versões
          </h2>
          <button
            type="button"
            onClick={() => void comparar()}
            disabled={selecionadas.length !== 2 || comparando}
            className={BOTAO_SECUNDARIO}
          >
            {comparando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <GitCompare size={14} aria-hidden="true" />}
            {selecionadas.length === 2 ? `Comparar a versão ${menor} com a ${maior}` : 'Marque duas versões para comparar'}
          </button>
        </div>
        {erro ? (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>
        ) : versoes === null ? (
          <Loader2 size={18} className="animate-spin text-slate-500" aria-label="Carregando" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {versoes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                <input
                  type="checkbox"
                  checked={selecionadas.includes(v.versao)}
                  onChange={() => alternar(v.versao)}
                  aria-label={`Comparar a versão ${v.versao}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 dark:text-slate-100">{descreverVersao(v)}</p>
                  {v.nota ? <p className="text-xs text-slate-500 dark:text-slate-400">{`Nota: ${v.nota}`}</p> : null}
                </div>
                {v.versao === versaoPublicada ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200">
                    Publicada
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRestaurar(v.versao)}
                    disabled={restaurando}
                    className={BOTAO_SECUNDARIO}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    {`Restaurar a versão ${v.versao}`}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {versoes && temMais ? (
          <button type="button" onClick={() => void carregarMais()} disabled={carregandoMais} className={`${BOTAO_SECUNDARIO} mt-3`}>
            {carregandoMais ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            Carregar versões anteriores
          </button>
        ) : null}
      </div>

      {comparacao ? <Comparacao antes={comparacao.antes} depois={comparacao.depois} /> : null}

      <ConfirmModal
        isOpen={restaurar !== null}
        onClose={() => setRestaurar(null)}
        onConfirm={() => {
          if (restaurar !== null) void confirmarRestauracao(restaurar);
        }}
        title={`Restaurar a versão ${restaurar ?? ''}?`}
        message={`O conteúdo dela vira a versão ${versaoPublicada + 1}, publicada agora, e o rascunho passa a ter esse texto. As respostas que começarem depois disso já saem com ela.`}
        confirmText="Restaurar"
        variant="primary"
      />
    </div>
  );
}

function Comparacao({ antes, depois }: { antes: VersaoCompleta; depois: VersaoCompleta }) {
  const linhas = React.useMemo(() => compararLinhas(antes.prompt, depois.prompt), [antes.prompt, depois.prompt]);
  const ajustes = React.useMemo(() => compararAjustes(antes, depois), [antes, depois]);
  return (
    <section aria-label="Comparação" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{`Da versão ${antes.versao} para a versão ${depois.versao}`}</h2>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Texto, linha a linha</h3>
        {linhas === null ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              O texto é grande demais para destacar linha a linha nesta tela. As duas versões aparecem lado a lado, inteiras.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {[antes, depois].map((v) => (
                <pre
                  key={v.versao}
                  aria-label={`Texto da versão ${v.versao}`}
                  className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 text-slate-700 dark:border-white/10 dark:text-slate-300"
                >
                  {v.prompt}
                </pre>
              ))}
            </div>
          </div>
        ) : linhas.every((l) => l.tipo === 'igual') ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">O texto é igual nas duas versões.</p>
        ) : (
          <div className="max-h-[480px] overflow-auto rounded-xl border border-slate-200 p-3 font-mono text-xs leading-5 dark:border-white/10">
            {linhas.map((l, i) => (
              <div
                key={i}
                data-tipo={l.tipo}
                className={
                  l.tipo === 'adicionada'
                    ? 'whitespace-pre-wrap bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : l.tipo === 'removida'
                      ? 'whitespace-pre-wrap bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200'
                      : 'whitespace-pre-wrap text-slate-600 dark:text-slate-400'
                }
              >
                <span aria-hidden="true">{l.tipo === 'adicionada' ? '+ ' : l.tipo === 'removida' ? '- ' : '  '}</span>
                <span className="sr-only">{l.tipo === 'adicionada' ? 'Linha adicionada: ' : l.tipo === 'removida' ? 'Linha removida: ' : ''}</span>
                {l.texto}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ajustes e modelo, campo a campo</h3>
        {ajustes.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">Ajustes e modelo iguais nas duas versões.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500 dark:text-slate-400">
                <th className="py-1 font-medium">Campo</th>
                <th className="py-1 font-medium">{`Versão ${antes.versao}`}</th>
                <th className="py-1 font-medium">{`Versão ${depois.versao}`}</th>
              </tr>
            </thead>
            <tbody>
              {ajustes.map((d) => (
                <tr key={d.campo} className="border-t border-slate-100 dark:border-white/5">
                  <td className="py-1 font-mono text-xs">{d.campo}</td>
                  <td className="py-1 font-mono text-xs">{d.antes}</td>
                  <td className="py-1 font-mono text-xs">{d.depois}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/agents/compararVersoes.test.ts features/agents/HistoricoDeVersoes.test.tsx`
Expected: PASS (6 + 7 testes).

- [ ] **Step 6: Commit**

```bash
git add lib/agents/compararVersoes.ts lib/agents/compararVersoes.test.ts features/agents/HistoricoDeVersoes.tsx features/agents/HistoricoDeVersoes.test.tsx
git diff --cached --stat
git commit -m "feat(central-agentes): historico de versoes com comparacao linha a linha e Restaurar com confirmacao"
```

---

### Task 8: Editor do agente (leitura formatada, editar, verificação ao vivo, salvar, publicar e a aba de versões)

**Files:**
- Create: `features/agents/LeituraDoPrompt.tsx`
- Create: `features/agents/PainelDaVerificacao.tsx`
- Create: `features/agents/DialogoPublicar.tsx`
- Create: `features/agents/AgentEditorPage.tsx` · Test: `features/agents/AgentEditorPage.test.tsx`
- Create: `app/(protected)/platform/tenants/[tenantId]/agents/[agentId]/page.tsx`
- Modify: `lib/tenancy/workspaceRoutes.ts` (`getTenantWorkspaceRelativeHref`) · Test: `lib/tenancy/workspaceRoutes.test.ts`

O desenho segue o mockup aprovado em 29/09 (`06-References/central-de-agentes-2026-09-29/central-de-agentes.html`, seção "A Central de Agentes"):
- trilha "Central de Agentes › cliente › agente", com "Testar sem enviar" (desabilitado nesta fatia, "Chega na próxima entrega") e "Publicar";
- lateral com as sete seções do mockup; só "Prompt" abre nesta fatia, as outras aparecem desabilitadas com a mesma frase;
- barra da versão: "Versão N publicada em [data] por [pessoa]", "Rascunho com mudanças" e o resumo da verificação;
- leitura formatada por seções (títulos em maiúscula), com as variáveis como etiquetas; "Editar" troca para o campo de texto, com as 12 variáveis em etiquetas clicáveis para inserir;
- a verificação roda a cada tecla; "Publicar" fica bloqueado com erro, com edição não salva ou sem mudança; aviso abre a confirmação no diálogo;
- a seção Prompt tem duas abas, "Instruções" e "Versões" (o histórico da Task 7); durante a edição a outra aba fica bloqueada, para nada se perder;
- **o texto de quem edita nunca some sem uma escolha** (revisão do Codex, 07/10):
  - se outra aba ou pessoa salvou antes (409), o texto continua no campo, a tela recarrega a revisão e o texto atuais e oferece "Salvar o meu por cima" ou "Descartar o meu e ver o atual";
  - cada mudança não salva vai para uma cópia local (`localStorage`, por cliente e agente). Quem sai por um link interno, onde o `beforeunload` não age, e volta ao agente recebe o aviso para recuperar o texto;
  - o editor é montado com `key` de cliente e agente, para nenhum estado do anterior chegar ao endereço novo.

Ao trocar de cliente estando no editor, o seletor do cabeçalho remontaria `/agents/<id do agente>` no outro cliente, que não existe ali, e cairia em 404 (o mesmo defeito de 24/09). `getTenantWorkspaceRelativeHref` passa a devolver a lista (`/agents`) para as rotas de detalhe, e o teste que lê o disco ganha a checagem das páginas com segmento dinâmico.

- [ ] **Step 1: Teste do seletor de cliente nas rotas de detalhe (falha)**

Em `lib/tenancy/workspaceRoutes.test.ts`, acrescentar depois da função `rotasEmDisco`:

```ts
/** Páginas com segmento dinâmico sob [tenantId] ('/agents/[agentId]'). */
function rotasDinamicasEmDisco(dir = BASE, prefixo = ''): string[] {
  const achadas: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory()) {
      if (entrada.name === 'page.tsx' && prefixo.includes('[')) achadas.push(prefixo);
      continue;
    }
    if (entrada.name.startsWith('(')) continue;
    achadas.push(...rotasDinamicasEmDisco(path.join(dir, entrada.name), `${prefixo}/${entrada.name}`));
  }
  return achadas;
}
```

e, no fim do arquivo:

```ts
describe('rotas de detalhe sob o cliente', () => {
  const dinamicas = rotasDinamicasEmDisco().sort();
  const bases = rotasEmDisco();

  it('encontra o editor de agente em disco (se isto falhar, a pasta mudou)', () => {
    expect(dinamicas).toContain('/agents/[agentId]');
  });

  it.each(dinamicas)('%s: trocar de cliente leva para a lista no outro cliente, nunca para o id do anterior', (rota) => {
    const atual = `/platform/tenants/${OUTRO}${rota.replace(/\[[^\]]+\]/g, '22222222-2222-4222-8222-222222222222')}`;
    const destino = getTenantWorkspaceHref(getTenantWorkspaceRelativeHref(atual), TENANT);
    expect(destino.startsWith(`/platform/tenants/${TENANT}/`)).toBe(true);
    expect(
      bases,
      `"${rota}" ao trocar de cliente foi para "${destino}", que não é uma tela que existe no outro cliente. `
        + 'Acrescente a lista em LISTAS_COM_DETALHE (lib/tenancy/workspaceRoutes.ts).',
    ).toContain(destino.slice(`/platform/tenants/${TENANT}`.length));
  });
});
```

Run: `npx vitest run lib/tenancy/workspaceRoutes.test.ts`
Expected: FAIL em "encontra o editor de agente em disco" (a página ainda não existe).

- [ ] **Step 2: Corrigir o caminho relativo**

Em `lib/tenancy/workspaceRoutes.ts`, trocar a função `getTenantWorkspaceRelativeHref` inteira pela versão abaixo. Ela usa a `LISTAS_COM_DETALHE` que a Task 6 criou e exportou no mesmo arquivo; não criar outra.

```ts
/**
 * Rotas de detalhe de um recurso do cliente ('/agents/<id>'): ao trocar de cliente, o id do recurso não existe no
 * outro, então o caminho volta para a lista. Sem isso o seletor remontava '/agents/<id>' no outro cliente: 404.
 */
export function getTenantWorkspaceRelativeHref(pathname: string): string {
  const tenantId = getTenantIdFromPathname(pathname);
  if (!tenantId) return '/dashboard';
  const match = pathname.match(/^\/platform\/tenants\/[0-9a-f-]+(\/.*)?$/i);
  const relativePath = match?.[1] || '/dashboard';
  const lista = LISTAS_COM_DETALHE.find((base) => relativePath.startsWith(`${base}/`));
  if (lista) return lista;
  return relativePath === '/pipeline' ? '/boards' : relativePath;
}
```

- [ ] **Step 3: Teste do editor (falha)**

Criar `features/agents/AgentEditorPage.test.tsx`:

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';

const estado = vi.hoisted(() => ({ role: 'agency_admin' as string }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: estado.role }, loading: false }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

import { AgentEditorPage } from './AgentEditorPage';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE_ID = '22222222-2222-4222-8222-222222222222';
const URL_AGENTE = `/api/platform/tenants/${TENANT}/agents/${AGENTE_ID}`;
const PUBLICADO = 'Voce e a Aurora.\nREGRAS:\n- fale com {{contactName}}\n{{conversationStageContext}}\n- replyText: resposta curta';

function agente(extra: Partial<AgenteNoEditor> = {}): AgenteNoEditor {
  return {
    id: AGENTE_ID,
    nome: 'Aurora',
    cliente: { id: TENANT, nome: 'Cenno Hub' },
    publicada: {
      id: 'v1', versao: 1, origem: 'migration', restauradaDe: null, nota: null, publicadaEm: '2026-10-07T04:51:00Z',
      publicadaPor: null, prompt: PUBLICADO, ajustes: {}, modelo: null,
    },
    rascunho: { prompt: null, revisao: 0, atualizadoEm: null, atualizadoPor: null },
    numeros: [{ id: 'n1', nome: 'Comercial', temAgenda: false }],
    ...extra,
  };
}

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

/** fetch falso por "MÉTODO url"; pedido fora da lista quebra o teste. */
function fetchFalso(rotas: Record<string, (init?: RequestInit) => Promise<Response>>) {
  return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url)}`;
    const rota = rotas[chave];
    if (!rota) throw new Error(`fetch inesperado: ${chave}`);
    return rota(init);
  });
}

const corpoDe = (fetchMock: ReturnType<typeof fetchFalso>, sufixo: string) => {
  const chamada = fetchMock.mock.calls.find(([url]) => String(url).endsWith(sufixo));
  return JSON.parse(String(chamada?.[1]?.body));
};

beforeEach(() => {
  estado.role = 'agency_admin';
  toast.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AgentEditorPage', () => {
  it('quem não é da agência vê acesso restrito e nada é pedido', () => {
    estado.role = 'agency_staff';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(screen.getByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra a versão publicada e a leitura por seções, com a variável como etiqueta', async () => {
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);

    expect(await screen.findByText('Versão 1 publicada em 07/10/2026 às 01:51 pela migração')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'REGRAS' })).toBeInTheDocument();
    expect(screen.getByText('{{contactName}}')).toBeInTheDocument();
    expect(screen.getByText('Sem mudanças no rascunho')).toBeInTheDocument();
    expect(screen.getByText('Nenhum erro nem aviso.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Testar sem enviar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Comportamento/ })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Central de Agentes' })).toHaveAttribute('href', `/platform/tenants/${TENANT}/agents`);
  });

  it('editar: a verificação acusa a variável desconhecida a cada tecla e salvar manda a revisão lida', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      [`PUT ${URL_AGENTE}/draft`]: () => responder({ revisao: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const campo = screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement;
    expect(campo.value).toBe(PUBLICADO);
    fireEvent.change(campo, { target: { value: `${PUBLICADO}\n{{nomeDoLead}}` } });
    expect(screen.getByText(/\{\{nomeDoLead\}\} não é uma das 12 variáveis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));
    expect(corpoDe(fetchMock, '/draft')).toEqual({ prompt: `${PUBLICADO}\n{{nomeDoLead}}`, revisao: 0 });
  });

  it('salvar com a revisão velha (outra aba salvou antes): avisa, mantém o texto e deixa a escolha explícita', async () => {
    const MENSAGEM = 'O rascunho foi alterado em outra aba ou por outra pessoa enquanto você editava.';
    const daOutraAba = agente({
      rascunho: { prompt: `${PUBLICADO}\ntexto da outra aba`, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    let leituras = 0;
    let gravacoes = 0;
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: leituras === 1 ? agente() : daOutraAba });
      },
      [`PUT ${URL_AGENTE}/draft`]: () => {
        gravacoes += 1;
        return gravacoes === 1 ? responder({ error: MENSAGEM, code: 'RASCUNHO_MUDOU' }, 409) : responder({ revisao: 2 });
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const meu = `${PUBLICADO}\nmeu texto`;
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: meu } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(MENSAGEM, 'error'));
    await waitFor(() => expect(leituras).toBe(2));
    // O texto de quem editava continua no campo; o salvar comum fica travado até a escolha (revisão do Codex, 07/10).
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(meu);
    expect(screen.getByText(/O seu texto continua aqui, sem salvar\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar o meu por cima' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Rascunho salvo.', 'success'));
    const corpos = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/draft'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(corpos).toEqual([{ prompt: meu, revisao: 0 }, { prompt: meu, revisao: 1 }]);
  });

  it('texto não salvo sobrevive a sair pela navegação interna: a cópia local oferece recuperar', async () => {
    const CHAVE = `central-agentes:texto-nao-salvo:${TENANT}:${AGENTE_ID}`;
    vi.stubGlobal('fetch', fetchFalso({ [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }) }));
    const primeira = render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Prompt do agente'), { target: { value: `${PUBLICADO}\nnão salvei` } });
    expect(JSON.parse(localStorage.getItem(CHAVE) ?? '{}').texto).toBe(`${PUBLICADO}\nnão salvei`);

    // Saiu por um link interno (o editor desmonta sem passar pelo beforeunload) e voltou depois.
    primeira.unmount();
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    expect(await screen.findByText(/Você tem um texto não salvo deste agente/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar o texto' }));
    expect((screen.getByLabelText('Prompt do agente') as HTMLTextAreaElement).value).toBe(`${PUBLICADO}\nnão salvei`);

    // Descartar a edição apaga a cópia.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(localStorage.getItem(CHAVE)).toBeNull();
  });

  it('publicar com aviso exige a confirmação e manda a versão, a revisão e os avisos confirmados', async () => {
    const semNome = 'Voce e a Aurora.\nREGRAS:\n- fale\n{{conversationStageContext}}\n- replyText: resposta curta';
    const comRascunho = agente({
      rascunho: { prompt: semNome, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: comRascunho }),
      [`POST ${URL_AGENTE}/publish`]: () => responder({ versao: 2, versaoId: 'v2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);

    expect(await screen.findByText('Rascunho com mudanças')).toBeInTheDocument();
    expect(screen.getByText('salvo em 07/10/2026 às 09:00 por Junior')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));

    const botao = await screen.findByRole('button', { name: 'Publicar versão 2' });
    expect(botao).toBeDisabled();
    expect(screen.getAllByText(/O rascunho tirou \{\{contactName\}\}/).length).toBeGreaterThan(0);
    expect(screen.getByText(/As respostas do número Comercial que começarem depois da publicação já saem com esta versão/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Li os avisos e quero publicar assim.'));
    fireEvent.change(screen.getByLabelText('Nota da versão (opcional)'), { target: { value: 'tirei o nome' } });
    expect(botao).toBeEnabled();
    fireEvent.click(botao);

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Versão 2 publicada. As respostas que começarem a partir de agora já saem com ela.', 'success'),
    );
    expect(corpoDe(fetchMock, '/publish')).toEqual({ versaoEsperada: 1, revisao: 1, nota: 'tirei o nome', confirmarAvisos: ['perdeu:contactName'] });
  });

  it('publicar quando outra pessoa publicou antes (409): avisa, fecha o diálogo e recarrega (SPEC, fatia 2)', async () => {
    const MENSAGEM = 'Outra versão foi publicada enquanto você editava. A tela foi atualizada com a versão atual.';
    const comRascunho = agente({
      rascunho: { prompt: `${PUBLICADO}\nmais uma regra`, revisao: 1, atualizadoEm: '2026-10-07T12:00:00Z', atualizadoPor: 'Junior' },
    });
    let leituras = 0;
    vi.stubGlobal('fetch', fetchFalso({
      [`GET ${URL_AGENTE}`]: () => {
        leituras += 1;
        return responder({ agente: comRascunho });
      },
      [`POST ${URL_AGENTE}/publish`]: () => responder({ error: MENSAGEM, code: 'VERSAO_PUBLICADA_MUDOU' }, 409),
    }));
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText('Rascunho com mudanças');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    // Sem aviso no rascunho: o botão do diálogo já vem habilitado.
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar versão 2' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(MENSAGEM, 'error'));
    await waitFor(() => expect(leituras).toBe(2));
    expect(screen.queryByRole('button', { name: 'Publicar versão 2' })).toBeNull();
  });

  it('a aba Versões abre o histórico do agente; durante a edição ela fica bloqueada', async () => {
    const fetchMock = fetchFalso({
      [`GET ${URL_AGENTE}`]: () => responder({ agente: agente() }),
      [`GET ${URL_AGENTE}/versions`]: () => responder({ versoes: [], temMais: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AgentEditorPage tenantId={TENANT} agentId={AGENTE_ID} />);
    await screen.findByText(/Versão 1 publicada/);

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByRole('tab', { name: 'Versões' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Versões' }));
    expect(await screen.findByRole('heading', { name: 'Versões' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`${URL_AGENTE}/versions`, expect.objectContaining({ credentials: 'include' }));
  });
});
```

Run: `npx vitest run features/agents/AgentEditorPage.test.tsx`
Expected: FAIL com `Failed to resolve import "./AgentEditorPage"`.

- [ ] **Step 4: Leitura formatada — `features/agents/LeituraDoPrompt.tsx`**

```tsx
'use client';

import React from 'react';
import { dividirEmSecoes, pedacosDaLinha } from '@/lib/agents/leituraDoPrompt';

const ITEM_DE_LISTA = /^\s*[-*]\s+/;

/** Leitura formatada do prompt: seções com título, listas e as variáveis como etiquetas. Sempre texto, nunca HTML (G16). */
export function LeituraDoPrompt({ texto }: { texto: string }) {
  const secoes = React.useMemo(() => dividirEmSecoes(texto), [texto]);
  return (
    <div className="space-y-5">
      {secoes.map((secao, i) => {
        if (secao.titulo === null && secao.linhas.every((l) => l.trim() === '')) return null;
        return (
          <section key={i} className="space-y-2">
            {secao.titulo ? (
              <header>
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{secao.titulo}</h3>
                {secao.nota ? <p className="text-xs text-slate-500 dark:text-slate-400">{secao.nota}</p> : null}
              </header>
            ) : null}
            {secao.complemento ? (
              <p className="text-sm leading-6 text-slate-800 dark:text-slate-100">
                <Linha texto={secao.complemento} />
              </p>
            ) : null}
            <Blocos linhas={secao.linhas} />
          </section>
        );
      })}
    </div>
  );
}

function Blocos({ linhas }: { linhas: string[] }) {
  // Linhas que começam com "- " ou "* " viram lista; o resto, parágrafo; linha em branco separa.
  const blocos: Array<{ tipo: 'lista' | 'paragrafo'; linhas: string[] }> = [];
  for (const linha of linhas) {
    if (linha.trim() === '') {
      blocos.push({ tipo: 'paragrafo', linhas: [] });
      continue;
    }
    const tipo = ITEM_DE_LISTA.test(linha) ? 'lista' : 'paragrafo';
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.tipo === tipo && ultimo.linhas.length > 0) ultimo.linhas.push(linha);
    else blocos.push({ tipo, linhas: [linha] });
  }
  return (
    <>
      {blocos
        .filter((b) => b.linhas.length > 0)
        .map((b, i) =>
          b.tipo === 'lista' ? (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800 dark:text-slate-100">
              {b.linhas.map((l, j) => (
                <li key={j}>
                  <Linha texto={l.replace(ITEM_DE_LISTA, '')} />
                </li>
              ))}
            </ul>
          ) : (
            <p key={i} className="text-sm leading-6 text-slate-800 dark:text-slate-100">
              {b.linhas.map((l, j) => (
                <React.Fragment key={j}>
                  {j > 0 ? <br /> : null}
                  <Linha texto={l} />
                </React.Fragment>
              ))}
            </p>
          ),
        )}
    </>
  );
}

function Linha({ texto }: { texto: string }) {
  return (
    <>
      {pedacosDaLinha(texto).map((p, i) =>
        p.tipo === 'texto' ? (
          <React.Fragment key={i}>{p.texto}</React.Fragment>
        ) : (
          <span
            key={i}
            title={p.conhecida ? 'Preenchida pelo sistema em cada resposta' : 'Variável desconhecida: bloqueia Publicar'}
            className={
              p.conhecida
                ? 'mx-0.5 inline-flex rounded-md border border-brand-200 bg-brand-50 px-1.5 font-mono text-xs text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200'
                : 'mx-0.5 inline-flex rounded-md border border-rose-300 bg-rose-50 px-1.5 font-mono text-xs text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
            }
          >
            {p.texto}
          </span>
        ),
      )}
    </>
  );
}
```

- [ ] **Step 5: Painel da verificação — `features/agents/PainelDaVerificacao.tsx`**

```tsx
'use client';

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';

export function PainelDaVerificacao({ verificacao }: { verificacao: ResultadoDaVerificacao }) {
  const { erros, avisos, informacoes } = verificacao;
  return (
    <section aria-label="Verificação" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-card">
      <h2 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Verificação</h2>
      {erros.length + avisos.length + informacoes.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 size={16} aria-hidden="true" />
          Nenhum erro nem aviso.
        </p>
      ) : (
        <ul className="space-y-2">
          {erros.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-rose-800 dark:text-rose-200">
              <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Erro:</strong> {item.mensagem}</span>
            </li>
          ))}
          {avisos.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Aviso:</strong> {item.mensagem}</span>
            </li>
          ))}
          {informacoes.map((item) => (
            <li key={item.codigo} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
              <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="font-semibold">Informação:</strong> {item.mensagem}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function resumoDaVerificacao(v: ResultadoDaVerificacao): string {
  const partes: string[] = [];
  if (v.erros.length > 0) partes.push(v.erros.length === 1 ? '1 erro' : `${v.erros.length} erros`);
  if (v.avisos.length > 0) partes.push(v.avisos.length === 1 ? '1 aviso' : `${v.avisos.length} avisos`);
  return partes.length > 0 ? `Verificação: ${partes.join(' · ')}` : 'Verificação sem erro nem aviso';
}
```

- [ ] **Step 6: Diálogo de publicar — `features/agents/DialogoPublicar.tsx`**

```tsx
'use client';

import React from 'react';
import { Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';
import { ErroDaApi, agentesApi } from './agentesApi';
import { PainelDaVerificacao } from './PainelDaVerificacao';

/**
 * Publica o rascunho salvo como versão N+1. Aviso só passa com a confirmação marcada; o servidor verifica de novo e,
 * se achar outra coisa (422), o diálogo mostra a verificação dele e pede a confirmação outra vez.
 */
export function DialogoPublicar(props: {
  tenantId: string;
  agente: AgenteNoEditor;
  verificacao: ResultadoDaVerificacao;
  onFechar: () => void;
  onPublicado: (versao: number) => void;
  onConflito: (mensagem: string) => void;
}) {
  const { tenantId, agente, verificacao, onFechar, onPublicado, onConflito } = props;
  const [nota, setNota] = React.useState('');
  const [confirmou, setConfirmou] = React.useState(false);
  const [doServidor, setDoServidor] = React.useState<ResultadoDaVerificacao | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const atual = doServidor ?? verificacao;
  const proxima = (agente.publicada?.versao ?? 0) + 1;
  const precisaConfirmar = atual.avisos.length > 0;
  const bloqueado = atual.erros.length > 0;

  const publicar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await agentesApi.publicar(tenantId, agente.id, {
        versaoEsperada: agente.publicada?.versao ?? 0,
        revisao: agente.rascunho.revisao,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
        confirmarAvisos: confirmou ? atual.avisos.map((a) => a.codigo) : [],
      });
      onPublicado(r.versao);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 422 && e.verificacao) {
        setDoServidor(e.verificacao);
        setConfirmou(false);
        setErro(e.message);
      } else if (e instanceof ErroDaApi && e.status === 409) {
        onConflito(e.message);
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao publicar.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const numeros = agente.numeros.map((n) => n.nome).join(', ');
  return (
    <Modal isOpen onClose={enviando ? () => undefined : onFechar} title={`Publicar versão ${proxima}`} size="lg" bodyClassName="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {agente.numeros.length === 0
          ? 'Nenhum número está ligado a este agente ainda: a versão fica pronta para quando ligar.'
          : `As respostas ${agente.numeros.length === 1 ? 'do número' : 'dos números'} ${numeros} que começarem depois da publicação já saem com esta versão. Uma resposta que já estava sendo gerada ainda sai com a anterior.`}
      </p>
      <PainelDaVerificacao verificacao={atual} />
      {precisaConfirmar ? (
        <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
          <input type="checkbox" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} className="mt-1" />
          Li os avisos e quero publicar assim.
        </label>
      ) : null}
      <div>
        <label htmlFor="nota-da-versao" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Nota da versão (opcional)
        </label>
        <textarea
          id="nota-da-versao"
          value={nota}
          maxLength={200}
          rows={2}
          onChange={(e) => setNota(e.target.value)}
          placeholder="O que mudou, em uma frase"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white"
        />
        <p className="mt-1 text-right text-xs text-slate-500 dark:text-slate-400">{nota.length}/200</p>
      </div>
      {erro ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{erro}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          disabled={enviando}
          className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void publicar()}
          disabled={enviando || bloqueado || (precisaConfirmar && !confirmou)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {`Publicar versão ${proxima}`}
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 7: O editor — `features/agents/AgentEditorPage.tsx`**

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { Bot, ChevronRight, FlaskConical, Loader2, Pencil, Save, Send, X } from 'lucide-react';
import { AccessDenied } from '@/components/AccessDenied';
import { PageLoader } from '@/components/PageLoader';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import { VARIAVEIS_DO_PROMPT, verificarPrompt } from '@/lib/agents/verificarPrompt';
import { ErroDaApi, agentesApi } from './agentesApi';
import { DialogoPublicar } from './DialogoPublicar';
import { HistoricoDeVersoes } from './HistoricoDeVersoes';
import { LeituraDoPrompt } from './LeituraDoPrompt';
import { PainelDaVerificacao, resumoDaVerificacao } from './PainelDaVerificacao';
import { descreverVersao, formatarDataHora } from './formatos';

const PROXIMA_ENTREGA = 'Chega na próxima entrega';

/** As sete seções do mockup aprovado em 29/09. Nesta fatia só o Prompt abre. */
const SECOES = [
  { id: 'prompt', titulo: 'Prompt', subtitulo: 'Instruções e versões', ativa: true },
  { id: 'comportamento', titulo: 'Comportamento', subtitulo: 'Agrupar, dividir, memória, cutucada', ativa: false },
  { id: 'acoes', titulo: 'Ações', subtitulo: 'Agenda, etiquetas, repasse', ativa: false },
  { id: 'canais', titulo: 'Canais e funis', subtitulo: 'Números e funis que usam', ativa: false },
  { id: 'modelo', titulo: 'Modelo e custo', subtitulo: 'Modelo, tempo, custo', ativa: false },
  { id: 'conhecimento', titulo: 'Conhecimento', subtitulo: 'Blocos e base (fases 2 e 3)', ativa: false },
  { id: 'numeros', titulo: 'Números', subtitulo: 'Conversas, repasses, falhas', ativa: false },
] as const;

const BOTAO_SECUNDARIO =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-slate-200';
const BOTAO_PRINCIPAL =
  'inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Cópia local do texto não salvo, por cliente e agente. O `beforeunload` só protege o fechar da aba: navegar por um
 * link interno (a trilha, o menu, o seletor de cliente) desmonta o editor sem aviso (revisão do Codex, 07/10). Com a
 * cópia, quem volta ao agente recupera o texto. Armazenamento indisponível (janela anônima, bloqueio) só desliga a
 * recuperação; a tela funciona igual.
 */
type CopiaLocal = { texto: string; em: string };
const chaveDaCopia = (tenantId: string, agentId: string) => `central-agentes:texto-nao-salvo:${tenantId}:${agentId}`;

function lerCopia(chave: string): CopiaLocal | null {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return null;
    const lida = JSON.parse(bruto) as Partial<CopiaLocal>;
    return typeof lida.texto === 'string' && typeof lida.em === 'string' ? { texto: lida.texto, em: lida.em } : null;
  } catch {
    return null;
  }
}

function gravarCopia(chave: string, texto: string) {
  try {
    window.localStorage.setItem(chave, JSON.stringify({ texto, em: new Date().toISOString() }));
  } catch {
    // Sem armazenamento, sem recuperação: o aviso do navegador ao fechar a aba continua valendo.
  }
}

function apagarCopia(chave: string) {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    // Idem.
  }
}

/** Editor de um agente (Central de Agentes, fatia 2). Só agency_admin e o legado admin; a API recusa os outros. */
export function AgentEditorPage({ tenantId, agentId }: { tenantId: string; agentId: string }) {
  const { profile, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAgencyAdminRole(profile?.role)) {
    return <AccessDenied message="A Central de Agentes é da agência. Fale com quem administra a sua conta." />;
  }
  return <EditorDoAgente tenantId={tenantId} agentId={agentId} />;
}

function EditorDoAgente({ tenantId, agentId }: { tenantId: string; agentId: string }) {
  const { addToast } = useToast();
  const [agente, setAgente] = React.useState<AgenteNoEditor | null>(null);
  const [carregando, setCarregando] = React.useState(true);
  const [erro, setErro] = React.useState<string | null>(null);
  const [edicao, setEdicao] = React.useState<{ ativa: boolean; texto: string }>({ ativa: false, texto: '' });
  const [salvando, setSalvando] = React.useState(false);
  const [publicando, setPublicando] = React.useState(false);
  const [aba, setAba] = React.useState<'instrucoes' | 'versoes'>('instrucoes');
  // Outra aba ou pessoa salvou antes: a mensagem fica na tela e o texto de quem editava continua no campo.
  const [conflito, setConflito] = React.useState<string | null>(null);
  const [copia, setCopia] = React.useState<CopiaLocal | null>(null);
  const campo = React.useRef<HTMLTextAreaElement>(null);
  const chave = chaveDaCopia(tenantId, agentId);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await agentesApi.ler(tenantId, agentId);
      setAgente(r.agente);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o agente.');
    } finally {
      setCarregando(false);
    }
  }, [tenantId, agentId]);

  React.useEffect(() => {
    void carregar();
  }, [carregar]);

  const publicado = agente?.publicada?.prompt ?? null;
  const salvo = agente?.rascunho.prompt ?? publicado ?? '';
  const textoAtual = edicao.ativa ? edicao.texto : salvo;
  const sujo = edicao.ativa && edicao.texto !== salvo;
  const rascunhoComMudancas = agente?.rascunho.prompt != null && agente.rascunho.prompt !== publicado;
  const comAgenda = agente ? agente.numeros.filter((n) => n.temAgenda).length : 0;
  const verificacao = React.useMemo(
    () => verificarPrompt({ rascunho: textoAtual, publicado, numerosLigadosComAgenda: comAgenda }),
    [textoAtual, publicado, comAgenda],
  );

  // Fechar a aba com edição não salva pede confirmação do navegador.
  React.useEffect(() => {
    if (!sujo) return;
    const segurar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [sujo]);

  // Cada mudança não salva vai para a cópia local (navegação interna não passa pelo beforeunload).
  React.useEffect(() => {
    if (sujo) gravarCopia(chave, edicao.texto);
  }, [sujo, edicao.texto, chave]);

  // Na primeira leitura do agente: uma cópia diferente do texto salvo vira o aviso de recuperação; igual, é lixo.
  React.useEffect(() => {
    if (!agente) return;
    const lida = lerCopia(chave);
    if (!lida) return;
    if (lida.texto !== (agente.rascunho.prompt ?? agente.publicada?.prompt ?? '')) setCopia(lida);
    else apagarCopia(chave);
  }, [agente?.id, chave]);

  const motivoSemPublicar = edicao.ativa
    ? 'Salve ou cancele a edição antes de publicar.'
    : !rascunhoComMudancas
      ? 'O rascunho é igual à versão publicada.'
      : verificacao.erros.length > 0
        ? 'Corrija os erros da verificação antes de publicar.'
        : null;

  const salvar = async () => {
    if (!agente) return;
    setSalvando(true);
    try {
      await agentesApi.salvarRascunho(tenantId, agentId, { prompt: edicao.texto, revisao: agente.rascunho.revisao });
      addToast('Rascunho salvo.', 'success');
      apagarCopia(chave);
      setConflito(null);
      setEdicao({ ativa: false, texto: '' });
      await carregar();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Falha ao salvar o rascunho.', 'error');
      if (e instanceof ErroDaApi && e.status === 409) {
        // O texto de quem editava NÃO some (revisão do Codex, 07/10): recarrega para ter a revisão e o texto atuais
        // e deixa a escolha explícita, salvar o meu por cima ou descartar o meu.
        setConflito(e.message);
        await carregar();
      }
    } finally {
      setSalvando(false);
    }
  };

  const descartarOMeu = () => {
    apagarCopia(chave);
    setConflito(null);
    setEdicao({ ativa: false, texto: '' });
  };

  const cancelar = () => {
    if (!sujo || window.confirm('Descartar as mudanças não salvas?')) descartarOMeu();
  };

  const inserirVariavel = (nome: string) => {
    const marcador = `{{${nome}}}`;
    const el = campo.current;
    setEdicao((atual) => {
      const inicio = el?.selectionStart ?? atual.texto.length;
      const fim = el?.selectionEnd ?? atual.texto.length;
      return { ativa: true, texto: atual.texto.slice(0, inicio) + marcador + atual.texto.slice(fim) };
    });
  };

  if (carregando && !agente) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-500" aria-label="Carregando" />
      </div>
    );
  }
  if (erro || !agente) {
    return (
      <div role="alert" className="mx-auto mt-8 max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        {erro ?? 'Agente não encontrado.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <nav aria-label="Trilha" className="flex flex-wrap items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
        <Link href={`/platform/tenants/${tenantId}/agents`} className="hover:text-slate-900 dark:hover:text-white">
          Central de Agentes
        </Link>
        <ChevronRight size={14} aria-hidden="true" />
        <span>{agente.cliente.nome}</span>
        <ChevronRight size={14} aria-hidden="true" />
        <span className="font-medium text-slate-900 dark:text-white">{agente.nome}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Bot size={22} aria-hidden="true" className="text-brand-700 dark:text-brand-300" />
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{agente.nome}</h1>
          <span
            className={
              agente.numeros.length > 0
                ? 'rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200'
                : 'rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200'
            }
          >
            {agente.numeros.length === 0
              ? 'Nenhum número ligado'
              : `Atendendo ${agente.numeros.length === 1 ? '1 número' : `${agente.numeros.length} números`}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled title={PROXIMA_ENTREGA} className={BOTAO_SECUNDARIO}>
            <FlaskConical size={16} aria-hidden="true" />
            Testar sem enviar
          </button>
          <button
            type="button"
            onClick={() => setPublicando(true)}
            disabled={motivoSemPublicar !== null}
            title={motivoSemPublicar ?? undefined}
            className={BOTAO_PRINCIPAL}
          >
            <Send size={16} aria-hidden="true" />
            Publicar
          </button>
        </div>
      </header>

      <section aria-label="Versão" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-card">
        <span className="text-slate-800 dark:text-slate-100">
          {agente.publicada ? descreverVersao(agente.publicada) : 'Sem versão publicada'}
        </span>
        {rascunhoComMudancas ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            Rascunho com mudanças
          </span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400">Sem mudanças no rascunho</span>
        )}
        {rascunhoComMudancas && agente.rascunho.atualizadoEm ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {`salvo em ${formatarDataHora(agente.rascunho.atualizadoEm)}${agente.rascunho.atualizadoPor ? ` por ${agente.rascunho.atualizadoPor}` : ''}`}
          </span>
        ) : null}
        <span className="text-xs text-slate-500 dark:text-slate-400">{resumoDaVerificacao(verificacao)}</span>
      </section>

      {copia && !edicao.ativa ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <span>{`Você tem um texto não salvo deste agente, de ${formatarDataHora(copia.em)}.`}</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setAba('instrucoes');
                setEdicao({ ativa: true, texto: copia.texto });
                setCopia(null);
              }}
              className={BOTAO_SECUNDARIO}
            >
              Recuperar o texto
            </button>
            <button
              type="button"
              onClick={() => {
                apagarCopia(chave);
                setCopia(null);
              }}
              className={BOTAO_SECUNDARIO}
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Seções do agente" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {SECOES.map((secao) => (
            <button
              key={secao.id}
              type="button"
              disabled={!secao.ativa}
              aria-current={secao.ativa ? 'page' : undefined}
              title={secao.ativa ? undefined : PROXIMA_ENTREGA}
              className={
                secao.ativa
                  ? 'min-w-[160px] rounded-xl border border-brand-300 bg-brand-50 px-3 py-2 text-left dark:border-brand-500/40 dark:bg-brand-500/10'
                  : 'min-w-[160px] cursor-not-allowed rounded-xl border border-transparent px-3 py-2 text-left opacity-60'
              }
            >
              <span className="block text-sm font-semibold text-slate-900 dark:text-white">{secao.titulo}</span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">
                {secao.ativa ? secao.subtitulo : `${secao.subtitulo} · ${PROXIMA_ENTREGA}`}
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Prompt" className="flex gap-1 border-b border-slate-200 dark:border-white/10">
            {([['instrucoes', 'Instruções'], ['versoes', 'Versões']] as const).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={aba === id}
                disabled={edicao.ativa && aba !== id}
                title={edicao.ativa && aba !== id ? 'Salve ou cancele a edição antes.' : undefined}
                onClick={() => setAba(id)}
                className={`relative px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  aba === id
                    ? 'text-brand-700 dark:text-brand-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {rotulo}
                {aba === id ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-brand-600 dark:bg-brand-400" /> : null}
              </button>
            ))}
          </div>
          {aba === 'versoes' ? (
            <HistoricoDeVersoes
              tenantId={tenantId}
              agentId={agentId}
              versaoPublicada={agente.publicada?.versao ?? 0}
              revisao={agente.rascunho.revisao}
              onMudou={() => void carregar()}
            />
          ) : edicao.ativa ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Editando o rascunho</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {`${edicao.texto.length.toLocaleString('pt-BR')} caracteres`}
                </span>
              </div>
              {conflito ? (
                <div
                  role="alert"
                  className="mb-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
                >
                  <p>{`${conflito} O seu texto continua aqui, sem salvar.`}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void salvar()} disabled={salvando} className={BOTAO_SECUNDARIO}>
                      Salvar o meu por cima
                    </button>
                    <button type="button" onClick={descartarOMeu} disabled={salvando} className={BOTAO_SECUNDARIO}>
                      Descartar o meu e ver o atual
                    </button>
                  </div>
                </div>
              ) : null}
              <div role="group" aria-label="Inserir variável" className="mb-3 flex flex-wrap gap-1.5">
                {VARIAVEIS_DO_PROMPT.map((nome) => (
                  <button
                    key={nome}
                    type="button"
                    onClick={() => inserirVariavel(nome)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-800 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200"
                  >
                    {`{{${nome}}}`}
                  </button>
                ))}
              </div>
              <label htmlFor="prompt-do-agente" className="sr-only">Prompt do agente</label>
              <textarea
                id="prompt-do-agente"
                ref={campo}
                value={edicao.texto}
                spellCheck={false}
                onChange={(e) => setEdicao({ ativa: true, texto: e.target.value })}
                className="min-h-[480px] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm leading-6 text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white"
              />
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={cancelar} disabled={salvando} className={BOTAO_SECUNDARIO}>
                  <X size={14} aria-hidden="true" />
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void salvar()}
                  disabled={salvando || !sujo || conflito !== null || edicao.texto.length === 0 || edicao.texto.length > 50_000}
                  className={BOTAO_PRINCIPAL}
                >
                  {salvando ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                  Salvar rascunho
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  {rascunhoComMudancas ? 'Rascunho' : 'Prompt publicado'}
                </h2>
                <button type="button" onClick={() => setEdicao({ ativa: true, texto: salvo })} className={BOTAO_SECUNDARIO}>
                  <Pencil size={14} aria-hidden="true" />
                  Editar
                </button>
              </div>
              <LeituraDoPrompt texto={salvo} />
            </div>
          )}
          {aba === 'instrucoes' ? <PainelDaVerificacao verificacao={verificacao} /> : null}
        </div>
      </div>

      {publicando ? (
        <DialogoPublicar
          tenantId={tenantId}
          agente={agente}
          verificacao={verificacao}
          onFechar={() => setPublicando(false)}
          onPublicado={(versao) => {
            setPublicando(false);
            addToast(`Versão ${versao} publicada. As respostas que começarem a partir de agora já saem com ela.`, 'success');
            void carregar();
          }}
          onConflito={(mensagem) => {
            setPublicando(false);
            addToast(mensagem, 'error');
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: A rota de tela do editor**

Criar `app/(protected)/platform/tenants/[tenantId]/agents/[agentId]/page.tsx`:

```tsx
import { AgentEditorPage } from '@/features/agents/AgentEditorPage';

export default async function PlatformTenantAgentEditorRoute({
  params,
}: {
  params: Promise<{ tenantId: string; agentId: string }>;
}) {
  const { tenantId, agentId } = await params;
  // A chave remonta o editor ao trocar de cliente ou de agente: nenhum estado (texto, revisão, resposta atrasada) do
  // agente anterior sobrevive para ser enviado ao endereço novo (revisão do Codex, 07/10).
  return <AgentEditorPage key={`${tenantId}:${agentId}`} tenantId={tenantId} agentId={agentId} />;
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npx vitest run features/agents lib/tenancy components/navigation test/vocabularioCliente.test.ts`
Expected: PASS, inclusive `rotas de detalhe sob o cliente` com `/agents/[agentId]`.

Run, em outro comando: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 10: Commit**

```bash
git add features/agents lib/tenancy "app/(protected)/platform/tenants/[tenantId]/agents/[agentId]/page.tsx"
git diff --cached --stat
git commit -m "feat(central-agentes): editor do agente (leitura por secoes, verificacao ao vivo, salvar com revisao, publicar com confirmacao) e seletor de cliente sem 404 no detalhe"
```

---

### Task 9: Aviso na Central de I.A quando os números da chave já respondem por um agente

**Files:**
- Create: `lib/agents/numerosDaChave.ts` · Test: `lib/agents/numerosDaChave.test.ts`
- Modify: `lib/agents/migracaoAgentes.ts` (só exportar `lerConexoes` e o tipo `ConexaoLida`, o leitor paginado da fatia 1)
- Modify: `app/api/settings/ai-prompts/[key]/route.ts` (GET) · Test: `app/api/settings/ai-prompts/[key]/route.agentes.test.ts`
- Modify: `features/settings/components/AIFeaturesSection.tsx` · Test: `features/settings/components/AIFeaturesSection.agentes.test.tsx`

SPEC ("Rotas antigas depois de ligar"): a Central de I.A mostra, no editor do WhatsApp, quantos números daquela chave têm agente. Se todos têm, troca o editor por um aviso com link para a Central de Agentes; se só alguns têm, avisa que a edição vale apenas para os números sem agente. A contagem é do **servidor**, para a organização que a rota já usa (a do cookie do cliente atual, `requireAdminTenantContext`), com a mesma regra de chave efetiva do runtime (`resolveConversationAIAgentConfig`), e só para a agência (é quem edita prompt). `channel_connections` não tem policy para `authenticated`: a leitura é com a chave de serviço, filtrada pela organização. Se a contagem falhar, a rota devolve 500 e o editor fecha: editar sem saber se os números já usam agente seria às cegas.

A leitura das conexões é **paginada** (revisão do Codex, 07/10): o PostgREST corta a resposta no limite de linhas sem erro, e uma contagem parcial diria "nenhum número com agente" para quem tem. A fatia 1 já resolveu isso em `lerConexoes` (`lib/agents/migracaoAgentes.ts`, páginas de 500 por `id`); esta Task só passa a exportá-lo e o reusa.

- [ ] **Step 1: Teste da contagem (falha)**

Criar `lib/agents/numerosDaChave.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resumirNumerosDaChave } from './numerosDaChave';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';

type Linha = Record<string, unknown>;
const comparar = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** select, eq, gt, in, order, limit e await: o pedaço do supabase-js que a contagem e o leitor paginado usam. */
function fakeAdmin(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return consulta;
        },
        gt: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => comparar(l[coluna], valor) > 0);
          return consulta;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return consulta;
        },
        order: (coluna: string) => {
          linhas.sort((a, b) => comparar(a[coluna], b[coluna]));
          return consulta;
        },
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return consulta;
        },
        then: (ok: (r: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas, error: null }).then(ok, falhou),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const admin = fakeAdmin({
  channel_connections: [
    { id: 'c1', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N1', config: {}, ai_agent_id: 'a1' },
    { id: 'c2', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N2', config: { aiPromptKey: PADRAO }, ai_agent_id: null },
    { id: 'c3', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N3', config: { aiPromptKey: AURORA }, ai_agent_id: 'a2' },
    { id: 'c4', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N4', config: { aiPromptKey: 'task_nao_existe' }, ai_agent_id: null },
    { id: 'c5', organization_id: OUTRA, provider: 'evolution', channel_type: 'whatsapp', name: 'N5', config: {}, ai_agent_id: 'a9' },
    { id: 'c6', organization_id: ORG, provider: 'outro', channel_type: 'whatsapp', name: 'N6', config: {}, ai_agent_id: null },
  ],
  ai_agents: [
    { id: 'a1', organization_id: ORG, name: 'Julia' },
    { id: 'a2', organization_id: ORG, name: 'Aurora' },
    { id: 'a9', organization_id: OUTRA, name: 'De outro cliente' },
  ],
});

describe('resumirNumerosDaChave', () => {
  it('chave padrão: conta o número sem chave e o com a chave explícita; só um tem agente', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, PADRAO)).toEqual({
      organizationId: ORG,
      numerosDaChave: 2,
      numerosComAgente: 1,
      agentes: [{ id: 'a1', nome: 'Julia' }],
    });
  });

  it('chave da Aurora: o único número tem agente', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, AURORA)).toEqual({
      organizationId: ORG,
      numerosDaChave: 1,
      numerosComAgente: 1,
      agentes: [{ id: 'a2', nome: 'Aurora' }],
    });
  });

  it('chave que não é de conversa (assistente do CRM) não tem números: null', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, 'agent_crm_base_instructions')).toBeNull();
  });

  it('com mais de mil números, a leitura vem em páginas e nenhum fica de fora da conta', async () => {
    const muitas = Array.from({ length: 1203 }, (_, i) => ({
      id: `n${String(i).padStart(5, '0')}`, organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp',
      name: `N${i}`, config: {}, ai_agent_id: i % 2 === 0 ? 'a1' : null,
    }));
    const grande = fakeAdmin({ channel_connections: muitas, ai_agents: [{ id: 'a1', organization_id: ORG, name: 'Julia' }] });
    expect(await resumirNumerosDaChave(grande, ORG, PADRAO)).toEqual({
      organizationId: ORG,
      numerosDaChave: 1203,
      numerosComAgente: 602,
      agentes: [{ id: 'a1', nome: 'Julia' }],
    });
  });
});
```

Run: `npx vitest run lib/agents/numerosDaChave.test.ts`
Expected: FAIL com `Failed to resolve import "./numerosDaChave"`.

- [ ] **Step 2: Implementar `lib/agents/numerosDaChave.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { isConversationAIPromptKey, resolveConversationAIAgentConfig } from '@/lib/conversations/aiAgentConfig';
import { lerConexoes } from './migracaoAgentes';

export type ResumoDaChave = {
  organizationId: string;
  numerosDaChave: number;
  numerosComAgente: number;
  agentes: Array<{ id: string; nome: string }>;
};

/**
 * Quantos números (Evolution) da organização respondem com esta chave de prompt e quantos deles estão ligados a um
 * agente (SPEC, "Rotas antigas depois de ligar"). Número ligado usa a versão publicada do agente: editar a chave não muda
 * nada nele. A chave efetiva sai da mesma regra do runtime (resolveConversationAIAgentConfig): vazia = a padrão,
 * inválida = nenhuma. channel_connections não tem policy para authenticated: chave de serviço, filtrada pela organização.
 */
export async function resumirNumerosDaChave(
  admin: SupabaseClient,
  organizationId: string,
  promptKey: string,
): Promise<ResumoDaChave | null> {
  if (!isConversationAIPromptKey(promptKey)) return null;
  // Em páginas por id: uma leitura só seria cortada no limite do PostgREST, sem erro, e a conta sairia menor.
  const conexoes = await lerConexoes(admin, organizationId);
  const daChave = conexoes.filter(
    (c) => resolveConversationAIAgentConfig(c.config as Record<string, unknown> | null).promptKey === promptKey,
  );
  const ids = [...new Set(daChave.map((c) => c.ai_agent_id as string | null).filter((id): id is string => Boolean(id)))];
  let agentes: Array<{ id: string; nome: string }> = [];
  if (ids.length > 0) {
    const lidos = await admin.from('ai_agents').select('id, name').eq('organization_id', organizationId).in('id', ids);
    if (lidos.error) throw new Error(`ai_agents: ${lidos.error.message}`);
    agentes = (lidos.data ?? []).map((a) => ({ id: a.id as string, nome: a.name as string }));
  }
  return {
    organizationId,
    numerosDaChave: daChave.length,
    numerosComAgente: daChave.filter((c) => Boolean(c.ai_agent_id)).length,
    agentes,
  };
}
```

Antes de rodar, em `lib/agents/migracaoAgentes.ts`, trocar `type ConexaoLida = {` por `export type ConexaoLida = {` e
`async function lerConexoes(` por `export async function lerConexoes(`. Nada mais muda nesse arquivo.

Run: `npx vitest run lib/agents/numerosDaChave.test.ts lib/agents/migracaoAgentes.test.ts`
Expected: PASS (4 testes da contagem, e os da migração da fatia 1 como estavam).

- [ ] **Step 3: Teste da rota (falha)**

Criar `app/api/settings/ai-prompts/[key]/route.agentes.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'task_conversations_whatsapp_auto_reply';
const ADMIN = { papel: 'admin' };

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resumir: vi.fn() }));
vi.mock('@/lib/platform/adminTenantContext', () => ({ requireAdminTenantContext: mocks.auth }));
vi.mock('@/lib/agents/numerosDaChave', () => ({ resumirNumerosDaChave: mocks.resumir }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        order: () => consulta,
        limit: () => Promise.resolve({ data: [{ key: CHAVE, content: 'texto', version: 1, is_active: true }], error: null }),
      };
      return consulta;
    },
  }),
  createStaticAdminClient: () => ADMIN,
}));

import { GET } from './route';

const chamar = () => GET(new Request('http://localhost/api/settings/ai-prompts/x'), { params: Promise.resolve({ key: CHAVE }) });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/settings/ai-prompts/[key] — números com agente', () => {
  it('agência: devolve o resumo dos números da chave, contado para a organização da rota', async () => {
    const resumo = { organizationId: ORG, numerosDaChave: 2, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] };
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: true });
    mocks.resumir.mockResolvedValue(resumo);
    const corpo = await (await chamar()).json();
    expect(corpo.agentes).toEqual(resumo);
    expect(corpo.active).toMatchObject({ key: CHAVE, is_active: true });
    expect(mocks.resumir).toHaveBeenCalledWith(ADMIN, ORG, CHAVE);
  });

  it('admin do cliente: sem resumo (só a agência edita prompt)', async () => {
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: false });
    const corpo = await (await chamar()).json();
    expect(corpo.agentes).toBeNull();
    expect(mocks.resumir).not.toHaveBeenCalled();
  });

  it('falha ao contar: 500 sem o detalhe interno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: true });
    mocks.resumir.mockRejectedValue(new Error('channel_connections: relation x'));
    const r = await chamar();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('relation');
  });
});
```

Run: `npx vitest run "app/api/settings/ai-prompts/[key]/route.agentes.test.ts"`
Expected: FAIL (`corpo.agentes` é `undefined`).

- [ ] **Step 4: Ligar a contagem na rota**

Em `app/api/settings/ai-prompts/[key]/route.ts`:
- trocar a linha `import { createClient } from '@/lib/supabase/server';` por:

```ts
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { resumirNumerosDaChave, type ResumoDaChave } from '@/lib/agents/numerosDaChave';
```

- trocar o fim do `GET` (de `const active = ...` até `return json({ key, active, versions: data || [] });`) por:

```ts
  const active = (data || []).find((row) => row.is_active) || null;

  // Central de Agentes (fatia 2): quantos números desta chave já respondem por um agente. Só para a agência, que é
  // quem edita prompt. Sem essa resposta o editor não abre (a tela fecha no erro): editar às cegas teria efeito nenhum.
  let agentes: ResumoDaChave | null = null;
  if (auth.isAgencyAdmin) {
    try {
      agentes = await resumirNumerosDaChave(createStaticAdminClient(), auth.targetOrganizationId, key);
    } catch (erro) {
      console.error('[ai-prompts]', 'numeros com agente', { message: erro instanceof Error ? erro.message : String(erro) });
      return json({ error: 'Não foi possível conferir agora os números que usam este prompt. Tente de novo em instantes.' }, 500);
    }
  }
  return json({ key, active, versions: data || [], agentes });
```

Run: `npx vitest run "app/api/settings/ai-prompts/[key]/route.agentes.test.ts"`
Expected: PASS (3 testes).

- [ ] **Step 5: Teste do aviso na tela (falha)**

Criar `features/settings/components/AIFeaturesSection.agentes.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'agency_admin' } }) }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ aiFeatureFlags: {}, setAIFeatureFlag: vi.fn() }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ addToast: toast, showToast: toast }) }));

import { AIFeaturesSection } from './AIFeaturesSection';

const ORG = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'task_conversations_whatsapp_auto_reply';

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

function abrirAtendimentoWhatsApp(fetchMock: ReturnType<typeof vi.fn>) {
  render(<AIFeaturesSection />);
  // "Atendimento WhatsApp" é a 7ª linha de FEATURES (AIFeaturesSection.tsx); a URL pedida confirma a linha.
  fireEvent.click(screen.getAllByRole('button', { name: 'Editar prompt' })[6]);
  expect(fetchMock).toHaveBeenCalledWith(`/api/settings/ai-prompts/${CHAVE}`, expect.anything());
}

beforeEach(() => toast.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('Central de I.A — números da chave com agente', () => {
  it('todos com agente: aviso com link no lugar do editor, sem Salvar nem Reset', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 1, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByText(/O número que usa este prompt responde por um agente da Central de Agentes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Editar Julia na Central de Agentes' })).toHaveAttribute('href', `/platform/tenants/${ORG}/agents/a1`);
    expect(screen.queryByPlaceholderText('Cole ou edite o prompt aqui...')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset/ })).toBeNull();
  });

  it('só alguns com agente: avisa que a edição vale para os outros e mantém o editor', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 3, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByText('1 de 3 números que usam este prompt respondem por um agente. Esta edição vale só para os outros 2.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Cole ou edite o prompt aqui...')).toBeInTheDocument();
  });

  it('nenhum com agente: o editor de sempre, sem aviso', async () => {
    const fetchMock = vi.fn(() => responder({
      key: CHAVE, active: null, versions: [],
      agentes: { organizationId: ORG, numerosDaChave: 2, numerosComAgente: 0, agentes: [] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    expect(await screen.findByPlaceholderText('Cole ou edite o prompt aqui...')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a contagem falhou: avisa e fecha o editor', async () => {
    const fetchMock = vi.fn(() => responder({ error: 'Não foi possível conferir agora.' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    abrirAtendimentoWhatsApp(fetchMock);

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Não foi possível conferir agora.', 'error'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

Run: `npx vitest run features/settings/components/AIFeaturesSection.agentes.test.tsx`
Expected: FAIL (o aviso não existe; no caso de falha o modal continua aberto).

- [ ] **Step 6: Implementar o aviso em `features/settings/components/AIFeaturesSection.tsx`**

1. Logo depois do tipo `FeatureItem`, acrescentar:

```ts
/** Resposta do GET /api/settings/ai-prompts/[key] (Central de Agentes, fatia 2). */
type ResumoDosAgentes = {
  organizationId: string;
  numerosDaChave: number;
  numerosComAgente: number;
  agentes: Array<{ id: string; nome: string }>;
};
```

2. Depois de `const [promptResetting, setPromptResetting] = useState(false);`, acrescentar:

```ts
  const [resumoAgentes, setResumoAgentes] = useState<ResumoDosAgentes | null>(null);
  const todosComAgente = Boolean(
    resumoAgentes && resumoAgentes.numerosDaChave > 0 && resumoAgentes.numerosComAgente === resumoAgentes.numerosDaChave,
  );
```

3. Em `openPromptEditor`, logo depois de `setPromptDraft(nextPrompt || '');`, acrescentar:

```ts
      setResumoAgentes((data?.agentes as ResumoDosAgentes | null | undefined) ?? null);
```

e trocar o `catch` dessa mesma função:

```ts
    } catch (error: any) {
      showToast(error?.message || 'Falha ao carregar prompt', 'error');
      setPromptDraft('');
    } finally {
```

por:

```ts
    } catch (error: any) {
      showToast(error?.message || 'Falha ao carregar prompt', 'error');
      setPromptDraft('');
      // Sem saber se os números desta chave já respondem por um agente, editar seria às cegas: o editor fecha.
      setPromptEditorOpen(false);
      setEditingFeature(null);
    } finally {
```

4. Em `closePromptEditor`, depois de `setPromptDraft('');`, acrescentar `setResumoAgentes(null);`.

5. Dentro do `<Modal>`, trocar o bloco que vai de `{promptLoading ? (` até o fechamento da `<div className="flex items-center justify-between gap-2 pt-2">` (os botões Reset, Fechar e Salvar) por:

```tsx
            {resumoAgentes && resumoAgentes.numerosComAgente > 0 ? (
              <AvisoDosAgentes resumo={resumoAgentes} todos={todosComAgente} />
            ) : null}

            {todosComAgente ? null : promptLoading ? (
              <div className="flex min-h-[280px] items-center justify-center text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Carregando prompt...
                </div>
              </div>
            ) : (
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                placeholder="Cole ou edite o prompt aqui..."
                className="min-h-[280px] w-full resize-y rounded-xl border border-slate-200 bg-white p-4 font-mono text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white"
              />
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              {todosComAgente ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={resetPromptOverride}
                  disabled={!isAdmin || promptResetting || promptSaving}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${
                    !isAdmin || promptResetting || promptSaving
                      ? 'cursor-not-allowed border-slate-200 text-slate-400 dark:border-white/10'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5'
                  }`}
                >
                  {promptResetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                  Reset
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closePromptEditor}
                  disabled={promptSaving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  Fechar
                </button>
                {todosComAgente ? null : (
                  <button
                    type="button"
                    onClick={savePromptOverride}
                    disabled={!isAdmin || promptSaving || promptLoading || !promptDraft.trim()}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${
                      !isAdmin || promptSaving || promptLoading || !promptDraft.trim()
                        ? 'cursor-not-allowed bg-slate-300 dark:bg-white/10'
                        : 'bg-brand-600 hover:bg-brand-700'
                    }`}
                  >
                    {promptSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                    Salvar
                  </button>
                )}
              </div>
            </div>
```

(o Reset, o Fechar e o Salvar ficam com as mesmas classes e o mesmo comportamento de hoje; só passam a sumir quando todos os números da chave têm agente).

6. No fim do arquivo, acrescentar:

```tsx
function AvisoDosAgentes({ resumo, todos }: { resumo: ResumoDosAgentes; todos: boolean }) {
  const semAgente = resumo.numerosDaChave - resumo.numerosComAgente;
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="font-semibold">
        {todos
          ? resumo.numerosDaChave === 1
            ? 'O número que usa este prompt responde por um agente da Central de Agentes. Editar aqui não muda nada nele.'
            : `Os ${resumo.numerosDaChave} números que usam este prompt respondem por agentes da Central de Agentes. Editar aqui não muda nada neles.`
          : `${resumo.numerosComAgente} de ${resumo.numerosDaChave} números que usam este prompt respondem por um agente. Esta edição vale só para ${semAgente === 1 ? 'o outro número' : `os outros ${semAgente}`}.`}
      </p>
      <ul className="mt-2 space-y-1">
        {resumo.agentes.map((agente) => (
          <li key={agente.id}>
            <a href={`/platform/tenants/${resumo.organizationId}/agents/${agente.id}`} className="font-medium underline underline-offset-2">
              {`Editar ${agente.nome} na Central de Agentes`}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Rodar e ver passar, junto com as travas de texto que já existiam**

Run: `npx vitest run features/settings "app/api/settings/ai-prompts" lib/agents/numerosDaChave.test.ts test/c2bGovernancaIa.test.ts test/vocabularioCliente.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/agents/numerosDaChave.ts lib/agents/numerosDaChave.test.ts lib/agents/migracaoAgentes.ts "app/api/settings/ai-prompts/[key]" features/settings/components/AIFeaturesSection.tsx features/settings/components/AIFeaturesSection.agentes.test.tsx
git diff --cached --stat
git commit -m "feat(central-agentes): Central de I.A avisa quando os numeros da chave ja respondem por um agente (contagem no servidor)"
```

---

### Task 10: PATCH da conexão recusa `aiPromptKey` num número ligado (409)

**Files:**
- Modify: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts` (ordem da leitura, recusa e gravação condicionada)
- Modify: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts` (o banco falso ganha `.is()` e `.maybeSingle()` na gravação)
- Test: `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.agente.test.ts`

Num número ligado, o texto vem da versão publicada do agente e a chave não tem efeito. Nenhuma tela manda `aiPromptKey` hoje (só a rota aceita); a recusa vale para qualquer pedido com o campo, igual ou diferente do gravado. Os outros campos continuam editáveis: pausar a IA de um número ligado tem que funcionar.

Duas garantias, da revisão do Codex de 07/10:
- **Nada é gravado antes da recusa.** Hoje a rota vincula o cliente à agência (`ensureTenantAgencyBinding`, que grava `organization_editions`) **antes** de ler a conexão (`route.ts`, linhas 68-91 contra 93-101, em `6a29238`). A leitura da conexão passa para antes dessa vinculação, e a recusa vem logo depois dela.
- **A recusa vale também para uma ligação feita entre a leitura e a gravação.** Quando o pedido traz `aiPromptKey`, a gravação só pega a linha com `ai_agent_id is null`. Se não pegar nenhuma, a rota relê: número ligado vira 409, número sumido vira 404. Nunca 200 com a chave gravada num número ligado.

- [ ] **Step 1: Testes que falham**

Criar `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.agente.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const requireTenantAccessMock = vi.fn();
const bindingMock = vi.fn();
const updateMock = vi.fn();
const condicaoMock = vi.fn();
const baseConfig = { apiUrl: 'https://evolution.example.com', instanceName: 'comercial-a1b2', webhookSecret: 'S', apiKey: 'K', sendMode: 'number_text' };
const SEM_AGENTE = { id: CONNECTION, config: baseConfig, metadata: {}, ai_agent_id: null };
const LIGADO = { id: CONNECTION, config: baseConfig, metadata: {}, ai_agent_id: AGENTE };
/** Cada leitura de channel_connections consome o próximo item: a primeira é a da rota, a segunda é a releitura. */
let leituras: Array<Record<string, unknown> | null> = [];
/** O que a gravação devolve: a linha gravada, ou nenhuma (a condição não casou). */
let gravacaoCasa = true;

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: (role: unknown) => role === 'agency_admin' }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  ensureTenantAgencyBinding: (...args: unknown[]) => bindingMock(...args),
  resolveEvolutionCredentials: vi.fn(),
}));
vi.mock('@/lib/channels/evolution', () => ({ logoutEvolutionInstance: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === 'ai_agents') {
        const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: { name: 'Aurora' }, error: null }) };
        return consulta;
      }
      const leitura = {
        select: () => leitura,
        eq: () => leitura,
        maybeSingle: () => Promise.resolve({ data: leituras.shift() ?? null, error: null }),
      };
      return {
        select: () => leitura,
        update: (updates: Record<string, unknown>) => {
          updateMock(updates);
          const linha = {
            id: CONNECTION, provider: 'evolution', channel_type: 'whatsapp', name: 'Comercial', status: 'connected', config: updates.config, metadata: {},
          };
          const resposta = () => Promise.resolve({ data: gravacaoCasa ? linha : null, error: null });
          const encadeamento = {
            eq: () => encadeamento,
            is: (coluna: string, valor: unknown) => {
              condicaoMock(coluna, valor);
              return encadeamento;
            },
            select: () => ({ single: resposta, maybeSingle: resposta }),
          };
          return encadeamento;
        },
      };
    },
  }),
}));

import { PATCH } from './route';

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  gravacaoCasa = true;
  // Admin da agência entrando no cliente: é o caminho que passa pela vinculação do cliente à agência.
  requireTenantAccessMock.mockResolvedValue({ profile: { role: 'agency_admin', organization_id: 'org-agencia' }, canManageChannelConfig: true });
});

describe('PATCH da conexão — número ligado a um agente', () => {
  it('aiPromptKey num número ligado: 409 com o nome do agente, sem gravar nada, nem a vinculação à agência', async () => {
    leituras = [LIGADO];
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(409);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ code: 'NUMERO_COM_AGENTE', agentId: AGENTE });
    expect(corpo.error).toContain('Aurora');
    expect(updateMock).not.toHaveBeenCalled();
    expect(bindingMock).not.toHaveBeenCalled();
  });

  it('número ligado: os outros campos continuam editáveis (pausar a IA no número), sem a condição da chave', async () => {
    leituras = [LIGADO];
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(condicaoMock).not.toHaveBeenCalled();
  });

  it('número sem agente: aiPromptKey continua aceita, gravada só se ele seguir sem agente', async () => {
    leituras = [SEM_AGENTE];
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(200);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({ config: { aiPromptKey: AURORA } });
    expect(condicaoMock).toHaveBeenCalledWith('ai_agent_id', null);
  });

  it('ligação feita entre a leitura e a gravação: a gravação não pega a linha e a resposta é 409, nunca 200', async () => {
    leituras = [SEM_AGENTE, LIGADO];
    gravacaoCasa = false;
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'NUMERO_COM_AGENTE', agentId: AGENTE });
  });

  it('número que sumiu entre a leitura e a gravação: 404', async () => {
    leituras = [SEM_AGENTE, null];
    gravacaoCasa = false;
    expect((await patch({ config: { aiPromptKey: AURORA } })).status).toBe(404);
  });
});
```

Run: `npx vitest run "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.agente.test.ts"`
Expected: FAIL. O primeiro teste dá 200 e a vinculação foi chamada, o terceiro não vê a condição e os dois últimos dão 200.

- [ ] **Step 2: Ajustar o banco falso de `route.patch.test.ts`**

O teste "configura a identidade e o prompt da Aurora" desse arquivo manda `aiPromptKey` num número sem agente. Com a gravação condicionada, o encadeamento passa por `.is()` e termina em `.maybeSingle()`. Trocar o bloco `update: (updates: Record<string, unknown>) => { ... },` do mock (linhas 47-69 em `6a29238`) por:

```ts
      update: (updates: Record<string, unknown>) => {
        updateMock(updates);
        const resposta = () =>
          Promise.resolve({
            data: {
              id: CONNECTION,
              provider: 'evolution',
              channel_type: 'whatsapp',
              name: 'Comercial',
              status: 'connected',
              config: updates.config,
              metadata: { phoneNumber: '5511999' },
            },
            error: null,
          });
        // Com aiPromptKey no pedido a rota condiciona a gravação a `ai_agent_id is null` (Central de Agentes, fatia 2).
        const encadeamento = {
          eq: () => encadeamento,
          is: () => encadeamento,
          select: () => ({ single: resposta, maybeSingle: resposta }),
        };
        return encadeamento;
      },
```

Nenhuma asserção desse arquivo muda.

- [ ] **Step 3: Implementar a ordem nova, a recusa e a gravação condicionada**

Em `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`:

1. Logo depois da função `json` (linha 17), acrescentar:

```ts
/** 409 para a chave de prompt num número ligado a um agente, com o nome dele (Central de Agentes, fatia 2). */
async function recusarNumeroComAgente(admin: ReturnType<typeof createStaticAdminClient>, tenantId: string, agentId: string) {
  const agente = await admin.from('ai_agents').select('name').eq('id', agentId).eq('organization_id', tenantId).maybeSingle();
  if (agente.error) return json({ error: agente.error.message }, 500);
  const quem = agente.data?.name ? `pelo agente ${agente.data.name}` : 'por um agente';
  return json(
    {
      error: `Este número responde ${quem}: a chave de prompt não tem efeito aqui. Edite o prompt na Central de Agentes.`,
      code: 'NUMERO_COM_AGENTE',
      agentId,
    },
    409,
  );
}
```

2. No `PATCH`, **recortar** o bloco da leitura `const current = await admin ... if (!current.data) return json({ error: 'Channel not found' }, 404);` (hoje logo depois da vinculação) e colá-lo logo depois de `const admin = createStaticAdminClient();`, trocando `.select('id, config, metadata')` por `.select('id, config, metadata, ai_agent_id')`. Logo depois do `404`, ainda antes do bloco `if (isAgencyAdminRole(...))` da vinculação, acrescentar:

```ts
  // Central de Agentes, fatia 2: num número ligado a um agente, o texto vem da versão publicada e a chave de prompt
  // não tem efeito. Mudança sem efeito é pior que mudança recusada (SPEC, "Rotas antigas depois de ligar"). A recusa
  // vem antes de qualquer gravação, inclusive a vinculação do cliente à agência logo abaixo.
  const pedeChaveDePrompt = parsed.data.config?.aiPromptKey !== undefined;
  if (pedeChaveDePrompt && current.data.ai_agent_id) {
    return recusarNumeroComAgente(admin, tenantId, current.data.ai_agent_id);
  }
```

3. Trocar a gravação final, de `const { data, error } = await admin` até `if (error) return json({ error: error.message }, 500);`, por:

```ts
  const colunas = 'id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at';
  const gravacao = admin
    .from('channel_connections')
    .update(updates)
    .eq('id', connectionId)
    .eq('organization_id', tenantId);
  // Com a chave de prompt no pedido, a gravação só pega o número que continua sem agente: uma ligação feita entre a
  // leitura acima e esta gravação faz a linha não casar, e a resposta vira 409 em vez de 200 (revisão do Codex, 07/10).
  const { data, error } = pedeChaveDePrompt
    ? await gravacao.is('ai_agent_id', null).select(colunas).maybeSingle()
    : await gravacao.select(colunas).single();

  if (error) return json({ error: error.message }, 500);
  if (!data) {
    const relida = await admin
      .from('channel_connections')
      .select('ai_agent_id')
      .eq('id', connectionId)
      .eq('organization_id', tenantId)
      .maybeSingle();
    if (relida.error) return json({ error: relida.error.message }, 500);
    if (relida.data?.ai_agent_id) return recusarNumeroComAgente(admin, tenantId, relida.data.ai_agent_id);
    return json({ error: 'Channel not found' }, 404);
  }
```

O resto do `PATCH` (o `return json({ ok: true, channel: ... })`) fica como está.

- [ ] **Step 4: Rodar e ver passar, junto com os testes da rota que já existiam**

Run: `npx vitest run "app/api/platform/tenants/[tenantId]/channels/[connectionId]"`
Expected: PASS (os 5 novos e todos os de `route.patch.test.ts` e `route.test.ts`, sem mudar asserção nenhuma).

Run, em outro comando: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts" "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.agente.test.ts" "app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.patch.test.ts"
git diff --cached --stat
git commit -m "feat(central-agentes): PATCH da conexao recusa aiPromptKey em numero ligado (409 antes de qualquer gravacao, gravacao condicionada a seguir sem agente)"
```

---

### Task 11: Trava das chaves migradas no catálogo

**Files:**
- Create: `lib/ai/prompts/migrated-prompts.lock.json`
- Modify: `lib/ai/prompts/catalog.ts` (aviso no topo das duas entradas; o texto dos prompts não muda)
- Test: `lib/ai/prompts/migratedPromptsLock.test.ts`

Depois da migração, editar o catálogo não muda Aurora nem Julia nos números ligados: elas respondem pela versão publicada do agente. Sem a trava, a mudança passaria nos testes, iria para produção e não teria efeito, sem erro nenhum (SPEC, decisão "Catálogo no código"). A trava guarda o sha256 e o tamanho de cada chave migrada, medidos em 07/10 no `main` `6a29238` (Task 3, tabela). `task_conversations_whatsapp_auto_reply` é também a chave **padrão**: números de outros clientes sem chave definida continuam lendo esse texto; por isso a decisão diante de uma mudança é explícita.

- [ ] **Step 1: Criar a trava**

Criar `lib/ai/prompts/migrated-prompts.lock.json`:

```json
{
  "_leia": "Chaves do catálogo migradas para a Central de Agentes (fatia 2). Números ligados a um agente respondem pela versão publicada do agente, não por este texto. Mudar o texto de uma chave daqui quebra migratedPromptsLock.test.ts de propósito. Antes de mexer, decida: (a) a mudança é para os números com agente: desfaça no catálogo e edite o agente na Central de Agentes; (b) a mudança é para os números SEM agente: atualize sha256 e caracteres abaixo no mesmo commit, dizendo na mensagem que é para os números sem agente.",
  "chaves": {
    "task_conversations_whatsapp_cenno_aurora": {
      "sha256": "e7b24641f3222182ea90e0b57ec01913715bf4badc657aeebf8f419173b02161",
      "caracteres": 20202,
      "agente": "Aurora, da Cenno Hub"
    },
    "task_conversations_whatsapp_auto_reply": {
      "sha256": "b4287844d2ad39e41e08b7b413a51b53933ae32589f748cc663a096b33293f62",
      "caracteres": 2569,
      "agente": "Julia, da Dra. Jéssica",
      "observacao": "É também a chave padrão: números sem chave definida, de qualquer cliente, continuam lendo este texto."
    }
  }
}
```

- [ ] **Step 2: Teste da trava**

Criar `lib/ai/prompts/migratedPromptsLock.test.ts`:

```ts
// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPromptCatalogMap } from './catalog';

type Trava = {
  _leia: string;
  chaves: Record<string, { sha256: string; caracteres: number; agente: string; observacao?: string }>;
};

const trava = JSON.parse(readFileSync(resolve(process.cwd(), 'lib/ai/prompts/migrated-prompts.lock.json'), 'utf8')) as Trava;
const catalogo = getPromptCatalogMap() as Record<string, { defaultTemplate: string }>;
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

describe('trava das chaves migradas para a Central de Agentes', () => {
  it('lista as duas chaves migradas, e as duas existem no catálogo (o detector funciona)', () => {
    expect(Object.keys(trava.chaves).sort()).toEqual(['task_conversations_whatsapp_auto_reply', 'task_conversations_whatsapp_cenno_aurora']);
    for (const [chave, item] of Object.entries(trava.chaves)) {
      expect(catalogo[chave], chave).toBeDefined();
      expect(item.sha256, chave).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it.each(Object.entries(trava.chaves))('%s: o texto do catálogo é o que foi migrado', (chave, item) => {
    const texto = catalogo[chave].defaultTemplate;
    expect(
      sha256(texto),
      `O texto de "${chave}" mudou no catálogo. Os números ligados ao agente (${item.agente}) respondem pela versão publicada na Central de Agentes, não por este texto. ${trava._leia}`,
    ).toBe(item.sha256);
    expect(texto.length, chave).toBe(item.caracteres);
  });

  it('as duas chaves têm o aviso logo acima, no catálogo', () => {
    const fonte = readFileSync(resolve(process.cwd(), 'lib/ai/prompts/catalog.ts'), 'utf8');
    for (const chave of Object.keys(trava.chaves)) {
      const posicao = fonte.indexOf(`key: '${chave}'`);
      expect(posicao, chave).toBeGreaterThan(-1);
      expect(fonte.slice(Math.max(0, posicao - 600), posicao), `${chave}: falta o aviso logo acima da entrada`).toContain('MIGRADO PARA A CENTRAL DE AGENTES');
    }
  });
});
```

Run: `npx vitest run lib/ai/prompts/migratedPromptsLock.test.ts`
Expected: FAIL só em "as duas chaves têm o aviso logo acima" (os dois sha256 já batem).

- [ ] **Step 3: O aviso no topo das duas entradas**

Em `lib/ai/prompts/catalog.ts`, trocar:

```ts
  {
    key: 'task_conversations_whatsapp_auto_reply',
```

por:

```ts
  {
    // MIGRADO PARA A CENTRAL DE AGENTES (fatia 2). Números ligados a um agente respondem pela versão publicada do
    // agente, não por este texto. Esta é também a chave padrão: números sem chave definida continuam lendo daqui.
    // Mudar o texto quebra lib/ai/prompts/migratedPromptsLock.test.ts de propósito; leia migrated-prompts.lock.json.
    key: 'task_conversations_whatsapp_auto_reply',
```

e trocar:

```ts
  {
    key: 'task_conversations_whatsapp_cenno_aurora',
```

por:

```ts
  {
    // MIGRADO PARA A CENTRAL DE AGENTES (fatia 2). Os números ligados ao agente Aurora respondem pela versão publicada
    // dele, não por este texto: mudar aqui não muda a Aurora. Mudar o texto quebra
    // lib/ai/prompts/migratedPromptsLock.test.ts de propósito; leia migrated-prompts.lock.json.
    key: 'task_conversations_whatsapp_cenno_aurora',
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/ai/prompts`
Expected: PASS (inclusive os testes da Aurora que já existiam: o texto não mudou, só o comentário).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/prompts/migrated-prompts.lock.json lib/ai/prompts/migratedPromptsLock.test.ts lib/ai/prompts/catalog.ts
git diff --cached --stat
git commit -m "feat(central-agentes): trava das chaves migradas no catalogo (sha256 da Aurora e da Julia, aviso no topo das duas)"
```

O `--stat` de `catalog.ts` tem que mostrar só as 6 linhas de comentário acrescentadas.

- [ ] **Step 6: Provar que a trava pega uma mudança (nada é commitado)**

Trocar uma letra dentro do `defaultTemplate` da Julia em `lib/ai/prompts/catalog.ts` e rodar `npx vitest run lib/ai/prompts/migratedPromptsLock.test.ts`.
Expected: FAIL com a mensagem `O texto de "task_conversations_whatsapp_auto_reply" mudou no catálogo...`.

Desfazer com `git checkout -- lib/ai/prompts/catalog.ts` (volta ao commit do Step 5) e conferir `git status --short` vazio.

---

### Task 12: Script de ligação lê o webhook do número na Evolution e libera a produção

**Files:**
- Create: `lib/agents/webhookDoNumero.ts` · Test: `lib/agents/webhookDoNumero.test.ts` e `lib/agents/webhookDoNumero.real.test.ts`
- Create: `lib/agents/modoDaMigracao.ts` · Test: `lib/agents/modoDaMigracao.test.ts`
- Modify: `lib/agents/publicacaoVercel.ts:21-32` (motivo novo `webhook_do_numero`)
- Modify: `scripts/central-agentes/migrar-agentes.ts` (modo `--webhook`, leitura do webhook no `--ligar`, `LIGAR_EM_PRODUCAO_LIBERADO = true`)
- Test: `test/centralAgentesScriptWebhook.test.ts`

SPEC (fatia 2, "Primeira ligação em produção"): antes de ligar, o script lê na Evolution (`GET /webhook/find/{instância}`) o endereço em que o webhook do número está registrado e exige um domínio da lista fechada do ambiente; só então `LIGAR_EM_PRODUCAO_LIBERADO` vira verdadeiro. A leitura entra no mesmo leitor que `ligarComConferencia` já chama **antes e depois** de ligar: se o webhook mudar no meio, ou a leitura falhar depois, a ligação é desfeita pelo caminho que a fatia 1 já testou.

O que conta como "confere": webhook `enabled = true`; endereço `https`, sem porta e sem usuário; host exatamente um dos domínios do ambiente (`crm.basea2.com`, `crm.cennohub.com.br`, `basecrm.vercel.app` em produção; `teste.crm.basea2.com` no teste); caminho `/api/public/channels/evolution/<id do número>/webhook`. A query do endereço não é conferida nem impressa (o segredo antigo ia nela), nem os cabeçalhos ou o corpo da resposta. Estado medido em 07/10 08h05 (`evo_saude.py`): a Aurora confere em `crm.basea2.com`; a Julia está com o webhook desligado e apontando para uma prévia, por decisão do Junior de 15/09. Então `--ligar` da Julia **vai recusar** com `webhook_desligado` até ele religar, e isso é o comportamento certo.

- [ ] **Step 1: Teste da conferência (falha)**

Criar `lib/agents/webhookDoNumero.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const credenciais = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/evolutionCredentials', () => ({ resolveEvolutionCredentials: credenciais }));
vi.mock('@/lib/channels/evolution', () => ({ findEvolutionWebhook: vi.fn() }));

import { conferirWebhookDoNumero } from './webhookDoNumero';

const CONEXAO = '20532687-e868-48c4-977b-f6f7cac72131';
const ORG = '11111111-1111-4111-8111-111111111111';
const PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const CERTO = `https://crm.basea2.com/api/public/channels/evolution/${CONEXAO}/webhook`;

function admin(linha: Record<string, unknown> | null) {
  const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: linha, error: null }) };
  return { from: () => consulta } as unknown as SupabaseClient;
}
const NUMERO = { id: CONEXAO, organization_id: ORG, provider: 'evolution', config: { instanceName: 'whatsapp-ia-bba4d621' } };
const achado = (url: string | null, enabled: boolean | null) => vi.fn().mockResolvedValue({ raw: {}, enabled, url, headers: { 'x-segredo': 'SEGREDO' }, events: [] });

beforeEach(() => {
  credenciais.mockReset();
  credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE', source: 'agency_defaults', agencyOrganizationId: 'ag' });
});

describe('conferirWebhookDoNumero', () => {
  it('confere: ligado, https, domínio da lista e o caminho deste número', async () => {
    const buscarWebhook = achado(CERTO, true);
    expect(await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook }))
      .toEqual({ ok: true, host: 'crm.basea2.com' });
    expect(buscarWebhook).toHaveBeenCalledWith({ apiUrl: 'https://evo.exemplo.com', instanceName: 'whatsapp-ia-bba4d621', apiKey: 'CHAVE' });
    expect(credenciais).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ORG, connectionConfig: NUMERO.config }));
  });

  it('a query com segredo não é conferida nem sai no resultado', async () => {
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook: achado(`${CERTO}?token=SEGREDO`, true) });
    expect(r).toEqual({ ok: true, host: 'crm.basea2.com' });
    const fora = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: ['teste.crm.basea2.com'], buscarWebhook: achado(`${CERTO}?token=SEGREDO`, true) });
    expect(fora.ok).toBe(false);
    expect(JSON.stringify(fora)).not.toContain('SEGREDO');
  });

  it.each([
    ['desligado', achado(CERTO, false), 'webhook_desligado'],
    ['prévia', achado(`https://basecrm-git-feat-funil-construtor-x.vercel.app/api/public/channels/evolution/${CONEXAO}/webhook`, true), 'webhook_fora_da_lista'],
    ['outro número', achado('https://crm.basea2.com/api/public/channels/evolution/outro/webhook', true), 'webhook_fora_da_lista'],
    ['http', achado(CERTO.replace('https:', 'http:'), true), 'webhook_fora_da_lista'],
    ['porta', achado(CERTO.replace('crm.basea2.com', 'crm.basea2.com:8443'), true), 'webhook_fora_da_lista'],
    ['sem url', achado(null, true), 'webhook_ilegivel'],
  ])('%s: recusa', async (_nome, buscarWebhook, motivo) => {
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook });
    expect(r).toMatchObject({ ok: false, motivo });
  });

  it('a leitura na Evolution falhou: recusa sem imprimir o que a Evolution respondeu', async () => {
    const buscarWebhook = vi.fn().mockRejectedValue(new Error('Instance not found SEGREDO'));
    const r = await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook });
    expect(r).toMatchObject({ ok: false, motivo: 'webhook_ilegivel' });
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('número que não existe, sem instância, de outro provedor ou sem credencial: recusa antes de chamar a Evolution', async () => {
    const buscarWebhook = achado(CERTO, true);
    expect(await conferirWebhookDoNumero({ admin: admin(null), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'conexao_inexistente' });
    expect(await conferirWebhookDoNumero({ admin: admin({ ...NUMERO, config: {} }), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'sem_instancia' });
    expect(await conferirWebhookDoNumero({ admin: admin({ ...NUMERO, provider: 'outro' }), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'conexao_nao_evolution' });
    credenciais.mockResolvedValueOnce(null);
    expect(await conferirWebhookDoNumero({ admin: admin(NUMERO), connectionId: CONEXAO, dominios: PRODUCAO, buscarWebhook })).toMatchObject({ motivo: 'sem_credenciais' });
    expect(buscarWebhook).not.toHaveBeenCalled();
  });
});
```

Criar `lib/agents/webhookDoNumero.real.test.ts`. O teste acima injeta o webhook já interpretado; este passa a resposta
**crua** da Evolution pelo leitor de verdade (`findEvolutionWebhook`, `lib/channels/evolution.ts`, que não tinha teste),
nos dois formatos que ele aceita. Só a rede e o DNS são falsos (revisão do Codex, 07/10):

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
const credenciais = vi.hoisted(() => vi.fn());
vi.mock('@/lib/channels/evolutionCredentials', () => ({ resolveEvolutionCredentials: credenciais }));

import { conferirWebhookDoNumero } from './webhookDoNumero';

const CONEXAO = '20532687-e868-48c4-977b-f6f7cac72131';
const PRODUCAO = ['crm.basea2.com', 'crm.cennohub.com.br', 'basecrm.vercel.app'];
const CERTO = `https://crm.basea2.com/api/public/channels/evolution/${CONEXAO}/webhook`;
const NUMERO = { id: CONEXAO, organization_id: 'org', provider: 'evolution', config: { instanceName: 'whatsapp-ia-bba4d621' } };

function admin() {
  const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: NUMERO, error: null }) };
  return { from: () => consulta } as unknown as SupabaseClient;
}
const respostaDaEvolution = (corpo: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('conferirWebhookDoNumero com o leitor real da Evolution', () => {
  it.each([
    ['formato plano', { enabled: true, url: `${CERTO}?token=SEGREDO`, events: ['MESSAGES_UPSERT'], headers: { Authorization: 'SEGREDO' } }],
    ['formato aninhado em webhook', { webhook: { enabled: true, url: CERTO, events: ['MESSAGES_UPSERT'] } }],
  ])('%s: confere, pedindo GET /webhook/find/<instância>', async (_nome, corpo) => {
    credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE' });
    const fetchMock = respostaDaEvolution(corpo);
    vi.stubGlobal('fetch', fetchMock);
    const r = await conferirWebhookDoNumero({ admin: admin(), connectionId: CONEXAO, dominios: PRODUCAO });
    expect(r).toEqual({ ok: true, host: 'crm.basea2.com' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://evo.exemplo.com/webhook/find/whatsapp-ia-bba4d621');
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('webhook desligado na resposta crua: recusa como desligado', async () => {
    credenciais.mockResolvedValue({ apiUrl: 'https://evo.exemplo.com', apiKey: 'CHAVE' });
    vi.stubGlobal('fetch', respostaDaEvolution({ enabled: false, url: CERTO }));
    expect(await conferirWebhookDoNumero({ admin: admin(), connectionId: CONEXAO, dominios: PRODUCAO })).toMatchObject({
      ok: false,
      motivo: 'webhook_desligado',
    });
  });
});
```

Criar `lib/agents/modoDaMigracao.test.ts`. Revisão do Codex, 07/10: `--webhook` sem id passava pela escolha do modo, pulava
o `if (webhook)` e terminava com a prova geral e saída 0. A escolha do modo vira uma função pura, testada pelo comportamento:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ehUuid, escolherModo } from './modoDaMigracao';

const ID = '20532687-e868-48c4-977b-f6f7cac72131';

describe('escolherModo (migrar-agentes)', () => {
  it.each([
    ['--webhook sem id', ['--webhook'], '--webhook exige o id (uuid) do numero.'],
    ['--webhook seguido de outra opção', ['--webhook', '--confirmar-banco', 'abc'], '--webhook exige o id (uuid) do numero.'],
    ['--ligar com id inválido', ['--ligar', '123'], '--ligar exige o id (uuid) do numero.'],
    ['--desligar sem id', ['--desligar'], '--desligar exige o id (uuid) do numero.'],
  ])('%s: recusa', (_nome, args, erro) => {
    expect(escolherModo(args)).toEqual({ erro });
  });

  it('dois modos juntos, ou nenhum: recusa', () => {
    expect(escolherModo(['--prova', '--webhook', ID])).toMatchObject({ erro: expect.stringContaining('exatamente um modo') });
    expect(escolherModo(['--criar', '--ligar', ID])).toMatchObject({ erro: expect.stringContaining('exatamente um modo') });
    expect(escolherModo([])).toMatchObject({ erro: expect.stringContaining('veio: nenhum') });
  });

  it('modos válidos', () => {
    expect(escolherModo(['--prova', '--org', ID])).toEqual({ modo: 'prova' });
    expect(escolherModo(['--criar', '--org', ID, '--somente', ID])).toEqual({ modo: 'criar' });
    expect(escolherModo(['--webhook', ID])).toEqual({ modo: 'webhook', numero: ID });
    expect(escolherModo(['--ligar', ID, '--confirmar-banco', 'x'])).toEqual({ modo: 'ligar', numero: ID });
  });

  it('ehUuid', () => {
    expect(ehUuid(ID)).toBe(true);
    expect(ehUuid('--confirmar-banco')).toBe(false);
    expect(ehUuid(undefined)).toBe(false);
  });
});
```

Criar `test/centralAgentesScriptWebhook.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** O script roda ao ser importado; este teste lê o código e trava as três peças da liberação da fatia 2. */
const fonte = readFileSync(resolve(process.cwd(), 'scripts/central-agentes/migrar-agentes.ts'), 'utf8');

describe('migrar-agentes: ligar em produção só com o webhook conferido', () => {
  it('a produção está liberada', () => {
    expect(fonte).toMatch(/^const LIGAR_EM_PRODUCAO_LIBERADO = true;$/m);
  });

  it('--ligar passa pelo leitor que confere publicação E webhook, antes e depois de ligar', () => {
    expect(fonte).toMatch(/ligarComConferencia\(admin, ligar, lerPublicacaoEWebhook, commit\)/);
    expect(fonte).not.toMatch(/ligarComConferencia\(admin, ligar, lerPublicacao, commit\)/);
    expect(fonte).toMatch(/conferirWebhookDoNumero\(\{ admin, connectionId: ligar, dominios: ambiente\.dominios \}\)/);
  });

  it('--webhook existe e só lê', () => {
    expect(fonte).toMatch(/const webhook = argumento\('--webhook'\);/);
    expect(fonte).toMatch(/conferirWebhookDoNumero\(\{ admin, connectionId: webhook, dominios: ambiente\.dominios \}\)/);
  });

  it('o modo sai de escolherModo (testada à parte) e --criar em produção exige --somente', () => {
    expect(fonte).toMatch(/const escolhido = escolherModo\(process\.argv\.slice\(2\)\);/);
    expect(fonte).toMatch(/if \(ambiente\.producao && !somente\)/);
    expect(fonte).toMatch(/if \(somente && grupos\.length !== 1\)/);
  });
});
```

Run: `npx vitest run lib/agents/webhookDoNumero.test.ts lib/agents/webhookDoNumero.real.test.ts lib/agents/modoDaMigracao.test.ts test/centralAgentesScriptWebhook.test.ts`
Expected: FAIL (módulos `./webhookDoNumero` e `./modoDaMigracao` inexistentes; o script ainda tem `false`).

- [ ] **Step 2: Implementar `lib/agents/webhookDoNumero.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { findEvolutionWebhook } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';

export type MotivoDoWebhook =
  | 'conexao_inexistente'
  | 'conexao_nao_evolution'
  | 'sem_instancia'
  | 'sem_credenciais'
  | 'webhook_ilegivel'
  | 'webhook_desligado'
  | 'webhook_fora_da_lista';

export type WebhookDoNumero = { ok: true; host: string } | { ok: false; motivo: MotivoDoWebhook; detalhe: string };

/**
 * Lê na Evolution (GET /webhook/find/{instância}) onde o webhook do número está registrado e exige um domínio da lista
 * fechada do ambiente (SPEC, fatia 2). O CRM grava esse endereço com a origem de quem clicou em conectar ou no
 * healthcheck (lib/channels/evolutionWebhookRegistration.ts): pode ser uma prévia, servida por outro código.
 * Nunca devolve a query, os cabeçalhos nem o corpo da Evolution: o segredo do webhook mora ali.
 */
export async function conferirWebhookDoNumero(params: {
  admin: SupabaseClient;
  connectionId: string;
  dominios: readonly string[];
  buscarWebhook?: typeof findEvolutionWebhook;
}): Promise<WebhookDoNumero> {
  const { admin, connectionId, dominios, buscarWebhook = findEvolutionWebhook } = params;
  const lida = await admin
    .from('channel_connections')
    .select('id, organization_id, provider, config')
    .eq('id', connectionId)
    .maybeSingle();
  if (lida.error) return { ok: false, motivo: 'webhook_ilegivel', detalhe: `leitura do numero falhou (${lida.error.message})` };
  if (!lida.data) return { ok: false, motivo: 'conexao_inexistente', detalhe: 'o numero nao existe neste banco' };
  if (lida.data.provider !== 'evolution') return { ok: false, motivo: 'conexao_nao_evolution', detalhe: `provider ${String(lida.data.provider)}` };
  const config = (lida.data.config ?? {}) as Record<string, unknown>;
  const instancia = typeof config.instanceName === 'string' ? config.instanceName.trim() : '';
  if (!instancia) return { ok: false, motivo: 'sem_instancia', detalhe: 'config.instanceName vazio' };
  const credenciais = await resolveEvolutionCredentials({
    admin,
    tenantId: lida.data.organization_id as string,
    connectionConfig: config,
  });
  if (!credenciais) return { ok: false, motivo: 'sem_credenciais', detalhe: 'sem o par completo de URL e chave da Evolution (no numero ou na agencia)' };

  let url: string | null;
  let ligado: boolean | null;
  try {
    const achado = await buscarWebhook({ apiUrl: credenciais.apiUrl, instanceName: instancia, apiKey: credenciais.apiKey });
    url = achado.url;
    ligado = achado.enabled;
  } catch (erro) {
    // Só o tipo do erro: a mensagem pode trazer o que a Evolution respondeu.
    return { ok: false, motivo: 'webhook_ilegivel', detalhe: `GET /webhook/find falhou (${erro instanceof Error ? erro.name : 'erro'})` };
  }
  if (ligado !== true) return { ok: false, motivo: 'webhook_desligado', detalhe: `enabled=${String(ligado)}` };

  let endereco: URL;
  try {
    endereco = new URL(url ?? '');
  } catch {
    return { ok: false, motivo: 'webhook_ilegivel', detalhe: 'endereco do webhook ausente ou invalido' };
  }
  const caminho = `/api/public/channels/evolution/${connectionId}/webhook`;
  const confere = endereco.protocol === 'https:'
    && endereco.port === ''
    && endereco.username === ''
    && endereco.password === ''
    && dominios.includes(endereco.hostname)
    && endereco.pathname === caminho;
  if (!confere) {
    return {
      ok: false,
      motivo: 'webhook_fora_da_lista',
      detalhe: `host=${endereco.hostname} protocolo=${endereco.protocol} porta=${endereco.port || 'padrao'} caminho_confere=${endereco.pathname === caminho}`,
    };
  }
  return { ok: true, host: endereco.hostname };
}
```

Criar `lib/agents/modoDaMigracao.ts`:

```ts
/** Escolha do modo do scripts/central-agentes/migrar-agentes.ts: um por chamada, e os que recebem número exigem o id. */
export type ModoDaMigracao =
  | { modo: 'prova' }
  | { modo: 'criar' }
  | { modo: 'ligar' | 'desligar' | 'webhook'; numero: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ehUuid = (valor: string | null | undefined): valor is string => Boolean(valor && UUID.test(valor));

/**
 * Revisão do Codex, 07/10: `--webhook` sem id passava pela escolha antiga, pulava o `if (webhook)` e terminava com a
 * prova geral e saída 0. Aqui, nenhum modo, dois modos ou número que não é uuid voltam como erro, antes de qualquer rede.
 */
export function escolherModo(args: readonly string[]): ModoDaMigracao | { erro: string } {
  const modos = ['--prova', '--criar', '--ligar', '--desligar', '--webhook'].filter((m) => args.includes(m));
  if (modos.length !== 1) {
    return {
      erro: `Use exatamente um modo: --prova, --criar, --ligar <id>, --desligar <id> ou --webhook <id> (veio: ${modos.join(' ') || 'nenhum'}).`,
    };
  }
  const [modo] = modos;
  if (modo === '--prova') return { modo: 'prova' };
  if (modo === '--criar') return { modo: 'criar' };
  const numero = args[args.indexOf(modo) + 1];
  if (!ehUuid(numero)) return { erro: `${modo} exige o id (uuid) do numero.` };
  return { modo: modo.slice(2) as 'ligar' | 'desligar' | 'webhook', numero };
}
```

Run: `npx vitest run lib/agents/webhookDoNumero.test.ts lib/agents/webhookDoNumero.real.test.ts lib/agents/modoDaMigracao.test.ts`
Expected: PASS (10 + 3 + 7 testes).

- [ ] **Step 3: O motivo novo na publicação**

Em `lib/agents/publicacaoVercel.ts`, trocar a última linha da união `MotivoDaPublicacao`, `  | 'mais_novo_nao_servido';`, por:

```ts
  | 'mais_novo_nao_servido'
  // Fatia 2: o webhook do número, lido na Evolution junto com a publicação antes e depois de ligar.
  | 'webhook_do_numero';
```

- [ ] **Step 4: O script**

Em `scripts/central-agentes/migrar-agentes.ts`:

1. No cabeçalho, trocar a linha ` * Nesta fatia, --ligar só roda no ambiente de teste; em produção é recusado (LIGAR_EM_PRODUCAO_LIBERADO).` por:

```ts
 * Fatia 2: --ligar também lê na Evolution, antes e depois de ligar, o endereço do webhook do número e exige um domínio
 * do ambiente (lib/agents/webhookDoNumero.ts); com isso ligar em produção ficou liberado. --webhook <id> faz só essa
 * leitura, sem escrever nada.
```

e acrescentar, depois da linha de uso do `--desligar`:

```ts
 *   npx --yes tsx@4.23.1 scripts/central-agentes/migrar-agentes.ts --webhook <connectionId>
```

e, na linha de uso do `--criar`, trocar ` [--incluir <id,id>]` (o fim dela) por ` [--incluir <id,id>] [--somente <connectionId>] (em producao, --somente e obrigatorio)`.

2. Trocar o import de `publicacaoVercel` por:

```ts
import { criarClienteVercel, lerPublicacaoNoAr, type AmbientePublicado, type PublicacaoNoAr } from '@/lib/agents/publicacaoVercel';
import { conferirWebhookDoNumero } from '@/lib/agents/webhookDoNumero';
import { ehUuid, escolherModo } from '@/lib/agents/modoDaMigracao';
```

3. Trocar o comentário e a constante `LIGAR_EM_PRODUCAO_LIBERADO` por:

```ts
/**
 * Fatia 2: ligar em produção liberado, porque --ligar passou a ler na Evolution o endereço do webhook de cada número
 * (conferirWebhookDoNumero) e a exigir um domínio da lista fechada do ambiente, antes de ligar e de novo depois, junto
 * com a publicação. Webhook desligado ou fora da lista recusa (a Julia, enquanto o webhook dela estiver desligado por
 * decisão do Junior de 15/09).
 */
const LIGAR_EM_PRODUCAO_LIBERADO = true;
```

4. Logo depois da linha que imprime o commit (``console.log(`Commit: ${commit}...`);``), antes do `const escreve = ...`, acrescentar:

```ts
  // Um modo por chamada, e o número dos modos que recebem um tem que ser uuid (lib/agents/modoDaMigracao.ts).
  const escolhido = escolherModo(process.argv.slice(2));
  if ('erro' in escolhido) {
    console.error(escolhido.erro);
    return sair(2);
  }
```

e **apagar** o bloco antigo, que fica redundante:

```ts
  if (!(tem('--prova') || tem('--criar') || tem('--ligar'))) {
    console.error('Use --prova, --criar, --ligar <id> ou --desligar <id>.');
    return sair(2);
  }
```

5. Logo depois do bloco que recusa `--ligar` quando `!LIGAR_EM_PRODUCAO_LIBERADO` (o `if (tem('--ligar') && ambiente.producao && ...)`), acrescentar:

```ts
  const webhook = argumento('--webhook');
  if (webhook) {
    // Só leitura: o mesmo critério que o --ligar usa, para conferir antes de pedir o OK.
    const w = await conferirWebhookDoNumero({ admin, connectionId: webhook, dominios: ambiente.dominios });
    console.log(w.ok ? `WEBHOOK numero=${webhook} confere host=${w.host}` : `WEBHOOK numero=${webhook} recusado motivo=${w.motivo} (${w.detalhe})`);
    return sair(w.ok ? 0 : 1);
  }
```

6. Dentro do `if (ligar) {`, trocar a linha `const r = await ligarComConferencia(admin, ligar, lerPublicacao, commit);` (e o comentário acima dela) por:

```ts
    // Fatia 2: a publicação E o webhook do número, conferidos antes de ligar e de novo depois. ligarComConferencia
    // chama este leitor nas duas pontas e desfaz a ligação se a segunda leitura não confirmar.
    const lerPublicacaoEWebhook = async (): Promise<PublicacaoNoAr> => {
      const p = await lerPublicacao();
      if (!p.ok) return p;
      const w = await conferirWebhookDoNumero({ admin, connectionId: ligar, dominios: ambiente.dominios });
      if (!w.ok) return { ok: false, motivo: 'webhook_do_numero', detalhe: `${w.motivo}: ${w.detalhe}` };
      return p;
    };
    const r = await ligarComConferencia(admin, ligar, lerPublicacaoEWebhook, commit);
```

7. No bloco `if (tem('--criar')) {`, trocar desde a linha `const plano = await planejarMigracao(...)` até a linha
`const r = await criarAgentes(admin, { organizationId, grupos: plano.grupos, catalogCommit: commit });` por:

```ts
    // Revisão do Codex, 07/10: --org sozinho cria agente para TODOS os grupos prontos do cliente, e o OK de produção é
    // por número. --somente <connectionId> restringe ao grupo desse número; em produção é obrigatório.
    const somente = argumento('--somente');
    if (ambiente.producao && !somente) {
      console.error('Recusado: em producao, --criar exige --somente <connectionId> (so o grupo do numero aprovado).');
      return sair(2);
    }
    if (somente && !ehUuid(somente)) {
      console.error('--somente exige o id (uuid) do numero.');
      return sair(2);
    }
    const plano = await planejarMigracao(admin, { organizationId, incluir, publicacao: { commit: p.commit, deploymentId: p.deploymentId } });
    const grupos = somente ? plano.grupos.filter((g) => g.conexoes.some((c) => c.id === somente)) : plano.grupos;
    if (somente && grupos.length !== 1) {
      console.error(`Recusado: o numero ${somente} nao esta em nenhum grupo deste cliente (confira no --prova).`);
      return sair(2);
    }
    if (somente && !grupos[0].pronto) {
      console.error(`Recusado: o grupo do numero ${somente} nao esta pronto (algum numero dele sem CONFERE).`);
      return sair(2);
    }
    imprimirPlano({ grupos, ignoradas: plano.ignoradas });
    const r = await criarAgentes(admin, { organizationId, grupos, catalogCommit: commit });
```

- [ ] **Step 5: Rodar e ver passar, junto com os testes da fatia 1 da migração**

Run: `npx vitest run lib/agents test/centralAgentesScriptWebhook.test.ts`
Expected: PASS (os de `lib/agents/*.test.ts` da fatia 1 continuam verdes: `ligarComConferencia` não mudou).

Run, em outro comando: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 6: Commit**

```bash
git add lib/agents/webhookDoNumero.ts lib/agents/webhookDoNumero.test.ts lib/agents/webhookDoNumero.real.test.ts lib/agents/modoDaMigracao.ts lib/agents/modoDaMigracao.test.ts lib/agents/publicacaoVercel.ts scripts/central-agentes/migrar-agentes.ts test/centralAgentesScriptWebhook.test.ts
git diff --cached --stat
git commit -m "feat(central-agentes): --ligar le o webhook do numero na Evolution (antes e depois) e libera producao; modo --webhook so leitura"
```

---

### Task 13: Verificação completa no worktree

**Files:** nenhum (só leitura e execução).

Cada comando num passo próprio, com a saída lida antes do seguinte (rito, item 1; aprendizado de 28/07: suíte e commit nunca no mesmo comando).

- [ ] **Step 1: Lint com zero aviso**

Run: `npm run lint`
Expected: sai 0, sem aviso (o projeto usa `--max-warnings 0`; `react-hooks/refs` é aviso e reprova).

- [ ] **Step 2: Tipos**

Run: `npm run typecheck`
Expected: sem erro.

- [ ] **Step 3: Suíte completa**

Run: `npm run test:run`
Expected: 0 falhas. O total de testes é o da Task 0 (2.227 em 07/10) mais os novos desta fatia; anotar os dois números no registro.

- [ ] **Step 4: Testes locais da Central (com o Supabase local)**

Run: `npm run test:local -- test/centralAgentesEditor.local.test.ts test/centralAgentesFundacao.local.test.ts`
Expected: PASS nos dois arquivos, nenhum `skipped`.

- [ ] **Step 5: Build de produção**

Run: `npm run build`
Expected: sai 0; as rotas `/platform/tenants/[tenantId]/agents` e `/platform/tenants/[tenantId]/agents/[agentId]` e as sete de `/api/platform/tenants/[tenantId]/agents/...` aparecem na lista do build. Erro de "export inválido em route.ts" significa um esquema exportado de arquivo de rota: mover para `lib/agents/rotaDoEditor.ts`.

- [ ] **Step 6: Conferências que nenhum teste faz sozinho**

Run, um por vez:
```bash
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
```
Expected: árvore limpa; os commits das Tasks 1 a 12; nenhum arquivo inteiro reescrito por fim de linha (um arquivo existente com centenas de linhas mudadas é sinal disso: parar e conferir `core.autocrlf` antes de qualquer outra coisa); nenhum `scripts/*.tmp.ts`.

Releitura dirigida (G1, G22): as respostas das rotas novas não levam `config` de número, chave, token nem `raw` da Evolution. Os testes das Tasks 4 e 12 conferem isso com `NAO-PODE-SAIR` e `SEGREDO`; aqui é uma última leitura dos sete `route.ts` e de `lib/agents/editorAgentes.ts` atrás de qualquer `select(` com `config` que vá para a resposta.

- [ ] **Step 7: Registro**

Registrar no cérebro, em `06-References/central-de-agentes-2026-09-29/` (arquivo novo `ensaio-fatia-2-<data>.md`), os números lidos nos Steps 1 a 5 e os shas dos commits. Commit só desse arquivo, por caminho explícito (`git add <arquivo>`), e `git status -sb` sem `[ahead N]` depois do push do cérebro.

---

### Task 14: Backup com os quatro requisitos (dump v4.3), provado na stack local antes de qualquer escrita em produção

**Files (no cérebro, `06-References/basecrm-rito-publicacao/`):**
- Modify: `dump_producao.ps1` (v4.2 → v4.3)
- Modify: `prova_dump_local.ps1` (v2.1 → v2.2)
- Modify: `conferir_pos_dump.ps1` (cinco arquivos, pasta por parâmetro)
- Modify: `sqlprod.py` e `sqlteste.py` (erro HTTP sai 1, com a mensagem no stderr)
- Modify: `rota_b_senha.ps1` (`-Data` obrigatório, sem a data de 07/10 como padrão)
- Create: `g23-restauracao/contagens_todas.sql`
- Create: `g23-restauracao/comparar_contagens.py`
- Create: `g23-restauracao/restaurar_v2.sh` (o `restaurar.sh` de 07/10 fica como registro)
- Modify: `LEIA-ME.md` (itens 6, 10, 11, 12 e 13)

Os quatro requisitos entraram na política de backup na 12ª devolutiva (SPEC, achados fora do escopo, item 8), e esta é a primeira vez que um dump os cumpre:
1. **Pooler lido do endpoint na hora.** A v4.2 tem o host certo como constante (lido em 07/10); a v4.3 lê `GET /v1/projects/{ref}/config/database/pooler` antes de abrir a senha e recusa se o host for outro. A constante continua mudando só por commit.
2. **Restauração do `roles.sql` definida e provada.** Decisão: restaurar **como `supabase_admin`** (o superusuário da stack isolada) desde o início, na mesma transação do resto, porque o `roles.sql` altera `supabase_admin` e o `postgres` local não pode. Provado quando a restauração sai 0 sem `ERROR` no log.
3. **O histórico de migrations vem do dump.** Dois arquivos novos, `historico_schema.sql` e `historico_data.sql`, com `--schema supabase_migrations` (a CLI deixa esse esquema fora do dump comum). A volta da fatia passa a funcionar a partir dos arquivos, sem recriar tabela à mão.
4. **Contagem de todas as tabelas dos esquemas despejados**, comparada com a produção contada logo antes e logo depois do dump: tabela que não mudou na janela tem que bater exatamente; tabela que mudou tem que ficar entre as duas contagens.

Tudo aqui roda antes do OK de produção e sem tocar produção: a prova é contra a stack local. O dump real é o Step 2 da Task 15, com o OK do Junior.

- [ ] **Step 1: Conferir sem conexão o comando que a CLI montaria para o histórico**

Na pasta do rito (`06-References/basecrm-rito-publicacao/`), com a CLI do cache (a mesma versão do dump):
```powershell
npx --yes supabase@2.120.0 db dump --db-url "postgresql://postgres@127.0.0.1:54322/postgres" --schema supabase_migrations --dry-run
npx --yes supabase@2.120.0 db dump --db-url "postgresql://postgres@127.0.0.1:54322/postgres" --schema supabase_migrations --data-only --use-copy --dry-run
```
Expected: os dois imprimem o script do `pg_dump` sem executar, com `supabase_migrations` entre os esquemas incluídos e fora da lista de exclusão. Se a CLI recusar o esquema ou excluí-lo mesmo pedido, **parar a Task** e registrar: a alternativa (um `pg_dump -n supabase_migrations` pelo mesmo container de imagem conferida) precisa de revisão própria antes de chegar perto da senha de produção.

- [ ] **Step 2: `dump_producao.ps1` v4.3**

1. Primeira linha do cabeçalho: trocar `# dump_producao.ps1 (v4.2, 07/10)` por `# dump_producao.ps1 (v4.3, fatia 2; v4.2 de 07/10)`, e acrescentar ao fim do cabeçalho (antes do `param(`):

```powershell
# v4.3 (fatia 2; os quatro requisitos da politica de backup, SPEC, achados, item 8): (1) o host do pooler e LIDO de
# GET /v1/projects/{ref}/config/database/pooler antes do DPAPI e comparado com a constante (diferente = parar; o token do
# cofre e lido em processo e nunca impresso); (3) dois arquivos novos com o historico de migrations (supabase_migrations,
# estrutura e dados), para a volta funcionar a partir dos arquivos. (2) e (4) ficam na restauracao (restaurar_v2.sh e
# comparar_contagens.py). Saida 0 so com os CINCO arquivos feitos e cifrados.
```

2. Trocar `$Arquivos = 'roles.sql', 'schema.sql', 'data.sql'` por:

```powershell
$Arquivos = 'roles.sql', 'schema.sql', 'data.sql', 'historico_schema.sql', 'historico_data.sql'
```

3. Acrescentar esta função depois de `Exigir-ImagemPresente`:

```powershell
function Conferir-PoolerNoEndpoint([string]$Projeto, [string]$Esperado) {
    # v4.3 (requisito 1): o host do pooler LIDO do endpoint na hora, antes do DPAPI. Diferente da constante = parar (a
    # constante so muda por commit). O token sai do cofre em processo e nunca e impresso.
    $cofre = Join-Path $env:USERPROFILE 'WorkSync\.secrets'
    $achada = Select-String -LiteralPath $cofre -Pattern '^SUPABASE_MGMT_TOKEN=(.+)$' | Select-Object -First 1
    if (-not $achada) { throw "SUPABASE_MGMT_TOKEN ausente no cofre; parar antes do DPAPI" }
    $token = $achada.Matches[0].Groups[1].Value.Trim().Trim('"')
    $achada = $null
    try {
        $resposta = Invoke-RestMethod -Method Get -TimeoutSec 60 -Uri "https://api.supabase.com/v1/projects/$Projeto/config/database/pooler" -Headers @{ Authorization = "Bearer $token" }
    }
    finally { $token = $null }
    $itens = @($resposta)
    $primarios = @($itens | Where-Object { -not $_.database_type -or $_.database_type -eq 'PRIMARY' })
    $hosts = @($primarios | ForEach-Object { "$($_.db_host)" } | Where-Object { $_ } | Sort-Object -Unique)
    if ($hosts.Count -ne 1) { throw "o endpoint do pooler devolveu $($hosts.Count) host(s); esperava exatamente 1; parar antes do DPAPI" }
    if ($hosts[0] -cne $Esperado) { throw "o pooler do projeto e '$($hosts[0])' e a constante diz '$Esperado': atualize a constante por commit e repita; parar antes do DPAPI" }
    "pooler conferido no endpoint: $($hosts[0])"
}
```

4. Logo depois da linha `Conferir-ImagemPgDump $ImagemPgDump`, acrescentar:

```powershell
    Conferir-PoolerNoEndpoint $Ref $PoolerHost
```

5. Depois do bloco do `data.sql` (a linha `if ($rc -ne 0) { throw "data.sql falhou (codigo $rc)" }`) e antes de `$plain = $null`, acrescentar:

```powershell
    # v4.3 (requisito 3): o historico de migrations, estrutura e dados. A CLI deixa supabase_migrations fora do dump comum;
    # com --schema ele entra (conferido no --dry-run e na prova local v2.2 antes do dump real).
    Exigir-ImagemPresente $ImagemPgDump
    $rc = Invocar-Dump $Exe ($base + @((Join-Path $D 'historico_schema.sql'), '--schema', 'supabase_migrations')) $plain $Trabalho
    if ($rc -ne 0) { throw "historico_schema.sql falhou (codigo $rc)" }
    Exigir-ImagemPresente $ImagemPgDump
    $rc = Invocar-Dump $Exe ($base + @((Join-Path $D 'historico_data.sql'), '--use-copy', '--data-only', '--schema', 'supabase_migrations')) $plain $Trabalho
    if ($rc -ne 0) { throw "historico_data.sql falhou (codigo $rc)" }
```

6. Na mensagem de arquivo não cifrado, trocar `apagar os tres e parar` por `apagar os cinco e parar`.

As quatro funções que a prova local copia (`Raiz-CacheNpm`, `Resolver-CliSupabase`, `Conferir-ImagemPgDump`, `Invocar-Dump`) **não mudam**: a prova compara o texto delas com o do dump.

- [ ] **Step 3: `prova_dump_local.ps1` v2.2**

1. Primeira linha: `# prova_dump_local.ps1 (v2.2, fatia 2; v2.1 de 07/10; v2 de 06/10)`; acrescentar ao fim do cabeçalho: `# v2.2: tambem despeja o historico de migrations da stack local e exige a tabela e as linhas (requisito 3 da fatia 2).`

2. Logo antes da linha que grava `resumo.json` (`[pscustomobject]@{ quando = ...`), acrescentar:

```powershell
# v2.2 (requisito 3): o historico de migrations sai com a estrutura e as linhas, pelo mesmo executavel e a mesma imagem.
$histSchema = Join-Path $P 'historico_schema.sql'
$histData = Join-Path $P 'historico_data.sql'
$urlLocal = 'postgresql://postgres@127.0.0.1:54322/postgres'
$rcS = Invocar-Dump $Exe @('db', 'dump', '--db-url', $urlLocal, '-f', $histSchema, '--schema', 'supabase_migrations') 'postgres' $AQUI
$rcD = Invocar-Dump $Exe @('db', 'dump', '--db-url', $urlLocal, '-f', $histData, '--use-copy', '--data-only', '--schema', 'supabase_migrations') 'postgres' $AQUI
$textoS = if (Test-Path -LiteralPath $histSchema) { Get-Content -LiteralPath $histSchema -Raw } else { '' }
$textoD = if (Test-Path -LiteralPath $histData) { Get-Content -LiteralPath $histData -Raw } else { '' }
Exigir "historico_schema.sql saiu 0 e cria supabase_migrations.schema_migrations" (($rcS -eq 0) -and ($textoS -match '(?i)CREATE TABLE (IF NOT EXISTS )?"?supabase_migrations"?\."?schema_migrations"?'))
Exigir "historico_data.sql saiu 0 e copia as linhas de schema_migrations" (($rcD -eq 0) -and ($textoD -match '(?im)^COPY "?supabase_migrations"?\."?schema_migrations"?'))
```

- [ ] **Step 4: Rodar a prova local v2.2**

Pré-requisito: a stack `crmia` de pé (`npx supabase status` no worktree) e ninguém mexendo no Docker Desktop durante a prova.

Run (na pasta do rito): `powershell -NoProfile -ExecutionPolicy Bypass -File prova_dump_local.ps1`
Expected: `PROVA LOCAL v2: OK (todas as N exigencias)`, com as duas exigências novas em `OK`. Registrar a pasta `prova-dump-v4-<data-hora>` e o `resumo.json`.

- [ ] **Step 5: `conferir_pos_dump.ps1` com a pasta por parâmetro e os cinco arquivos**

Trocar as quatro primeiras linhas e a linha do `$ok` inicial por:

```powershell
param([Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$')][string]$Data)
$ErrorActionPreference = 'Stop'
$D = "C:/Users/PC Gamer/BaseCRM-dumps/$Data"
$eu = "$env:USERDOMAIN\$env:USERNAME"
$itens = @(Get-ChildItem -LiteralPath $D -Force | Sort-Object Name)
"itens: " + (($itens | ForEach-Object { $_.Name }) -join ', ')
$esperados = @('data.sql', 'historico_data.sql', 'historico_schema.sql', 'roles.sql', 'schema.sql')
$ok = ($itens.Count -eq $esperados.Count) -and -not (Compare-Object $esperados @($itens | ForEach-Object { $_.Name }))
"exatamente os cinco arquivos (roles, schema, data, historico_schema, historico_data): $ok"
```

(o laço de conferência de cifra e ACL e o `cipher /c` do `roles.sql` ficam como estão).

- [ ] **Step 5a: `sqlprod.py` e `sqlteste.py`: erro HTTP sai 1**

Revisão do Codex, 07/10: hoje o `except` imprime `HTTP <código> <corpo>` na saída padrão e o script termina com 0. Redirecionada para `antes.json`, uma contagem recusada vira um texto de erro, e nada para. Medido em 07/10 no banco de teste: SQL inválido devolve `HTTP 400 {"message":"Failed to run sql query: ERROR:  42P01: ..."}` na saída padrão, com saída 0. Nos dois arquivos, trocar o bloco `except` por:

```python
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:600], file=sys.stderr)
    sys.exit(1)
```

Os dois só diferem na docstring e no `REF`, então a prova é no banco de teste. Na pasta do rito, um por vez:

```bash
diff sqlprod.py sqlteste.py
printf 'select coluna_que_nao_existe from tabela_que_nao_existe;\n' > "$TEMP/sql-invalido.sql"
python sqlteste.py "$TEMP/sql-invalido.sql" > "$TEMP/sql-invalido.out"; echo "saida=$?"
wc -c < "$TEMP/sql-invalido.out"
rm "$TEMP/sql-invalido.sql" "$TEMP/sql-invalido.out"
```
Expected: o `diff` mostra só a linha 2 (docstring) e a 7 (`REF`); `saida=1`, com `HTTP 400 ...` no terminal (stderr) e `0` bytes no arquivo redirecionado.

- [ ] **Step 5b: `rota_b_senha.ps1`: `-Data` obrigatório**

Revisão do Codex, 07/10: o script tem `[string]$Data = '2026-10-07'` como padrão, e tanto o LEIA-ME (item 11) quanto a v1 deste plano o chamavam sem `-Data`. Num dia diferente, a senha iria para a pasta de 07/10 (que já tem o dump da fatia 1, e o script recusaria por pasta não vazia) e o dump procuraria na pasta nova. Trocar o bloco `param(...)` por:

```powershell
param(
    [Parameter(Mandatory = $true)][ValidateSet('criar', 'rotacionar')][string]$Modo,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$')][string]$Data
)
```

e, nas duas linhas de uso do cabeçalho, acrescentar `-Data <data>` depois de `-Modo criar` e de `-Modo rotacionar`. O padrão é o mesmo do `-Data` do `dump_producao.ps1` (aceita sufixo, como `2026-10-08-b`).

Conferir sem rede, na pasta do rito, um por vez (nenhum chega a ler o cofre: a falta de parâmetro para no PowerShell, e a pasta inexistente para antes do token):

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File rota_b_senha.ps1 -Modo criar
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File rota_b_senha.ps1 -Modo criar -Data 2099-01-01
```
Expected: o primeiro recusa com "um ou mais parâmetros obrigatórios estão ausentes: Data"; o segundo com `pasta do dia nao existe`. Os dois saem 1. (Medido em 07/10 numa cópia do bloco novo: os dois casos, mais `-Modo rotacionar -Data 2026-10-08-b` aceito e `-Data 07-10-2026` recusado pela validação.)

- [ ] **Step 6: Contagem de todas as tabelas — `g23-restauracao/contagens_todas.sql`**

```sql
-- Contagem de TODAS as tabelas dos esquemas despejados (requisito 4 da fatia 2). So leitura. Roda igual na producao
-- (sqlprod.py, read_only) e na copia restaurada (psql). Devolve so nome de tabela e numero de linhas: nenhum dado.
select n.nspname || '.' || c.relname as tabela,
       (xpath('/row/n/text()',
              query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as linhas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('public', 'auth', 'storage', 'supabase_migrations')
order by 1;
```

- [ ] **Step 7: O comparador — `g23-restauracao/comparar_contagens.py`**

```python
# -*- coding: utf-8 -*-
"""Requisito 4 da politica de backup (fatia 2): compara a copia restaurada com a producao contada ANTES e DEPOIS do dump.
Uso: python comparar_contagens.py antes.json depois.json copia.txt
  antes.json / depois.json: saida do `python sqlprod.py contagens_todas.sql` (lista JSON de {tabela, linhas})
  copia.txt: saida do psql na copia (`tabela|linhas`, uma por linha)
Regra: tabela que nao mudou na janela do dump tem que bater exatamente; tabela que mudou tem que ficar entre as duas
contagens. Tabela da producao ausente na copia reprova, salvo as excluidas de proposito do data.sql. Tabela so da copia
(da propria stack local) aparece como informacao. Imprime so nomes e numeros. Saida 0 = confere; 1 = nao confere.
Revisao do Codex (07/10): entrada que nao seja uma contagem completa PARA o comparador (saida 1): arquivo vazio, linha que
nao e `tabela|numero` (o "HTTP 400 ..." de um sqlprod.py antigo, por exemplo) ou contagem sem as tabelas-sentinela."""
import io, json, sys

EXCLUIDAS_DE_PROPOSITO = {"storage.buckets_vectors", "storage.vector_indexes"}  # os -x do data.sql (dump_producao.ps1)
# Existem na producao (desde a fatia 1) e em toda copia restaurada dela; sem as duas, a entrada nao e uma contagem real.
SENTINELAS = {"public.ai_agents", "supabase_migrations.schema_migrations"}

def ler(caminho):
    texto = io.open(caminho, encoding="utf-8").read().strip()
    contagens = {}
    if texto.startswith("["):
        for linha in json.loads(texto):
            contagens[linha["tabela"]] = int(linha["linhas"])
    else:
        for linha in texto.splitlines():
            if not linha.strip():
                continue
            if "|" not in linha:
                sys.exit(f"{caminho}: linha que nao e contagem: {linha[:80]!r}; parar")
            tabela, numero = linha.rsplit("|", 1)
            contagens[tabela.strip()] = int(numero)
    faltam = SENTINELAS - set(contagens)
    if faltam:
        sys.exit(f"{caminho}: {len(contagens)} contagem(ns) lida(s), sem {', '.join(sorted(faltam))}; nao e uma contagem completa; parar")
    return contagens

antes, depois, copia = (ler(c) for c in sys.argv[1:4])
falhas = 0
for tabela in sorted(set(antes) | set(depois)):
    a, d = antes.get(tabela), depois.get(tabela)
    if a is None or d is None:
        print(f"MUDOU NA JANELA (tabela criada ou apagada durante o dump): {tabela} antes={a} depois={d}")
        falhas += 1
        continue
    if tabela not in copia:
        if tabela in EXCLUIDAS_DE_PROPOSITO:
            print(f"excluida de proposito do data.sql: {tabela} ({a} linhas na producao)")
            continue
        print(f"FALTA NA COPIA: {tabela} ({a} linhas na producao)")
        falhas += 1
        continue
    c = copia[tabela]
    baixo, alto = min(a, d), max(a, d)
    if a == d and c != a:
        print(f"DIVERGE: {tabela} producao={a} copia={c}")
        falhas += 1
    elif not (baixo <= c <= alto):
        print(f"DIVERGE: {tabela} producao entre {baixo} e {alto} durante o dump, copia={c}")
        falhas += 1
for tabela in sorted(set(copia) - set(antes) - set(depois)):
    print(f"so na copia (da propria stack local): {tabela} ({copia[tabela]} linhas)")
print(f"tabelas da producao: {len(set(antes) | set(depois))} | na copia: {len(copia)} | falhas: {falhas}")
sys.exit(1 if falhas else 0)
```

Conferir sem rede, na pasta do rito (Git Bash), com quatro entradas: uma contagem que confere, contagens vazias, um erro HTTP no lugar da contagem e uma tabela faltando na cópia:

```bash
T="$(cygpath -m "$TEMP")/comparador-prova"; mkdir -p "$T"
printf '[{"tabela":"public.ai_agents","linhas":2},{"tabela":"supabase_migrations.schema_migrations","linhas":90},{"tabela":"public.tabela_x","linhas":5}]\n' > "$T/ok.json"
printf 'public.ai_agents|2\nsupabase_migrations.schema_migrations|90\npublic.tabela_x|5\n' > "$T/copia_ok.txt"
printf 'public.ai_agents|2\nsupabase_migrations.schema_migrations|90\n' > "$T/copia_falta.txt"
printf 'HTTP 400 {"message":"Failed to run sql query"}\n' > "$T/http.json"
: > "$T/vazio.json"
python g23-restauracao/comparar_contagens.py "$T/ok.json" "$T/ok.json" "$T/copia_ok.txt"; echo "saida=$?"
python g23-restauracao/comparar_contagens.py "$T/vazio.json" "$T/vazio.json" "$T/copia_ok.txt"; echo "saida=$?"
python g23-restauracao/comparar_contagens.py "$T/http.json" "$T/ok.json" "$T/copia_ok.txt"; echo "saida=$?"
python g23-restauracao/comparar_contagens.py "$T/ok.json" "$T/ok.json" "$T/copia_falta.txt"; echo "saida=$?"
rm -r "$T"
```
Expected, nesta ordem: `falhas: 0` e `saida=0`; `0 contagem(ns) lida(s), sem public.ai_agents, supabase_migrations.schema_migrations` e `saida=1`; `linha que nao e contagem: 'HTTP 400 ...'` e `saida=1`; `FALTA NA COPIA: public.tabela_x` e `saida=1`. (Medido em 07/10 com este código. A v1 deste plano, sem as sentinelas, dava `falhas: 0` e `saida=0` no segundo caso: aprovava um backup sem nenhuma contagem da produção.)

- [ ] **Step 8: A restauração v2 — `g23-restauracao/restaurar_v2.sh`**

```bash
#!/usr/bin/env bash
# restaurar_v2.sh (fatia 2) - restaura o dump de PRODUCAO na stack isolada ensaio-g23 e prova os requisitos 2, 3 e 4 da
# politica de backup: roles.sql restaurado como supabase_admin (superusuario da stack) desde o inicio, na mesma transacao;
# historico de migrations vindo do PROPRIO dump; contagem de todas as tabelas dos esquemas despejados; migration da fatia e
# a volta dela direto dos arquivos, sem recriar nada a mao. Nada de producao aqui.
# Uso: bash restaurar_v2.sh "C:/Users/PC Gamer/BaseCRM-dumps/<data>" <migration.sql> <volta.sql> <versao> <nome> <sha256>
set -u
export MSYS_NO_PATHCONV=1   # sem isto o Git Bash converte /tmp/x nos argumentos do docker exec
[ $# -eq 6 ] || { echo "uso: restaurar_v2.sh <pasta-do-dump> <migration.sql> <volta.sql> <versao> <nome> <sha256>"; exit 2; }
D="$1"; MIG="$2"; VOLTA="$3"; VERSAO="$4"; NOME="$5"; SHA="$6"
C=supabase_db_ensaio-g23
AQUI="$(cd "$(dirname "$0")" && pwd)"
LOGS="$(cygpath -u "${TEMP}")/ensaio-g23/logs"; mkdir -p "$LOGS"
ADMIN_URL='postgresql://supabase_admin:postgres@127.0.0.1:5432/postgres'
p() { docker exec "$C" psql -U postgres -d postgres -At -c "$1"; }
# Contagem de todas as tabelas. Sem ON_ERROR_STOP o psql sai 0 num erro de script, com o arquivo vazio, e "contagens
# iguais" compararia dois vazios; as duas tabelas-sentinela do comparador tem que estar no arquivo (revisao do Codex, 07/10).
contar() {
  docker exec -i "$C" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -F '|' < "$AQUI/contagens_todas.sql" > "$1" \
    || { echo "contagem FALHOU: $1"; return 1; }
  grep -q '^public\.ai_agents|' "$1" && grep -q '^supabase_migrations\.schema_migrations|' "$1" \
    || { echo "contagem sem as tabelas-sentinela: $1"; return 1; }
}

echo "== $(date '+%H:%M:%S') container"; docker ps --filter "name=$C" --format '{{.Names}} | {{.Status}} | {{.Image}}'
[ "$(sha256sum "$MIG" | cut -c1-64)" = "$SHA" ] || { echo "sha256 da migration diferente do informado; parar"; exit 1; }
for f in roles.sql schema.sql historico_schema.sql data.sql historico_data.sql; do
  docker cp "$D/$f" "$C:/tmp/$f" || { echo "docker cp $f FALHOU"; exit 1; }
done

echo "== $(date '+%H:%M:%S') restauracao em UMA transacao, como supabase_admin desde o inicio (requisito 2)"
docker exec "$C" psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file /tmp/roles.sql --file /tmp/schema.sql --file /tmp/historico_schema.sql \
  --command 'SET session_replication_role = replica' \
  --file /tmp/data.sql --file /tmp/historico_data.sql \
  --dbname "$ADMIN_URL" > "$LOGS/restauracao.log" 2>&1
rc=$?
echo "restauracao EXIT=$rc | linhas com ERROR no log: $(grep -c -E 'ERROR' "$LOGS/restauracao.log")"
[ "$rc" = 0 ] || { grep -E 'ERROR|FATAL' "$LOGS/restauracao.log" | head -5 | cut -c1-200; exit 1; }

echo "== contagem de todas as tabelas dos esquemas despejados na copia (requisito 4)"
contar "$LOGS/copia.txt" || exit 1
echo "tabelas contadas: $(wc -l < "$LOGS/copia.txt")"
echo "== historico de migrations veio do dump (requisito 3): $(p "select count(*) from supabase_migrations.schema_migrations") linha(s)"

echo "== $(date '+%H:%M:%S') migration da fatia na copia"
docker exec -i "$C" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$MIG" > "$LOGS/migration.log" 2>&1 \
  || { grep -E 'ERROR' "$LOGS/migration.log" | head -5 | cut -c1-200; exit 1; }
# A linha que o aplicar_migration.py grava pela API (versao, nome, idempotency_key = sha256). A TABELA veio do dump.
# "on conflict" so importa no ensaio com o banco local, que ja tem a versao desta fatia no historico.
p "insert into supabase_migrations.schema_migrations (version, name, idempotency_key) values ('$VERSAO', '$NOME', '$SHA') on conflict (version) do nothing" > /dev/null || exit 1
echo "linhas da versao no historico antes da volta: $(p "select count(*) from supabase_migrations.schema_migrations where version = '$VERSAO'") (tem que ser 1)"

echo "== $(date '+%H:%M:%S') volta da fatia na copia, direto do arquivo"
docker exec -i "$C" psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$VOLTA" > "$LOGS/volta.log" 2>&1 \
  || { grep -E 'ERROR' "$LOGS/volta.log" | head -5 | cut -c1-200; exit 1; }
echo "linhas da versao no historico depois da volta: $(p "select count(*) from supabase_migrations.schema_migrations where version = '$VERSAO'") (tem que ser 0)"
contar "$LOGS/copia_depois_da_volta.txt" || exit 1
if cmp -s "$LOGS/copia.txt" "$LOGS/copia_depois_da_volta.txt"; then
  echo "contagens iguais antes e depois de migration + volta"
else
  echo "contagens MUDARAM com migration + volta"; exit 1
fi
echo "== $(date '+%H:%M:%S') FIM. Agora: python comparar_contagens.py antes.json depois.json $LOGS/copia.txt"
```

- [ ] **Step 9: Ensaiar a restauração v2 com um dump da stack local (sem produção)**

O ensaio usa a mesma mecânica com os dados de teste do banco local (`crmia`), sem produção:

1. Os cinco arquivos a partir da `crmia`, com os mesmos argumentos do dump de produção, rodando na pasta do rito (sem `supabase/` nela, para a imagem ser a conferida). A senha `postgres` é a padrão da stack local:

```powershell
$P = Join-Path $env:TEMP 'ensaio-dump-local'
New-Item -ItemType Directory -Force $P | Out-Null
$url = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
npx --yes supabase@2.120.0 db dump --db-url $url -f "$P\roles.sql" --role-only
npx --yes supabase@2.120.0 db dump --db-url $url -f "$P\schema.sql"
npx --yes supabase@2.120.0 db dump --db-url $url -f "$P\data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
npx --yes supabase@2.120.0 db dump --db-url $url -f "$P\historico_schema.sql" --schema supabase_migrations
npx --yes supabase@2.120.0 db dump --db-url $url -f "$P\historico_data.sql" --use-copy --data-only --schema supabase_migrations
```

2. A contagem da `crmia` no mesmo momento, duas vezes (faz o papel de "antes" e "depois"; aqui ninguém escreve):

```bash
docker exec -i supabase_db_crmia psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -F '|' < g23-restauracao/contagens_todas.sql > "$TEMP/ensaio-dump-local/antes.txt"
cp "$TEMP/ensaio-dump-local/antes.txt" "$TEMP/ensaio-dump-local/depois.txt"
```

3. Trocar de stack: `npx supabase stop` no worktree (a `crmia` usa as mesmas portas); na pasta `%TEMP%/ensaio-g23` (com `supabase init` antes, se ela não existir, e `project_id = "ensaio-g23"`, `[db] major_version = 17` no `config.toml`), `npx --yes supabase@2.120.0 start`.

4. A restauração:

```bash
WT="/c/Users/PC Gamer/WorkSync/projetos/Basecrm-worktrees/central-agentes"
MIG="$WT/supabase/migrations/20261007120000_central_agentes_editor.sql"
bash g23-restauracao/restaurar_v2.sh "$(cygpath -m "$TEMP")/ensaio-dump-local" "$MIG" "$WT/docs/features/central-de-agentes/volta-fatia-2.sql" 20261007120000 central_agentes_editor "$(sha256sum "$MIG" | cut -c1-64)"
python g23-restauracao/comparar_contagens.py "$TEMP/ensaio-dump-local/antes.txt" "$TEMP/ensaio-dump-local/depois.txt" "$(cygpath -u "$TEMP")/ensaio-g23/logs/copia.txt"
```

Expected: `restauracao EXIT=0` com 0 linhas de `ERROR`; histórico com ao menos 1 linha; `antes da volta: 1` e `depois da volta: 0`; `contagens iguais antes e depois de migration + volta`; o comparador com `falhas: 0` (tabelas "só na cópia" aparecem como informação).

5. Desfazer: `npx --yes supabase@2.120.0 stop --no-backup` na `ensaio-g23`, `npx supabase start` no worktree, `npx supabase status` com a `crmia` de pé, e apagar `%TEMP%/ensaio-dump-local`.

- [ ] **Step 10: LEIA-ME e commit no cérebro**

No `LEIA-ME.md` do rito: o item 6 ganha "erro HTTP sai 1, com a mensagem no stderr"; o item 10, a v4.3 (os dois requisitos do dump); o item 11, o `-Data` obrigatório (`-Modo criar|rotacionar -Data <data>`) e a regra do Step B2 da Task 15 (qualquer falha depois do `criar` rotaciona primeiro; nova tentativa em pasta nova); o item 12, a versão com parâmetro e cinco arquivos; e o item 13, o `restaurar_v2.sh`, o `contagens_todas.sql` e o `comparar_contagens.py`, com a decisão do `roles.sql` (restaurar como `supabase_admin`) e as tabelas-sentinela.

```bash
git -C "/c/Users/PC Gamer/brains/cenoura-brain" add 06-References/basecrm-rito-publicacao/dump_producao.ps1 06-References/basecrm-rito-publicacao/prova_dump_local.ps1 06-References/basecrm-rito-publicacao/conferir_pos_dump.ps1 06-References/basecrm-rito-publicacao/sqlprod.py 06-References/basecrm-rito-publicacao/sqlteste.py 06-References/basecrm-rito-publicacao/rota_b_senha.ps1 06-References/basecrm-rito-publicacao/g23-restauracao/contagens_todas.sql 06-References/basecrm-rito-publicacao/g23-restauracao/comparar_contagens.py 06-References/basecrm-rito-publicacao/g23-restauracao/restaurar_v2.sh 06-References/basecrm-rito-publicacao/LEIA-ME.md
git -C "/c/Users/PC Gamer/brains/cenoura-brain" diff --cached --stat
git -C "/c/Users/PC Gamer/brains/cenoura-brain" commit -m "rito BaseCRM: dump v4.3 e restauracao v2 com os quatro requisitos da politica de backup (pooler lido, roles como supabase_admin, historico de migrations, todas as tabelas)"
git -C "/c/Users/PC Gamer/brains/cenoura-brain" push
git -C "/c/Users/PC Gamer/brains/cenoura-brain" status -sb
```
Expected: o `--stat` lista só esses dez caminhos; `status -sb` sem `[ahead N]`.

---

### Task 15: Publicação — ensaio no banco de teste, depois produção com o OK do Junior

**Files (no cérebro, `06-References/basecrm-rito-publicacao/`):**
- Modify: `poll_deploys.py` (`--so-previa` e `--sem-alias`)
- Modify: `alias_teste.py` (v2: resposta fora de 2xx sai 1; `mover` relê o alias e exige o deployment pedido)
- Modify: `rodar_migrar_prod.py` (v2: `--webhook`, e escrita só para o que estiver em `ligacoes-aprovadas.json`)
- Create: `ligacoes-aprovadas.json`
- Modify: `migracoes-aprovadas.json` (entrada da migration desta fatia)
- Create: `06-References/central-de-agentes-2026-09-29/ensaio-fatia-2-<data>.md` (o registro, começado na Task 13)

**Regras desta Task:**
- **Parte A (banco de teste `zvwngsrflkicbbzfmrgy`)** segue com o PLAN aprovado. **Parte B (produção `eqidsihasmwwamkaqfka`)** só com o OK do Junior **para esta fatia**, pedido uma vez, com a lista do Step B0. O OK da fatia 1 não vale aqui.
- **Nenhuma branch nova vai para o GitHub.** A branch `feat/central-agentes` nunca recebe push: uma prévia dela nasceria com as variáveis genéricas, que apontam para a produção (SPEC, achados, item 9). O ensaio usa `feat/aurora-implantacao`, que tem as variáveis do banco de teste.
- O domínio `teste.crm.basea2.com` só aponta para uma prévia depois de o login real provar que ela usa o banco de teste (prova pelo pedido de autenticação, nunca por grep do bundle).
- Cada mensagem real no WhatsApp é mandada pelo Junior (ou por quem ele indicar), nunca simulada.

#### Parte A — ensaio no banco de teste

- [ ] **Step A0: `poll_deploys.py` espera só a prévia e não move o alias, quando pedido**

No cérebro, em `poll_deploys.py`:
1. Na docstring, trocar a linha de uso por:

```python
Uso: python poll_deploys.py <sha-curto> [--so-previa] [--sem-alias]
  --so-previa: so a previa de feat/aurora-implantacao (ensaio sem publicacao de producao)
  --sem-alias: espera e imprime a previa, sem mover teste.crm.basea2.com (o prova_login vem antes de mover)"""
```

2. Depois da linha `SHA = ...`, acrescentar:

```python
SO_PREVIA = "--so-previa" in sys.argv[2:]
SEM_ALIAS = "--sem-alias" in sys.argv[2:]
```

3. Trocar o laço `while` e o que vem depois dele por:

```python
while time.time() < fim:
    if not SO_PREVIA:
        prod = prod if prod and prod.get("state") == "READY" else acha("production")
    prev = prev if prev and prev.get("state") == "READY" else acha("preview", "feat/aurora-implantacao")
    ep = "nao esperada" if SO_PREVIA else (prod.get("state") if prod else "-")
    ev = prev.get("state") if prev else "-"
    print("prod:", ep, "| previa:", ev, flush=True)
    if (SO_PREVIA or ep == "READY") and ev == "READY":
        break
    if "ERROR" in (ep, ev) or "CANCELED" in (ep, ev):
        raise SystemExit("deploy com erro")
    time.sleep(25)

assert prev and prev["state"] == "READY" and (SO_PREVIA or (prod and prod["state"] == "READY")), "timeout"
print("previa:", prev["uid"], "| https://" + prev["url"], "| sha", prev["meta"].get("githubCommitSha", "")[:7])
if SEM_ALIAS:
    raise SystemExit(0)
a = api("POST", f"/v2/deployments/{prev['uid']}/aliases", {"alias": "teste.crm.basea2.com"})
print("alias -> previa", prev["meta"].get("githubCommitSha", "")[:7], "| ok:", bool(a.get("uid") or a.get("deploymentId")))
```

Commit no cérebro só deste arquivo, por caminho explícito.

- [ ] **Step A0b: `alias_teste.py` v2 — erro é erro, e mover confere para onde o alias ficou**

Revisão do Codex, 07/10: hoje `mover` e `apagar` imprimem o HTTP 4xx/5xx e terminam com código 0, então o passo seguinte
roda como se tivesse dado certo, e o login no alias antigo ainda confirmaria o banco de teste. No cérebro, trocar o
`alias_teste.py` inteiro por:

```python
# -*- coding: utf-8 -*-
"""Alias teste.crm.basea2.com na Vercel. Token em processo, nunca impresso.
  python alias_teste.py ver                 # so leitura: para onde o alias aponta
  python alias_teste.py mover <dpl_id>      # POST /v2/deployments/{id}/aliases e RELE o alias: sai 0 so se ele aponta para <dpl_id>
  python alias_teste.py apagar <dpl_id>     # DELETE /v13/deployments/{id} (so se a prova da previa nova falhar)
  python alias_teste.py deployment <dpl_id> # so leitura: estado/url/meta de um deployment
v2 (fatia 2, revisao do Codex de 07/10): resposta fora de 2xx sai com codigo 1 (antes saia 0 com o erro impresso), e o
mover so termina 0 depois de reler o alias e ver o deploymentId pedido."""
import io, json, os, re, sys, urllib.request, urllib.error
COFRE = os.path.join(os.path.expanduser("~"), "WorkSync", ".secrets")
def segredo(nome):
    for ln in io.open(COFRE, encoding="utf-8", errors="ignore"):
        m = re.match(r"^" + nome + r"=(.+)$", ln.strip())
        if m: return m.group(1).strip().strip('"')
VT, TEAM = segredo("VERCEL_TOKEN"), segredo("VERCEL_TEAM_ID")
ALIAS = "teste.crm.basea2.com"
def api(metodo, caminho, corpo=None):
    sep = "&" if "?" in caminho else "?"
    req = urllib.request.Request("https://api.vercel.com" + caminho + sep + "teamId=" + TEAM, method=metodo,
                                 headers={"Authorization": "Bearer " + VT, "Content-Type": "application/json"},
                                 data=json.dumps(corpo).encode() if corpo is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]
def exigir_2xx(st, d):
    if not (200 <= st < 300):
        print(st, (json.dumps(d, default=str) if isinstance(d, dict) else str(d))[:300])
        sys.exit(1)
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "ver":
    st, d = api("GET", f"/v4/aliases/{ALIAS}")
    exigir_2xx(st, d)
    dep = d.get("deployment") or {}
    print(st, "| alias ->", d.get("deploymentId"), "| url:", dep.get("url"), "| updatedAt:", d.get("updatedAt"))
elif cmd == "mover":
    alvo = sys.argv[2]
    st, d = api("POST", f"/v2/deployments/{alvo}/aliases", {"alias": ALIAS})
    exigir_2xx(st, d)
    st2, d2 = api("GET", f"/v4/aliases/{ALIAS}")
    exigir_2xx(st2, d2)
    if d2.get("deploymentId") != alvo:
        print("ALIAS NAO CONFERE: aponta para", d2.get("deploymentId"), "e nao para", alvo)
        sys.exit(1)
    print(st, "| alias ->", alvo, "| relido e conferido")
elif cmd == "apagar":
    st, d = api("DELETE", f"/v13/deployments/{sys.argv[2]}")
    exigir_2xx(st, d)
    print(st, "| apagado", sys.argv[2])
elif cmd == "deployment":
    st, d = api("GET", f"/v13/deployments/{sys.argv[2]}")
    exigir_2xx(st, d)
    print(st, "|", d.get("readyState") or d.get("state"), "|", d.get("url"), "| sha", (d.get("meta") or {}).get("githubCommitSha", "")[:7], "| ramo", (d.get("meta") or {}).get("githubCommitRef"), "| target", d.get("target"))
else:
    sys.exit("uso: ver | mover <dpl_id> | apagar <dpl_id> | deployment <dpl_id>")
```

Conferir, só leitura: `python alias_teste.py deployment dpl_naoexiste000000000000000000` tem que sair **1** (a Vercel responde 404), e `python alias_teste.py ver` sai 0. Commit no cérebro só deste arquivo, por caminho explícito.

- [ ] **Step A1: Leitura do ambiente de ensaio (só leitura)**

Na pasta do rito, um por vez:
```bash
PYTHONUTF8=1 python ler_config_publicacao.py
PYTHONUTF8=1 python ler_env_ensaio.py
```
Expected: os dois saem 0. `ler_env_ensaio.py` prova que a próxima prévia de `feat/aurora-implantacao` nasce apontando para `zvwngsrflkicbbzfmrgy`, com as duas chaves públicas aceitas lá. Sem isso, nada de push.

- [ ] **Step A2: A migration desta fatia no manifesto**

Calcular, no worktree, o sha256 do arquivo **commitado** e o commit:
```bash
git show HEAD:supabase/migrations/20261007120000_central_agentes_editor.sql | sha256sum
git log -1 --format=%h -- supabase/migrations/20261007120000_central_agentes_editor.sql
```

Em `migracoes-aprovadas.json`, acrescentar a entrada (os dois primeiros valores vêm dos comandos acima):

```json
  "20261007120000_central_agentes_editor.sql": {
    "sha256": "<sha256 impresso pelo primeiro comando>",
    "commit": "<sha curto impresso pelo segundo comando>",
    "prova_no_banco": "select (to_regprocedure('public.save_ai_agent_draft(uuid,uuid,integer,text)') is not null or to_regprocedure('public.publish_ai_agent_version(uuid,uuid,integer,integer,text)') is not null or to_regprocedure('public.restore_ai_agent_version(uuid,uuid,integer,integer,integer,text)') is not null) as aplicada",
    "marca_sql": "save_ai_agent_draft|publish_ai_agent_version|restore_ai_agent_version",
    "projetos": {
      "teste": "zvwngsrflkicbbzfmrgy",
      "producao": "eqidsihasmwwamkaqfka"
    },
    "ensaios": {}
  }
```

A `prova_no_banco` olha as três funções: a migration só cria funções, e qualquer uma presente indica um prefixo aplicado. Commit no cérebro só do manifesto.

- [ ] **Step A3: Migration no banco de teste**

No worktree:
```bash
python "/c/Users/PC Gamer/brains/cenoura-brain/06-References/basecrm-rito-publicacao/aplicar_migration.py" teste supabase/migrations/20261007120000_central_agentes_editor.sql --confirmar-banco zvwngsrflkicbbzfmrgy
```
Expected: saída 0, "APLICADA, registrada como 20261007120000". Saída 3 = indeterminado: não repetir; seguir o `--retomar` do LEIA-ME, item 9.

Registrar em `ensaios.teste` do manifesto (sha256, data e hora BRT, a saída) e commitar no cérebro.

- [ ] **Step A4: Push para a branch de ensaio (avanço rápido)**

No worktree, um por vez:
```bash
git fetch origin
git merge-base --is-ancestor origin/feat/aurora-implantacao HEAD && echo AVANCO_RAPIDO_OK
git push origin HEAD:feat/aurora-implantacao
```
Expected: `AVANCO_RAPIDO_OK` antes do push. Sem ele, parar: a branch de ensaio andou e precisa de decisão.

- [ ] **Step A5: Prévia pronta, banco provado pelo login, só então o domínio de teste**

Na pasta do rito, um por vez:
```bash
python poll_deploys.py <sha-curto do HEAD> --so-previa --sem-alias
python prova_login.py --url https://<url impressa pelo comando anterior> --ref zvwngsrflkicbbzfmrgy
python alias_teste.py mover <id dpl_ impresso pelo poll_deploys>
python prova_login.py --url https://teste.crm.basea2.com --ref zvwngsrflkicbbzfmrgy
```
Expected: prévia `READY`; os dois `prova_login.py` saem 0 (pedido de autenticação para `zvwngsrflkicbbzfmrgy.supabase.co` e resposta 400 `invalid_credentials`); o `mover` sai 0 só com o alias relido no deployment pedido. Se o primeiro `prova_login.py` falhar, **não mover o alias** e apagar a prévia (`alias_teste.py apagar <dpl>`, que sai 1 se a Vercel recusar).

- [ ] **Step A6: Uma resposta real nova, prova e o webhook do número de teste**

1. O Junior manda uma mensagem para o número de teste. Esperar a resposta da IA chegar.
2. `python rodar_migrar.py --prova` (pasta do rito).
   Expected: o número de teste em `CONFERE` (evento novo com o commit e o deployment da prévia do Step A5), ou como `ja_ligada` se ainda estiver com o agente.
3. `python rodar_migrar.py --webhook <id do número de teste>`.
   Expected: `WEBHOOK numero=... confere host=teste.crm.basea2.com`.
4. Se o número não estiver ligado: `python rodar_migrar.py --ligar <id do número de teste> --confirmar-banco zvwngsrflkicbbzfmrgy`.
   Expected: `LIGADO numero=... agente=... publicacao=<sha> (<dpl>); linha conferida`.

- [ ] **Step A7: As telas, no navegador, com um usuário descartável no banco de teste**

Pelo caminho registrado em `reference-medir-tela-no-celular` (usuário criado por `POST /auth/v1/admin/users` com a chave de serviço do projeto de teste lida em processo; o gatilho cria o perfil; promover a `agency_admin` por SQL no banco de teste; senha `'Medicao' + token_hex(8) + '!aA1'`):
1. Contar usuários e perfis do banco de teste antes (para conferir a limpeza no fim).
2. Com o Playwright, logado, em `https://teste.crm.basea2.com/platform/tenants/<organização do agente de teste>/agents`:
   - a lista mostra a Aurora, "Versão 1 publicada em ... pela migração" e o número de teste;
   - o editor mostra a leitura por seções (os títulos em maiúscula do prompt; a v1 de teste foi criada com o texto da Aurora de antes de 07/10), as etiquetas das variáveis, "Verificação sem erro nem aviso" (o número de teste tem agenda) e "Publicar" desabilitado;
   - "Editar", acrescentar uma frase de teste claramente marcada (ex.: "TESTE fatia 2: pode ignorar."), "Salvar rascunho": aparece "Rascunho com mudanças";
   - "Publicar", nota "teste fatia 2", "Publicar versão 2": aparece "Versão 2 publicada em ... por ..." e o item fica no histórico;
   - aba "Versões": comparar 1 com 2 mostra só a linha acrescentada; "Restaurar a versão 1", confirmar: aparece a versão 3 "(restaurada da versão 1)";
   - prints em 1440 px e em `devices['Galaxy S9+']`, recarregando a página a cada largura; console sem erro; transbordo medido pela borda dos elementos contra o container (nunca por `scrollWidth`);
   - trocar de cliente pelo seletor estando no editor: cai na lista de agentes do outro cliente, sem 404.
3. Depois de cada publicação (versões 2 e 3), o Junior manda uma mensagem ao número de teste; conferir pelo `sqlteste.py` que o último evento em `ai_reply_events` desse número traz `agent_version` 2 e depois 3, e o `prompt_sha256` do texto de cada versão (o da versão 3 é igual ao da 1).
4. Apagar o usuário descartável (`DELETE /auth/v1/admin/users/{id}`) e conferir por contagem que usuários e perfis voltaram ao número do passo 1.
5. Olhar os prints. Registrar no `ensaio-fatia-2-<data>.md` o que foi visto, os números e os caminhos dos prints (fora do Git, sem dado pessoal).

- [ ] **Step A8: Fechamento da Parte A**

O agente de teste termina na versão 3, com o texto da versão 1: a Aurora de teste responde como antes do ensaio. Registro commitado no cérebro, por caminho explícito; `git status -sb` sem `[ahead N]`.

#### Parte B — produção, com o OK do Junior

- [ ] **Step B0: Pedir o OK, uma vez, com tudo o que vai acontecer**

Mensagem ao Junior, com o resultado da Parte A e esta lista (ele aprova, recusa ou ajusta item por item):
1. **Dump de produção** pela rota B (a senha do banco é redefinida pela API, usada no dump e trocada de novo logo depois), com a v4.3: cinco arquivos, cifrados, contagem de todas as tabelas antes e depois.
2. **Restauração do dump** na stack isolada, com a migration desta fatia e a volta dela aplicadas na cópia.
3. **A migration desta fatia em produção** (só cria as três funções; nenhuma tabela, coluna ou dado muda), pelo `aplicar_migration.py`.
4. **Publicar o código** (`main`): a Central de Agentes aparece só para a agência; o aviso na Central de I.A e o 409 do PATCH passam a valer.
5. **Criar o agente da Aurora e ligar o número dela** (`20532687-e868-48c4-977b-f6f7cac72131`), depois de uma resposta real nova que confira. Só o grupo desse número vira agente (`--somente`). Se a conferência depois de ligar falhar, o próprio script desfaz; se terminar **incerta** (saída 3), desligar o número pelo `--desligar --se-agente` do agente criado. Qualquer outro desligamento pede um OK novo.
6. **A Julia fica como está:** o webhook dela está desligado por decisão dele (15/09) e o `--ligar` recusa enquanto estiver. Religar é decisão dele, e só depois disso ela entra.
7. **Retenção dos dumps:** a proposta de 07/10 (o de 07/10 sai no máximo em 21/10/2026, ou antes, quando houver dump mais novo e o `CONFERE` da Aurora) vale também para este; sem decisão dele, nada é apagado.

O OK vai literal para `migracoes-aprovadas.json` (`producao_liberada`, itens 1 a 4) e para `ligacoes-aprovadas.json` (item 5), commitados no cérebro antes de qualquer escrita.

- [ ] **Step B1: `ligacoes-aprovadas.json` e `rodar_migrar_prod.py` v2**

Criar no rito `ligacoes-aprovadas.json`:

```json
{
  "_leia-me": "Lido por rodar_migrar_prod.py (v2). Escrita em produção pelo migrar-agentes.ts (--criar, --ligar, --desligar) só roda para o que estiver aqui, commitado no cérebro e sem mudança local, com o OK do Junior citado (por, em, texto; campo vazio ou entre <> recusa). --criar exige --somente com o número de uma entrada e a org dela. --desligar exige --se-agente igual a 'agente' e só roda quando o último --ligar do número terminou incerto (saída 3), ou com 'desligar_liberado' preenchido (um OK novo: por, em, texto).",
  "numeros": {
    "20532687-e868-48c4-977b-f6f7cac72131": {
      "nome": "Aurora, Cenno Hub (instância whatsapp-ia-bba4d621)",
      "org": "<organization_id da Cenno Hub: a linha AGENTE org=... da Aurora no --prova do Step B6>",
      "agente": "<id do agente: a linha CRIADO agente=... do --criar do Step B7>",
      "por": "Junior",
      "em": "<data e hora BRT do OK do Step B0>",
      "texto": "<o OK do Step B0, literal>",
      "desligar_liberado": null
    }
  }
}
```

Trocar o `rodar_migrar_prod.py` inteiro por:

```python
# -*- coding: utf-8 -*-
"""Roda scripts/central-agentes/migrar-agentes.ts contra PRODUCAO com as credenciais lidas em processo (cofre + chave
secreta pela API de gerenciamento, reveal=true) e passadas SO ao processo filho. Nunca imprime valor.
  python rodar_migrar_prod.py --prova [--org <uuid>]          (so leitura)
  python rodar_migrar_prod.py --webhook <connectionId>        (so leitura)
  python rodar_migrar_prod.py --criar --org <uuid> --somente <connectionId> --confirmar-banco eqidsihasmwwamkaqfka
  python rodar_migrar_prod.py --ligar <connectionId> --confirmar-banco eqidsihasmwwamkaqfka
  python rodar_migrar_prod.py --desligar <connectionId> --se-agente <agentId> --confirmar-banco eqidsihasmwwamkaqfka
v2 (fatia 2, com a revisao do Codex de 07/10): a escrita so roda para o que estiver em ligacoes-aprovadas.json (mesma
pasta), COMMITADO no cerebro e sem mudanca local, com o OK do Junior citado por inteiro (org, por, em, texto preenchidos;
campo entre <> recusa). --criar exige --somente com um numero da lista e a organizacao dele. --ligar e --desligar exigem o
numero listado. --desligar exige --se-agente igual ao 'agente' da entrada e so roda no caso que o OK cobre: o ultimo
--ligar deste numero, por este wrapper, terminou incerto (saida 3). Fora disso, so com 'desligar_liberado' preenchido."""
import io, json, os, re, subprocess, sys, tempfile, urllib.request
args = sys.argv[1:]
AQUI = os.path.dirname(os.path.abspath(__file__))
MANIFESTO = "ligacoes-aprovadas.json"
# A saida do ultimo --ligar em producao, para o --desligar saber se o caso e o incerto (saida 3) que o OK cobre.
REGISTRO = os.path.join(tempfile.gettempdir(), "basecrm-rito", "ultimo-ligar-producao.json")

def valor(nome):
    if nome not in args:
        return None
    i = args.index(nome)
    return args[i + 1] if i + 1 < len(args) else None

def preenchido(v):
    return isinstance(v, str) and v.strip() != "" and not v.strip().startswith("<")

def recusar(msg):
    sys.exit("recusado: " + msg)

escrita = any(a in args for a in ("--criar", "--ligar", "--desligar"))
if not escrita and not ("--prova" in args or "--webhook" in args):
    sys.exit("uso: --prova, --webhook <id>, ou uma escrita liberada em ligacoes-aprovadas.json")
if escrita:
    # O OK que vale e o que esta commitado no cerebro, nao o de uma copia local editada.
    rastreado = subprocess.run(["git", "-C", AQUI, "ls-files", "--error-unmatch", MANIFESTO], capture_output=True)
    limpo = subprocess.run(["git", "-C", AQUI, "diff", "--quiet", "HEAD", "--", MANIFESTO])
    if rastreado.returncode != 0 or limpo.returncode != 0:
        recusar(MANIFESTO + " tem que estar commitado no cerebro, sem mudanca local")
    aprovadas = json.load(io.open(os.path.join(AQUI, MANIFESTO), encoding="utf-8")).get("numeros", {})
    numero = valor("--ligar") or valor("--desligar") or valor("--somente")
    item = aprovadas.get(numero) if numero else None
    if not item:
        recusar("o numero (--ligar, --desligar ou --somente) tem que estar em " + MANIFESTO)
    for campo in ("org", "por", "em", "texto"):
        if not preenchido(item.get(campo)):
            recusar(f"a entrada do numero {numero} esta sem '{campo}' preenchido")
    if "--criar" in args and (not valor("--somente") or valor("--org") != item["org"]):
        recusar("--criar so com --somente <numero aprovado> e --org igual a organizacao dele")
    if "--desligar" in args:
        if not preenchido(item.get("agente")) or valor("--se-agente") != item["agente"]:
            recusar("--desligar so com --se-agente igual ao agente registrado na entrada do numero")
        ultimo = {}
        try:
            ultimo = json.load(io.open(REGISTRO, encoding="utf-8"))
        except Exception:
            pass
        incerto = ultimo.get("numero") == numero and ultimo.get("saida") == 3
        liberado = item.get("desligar_liberado") or {}
        if not incerto and not all(preenchido(liberado.get(c)) for c in ("por", "em", "texto")):
            recusar("--desligar so quando o ultimo --ligar deste numero terminou incerto (saida 3), ou com desligar_liberado preenchido (um OK novo)")
    print("liberado por %s em %s: \"%s\"" % (item.get("por"), item.get("em"), (item.get("texto") or "")[:160]))

COFRE = os.path.join(os.path.expanduser("~"), "WorkSync", ".secrets")
WORKTREE = "C:/Users/PC Gamer/WorkSync/projetos/Basecrm-worktrees/central-agentes"
REF = "eqidsihasmwwamkaqfka"

def segredo(nome):
    for ln in io.open(COFRE, encoding="utf-8", errors="ignore"):
        m = re.match(r"^" + nome + r"=(.+)$", ln.strip())
        if m:
            return m.group(1).strip().strip('"')

mgmt = segredo("SUPABASE_MGMT_TOKEN")
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", headers={"Authorization": "Bearer " + mgmt})
with urllib.request.urlopen(req, timeout=60) as r:
    chaves = json.loads(r.read().decode())
secret = next((k["api_key"] for k in chaves if k.get("type") == "secret"), None)
service = next((k["api_key"] for k in chaves if k.get("name") == "service_role"), None)
print("chaves de PRODUCAO lidas em processo: secret=%s service_role=%s (valores nunca impressos)" % (bool(secret), bool(service)))
env = dict(os.environ)
env["NEXT_PUBLIC_SUPABASE_URL"] = f"https://{REF}.supabase.co"
if secret:
    env["SUPABASE_SECRET_KEY"] = secret
if service:
    env["SUPABASE_SERVICE_ROLE_KEY"] = service
env["VERCEL_TOKEN"] = segredo("VERCEL_TOKEN")
env["VERCEL_TEAM_ID"] = segredo("VERCEL_TEAM_ID")
cmd = ["C:/Program Files/nodejs/npx.cmd", "--yes", "tsx@4.23.1", "scripts/central-agentes/migrar-agentes.ts"] + args
print("comando:", " ".join(cmd[2:]))
p = subprocess.run(cmd, cwd=WORKTREE, env=env)
print("exit=", p.returncode)
if "--ligar" in args:
    os.makedirs(os.path.dirname(REGISTRO), exist_ok=True)
    json.dump({"numero": valor("--ligar"), "saida": p.returncode}, io.open(REGISTRO, "w", encoding="utf-8"))
sys.exit(p.returncode)
```

Conferir sem rede que as recusas funcionam (rodar na pasta do rito, **antes de commitar** o manifesto e depois de commitá-lo, ainda com os campos entre `<>`):
```bash
python rodar_migrar_prod.py --ligar 20532687-e868-48c4-977b-f6f7cac72131 --confirmar-banco eqidsihasmwwamkaqfka
python rodar_migrar_prod.py --ligar 00000000-0000-4000-8000-000000000000 --confirmar-banco eqidsihasmwwamkaqfka
python rodar_migrar_prod.py --criar --org 00000000-0000-4000-8000-000000000000 --confirmar-banco eqidsihasmwwamkaqfka
python rodar_migrar_prod.py --desligar 20532687-e868-48c4-977b-f6f7cac72131 --se-agente 00000000-0000-4000-8000-000000000000 --confirmar-banco eqidsihasmwwamkaqfka
```
Expected: antes do commit, todas recusadas por "tem que estar commitado". Depois do commit: a primeira por "sem 'org' preenchido", a segunda por "tem que estar em", a terceira por "--somente" (sem número, cai em "tem que estar em"), a quarta pelo `org` vazio. Nenhuma lê o cofre nem chama API: a recusa vem antes do `segredo(...)`. Commit no cérebro dos dois arquivos, por caminho explícito.

- [ ] **Step B2: Dump de produção com os quatro requisitos**

Na pasta do rito, um por vez, com o Docker Desktop sem ninguém mexendo (os comandos `python` e `bash` no Git Bash; os `powershell` como estão). `<data>` é o nome da pasta do dump, o mesmo nos passos 2, 4, 5, 6 e 8 (`AAAA-MM-DD`; numa nova tentativa, com sufixo):
1. `powershell -NoProfile -ExecutionPolicy Bypass -File prova_dump_local.ps1` → `PROVA LOCAL v2: OK`.
2. Preparar a pasta `<data>` como no Step 2.2.1 do PLAN da fatia 1 (nova, cifrada por EFS, ACL só da conta, `icacls /inheritance:r`).
3. Contagem de antes (só nomes de tabela e números):

```bash
mkdir -p "$TEMP/ensaio-g23/contagens"
PYTHONIOENCODING=utf-8 python sqlprod.py g23-restauracao/contagens_todas.sql > "$TEMP/ensaio-g23/contagens/antes.json"; echo "saida=$?"
grep -c -e '"public.ai_agents"' -e '"supabase_migrations.schema_migrations"' "$TEMP/ensaio-g23/contagens/antes.json"
```
Expected: `saida=0` e `2` (as duas tabelas-sentinela do comparador). Qualquer outra coisa: parar aqui; a senha ainda não foi trocada.
4. `powershell -NoProfile -ExecutionPolicy Bypass -File rota_b_senha.ps1 -Modo criar -Data <data>` → `CRIADO`.
5. `powershell -NoProfile -ExecutionPolicy Bypass -File dump_producao.ps1 -Data <data>` → saída 0, cinco arquivos cifrados, `pooler conferido no endpoint: aws-1-us-east-2.pooler.supabase.com`.
6. `powershell -NoProfile -ExecutionPolicy Bypass -File rota_b_senha.ps1 -Modo rotacionar -Data <data>` → `ROTACIONADA` (ninguém fica com a senha). Vem logo depois do dump e antes da contagem de depois: a contagem usa o token de gerenciamento, não a senha do banco, e assim a senha usada no dump não fica valendo enquanto se conta.
7. Contagem de depois, igual à de antes, em `depois.json`:

```bash
PYTHONIOENCODING=utf-8 python sqlprod.py g23-restauracao/contagens_todas.sql > "$TEMP/ensaio-g23/contagens/depois.json"; echo "saida=$?"
grep -c -e '"public.ai_agents"' -e '"supabase_migrations.schema_migrations"' "$TEMP/ensaio-g23/contagens/depois.json"
```
Expected: `saida=0` e `2`.
8. `powershell -NoProfile -ExecutionPolicy Bypass -File conferir_pos_dump.ps1 -Data <data>` → `POS-DUMP: OK`.

**Se o passo 4 ou o 5 falhar** (revisão do Codex, 07/10): rodar o passo 6 (`rotacionar`) antes de qualquer outra coisa, mesmo que a troca do passo 4 pareça não ter acontecido. A senha pode ter mudado e já ter passado pelo container do dump, e rotacionar de novo não custa nada. O `dump_producao.ps1` apaga o arquivo da senha no `finally`, mas não os arquivos parciais, e tanto ele quanto o `criar` exigem a pasta vazia: a nova tentativa vai numa pasta nova (`<data>-b`, que o `-Data` aceita), preparada como no passo 2, recomeçando do passo 3. A pasta que falhou fica como está, cifrada, e segue a retenção (item 7 do B0): apagar é decisão do Junior.
**Se o passo 6 falhar:** repetir. Se continuar falhando, avisar o Junior antes de qualquer outra coisa: a senha do passo 4 continua valendo no banco.
**Se o passo 7 falhar:** repetir só ele, em seguida. Se falhar de novo, o requisito 4 não tem como ser provado para este dump: parar e registrar. Uma nova tentativa recomeça do passo 2, com pasta nova.

- [ ] **Step B3: Restauração do dump de produção, com migration e volta da fatia**

A mesma sequência do Step 9 da Task 14 (trocar de stack, `restaurar_v2.sh`, desfazer), com a pasta do dump de produção e os arquivos `antes.json` e `depois.json` do Step B2 no comparador:
```bash
bash g23-restauracao/restaurar_v2.sh "C:/Users/PC Gamer/BaseCRM-dumps/<data>" "$MIG" "$WT/docs/features/central-de-agentes/volta-fatia-2.sql" 20261007120000 central_agentes_editor "$(sha256sum "$MIG" | cut -c1-64)"
python g23-restauracao/comparar_contagens.py "$TEMP/ensaio-g23/contagens/antes.json" "$TEMP/ensaio-g23/contagens/depois.json" "$(cygpath -u "$TEMP")/ensaio-g23/logs/copia.txt"
```
Expected: restauração saída 0 sem `ERROR`, histórico vindo do dump, versão `0` no histórico depois da volta, contagens iguais antes e depois de migration + volta, comparador com `falhas: 0`. Derrubar a `ensaio-g23` com `stop --no-backup` (a cópia restaurada some junto) e religar a `crmia`.

Registrar em `ensaios.copia_restaurada` do manifesto (sha256 da migration, data e hora BRT, o resumo das saídas) e `producao_liberada` (por, em, texto literal do OK, `maquina` = o `COMPUTERNAME`, `token_do_agente_aceito: true` pela decisão 7 da SPEC). Commit no cérebro.

- [ ] **Step B4: Migration em produção**

No worktree:
```bash
python "/c/Users/PC Gamer/brains/cenoura-brain/06-References/basecrm-rito-publicacao/aplicar_migration.py" producao supabase/migrations/20261007120000_central_agentes_editor.sql --confirmar-banco eqidsihasmwwamkaqfka
```
Expected: saída 0, registrada como `20261007120000`. Saída 3: não repetir; `--retomar` (LEIA-ME, item 9).

- [ ] **Step B5: Publicar o código**

No worktree, um por vez:
```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo AVANCO_RAPIDO_OK
git push origin HEAD:main
git push origin HEAD:feat/aurora-implantacao
```
Na pasta do rito, um por vez. A ordem é a da revisão do Codex de 07/10: deployment pronto, login na URL dele, alias, releitura do alias, login no alias. Um redeploy do mesmo commit pode ter outras variáveis, então a prévia é provada pela URL **dela** antes de o alias mudar:
```bash
python poll_deploys.py <sha-curto do HEAD> --sem-alias
python prova_login.py --url https://<url da prévia impressa pelo comando anterior> --ref zvwngsrflkicbbzfmrgy
python alias_teste.py mover <id dpl_ da prévia impresso pelo poll_deploys>
python prova_login.py
```
Expected: produção e prévia `READY`; a prévia provada no banco de teste pela URL dela; o `mover` saindo 0 só com o alias relido no deployment pedido; `prova_login.py` saindo 0 para os três domínios de produção (`eqidsihasmwwamkaqfka`) e para o de teste (`zvwngsrflkicbbzfmrgy`). Entre a produção ficar pronta e o `mover`, o domínio de teste aponta para a produção (a Vercel o leva junto, PROJECT LEARNINGS de 17/09): ninguém usa o domínio de teste nesse intervalo.

- [ ] **Step B6: Uma resposta real da Aurora, prova e webhook**

1. O Junior manda uma mensagem ao número da Aurora (ou espera um lead real). Esperar a resposta.
2. `python rodar_migrar_prod.py --prova` → a Aurora em `CONFERE` com o sha `e7b24641f322…`, o commit do Step B5 e o deployment servido. Copiar o `org=` da linha `AGENTE` da Aurora para `ligacoes-aprovadas.json` e commitar no cérebro.
3. `python rodar_migrar_prod.py --webhook 20532687-e868-48c4-977b-f6f7cac72131` → `confere host=crm.basea2.com`.

- [ ] **Step B7: Criar o agente e ligar a Aurora**

```bash
python rodar_migrar_prod.py --criar --org <org da Cenno Hub> --somente 20532687-e868-48c4-977b-f6f7cac72131 --confirmar-banco eqidsihasmwwamkaqfka
```
Expected: `CRIADO agente=...` só para o grupo do número aprovado (o `--somente` recusa se ele não estiver num grupo pronto). Copiar o id do agente para `agente` na entrada de `ligacoes-aprovadas.json` e commitar no cérebro, por caminho explícito. Só então:
```bash
python rodar_migrar_prod.py --ligar 20532687-e868-48c4-977b-f6f7cac72131 --confirmar-banco eqidsihasmwwamkaqfka
```
Expected: `LIGADO numero=20532687-... agente=... publicacao=<sha> (<dpl>); linha conferida`. Saída 3 (`incerto`): `--desligar 20532687-... --se-agente <agente da entrada>`, que o wrapper aceita porque o último `--ligar` registrado terminou em 3. Saída 4 (`ligado_a_outro`): nada de desligar sem falar com o Junior.

- [ ] **Step B8: A próxima resposta real sai pelo agente**

Depois de uma resposta real da Aurora, conferir pelo `sqlprod.py` (só leitura) que o último evento do número tem `prompt_source = 'agent'`, `agent_version = 1` e o mesmo `prompt_sha256` (`e7b24641f322…`). A Central de I.A só lista a chave padrão, que não é a da Aurora; o aviso dela vai aparecer no cliente da Julia, quando a Julia for ligada.

- [ ] **Step B9: A Julia**

`python rodar_migrar_prod.py --webhook 9529670e-fc99-431d-944a-8f7140b7178c` → esperado `recusado motivo=webhook_desligado`. Registrar e parar aqui: ela entra quando o Junior religar o webhook dela num domínio da lista; então repete-se o Step B6 e o B7 para ela, com a entrada dela em `ligacoes-aprovadas.json` e o OK dele.

- [ ] **Step B10: Fechamento**

- Registro completo em `ensaio-fatia-2-<data>.md` (Parte A e Parte B, com saídas e horários em BRT).
- Cartões do cérebro (`03-Projects/BaseCRM.md`, `01-State/HANDOFF.md`) com o estado: fatia 2 em produção, Aurora no agente, Julia aguardando o webhook, retenção dos dumps conforme a decisão dele.
- Commit do cérebro por caminhos explícitos e `git status -sb` sem `[ahead N]`.

---

---

## Autorrevisão do plano (07/10, antes da revisão do Codex)

Feita contra a SPEC (`docs/features/central-de-agentes/SPEC.md`: "Fatia 2", "Critérios de aceite", "Portões de segurança"). O que ela achou já está corrigido nas tasks acima; a lista do que mudou fica no fim.

### 1. Cada item da SPEC, onde está e o que o prova

| Item da SPEC (fatia 2) | Tasks | Prova |
|---|---|---|
| Rotas de tela `/agents` e `/agents/[agentId]`, travadas pelo teste que lê o disco | 6 e 8 | `workspaceRoutes.test.ts`: rotas base (já existia) e páginas com segmento dinâmico (novo, Task 8) |
| Item "Agentes" no menu do cliente, só para a agência | 6 | `navConfig.agentes.test.ts`, `usePlatformTenantWorkspaceNav.agentes.test.tsx`; a tela mostra `AccessDenied` aos outros papéis |
| Seção Prompt: leitura formatada, "Editar", barra "Versão N publicada em [data] por [pessoa]", "Rascunho com mudanças", "Publicar" | 3, 6 e 8 | `leituraDoPrompt.test.ts` (títulos medidos e ida e volta), `formatos.test.ts` (hora de Brasília), `AgentEditorPage.test.tsx` |
| Rotas de API com `requireTenantAccess(..., { adminOnly: true })` e zod `.strict()` | 5 | `route.test.ts` (403 nas sete, 400 por campo fora da lista) e `tenantAccess.adminOnly.test.ts` (o elo do 403, provado com a trava desligada) |
| Escrita pelo cliente do usuário (JWT), nunca pela chave de serviço | 4 e 5 | `route.test.ts` (as rotas usam o cliente do usuário) e a matriz da Task 2 (a chave de serviço recebe 42501) |
| Salvar rascunho manda a `draft_revision` lida; outra aba salvou antes: 409 | 1, 2, 4, 5 e 8 | Task 2 (revisão velha recusada, nada muda) e `AgentEditorPage.test.tsx` (avisa, sai da edição e recarrega) |
| Publicar manda versão e revisão mostradas; a função confere a organização, trava a linha e publica aquele rascunho; número mudado: 409 e a tela recarrega | 1, 2, 4, 5 e 8 | Task 2 (corrida com a espera observada por `pg_blocking_pids` e `transactionid`; organização trocada recusada) e `AgentEditorPage.test.tsx` (409 ao publicar fecha o diálogo e recarrega) |
| Histórico com autor, data e nota; comparar quaisquer duas, texto por linha e ajustes por campo; "Restaurar" com confirmação, publicando como versão nova | 1, 2 e 7 | `compararVersoes.test.ts`, `HistoricoDeVersoes.test.tsx`, Task 2 (`restored_from`) |
| Antes de ligar, o script lê o webhook na Evolution e exige domínio da lista fechada; só então `LIGAR_EM_PRODUCAO_LIBERADO = true` | 12 | `webhookDoNumero.test.ts` (os sete motivos de recusa) e `centralAgentesScriptWebhook.test.ts` |
| PATCH de `aiPromptKey` num número ligado: 409, "configurado no agente X" | 10 | `route.agente.test.ts` |
| `migrated-prompts.lock.json` e o teste de trava | 11 | `migratedPromptsLock.test.ts`, mais a prova negativa depois do commit (mudar uma letra no catálogo derruba o teste) |
| Aviso na Central de I.A | 9 | `AIFeaturesSection.agentes.test.tsx` e `numerosDaChave.test.ts` (contagem feita no servidor) |
| Verificação ao vivo: função pura, tela e servidor; erro, aviso e informação | 3, 4 e 8 | `verificarPrompt.test.ts` (cada item, lendo Aurora e Julia do catálogo e as 12 variáveis do `aiReply.ts`), Task 4 (publicar com aviso não confirmado: 422) |
| Primeira ligação em produção | 15 (Parte B) | rito com o OK registrado; a Julia depende do webhook dela (ver item 4 da seção 4) |

### 2. Critérios de aceite da fatia 2

| Critério | Onde |
|---|---|
| Publicar cria N+1 e move o ponteiro atomicamente | Task 2 |
| Duas publicações com a mesma versão esperada: uma ganha, a outra 409; revisão diferente da mostrada: 409 | Task 2 (corrida observada) e Task 4 (tradução para 409 com código) |
| Restaurar cria versão nova com `restored_from` | Tasks 2 e 7 |
| A verificação aponta cada item; os prompts atuais não disparam erro nem aviso, e a Julia mostra só a informação do encerramento | Task 3 (a Julia dá exatamente `['sem_encerramento']`). A Aurora fica limpa com um número ligado que tem agenda; antes disso ela mostra o aviso `agenda_sem_numero`, que é verdadeiro (sem agenda, o runtime manda `AGENDA_NAO_CONFIGURADA`). Ponto do Codex, 07/10 |
| Central de I.A: aviso com link e sem o editor quando todos os números da chave têm agente; aviso quando só alguns têm | Task 9 |
| PATCH de `aiPromptKey` num número ligado: 409 | Task 10 |
| O teste de trava falha quando o texto de uma chave migrada muda | Task 11 |
| Campo fora da lista: 400 | Task 5 |
| Admin do cliente: 403 em todas as rotas | Task 5 (as sete rotas e o `adminOnly`) e Task 2 (as funções recusam por dentro com 42501) |
| Toda fatia: suíte lida num comando separado, `git diff --stat` conferido, prévia provada pelo login real, produção só com o OK | o passo de commit de cada task, Task 13, Task 15 Parte A (`prova_login`) e Parte B0 |

### 3. Portões de segurança

| Portão | Como fica nesta fatia |
|---|---|
| G2 e G13 | As três funções novas: `execute` só para `authenticated`, revogado de `public`, `anon` e `service_role`; a auxiliar das variáveis sem `execute` para ninguém. Na Task 2, o privilégio efetivo é lido no catálogo (`has_function_privilege`) e a chamada de verdade separa o "permission denied" do Postgres do `sem_permissao` da função. Só `agency_admin` e o legado `admin` passam do papel. |
| G3 | `adminOnly` em toda rota (Task 5) e papel conferido de novo dentro de cada função (Task 1). A regra que bloqueia Publicar (variável fora das 12) vale também dentro da função, para quem chamar direto pelo JWT (Tasks 1 e 2). |
| G4 | A função recebe a organização e só acha o agente com o filtro dela (Task 1); toda leitura filtra por organização (Task 4). |
| G5 e G19 | `.strict()` em todo corpo; o autor vem de `auth.uid()`, nunca do corpo. `settings` e `model` mandados ao publicar recebem 400 (Task 5). |
| G7 e G18 | Teto de 50 mil caracteres na rota e na função, nota de até 200, limite de células na comparação (Tasks 1, 5 e 7); aviso acima de 30 mil (Task 3). |
| G20 | Invariantes novas: o rascunho só se grava sobre a revisão lida; só se publica o rascunho mostrado; restaurar não cria versão igual à publicada (`sem_mudancas`); nenhuma versão é publicada nem restaurada com variável fora das 12, garantido no banco. A versão continua imutável pelo gatilho da fatia 1. |
| G22 | A configuração da conexão nunca sai do servidor (Task 4, teste com `NAO-PODE-SAIR`); o script nunca imprime a query, os cabeçalhos ou o corpo do webhook (Task 12). |
| G23 | A migration só cria funções (aditiva). Backup com os quatro requisitos (Task 14), com as contagens parando em erro HTTP, arquivo vazio ou falta das tabelas-sentinela, a senha sempre na pasta do dump e rotacionada depois de qualquer falha; restauração e volta na cópia (Task 15, B3). Continua **FAIL com exceção residual aceita** (decisão 7), como na fatia 1. |
| G24 | **NÃO-TESTADO**: o rastro de versão é registro, e esta fatia não cria alerta. |
| G25 | N/A. Nenhuma branch nova vai para o GitHub; o ensaio usa `feat/aurora-implantacao`, que já tem as variáveis do banco de teste. |
| G15, G16 e G17 | N/A: o teste sem enviar é da fatia 3. |

### 4. Onde o plano se afasta da letra da SPEC, e por quê (pontos para o Codex contestar)

1. **O editor não entra em `TENANT_SCOPED_BASE_ROUTES`.** A lista casa por igualdade exata (`workspaceRoutes.ts:60`, `TENANT_SCOPED_BASE_ROUTES.has(pathname)`), então um caminho com o id do agente nunca casaria. Entra `/agents`. Ao trocar de cliente no editor, o seletor cai na lista (`LISTAS_COM_DETALHE`, Task 8), e o teste do disco passa a ler também as páginas com segmento dinâmico. O efeito que a SPEC pede, trocar de cliente nunca cair em 404, fica travado por teste.
2. **A Aurora tem 20.202 caracteres, não os 18.848 da SPEC.** O texto mudou na própria fatia 1 (`6a29238`, com a lista de serviços aprovada). O plano usa o sha e o tamanho medidos em 07/10, e o teste lê o catálogo em vez de um número fixo.
3. **`settings` e `model` não passam pelo publicar.** A versão nova copia os da publicada (hoje `{}` e nulo). A recusa de chave desconhecida em `settings` (G5/G19) vale por construção: a função não tem esse parâmetro e a rota devolve 400 para os dois campos. A lista fechada de chaves chega na fatia 4.
4. **A Julia não é ligada junto com a Aurora.** O webhook dela está desligado por decisão do Junior em 15/09. O script recusa com `webhook_desligado`, e isso é o esperado (Task 15, B9). Ela entra quando ele religar o webhook num domínio da lista e houver uma resposta real nova.
5. **Restaurar recusa conteúdo igual ao publicado** (`sem_mudancas`). A SPEC não fala disso; sem a recusa, restaurar a versão que já é a atual criaria uma N+1 idêntica, e o histórico ganharia uma linha que não muda nada.

### 5. Varredura de lacunas, nomes e medições

- **Placeholders:** nenhum "TBD", "TODO", "implementar depois" nem "igual à Task N" no plano; todo passo de código traz o código.
- **Nomes entre tasks:** os tipos de `tiposDoEditor.ts` (Task 4) batem campo a campo com os dados de teste do editor (Task 8). As funções de `editorAgentes.ts`, `agentesApi`, `verificarPrompt` e os esquemas da rota têm os mesmos nomes onde são definidos e onde são usados.
- **Medido nesta revisão, sobre `6a29238`:**
  - o teste do `adminOnly` passa 5 de 5;
  - com a linha do `adminOnly` desligada, os três casos de 403 falham e os dois da agência passam;
  - no Vitest 4.1.11, `it.each` com lista vazia passa sem erro, então o "Expected" do Task 8, Step 1, está certo;
  - hoje não existe nenhuma página com segmento dinâmico sob `[tenantId]`, então o teste novo do disco só vai encontrar o editor do agente.

  Os dois arquivos de teste temporários foram apagados e a árvore voltou limpa.
- **Corrigido por esta revisão:**
  - **Task 5:** entrou o teste direto do `adminOnly`, que nenhum teste do repositório cobria. O teste de corpo estrito ganhou `settings`, `model` e um prompt acima do teto.
  - **Task 8:** entrou o teste do 409 ao publicar, porque só o 409 ao salvar estava coberto.
  - **Tasks 6 e 8:** a lista `['/agents']`, que nascia em dois arquivos, virou uma só, exportada de `workspaceRoutes.ts` na Task 6 e reusada na Task 8. Assim, uma tela de detalhe nova entra num lugar só.

### 6. Revisão do Codex, rodada 1 (07/10, 09h28 a 09h41, parcial)

O Codex revisou com cinco revisores em paralelo e bateu no limite de uso às 09h41, antes de consolidar o parecer. Três revisores terminaram (SQL; prompt e telas; rotas e scripts). Os dois adversariais (backup e SQL) pararam no meio, e as mensagens deles ficaram cifradas no registro. A conversa principal deixou legíveis quatro notas de andamento: a das 09h40 traz o achado 1; a das 09h32 traz os achados 24 e 25 e duas conferências que o Codex anunciou e não chegou a fazer, que eu fiz (27 e 28). O 26 é meu, da mesma classe do 25. O texto literal está no cérebro, em `06-References/central-de-agentes-2026-09-29/devolutiva-codex-1-fatia-2.md`. Todos os achados foram conferidos contra o plano e o código antes de aplicar, e todos procedem.

| # | Achado | Decisão | Onde |
|---|---|---|---|
| 1 | Com a verificação só na rota, um `agency_admin` publicaria pelo próprio JWT, chamando a função direto, o que a tela bloqueia | Aceito. A regra das 12 variáveis vai para dentro de publicar e restaurar, numa função auxiliar travada igual à lista da tela | Tasks 1, 2, 3 e 4 |
| 2 | PATCH da conexão: a gravação não exige que o número continue sem agente | Aceito. Gravação condicionada a `ai_agent_id is null`; sem linha, a releitura decide entre 409 e 404 | Task 10 |
| 3 | `--criar --org` cria agente para todos os grupos prontos do cliente, além do aprovado | Aceito. `--somente <número>`, obrigatório em produção, também no wrapper | Tasks 12 e 15 |
| 4 | `alias_teste.py` sai 0 com erro, e o B5 move o alias antes de provar o deployment | Aceito. Script v2 e a ordem "pronto, login na URL dele, alias, releitura, login no alias" | Task 15 |
| 5 | Contagem da Central de I.A sem paginação | Aceito. Reusa o `lerConexoes` paginado da fatia 1 | Task 9 |
| 6 | `--webhook` sem id cai na prova geral e sai 0 | Aceito. `escolherModo`: um modo por chamada e uuid obrigatório, com teste de comportamento | Task 12 |
| 7 | A vinculação do cliente à agência grava antes do 409 | Aceito. Leitura e recusa antes da vinculação | Task 10 |
| 8 | O wrapper aceita OK vazio, não exige o manifesto commitado e deixa desligar a qualquer hora | Aceito. Campos preenchidos, commit conferido, desligar só no caso incerto ou com OK novo | Task 15 |
| 9 | Sem teste HTTP do 409 ao publicar | Aceito | Task 5 |
| 10 | Os testes do webhook injetam o resultado já interpretado | Aceito. Teste com a resposta crua pelo leitor real, nos dois formatos | Task 12 |
| 11 | A matriz não prova o `revoke`, porque os dois 42501 se confundem | Aceito. Catálogo mais mensagem | Task 2 |
| 12 | Histórico cortado em 200 versões, contra "quaisquer duas" | Aceito. Páginas de 50 com "Carregar versões anteriores" | Tasks 4 a 7 |
| 13 | A cópia de ajustes e modelo não é provada (a v1 tem os valores padrão) | Aceito. Publicada com valores fora do padrão | Task 2 |
| 14 | `replyText` aceita menção solta como instrução | Aceito. Só a linha de campo conta | Task 3 |
| 15 | `[Guia][ref]` vira pendência | Aceito | Task 3 |
| 16 | O 409 ao salvar apaga o texto de quem editava | Aceito. Texto mantido, com "Salvar o meu por cima" ou "Descartar o meu" | Task 8 |
| 17 | Navegação interna perde o texto não salvo | Aceito. Cópia local com aviso de recuperação | Task 8 |
| 18 | A mesma restauração pode ser pedida duas vezes | Aceito. Trava até a resposta | Task 7 |
| 19 | "A próxima resposta real já sai com ela" é absoluto | Aceito. "As respostas que começarem depois" | Tasks 7 e 8 |
| 20 | O editor pode guardar estado do agente anterior ao trocar de rota | Aceito. `key` de cliente e agente na página | Task 8 |
| 21 | Acima de 4 milhões de células a comparação some | Aceito. As duas versões lado a lado | Task 7 |
| 22 | Desvio 2 (Aurora com 20.202 caracteres) | O Codex aceitou | Seção 4 |
| 23 | "A Aurora não dispara nada" depende de número com agenda | Aceito. Critério reescrito | Seção 2 |
| 24 | `sqlprod.py` imprime "HTTP 4xx" e sai 0: a contagem de antes ou de depois vira um texto de erro, e nada para | Aceito. Erro HTTP sai 1, com a mensagem no stderr (o mesmo no `sqlteste.py`, que só difere no banco) | Task 14, Step 5a |
| 25 | O comparador aceita entrada sem contagens | Aceito. Arquivo vazio, linha que não é contagem ou falta das tabelas-sentinela param o comparador | Task 14, Step 7 |
| 26 | (meu, da mesma classe do 25) As contagens da cópia no `restaurar_v2.sh` rodavam sem `ON_ERROR_STOP`: um erro de SQL sai 0 com o arquivo vazio, e "contagens iguais" compararia dois vazios | `ON_ERROR_STOP=1` e as mesmas sentinelas, também no ensaio local | Task 14, Steps 8 e 9 |
| 27 | Conferência anunciada pelo Codex: os comandos da senha usam a pasta do mesmo dia? Não usavam: o B2 chamava `rota_b_senha.ps1 -Modo criar` sem `-Data`, e o script tem `2026-10-07` como padrão | Aceito. `-Data` obrigatório, com o mesmo padrão do dump, passado nos dois comandos | Task 14, Step 5b, e Task 15, B2 |
| 28 | Conferência anunciada pelo Codex: a rotação acontece se uma etapa falha? Não: o plano mandava repetir a troca de senha na mesma pasta, que o próprio script recusa (o dump deixa os arquivos parciais), e não mandava rotacionar antes de parar | Aceito. Falha no passo 4 ou 5 rotaciona primeiro; nova tentativa em pasta nova; a rotação passou para logo depois do dump | Task 15, B2 |

Medido nesta rodada, além do que a seção 5 já trazia:
- a migration, como está no plano, roda num Postgres em memória (PGlite, Postgres 18.3). As quatro funções compilam com a checagem de corpo ligada;
- a função auxiliar devolve nulo só com as 12, aceita espaço, tabulação e quebra de linha dentro das chaves, devolve o primeiro nome desconhecido e devolve texto vazio para `{{}}`;
- a regra nova de `replyText` reconhece a linha de campo na Aurora e na Julia reais. As duas continuam sem pendência falsa, e a Aurora tem 20.202 caracteres;
- no banco de teste, SQL inválido pelo `sqlteste.py` de hoje devolve `HTTP 400` na saída padrão, com saída 0 (achado 24). O `sqlprod.py` só difere dele na docstring e no `REF`;
- o comparador v1, com as duas contagens da produção vazias, dava `falhas: 0` e saída 0 (achado 25); o novo para nos três casos ruins e passa no bom (Task 14, Step 7);
- numa cópia do bloco `param` novo do `rota_b_senha.ps1`, a falta de `-Data` sai 1 e um formato errado também (achado 27);
- o `dump_producao.ps1` v4.2 apaga a senha no `finally`, mas não os arquivos parciais, e recusa pasta com qualquer outro item (linhas 194 a 197 e 261 a 269), o que tornava impossível o "repetir o passo 4" da v1 (achado 28).

**Ainda não chegou:** o resultado dos dois revisores adversariais e o parecer consolidado (go ou no-go). Eles voltam quando o limite do Codex liberar.
