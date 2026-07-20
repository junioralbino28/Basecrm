# Opinião do Codex — Entrega C1

> Rodada de opinião, sem implementação.  
> Data: 2026-07-20  
> Base examinada: branch `feat/funil-construtor` em `5df37fa`.

## Veredito

**Fatiar, mas não manter a C1 atual como uma única entrega.**

Eu aprovaria quatro marcos:

1. **C1a — contratos e segurança:** novo passo de N caminhos de ponta a ponta,
   validação estrutural do draft, O1 e O2.
2. **C1b — construtor aprovado:** árvore, layout automático, mover-na-linha,
   doca, pan/zoom, seletor e correções de interface.
3. **C2 — execução operacional:** roteamento, tarefas/movimentos, jobs pausados e
   observabilidade de falhas.
4. **C3 — mídia e ciclo de vida do tenant:** pipeline de mídia/ffmpeg e O5.

A recomendação anterior de executar C1 antes de C2/C3 estava correta. O achado
dos N caminhos, porém, fez a C1 crescer: R2 não é mais uma adaptação de tela.
Agora envolve schema, compilador, versão publicada e executor. Somar isso a R1 e
R3 — ambos grandes — recriaria o problema de revisão excessivamente volumosa que
o próprio fatiamento pretendia evitar.

Se o Junior não quiser uma rodada formal extra, C1a e C1b ainda devem existir
como dois gates de revisão e conjuntos de commits separados. Eu não executaria
tudo numa rodada.

## Achados que corrigem a spec

### 1. R2 não cabe nos outcomes atuais

A frase de R2 dizendo que N caminhos serão gravados com
`true`/`false`/`otherwise` está errada.

Há três travas simultâneas:

- o banco aceita somente sete outcomes fixos;
- existe unicidade por `(from_step_id, outcome)`;
- o compilador aceita em `condition` apenas `true`, `false` e `otherwise` e
  rejeita outcome repetido.

Logo, quatro filhos semanticamente distintos não podem sair de um único
`condition` atual.

### 2. Não existe execução de `condition`

O compilador conhece `condition`, mas o runtime entregue até F6 não a avalia. O
materializador cria um job genérico, enquanto o dispatch implementado aceita
mensagem e o avanço normal usa sempre `success`. Não há caminho que escolha
`true`, `false` ou `otherwise`.

Portanto, adicionar apenas o tipo/outcome no schema e no compilador criaria uma
automação publicável que não percorre os ramos. O novo passo precisa chegar até
o executor em C1a, ou a publicação de fluxos que o contenham deve continuar
bloqueada. Como o critério da C1 exige publicar e testar o fluxo, recomendo
implementar a execução em C1a.

### 3. A “árvore” ainda é um DAG no motor

O compilador exige uma entrada, alcançabilidade e ausência de ciclo, mas não
proíbe um passo com dois pais. O mockup e o algoritmo de mover pressupõem uma
árvore enraizada, na qual cada passo não raiz tem exatamente um pai.

C1 precisa travar essa decisão. Para o desenho aprovado, recomendo **árvore
enraizada em v1**, rejeitando `indegree > 1`. Sem isso:

- “o pai do passo” pode ser ambíguo;
- remover e reinserir um nó não tem semântica única;
- centralizar pai entre filhos deixa de ser um layout de árvore;
- o mesmo passo pode aparecer duas vezes ou exigir layout de DAG.

## 1. Modelagem dos N caminhos

### Escolha: opção B, refinada

Criar um tipo técnico novo, **`switch`**, apresentado na interface como
**Divide caminho**. Manter `condition` binário e inalterado.

O `switch` v1 deve ser deliberadamente limitado:

- um campo observado;
- um operador comum compatível com o campo;
- N casos ordenados;
- cada caso com ID imutável, rótulo legível e valor;
- um fallback obrigatório.

Exemplo conceitual:

```json
{
  "field": "contact.tags",
  "operator": "contains",
  "cases": [
    { "id": "<uuid>", "label": "Lentes", "value": "lentes" },
    { "id": "<uuid>", "label": "Ortodontia", "value": "ortodontia" }
  ],
  "fallbackLabel": "Não identificou"
}
```

As arestas usam uma chave estável, como `case:<uuid>`, e `otherwise` para o
fallback. **Não usar o slug do rótulo como identidade.** O usuário precisa poder
renomear “Estética” sem trocar a identidade da aresta nem alterar inscrições
versionadas.

O compilador deve cruzar config e arestas:

- IDs de caso únicos;
- rótulos não vazios;
- um outcome para cada caso;
- nenhum `case:<id>` que não exista no config;
- um único `otherwise`;
- ordem normalizada;
- limite explícito de casos;
- publicação bloqueada enquanto faltar destino.

