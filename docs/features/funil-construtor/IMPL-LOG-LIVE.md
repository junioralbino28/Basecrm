# IMPL-LOG — Entrega LIVE (2a caminho live · 2b botão por cliente · 2c silêncio + opt-out · 2d segredos)

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (Claude constrói, inclusive motor; Codex revisa este pedaço fechado)
**Estado:** implementado, provado no Supabase local com Evolution simulada por HTTP, **aguardando
revisão pontual do Codex**, semeadura dos segredos por ambiente (2d) e OK do Junior para ligar por
cliente
**SPEC:** `SPEC-ENTREGA-LIVE.md` nesta pasta

## 1. O que foi construído

| Peça | Arquivo | O que faz |
|---|---|---|
| Migration 2a/2c | `supabase/migrations/20260913040000_funil_live_envio_real.sql` | `contacts.automation_opt_out_at`; `prepare_automation_outbound` aceita live (chave do cliente + sem opt-out); `complete_automation_live`; `open_automation_wait_for_job`; `execute_automation_create_task`; `execute_automation_move_deal`; `fail_automation_job_and_pause`; `defer_automation_jobs_before_claim`; `record_automation_opt_out`. Todas DEFINER, `search_path` vazio, EXECUTE só do service_role |
| Migration (achado) | `supabase/migrations/20260913050000_funil_claim_sem_overflow.sql` | `claim_automation_jobs` limita a duração da tentativa antes do cast para `integer` (cabeçalho idêntico ao da F4) |
| Executor | `lib/automations/executor.ts` | `executeDueAutomationJobs`: adia → reserva (10, lease 120 s) → executa por tipo → repete até esvaziar ou 35 s. Mensagem real com tempo limite de 15 s; `sent`/`failed`/`unknown` terminais; simulação também roda |
| Opt-out (puro) | `lib/automations/optOut.ts` | `detectAutomationOptOut`: mensagem inteira = palavra de parada (sem acento/pontuação), até 48 caracteres |
| Tick | `app/api/internal/automations/tick/route.ts` | chama o executor depois de materializar e antes da Meta, em `try/catch`; `maxDuration = 60` |
| Rota interna | `app/api/internal/automations/execute/route.ts` | executor sob demanda com o Bearer do worker (cron externo / VPS) |
| Rota admin (2b) | `app/api/settings/automations-live/route.ts` | GET estado + saúde; POST liga/desliga (`set_automation_live_enabled`, 409 com motivo quando o tick não está de pé), silêncio noturno e fuso |
| Webhook (2c) | `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` | opt-out em inbound antes de correlacionar a espera; cala a IA nessa mensagem; `automation_opt_out` na resposta |
| Ambiente (2d) | `.env.example`, `OPERACAO-TICK.md` | três variáveis; procedimento Vercel + cofre + verificação + kill switches |
| Fixture de teste | `test/helpers/funilTestFixture.ts` | `deliveryMode`, `extraStageNames`, contexto com `boardId`/`stageIdsByName`; **limpa a organização se a criação falhar** (era assim que o banco local acumulou 348 organizações órfãs de julho) |

**Não construído, de propósito:** tela do botão (entra com a configuração da IA); retomada de
inscrição pausada (não existia antes); tela de conversas pausadas; mídia na automação; "digitando"
antes de enviar; palavras de parada por cliente.

## 2. Diffs de cabeçalho de segurança (funções substituídas)

| Função | Diff linha a linha contra a versão anterior |
|---|---|
| `prepare_automation_outbound` (F4 → 2a) | `+ v_mode text;` e o bloco do modo (`if v_mode = 'live' ... elsif v_mode is distinct from 'simulation'`) no lugar de `if deliveryMode <> 'simulation' then raise`. Cabeçalho (DEFINER, `search_path=''`, retorno) e todo o resto idênticos |
| `claim_automation_jobs` (F4 → 2a) | só a expressão de `duration_ms`: `least(2147483647::double precision, greatest(0, floor(...)))::integer`. Resto idêntico |

ACL conferida **no catálogo** (`pg_proc` + `has_function_privilege`): as 9 funções novas/alteradas
com `definer=true`, `config=search_path=""`, `anon=false auth=false service=true`.

## 3. Provas

