# SPEC — Entrega LIVE: automações de funil e follow-ups mandando mensagem de verdade

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (modelo de trabalho desde 04/09: Claude constrói, inclusive motor; Codex
revisa pedaços fechados)
**Estado:** 2a, 2b, 2c, 2d construídas e provadas no Supabase local (ver IMPL-LOG-LIVE.md);
aguardam revisão pontual do Codex, semeadura dos segredos por ambiente e o OK do Junior para ligar
por cliente.

## 1. Decisão que originou

Junior, 13/09: *"3 coisas que precisam ficar prontas para ontem: IA de atendimento; automações de
funis e follow-ups; toda a parte de mapeamento de lead e rastreamento de conversão."* Esta é a
segunda. Veio depois da conversão (frente 3) e antes da IA (frente 1) pelo critério "o que se perde
por dia".

## 2. O que existia antes (mapa de 13/09)

O motor (Entregas A/B/C1/C2) era uma máquina de estados completa **em modo simulação**: publicação
imutável, inscrição, materialização dos jobs, reserva com lease, esperas por resposta (F5), pausa
por mensagem do lead (C2B), saúde do tick (C1A) e a chave `automation_live_enabled` guardada pelo
gate de saúde. Faltava o que faz o efeito:

- `prepare_automation_outbound` recusava qualquer versão "live" (`42501`), por desenho da F4;
- nada executava os jobs: o `delay` vencido não avançava, o `wait_for_event` não abria a espera,
  `create_task` / `move_stage` / `move_pipeline` não tinham executor nenhum;
- o tick não chamava executor (o ADR-MOTOR previa um worker na VPS que nunca foi construído);
- em produção o cofre do tick nunca foi semeado, logo a saúde é `request_failed` e a chave de live
  de qualquer cliente é recusada.

## 3. O que entra

### 2a — Caminho live do motor (migration `20260913040000` + `lib/automations/executor.ts`)

- **`prepare_automation_outbound`** passa a aceitar "live" quando a organização ligou o envio real
  **e** o contato não fez opt-out. Cabeçalho de segurança idêntico ao da F4 (DEFINER, `search_path`
  vazio, só service_role); diff linha a linha no IMPL-LOG.
- **`complete_automation_live`** grava o resultado do envio na mensagem, na tentativa e no job:
  `sent` avança pela aresta "success" e marca `lastOutboundAt` na conversa (a 3d lê isso para o
  marco "respondeu"); `failed` (4xx, número inválido, sem credencial) segue a aresta **"Falhou o
  envio"** quando o desenho tem uma, senão pausa a conversa com `delivery_failed`; `unknown` (5xx,
  rede, tempo esgotado) pausa com `delivery_unknown`. **Nunca retenta**: a biblioteca da Evolution
  não distingue "não saiu" de "saiu e a resposta se perdeu", e reenviar é o único erro
  irreversível para o lead.
- **`open_automation_wait_for_job`** abre a espera (F5) com o id da última mensagem enviada e fecha
  o job **sem avançar** — quem avança é a resposta (`answered`) ou o timeout.
- **`execute_automation_create_task`** (tarefa no CRM, data/hora no fuso do cliente, idempotente por
  job) e **`execute_automation_move_deal`** (mover etapa/funil, etapa validada no funil e na
  organização). Fora do modo live esses passos são marcados como simulados e avançam: o teste do
  construtor roda sobre negócio real e não pode criar tarefa nem mover etapa de verdade.
- **`fail_automation_job_and_pause`**: passo sem executor (`condition` legado, modo "test"),
  inscrição já pausada/encerrada, configuração inválida → job em dead-letter com motivo e conversa
  pausada (o mesmo "um humano precisa olhar" da C2B).
- **Executor** (`executeDueAutomationJobs`): adia (2c) → reserva até 10 jobs com lease de 120 s →
  executa cada um → repete até esvaziar ou estourar o orçamento de 35 s. Mensagem real: prepara a
  linha pendente → resolve credencial da conexão (nunca sai do servidor) → envia com tempo limite
  de 15 s → grava. Roda dentro do tick (`/api/internal/automations/tick`, `maxDuration = 60`) e
  pela rota `/api/internal/automations/execute` (Bearer do worker). Simulação também roda no tick
  agora: o teste do construtor deixa de parar no primeiro passo.
- **`claim_automation_jobs`** (migration `20260913050000`): achado ao provar — a reconciliação de
  tentativa aberta há mais de 24,8 dias estourava `integer` e derrubava a reserva de **todos** os
  jobs. Corrigido limitando a duração antes do cast; cabeçalho idêntico.

### 2b — Botão do envio real por cliente (`/api/settings/automations-live`)

GET: chave ligada/desligada, saúde do tick (com o motivo quando degradado), silêncio noturno e se o
executor deste ambiente está ligado. POST: liga/desliga pela função de sistema
`set_automation_live_enabled` (o gate de saúde recusa com `409` e a razão em português quando o
tick não está de pé); grava silêncio noturno e fuso (validados). Só admin do tenant; mesma origem.
**A tela** que chama esta rota entra junto com a configuração da IA (1a/1b): a rota já é o contrato.

### 2c — Silêncio noturno aplicado e opt-out

- **`defer_automation_jobs_before_claim`** roda antes da reserva: envio "live" que cairia dentro da
  janela do cliente (`automation_quiet_hours_*` no fuso `automation_timezone`; janela que cruza a
  meia-noite tratada) é adiado para o fim da janela; envio de organização com live desligado é
  adiado uma hora. Sem reserva, sem tentativa gasta. Atraso, espera e simulação não são afetados.
