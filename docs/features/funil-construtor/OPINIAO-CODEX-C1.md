# Parecer do Codex — Entrega C1

Data: 2026-07-20  
Branch inspecionada: `feat/funil-construtor`  
Escopo: opinião técnica, sem código, migration ou teste

## Veredito executivo

**Recomendo fatiar. Não recomendo executar toda a Entrega C de uma vez e também
não recomendo tratar a C1 atual como um único pacote de implementação/revisão.**

O macrofatiamento C1/C2/C3 está correto: interface e modelo do grafo, operação
real e mídia têm riscos diferentes. Porém, o gap dos N caminhos aumentou a C1.
Ela deixou de ser principalmente um redesenho e passou a incluir uma alteração
de contrato do motor, do compilador e da execução.

Minha divisão recomendada:

1. **C1A — contrato e segurança:** novo passo N-ário, execução desse passo,
   invariantes de árvore, O1, O2 e O6.
2. **C1B — árvore navegável:** R1, R4, R5, R6 e R7, inicialmente sobre operações
   do grafo já validadas no servidor.
3. **C1C — edição estrutural:** criação/edição dos caminhos de R2 e
   mover-na-linha de R3, com mutação no servidor, concorrência otimista e testes
   reais de ponteiro/teclado.

Essas três partes podem continuar sob o nome “Entrega C1”, mas devem ter commits,
gates e revisão manual separados. Depois permanecem:

- **C2:** N1, N2, N4, O3 e O4. O2 já estará resolvido e N4 amplia a tela de saúde
  para a observabilidade operacional completa.
- **C3:** N3 e O5, isolando mídia/ffmpeg e a decisão de ciclo de vida do tenant.

O print aprovado confirma que “Divide caminho” é semanticamente um nó com quatro
resultados exclusivos e nomeados. Não é apenas uma apresentação mais bonita de
uma sequência de perguntas binárias.

## Evidência verificada

- O banco aceita apenas os tipos atuais e outcomes fechados em
  `20260718000000_funil_f1_authoring.sql`.
- A constraint única `(from_step_id, outcome)` impede repetir `true`, `false` ou
  `otherwise` no mesmo passo.
- O compilador permite apenas `true`, `false` e `otherwise` para `condition` e
  também acusa `duplicate_outcome`.
- O compilador rejeita entrada múltipla, órfão e ciclo, mas **não rejeita um nó
  com dois pais**. O modelo atual é um DAG; o mockup e a mutação de R3 pressupõem
  uma árvore com pai único.
- O save da F6 substitui arestas e passos em uma transação e possui
  `draft_revision` como compare-and-set, mas não aplica a validação completa do
  compilador ao salvar.
- `advance_automation_enrollment` apenas recebe um outcome e procura a aresta
  correspondente. Não encontrei um avaliador de `condition`/N caminhos no fluxo
  executável atual.
- `request_automation_tick()` retorna `null` quando faltam segredos e engole
  qualquer exceção. O healthcheck atual confirma instalação/agendamento, não
  confirma que o tick chegou e concluiu.

## 1. Modelagem dos N caminhos

### Escolha

Escolho a opção **(b), mas com uma correção importante**: criar um tipo
`switch` e dar a cada caso uma identidade estável. Não usaria o texto visível
nem um slug editável como identidade da transição.

Contrato conceitual:

```text
step type: switch
config:
  field
  cases[]:
    case_id       # UUID estável
    label         # texto que aparece na linha
    operator
    value
    order
  fallback_label

edges:
  outcome = case:<case_id>
  outcome = otherwise
```

O label “Lentes” pode ser renomeado sem mudar a identidade do caminho. A ordem
dos casos define a avaliação; se mais de um caso casar, **o primeiro vence**.
`otherwise` é único e obrigatório.

Também seria válido adicionar uma coluna `branch_key` às arestas em vez de
codificar `case:<UUID>` no outcome. Para este motor, o token controlado no
outcome é a alteração menor porque `advance_automation_enrollment` já transita
por texto. O ponto inegociável é: token de máquina estável e rótulo humano
separado.

### Por que não (a)

Encadear condições funciona no armazenamento atual, mas muda o significado
visual e operacional aprovado. A árvore vira uma escada, a observabilidade
mostrará várias decisões artificiais e editar/reordenar um serviço passa a
alterar uma cadeia interna. É solução de contingência, não o modelo correto.