| Prova | Resultado |
|---|---|
| Migrations aplicadas no Supabase local | ledger em `20260913050000`; a 2a reaplicada por `psql` depois do ajuste de camelCase (idempotente: `create or replace`, `if not exists`) |
| `lib/automations/optOut.test.ts` (unitário) | 4/4: palavra sozinha com acento/pontuação/emoji; nunca no meio de frase ("quero parar de fumar", "para quando tem horário?"); texto longo ignorado |
| `test/funilLiveMigration.test.ts` (estático) | 13/13: cabeçalho e gates do prepare; sent/failed/unknown; espera sem avançar; idempotência de tarefa; adiar antes de reservar; opt-out; ACL de todas; claim sem overflow; encaixe no tick (ordem materializar → executar → Meta, `try/catch`); rota interna sem tenant no corpo; rota admin (admin, mesma origem, 409, RLS); webhook (antes da correlação, sem `return`, cala a IA) |
| `test/automationTickRoute.test.ts` (rota do tick) | 2/2: sequência `... materialize → defer → claim → claim_conversion_events → complete`; com a chave de ambiente desligada não adia nem reserva e o tick segue |
| **`test/funilLiveExecutor.local.test.ts`** (funções reais + Evolution falsa em HTTP) | **12/12**: executor desligado por ambiente não reserva · live desligado adia 1 h sem gastar tentativa · silêncio noturno adia até o fim da janela no fuso (UTC no teste) · **mensagem real**: POST em `/message/sendText/inst-live` com `apikey`, `{number, text: "Olá Maria"}`, mensagem `sent` com `provider_message_id`, `lastOutboundAt` na conversa, inscrição avança; espera aberta citando `EVO-1`, expira em ~1 min, inscrição `waiting`, tick não cria job enquanto espera · **resposta do lead** fecha a espera, tarefa criada (título, contato, hora, marcador do job), negócio movido para "Agendado", funil `done`, follow-up do timeout nunca nasce · 4xx sem aresta: 4 POSTs (formatos da biblioteca), mensagem `failed` com o motivo da Evolution, job dead-letter, conversa pausada `delivery_failed` · 4xx **com** aresta "failed": o funil segue por ela e termina · 5xx: `unknown`, pausa `delivery_unknown`, **segunda execução não reenvia** · sem resposta em 400 ms: `unknown` "sem resposta da Evolution" · opt-out direto no contato: o banco recusa (`42501`), job dead-letter sem POST, pausa `opt_out` · `record_automation_opt_out`: marca uma vez, pausa 1, repetição devolve `already` e não altera a data; job pendente morre sem enviar · anônimo recebe `42501` nas três funções |
| `tsc --noEmit` · ESLint `--max-warnings 0` nos arquivos tocados | limpos |
| Suíte completa `npm run test:local` | **252 arquivos / 1.236 testes, zero falhas** (208 s). Eram 249 / 1.206: os +3 / +30 são exatamente os testes novos desta entrega (unitário 4, estático 13, local 12, +1 no tick). Saída em arquivo, lida em comando separado antes do commit |

## 4. Auto-revisão adversarial (escrita antes de declarar pronto)

1. **Nunca retentar é conservador demais para uma queda curta da Evolution.** Um restart de 1 min
   às 10:00 pausa (com `delivery_unknown`) todas as mensagens daquele tick. Aceito porque o único
   erro irreversível é mandar duas vezes, e porque a biblioteca classifica falha de conexão como
   "desconhecida" (não sabe se o POST saiu). Caminho para relaxar: a biblioteca distinguir
   "requisição nunca saiu" e o executor marcar a mensagem como segura para reenvio.
2. **Pausa é terminal na prática.** Não existe retomada no motor (antes desta entrega também não).
   `delivery_failed`, `delivery_unknown`, `opt_out:*`, `inscricao_*` ficam em
   `automation_enrollments.pause_reason` esperando uma tela e uma função de retomada que
   re-enfileire o passo atual. Registrado na SPEC como dívida.
3. **O executor reserva jobs de qualquer organização** (é um worker). Um job "live" de cliente com
   a chave desligada é adiado antes da reserva; se a chave for desligada entre o adiamento e o
   `prepare`, o banco recusa e a conversa é pausada com `live_desligado` (raro; registrado).
4. **Lote de 10 por tick de 5 min ≈ 120 mensagens/h por ambiente**, com até ~35 s de orçamento
   (rodadas de 10 até esvaziar). Cobre o volume atual; a rota interna permite um cron por minuto
   (≈ 600/h) sem mudar código. O worker da VPS do ADR continua sendo o destino em escala.
5. **Timeout de 15 s por mensagem** com `Promise.race`: a requisição continua em segundo plano; se
   ela entregar depois, a mensagem já foi marcada `unknown` (correto: era desconhecido) e não há
   reenvio.
6. **Silêncio noturno usa a hora do banco convertida para o fuso do cliente.** Fuso inválido cai
   para `America/Sao_Paulo` em vez de derrubar o adiamento. A rota 2b valida o fuso na entrada.
7. **Palavras de parada fixas e mensagem inteira.** "para" sozinho fica de fora (preposição
   comum). Falso negativo custa uma mensagem a mais; falso positivo calaria um lead interessado.
8. **Tarefa idempotente por marcador na nota** (`[automation_job:<uuid>]`): sem coluna própria na
   tabela `tasks`. Feio, mas honesto; se `tasks` ganhar `metadata`, migra.
9. **Em simulação, tarefa e movimentação viram "simulated"** — o teste do construtor usa negócio e
   conversa reais. Atraso e espera rodam em qualquer modo (só estado do motor).
10. **Overflow do `claim` era bomba-relógio em produção**: um job abandonado por 25 dias derrubaria
    a reserva de todos, para sempre, com `integer out of range` a cada tick. Achado só porque o
    banco local tinha resíduo de julho. Corrigido em migration própria.
11. **Diff de cabeçalho** feito para as duas funções substituídas (seção 2). ACL conferida no
    catálogo, não na migration.
12. **A IA continua respondendo a contato com opt-out** em mensagens seguintes; só a mensagem de
    parada é calada. Opt-out é de automação/marketing, não de atendimento. Se o Junior quiser
    calar a IA também, é uma linha no webhook (1a).

## 5. Próximos passos

- **Codex:** revisão pontual (2 migrations + executor + 3 rotas + webhook + fixture + 4 testes).
- **Junior:** OK para semear os segredos do tick em **teste** (`OPERACAO-TICK.md`), depois ligar o
  executor lá, publicar uma automação de teste em live e ver a primeira mensagem sair.
- **Frente 1 (IA):** 1a endurecimento (rate limit, prompt genérico, "digitando", auditoria) e 1b
  base de conhecimento; a tela do botão de live entra junto.