### Por que não A

Encadear condições preserva o resultado lógico, mas muda o modelo aprovado:
introduz precedência entre perguntas, cria uma escada visual e torna um caso
posterior dependente das negativas anteriores. Também fica mais difícil explicar
e editar a intenção “escolha uma entre quatro categorias”.

### Por que não C

A suspeita procede. Liberar strings arbitrárias em `condition` sem cruzá-las com
uma definição de casos permitiria:

- typo entre config e aresta;
- rótulo sem regra correspondente;
- regra sem destino;
- outcomes inesperados por outros tipos;
- publicação de um grafo que o executor não sabe resolver.

É possível tornar C segura adicionando toda a validação acima, mas então ela
vira um `switch` chamado `condition`. Separar os tipos mantém o contrato explícito
e evita quebrar o significado binário já aprovado.

### Impacto sobre o que já foi aprovado

A mudança deve ser aditiva:

- nova migration, sem reescrever F1;
- novo tipo `switch`;
- outcome dinâmico aceito apenas no formato fechado `case:<uuid>`;
- predicate de validação por tipo no lugar de um `Set` totalmente estático;
- schema específico do config;
- **`schemaVersion: 2`** na definição compilada;
- executor capaz de produzir exatamente um `case:<uuid>` ou `otherwise`;
- versões v1 antigas continuam imutáveis e executáveis.

Além de compiler e banco, será necessário atualizar tipos do builder, Zod das
rotas, persistência, testes de publicação e runtime. Isso é uma mudança
controlada, não uma quebra retroativa.

Uma quarta alternativa seria normalizar casos numa nova tabela. Ela daria mais
integridade relacional, mas adicionaria tabela, RLS, snapshots e joins sem
benefício suficiente agora. Casos dentro do config versionado, com IDs estáveis
e validação cruzada, são o melhor custo/benefício.

## 2. Mover passo soltando na linha

### Persistência

**Não criar RPC dedicado para cada drop.** O builder atual tem edição local,
botão Salvar e concorrência otimista por `draftRevision`. Persistir o drop
separadamente criaria duas fontes de estado:

- o grafo já movido no servidor;
- outras edições ainda não salvas no cliente.

Isso tornaria desfazer, falha de rede e duas abas mais difíceis.

Recomendo:

1. movimento como transformação pura do grafo no cliente;
2. validação imediata da transformação para feedback;
3. persistência do grafo completo pelo save já existente;
4. compare-and-set de `draftRevision`, como hoje;
5. validação estrutural novamente no servidor;
6. RPC salva tudo em uma transação ou faz rollback completo.

### Garantia server-side

O save atual é atômico, mas não rejeita ciclo ou órfão; essas verificações só
ocorrem na publicação. A C1 deve acrescentar uma asserção estrutural ao fluxo de
save. A melhor divisão é:

- validador puro TypeScript compartilhado pelo servidor e pelos testes;
- rota PATCH valida o payload inteiro antes da RPC;
- a RPC, depois de montar passos e arestas e antes de concluir, verifica ao menos
  uma raiz, alcançabilidade, ausência de ciclo e no máximo um pai. Se falhar, a
  transação inteira volta.

Draft pode continuar incompleto em conteúdo e pode ter um caso ainda sem filho,
mas não pode persistir passo existente inacessível, referência inválida, ciclo ou
dois pais.

### Semântica exata do movimento

Para mover `n` de `P → n → C` para a aresta `A → B`:

1. preservar o outcome de `P → n` em `P → C`;
2. preservar o outcome da aresta alvo em `A → n`;
3. criar `n → B` com o outcome linear válido de `n`, normalmente `success`;
4. normalizar `order` dos irmãos;
5. recalcular `sort_key` como ordem de UI, sem usá-lo para execução.

Se `n` for folha, a posição antiga simplesmente passa a terminar em `P`; ao
inserir em `A → B`, `n → B` ainda precisa do outcome linear correto.

A regra de bloqueio deve ser estrutural: **qualquer nó com mais de uma saída não
move**, não apenas o tipo `switch`. Um `wait_for_event`, ou uma mensagem com
caminho explícito de falha, também divide a árvore e não cabe na regra “o filho
assume”.

Continuam bloqueados:

- raiz;
- nó com mais de uma saída;
- aresta na própria subárvore;
- aresta incidente no próprio nó;
- destino que faria o grafo exceder limites.

Também recomendo um “Desfazer movimento” local antes de salvar. Arrasto é um
gesto fácil de executar acidentalmente; depender de recarregar perderia outras
edições do draft.

## 3. Layout automático e persistência

Não persistir coordenadas `x/y`. O layout aprovado é derivado, não livre.

Para resultado determinístico:

- topologia vem das arestas;
- ordem entre irmãos vem de `automation_step_edges.order`;
- `step_key` é o último desempate estável;
- `sort_key` pode guardar a travessia pre-order para compatibilidade de UI, mas
  não decide topologia;
- pan e zoom são estado de sessão/usuário, não parte da automação.

`sort_key + edge.order` bastam somente se forem normalizados. Hoje dois irmãos
podem receber o mesmo `order`. A C1 deve rejeitar duplicidade por pai ou
normalizar para `0..N-1`. A identidade do caso não pode depender da ordem.

Como a estrutura será uma árvore, o layout necessário é simples e determinístico
em O(n): profundidade define a coluna; folhas recebem faixas verticais; cada pai
fica no centro entre o primeiro e o último filho. Não vejo necessidade de adotar
um motor de canvas ou um layout de DAG nesta fase.

## 4. O1 — permissão

Usar **nova migration versionada**, mantendo F1 intacta.

Recomendação:

1. adicionar `automation.operate` a `CLINIC_STAFF_DENIED`;
2. isso também altera `vendedor`, que usa o mesmo conjunto;
3. gerar snapshot completo v2 com as 222 combinações;
4. a migration v2 faz o upsert do snapshot e valida 6 × 37;
5. atualizar `has_permission` para exigir a versão completa v2;
6. reapontar o gerador/teste para a migration v2, sem editar F1.

Não recomendo um `UPDATE` manual solto nas duas linhas: ele deixaria fonte
TypeScript, snapshot gerado e versão ativa mais fáceis de divergir.

Os toggles manuais continuam funcionando. `profile_permissions` é consultada
depois do default e prevalece quando pertence ao mesmo tenant. Assim:

- `clinic_staff`/`vendedor`: false por padrão;
- override manual true: acesso liberado;
- admin da clínica e equipe da agência: defaults mantidos.

Os testes precisam cobrir não apenas o menu, mas também GET, teste e demais rotas
de automação; esconder navegação sem negar endpoint não atende a decisão.

## 5. O2 — tick que falha calado

Não criar histórico infinito e não depender de `net._http_response` como fonte
durável. A tabela do `pg_net` é unlogged e tem retenção curta; no container local
examinado ela pertence ao pg_net 0.14.0, enquanto o ambiente registrado no
briefing usa 0.19.5. Acoplar o produto a detalhes privados dela também criaria
risco de versão.

Criar uma única linha global, por exemplo em
`automation_scheduler_state`, atualizada in place:

- `last_enqueued_at`;
- `last_request_id`;
- `last_received_at`;
- `last_completed_at`;
- `last_success_at`;
- `last_status`;
- `last_result` pequeno, com contagens;
- `last_error` sanitizado e limitado;
- `consecutive_failures`;
- `total_attempts`.

Fluxo:

1. `request_automation_tick()` registra tentativa e request ID;
2. se `net.http_post` lançar erro, registra `queue_error` em vez de engolir;
3. a rota, **depois da autenticação**, registra que recebeu o tick;
4. sucesso registra conclusão e zera falhas consecutivas;
5. erro de reconciliação registra falha antes de devolver 500;
6. saúde é derivada por tempo: cron ativo e último sucesso dentro de duas ou três
   janelas.

URL errada, app fora do ar ou segredo inválido aparecem como
`last_enqueued_at` avançando enquanto `last_received_at`/`last_success_at` ficam
velhos. Se o próprio cron parar, até `last_enqueued_at` fica velho.

São duas ou três atualizações da mesma linha a cada cinco minutos, custo
irrelevante para o banco e crescimento zero.

C1 deve mostrar ao menos um estado verde/amarelo/vermelho na tela de Automações.
A observabilidade detalhada fica em C2, mas gravar silenciosamente sem superfície
visível ainda seria apenas trocar um silêncio por outro.

Antes de live, um alerta ativo também é necessário. Uma página vermelha só ajuda
quem a abre. O canal de alerta pode ser decidido na C2, mas o gate de produção
deve exigir:

- tick recente;
- dispatcher da VPS com heartbeat recente;
- backlog sem job vencido além do limite;
- O3 resolvido;
- `unknown` e `dead_letter` visíveis/alertáveis.

O2 é necessário antes de live, mas não é suficiente sozinho.

## 6. Ordem de execução e TDD

### C1a

1. **Corrigir spec/ADR de contrato:** `switch`, schema v2, árvore enraizada,
   semântica de mover e definição de saúde.
2. **O1:** testes de defaults/override/rotas primeiro; depois migration v2.
3. **O2:** testes de estado ausente, enqueue, sucesso, 401/stale, 500 e cron
   parado; depois singleton e fiação da rota.
4. **`switch` no compilador:** testes red para N casos, fallback, caso faltante,
   duplicado, desconhecido e compatibilidade v1.
