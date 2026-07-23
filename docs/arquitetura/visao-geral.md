# Visão geral da arquitetura

> Parte da documentação-mãe. Índice geral em [docs/README.md](../README.md).
> É o documento de "primeiro dia": leia este antes de qualquer outro.

## O que é o produto

CRM multi-tenant white-label para agência + clientes (piloto: clínica
odontológica da Dra. Jéssica), com funil Kanban, inbox de WhatsApp, motor de
automação de follow-up, camada financeira e IA embutida. Nasceu single-tenant e
foi endurecido para multi-tenant — parte das cicatrizes dessa migração ainda
aparece no código (documentadas em cada doc).

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind v4 · Radix/shadcn |
| Estado | TanStack Query (fonte canônica) · Contextos por domínio · Zustand pontual |
| Backend | Supabase (Postgres + RLS + Auth + Storage + Realtime) · rotas API do Next |
| Automação | pg_cron + pg_net + Vault (tick 5min) → worker externo → RPCs service_role |
| Mensageria | Evolution API (WhatsApp) · n8n como automação externa opcional |
| IA | Vercel AI SDK v6 — Google (default) / OpenAI / Anthropic; chaves POR ORG no banco |
| Agenda | Clinicorp (API ao vivo; `appointments` é só cache) |
| Testes | Vitest + happy-dom + testing-library · integração real via `test:local` · Playwright |
| Hosting | Vercel FREE (por isso o scheduler é pg_cron, não cron da Vercel) |

## As 5 camadas, de fora pra dentro

1. **Rotas e telas** — `app/` é casca; a tela real vive em `features/`. Quase
   toda tela tem URL global e URL por clínica. Detalhe:
   [rotas-e-navegacao.md](./rotas-e-navegacao.md).
2. **Camada de dados do cliente** — hooks TanStack → serviços `lib/supabase/*`.
   `CRMContext` é fachada legada. Permissões: 44 chaves resolvidas no servidor
   (`GET /api/me/permissions`). Detalhe: [camada-de-dados.md](./camada-de-dados.md).
3. **APIs** — 103 route handlers em 6 modelos de autenticação (sessão+CSRF,
   x-api-key, report token, Bearer interno, secret de webhook, guard de
   instalador). Detalhe: [apis-e-integracoes.md](./apis-e-integracoes.md).
4. **Banco** — 55 migrations; RLS em 3 níveis (`access`/`operate`/`configure`) +
   `has_permission` por snapshot versionado (v3 ativo); motor de automação
   mutável só via RPC service_role. Detalhe: [banco-de-dados.md](./banco-de-dados.md).
5. **Integrações** — Evolution (WhatsApp), Clinicorp (agenda), n8n (automação
   externa), API pública v1 + MCP.

## O modelo multi-tenant em 1 parágrafo

`organizations` é a raiz. Todo dado carrega `organization_id` e as tabelas
críticas usam FK composta `(organization_id, id)` — um deal não consegue apontar
para um board de outra clínica nem por bug. Papéis: `agency_admin` / `agency_staff`
(agência, enxergam todos os tenants) e `clinic_admin` / `clinic_staff` / `vendedor`
(presos à própria org). RLS decide leitura por `can_access_organization`,
mutação operacional por `can_operate_organization`, configuração por
`can_configure_organization`, e recursos finos por `has_permission(chave)`.

## O motor de automação em 1 parágrafo

O construtor grava rascunho (`automations` + steps + edges); publicar congela um
**snapshot imutável** (`automation_versions`). Etiquetar um lead **registra
interesse**; quem inicia fluxo é o **esfriamento** — 5 dias sem NENHUMA mensagem
na conversa (relógio em `automation_conversation_clocks`). 1 interesse →
inscrição direta; 2+ → tarefa-porteiro e nada roda até um humano decidir.
A execução é um outbox (`automation_jobs`) com retry/backoff e dead-letter,
acionado por pg_cron a cada 5min via worker. Envio real é DUPLAMENTE travado:
`automation_live_enabled=false` por org + trigger que recusa ligar com o
scheduler doente. Hoje TUDO roda em `delivery_mode='simulation'`.

## ⚠️ O que a trava de simulação NÃO cobre

O **auto-reply conversacional da IA** (persona "Julia") responde WhatsApp DE
VERDADE quando uma thread está `ai_active` com `config.aiEnabled` na conexão —
esse caminho não consulta `automation_live_enabled` (é conversa ao vivo, não
campanha). A chave para desligar É OUTRA: o `aiEnabled` da conexão. Decisão de
produto registrada em [apis-e-integracoes.md](./apis-e-integracoes.md).

## Ambientes

| Ambiente | Banco | Como subir |
|---|---|---|
| Local | Supabase local (Docker, 127.0.0.1:54321) | `npm run dev:local` |
| Produção | Supabase `eqidsihasmwwamkaqfka` (clínica REAL) | deploy Vercel — só com aval |

Regras completas: [../operacao/](../operacao/ambiente-local.md).
