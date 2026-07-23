# Módulos do sistema (features/)

> Parte da documentação-mãe. Índice geral em [docs/README.md](./README.md).
> Levantado por varredura de código em 2026-07-23. Esqueleto espelhado:
> **Propósito · Arquivos-chave · Dados · Testes · Pendências** para todo módulo.

## Como os dados fluem (regra geral)

- Camada canônica: **hooks TanStack Query** (`lib/query/hooks/*`) → **serviços
  Supabase** (`lib/supabase/*`).
- `context/CRMContext.tsx` é **camada de compatibilidade legada** — agrega os
  contextos de domínio, que por baixo usam os mesmos hooks/serviços. `useCRM()`
  ainda é Supabase real, só com indireção a mais.
- Exceção: `platform/` e `agenda/` falam com rotas REST internas
  (`/api/platform/*`, `/api/agenda/*`) via `fetch` + `useState`.

---

## boards — Kanban de negócios (o coração)

- **Propósito:** funis, etapas, cards de negócio, wizard de criação, modal de detalhe.
- **Arquivos-chave:** `features/boards/BoardsPage.tsx` · `components/Kanban/*` ·
  `components/BoardCreationWizard.tsx` · `components/Modals/DealDetailModal.tsx` ·
  `hooks/useBoardsController.ts`.
- **Dados:** TanStack (`useBoardsQuery`, `useDealsQuery`, `useMoveDeal`) → Supabase real.
- **Testes:** só `DealDetailModal.test.tsx` — **cobertura fraca pro módulo mais crítico**.
- **Pendências:** `activeBoardId` em localStorage; custom fields locais (`TODO migrate`);
  exports `@deprecated` coexistindo; `DealDetailModal.tsx:755` botão Edit **sem handler**;
  `CreateDealModal` V1/V2 duplicados.

## automations — construtor de funil

- **Propósito:** builder visual (árvore de passos, switch N-ário, dock, mapa navegável, gatilho por etiqueta).
- **Arquivos-chave:** `AutomationBuilderPage.tsx` · `AutomationFlowMap.tsx` ·
  `AutomationStepDock.tsx` · `AutomationSwitchEditor.tsx` · `TriggerTagSelector.tsx` ·
  utilitários puros `automationTreeLayout/GraphMove/SwitchDraft/Viewport.ts`.
- **Dados:** `lib/supabase/dealTags` no seletor; persistência do grafo via APIs de
  automação (ver doc do funil em `features/funil-construtor/`).
- **Testes:** **cobertura forte** — praticamente todo arquivo tem `.test`.
- **Pendências:** nenhuma aberta no módulo; o roadmap vive em `SPEC-ENTREGA-C.md`.
- **Doc detalhado:** todo o ciclo A→C2C em `docs/features/funil-construtor/`.

## tags — etiquetas e origem (C2C)

- **Propósito:** seletores reutilizáveis: `DealTagSelector` (menu por categoria,
  nunca digita) e `DealOriginSelector` (origem separada, primeira/última).
- **Dados:** `lib/supabase/dealTags` + `lib/supabase/leadSources` (RPCs da C2A).
- **Testes:** ambos com `.test.tsx`; serviços também testados.
- **Pendências:** nenhuma. É o sistema NOVO que substituiu tags de texto livre.

## contacts — contatos e empresas

- **Propósito:** CRUD, filtros, abas por ciclo de vida, import/export.
- **Arquivos-chave:** `ContactsPage.tsx` · `components/ContactsView/List` ·
  `ContactFormModal.tsx` (+V2) · `hooks/useContactsController.ts`.
- **Dados:** TanStack → Supabase real.
- **Testes:** `ContactCallOutcome.test.tsx`, `ContactFormModal.test.tsx`.
- **Pendências:** `ContactFormModal` V1/V2 duplicados (migração incompleta — não verificado qual está montado).

## conversations (em platform/) — conversas WhatsApp

- **Propósito:** tela de conversas por clínica (`TenantConversationsPage`).
- **Dados:** REST `/api/platform/tenants/[tenantId]/conversations/*`.
- **Testes:** `TenantConversationsPage.test.tsx`.
- **Pendências:** botão "Gravar áudio (em breve)" — não implementado (`:1306`).

## activities · tarefas · atendimentos · call-list (operação do dia)

| Módulo | Propósito | Dados | Testes | Pendências |
|---|---|---|---|---|
| `activities` | reuniões/ligações com lista+calendário | TanStack real | **nenhum** | `ActivityFormModal` V1/V2 duplicados |
| `tarefas` | tarefas com lembretes/"nudges" | TanStack real | **forte** (5 arquivos) | — |
| `atendimentos` | registros de consulta (profissional, produto, valor) | TanStack real | **boa** (3 arquivos) | — |
| `call-list` | "Hoje": fila de ligações consolidada | TanStack real | boa (2 arquivos) | — |