Uma macro visual que escondesse várias condições binárias sob um cartão único é
uma quarta alternativa possível, mas cria dois grafos — o que o usuário edita e
o que o motor executa. Isso complica versionamento, attempts, erros e restauração
de draft. Não recomendo.

### Por que não (c)

A suspeita procede. Liberar outcomes dinâmicos para `condition` enfraquece uma
garantia importante: hoje o tipo do passo determina exatamente quais transições
podem existir.

O dinamismo deve ficar **confinado ao `switch`**. O compilador precisa provar:

- IDs de caso únicos;
- ordem única e determinística;
- correspondência bijetiva entre casos e arestas `case:<id>`;
- exatamente um `otherwise`;
- ausência de aresta dinâmica em qualquer outro tipo;
- campo, operador e valor compatíveis;
- rótulo não vazio e limite de quantidade/tamanho.

### O que muda no que já foi aprovado

A mudança é aditiva e não invalida automações já publicadas, mas toca:

- constraint de tipo do passo;
- domínio/constraint de outcome;
- tipos TypeScript;
- schema Zod e `ALLOWED_OUTCOMES`;
- validação de correspondência caso ↔ aresta;
- snapshot canônico/versionamento da definição;
- builder, leitura e publicação;
- execução que escolhe o caso;
- testes de isolamento, compilação, publicação e execução.

Versões antigas devem continuar legíveis. Como a definição publicada ganha uma
nova forma, recomendo tratar o snapshot como `schemaVersion: 2` e manter o
executor compatível com v1.

Há um bloqueio adicional: **não se deve publicar um `switch` que o motor não
consegue executar**. O teste simulado atual exercita o primeiro job e pode passar
sem nunca chegar à decisão. A C1A precisa implementar a avaliação N-ária ou
bloquear a publicação até ela existir. Como o critério da C1 exige publicar,
recomendo implementar a avaliação na C1A.

## 2. Mover passo soltando na linha

Não colocaria a regra de negócio no cliente e não criaria um RPC SQL específico
para cada gesto.

Recomendo um **comando dedicado no servidor**, por exemplo
`moveAutomationStep`, que:

1. recebe `automationId`, `draftRevision`, `movingStepKey` e a identidade da
   aresta destino;
2. carrega o grafo vigente pelo tenant;
3. valida raiz, tipo/outdegree, pai único e subárvore;
4. aplica detach e insert em uma função TypeScript pura;
5. valida a topologia resultante;
6. usa o `save_automation_draft` atual para substituir o conjunto inteiro em uma
   transação, com a revisão esperada.

Assim, o browser envia **a intenção**, não um conjunto de arestas reescrito e
confiável. O RPC existente continua responsável pela persistência atômica. A
revisão otimista resolve a corrida entre o load e o save: se outro editor salvar
no intervalo, a operação é recusada e a tela recarrega.

Um RPC SQL dedicado duplicaria em PL/pgSQL regras que já pertencem ao compilador
e tornaria mais fácil haver duas definições de ciclo/órfão. Só escolheria essa
opção se a mutação precisasse ser chamada por clientes que não passam pela
aplicação, o que não é o caso.

### Invariante ausente

O mockup usa `paiDe()` e assume um pai por nó. O compilador atual permite um DAG
com convergência. Antes de R3 é preciso decidir:

- suportar DAG e implementar layout/movimento de merges; ou
- declarar o builder v1 como **árvore enraizada**, rejeitando indegree maior que
  1 para qualquer nó não raiz.

Recomendo a segunda opção. É coerente com o visual aprovado e torna a operação
de mover inequívoca.

### Outro caso que a spec não fecha

“Não mover passo de decisão” não basta. Um envio pode ter `success` e `failed`;
uma espera pode ter `answered`, `timeout` e `failed`. Portanto, “o filho assume”
não é definido quando há mais de uma saída.

A C1A precisa classificar:

- continuação principal;
- caminhos de erro/timeout anexos;
- se esses anexos acompanham o passo ao mover ou tornam o passo não movível.

Para a primeira versão, a regra segura é recusar movimento quando a operação não
tem exatamente uma continuação estrutural bem definida, com mensagem explícita.

