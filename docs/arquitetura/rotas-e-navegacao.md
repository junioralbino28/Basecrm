# Rotas, telas e navegação

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).
> Levantado por varredura de código em 2026-07-23.

## O modelo em 30 segundos

- **App Router do Next 16**, com um único grupo protegido `(protected)`.
- Quase toda tela existe em **duas URLs**: a global (`/boards`) e a versão por
  clínica (`/platform/tenants/[tenantId]/boards`) — **as duas renderizam o
  mesmo componente** de `features/`. Quem reescreve os links é
  `getTenantWorkspaceHref` (`lib/tenancy/workspaceRoutes.ts`).
- As páginas em `app/` são cascas finas (`next/dynamic`, `ssr: false`); a tela
  de verdade vive sempre em `features/<módulo>/`.
- **Não existe `middleware.ts`** — o Next 16 renomeou para `proxy.ts` (raiz).

## Autenticação e guards (quem barra o quê)

| Camada | Arquivo | O que faz |
|---|---|---|
| Proxy | `proxy.ts` → `lib/supabase/middleware.ts` | Refresh de sessão; instância não inicializada → `/setup`; sem login em rota privada → `/login`; logado em `/login` → `/dashboard`. **Não intercepta `/api`**. |
| Shell | `components/Layout.tsx` | `!user` → `/login`; admin com clínica ativa → reescreve URL global para tenant-scoped; admin sem clínica em rota global → `/platform/tenants`; não-admin em rota de plataforma → `/dashboard`. |
| Feature | dentro de cada componente | Gates de permissão (`useHasPermission`) — a página em `app/` NÃO tem gate próprio. |

## Mapa de telas (seção Clínica, na ordem da sidebar)

| # | Item | Rota base | Componente real |
|---|---|---|---|
| 1 | Hoje | `/call-list` | `features/call-list/CallListPage` |
| 2 | Visão Geral | `/visao-geral` | `features/visao-geral/VisaoGeralPage` |
| 3 | Boards | `/boards` | `features/boards/BoardsPage` |
| 4 | Contatos | `/contacts` | `features/contacts/ContactsPage` |
| 5 | Conversas | `.../conversations` (só tenant-scoped) | `features/platform/tenants/TenantConversationsPage` |
| 6 | Atividades | `/activities` | `features/activities/ActivitiesPage` |
| 7 | Tarefas | `/tarefas` | `features/tarefas/TarefasPage` |
| 8 | Atendimentos | `/atendimentos` | `features/atendimentos/AtendimentosPage` |
| 9 | Relatórios | `/reports` | `features/reports/ReportsPage` |
| 10 | Financeiro | `/reports/financeiro` | `FinanceReportPage` — item gated por `reports.finance` |
| 11 | Profissionais | `/reports/profissionais` | `ProfessionalsReportPage` — gated por `reports.professionals` |
| 12 | Automações | `.../automations` (tenant-scoped) | `features/automations/AutomationBuilderPage` |
| 13 | Conexões | `.../whatsapp` (tenant-scoped) | `features/platform/tenants/TenantChannelsPage` |
| 14 | Configurações | `/settings` (+ sub-rotas por aba: `/settings/users`, `/ai`, `/products`, `/financeiro`, `/profissionais`, `/integracoes`) | `features/settings/SettingsPage` |

A ordem 5 (Conversas sob Contatos) e 12-13 (antes de Configurações) é decisão
travada do Junior — teste `Layout.navOrder.test.tsx` trava isso.

**Seção Agência** (só admin em rota `/platform*`): Plataforma `/platform` ·
Equipe `/platform/team` · Clínicas `/platform/tenants` · Nova Clínica
`/platform/tenants/new`. Mais as telas por clínica: workspace, branding,
domains, channels.

**Mobile:** `BottomNav` + `MoreMenuSheet` (`components/navigation/navConfig.ts`).

## Rotas públicas e de instalação

`/login` · `/join?token=` (convite) · `/setup` (primeira inicialização; RPC
`is_instance_initialized`) · `/install`, `/install/start`, `/install/wizard`
(installer) · `/auth/callback` (OAuth Supabase).

## Rotas especiais, aliases e pontos de atenção

| Rota | Situação |
|---|---|
| `/pipeline` | **Alias legado** → redirect para `/boards`. Não criar nada novo aqui. |
| `.../whatsapp` ≡ `.../channels` | **Duplicata** — mesmo componente (`TenantChannelsPage`). O menu usa `/whatsapp`. Candidata a consolidação. |
| `.../inbox` ≡ `.../conversations` | **Duplicata** — mesmo componente (`TenantConversationsPage`). O menu usa `/conversations`. |
| `/dashboard` vs `/visao-geral` | Componentes DIFERENTES. `/visao-geral` é a tela oficial do menu; `/dashboard` é rota de aterrissagem (redirects de login/proxy apontam pra ela) sem item de menu. |
| `/deals/[id]/cockpit` vs `/cockpit-v2` | Cockpit em transição: `cockpit` é a rota canônica (`DealCockpitFocusClient`), `cockpit-v2` é rollout (`DealCockpitClient`). Decidir o destino antes de investir em qualquer uma. |
| `/agenda`, `/decisions`, `/ai`, `/inbox` (global) | Telas **sem entrada de menu** — só por URL. Verificar se são futuro, experimento ou candidatas a remoção. |
| `/ai-test`, `/labs/*` | Dev-only (`notFound()` em produção, exigem env `ALLOW_*`). |

## Layouts

- `app/layout.tsx` — root: fontes (Plus Jakarta Sans + Fraunces), `lang=pt-BR`,
  dark no root, PWA (`ServiceWorkerRegister`, `InstallBanner`).
- `app/(protected)/layout.tsx` — pilha de providers na ordem:
  `QueryProvider → ToastProvider → ThemeProvider → AuthProvider →
  ThemeRoleDefault → TenantProvider → CRMProvider → AIProvider`.
  `/setup` e `/labs/*` renderizam SEM o app-shell. `ThemeRoleDefault`: papéis
  de clínica abrem no tema claro; agência, no escuro.

## Não verificado nesta varredura

- Gates de permissão internos de cada feature (estão no doc de cada módulo).
- Cobertura de `error.tsx`/`loading.tsx`/`not-found.tsx` por segmento.