- **Opt-out**: `contacts.automation_opt_out_at` e `record_automation_opt_out` (marca o contato uma
  vez, pausa as inscrições da conversa com `opt_out:<motivo>`); o banco recusa (`42501`) qualquer
  envio real a contato com opt-out. **Quem decide o opt-out é a IA de atendimento (1a)**, ao
  interpretar na conversa que o lead não quer mais ("não tenho interesse", "já marquei com outro
  profissional"). *Decisão do Junior, 13/09: nunca existirá palavra de parada fixa nem texto do tipo
  "digite STOP"; a primeira versão com detector de palavra foi removida no mesmo dia.*

### 2d — Segredos do tick por ambiente

`.env.example` ganhou `AUTOMATION_TICK_SECRET`, `AUTOMATION_WORKER_SECRET` e
`AUTOMATION_LIVE_SENDS_ENABLED`; `OPERACAO-TICK.md` traz o procedimento (Vercel + cofre do Supabase
+ verificação + kill switches). **Nada foi executado em produção.**

## 4. Os três cadeados do envio real

1. `AUTOMATION_LIVE_SENDS_ENABLED=true` no ambiente (executor ligado);
2. `organization_settings.automation_live_enabled = true` no cliente (só com o tick saudável);
3. a automação publicada em modo **live**.

Sem qualquer um deles, nenhuma mensagem real sai. Com os três, ainda valem o silêncio noturno e o
opt-out do contato.

## 5. Divergência registrada do ADR-MOTOR

O ADR (18/07) decidiu que o envio real seria um **worker na VPS**, com o tick só materializando.
Razões: limite de duração da função na Vercel Hobby, backlog dentro de um lote curto, e a VPS já
prevista para mídia. **Nesta entrega o executor roda dentro do tick** (e por rota interna), porque:

- o worker da VPS não existe, e a prioridade é a automação andar nesta semana;
- com dezenas de mensagens por dia por cliente, 10 jobs por tick de 5 min (até ~35 s de orçamento)
  cobrem o volume atual da Jéssica com folga; a rota `/api/internal/automations/execute` permite um
  cron externo puxar de minuto em minuto se precisar;
- o módulo `executor.ts` é o worker: só muda quem chama. O ADR continua valendo como destino
  quando o volume ou a latência pedirem.

Custo aceito: enquanto for o tick, um pico de backlog leva mais ticks para escoar, e a mensagem
real disputa o orçamento com a Meta (3c), que roda depois e é pequena.

## 6. Decisões (revisadas pelo Junior em 13/09)

- **Envio nunca é retentado sozinho** (confirmado): falha e dúvida pausam a conversa para um humano.
  **Complemento exigido pelo Junior:** toda falha tem que ficar "na cara" no funil, numa caixa
  própria, mostrando a mensagem que falhou (para a pessoa conferir se chegou ou não) e um botão
  **Reenviar** (e "marcar como enviada" / "descartar"). Ver §7, primeiro item.
- Sem aresta "Falhou o envio" no desenho, a falha pausa; com a aresta, o funil segue por ela.
- **Opt-out é interpretado pela IA de atendimento, nunca por palavra fixa** (virado pelo Junior: a
  Cenoura não faz bot binário nem escreve "digite STOP" em follow-up).
- **Follow-up tem horário de envio configurável por automação** (virado pelo Junior): o funil define
  a partir de que hora (e até que hora) os follow-ups saem; **a IA de atendimento trabalha 24 h**,
  conversa com quem chega fora do horário e move os cards normalmente. Hoje a janela é por
  organização (`automation_quiet_hours_*`) e vale só para mensagem de automação, o que já respeita
  a regra; a configuração por automação entra no construtor (§7).
- Live desligado adia o envio de hora em hora (não descarta): ligar de volta retoma. "Desligar" é a
  chave por cliente da rota 2b (`automation_live_enabled`), usada na implantação (fica desligada até
  o primeiro ensaio) e em incidente (mensagem errada num funil, WhatsApp instável).

## 7. Fora de escopo (dívidas registradas, em ordem de prioridade)

- **Caixa de falhas de envio com "Reenviar"** (requisito do Junior, 13/09): lista das conversas
  pausadas por `delivery_failed` / `delivery_unknown` com a mensagem, o erro, a hora e os botões
  Reenviar · Marcar como enviada · Descartar. Exige no motor a retomada da inscrição (re-enfileirar
  o passo atual com nova chave de idempotência) e uma nova linha de mensagem para o reenvio.
- **Horário de envio dos follow-ups por automação** no construtor (hoje só por organização).
- **Retomar inscrição pausada** (é o motor da caixa acima): não existe função de retomada
  (nem antes desta entrega); hoje pausa é terminal na prática.
- Tela de "conversas pausadas pela automação" com o motivo (dado já está em
  `automation_enrollments.pause_reason`).
- `condition` legado: sem executor; o construtor usa "Dividir caminho" (switch), que já é resolvido
  na materialização.
- Modo "test" da publicação: sem semântica definida; tratado como "sem executor".
- Mídia nas mensagens da automação (C3 / N3): o executor manda só texto.
- Marcar "digitando" antes de enviar (1a).

## 8. Como vamos saber que está pronto

Com os segredos do tick semeados no ambiente de teste, o executor ligado e um cliente com a chave
ligada: uma automação publicada em live, ao inscrever um negócio, manda a primeira mensagem pelo
WhatsApp em até 5 min, abre a espera, e (a) se o lead responde, cria a tarefa e move a etapa; (b) se
não responde no prazo, manda o follow-up. Um "PARAR" do lead para tudo nessa conversa. Nada sai
entre 20:00 e 08:00 no fuso do cliente. Provado no local com Evolution simulada por HTTP e as
funções reais do motor (IMPL-LOG-LIVE.md).
