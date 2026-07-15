# Features — handoff Claude → Codex

> Modelo de trabalho (decidido 2026-07-15): **Claude** resolve a feature e escreve `SPEC.md` (o quê + porquê + critério de sucesso, pro Junior aprovar) e `PLAN.md` (técnico, passo a passo, TDD, arquivos exatos, pro Codex). **Codex** implementa independente e registra em `IMPL-LOG.md`. **Claude** revisa em `REVIEW.md`. **Junior** aprova o spec antes e o resultado depois.
>
> Substrato = este repositório Git (versionado = nada se perde, verificável pros dois).
> Histórico completo do projeto: `WorkSync/workspaces/Cenoura Squad Mapper/historico/`.

## Como cada feature funciona

Uma pasta por feature em `docs/features/<slug>/` com:

| Arquivo | Quem escreve | Quando |
|---|---|---|
| `SPEC.md` | Claude | Primeiro. Junior aprova antes de ir pro Codex. |
| `PLAN.md` | Claude | Depois do SPEC aprovado. É o manual que o Codex executa. |
| `IMPL-LOG.md` | Codex | Durante a implementação. O que fez, commits, desvios, dúvidas. |
| `REVIEW.md` | Claude | Depois do Codex. Revisão + verificação. Aprovado ou ajustes. |

## Índice de features

| Feature | Fase | Status | Pasta |
|---|---|---|---|
| E2 — Enforcement de permissões (toggles bloqueiam telas) | plano | ⚪ SPEC+PLAN prontos → handoff pro Codex (branch `feat/e2-enforcement`) | [`e2-enforcement/`](e2-enforcement/) |

### Legenda de status
🟡 spec → ⚪ plano → 🔵 implementando (Codex) → 🟠 revisão (Claude) → 🟢 pronto/em prod
