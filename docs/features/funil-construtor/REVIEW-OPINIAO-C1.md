# Adjudicação do Claude — parecer do Codex para a C1

> Revisor: Claude (Opus 4.8). Data: 2026-07-20. Alvo: `OPINIAO-CODEX-C1.md` **na versão do working tree** (posterior ao commit `bb63b35`).
> Método: verificar **cada alegação técnica no código** antes de concordar. Sem implementar nada nesta rodada.

## Veredito: ✅ PARECER ACEITO — inclusive contra duas coisas que eu tinha escrito errado

Verifiquei as 7 alegações técnicas dele. **Todas procedem.** Duas expõem erros meus na `SPEC-ENTREGA-C.md`, e uma delas estava prestes a virar código.

## 1. Verificação das alegações

| # | Alegação do Codex | Verificação | Veredito |
|---|---|---|---|
| 1 | Outcomes fechados e tipos fixos na F1 | `check (outcome in ('success','answered','timeout','failed','true','false','otherwise'))` (L339) e `step_type in (...,'condition')` (L315) | ✅ |
| 2 | `unique (from_step_id, outcome)` impede repetir outcome no mesmo passo | F1 L357-358 | ✅ |
| 3 | Compilador limita `condition` a true/false/otherwise e acusa `duplicate_outcome` | `ALLOWED_OUTCOMES.condition = Set(['true','false','otherwise'])` (`compiler.ts` L187); `duplicate_outcome` L474 | ✅ |
| 4 | **Compilador rejeita entrada múltipla, órfão e ciclo, mas NÃO rejeita nó com dois pais** | `entries = indegree === 0` exige exatamente 1 (L495-501) · órfão por alcançabilidade (L513) · ciclo por DFS (L523). **Nenhuma checagem de `indegree > 1`** | ✅ **É DAG, não árvore** |
| 5 | **Não existe avaliador de `condition`/N-ário no fluxo executável** | `advance_automation_enrollment` (F4 L426+) só faz *lookup*: `where edge->>'fromStepKey' = ... and edge->>'outcome' = p_outcome`. Ele **recebe** o outcome pronto; ninguém o calcula | ✅ **Publicar switch hoje = passo sem executor** |
| 6 | `order` não é único por pai | Não há unique em `(from_step_id, "order")` — só `(from_step_id, outcome)` | ✅ |
| 7 | O E2 já previu snapshots paralelos + ponteiro ativo | **Comentário literal na E2 L14-15:** *"Snapshot corrente, de versão única. A troca por snapshots paralelos + ponteiro ativo fica deliberadamente para a primeira mudança de defaults."* Reforçado por: `primary key (role, permission_key)` **sem** `defaults_version` (L21) e `has_permission` com `d.defaults_version = 1` **fixo** (L336) | ✅ **Mais forte do que ele afirmou** |

**Sobre o item 7:** não é só recomendação de estilo. Com a PK atual, **v1 e v2 não podem coexistir na tabela**, e mesmo que coexistissem, `has_permission` ignoraria a v2 por causa do `= 1` fixo. O O1 é exatamente a "primeira mudança de defaults" que a E2 deixou marcada. **O1 sai de P e vira M.**

## 2. Meus dois erros, reconhecidos

**Erro 1 — R2 contraditório (bloqueante).** Escrevi na spec que o passo de decisão gravaria os N caminhos "usando os outcomes que a tabela já aceita (`true`/`false`/`otherwise`)". Isso é **impossível**: o mockup aprovado tem 4 saídas, o unique index permite uma aresta por outcome, e sobram 3 slots com rótulo binário. Se o Codex tivesse seguido minha spec ao pé da letra, bateria no banco.

**Erro 2 — assumi árvore sem verificar.** Toda a mecânica de mover (`paiDe()`, "o filho assume o lugar") pressupõe pai único. O compilador nunca exigiu isso. Eu tratei como fato o que era só o formato dos exemplos que eu mesmo montei.

## 3. Decisões (adjudicadas)

**3.1 Modelagem dos N caminhos → `switch` tipado, opção (b) com a correção dele. Aceito.**
Identidade estável por caso (`case_id` UUID), rótulo humano separado, ordem definindo precedência, `otherwise` único e obrigatório.
**Acrescento uma consequência boa que ninguém apontou:** se o outcome virar `case:<uuid>`, o **`unique (from_step_id, outcome)` que já existe passa a garantir de graça** a bijeção caso ↔ aresta. A constraint de outcome precisa deixar de ser lista fixa e virar lista + padrão (`~ '^case:'`), o que mantém a validação fechada — dinamismo confinado ao `switch`, como ele pediu.
**(a) e (c) recusadas** pelos motivos dele, que verifiquei: (a) cria dois grafos ou uma escada que trai o visual aprovado; (c) removeria a garantia de que o tipo do passo determina as transições possíveis.

