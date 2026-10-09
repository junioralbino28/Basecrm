# Central de Agentes, bloco 2 — criar agentes e modelos da agência: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a agência cria agentes pela tela (de um modelo, do padrão em branco ou copiando outro agente) e mantém uma biblioteca de modelos com lacunas, sem tocar em nenhum agente que já existe.

**Architecture:** uma tabela nova (`ai_agent_templates`, sem organização) e seis funções `security definer` chamadas com o JWT do usuário, no padrão da fatia 2. Para modelo e cópia, o texto do agente é montado **dentro do banco**, na mesma transação que confere a revisão do modelo ou a versão de origem, e a `origin` gravada prova a derivação. As rotas só validam forma e traduzem erros; as telas usam o `Modal` do app.

**Tech Stack:** Next.js (App Router) + React + TypeScript, Supabase (Postgres 17, RLS, `extensions.digest`), zod, Vitest (+ Testing Library), Supabase local (`npx supabase start`) para os `*.local.test.ts`.

**SPEC:** `docs/features/central-de-agentes/SPEC-bloco-2.md` (v2, GO do Codex na rodada 2, com os três pontos que este PLAN resolve). Cópia no cérebro: `06-References/central-de-agentes-2026-09-29/`.

---

## Antes de começar

- Worktree `C:\Users\PC Gamer\WorkSync\projetos\Basecrm-worktrees\central-agentes`, branch `feat/central-agentes`. **Nunca** dar push nesta branch pelo nome; ensaio vai por `git push origin HEAD:feat/aurora-implantacao`, publicação por `git push origin HEAD:main`, cada um com o OK do Junior para aquela entrega.
- `AGENTS.md` do repositório: regra 1 (nada contra o banco de produção, salvo a leitura de prova do rito), regra 3 (push e deploy só com OK), **regra 4 (migration em produção só com o OK do Junior para ESTA migration e pelo rito)**.
- Escrever arquivos com barra invertida dentro de código pelo Write ou por heredoc já estragou escape duas vezes nesta sessão. Por isso o SQL deste plano não usa barra invertida: colchete e chave entram como classe (`[[]`, `[]]`, `[{]`, `[}]`) e a quebra de linha como `chr(10)`. Depois de criar cada arquivo SQL: `grep -c '\\' <arquivo>` tem que dar `0`.
- Rodar a **suíte completa** antes de cada commit de código, e ler o resultado num comando separado do `git commit`. Conferir `git diff --cached --stat` (fim de linha: nenhum arquivo inteiro reescrito).

## Decisões deste plano

| Ponto | Decisão |
|---|---|
| Rodada 2, ponto 1 (link Markdown) | `create_ai_agent_from_template` recusa com `lacuna_ambigua` quando uma lacuna **respondida** aparece também colada a `(` ou `[` no modelo. A tela do modelo lista essas lacunas como ambíguas (detector `lacunasAmbiguas`). Sem troca por posição: a troca continua `replace()` literal, e a ambiguidade nunca chega até ela. |
| Rodada 2, ponto 2 (409 antes de 400) | Ordem fixa, na rota e no banco: (1) modelo existe, (2) não arquivado, (3) revisão = esperada → só então as chaves. A rota lê o modelo pela RLS para dar 400 com mensagem clara, mas confere a revisão **antes** das chaves; o banco repete tudo sob `for share`. |
| Rodada 2, ponto 3 | As validações estão descritas por função na Task 2. |
| Versão da migration | `20261009120000_central_agentes_modelos.sql` (a última da `main` é `20261007120000`). Se a implementação passar de 09/10, manter o número: ele só precisa ser maior que o último aplicado. |
| Detector compartilhado | `verificarPrompt.ts` passa a exportar `ocorrenciasDeLacunas(texto)` (com repetição, na ordem), `lacunasDoTexto(texto)` (distintas, para a tela) e `lacunasAmbiguas(texto)`, usando a `PENDENCIA` que já existe (sem cópia da expressão). A forma SQL (`central_agentes_lacunas`, ocorrências com repetição) é casada com `ocorrenciasDeLacunas` nos mesmos exemplos pelo teste local. |
| "Padrão em branco" | O servidor lê `task_conversations_whatsapp_auto_reply` de `getPromptCatalogMap()` e chama `create_ai_agent_blank`. |
| Erros | Nome estável na mensagem, como na fatia 2; `ERROS_DO_BANCO` de `editorAgentes.ts` ganha os nomes novos. Os 22023 de resposta e lacuna viram 422 com o código; `modelo_mudou`/`versao_publicada_mudou` 409; os `_inexistente` 404. |

## O que este bloco NÃO faz

Ligar número a agente pela tela (bloco 8), assistente (bloco 3), conhecimento (bloco 4), renomear ou apagar agente, versões de modelo, categorias, modelos semeados.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `lib/agents/verificarPrompt.ts` | modificar (Task 1) | Exportar `ocorrenciasDeLacunas`, `lacunasDoTexto` e `lacunasAmbiguas` |
| `lib/agents/verificarPrompt.test.ts` | modificar (Task 1) | Casos das lacunas e da ambiguidade |
| `supabase/migrations/20261009120000_central_agentes_modelos.sql` | criar (Task 2) | Tabela, RLS, grants, 2 auxiliares e 6 funções |
| `docs/features/central-de-agentes/volta-bloco-2.sql` | criar (Task 2) | Volta |
| `test/centralAgentesModelosMigration.test.ts` | criar (Task 2) | Contrato estático da migration e da volta |
| `test/centralAgentesModelos.local.test.ts` | criar (Task 3) | Comportamento com chamada de verdade, matriz de acesso, concorrência, bordas, paridade SQL × TS |
| `lib/agents/modelosAgentes.ts` (+ `.test.ts`) | criar (Task 4) | Camada de servidor: listar, ler, salvar, arquivar modelo; modelo a partir de agente; criar agente nos três começos |
| `lib/agents/editorAgentes.ts` | modificar (Task 4) | Erros novos em `ERROS_DO_BANCO` |
| `lib/agents/tiposDoEditor.ts` | modificar (Task 4) | Tipos `ModeloNaLista`, `ModeloCompleto`, `InicioDoAgente` |
| `lib/agents/rotaDoEditor.ts` | modificar (Task 5) | Schemas `CriarAgenteSchema`, `SalvarModeloSchema`, `CriarModeloSchema`, `ArquivarModeloSchema`; `LIMITE_DO_MODELO_BYTES` |
| `app/api/platform/tenants/[tenantId]/agents/route.ts` | modificar (Task 5) | `POST` cria agente |
| `app/api/platform/agency/agent-templates/route.ts` | criar (Task 5) | `GET` lista, `POST` cria |
| `app/api/platform/agency/agent-templates/[templateId]/route.ts` | criar (Task 5) | `GET` lê, `PUT` salva |
| `app/api/platform/agency/agent-templates/[templateId]/archive/route.ts` | criar (Task 5) | `POST` arquiva ou restaura |
| `lib/agents/rotaDaAgencia.ts` | criar (Task 5) | `abrirRotaDaAgencia(req, {escreve})`: origem HTTP, papel, clientes |
| testes das rotas | criar (Task 5) | Corpo estrito, 403 de origem em cada escrita, ordem 409/400, fonte sem escrita direta |
| `features/agents/agentesApi.ts` | modificar (Task 6) | `criar`, `modelos.*` |
| `features/agents/DialogoNovoAgente.tsx` (+ teste) | criar (Task 6) | O diálogo dos três começos e das lacunas |
| `features/agents/TenantAgentsPage.tsx` (+ teste) | modificar (Task 6) | Botão "Novo agente" e estado vazio novo |
| `features/agents/ModelosPage.tsx`, `EditorDoModelo.tsx` (+ testes) | criar (Task 6) | Biblioteca e editor do modelo |
| `app/(protected)/platform/agent-templates/page.tsx`, `[templateId]/page.tsx` | criar (Task 6) | Rotas de tela |
| `features/agents/AgentEditorPage.tsx` (+ teste) | modificar (Task 6) | "Salvar como modelo" |
| `components/Layout.tsx`, `components/navigation/navConfig.ts` (+ testes) | modificar (Task 6) | Item "Modelos de agente" no menu da agência |