## reports — relatórios

- **Propósito:** financeiro e profissionais (faturamento, comissões, custos, PDF).
- **Dados:** `useFinanceReports` + `useCommissionPaymentsQuery` → `lib/supabase/reports.ts`.
- **Testes:** **fortes** — páginas + todos os utils de cálculo.
- **Pendências:** nenhuma.

## settings — configurações do tenant

- **Propósito:** usuários/RBAC, IA, catálogos (produtos, profissionais), financeiro
  (comissões, taxas, custos fixos), Etiquetas (C2C), API keys, webhooks, MCP, auditoria.
- **Arquivos-chave:** `SettingsPage.tsx` · `UsersPage.tsx` · `components/*Manager.tsx` ·
  `components/TagCatalogSettings.tsx` · `hooks/useSettingsController.ts`.
- **Dados:** misto — TanStack + serviços + Supabase client direto em seções.
- **Testes:** bons em RBAC e financeiro (7 arquivos).
- **Pendências:** **custom fields e `crm_tags` ainda em localStorage**
  (`useSettingsController.ts` com `TODO: Migrate to Supabase`) — as tags legadas
  saem quando a migração da C2A rodar em produção.

## dashboard · visao-geral — painéis

- `visao-geral` é a tela oficial do menu (deals parados, leitura inteligente,
  card financeiro por papel); testada. `dashboard` é rota de aterrissagem sem
  item de menu; **sem testes**; `useDashboardMetrics.ts:230` tem TODO de refactor.

## inbox — central de trabalho por negócio

- **Propósito:** briefing, sugestões de IA, notas, arquivos, scripts rápidos, composer.
- **Dados:** TanStack + serviços diretos (`quickScripts`, `dealNotes`, `dealFiles`,
  `aiSuggestions`, `ai-proxy` via Edge Function).
- **Testes:** só `CallModal.test.tsx` — fraco pro tamanho do módulo.
- **Pendências:** `viewMode` em localStorage (leve).

## deals/cockpit — cockpit do negócio (EM TRANSIÇÃO)

- Duas versões coexistem: `/deals/[id]/cockpit` (Focus, canônica) e `/cockpit-v2`
  (rollout). **Sem testes.** Decidir o destino antes de investir.

## decisions — fila de decisões (⚠️ MAIOR DÍVIDA)

- **Propósito:** analisadores geram sugestões (deals parados, atividades atrasadas)
  para aprovar/rejeitar.
- **Situação real (corrigida pelo parecer Codex §3.3):** persiste em
  localStorage SEM tenant/usuário na chave (trocar de clínica no mesmo
  navegador vaza contexto). Existem DOIS executores: o do service é placeholder,
  mas o hook da UI dispara mutações REAIS (`addActivity`/`updateDeal`/
  `updateActivity`) **sem await** e marca aprovado mesmo se o banco falhar.
  Sem testes. Sem entrada de menu.
- **Veredito:** quarentenar a rota; NÃO absorver na C2D. Aproveitar só
  UX/conceito dos analisadores numa futura central server-side tenantizada.

## ai-hub · profile · agenda · platform

| Módulo | Situação |
|---|---|
| `ai-hub` | chat via `UIChat` + `/api/ai/chat`. A pasta `tools/` (crmTools.ts) é **totalmente desconectada** — as tools reais vivem em `lib/ai/tools.ts` (parecer Codex §2). Sem testes. Sem menu. |
| `profile` | perfil do usuário; Supabase direto; sem testes; sem pendências. |
| `agenda` | agenda diária integrada ao Clinicorp (`/api/agenda/appointments`); 1 teste; sem item de menu ainda. |
| `platform` | admin da agência: tenants, provisionamento, branding, domínios, canais Evolution. REST-based. 2 testes. |

---

## Raio-X de dívidas (consolidado)

| Tipo | Onde |
|---|---|
| Módulo 100% localStorage + ação placebo | `decisions` |
| TODO migrar pra Supabase | custom fields (`settings`, `boards`) · `crm_tags` legado (`settings`) |
| Duplicatas V1/V2 — **verificado: os 3 modais V2 são ÓRFÃOS** (nenhum import além do próprio arquivo; a V1 é a montada) → código morto, candidatos a remoção | `ActivityFormModalV2` · `ContactFormModalV2` · `CreateDealModalV2` · cockpit vs cockpit-v2 (este segue em transição real) |
| Botão sem handler | `DealDetailModal.tsx:755` (Edit) · "Gravar áudio (em breve)" |
| Sem NENHUM teste | `activities` · `ai-hub` · `dashboard` · `deals` · `decisions` · `profile` |
| Cobertura fraca | `boards` (1 teste) · `inbox` (1 teste) |
| `@deprecated` vivo | `CRMContext` inteiro (compat) · exports em `boards` |