## 3. Layout automático e persistência

Não persistiria coordenadas `x/y`. Isso criaria estado visual concorrente e
contradiria “o sistema posiciona”.

A fonte determinística deve ser:

1. topologia das arestas;
2. `automation_step_edges.order` para ordenar irmãos;
3. `step_key` como desempate estável;
4. `sort_key` apenas como ordem auxiliar de autoria/listagem, nunca execução.

O algoritmo “coluna = profundidade; pai centralizado entre primeiro e último
filho” produzirá o mesmo desenho em sessões diferentes se a ordem de irmãos for
total. Hoje `order` não é único por pai. Deve haver validação
`duplicate_edge_order` ou um desempate canônico obrigatório.

Pan e zoom podem ficar em estado local por usuário, se desejado. Não pertencem à
definição publicada.

## 4. O1 — permissão

Deve ser uma **nova migration**. Não se edita a F1 aplicada.

Também não recomendo apenas atualizar duas linhas continuando a chamá-las de
snapshot v1. A migration E2 já documentou que a primeira mudança de defaults
introduziria snapshots paralelos e um ponteiro ativo. Esta é essa primeira
mudança.

Forma correta:

1. mudar a chave para incluir `defaults_version`;
2. criar estado singleton com `active_version`;
3. inserir o snapshot v2 completo, gerado de `permissions.ts`;
4. colocar `automation.operate = false` para `clinic_staff` e `vendedor`;
5. trocar `has_permission` para ler a versão ativa;
6. ativar v2 na mesma transação;
7. preservar overrides individuais, que continuam podendo liberar o toggle;
8. testar completude de v1 e v2, ponteiro ativo e fail-closed.

Agência, `agency_staff`, `agency_admin` e `clinic_admin` continuam com acesso por
default. Menu e endpoints precisam usar a mesma permissão; esconder somente o
menu não basta.

Isso aumenta O1 de P para P/M, mas paga uma dívida que o próprio schema deixou
explicitamente marcada.

## 5. O2 — tick que falha calado

Usaria **estado agregado singleton**, não uma linha por tick.

Exemplo de estado:

- `last_requested_at`;
- `last_request_id`;
- `last_received_at`;
- `last_succeeded_at`;
- `last_http_status`;
- `consecutive_failures`;
- `last_error`;
- `updated_at`.

Fluxo:

1. `request_automation_tick()` registra a tentativa antes do `net.http_post`;
2. segredo/URL ausente e exceção atualizam erro e contador, em vez de sumirem;
3. o endpoint do tick marca início e sucesso, inclusive quantidade de jobs
   materializados;
4. se uma tentativa não for recebida/concluída em dois intervalos, o healthcheck
   deriva estado degradado;
5. a observabilidade lê essa única linha.

São poucas atualizações a cada cinco minutos e crescimento zero. Se futuramente
for necessário histórico, registrar somente transições de saúde/falhas, com
retenção curta, não todos os ticks.

O healthcheck atual só prova que cron e extensão existem. Ele precisa distinguir
“agendado”, “requisição emitida”, “endpoint recebeu” e “tick concluiu”.

### Amarração com envio real

Eu transformaria a preocupação do Junior em gate técnico, não só em ordem de
roadmap:

- a ação que futuramente habilitar `automation_live_enabled` deve exigir tick e
  worker com heartbeat recente;
- a UI deve recusar habilitação e explicar a causa quando a saúde estiver
  degradada;
- depois de live, ausência de heartbeat deve gerar alerta operacional.

Não bloquearia o consumo de jobs já materializados apenas porque o cron caiu;
isso pioraria a interrupção. O gate vale para **habilitar live** e para alertar,
enquanto o dispatcher continua esvaziando o que já existe.

## 6. Ordem de execução e TDD

### C1A — primeiro

1. Testes vermelhos do `switch`: casos, fallback, duplicidade, ordem, compatibilidade
   e publicação v2.
2. Testes de execução: primeiro caso que casa vence; nenhum caso usa
   `otherwise`; reprocessamento não duplica efeito.
3. Invariante de árvore/pai único e regra estrutural de movimento.
4. O2 com testes de segredo ausente, exceção, requisição não recebida, sucesso e
   recuperação do contador.
