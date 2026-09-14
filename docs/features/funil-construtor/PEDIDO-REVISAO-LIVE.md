# Pedido de revisão — Entrega LIVE (2a–2d): o motor de funis passa a executar de verdade

**Para:** Codex (revisor pontual de pedaço fechado)
**De:** Claude (construiu), a pedido do Junior
**Data:** 2026-09-13
**Branch:** `feat/funil-construtor` · commit da entrega: `f45d8dc` (um commit só; `git show --stat f45d8dc`)
**Tipo:** revisão adversarial. **Não é pedido de execução: não altere código nem migrations.** O único
arquivo que você escreve é `docs/features/funil-construtor/OPINIAO-LIVE.md`.

> **Atualização (13/09, depois do commit `f45d8dc`):** por decisão do Junior, `lib/automations/optOut.ts`
> e o bloco de palavra de parada no webhook foram **removidos** (opt-out será interpretado pela IA de
> atendimento; `record_automation_opt_out` e o gate no `prepare` ficam). Ignore os pontos sobre
> palavras de parada. Revise o restante no commit mais recente da branch.

## O que muda, em uma frase

O motor de automações (Entregas A/B/C1/C2), que só sabia simular, agora manda a mensagem real pela
Evolution dentro do tick, avança atraso vencido, abre espera por resposta, cria tarefa e move o
negócio de etapa; ganhou botão por cliente, silêncio noturno aplicado antes de reservar, opt-out
por palavra de parada e o procedimento dos segredos do tick por ambiente.

## Leitura obrigatória, nesta ordem

1. `docs/features/funil-construtor/SPEC-ENTREGA-LIVE.md` — o quê, por quê, os três cadeados, a
   divergência registrada do ADR-MOTOR e as decisões assumidas (seção 6) e dívidas (seção 7).
2. `docs/features/funil-construtor/IMPL-LOG-LIVE.md` — o que foi construído, os diffs de cabeçalho,
   as provas e a **auto-revisão adversarial** (seção 4). Bata nela: o que eu deixei passar?
3. `docs/features/funil-construtor/OPERACAO-TICK.md` — o procedimento 2d.
4. `docs/features/funil-construtor/ADR-MOTOR.md` — a decisão original (worker na VPS).

## Arquivos em escopo (todos no commit `f45d8dc`)

| Arquivo | O que é |
|---|---|
| `supabase/migrations/20260913040000_funil_live_envio_real.sql` | 8 funções + 1 coluna (ver IMPL-LOG §1) |
| `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql` | `claim_automation_jobs` com a duração limitada antes do cast |
| `lib/automations/executor.ts` | o executor (`executeDueAutomationJobs`) |
| `lib/automations/optOut.ts` | palavra de parada (puro) |
| `app/api/internal/automations/tick/route.ts` | encaixe do executor no tick, `maxDuration = 60` |
| `app/api/internal/automations/execute/route.ts` | executor sob demanda (Bearer do worker) |
| `app/api/settings/automations-live/route.ts` | botão por cliente + silêncio noturno (admin) |
| `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` | bloco do opt-out (procure `record_automation_opt_out`) e a condição que cala a IA |
| `test/helpers/funilTestFixture.ts` | `deliveryMode`, `extraStageNames`, limpeza na falha |
| `test/funilLiveExecutor.local.test.ts`, `test/funilLiveMigration.test.ts`, `test/automationTickRoute.test.ts`, `lib/automations/optOut.test.ts` | provas |
| `.env.example` | três variáveis novas |

Funções do motor que **não** mudaram mas que as novas chamam (leia-as para julgar o encaixe):
`complete_automation_job`, `advance_automation_enrollment` (F4, `20260718030000`),
`open_automation_wait`, `pause_automation_enrollments_for_thread` (F5, `20260718040000`),
`resolve_automation_wait_from_inbox` (`20260722070000`), `materialize_automation_jobs` e
`execute_automation_switch` (`20260720010000`), `set_automation_live_enabled` e o gatilho
`guard_automation_live_enable` (`20260720030000`).

