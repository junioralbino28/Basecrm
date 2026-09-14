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
| Opt-out (puro) | ~~`lib/automations/optOut.ts`~~ | **Removido em 13/09 por decisão do Junior**: nunca haverá palavra de parada fixa; a IA de atendimento (1a) interpreta o desinteresse e chama `record_automation_opt_out`. A função e o gate no banco ficam |
| Tick | `app/api/internal/automations/tick/route.ts` | chama o executor depois de materializar e antes da Meta, em `try/catch`; `maxDuration = 60` |
| Rota interna | `app/api/internal/automations/execute/route.ts` | executor sob demanda com o Bearer do worker (cron externo / VPS) |
| Rota admin (2b) | `app/api/settings/automations-live/route.ts` | GET estado + saúde; POST liga/desliga (`set_automation_live_enabled`, 409 com motivo quando o tick não está de pé), silêncio noturno e fuso |
| Webhook (2c) | `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` | ~~opt-out por palavra em inbound~~ **removido em 13/09** (decisão do Junior); só um comentário aponta para a IA (1a) |
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
| **Depois do parecer do Codex** — `test/funilLiveExecutor.local.test.ts` | **16/16**: os 12 anteriores (4xx agora com **1 POST**, formato único) + canal `disconnected` recusado no banco sem POST e inscrição pausada `canal_inativo` · canal sem `webhookSecret` recusado · **pausa concorrente**: reserva → pausa → `execute_automation_create_task` responde `55000` e nenhuma tarefa nasce · opt-out com conversa de outra organização → `23503` |
| `lib/channels/evolutionSingleFormat.test.ts` (unitário) | 3/3: `singleFormat` = um POST no formato configurado, sem cair para os outros em 4xx; sem a opção continuam 4 (manual/IA inalterado); `AbortSignal` chega ao fetch e o aborto vira entrega desconhecida |
| Migration `20260913070000` no local | ledger em `20260913070000`; catálogo: 5/5 funções DEFINER, `search_path=""`, anon/auth sem EXECUTE, service_role com; `prepare_automation_outbound` contém o gate `is distinct from 'connected'` |
| `tsc --noEmit` · ESLint `--max-warnings 0` nos arquivos tocados | limpos (antes e depois do parecer) |
| Suíte completa `npm run test:local` (entrega) | **252 arquivos / 1.236 testes, zero falhas** (208 s). Eram 249 / 1.206: os +3 / +30 são exatamente os testes novos desta entrega. Saída em arquivo, lida em comando separado antes do commit |
| Suíte completa (depois do parecer) | **253 arquivos / 1.247 testes: 1 falha**, e ela era texto: o estático da 3c (`conversaoEnvioMetaRotas.test.ts`) procurava `batchLimit: 50` na chamada da Meta no tick, que virou 20 (I4). Corrigido o teste e rerodado com os do tick e da entrega live: 3 arquivos / 23 testes verdes. Nenhuma outra alteração depois da suíte. Saída em arquivo, lida em comando separado antes do commit |

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
12. ~~A IA continua respondendo a contato com opt-out~~ — item superado: o opt-out por palavra foi
    removido (decisão do Junior, 13/09); quem marca opt-out passa a ser a própria IA (1a).
13. **Achado na suíte completa (13/09, noite):** outros arquivos da suíte (`funilOutbox`,
    `funilPublication`, `funilScheduler`, `funilWaits`...) apagam o usuário mas **não a organização**;
    cada rodada deixa ~16 organizações "Funil F2 A / F3" com jobs pendentes ou com vencimento
    próximo. O executor é global e os reservou no meio do meu teste (`claimed: 3`), derrubando 4
    casos que passam sozinhos. Correção honesta: o resumo do executor ganhou `jobs[]` (job,
    organização, tipo, desfecho: vai para o log do tick) e o teste conta só os da própria
    organização. O lixo em si é dívida dos testes antigos (fora deste escopo): registrado.

## 5. Resposta ao parecer do Codex (`OPINIAO-LIVE.md`, 13/09)

Cada ponto foi conferido no código antes de aceitar. "Corrigido" = no commit de resposta ao parecer
(migration `20260913070000` + executor/rota/testes); provas na seção 3 atualizada abaixo.

