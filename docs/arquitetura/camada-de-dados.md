# Camada de dados e infraestrutura de cliente

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).
> Levantado por varredura de código em 2026-07-23.

## O fluxo canônico

```
Componente → hook TanStack (lib/query/hooks/*) → serviço (lib/supabase/*) → Supabase (RLS)
```

- `context/CRMContext.tsx` é **fachada legada** sobre os contextos de domínio
  (`context/deals`, `contacts`, `activities`, `boards`, `settings`) — que por
  baixo usam os mesmos hooks. Código novo deve usar os hooks específicos, não
  `useCRM()`.
- Realtime: `lib/realtime/useRealtimeSync.ts` escuta o Supabase Realtime e
  escreve direto no cache TanStack (multi-usuário na mesma tela).

## Serviços (lib/supabase/*) — mapa rápido

| Domínio | Serviço | Tabelas/RPCs principais |
|---|---|---|
| Negócios | `dealsService` | `deals`, `deal_items` (+ won/lost/reopen) |
| Contatos | `contactsService` / `companiesService` | `contacts`, `crm_companies` |
| Funis | `boardsService` / `boardStagesService` | `boards`, `board_stages` |
| Atividades | `activitiesService` | `activities` |
| Tarefas | `tasksService` | `tasks` |
| Atendimentos | `atendimentosService` | `atendimentos` |
| Agenda | `appointmentsService` (read-only) | `appointments` |
| Etiquetas (C2C) | `dealTagsService` | `tags`, `tag_categories`, `deal_tag_assignments` + RPCs `assign/remove/set_primary_deal_tag`, `get_or_create_tag(_category)` |
| Origens | `leadSourcesService` | `lead_sources` + RPCs `get_or_create_lead_source`, `record_lead_source_attribution` |
| Financeiro | `commissionRules/Payments`, `paymentMethodFees`, `fixedCosts`, `reportsService` | tabelas próprias + RPCs de relatório |
| Catálogos | `productsService`, `professionalsService`, `lifecycleStagesService` | `products`, `professionals`, `lifecycle_stages` |
| Inbox | `dealNotes`, `dealFiles`, `quickScripts`, `aiSuggestions` | tabelas próprias + Storage |
| Config | `settingsService`, `organizationSettingsService` | `user_settings`, `organization_settings` |
| LGPD | ⚠️ TRÊS variantes: `consent.ts`, `consents.ts`, `lib/consent/consentService.ts` | `user_consents`, `audit_logs` |

Detalhe importante: o barrel `lib/supabase/index.ts` NÃO exporta os serviços
mais novos (`dealTags`, `dealNotes`, `dealFiles`, `quickScripts`,
`aiSuggestions`) — eles se importam por caminho direto.

## Contextos — quem é dono de quê

| Contexto | Dono de | Fonte |
|---|---|---|
| `AuthContext` | sessão, perfil, **mapa de permissões** | `supabase.auth` + `profiles` + `GET /api/me/permissions` |
| `TenantContext` | clínica ativa (org, branding, módulos) | `GET/POST /api/platform/tenant/current` |
| `Deals/Contacts/Activities/BoardsContext` | CRUD do domínio | TanStack (fonte única) |
| `SettingsContext` | lifecycle stages, products, **config de IA** | ⚠️ `useState` próprio (fora do padrão TanStack) |
| `CRMContext` | fachada legada + projeção `DealView` | agrega os de cima |
| `AIContext` / `AIChatContext` | contexto de UI para IA ("onde o usuário está") | estado local |
| `ThemeContext` | dark mode | localStorage (`crm_dark_mode`) |

## Permissões no cliente

- Fonte da verdade das chaves: `lib/auth/permissions.ts` — **44 chaves**
  (`contacts.*`, `funnels.*`, `conversations.*`, `whatsapp.*`, `reports.*`,
  `ai.*`, `automation.*`, `tags.*`, `lead_sources.*`, `settings.*`...).
- O mapa efetivo NÃO é calculado no cliente: `AuthContext` busca de
  `GET /api/me/permissions` (o servidor resolve papel + overrides); fallback
  em erro = **nega tudo**.
- Uso: `useHasPermission('tags.manage')` — retorna `undefined` enquanto carrega.
- Papéis: `agency_admin`/`admin`/`clinic_admin` (tudo) · `agency_staff` (sem
  users/finance/audit) · `clinic_staff`/`vendedor` (operacional).

## Subpastas de lib/ que importam saber

| Pasta | O que é |
|---|---|
| `conversations/` | motor do inbox WhatsApp: webhook Evolution, dispatch outbound, aiReply, roteamento humano/IA, pausas de automação |
| `channels/` | conectores: Evolution API (WhatsApp) e Clinicorp |
| `ai/` | Vercel AI SDK: providers (Google/OpenAI/Anthropic), prompts, tools do CRM, agente |
| `automations/` (ver docs do funil) | compilador/validação do grafo de automação |
| `templates/` | templates de boards/jornadas (registry busca de repo GitHub externo) |
| `mcp/` | expõe tools do CRM como MCP |
| `public-api/` | API pública v1 (resolução de IDs, paginação por cursor) |
| `installer/` + `provisioning/` | wizard self-host + edições do produto |
| `tenancy/` + `platform/` + `branding/` | resolução de tenant por host, acesso, branding |
| `stores/` | Zustand (UI/notification stores) |
| `security/` | CSRF por checagem de Origin |
| `debug/` | dados fake via `localStorage.DEBUG_MODE` |

## ⚠️ Inconsistências e dívidas conhecidas desta camada

1. **Três serviços de consentimento LGPD** para a mesma tabela — consolidar em um.
2. **`products` com fonte dupla**: `SettingsContext.products` (useState) E
   `useProducts` (TanStack). Risco de divergência.
3. **Projeção `DealView` duplicada**: `CRMContext.deals` vs
   `DealsContext.useDealsView` com lógica ligeiramente diferente.
4. **`lifecycleStages` fora do padrão** (useState no SettingsContext).
5. **`createStaticAdminClient` definido em 2 lugares** (`server.ts` e
   `staticAdminClient.ts`).
6. **Deprecados vivos a remover:** `lib/ai/actions.tsx` (stub morto),
   `useDealsQuery.ts:440` (hook que o próprio comentário diz não ser usado),
   funções single-tenant em `lib/supabase/utils.ts`, campos `leads/addLead/...`
   no CRMContext.
7. **localStorage:** utilitário base `usePersistedState` (com versionamento) —
   uso aceitável para preferência de UI; dívida real listada em
   [modulos.md](./modulos.md) (decisions, custom fields, crm_tags legado).