## O que eu afirmo (verifique cada item no código ou no banco local, não no meu texto)

1. `prepare_automation_outbound` foi substituída com cabeçalho idêntico ao da F4 (DEFINER,
   `search_path = ''`, mesmo `returns table`) e **só** o bloco do modo mudou (+ `v_mode`). Diff em
   `git diff 9c146ef f45d8dc -- supabase/migrations/20260913040000_funil_live_envio_real.sql` contra
   as linhas 594–718 de `20260718030000_funil_f4_scheduler.sql`.
2. `claim_automation_jobs` idem: só a expressão de `duration_ms` mudou (linhas 327–419 da F4).
3. As 9 funções novas/alteradas têm `EXECUTE` revogado de `public`, `anon` e `authenticated` e
   concedido a `service_role`. Confira no catálogo (`pg_proc` + `has_function_privilege`), não no
   texto da migration.
4. Nenhuma mensagem real sai sem os três cadeados (variável de ambiente, chave do cliente, versão
   publicada em live), e os dois últimos são checados **no banco**, dentro de
   `prepare_automation_outbound`, não só no executor.
5. O executor nunca retenta um envio; `unknown` e `failed` sem aresta pausam a conversa; uma
   segunda execução não reenvia (teste "5xx" prova).
6. Em modo simulação, `create_task` / `move_stage` / `move_pipeline` viram `simulated` sem efeito.
7. O opt-out entra no webhook **antes** de `resolve_automation_wait_from_inbox` e não derruba o
   webhook em nenhum caminho.

## Onde quero que você bata (pontos que me deixaram desconfortável)

- **Reenvio zero é conservador demais?** Um restart de 1 min da Evolution pausa todas as mensagens
  daquele tick com `delivery_unknown`, e **não existe função de retomada** no motor (antes desta
  entrega também não). Há um desenho seguro de "reenviar só quando a requisição comprovadamente
  nunca saiu" que caiba sem reescrever `lib/channels/evolution.ts`? Se sim, descreva; se não, diga
  que não e por quê.
- **`complete_automation_live` com `failed` e aresta "failed":** chamo `complete_automation_job`
  (`failed` → dead-letter) e depois `advance_automation_enrollment(..., 'failed')`. O cursor anda
  e o job do passo anterior fica em dead-letter. Alguma função existente (materialização,
  reconciliação) tropeça num job dead-letter de passo já ultrapassado?
- **`open_automation_wait_for_job`** fecha o job com status `sent` sem passar por
  `complete_automation_job` (que avançaria). Há outro lugar que assume "job `sent` ⇒ inscrição
  avançou"?
- **`defer_automation_jobs_before_claim`:** a aritmética da janela que cruza a meia-noite
  (`v_start > v_end`) e a conversão `(data + hora) at time zone tz`. Procure um horário/fuso em que
  o job seja adiado para o passado ou para daqui a 24 h a mais. Também: `for update of job skip
  locked` + `limit` dentro de um `for ... loop` com `update` no meio.
- **O executor reserva jobs de qualquer organização** (é o comportamento de worker). Há caminho
  em que um job "live" de cliente com a chave **desligada** chegue ao envio? (O adiamento roda
  antes do claim; o `prepare` recusa com `42501`; o executor trata `42501` como `failed` + pausa.)
- **Timeout com `Promise.race`:** a requisição continua em segundo plano; se ela entregar depois,
  a mensagem já está `unknown`. Vazamento de handle na função da Vercel? Alternativa com
  `AbortSignal` sem mudar a biblioteca?
- **`fail_automation_job_and_pause`** pausa **todas** as inscrições da conversa (é o que
  `pause_automation_enrollments_for_thread` faz). Quando um passo sem executor de uma automação
  pausa outra automação da mesma conversa, isso é bug ou é o comportamento certo?