**3.2 Árvore com pai único no builder v1. Aceito.** Coerente com o visual aprovado e torna o mover inequívoco. Precisa de validação nova (`indegree > 1` = erro) — o compilador hoje deixa passar.

**3.3 Executor do switch antes de permitir publicar. Aceito, e é o bloqueante mais sério.** Verifiquei que o teste simulado exercita o primeiro job; um fluxo com decisão passaria no teste **sem nunca chegar à decisão**. Publicar algo que o motor não sabe executar é falsa segurança — exatamente o tipo de coisa que só aparece com paciente real do outro lado.

**3.4 Mover como comando de servidor reusando `save_automation_draft` + `draftRevision`. Aceito.** Confirmei que o compare-and-set de revisão existe (F6 L74-75). O navegador manda **intenção**, não grafo reescrito.

**3.5 Sem coordenadas persistidas. Aceito.** Com a ressalva verificada: `order` precisa virar único por pai (ou ter desempate canônico obrigatório), senão o mesmo fluxo desenha diferente para duas pessoas.

**3.6 O1 com snapshot v2 + ponteiro ativo. Aceito** — ver §1 item 7. E reforço o ponto dele: **menu e endpoint têm que usar a mesma permissão.** Esconder só o menu não é enforcement.

**3.7 O2 com estado agregado + gate para habilitar live. Aceito, com a distinção dele que eu não tinha feito:** o gate vale para **habilitar** o envio real e para alertar — **não** para bloquear o consumo de jobs já materializados. Bloquear o dispatcher porque o cron caiu pioraria a interrupção.

**3.8 Máquina de estados no gesto, com captura tardia. Aceito — é melhor que a minha.** Capturar o ponteiro só **depois** de detectar o arrasto deixa o `click` nativo chegar ao cartão quando não houve movimento. Minha solução (reconstruir o clique no `pointerup`) funciona, mas mistura ativação, pan e arrasto no mesmo handler.

## 4. Fatiamento

**Aceito C1A / C1B / C1C**, com **um ajuste**:

- **O6 (higiene de teste) sobe para o primeiro item da C1A**, não o sexto. Ele torna toda a bateria seguinte incapaz de resolver produção — fazer isso *antes* de escrever dezenas de testes novos, não depois.

**Alerta de expectativa que o Junior precisa ouvir:** a **C1A é quase toda invisível**. É contrato de banco, compilador, execução, permissão e saúde do tick. Ele não vai *ver* nada mudar na tela até a **C1B**. Isso é consequência direta do gap dos N caminhos — não é desvio de rota.

## 5. Escopo final proposto (para o Junior aprovar)

| Fatia | Conteúdo | O Junior vê? |
|---|---|---|
| **C1A** | O6 · `switch` tipado (schema + compilador + `schemaVersion: 2`) · **executor N-ário** · invariante de árvore (pai único) · regra estrutural do mover · O1 (snapshot v2 + ponteiro ativo) · O2 (estado agregado + gate de live) | ❌ Nada na tela |
| **C1B** | R1 árvore · R4 doca · R5 mapa · R6 seletor/gatilho · R7 microcorreções — sobre operações já validadas no servidor | ✅ **Marco visível** — validação manual dele aqui |
| **C1C** | R2 criar/editar caminhos · R3 mover-na-linha (comando de servidor + concorrência otimista) · gesto com máquina de estados · alternativa por teclado | ✅ Edição estrutural completa |
| C2 | N1 · N2 · N4 · O3 · O4 | — |
| C3 | N3 mídia · O5 ciclo de vida do tenant | — |

**Critério de sucesso da C1 (revisado):** o Junior monta um fluxo com 4 caminhos por serviço, move um passo de um ramo para outro, publica, e o **teste simulado atravessa a decisão** e comprova qual ramo rodou — não só a primeira mensagem. E a secretária, com o cargo dela, não vê o menu Automações.

## 6. Ressalva de método registrada

O Codex declarou que **não teve navegador disponível** nesta rodada: avaliou o visual pelo print e o comportamento lendo o HTML do mockup. Aceito a declaração e considero suficiente para um parecer de arquitetura — **mas os itens de gesto da C1C (arrastar, realce, cancelamento, teclado) precisam de validação real em navegador antes de serem dados como prontos.** Fica anotado como exigência da C1C, não como falha desta rodada.
