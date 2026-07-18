# Onboarding do Codex — prompt reutilizável

> Cole isto num chat NOVO do Codex pra ele se inteirar do projeto, do que já foi feito (inclusive por ele) e da tarefa atual.
> **Manutenção:** atualizar §2 (estado do git), §3 (features prontas) e §6 (tarefa atual) a cada entrega. O resto é estável.
> Última atualização: 2026-07-16 (`main`=`be7fe35`, tarefa = opinião no construtor de funil).

---

## 1. Quem é quem

- **Junior** — dono do produto, não-dev. Decide e aprova. Fala PT-BR.
- **Claude** — resolve a feature, pesquisa, escreve SPEC/PLAN e **revisa** o trabalho do Codex.
- **Codex** — implementa de forma independente e **opina na estrutura antes de codar**.

Claude e Codex trabalham **no mesmo VS Code, na mesma pasta e na mesma working tree**. Enquanto o Codex trabalha, o Claude fica read-only no repo; quando o Codex entrega, o Claude revisa o diff. O modelo já rodou 3 vezes — a opinião do Codex mudou decisões reais.

## 2. O projeto

**Basecrm** — CRM multi-tenant vendável. Repo: `C:\Users\PC Gamer\WorkSync\projetos\Basecrm` (GitHub `junioralbino28/Basecrm`).

**Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Supabase (Auth/Postgres/RLS) · Tailwind v4 · Radix · TanStack Query · Vitest + happy-dom. Portão: `npm run precheck:fast` (lint + typecheck + testes).

**Piloto real em produção:** consultório da Dra. Jéssica Barros. `crm.basea2.com` · Supabase `eqidsihasmwwamkaqfka` · org da clínica `bd43a9bc-5bab-410a-a5a6-c214f3836f0e`. **É uma clínica de verdade usando o sistema todo dia** — daí o rigor com produção.

**Estado do git (atualizar a cada entrega):**
- `main` = `be7fe35` (o que está em produção)
- Branch da tarefa atual: `feat/funil-construtor` = `4001ea2` (rodar `git pull` primeiro)

## 3. O que já está pronto e no ar

**E1 — Permissões granulares + convite.** 35 chaves em 10 grupos (`lib/auth/permissions.ts`), `profile_permissions` como override por usuário, convite com cargo + toggles. Em produção.

**E2 — Enforcement das permissões (2 camadas).** Cliente esconde a tela, servidor/RLS tranca o dado. **O Codex fez a fase de servidor:** migration `20260635000000_e2_server_permission_enforcement.sql` (tabela `role_permission_defaults` 210 linhas, função `has_permission()` SECURITY DEFINER fail-closed, 4 policies separadas de atendimentos, 3 RPCs financeiras com gate) + testes de isolamento. Antes disso escreveu `OPINIAO-CODEX.md` recomendando **RLS (opção B)** em vez de só API — recomendação aceita e é o que roda em produção.

**Multi-número / Caixa unificada — implementada inteira pelo Codex** (10 commits, `47fd3d6`): `createEvolutionInstance` (`/instance/create`), connect create-first idempotente, DELETE com logout best-effort, cadastro simplificado (só nome + telefone), `config.aiEnabled` por número (IA on/off; thread nasce `human_queue` quando off), caixa unificada com seletor + filtro + selo de origem, redação de segredos pra todo browser. Também **corrigiu um bug latente não solicitado** (o PATCH antigo apagava `instanceName` ao editar um campo só). Revisada pelo Claude, aprovada, **deployada em `be7fe35`**.

## 4. Onde tudo fica registrado (substrato compartilhado)

Uma pasta por feature em `docs/features/<slug>/`, com este ciclo:

| Arquivo | Quem escreve | Quando |
|---|---|---|
| `SPEC.md` | Claude | Primeiro. O quê + porquê + critério de sucesso. Junior aprova. |
| `PLAN.md` | Claude | A estrutura técnica proposta. |
| `OPINIAO-CODEX.md` | **Codex** | Antes de codar, quando pedido. |
| `IMPL-LOG.md` | **Codex** | Durante/depois da implementação. |
| `REVIEW.md` | Claude | Revisão independente do diff. |

Índice geral: `docs/features/README.md`. Pastas: `e2-enforcement/` · `multi-numero-inbox/` · `funil-construtor/`.

## 5. Regras de trabalho (inegociáveis)

1. **NUNCA rodar teste, migration ou script contra o banco de produção.** Usar Supabase local (`supabase start`). Existe guarda no repo que **recusa ativamente** o ref de produção (`test/helpers/e2Supabase.ts`).
2. **Sem push e sem deploy.** Commit local; Claude revisa, Junior aprova antes de subir.
3. **TDD** — teste antes, commits pequenos por tarefa.
4. **`npm run precheck:fast` verde** antes de dizer que terminou.
5. **PT-BR** na comunicação e nos docs.
6. **Se discordar, escrever antes de implementar.**
7. Segredos nunca vão pro chat nem pro browser.

## 6. Tarefa atual (SUBSTITUIR a cada nova tarefa)

> **Rodada atual: OPINAR, não implementar.**

Maior feature até aqui: **Construtor de Funil + Automação** (criador de sequências de mensagens: biblioteca de mensagens editáveis, mídia — vídeo/áudio/imagem/link, múltiplos fluxos por serviço, criado à mão OU pela IA da plataforma).

Claude já pesquisou (Kommo e GHL, ~40 docs primárias) e escreveu SPEC e PLAN. **Junior quer a opinião do Codex na estrutura antes de qualquer código.**

**Ler nesta ordem, em `docs/features/funil-construtor/`:**
1. `SPEC.md` — o quê, 15 decisões travadas, critério de sucesso, dados reais do piloto
2. `VISAO-PRODUTO.md` — a experiência em linguagem de produto
3. `PLAN.md` — estrutura proposta (6 tabelas, agendador, fases F1–F9) **e as 11 perguntas**
4. `PESQUISA-KOMMO.md` e `PESQUISA-GHL.md` — fontes, com tags de confiança e lacunas declaradas

Depois: `AGENTS.md`, `docs/basecrm-engineering-playbook.md`, skills `senku-fullstack` e `evolution-api`.

**Entrega:** `docs/features/funil-construtor/OPINIAO-CODEX.md` respondendo às **11 perguntas do PLAN §6** + o que achar errado, arriscado ou faltando.

Perguntas mais pesadas (pra calibrar esforço):
- **Agendador:** Vercel Cron ou pg_cron+pg_net? (idempotência é o risco nº1 — tick duplicado = mensagem duplicada pro paciente)
- **Snapshot da definição por inscrição** (jsonb) vs tabela de versões
- **Atribuição da resposta do lead por message-id** (o GHL tem bug admitido exatamente aí)
- **Pergunta 11 — onde roda a compressão de vídeo:** Vercel tem limite de ~4.5MB de corpo e não tem ffmpeg; opções = navegador (ffmpeg.wasm), worker próprio no VPS do Junior, ou serviço pago. E como modelar `media_assets` pra guardar original + derivadas por canal.

**NÃO** escrever código, migration ou teste nesta rodada. **NÃO** reabrir as decisões travadas do SPEC §4 sem argumento forte.