## Tasks

### Task 0: Linha de base

- [ ] **Step 1:** `git status --short` vazio; `git log --oneline -1` = commit do PLAN.
- [ ] **Step 2:** `npx supabase status` no ar; `docker exec -i supabase_db_crmia psql -U postgres -d postgres -tAc "select max(version) from supabase_migrations.schema_migrations"` → `20261007120000` (se menor, `npx supabase db reset`, que só apaga o banco local).
- [ ] **Step 3:** suíte completa verde antes de mudar qualquer coisa: `npx vitest run` → registrar arquivos, testes e 0 falhas; `npm run lint`, `npx tsc --noEmit`.

### Task 1: Detector de lacunas exportado

**Files:** Modify `lib/agents/verificarPrompt.ts`, `lib/agents/verificarPrompt.test.ts`

- [ ] **Step 1: Teste que falha** (acrescentar a `verificarPrompt.test.ts`):

```ts
import { lacunasAmbiguas, lacunasDoTexto, ocorrenciasDeLacunas } from './verificarPrompt';

describe('lacunas do modelo (bloco 2): a mesma PENDENCIA da verificação', () => {
  it('acha as lacunas na ordem da primeira aparição, sem repetir; as ocorrências mantêm a repetição', () => {
    const texto = 'Oi, [Nome da empresa]. Atendemos [Horário] e [Nome da empresa].';
    expect(lacunasDoTexto(texto)).toEqual(['[Nome da empresa]', '[Horário]']);
    expect(ocorrenciasDeLacunas(texto)).toEqual(['[Nome da empresa]', '[Horário]', '[Nome da empresa]']);
  });
  it('não conta link de markdown, minúscula nem colchete vazio', () => {
    expect(lacunasDoTexto('[Guia](https://x) [Guia][ref] [minuscula] [] [X]')).toEqual([]);
  });
  it('caso positivo do detector: o mesmo texto que a verificação marca como pendência', () => {
    const texto = 'Ligue para [Telefone] e fale com [Ana].';
    expect(lacunasDoTexto(texto)).toEqual(['[Telefone]', '[Ana]']);
    expect(verificarPrompt({ rascunho: texto, publicada: null, numerosComAgenda: 0 }).avisos.map((a) => a.codigo)).toContain('pendencia');
  });
  it('lacuna ambígua: o mesmo texto também aparece como rótulo de link', () => {
    expect(lacunasAmbiguas('[Nome] e o link [Nome](https://x)')).toEqual(['[Nome]']);
    expect(lacunasAmbiguas('[Nome] e o link [Guia](https://x)')).toEqual([]);
  });
});
```

(Conferir a assinatura real de `verificarPrompt` no arquivo e ajustar só a chamada do caso positivo.)

- [ ] **Step 2:** `npx vitest run lib/agents/verificarPrompt.test.ts` → FAIL (`lacunasDoTexto` não existe).
- [ ] **Step 3: Implementação** (em `verificarPrompt.ts`, logo depois de `PENDENCIA`):