5. O1 com snapshot v2, override manual e menu/endpoint negados ao staff.
6. O6, para que toda a bateria seguinte seja incapaz de resolver produção.

### C1B — segundo

1. Função pura de layout com fixtures pequenas, ramos assimétricos e fluxo longo.
2. Árvore inicialmente renderizada sem coordenadas persistidas.
3. Doca, seletor, gatilho fora do mapa, pan, zoom, piso e “Ajustar”.
4. Testes de componente para texto/estado e testes reais de navegador para
   viewport, zoom ancorado, clique, Esc e fechamento no vazio.
5. Validação manual do Junior antes de empilhar R3.

### C1C — terceiro

1. Testes de propriedade da mutação de mover: mesmo conjunto de nós, uma raiz,
   pai único, zero ciclo, zero órfão e outcomes preservados.
2. Teste de revisão obsoleta com dois editores.
3. Comando de servidor e persistência atômica.
4. Gesto de arrastar, realce de linha, cancelamento e mensagens de impedimento.
5. Alternativa de teclado para mover.
6. Publicação e teste ponta a ponta que atravesse o `switch`; não apenas a
   primeira mensagem.

## 7. Armadilha do gesto

A solução do mockup é válida, mas existe uma abordagem menos frágil:

1. no `pointerdown`, registrar candidato, alvo original, `pointerId` e posição;
2. **não capturar ainda**;
3. ao ultrapassar o limiar de movimento, entrar em `dragging-node` ou `panning`
   e só então chamar `setPointerCapture`;
4. sem movimento, deixar o `click` nativo chegar ao cartão;
5. depois de drag, suprimir o click sintético residual;
6. tratar `pointercancel`, `lostpointercapture`, Esc e desmontagem.

Isso deve ser uma pequena máquina de estados:

```text
idle -> pressed-card -> dragging-node -> idle
idle -> pressed-stage -> panning -> idle
```

Reconstruir manualmente o clique no `pointerup`, como o mockup faz, funciona,
mas mistura ativação, pan e drag no mesmo handler. A captura atrasada preserva
melhor mouse, toque e teclado. O `click` com `detail === 0` continua válido como
fallback de teclado, mas não deveria ser o mecanismo principal.

## 8. O que está errado, arriscado ou faltando

### Bloqueantes

1. **R2 está contraditório.** Diz N caminhos, mas afirma que usará somente
   `true/false/otherwise`. Isso não é implementável no schema/compilador atuais.
2. **Árvore versus DAG não foi decidido.** Layout e movimento assumem pai único;
   o compilador não.
3. **O switch não tem executor.** Publicar/testar somente a primeira mensagem
   pode dar falsa segurança.
4. **Mover não define passos com múltiplas saídas.** Isso inclui falha e timeout,
   não apenas decisões.

### Importantes

5. Definir “primeiro caso vence” quando um contato possui múltiplas etiquetas.
6. Tornar a ordem entre irmãos única ou canonicamente desempatada.
7. Manter IDs de caso estáveis ao renomear rótulos.
8. Incluir operação por teclado; arrastar não pode ser a única forma de mover.
9. Avisar sobre alterações não salvas ao trocar de automação.
10. Testar auto-pan ao arrastar perto da borda em fluxos maiores que o viewport.
11. Fazer o teste de sucesso atravessar a decisão e comprovar ramo/fallback.

## Conclusão

**A recomendação original de fatiar está correta. A recomendação “C1 sozinha”
também está correta como prioridade, mas não como um diff único.**

O caminho seguro é C1A/C1B/C1C, com revisão manual depois da primeira árvore
navegável e antes de R3. O2 entra na C1A e vira gate de habilitação do live.

Para os quatro caminhos, a decisão correta é um `switch` tipado, com casos de
identidade estável, labels separados e validação fechada. Não vale economizar uma
migration criando outcomes livres em `condition`: esse atalho retiraria
justamente a proteção que torna a publicação confiável.

## Limitação desta rodada

O navegador conectado não ficou disponível nesta sessão. A referência visual
foi avaliada pelo print fornecido pelo Junior, e o comportamento interativo foi
conferido no HTML do mockup. Não afirmo ter concluído uma operação manual do
mockup no navegador nesta rodada.
