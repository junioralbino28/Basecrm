# Follow-up CENNO — 12 toques (cadência do Junior, 27/09)

> Cadência definida pelo Junior: manter a cutucada de 15 minutos que já existe
> (módulo `idleNudge`, fora desta régua) e, a partir do esfriamento, 12 mensagens
> TODAS DIFERENTES nos dias **1, 2, 3, 6, 8, 10, 12, 15, 18, 20, 22 e 25**.
> Estilo de referência: os roteiros de follow-up que ele escreveu para a Dra.
> Jéssica (amigável, consultivo, pergunta aberta, tratamento de objeção, sem
> insistência agressiva, porta sempre aberta).
>
> Contexto CENNO: lead veio de anúncio, falou com a Aurora no WhatsApp e não
> marcou a reunião com o especialista. Multi-nicho: nada de exemplo de vertical.

## Desenho da régua (motor existente, zero código novo nos passos)

- **Gatilho:** tag **"Follow-up"** aplicada ao negócio (categoria própria
  "Automação", cardinalidade única).
- **Estrutura:** `wait_for_event` (resposta do lead) com timeout em dias
  (semântica `next_local_day`, respeita o fuso) intercalado com `send_message`:
  - lead **respondeu** em qualquer ponto → a régua para (mecanismo de inbound
    já existente) e a Aurora reassume a conversa normalmente;
  - **timeout** → sai a mensagem do dia.
- **Esperas entre toques:** 1, 1, 1, 3, 2, 2, 2, 3, 3, 2, 2, 3 dias
  (= dias 1, 2, 3, 6, 8, 10, 12, 15, 18, 20, 22, 25).
- **Depois do 12º toque sem resposta (proposta):** mover o negócio para
  "Perdido" com motivo "Follow-up esgotado (25 dias)" — o card sai da frente
  do funil, e o histórico fica. *(Decisão dele pendente.)*
- **Nasce em modo SIMULAÇÃO** (`delivery_mode = simulation` + kill-switch de
  envio real desligado): ele vê a régua rodando sem nenhuma mensagem sair de
  verdade, e libera o envio real depois.

## Quem aplica a tag "Follow-up" (entrada na régua)

1. **Aurora**, quando o lead ADIA explicitamente na conversa ("vou pensar",
   "depois te chamo", "semana que vem eu vejo") — instrução nova no prompt +
   `suggestedTags`, mesmo mecanismo já publicado.
2. **Manual**: ele ou a equipe aplicam a tag no card a qualquer momento.
3. **Gap declarado (v2):** o lead que some SEM dizer nada só entra hoje por
   uma dessas duas vias. A automação "silêncio de X horas aplica a tag
   sozinho" é um passo pequeno no tick (configurável por conexão, default
   desligado) — proposto como peça seguinte, não bloqueia esta régua.

## As 12 mensagens (Aurora, WhatsApp)

> `{{nome}}` = nome do lead quando conhecido. Regras seguidas: sem travessão,
> sem promessa de resultado, sem preço de serviço, sem citar vertical de
> exemplo, emoji leve como nos roteiros dele.

**D+1 — retomada leve**
> Oi {{nome}}, tudo bem? Aqui é a Aurora, da CENNO HUB 😊
> A gente estava conversando sobre o atendimento do seu negócio e você acabou
> ficando na correria, imagino.
> Quer retomar de onde paramos?

**D+2 — o que você leva da reunião**
> {{nome}}, só pra deixar claro o que você ganha naquela conversa com o nosso
> especialista: ele olha como está o seu atendimento e o seu anúncio hoje e te
> fala o que faria diferente, na prática.
> É uma conversa de 40 minutos, sem compromisso. Quer que eu veja um horário?

**D+3 — pergunta binária (fácil de responder)**
> {{nome}}, me ajuda só com uma coisa: o assunto ainda te interessa e o momento
> que está corrido, ou você preferiu deixar essa ideia de lado?
> Qualquer uma das respostas está ótima, é só pra eu te atender do jeito certo 😊

**D+6 — a dor que trouxe ele até aqui**
> Oi {{nome}}! Lembrei de você aqui.
> Normalmente quem chega até a gente pelo anúncio está sentindo na pele: lead
> que chama e ninguém responde a tempo, ou anúncio rodando sem virar cliente.
> Se esse ainda é o seu caso, vale muito a pena a gente conversar. Topa?

**D+8 — custo de deixar como está**
> {{nome}}, uma coisa que a gente vê direto: o problema de atendimento não
> espera. Cada semana que passa é lead chamando e esfriando do mesmo jeito.
> Se quiser, eu marco um papo rápido com o especialista pra você pelo menos
> saber o tamanho do ajuste. Que dia fica melhor pra você?

**D+10 — tirar dúvida sem compromisso**
> Oi {{nome}}, tudo certo por aí?
> Se ficou alguma dúvida sobre como funciona (o atendimento com IA, o anúncio,
> o investimento), pode mandar aqui mesmo que eu te explico sem enrolação.
> Às vezes é mais simples do que parece 😊

**D+12 — objeção de tempo**
> {{nome}}, sei que a rotina de quem toca o próprio negócio é corrida demais.
> Por isso a conversa com o especialista é direto ao ponto: 40 minutos, online,
> no horário que encaixar pro seu lado.
> Se eu achar um horário bem cedo ou no fim do dia, funciona melhor pra você?

**D+15 — "será que serve pro meu caso?"**
> Oi {{nome}}! Uma dúvida comum de quem fala com a gente: "será que isso
> funciona pro MEU tipo de negócio?"
> É exatamente isso que a reunião responde: o especialista olha o seu caso
> específico e te fala com sinceridade o que dá e o que não dá pra fazer.
> Quer tirar essa prova?

**D+18 — agenda da semana (escassez leve)**
> {{nome}}, essa semana abriram alguns horários na agenda do nosso especialista
> e lembrei de você.
> Se quiser aproveitar, eu consigo te encaixar. Prefere de manhã ou de tarde?

**D+20 — pergunta direta**
> Oi {{nome}}, vou ser direta com você 😊
> Ainda faz sentido pra você melhorar o atendimento e os anúncios do seu
> negócio, ou esse assunto saiu da sua lista por agora?
> Me falando, eu paro de te chamar ou a gente marca de vez.

**D+22 — penúltimo toque, porta aberta**
> {{nome}}, não quero ser insistente, então esse é um dos meus últimos toques
> por aqui.
> Se o momento não é agora, tudo bem de verdade. Só não deixa de resolver isso
> em algum momento, porque atendimento parado é venda que escapa todo dia.
> Se quiser retomar, é só me responder aqui.

**D+25 — encerramento elegante (estilo do roteiro dele)**
> {{nome}}, vou deixar registrado aqui que o momento não era agora, sem
> problema nenhum 😊
> Qualquer hora que você sentir que é a hora de arrumar o atendimento e os
> anúncios do seu negócio, me chama nesse mesmo número que eu te ajudo.
> Sucesso por aí, e obrigada pela atenção!

## Prova antes de ligar

1. Régua montada no banco de TESTE, publicada em modo simulação.
2. Ensaio: tag aplicada num negócio fixture → 1º wait arma; simular timeout →
   mensagem 1 SIMULADA registrada; simular resposta do lead → régua pausa.
3. Só depois do OK dele nas mensagens e no ensaio: montar em produção
   (simulação primeiro; envio real só com o "pode" explícito).