```ts
/** Bloco 2: cada ocorrência de lacuna, COM repetição, na ordem do texto (a mesma lista que o banco confere). */
export function ocorrenciasDeLacunas(texto: string): string[] {
  return [...texto.matchAll(PENDENCIA)].map((m) => m[0]);
}

/** As lacunas de um modelo para a tela: as ocorrências sem repetir, na ordem da primeira aparição. */
export function lacunasDoTexto(texto: string): string[] {
  return [...new Set(ocorrenciasDeLacunas(texto))];
}

/**
 * Lacuna que também aparece colada a "(" ou "[" (rótulo de link): trocar o texto mexeria no link. A criação do
 * agente recusa (lacuna_ambigua) e a tela do modelo avisa (rodada 2 do Codex, ponto 1).
 */
export function lacunasAmbiguas(texto: string): string[] {
  return lacunasDoTexto(texto).filter((l) => texto.includes(`${l}(`) || texto.includes(`${l}[`));
}
```

A verificação passa a usar `lacunasDoTexto(rascunho)` no lugar da linha `const pendencias = [...new Set(...)]` (mesmo resultado; uma expressão só).

- [ ] **Step 4:** o arquivo de teste inteiro passa; `npx vitest run lib/agents` verde.
- [ ] **Step 5: Commit** `feat(central-agentes): detector de lacunas exportado (bloco 2)`.

### Task 2: Migration, volta e contrato estático

**Files:** Create `supabase/migrations/20261009120000_central_agentes_modelos.sql`, `docs/features/central-de-agentes/volta-bloco-2.sql`, `test/centralAgentesModelosMigration.test.ts`

Validações por função (rodada 2, ponto 3). Todas: gate `is_agency_admin_role()` antes de qualquer leitura (42501 `sem_permissao`), autor de `auth.uid()`, nenhum parâmetro de autor ou de origem.

| Função | Confere, nesta ordem |
|---|---|
| `create_ai_agent_blank(p_organization_id, p_name, p_prompt)` | nome 1–80 (aparado) · texto 1–50.000 · cliente existe e `deleted_at is null`, **travado `for share`** · variável desconhecida |
| `create_ai_agent_from_template(p_organization_id, p_name, p_template_id, p_expected_template_revision, p_answers)` | nome · cliente (`for share`) · modelo existe (`for share`) · não arquivado · **revisão** · respostas: objeto, até 50 chaves · cada chave é lacuna do modelo · cada valor é string, aparado, vazio = pula, até 500, sem `{ } [ ]` · lacuna respondida não ambígua · troca · resultado: mesmos `{{...}}` na ordem · **ocorrências** de lacuna = as do modelo menos todas as ocorrências das respondidas, com repetição e na ordem · texto até 50.000 · variável desconhecida |
| `create_ai_agent_from_copy(p_organization_id, p_name, p_source_organization_id, p_source_agent_id, p_expected_source_version)` | nome · cliente de destino (`for share`) · agente de origem pela organização E pelo id (`for share`) · tem versão publicada · versão = esperada · **variável desconhecida no texto copiado** |
| `save_ai_agent_template(p_template_id, p_expected_revision, p_name, p_description, p_prompt)` | nome · descrição até 280 (aparada; vazia = nula) · texto · variável desconhecida · id nulo = cria (revisão 1, `origin = {"kind":"blank"}`); senão existe (`for update`) · não arquivado · revisão = esperada · sobe a revisão |
| `create_ai_agent_template_from_agent(p_organization_id, p_agent_id, p_expected_version, p_name, p_description)` | nome · descrição · agente pela organização e pelo id (`for share`) · tem versão publicada · versão = esperada · **variável desconhecida no texto copiado** |
| `set_ai_agent_template_archived(p_template_id, p_archived, p_expected_revision)` | `p_archived` não nulo · existe (`for update`) · revisão = esperada · muda alguma coisa (senão `sem_mudancas`) · sobe a revisão |

- [ ] **Step 1: Teste que falha** — `test/centralAgentesModelosMigration.test.ts`, no molde de `test/centralAgentesEditorMigration.test.ts` (cabeçalho e corpo `$$...$$` por função):

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20261009120000_central_agentes_modelos.sql');
const VOLTA = resolve(process.cwd(), 'docs/features/central-de-agentes/volta-bloco-2.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

const FUNCOES = {
  create_ai_agent_blank: '(uuid, text, text)',
  create_ai_agent_from_template: '(uuid, text, uuid, integer, jsonb)',
  create_ai_agent_from_copy: '(uuid, text, uuid, uuid, integer)',
  save_ai_agent_template: '(uuid, integer, text, text, text)',
  create_ai_agent_template_from_agent: '(uuid, uuid, integer, text, text)',
  set_ai_agent_template_archived: '(uuid, boolean, integer)',
} as const;
const AUXILIARES = { central_agentes_lacunas: '(text)', central_agentes_marcadores: '(text)' } as const;
type Nome = keyof typeof FUNCOES | keyof typeof AUXILIARES;
const NOMES = Object.keys(FUNCOES) as (keyof typeof FUNCOES)[];

const cabecalho = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\(([\\s\\S]*?)as \\$\\$`))?.[1] ?? '';
const corpo = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1] ?? '';

describe('migration dos modelos da Central de Agentes (bloco 2)', () => {
  it('existe, e a volta também; sem barra invertida (o escape não sobreviveria à escrita)', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(existsSync(VOLTA)).toBe(true);
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
  it('o detector acha as oito funções (caso positivo)', () => {
    for (const n of [...NOMES, ...(Object.keys(AUXILIARES) as Nome[])]) expect(corpo(n).length, n).toBeGreaterThan(40);
  });
  it('cabeçalho: security definer e search_path vazio nas seis; as auxiliares são invoker', () => {
    for (const n of NOMES) {
      expect(cabecalho(n), n).toMatch(/security definer/);
      expect(cabecalho(n), n).toMatch(/set search_path = ''/);
    }
    for (const n of Object.keys(AUXILIARES) as Nome[]) expect(cabecalho(n), n).toMatch(/security invoker/);
  });
  it('papel conferido antes de qualquer tabela; autor de auth.uid(); nenhum parâmetro de autor nem de origem', () => {
    for (const n of NOMES) {
      const b = corpo(n);
      const papel = b.indexOf('if not public.is_agency_admin_role() then');
      const tabela = b.search(/public\.(ai_agent|organizations)/);
      expect(papel, n).toBeGreaterThan(-1);
      expect(tabela, n).toBeGreaterThan(papel);
      expect(b, n).toMatch(/auth\.uid\(\)/);
      expect(cabecalho(n), n).not.toMatch(/p_(published_by|author|autor|user|usuario|origin|origem)\b/);
    }
  });
  it('modelo e cópia não recebem texto: o banco monta (achado 1 da rodada 1)', () => {
    expect(cabecalho('create_ai_agent_from_template')).not.toMatch(/p_prompt/);
    expect(cabecalho('create_ai_agent_from_copy')).not.toMatch(/p_prompt/);
  });
  it('ordem do modelo: revisão conferida antes das chaves (rodada 2, ponto 2)', () => {
    const b = corpo('create_ai_agent_from_template');
    expect(b.indexOf("'modelo_mudou'")).toBeGreaterThan(-1);
    expect(b.indexOf("'modelo_mudou'")).toBeLessThan(b.indexOf("'lacuna_inexistente'"));
    expect(b.indexOf("'lacuna_ambigua'")).toBeLessThan(b.indexOf('replace(v_texto'));
    expect(b).toMatch(/for share/);
  });
  it('os três começos travam o cliente de destino; as duas cópias revalidam as variáveis (rodada 1 do PLAN)', () => {
    for (const n of ['create_ai_agent_blank', 'create_ai_agent_from_template', 'create_ai_agent_from_copy'] as const) {
      expect(corpo(n), n).toMatch(/from public\.organizations o where o\.id = p_organization_id and o\.deleted_at is null for share;/);
    }
    for (const n of ['create_ai_agent_from_copy', 'create_ai_agent_template_from_agent'] as const) {
      expect(corpo(n), n).toContain('public.central_agentes_variavel_desconhecida(v_prompt)');
    }
  });
  it('as lacunas do banco são ocorrências com repetição: nada de distinct nem group by', () => {
    expect(corpo('central_agentes_lacunas')).not.toMatch(/group by|distinct/i);
  });
  it('grants: as seis só para authenticated; as auxiliares sem execute', () => {
    for (const [n, assinatura] of Object.entries(FUNCOES)) {
      expect(sql, n).toContain(`revoke all on function public.${n}${assinatura} from public, anon, authenticated, service_role;`);
      expect(sql, n).toContain(`grant execute on function public.${n}${assinatura} to authenticated;`);
    }
    for (const [n, assinatura] of Object.entries(AUXILIARES)) {
      expect(sql, n).toContain(`revoke all on function public.${n}${assinatura} from public, anon, authenticated, service_role;`);
      expect(sql, n).not.toContain(`grant execute on function public.${n}`);
    }
  });
  it('tabela: RLS, policy só de leitura da agência, grants explícitos', () => {
    expect(sql).toContain('alter table public.ai_agent_templates enable row level security;');
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql).toMatch(/for select\s+to authenticated\s+using \(public\.is_agency_admin_role\(\)\)/);
    expect(sql).toContain('revoke all on table public.ai_agent_templates from anon, authenticated;');
    expect(sql).toContain('grant select on table public.ai_agent_templates to authenticated;');
    expect(sql).toContain('grant all on table public.ai_agent_templates to service_role;');
    expect(sql).toMatch(/origin jsonb not null,/);
  });
  it('não destrutiva: nada de drop, delete, truncate, update ou alter em tabela que já existe', () => {
    expect(semComentarios).not.toMatch(/\bdrop\b|\btruncate\b|delete from/i);
    const alteracoes = semComentarios.match(/alter table [a-z_.]+/gi) ?? [];
    expect(alteracoes).toEqual(['alter table public.ai_agent_templates']);
    const updates = semComentarios.match(/update public\.[a-z_]+/gi) ?? [];
    expect(new Set(updates)).toEqual(new Set(['update public.ai_agent_templates']));
  });
  it('a volta: begin, drop das oito funções e da tabela, delete do histórico, commit', () => {
    const v = readFileSync(VOLTA, 'utf8').replace(/--.*$/gm, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(v[0]).toBe('begin;');
    expect(v.at(-1)).toBe('commit;');
    expect(v.filter((l) => l.startsWith('drop function if exists public.'))).toHaveLength(8);
    expect(v).toContain('drop table if exists public.ai_agent_templates;');
    expect(v).toContain("delete from supabase_migrations.schema_migrations where version = '20261009120000';");
    expect(v).toHaveLength(12);
  });
});
```

- [ ] **Step 2:** `npx vitest run test/centralAgentesModelosMigration.test.ts` → FAIL (arquivo não existe).

- [ ] **Step 3: A migration.** Criar `supabase/migrations/20261009120000_central_agentes_modelos.sql`:

```sql
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
```

- [ ] **Step 4: A volta.** Criar `docs/features/central-de-agentes/volta-bloco-2.sql`:

```sql
-- VOLTA do bloco 2 da Central de Agentes (supabase/migrations/20261009120000_central_agentes_modelos.sql).
-- ORDEM: primeiro tirar do ar o código das telas e rotas do bloco 2; só depois rodar isto. Nunca em produção sem o
-- OK do Junior. APAGA A BIBLIOTECA DE MODELOS: antes, exportar os modelos (select para arquivo) se houver algum.
-- Os agentes criados pela tela continuam (são linhas comuns de ai_agents); a origin deles fica apontando para um
-- modelo que deixa de existir.
begin;
drop function if exists public.set_ai_agent_template_archived(uuid, boolean, integer);
drop function if exists public.create_ai_agent_template_from_agent(uuid, uuid, integer, text, text);
drop function if exists public.save_ai_agent_template(uuid, integer, text, text, text);
drop function if exists public.create_ai_agent_from_copy(uuid, text, uuid, uuid, integer);
drop function if exists public.create_ai_agent_from_template(uuid, text, uuid, integer, jsonb);
drop function if exists public.create_ai_agent_blank(uuid, text, text);
drop function if exists public.central_agentes_marcadores(text);
drop function if exists public.central_agentes_lacunas(text);
drop table if exists public.ai_agent_templates;
delete from supabase_migrations.schema_migrations where version = '20261009120000';
commit;
```

- [ ] **Step 5:** `grep -c '\\' supabase/migrations/20261009120000_central_agentes_modelos.sql docs/features/central-de-agentes/volta-bloco-2.sql` → `0` nos dois; `npx vitest run test/centralAgentesModelosMigration.test.ts` → PASS.
- [ ] **Step 6: Aplicar no banco local** (mesma transação do registro, como na fatia 2):

```bash
docker exec -i supabase_db_crmia psql --single-transaction -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -f - -c "insert into supabase_migrations.schema_migrations (version, name) values ('20261009120000', 'central_agentes_modelos') on conflict do nothing" \
  < supabase/migrations/20261009120000_central_agentes_modelos.sql \
  && docker exec -i supabase_db_crmia psql -U postgres -d postgres -c "notify pgrst, 'reload schema'"
```
Expected: `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`, oito `CREATE FUNCTION`, `INSERT 0 1`, sem erro.

- [ ] **Step 7: Commit** (os três arquivos; `git diff --cached --stat` só com eles) `feat(central-agentes): migration dos modelos e da criacao de agentes (bloco 2)`.

### Task 3: Teste local de verdade

**Files:** Create `test/centralAgentesModelos.local.test.ts` (molde: `test/centralAgentesEditor.local.test.ts` — `describeLocal`, `criarUsuario`, `entrar`, `exigirPostgresLocal`, limpeza em `afterAll`).

Casos, cada um com o que prova:

1. **Matriz de acesso** (`clinic_admin`, `agency_staff`, anônimo e chave de serviço) → as seis funções recusam: os três primeiros com `sem_permissao`/42501 ou "permission denied", a chave de serviço com "permission denied" (sem `execute`). Prova o gate e os grants juntos; se a chave de serviço receber `sem_permissao`, ela herdou `execute` e o `revoke` falhou: parar.
2. **Branco:** cria; `draft.prompt` = texto enviado; `draft_revision` 1; `published_version_id` nulo; `origin` = `{"kind":"blank","promptSha256": sha256(texto)}`; `created_by` = o usuário. Cliente apagado (`deleted_at` preenchido no fixture) → `cliente_inexistente`. `{{desconhecida}}` → `variavel_desconhecida`.
   - **Exclusão concorrente** (rodada 1 do PLAN, achado 2): numa conexão `pg`, `begin; update organizations set deleted_at = now() where id = <cliente>` sem commit; disparar a criação pelo JWT da agência (ela fica esperando a trava); dar `commit` na primeira; a criação termina com `cliente_inexistente` e nenhum agente novo existe. Repetir nos três começos.
3. **Modelo, caminho feliz:** modelo `"Oi [Nome da empresa], abrimos [Horário]. Fale com [Nome da empresa]. {{contactName}}"`; respostas `{"[Nome da empresa]": "Loja Sol", "[Horário]": ""}` → texto `"Oi Loja Sol, abrimos [Horário]. Fale com Loja Sol. {{contactName}}"`; `origin.answered` = `["[Nome da empresa]"]`; `origin.promptSha256` = sha do `draft.prompt`; `origin.templateSha256` = sha do texto do modelo. Prova a derivação e a troca de todas as ocorrências.
4. **Chamada direta** (achado 1): o cabeçalho não tem texto (contrato estático); aqui, a mesma chamada com respostas diferentes dá textos diferentes, e o sha gravado bate sempre com o texto gravado.
5. **Concorrência** (achados 1 e 3): ler a revisão; salvar o modelo por outra sessão; criar com a revisão velha → `modelo_mudou`. Duas `save_ai_agent_template` com a mesma revisão em duas conexões `pg` abertas (a segunda espera o `for update` da primeira) → uma passa, a outra `modelo_mudou`. Arquivar com revisão velha → `modelo_mudou`; arquivar duas vezes → `sem_mudancas`; restaurar sobe a revisão.
6. **Ordem 409 antes de 400** (rodada 2, ponto 2): renomear a lacuna no modelo (revisão sobe) e criar com a revisão velha e a chave antiga → `modelo_mudou`, não `lacuna_inexistente`.
7. **Bordas** (achado 4): modelo `"{[Campo]contactName}}"` com resposta `"{"` → `respostas_invalidas` (o valor já cai na regra); para provar a conferência do RESULTADO, um modelo `"[[Nome]] e [Cliente]"` com resposta `{"[Nome]": "Cliente"}` → `lacuna_invalida` (o texto viraria `"[Cliente] e [Cliente]"`: duas ocorrências onde o esperado é uma; com lista distinta as duas dariam `["[Cliente]"]` e o caso passaria, rodada 1 do PLAN, achado 1); valor `"$&"` gravado literalmente; lacuna repetida trocada nas duas posições.
8. **Ambiguidade** (rodada 2, ponto 1): modelo `"[Nome] e o link [Nome](https://x)"`, respondendo `[Nome]` → `lacuna_ambigua`; sem responder `[Nome]` → cria, com o link intacto; modelo `"[Nome] e [Nome][ref]"` respondendo `[Nome]` → `lacuna_ambigua` (a recusa também vale para o colchete; rodada 2 do PLAN, item 6).
9. **Cópia:** de outro cliente → texto igual ao da versão publicada de origem, `origin.kind = 'copy'` com organização, agente, versão e sha; organização e agente que não combinam → `agente_inexistente`; agente sem versão publicada → `sem_versao_publicada`; versão esperada velha → `versao_publicada_mudou`; **versão publicada com variável que não é mais aceita** → `variavel_desconhecida` (rodada 1 do PLAN, achado 3; o fixture cria essa versão por `create_ai_agent_from_legacy_prompt` com a chave de serviço, que não confere variável, com `{{variavelAntiga}}` no texto).
10. **Modelo a partir de agente:** texto = versão publicada; `origin.kind = 'agent'`; mesmas recusas da cópia, inclusive a variável não aceita.
11. **Paridade SQL × TypeScript:** para uma lista de exemplos (os da Task 1, um texto com a mesma lacuna três vezes, `"[Á vista]"`, um `"[Nome"` seguido de quebra de linha e `"]"`, `"[Nome][x]"`, `"[A]"`, uma lacuna de 81 caracteres e uma de 82), `select public.central_agentes_lacunas($1)` pela conexão `pg` de superusuário é igual a `ocorrenciasDeLacunas(texto)`, **com repetição e ordem**. Caso positivo: pelo menos três exemplos com lacuna e um com repetição, para a paridade não passar com as duas listas vazias.
12. **Nenhuma escrita fora do esperado:** contagem de `ai_agents`, `ai_agent_versions` e `ai_agent_templates` antes e depois de cada recusa: igual.

- [ ] **Step 1:** escrever os 12 casos. **Step 2:** `npm run test:local -- test/centralAgentesModelos.local.test.ts` → PASS (se `skipped`, o Supabase local não está no ar). **Step 3:** provar a volta no local: aplicar a volta, conferir que as oito funções e a tabela sumiram e que a versão saiu do histórico, reaplicar a migration (Task 2, Step 6) e rodar o teste de novo. **Step 4: Commit** `test(central-agentes): modelos e criacao de agentes no banco local (bloco 2)`.

### Task 4: Camada de servidor

**Files:** Create `lib/agents/modelosAgentes.ts`, `lib/agents/modelosAgentes.test.ts`; Modify `lib/agents/editorAgentes.ts` (`ERROS_DO_BANCO`), `lib/agents/tiposDoEditor.ts`

- [ ] **Step 1: Erros novos** em `ERROS_DO_BANCO` (mensagens para o leitor da tela):

```ts
  cliente_inexistente: { status: 404, codigo: 'CLIENTE_INEXISTENTE', erro: 'Cliente não encontrado.' },
  modelo_inexistente: { status: 404, codigo: 'MODELO_INEXISTENTE', erro: 'Modelo não encontrado.' },
  modelo_mudou: { status: 409, codigo: 'MODELO_MUDOU', erro: 'O modelo foi alterado por outra pessoa enquanto você trabalhava. A tela foi atualizada.' },
  modelo_arquivado: { status: 409, codigo: 'MODELO_ARQUIVADO', erro: 'Este modelo está arquivado. Restaure antes de usar ou editar.' },
  sem_versao_publicada: { status: 422, codigo: 'SEM_VERSAO_PUBLICADA', erro: 'Este agente ainda não tem versão publicada para copiar.' },
  nome_invalido: { status: 400, codigo: 'NOME_INVALIDO', erro: 'O nome precisa ter de 1 a 80 caracteres.' },
  descricao_invalida: { status: 400, codigo: 'DESCRICAO_INVALIDA', erro: 'A descrição pode ter no máximo 280 caracteres.' },
  pedido_invalido: { status: 400, codigo: 'PEDIDO_INVALIDO', erro: 'Pedido inválido.' },
  respostas_invalidas: { status: 422, codigo: 'RESPOSTAS_INVALIDAS', erro: 'Cada resposta pode ter até 500 caracteres, sem chaves nem colchetes.' },
  lacuna_inexistente: { status: 422, codigo: 'LACUNA_INEXISTENTE', erro: 'Uma das respostas é para uma lacuna que não existe no modelo.' },
  lacuna_ambigua: { status: 422, codigo: 'LACUNA_AMBIGUA', erro: 'Essa lacuna também aparece como texto de um link no modelo. Ajuste o modelo antes de responder a ela.' },
  lacuna_invalida: { status: 422, codigo: 'LACUNA_INVALIDA', erro: 'Uma resposta formaria uma lacuna ou variável nova junto do texto do modelo. Ajuste a resposta.' },
```

- [ ] **Step 2: Tipos** (`tiposDoEditor.ts`):

```ts
export type ModeloNaLista = {
  id: string; nome: string; descricao: string | null; revisao: number; lacunas: string[]; ambiguas: string[];
  arquivado: boolean; atualizadoEm: string; atualizadoPor: string | null; agentesCriados: number;
};
export type ModeloCompleto = ModeloNaLista & { prompt: string };
export type InicioDoAgente =
  | { tipo: 'branco' }
  | { tipo: 'modelo'; modeloId: string; revisaoDoModelo: number; respostas: Record<string, string> }
  | { tipo: 'copia'; clienteDeOrigemId: string; agenteId: string; versaoEsperada: number };
```

- [ ] **Step 3: `modelosAgentes.ts`**, com o mesmo `Clientes`/`Resultado`/`traduzirErroDoBanco` de `editorAgentes.ts`. Funções: `listarModelos(c, {arquivados})`, `lerModelo(c, id)`, `salvarModelo(c, {id|null, revisaoEsperada, nome, descricao, prompt})`, `criarModeloDeAgente(c, {tenantId, agenteId, versaoEsperada, nome, descricao})`, `arquivarModelo(c, {id, arquivar, revisaoEsperada})`, `criarAgente(c, {tenantId, nome, inicio})`. Leituras de `ai_agent_templates` pelo `c.usuario` (RLS); escritas só por `c.usuario.rpc(...)`. `agentesCriados` conta `ai_agents` com `origin->>templateId` igual (leitura pelo `c.usuario`, a policy da agência vê todos os clientes). A parte delicada é a ordem do `criarAgente` com modelo:

```ts
export async function criarAgente(c: Clientes, p: { tenantId: string; nome: string; inicio: InicioDoAgente }): Promise<Resultado<{ agenteId: string }>> {
  if (p.inicio.tipo === 'branco') {
    const texto = getPromptCatalogMap()[CHAVE_DO_PADRAO_EM_BRANCO]?.defaultTemplate;
    if (!texto) return falha(500, 'ERRO_INTERNO', MENSAGEM_ERRO_INTERNO);
    const r = await c.usuario.rpc('create_ai_agent_blank', { p_organization_id: p.tenantId, p_name: p.nome, p_prompt: texto });
    return r.error ? traduzirErroDoBanco(r.error, 'criar agente em branco') : comoId(r.data);
  }
  if (p.inicio.tipo === 'modelo') {
    // Rodada 2, ponto 2: 409 (modelo mudou) antes de 400 (chave que não é lacuna). O banco repete sob trava.
    const lido = await c.usuario.from('ai_agent_templates').select('prompt, revision, archived_at').eq('id', p.inicio.modeloId).maybeSingle();
    if (lido.error) return traduzirErroDoBanco(lido.error, 'ler modelo');
    if (!lido.data) return traduzirErroDoBanco({ message: 'modelo_inexistente' }, 'ler modelo');
    if (lido.data.archived_at) return traduzirErroDoBanco({ message: 'modelo_arquivado' }, 'ler modelo');
    if (lido.data.revision !== p.inicio.revisaoDoModelo) return traduzirErroDoBanco({ message: 'modelo_mudou' }, 'ler modelo');
    const lacunas = new Set(lacunasDoTexto(lido.data.prompt));
    const sobra = Object.keys(p.inicio.respostas).find((k) => !lacunas.has(k));
    if (sobra) return falha(400, 'LACUNA_INEXISTENTE', ERROS_DO_BANCO.lacuna_inexistente.erro);
    const r = await c.usuario.rpc('create_ai_agent_from_template', {
      p_organization_id: p.tenantId, p_name: p.nome, p_template_id: p.inicio.modeloId,
      p_expected_template_revision: p.inicio.revisaoDoModelo, p_answers: p.inicio.respostas,
    });
    return r.error ? traduzirErroDoBanco(r.error, 'criar agente de modelo') : comoId(r.data);
  }
  const r = await c.usuario.rpc('create_ai_agent_from_copy', {
    p_organization_id: p.tenantId, p_name: p.nome, p_source_organization_id: p.inicio.clienteDeOrigemId,
    p_source_agent_id: p.inicio.agenteId, p_expected_source_version: p.inicio.versaoEsperada,
  });
  return r.error ? traduzirErroDoBanco(r.error, 'copiar agente') : comoId(r.data);
}
```

(`CHAVE_DO_PADRAO_EM_BRANCO = 'task_conversations_whatsapp_auto_reply'`; conferir no `catalog.ts` o nome do campo do texto padrão e usar o real.) `traduzirErroDoBanco` e `ERROS_DO_BANCO` passam a ser exportados de `editorAgentes.ts`, se ainda não forem.

- [ ] **Step 4: Testes** (`modelosAgentes.test.ts`, com `c.usuario` falso): ordem do criar com modelo (revisão velha → 409 sem chamar a RPC; chave sobrando → 400 sem chamar a RPC; tudo certo → a RPC recebe exatamente os cinco parâmetros, sem texto); branco manda o texto do catálogo; cópia manda organização e agente de origem; tradução de cada erro novo.
  - **Prova de que toda escrita usa o JWT do usuário** (rodada 1 do PLAN, achado 4): em `criarAgente` (os três começos), `salvarModelo`, `criarModeloDeAgente` e `arquivarModelo`, o `c.admin` do teste é um `Proxy` que lança erro em qualquer acesso, e o teste exige a RPC certa (nome e parâmetros) no `c.usuario`. Prova contrária: um caso do próprio teste chama `c.admin.rpc` de propósito e espera o erro do `Proxy`.
  - Teste de fonte, como defesa a mais: `modelosAgentes.ts` não contém `.insert(`, `.update(`, `.upsert(`, `.delete(` nem `admin.rpc(` (caso positivo: o mesmo detector acha `usuario.rpc(` no arquivo).
- [ ] **Step 5:** casos de servidor acrescentados ao teste local (Task 3) chamando `criarAgente` com o cliente do usuário de verdade: os três começos e a ordem 409/400. **Step 6:** suíte completa; **Commit** `feat(central-agentes): camada de servidor dos modelos e da criacao (bloco 2)`.

### Task 5: Rotas

**Files:** Create `lib/agents/rotaDaAgencia.ts`, as três rotas da agência e o teste delas; Modify `lib/agents/rotaDoEditor.ts` (schemas), `app/api/platform/tenants/[tenantId]/agents/route.ts` (+ `route.test.ts`)

- [ ] **Step 1: Schemas** (`rotaDoEditor.ts`):

```ts
export const LIMITE_DO_MODELO_BYTES = 256 * 1024;
const NomeCurto = z.string().trim().min(1).max(80);
const Descricao = z.string().trim().max(280).optional();
const Lacuna = z.string().regex(/^[[][A-ZÀ-Ý][^[\]\n]{1,80}[\]]$/);
const Resposta = z.string().max(500).refine((v) => !/[{}[\]]/.test(v), 'Sem chaves nem colchetes.');
export const CriarAgenteSchema = z.object({
  nome: NomeCurto,
  inicio: z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('branco') }).strict(),
    z.object({ tipo: z.literal('modelo'), modeloId: z.string().uuid(), revisaoDoModelo: z.number().int().min(1),
      respostas: z.record(Lacuna, Resposta).refine((r) => Object.keys(r).length <= 50) }).strict(),
    z.object({ tipo: z.literal('copia'), clienteDeOrigemId: z.string().uuid(), agenteId: z.string().uuid(),
      versaoEsperada: z.number().int().min(1) }).strict(),
  ]),
}).strict();
export const SalvarModeloSchema = z.object({ nome: NomeCurto, descricao: Descricao, prompt: z.string().min(1).max(50_000),
  revisaoEsperada: z.number().int().min(1) }).strict();
export const CriarModeloSchema = z.union([
  z.object({ nome: NomeCurto, descricao: Descricao, prompt: z.string().min(1).max(50_000) }).strict(),
  z.object({ nome: NomeCurto, descricao: Descricao, deAgente: z.object({ tenantId: z.string().uuid(),
    agenteId: z.string().uuid(), versaoEsperada: z.number().int().min(1) }).strict() }).strict(),
]);
export const ArquivarModeloSchema = z.object({ arquivar: z.boolean(), revisaoEsperada: z.number().int().min(1) }).strict();
```

(As duas expressões com barra invertida acima são TypeScript: depois de escrever o arquivo, conferir por `cat -A` que `[^[\]\n]` e `/[{}[\]]/` ficaram com a barra, e o teste do schema prova com uma lacuna que contenha `]`.)

- [ ] **Step 2: `abrirRotaDaAgencia`** — o padrão de `requireAgencyAdminProfile` (`app/api/platform/agency/evolution/route.ts:63`) num arquivo só, com `isAllowedOrigin` primeiro quando `escreve` (achado 2):

```ts
export async function abrirRotaDaAgencia(req: Request, opcoes: { escreve: boolean }) {
  if (opcoes.escreve && !isAllowedOrigin(req)) return { ok: false as const, resposta: json({ error: 'Forbidden' }, 403) };
  const usuario = await createClient();
  const { data: { user } } = await usuario.auth.getUser();
  if (!user) return { ok: false as const, resposta: json({ error: 'Unauthorized' }, 401) };
  const { data: perfil } = await usuario.from('profiles').select('id, role').eq('id', user.id).maybeSingle();
  if (!perfil || !isAgencyAdminRole(normalizeAppUserRole(perfil.role))) return { ok: false as const, resposta: json({ error: 'Forbidden' }, 403) };
  return { ok: true as const, clientes: { usuario, admin: createStaticAdminClient() } };
}
```

- [ ] **Step 3: Rotas.** `POST /api/platform/tenants/[tenantId]/agents` (`abrirRotaDoCliente(escreve: true)` → `lerCorpoLimitado(req, CriarAgenteSchema, LIMITE_DO_MODELO_BYTES)` → `criarAgente` → 201 `{agenteId}`); `GET/POST /api/platform/agency/agent-templates`; `GET/PUT .../[templateId]`; `POST .../[templateId]/archive`. Toda rota que escreve: `abrirRotaDaAgencia(req, { escreve: true })` (ou `abrirRotaDoCliente(escreve: true)`) como primeira linha.
- [ ] **Step 4: Testes das rotas:** origem recusada → 403 **em cada rota que escreve** (quatro escritas da agência + o POST do cliente) sem chamar a camada; `clinic_admin` → 403; corpo com campo a mais → 400; resposta com `{` → 400; lacuna fora da forma → 400; ordem 409/400 vinda da camada repassada como está; 413 acima de 256 KB; 201 no caminho feliz. **Teste de fonte** de todas as rotas novas: nenhuma contém `.from('ai_agent_templates').insert|update|delete`, nem `.from('ai_agents')` com escrita, nem a palavra `origin` (a origem nunca sai da rota).
- [ ] **Step 5:** suíte completa; **Commit** `feat(central-agentes): rotas de criar agente e dos modelos da agencia (bloco 2)`.

### Task 6: Telas

**Files:** ver o mapa. Componentes no padrão do `DialogoPublicar` (`Modal` de `components/ui/Modal.tsx`).

- [ ] **Step 1: `agentesApi`:** `criar(tenantId, corpo)`, `modelos.listar({arquivados})`, `modelos.ler(id)`, `modelos.criar(corpo)`, `modelos.salvar(id, corpo)`, `modelos.arquivar(id, corpo)`. Para "Copiar de outro agente": `listarClientes()` reaproveita a lista de clientes que a tela de clientes da agência já usa (conferir o endpoint em `app/(protected)/platform/tenants/page.tsx` e usar o mesmo) e `agentesApi.listar(clienteId)` para os agentes com versão publicada.
- [ ] **Step 2: `DialogoNovoAgente`**: campo "Nome do agente"; rádio "Começar de" (Modelo da agência / Padrão em branco / Copiar de outro agente); com modelo, a lista (nome e descrição; opção desabilitada com "Nenhum modelo ainda. Crie em Modelos de agente." quando vazia), um campo por lacuna rotulado com o próprio texto, a nota "O que ficar em branco continua entre colchetes e a verificação do Publicar avisa." e, se houver, o aviso das lacunas ambíguas; com cópia, cliente e agente e a frase "Copiar a versão N de <agente>, do cliente <origem>, para o cliente <destino>". "Criar" desabilitado enquanto cria; erro do servidor visível em `role="alert"`; 409 recarrega o modelo e avisa. Sucesso: `router.push` para o editor do agente novo.
- [ ] **Step 3: `TenantAgentsPage`**: botão "Novo agente" no cabeçalho (ao lado de "Atualizar"); estado vazio "Nenhum agente neste cliente ainda." com o mesmo botão.
- [ ] **Step 4: Biblioteca** (`ModelosPage`, rota `/platform/agent-templates`): porta `isAgencyAdminRole` (`AccessDenied` para os outros); lista com nome, descrição, lacunas, "usado em N agentes", atualizado em; "Novo modelo"; "Mostrar arquivados". **Editor do modelo** (`EditorDoModelo`, rota `/platform/agent-templates/[templateId]`): nome, descrição, texto, lacunas e ambíguas ao lado (detector da Task 1, ao vivo), "Salvar" (409 → aviso e recarga), "Arquivar"/"Restaurar".
- [ ] **Step 5: "Salvar como modelo"** no `AgentEditorPage`: só com versão publicada; diálogo com nome e descrição; abre o editor do modelo novo.
- [ ] **Step 6: Menu:** "Modelos de agente" (`/platform/agent-templates`) em `Layout.tsx` (`adminSidebarNav`, depois de "Equipe da Agencia") e em `navConfig.ts` (lista da plataforma), só para `isAgencyAdminRole`.
- [ ] **Step 7: Testes de tela** (Testing Library): os três começos chamam a API com o corpo certo; lacunas viram campos; resposta com `{` mostra o erro antes de enviar; erro do servidor aparece; botão desabilitado durante o envio; modelo vazio desabilita a opção; o editor do modelo mostra lacunas e ambíguas e trata 409; "Salvar como modelo" some sem versão publicada; menu só para `agency_admin`.
- [ ] **Step 8:** suíte completa; **Commit** `feat(central-agentes): telas de novo agente e modelos da agencia (bloco 2)`.

### Task 7: Verificação completa e SPEC sincronizada

- [ ] `npm run lint` 0, `npx tsc --noEmit` 0, `npm run build` 0, `npx vitest run` (suíte inteira, 0 falhas), `npm run test:local -- test/centralAgentesModelos.local.test.ts test/centralAgentesEditor.local.test.ts test/centralAgentesFundacao.local.test.ts`. Cada resultado lido num comando separado. SPEC e cópia do cérebro iguais (`diff`). Commit só de doc se a SPEC mudar.

### Task 8: Revisão do Codex (código)

- [ ] Pedido pelo canal (`codex queue`, ASCII, `[CLAUDE -> CODEX]`), com a lista de commits, o resultado da verificação e os pontos sensíveis: ordem de checagem do modelo, conferência do resultado, ambiguidade, grants, ordem das rotas. Parecer salvo literal no cérebro. NO-GO → corrigir, verificar de novo, nova rodada.

### Task 9: Ensaio no ambiente de teste (OK do Junior para o push de ensaio)

- [ ] **Step 1:** migration no banco de TESTE pelo rito: entrada em `migracoes-aprovadas.json` (sha256 do arquivo commitado), `aplicar_migration.py teste supabase/migrations/20261009120000_central_agentes_modelos.sql --confirmar-banco zvwngsrflkicbbzfmrgy`; conferir o histórico (versão e nome do arquivo, não a hora da aplicação).
- [ ] **Step 2:** `git push origin HEAD:feat/aurora-implantacao`; `poll_deploys.py <sha> --so-previa --sem-alias`; `prova_login.py --url <prévia>` = banco de teste; `alias_teste.py mover <dpl>`; `prova_login.py` nos três domínios.
- [ ] **Step 3:** contagem antes (`sqlteste.py`, só leitura: `ai_agents`, `ai_agent_versions`, `ai_agent_templates`, `channel_connections` com agente, `conversation_messages`).
- [ ] **Step 4:** pela tela, com usuário descartável `agency_admin`: criar um modelo com lacunas (uma repetida, uma deixada em branco); criar um agente a partir dele; abrir o editor e "Testar sem enviar"; publicar a v1; criar um agente "Padrão em branco"; copiar a Aurora de teste para outro cliente de teste; "Salvar como modelo" a partir de um agente publicado; arquivar e restaurar um modelo; conferir no celular (320 px) o diálogo, com `elementFromPoint` no campo e no botão. 0 erro de console.
- [ ] **Step 5:** contagem depois: só `ai_agents`, `ai_agent_versions`, `ai_agent_templates` (e o limitador do teste) mudaram; nenhum número ganhou agente; nenhuma mensagem saiu. Limpeza: descartável apagado; agentes e modelos de ensaio ficam (são do banco de teste) e ficam listados no registro.
- [ ] **Step 6:** registro do ensaio no cérebro (`ensaio-bloco-2-<data>.md`).

### Task 10: Publicação (OK do Junior para a publicação E, pela regra 4, para ESTA migration)

- [ ] **Step 1:** pedir o OK uma vez, com tudo o que vai acontecer: dump, restauração na cópia com migration e volta, migration em produção, push na `main`, alias devolvido. Registrar o OK citado no cartão do projeto e na liberação de `migracoes-aprovadas.json`.
- [ ] **Step 2:** dump de produção pelo rito (`rota_b_senha.ps1 criar` → `dump_producao.ps1 -Data <data>` → `conferir_pos_dump.ps1` → `rota_b_senha.ps1 rotacionar`).
- [ ] **Step 3:** cópia restaurada, com diretório e caminhos explícitos (rodada 1 do PLAN, achado 5; `LEIA-ME.md` do rito, item 13):
  ```bash
  cd "/c/Users/PC Gamer/brains/cenoura-brain/06-References/basecrm-rito-publicacao"
  bash g23-restauracao/ciclo_g23.sh "/c/Users/PC Gamer/BaseCRM-dumps/<data>" \
    "/c/Users/PC Gamer/WorkSync/projetos/Basecrm-worktrees/central-agentes/supabase/migrations/20261009120000_central_agentes_modelos.sql" \
    "/c/Users/PC Gamer/WorkSync/projetos/Basecrm-worktrees/central-agentes/docs/features/central-de-agentes/volta-bloco-2.sql" \
    20261009120000 central_agentes_modelos <sha256-do-arquivo> <contagem-antes.json> <contagem-depois.json>
  ```
  Expected: saída 0, contagens iguais depois de migration + volta, a `ensaio-g23` derrubada e a `crmia` de volta. Antes, conferir no `LEIA-ME.md` a ordem exata dos argumentos e o formato de caminho que o script espera.
- [ ] **Step 4:** `aplicar_migration.py producao ... --confirmar-banco eqidsihasmwwamkaqfka`; conferir o histórico. **A migration entra antes do código** que a chama.
- [ ] **Step 5:** `git fetch`; `origin/main` ancestral do HEAD; `git push origin HEAD:main`; `poll_deploys.py <sha> --sem-alias`; alias de teste devolvido à prévia; `prova_login.py` nos três domínios (e `basecrm.vercel.app`).
- [ ] **Step 6:** prova no ar: `GET /api/platform/agency/agent-templates` sem login = 401; com o Junior, na tela, a lista de modelos abre vazia e o botão "Novo agente" aparece. Nada é criado em produção pelo agente: o primeiro modelo e o primeiro agente de verdade são do Junior.
- [ ] **Step 7:** registro no cérebro (ensaio + publicação) e cartão do projeto.

## Autorrevisão (09/10)

- **Cobertura da SPEC:** começos (Tasks 2, 4, 5, 6), modelos (2, 4, 5, 6), salvar como modelo (2, 4, 6), origem como prova/registro (2, 3), concorrência (2, 3), bordas e ambiguidade (1, 2, 3), origem HTTP em toda escrita (5), ordem 409/400 (2, 3, 4, 5), telas e celular (6, 9), rito e regra 4 (9, 10). Sem lacuna encontrada.
- **Placeholders:** dois pontos dependem de nome real no código e estão marcados para conferir na hora (assinatura de `verificarPrompt`, campo do texto padrão no catálogo, endpoint da lista de clientes); nenhum TBD.
- **Tipos:** `revisaoDoModelo`/`p_expected_template_revision`, `versaoEsperada`/`p_expected_source_version`/`p_expected_version`, `revisaoEsperada`/`p_expected_revision` conferidos entre Tasks 2, 4 e 5.

## Revisão do Codex, rodada 1 do PLAN (09/10, NO-GO) — como ficou

Parecer literal no cérebro: `devolutiva-codex-3-bloco-2.md`. Os cinco achados foram aceitos.

| Achado | Como ficou |
|---|---|
| 1. A conferência perde repetições (`group by` na lista de lacunas); `[[Nome]] e [Cliente]` respondendo "Cliente" passaria | `central_agentes_lacunas` devolve as **ocorrências**, com repetição e na ordem; a lista esperada tira todas as ocorrências das respondidas. O TypeScript ganha `ocorrenciasDeLacunas` (a paridade compara com ela) e `lacunasDoTexto` fica distinta, só para a tela. O contrato estático proíbe `group by` e `distinct` na auxiliar; o caso 7 explica por que a lista distinta falharia. |
| 2. Corrida com a exclusão lógica do cliente | A organização de destino é lida com `for share` nos três começos; caso local com duas conexões, nos três. |
| 3. As duas cópias não revalidam variáveis | `central_agentes_variavel_desconhecida(v_prompt)` nas duas, como no restaurar; casos locais com uma versão antiga que tem `{{variavelAntiga}}`. |
| 4. O teste de fonte não pega `c.admin.rpc` | Nos testes de cada escrita, o `c.admin` é um `Proxy` que lança erro e a RPC é exigida no `c.usuario`; a inspeção de fonte fica como defesa a mais e também procura `admin.rpc(`. |
| 5. `ciclo_g23.sh` sem caminho | Step 10.3 com o diretório do rito e caminhos absolutos. |

## Revisão do Codex, rodada 2 do PLAN (09/10): GO

Parecer literal no cérebro: `devolutiva-codex-4-bloco-2.md`. Os cinco achados da rodada 1 fechados; a melhoria (ambiguidade com `[Nome][ref]`) entrou no caso 8 da Task 3. Condição registrada pelo Codex: sem o teste local da Task 3 rodando de verdade (paridade SQL × TypeScript e a expressão no Postgres), não há sinal verde para o ensaio.

## Execução (09/10) — o que mudou em relação ao texto do plano

Commits locais, nesta ordem: `192c573` (Task 1), `602fbca` (Task 2), `a25a4a8` (Task 3), `be38f26` (Task 4), `1e51937` (Task 5), `d7b4dfb` (Task 6). Nada foi publicado. A migration está aplicada só no banco local.

1. **Forma da lacuna nas rotas (Task 5):** em vez da expressão regular do plano (com barra invertida), o schema aceita uma chave quando `ocorrenciasDeLacunas(chave)` devolve exatamente a própria chave, e a resposta é recusada se tiver `{`, `}`, `[` ou `]` por `includes`. Mesma regra, sem escape para estragar, e a mesma fonte do detector.
2. **Teste local (Task 3):** além dos 12 casos, o 13º chama `criarAgente` (Task 4) com o JWT real da agência e o admin como `Proxy` que lança erro. Duas provas contrárias feitas no banco local e desfeitas: lista de lacunas com `distinct` (pega pelos casos 7 e 11) e `create_ai_agent_blank` sem `for share` (pega pelo 2b). A volta foi aplicada, conferida (8 funções e a tabela fora, histórico sem a versão, a auxiliar da fatia 2 intacta) e a migration reaplicada.
3. **Camada (Task 4):** `ERROS_DO_BANCO`, `MENSAGEM_ERRO_INTERNO`, `comoFalha` e `nomesDasPessoas` passaram a ser exportados de `editorAgentes.ts` para a camada nova reaproveitar. Prova contrária: uma chamada trocada para `c.admin.rpc` derrubou 4 testes.
4. **Telas (Task 6):** "Novo modelo" abre o editor em `/platform/agent-templates/novo` (o mesmo componente cria ao salvar). A lista de clientes da cópia usa `GET /api/platform/tenants` (a mesma da tela de clientes, só agência, até 100 clientes). O diálogo usa o `Modal` do app (camada `z-[9999]`, acima da barra de navegação do celular).
5. **Verificação (Task 7):** suíte completa 374 arquivos e 2.553 testes, 0 falhas; testes locais da Central (modelos, editor, fundação) 41 de 41; tsc 0; lint do projeto 0; build 0, com as rotas novas na lista (`/api/platform/agency/agent-templates`, `/[templateId]`, `/[templateId]/archive`, `/platform/agent-templates`, `/platform/agent-templates/[templateId]`).

## Revisão do Codex, código (09/10) — como ficou

Pareceres literais no cérebro: `devolutiva-codex-5-bloco-2.md` (rodada 1, NO-GO, 2 achados) `devolutiva-codex-6-bloco-2.md` (rodada 2, NO-GO, 3 achados) e `devolutiva-codex-7-bloco-2.md` (rodada 3, GO técnico para o ensaio, 3 achados para antes de publicar). Todos aceitos; os da rodada 3 foram corrigidos antes do ensaio.

| Rodada e achado | Como ficou |
|---|---|
| 1.1 O 409 ao salvar o modelo recarregava tudo e apagava o texto da pessoa | O editor separa a cópia do servidor dos campos; no 409 só a cópia é relida, o texto fica, e aparecem "Salvar o meu por cima" (com a revisão relida) e "Descartar o meu e ver o atual". Arquivar trava com mudança pendente. Commit `7d61c6b`. |
| 1.2 A cópia só alcançava os 100 clientes mais recentes | `GET /api/platform/tenants?busca=` (ILIKE no nome, curingas tirados em `lib/platform/termoDeBusca.ts`) e o campo "Buscar cliente" no diálogo. Commit `7d61c6b`. |
| 2.1 409 seguido de releitura falhando deixava "Descartar" aplicar a versão VELHA | O conflito guarda `atual` só depois de uma releitura bem-sucedida; sem ela, nenhuma das duas escolhas aparece, só "Tentar de novo". Prova contrária: com o fallback para a versão velha, o teste quebra. |
| 2.2 Texto digitado durante o salvamento sumia na releitura | Os três campos ficam `disabled` enquanto salva (também ao criar). Prova contrária: sem o `salvando` na trava, dois testes quebram. |
| 2.3 Mais de 100 clientes com o mesmo nome continuavam fora de alcance | Página seguinte por cursor composto `(created_at, id)` em `lib/platform/cursorDeClientes.ts`: os dois valores só passam por regex ancorada (entram no texto de um filtro `.or()` do PostgREST), a ordem ganhou o id como desempate e a resposta traz `proxima` quando a página vem cheia. O diálogo ganhou "Mostrar mais clientes", que descarta página atrasada depois de uma busca nova. Provado contra o PostgREST local em `test/cursorDeClientes.local.test.ts` (3 clientes no mesmo instante; só com a data, 2 deles sumiam). |
| 3.1 Busca nova com a página antiga pendente deixava "Mostrar mais clientes" travado | A busca nova encerra o "carregando" na hora; o `finally` do "mostrar mais" só o encerra se a busca ainda for a que pediu a página. Teste com a página antiga chegando no meio do carregamento novo. |
| 3.2 Clientes com o mesmo nome não se distinguiam na lista nem na confirmação | Rótulo "Nome (criado em dd/mm/aaaa às hh:mm, id 8 primeiros caracteres)": a data é a mesma da tela Clientes (Brasília) e o id é o da URL do cliente. |
| 3.3 Cursor com data impossível (`2026-99-99T99:99:99Z`) passava pelo formato e virava erro 500 | `instanteValido` confere mês, dia do mês, hora, minuto, segundo e fuso; 400 sem consultar a lista de organizações. |