| Ponto | Veredito | O que foi feito |
|---|---|---|
| B1 opt-out forjado via webhook legado | **Sem objeto + gate novo** | O detector de palavra já tinha sido removido (decisão do Junior). O fato subjacente é real e pré-existente: conexão sem `webhookSecret` aceita qualquer POST. Envio real passa a exigir canal com segredo configurado (`prepare_automation_outbound`); a migração de conexões legadas para segredo obrigatório fica registrada como dívida (SPEC §7) |
| B2 opt-out perdido em erro transitório | **Sem objeto, registrado para 1a** | Sem detector, não há caminho. Quando a IA marcar opt-out (1a), a marcação precisa ser durável junto da mensagem, com reparo no caminho de duplicata; anotado na SPEC da IA |
| B3 quatro POSTs em 4xx | **Corrigido** | `sendEvolutionTextMessage` ganhou `singleFormat` (um POST, sem cair para outros formatos) e `signal`; o executor usa formato único: o configurado na conexão, senão o último que funcionou no canal (`delivery_attempt`), senão `number_text`. Teste local: 4xx = 1 POST; unitário novo `evolutionSingleFormat.test.ts`. Caminho manual/IA inalterado |
| B4 canal inativo | **Corrigido** | `prepare_automation_outbound` exige `status = 'connected'` (e segredo de webhook, B1); o executor relê o status imediatamente antes do POST. Testes locais: canal `disconnected` e canal sem segredo → recusa sem POST, inscrição pausada `canal_inativo` |
| B5 credencial em erro persistido | **Corrigido** | `redactChannelSecrets(error, [apiKey, apiUrl])` antes de gravar `delivery_error`/metadata |
| B6 efeito depois de pausa concorrente | **Corrigido** | `execute_automation_create_task` / `execute_automation_move_deal` travam a inscrição (`for update`) e exigem `active` + cursor no passo antes de qualquer efeito; o executor trata o `55000` fechando o job como `failed` sem pausar de novo. Teste local reproduz a corrida (reserva → pausa → RPC recusa, tarefa não nasce) |
| I1 pausa da conversa inteira por erro de uma automação | **Corrigido** | `fail_automation_job_and_pause` pausa só a inscrição do job; pausa da conversa fica para inbound, opt-out e entrega ambígua |
| I2 POST admin parcial | **Corrigido** | Chave primeiro (pode ser recusada; nada gravado); silêncio depois; falha tardia devolve `applied` |
| I3 Bearer único com raio global | **Registrado como dívida** | Não existe limitador de taxa no projeto; separar segredos/escopos e limitar taxa é trabalho próprio (SPEC §7). Os máximos já são fixados no servidor pelo zod |
| I4 orçamento sem margem | **Corrigido** | Executor com prazo absoluto (30 s no tick), não inicia envio sem `timeout + 2 s` de margem (job fica reservado e volta), `AbortController` chega ao fetch; Meta com lote 20 depois |
| I5 teste dependente do estado global | **Corrigido antes do parecer** | Resumo por job + contagem por organização (commit `b36511a`) |
| I6 `CANCELAR` falso positivo | **Sem objeto** | Detector removido |
| S1 amarrar conversa ao contato/organização | **Corrigido** | `record_automation_opt_out` recusa (`23503`) conversa de outra organização ou contato; teste local |
| S2 testes de comportamento em vez de string | **Parcial** | Unitário do formato único/aborto e três casos locais novos (canal off, sem segredo, pausa concorrente). Testes de rota A→B para a rota admin continuam dívida |
| S3 marcador da tarefa | **Mantido** | Como sugerido |
| S4 sem retry de `unknown`; reconciliação humana | **Concorda** | É a caixa de falhas com Reenviar (requisito do Junior, SPEC §7) |
| G12 `npm audit` 18 vulnerabilidades | **Dívida global** | Fora do diff; registrada para tratamento à parte |

## 6. Próximos passos

- **Codex:** revisão pontual (2 migrations + executor + 3 rotas + webhook + fixture + 4 testes).
- **Junior:** OK para semear os segredos do tick em **teste** (`OPERACAO-TICK.md`), depois ligar o
  executor lá, publicar uma automação de teste em live e ver a primeira mensagem sair.
- **Frente 1 (IA):** 1a endurecimento (rate limit, prompt genérico, "digitando", auditoria) e 1b
  base de conhecimento; a tela do botão de live entra junto.
