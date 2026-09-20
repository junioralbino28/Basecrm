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
| E2 — Enforcement de permissões (toggles bloqueiam telas) | completo | 🟢 EM PROD (2026-07-15): migration aplicada+verificada + código deployado (`main` fd84dff) | [`e2-enforcement/`](e2-enforcement/) |
| Multi-número / Caixa unificada (parear fácil + switch de número + IA por número) | completo | 🟢 EM PROD (2026-07-16): Codex implementou, Claude revisou/aprovou, deploy `be7fe35` | [`multi-numero-inbox/`](multi-numero-inbox/) |
| Construtor de Funil + Automação (mensagens editáveis + mídia + manual/IA) | execução | 🔵 **A e B concluídas e aprovadas** · **visual APROVADO pelo Junior** (`mockup-tela-real.html` = referência oficial) → **SPEC-ENTREGA-C.md** escrita, fatiada em C1/C2/C3 (C1A/C1B/C1C/C2A/C2B entregues) · 🟠 **Entrega LIVE (2a–2d, 13/09, Claude):** envio real pela Evolution no tick, executor de atraso/espera/tarefa/mover etapa, botão por cliente, silêncio noturno aplicado, opt-out "PARAR", procedimento dos segredos do tick — `SPEC-ENTREGA-LIVE.md` + `IMPL-LOG-LIVE.md` + `OPERACAO-TICK.md`; aguarda revisão pontual do Codex e semeadura dos segredos por ambiente | [`funil-construtor/`](funil-construtor/) |
| Comercial por mês de fechamento (RPC + Visão Geral + planilha pública) | completo | 🟠 na branch (`21140bf`, 04/09), construído pelo Claude; aguarda revisão pontual do Codex e rollout com a cadeia do Pacote 3 | [`comercial/`](comercial/) |
| Conversão de volta para a Meta (clique de anúncio → respondeu → agendou → compareceu → fechou → CAPI) | completo em código | 🟠 **3a** captura do `ctwa_clid`, **3b** marcos por negócio, **3c** envio à Meta e **3d** "respondeu e é da região" entregues (13/09, Claude, na branch); aguardam revisão pontual do Codex, cliente piloto em modo teste e rollout (com 2d antes) | [`conversao-meta/`](conversao-meta/) |
| Aurora CENNO (SDR de campanha + handoff no CRM + agenda autônoma) | implementação | 🔵 **Fases 1–2 implementadas em worktree isolada** (19/09): prompt por conexão, alerta idempotente, configuração de disponibilidade e reserva atômica 40/60; aguarda revisão independente e configuração não-prod | [`aurora-cenno/`](aurora-cenno/) |

### Legenda de status
🟡 spec → ⚪ plano → 🔵 implementando (Codex) → 🟠 revisão (Claude) → 🟢 pronto/em prod
