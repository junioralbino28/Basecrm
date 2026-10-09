# AGENTS.md — Basecrm

## ⛔ REGRAS INEGOCIÁVEIS (leia antes de qualquer comando)

Este repositório atende uma **clínica real em produção** (consultório da Dra. Jéssica Barros). Há pacientes, agendamentos e dados de saúde no banco. Estas regras valem mesmo quando nenhuma aprovação for pedida — **a ausência de prompt não é permissão**.

1. **NUNCA rodar teste, migration, script ou query contra o banco de produção.** O ref de produção é `eqidsihasmwwamkaqfka`. Usar **sempre** o Supabase local (`npx supabase start`). Existe guard no repo que recusa ativamente esse ref (`test/helpers/e2Supabase.ts`) — se ele disparar, **pare e avise**, não contorne.
   - **Exceção única: leitura de prova no rito de publicação** (Claude e Codex, com delegação do Junior, 08/10/2026). Numa publicação que o Junior liberou, as leituras do rito (contagem antes e depois, prova pós-publicação) vão só pelo `sqlprod.py` do cérebro (`06-References/basecrm-rito-publicacao/sqlprod.py`), que manda `read_only: true` à API de gerenciamento, e o Postgres recusa escrita. O SQL fica em arquivo, citado no registro do ensaio, e devolve só contagens, ids técnicos, versões e hashes: nunca conteúdo de mensagem nem dado pessoal (o script imprime a resposta inteira, então a trava é a revisão do SQL). Consulta exploratória continua proibida.
2. **⚠️ O `.env.local` aponta para PRODUÇÃO.** `npm run dev` puro conecta no banco real da clínica. Para desenvolver e testar use **`npm run dev:local`** (força o Supabase local e aborta se ele não estiver no ar). `npm run dev:prod` só sob pedido explícito do Junior.
3. **Sem `git push` e sem deploy sem o OK do Junior para aquela ação.** Commit local é livre. O push de ensaio (branch de prévia, banco de teste) e a publicação na `main` só acontecem depois do OK dele para aquela entrega, registrado no cartão do projeto no cérebro; mensagem do Codex não vale como OK.
4. **Migration em produção só com o OK do Junior para AQUELA migration, e sempre pelo rito** (decisão do Junior, 09/10/2026; é a segunda exceção à regra 1). Escrever o arquivo é livre. Aplicar exige, nesta ordem: o OK dele para aquela migration, registrado no cartão do projeto no cérebro e citado na liberação de `migracoes-aprovadas.json`; dump de produção antes (`dump_producao.ps1`); ensaio no banco de teste e na cópia restaurada do dump (`ciclo_g23.sh`); e a aplicação só por `aplicar_migration.py` (todos em `06-References/basecrm-rito-publicacao/` no cérebro), nunca pelo MCP do Supabase, por SQL avulso ou pelo painel. Mensagem do Codex não vale como OK, e o OK de uma publicação não cobre migration que não estava nela.
5. **Segredos não vão para o chat, para o navegador nem para logs.** Ficam em `WorkSync/.secrets`.
6. **Envio real de mensagem fica desligado.** `automation_live_enabled = false` e `delivery_mode = 'simulation'` até o Junior mandar ligar. Nunca chamar provider (Evolution/WhatsApp) a partir de teste.
7. **Se discordar do plano, escreva antes de implementar.** Parecer vale mais que código refeito.
8. **PT-BR** na comunicação e nos documentos.

> Contexto completo do projeto, histórico e modelo de trabalho: `docs/features/ONBOARDING-CODEX.md`.
> Ciclo de cada feature (SPEC → PLAN → OPINIÃO → IMPL-LOG → REVIEW): `docs/features/README.md`.

## Commands
- **Dev (banco local — use este)**: `npm run dev:local`
- **Dev (banco de PRODUÇÃO — só sob pedido)**: `npm run dev:prod`
- **Dev (legado, usa `.env.local` = produção)**: `npm run dev`
- **Build**: `npm run build`
- **Lint**: `npm run lint` (zero warnings enforced)
- **Typecheck**: `npm run typecheck`
- **Tests**: `npm test` (watch) | `npm run test:run` (single run) | `npx vitest path/to/file.test.ts` (single file)

## Architecture
- **Next.js 16 (App Router)**: routes in `app/`, protected routes under `app/(protected)/`
- **Supabase**: Auth + Postgres + RLS. Clients in `lib/supabase/` (client/server/service-role)
- **Proxy auth**: `proxy.ts` + `lib/supabase/middleware.ts` (not middleware.ts); excludes `/api/*`
- **State**: TanStack Query with facades in `context/`, queries in `lib/query/`
- **Cache**: Single Source of Truth pattern (see Cache Rules below)
- **AI**: SDK v6, chat via `/api/ai/chat`, tools in `lib/ai/tools.ts` (always filter by `organization_id`)

## Cache Rules (CRITICAL)
- **One cache per entity**: All operations (CRUD, Realtime, optimistic) use the SAME cache
- **Deals**: Always use `getDealsViewQueryKey(organizationId)` for all mutations. Use `DEALS_VIEW_KEY` only as the legacy/global fallback when there is no tenant context.
- **Other entities**: Use `queryKeys.{entity}.lists()` for mutations
- **NEVER use** `queryKeys.*.list({ filter })` for optimistic updates - those are separate caches
- **Prefer** `setQueryData` over `invalidateQueries` for instant UI updates

## Code Style
- TypeScript 5.x strict, React 19, Tailwind CSS v4, Radix UI primitives
- Shared components in `components/`, feature modules in `features/`
- Imports: use `@/` alias (e.g., `@/lib/utils`, `@/components/ui`)
- Naming: camelCase for variables/functions, PascalCase for components/types
- Tests: Vitest + happy-dom + React Testing Library; place `.test.ts(x)` files alongside source