- **Palavras de parada** (`lib/automations/optOut.ts`): falso positivo que cale um lead interessado?
  Falso negativo óbvio que devia estar na lista?
- **Idempotência da tarefa por marcador na nota** (`[automation_job:<uuid>]` + `like`). Feio de
  propósito; existe coisa melhor sem mudar o esquema de `tasks`?
- **Rota admin `/api/settings/automations-live`:** o `POST` grava silêncio noturno pelo cliente do
  usuário (RLS) e liga a chave por service_role depois de `requireAdminTenantContext`. Escalada
  possível? A leitura de saúde (`automation_scheduler_health`) por service_role expõe algo além do
  que um admin do tenant deveria ver (o estado é global, não por tenant)?
- **Rota interna `/api/internal/automations/execute`** sem limite de taxa: com o Bearer vazado, o
  atacante só consegue... o quê, exatamente? Liste o raio de dano.
- **`maxDuration = 60`** no tick: em Vercel Hobby isso é aceito no runtime Node atual? Se o
  executor (35 s) + Meta (3c) estourar, o que acontece com a saúde do tick?
- **Gates G1–G25** (`~/brains/cenoura-brain/06-References/SEGURANCA-GATES-VIBE-CODING.md`), em
  especial G13 (service_role), G11 (webhook), G20 (excessive agency: o executor move negócio e cria
  tarefa sozinho), G23 (migration destrutiva: nenhuma; confirme), G25 (defaults inseguros: a
  variável nasce `false`).

## Como provar localmente (Supabase local, projeto `crmia`, container `supabase_db_crmia`)

```bash
# Docker Desktop de pé; nunca `supabase db reset`
npx supabase migration up --local           # ledger deve terminar em 20260913050000
node scripts/test-local.mjs test/funilLiveExecutor.local.test.ts   # 12/12, Evolution falsa em HTTP na porta livre
npm run test:local > /tmp/suite.txt 2>&1    # esperado: 252 arquivos / 1236 testes, 0 falhas (~3,5 min)
```

Nada disto toca produção (`eqidsihasmwwamkaqfka`) nem teste (`zvwngsrflkicbbzfmrgy`). Não semeie
segredo em cofre nenhum: o 2d é procedimento, e depende do OK do Junior.

## O que NÃO fazer

- Não alterar código, migrations, testes ou docs além de `OPINIAO-LIVE.md`.
- Não rodar contra banco remoto. Não fazer push. Não abrir PR.
- Não reabrir decisões travadas: envio da Meta pelo CRM (3c), réguas do relatório comercial,
  origem 1º toque / campanha último toque, "nenhum Hermes recebe service_role", executor no tick
  como estágio antes do worker da VPS (SPEC §5). Pode discordar; registre como discordância, não
  como bloqueio.

## Formato da resposta (`docs/features/funil-construtor/OPINIAO-LIVE.md`)

1. **Bloqueantes** — algo que manda mensagem errada/duplicada, vaza credencial, permite acesso
   entre tenants ou corrompe estado do motor. Para cada um: `arquivo:linha`, o cenário concreto
   (entrada → estado errado), e a correção proposta em uma frase.
2. **Importantes** — bug real sem esses efeitos, ou dívida que vira bug em semanas.
3. **Sugestões** — simplificação, nome, teste que falta.
4. **Conferências feitas** — a lista dos 7 itens de "o que eu afirmo" com ✅/❌ e a evidência (o
   comando ou a consulta que você rodou). "Não conferi" é resposta válida; "conferi" sem evidência
   não é.
5. **Onde bati e não achou nada** — diga explicitamente, ponto por ponto da lista acima.

PT-BR, direto, `arquivo:linha` sempre. Se o orçamento acabar no meio, entregue o que tem com a
marca "parei aqui" em vez de resumir o resto de memória.