5. **`switch` no runtime:** teste local que escolhe cada caso e fallback e avança
   exatamente uma vez.
6. **Validação de draft e transformação de movimento:** testes de propriedades
   para cadeia, folha, raiz, nó com múltiplas saídas, alvo na subárvore, ciclo,
   órfão, dois pais e CAS obsoleto.

Gate C1a: publicar e simular um fluxo pequeno com `switch`, comprovando no banco
qual ramo venceu, sem UI nova.

### C1b

1. layout como função pura, com snapshots de coordenadas e determinismo;
2. árvore e fios/rótulos;
3. doca contextual e seletor;
4. pan/zoom/fit;
5. mover-na-linha e desfazer;
6. correções R7;
7. testes de navegador dos cinco gestos obrigatórios;
8. percurso manual do Junior.

Gate C1b: o critério visual da C1, acrescido de evidência de que o teste percorreu
o ramo correto — não apenas que a primeira mensagem foi simulada.

Para a interface, TDD não significa testar pixel por pixel. Começaria por:

- funções puras de layout e mutação;
- invariantes do grafo;
- testes de componente para estados/labels;
- Playwright para pointer, teclado, dock, pan/zoom e publicação;
- inspeção humana final, porque os três defeitos anteriores provaram que ela é
  parte do aceite.

## 7. Armadilha de gesto

A solução usada no mockup é válida: quando há pointer capture, guardar a origem e
decidir no `pointerup` é mais confiável que consultar `event.target`.

Há uma melhoria: **não capturar o ponteiro de um cartão imediatamente**.

1. `pointerdown` no cartão entra em estado `pressed`;
2. enquanto o deslocamento estiver abaixo do limiar, não há capture;
3. ao cruzar 4–6 px, entra em `dragging`, chama `setPointerCapture` e suprime o
   próximo click;
4. sem deslocamento, deixa o click nativo abrir a doca;
5. teclado continua usando click nativo;
6. fundo pode capturar imediatamente para pan.

Isso mantém o target correto no clique e conserva capture durante o arrasto real.
Ainda é necessário modelar o gesto como uma máquina de estados explícita:
`idle`, `pressed-card`, `drag-card`, `pan`. Também limpar estado em
`pointercancel` e `lostpointercapture` e usar `touch-action: none` no palco.

Não recomendo HTML5 Drag and Drop. Ele combina mal com touch, pan/zoom e
coordenadas transformadas. Para escolher a linha alvo, a busca geométrica usada
no mockup é adequada; não dependa do `event.target` capturado.

## 8. O que está arriscado ou faltando

1. **C1 ainda estava grande demais.** Com executor de `switch`, são três frentes
   de alto risco: contrato do motor, layout e mutação do grafo.
2. **Critério de teste ambíguo.** O teste atual da F6 simula só o primeiro job.
   A C1 precisa provar qual ramo foi percorrido.
3. **Árvore versus DAG não estava decidida.** O mockup exige um pai por nó.
4. **Bloqueio de movimento estava estreito.** A regra correta é saída múltipla,
   não apenas “tipo decisão”.
5. **Ordem de irmãos não tem unicidade.** Precisa normalização/validação.
6. **Caso e rótulo não podem compartilhar identidade.** Renomear não pode mudar
   a aresta.
7. **Falha de concorrência precisa de UX.** Se outra aba salvar, o drop local
   deve ser preservado para comparação ou oferecer recarregar; um 500 genérico
   não basta.
8. **Mover precisa de desfazer.** O botão Salvar reduz o risco, mas não recupera
   outras edições se o usuário tiver de recarregar.
9. **O2 sem alerta ativo ainda é parcialmente silencioso.**
10. **O gate de live está incompleto.** Além do tick, precisa cobrir worker,
    backlog, paused jobs, `unknown` e `dead_letter`.
11. **Compatibilidade do pg_net precisa ser deliberada.** Local e ambiente
    registrado têm versões diferentes; usar contrato público e estado próprio.
12. **Limites devem ser visíveis.** O backend já limita 100 passos e 300 arestas;
    o número máximo de casos e o comportamento do mapa perto desses limites
    precisam de aceite.

## Decisão recomendada ao Junior

**Aprovar o fatiamento, com C1 dividida em C1a e C1b.**

Não aprovar tudo de uma vez e não autorizar o plano técnico a tratar R2 como
mudança apenas visual. A ordem segura é:

```text
C1a contratos/segurança
  → C1b construtor demonstrável
    → C2 operação + observabilidade + gate de live
      → C3 mídia/ffmpeg + ciclo de vida do tenant
```

O tick silencioso deve ser resolvido em C1a. O envio real permanece desligado
até C2 fechar o gate operacional completo.
