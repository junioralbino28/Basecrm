# SPEC — Agendamento automático da Consultoria pós-pagamento (Mercado Pago)

> Decisão do Junior (27/09/2026): *"já que a Aurora envia o link e já vê o horário de
> preferência, ela pode marcar na agenda após a confirmação, nem precisa passar por mim."*
> Aprovada a escrita desta SPEC no mesmo dia ("pode seguir"). Implementação só depois do
> aval dele sobre este documento. **Nasce DESLIGADA por padrão em toda conexão.**

## Objetivo

Quando um lead reprovado no gate topa a Consultoria de Diagnóstico (comunicada como **3x de
R$210** — decisão de 27/09: a oferta ancora na parcela; o à vista de R$597 só sai a pedido) e paga,
o sistema — sem intervenção humana: identifica QUEM pagou, move o negócio para "Paga" no funil
Consultoria de Diagnóstico, marca a consultoria de **60 minutos** na agenda dentro da
preferência de dia/período que a Aurora combinou, cria o evento no Google (se conectado) e a
Aurora confirma a hora na conversa. Só chama o Junior quando não há horário livre na
preferência (ou a preferência não existe).

## Medições que fundamentam o desenho (27/09)

- A agenda NÃO tem granularidade de 10 min (aquilo é ideia futura, nunca implementada):
  `meetingAvailability.ts` fixa `MEETING_TARGET_DURATION_MINUTES = 40` e
  `MEETING_START_INTERVAL_MINUTES = 60`, e o conflito já bloqueia a janela de 60 min inteira
  entre inícios. **Consultoria de 60 min encaixa exatamente na janela que o motor já protege.**
- Link fixo não identifica o pagador: o desenho exige **link individual por conversa**
  (`external_reference` = thread) — é a única amarração confiável pagamento→lead.
- A preferência de dia/período já é coletada pelo prompt vigente (`requestedScheduleText`
  no ramo consultoria, commit `55ca4c2`).

## As 3 peças

### 1. Link individual por lead

- Campo novo no structured output da Aurora: `consultationLinkRequested: boolean`
  (true SÓ no turno em que o lead reprovado topa receber o link).
- O prompt DEIXA de carregar os links fixos quando o interruptor da automação estiver ligado:
  o modelo sinaliza, e o **servidor** cria as duas preferences na hora
  (`external_reference = <threadId>`; à vista 597 e 3x 630, mesmos payloads de hoje) e
  **appenda** a parte final da mensagem com os dois links — o dispatcher já envia multipartes.
- Falha na criação do link → mensagem sai sem os links + handoff `high_intent`
  (o Junior manda o link fixo à mão; os links fixos atuais viram fallback documentado).

### 2. Webhook do Mercado Pago

- Rota nova `POST /api/public/payments/mercadopago/webhook`.
- **Travas, todas obrigatórias:**
  - assinatura `x-signature` validada com o secret do webhook (configurado no painel do app
    "Cenoura CRM Pagamentos"; secret vai para env/cofre, nunca no repo);
  - o corpo da notificação é gatilho, NUNCA fonte: os dados vêm de
    `GET /v1/payments/{id}` com o token do cofre;
  - **idempotência por `payment_id`**: o MP repete notificações; a segunda em diante é
    no-op (registro do id processado em metadata do thread ou tabela própria);
  - valor conferido contra a preference (597 ou 630) e status `approved`;
  - `external_reference` sem thread correspondente → loga e ignora (nunca 500, senão o MP
    re-tenta para sempre).
- Pagamento aprovado e amarrado → move (ou cria) o negócio no funil
  `consultoria-diagnostico` para a etapa **Paga**.

### 3. Agendamento + confirmação

- **Emenda do teste ao vivo (27/09, conversa "Rayanne"):** a preferência costuma chegar em
  turno PÓS-handoff (encerramento), que hoje não persiste `requestedScheduleText` — no teste,
  "à noite" ficou só no texto. A automação exige: **persistir a preferência na metadata da
  thread sempre que vier no ramo consultoria, inclusive em closing reply** (mesma mecânica do
  `gateCapacidade`, que já grava pós-handoff).
- Parser da preferência combinada (`requestedScheduleText`, ex.: "quinta de manhã") → janela
  de busca; busca de slot livre de **60 min** reutilizando o motor atual com **duração
  parametrizada** (o default 40 da reunião comercial NÃO muda — parâmetro explícito só neste
  fluxo);
- slot achado → reserva pela RPC existente + evento Google (mesmo caminho da reunião) +
  mensagem da Aurora na conversa: "Pagamento confirmado! Sua consultoria ficou {dia} às
  {hora}..." (enviada pela conexão real — mensagem automática legítima do fluxo);
- **sem slot na preferência, ou sem preferência gravada** → etapa Paga + handoff para o
  Junior com o motivo ("pagou, sem horário na preferência") — único caso humano;
- sábado continua exigindo confirmação humana (regra vigente da agenda).

## Interruptor e escopo multi-cliente

- Campo por conexão `consultationAutoScheduling` (default **false** para TODAS — padrão do
  produto preservado; nada de ramo por cliente). A CENNO liga primeiro; cliente depois, se
  fizer sentido — mesma ordem da IA de atendimento.
- Com o interruptor desligado, TUDO fica byte a byte como hoje (links fixos no prompt,
  confirmação manual), travado por teste.

## Fora de escopo (v1 da automação)

Reembolso/estorno, cupom, expiração/renovação de link, mudança de preço dinâmica,
remarcação automática da consultoria, webhook de outros gateways.

## Prova

1. Unit: assinatura inválida rejeitada; notificação repetida é no-op; valor divergente
   alerta e não move; parser de preferência (manhã/tarde/dia da semana/ambíguo).
2. Integração (fake supabase): approved → deal em Paga + reserva 60 min + mensagem; sem
   slot → Paga + handoff.
3. Prévia (banco de teste): notificação SIMULADA assinada de ponta a ponta; ensaio com
   pagamento Pix real (e estorno) fica a critério do Junior.
4. Suíte completa + tsc lidos em comando separado; produção só com o "pode".
