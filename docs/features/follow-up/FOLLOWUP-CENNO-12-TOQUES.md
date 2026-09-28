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

## Desenho revisado (modelo Kommo do Junior, 27/09 ~22h)

> Sugestão dele, adotada: *"era um segundo funil só de follow-up, cada dia era
> uma etapa (12 etapas), todo dia de manhã enviava as mensagens intercalando o
> horário entre dias, com envio unitário aleatório (1, 2, 5 minutos), e às
> 23:59 quem não respondeu avançava para o próximo follow-up."*

- **Funil próprio "Follow-up CENNO" com 12 etapas** (Dia 1, Dia 2, Dia 3,
  Dia 6, ... Dia 25): o quadro MOSTRA quantos leads estão em cada dia do
  follow-up — visibilidade operacional que a régua invisível não dá.
- **Gatilho:** tag **"Follow-up"** aplicada ao negócio → `move_pipeline` para
  o funil de follow-up (Dia 1).
- **Virada do dia:** `wait_for_event` com timeout `next_local_day` (o motor já
  tem a semântica "virou o dia local") → **timeout = não respondeu** → envia a
  mensagem do dia e `move_stage` para a etapa seguinte. Dias sem toque (4, 5,
  7...) são só espera: o card fica parado na etapa do próximo toque.
- **Lead respondeu em qualquer ponto** → a régua para sozinha (inbound pause
  existente), e o **upgrade vs Kommo**: a Aurora reassume a conversa na hora,
  além de `move_pipeline` de volta para o funil CASA ("Respondeu").
- **Janela de envio pela manhã:** o motor JÁ tem `quietHoursStart/End` por
  automação com fuso — configura-se o silêncio para tudo fora da janela da
  manhã, e as mensagens vencidas na virada do dia só saem dentro dela.
- **Envio unitário aleatório (anti-ban, sem API oficial): CONSTRUÍDO E PROVADO
  (28/09).** Migration `20260928010000_automation_send_spacing`: fila por
  conexão dentro do gate de envio (`defer_automation_jobs_before_claim`), com
  configuração `channel_connections.config.automationSendSpacing =
  {"minSeconds": 60, "maxSeconds": 300}` — por conexão, para todos os
  clientes, padrão DESLIGADO (sem config o comportamento fica byte a byte como
  hoje, contraprovado). Prova no banco de teste: 3 envios da mesma conexão
  saíram 08:00 local, +4m46s e +4m30s. As respostas da Aurora na conversa NÃO
  passam por aí e continuam imediatas. O horário variando entre dias sai de
  graça: janela + sorteio por lead produzem manhãs diferentes a cada dia.
- **Depois do 12º toque sem resposta (proposta):** mover para "Perdido" com
  motivo "Follow-up esgotado (25 dias)". *(Decisão dele pendente.)*
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

> `{{nome}}` = nome do lead quando conhecido. Na montagem da régua vira o
> placeholder NATIVO do motor `{{contato.primeiro_nome | default:"..."}}`
> (já existe: contexto com contato/negócio/responsável/organização e fallback
> obrigatório — zero código novo). Regras seguidas: sem travessão, sem
> promessa de resultado, sem preço de serviço, sem citar vertical de exemplo,
> emoji leve como nos roteiros dele.

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

**D+22 — penúltimo toque, provocativo (ajuste dele, 28/09: deixar entendido
"pelo visto não tem interesse em melhorar seu negócio", com outras palavras)**
> {{nome}}, vou ser sincera com você, com todo carinho 😊
> Tanta mensagem sem resposta já me faz pensar que melhorar o atendimento e os
> anúncios não é prioridade pro seu negócio agora.
> Se eu estiver enganada, me responde essa aqui e a gente resolve isso de vez.

**D+25 — encerramento elegante (estilo do roteiro dele)**
> {{nome}}, vou deixar registrado aqui que o momento não era agora, sem
> problema nenhum 😊
> Qualquer hora que você sentir que é a hora de arrumar o atendimento e os
> anúncios do seu negócio, me chama nesse mesmo número que eu te ajudo.
> Sucesso por aí, e obrigada pela atenção!

## Métrica: recuperados por etapa (pedido dele, 28/09)

> *"Quero saber exatamente quantos leads eu recupero em cada etapa do follow-up."*

O desenho materializa a métrica sem tabela nova: **cada dia tem um passo
próprio de "recuperado"** (o `move_pipeline` que devolve o card ao funil de
vendas quando o lead responde naquele dia). Contar recuperação por etapa =
contar execuções desses passos:

```sql
-- Recuperados por dia do follow-up (status 'done' no live; 'simulated' no ensaio)
select s.idx as posicao, count(*) as recuperados
from automation_jobs j
join automation_versions v on v.id = j.version_id
cross join lateral jsonb_array_elements(v.definition->'steps') with ordinality s(step, idx)
where v.automation_id = '<id da automacao Follow-up>'
  and (s.step->>'stepKey') = j.step_key::text
  and s.step->>'type' = 'move_pipeline'
  and s.step->'config'->>'boardId' <> '<id do funil de follow-up>'
  and j.status in ('done', 'simulated')
group by s.idx order by s.idx;
```

Complementos: enviados por dia (mesma consulta com `type='send_message'`) dá a
taxa de recuperação por toque; e "esgotados" = enrollments que chegaram ao
`move_stage` da etapa Esgotado. Tela de relatório fica para depois — o dado já
nasce completo e imutável nos registros do motor.

## Ensaio de 28/09 no banco de teste (verde, ciclo completo)

Montado pelo compilador real em SIMULAÇÃO (funil `Follow-up CENNO` 13 etapas,
automação de 49 passos): tag "Follow-up" aplicada pelo caminho do sistema →
o gancho tag→régua inscreveu sozinho; entrada processada; espera do Dia 1
armada; virada de dia forçada → **mensagem do Dia 1 saiu simulada com o nome
renderizado** ("Oi Prova, tudo bem? Aqui é a Aurora, da CENNO HUB 😊...");
card avançou (simulado) para Dia 2; resposta inbound do lead → espera resolveu
e o passo **"recuperado no Dia 2"** executou (volta ao funil de vendas),
régua concluída (`done`). Nenhuma chamada de envio real (trava no executor do
ensaio + delivery simulation + kill-switch da org). Fixture apagado por
contagem; funil, régua e tags ficaram montados no ambiente de teste.

Achado de plataforma: a PRÉVIA roda com `AUTOMATION_LIVE_SENDS_ENABLED`
desligado — o tick materializa e NÃO executa (por desenho). O ensaio rodou o
executor real por script com envio travado. Para a régua rodar sozinha no
ambiente de teste/produção, essa env precisa estar ligada no ambiente certo.

## Prova antes de ligar

1. Régua montada no banco de TESTE, publicada em modo simulação.
2. Ensaio: tag aplicada num negócio fixture → 1º wait arma; simular timeout →
   mensagem 1 SIMULADA registrada; simular resposta do lead → régua pausa.
3. Só depois do OK dele nas mensagens e no ensaio: montar em produção
   (simulação primeiro; envio real só com o "pode" explícito).
