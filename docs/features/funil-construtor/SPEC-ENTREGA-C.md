# SPEC — Entrega C (Construtor de Funil)

> Escrita por Claude em 2026-07-18, depois de o Junior operar a tela e **aprovar o visual**.
> Referência visual oficial: **`mockup-tela-real.html`** (abrir no navegador). O racional de cada decisão está em `mockup-builder.html`.
> Base: Entregas A (F0–F3) e B (F4–F6) concluídas e aprovadas — branch `feat/funil-construtor`, nada em produção, envio real desligado.

## Por que esta spec vem dividida

A Entrega C original previa **roteamento, mídia e observabilidade**. Depois que o Junior operou a tela, entrou trabalho que **não estava no plano**: o construtor virou árvore, ganhou passo de decisão, mover-por-arrasto e uma correção de permissão. É trabalho legítimo e aprovado, mas é **volume novo**.

Por isso os três blocos abaixo têm tamanho declarado. **A decisão de fatiar é do Junior**, e a recomendação está no fim.

Tamanhos são estimativa de esforço relativo: **P** = pontual · **M** = dia de trabalho · **G** = vários dias / risco alto.

---

## Bloco 1 — Redesenho do construtor (novo, veio do mockup aprovado)

O que o Junior vê e opera. Tudo aqui já está desenhado e validado por ele no mockup.

| # | Item | Tamanho |
|---|---|---|
| R1 | **Árvore com layout automático.** Coluna = profundidade; pai centralizado entre o primeiro e o último filho. Fios em curva (SVG) com o rótulo da condição escrito na linha. O sistema posiciona — **não existe canvas livre**. | **G** |
| R2 | **Passo "Divide caminho"** com N caminhos nomeados + caminho final para quem não se encaixa. Grava em `automation_step_edges` usando os outcomes que a tabela já aceita (`true`/`false`/`otherwise`). | **M** |
| R3 | **Mover passo soltando sobre uma linha.** A linha mais próxima acende; ao soltar, o nó sai do lugar atual (o filho dele assume a posição) e entra na aresta destino. **3 regras obrigatórias:** raiz não move · passo de decisão não move (mostra aviso explicando) · linhas da própria subárvore não são alvo (impede laço que o compilador da F2 recusaria no publicar). | **G** |
| R4 | **Doca inferior contextual.** Escondida por padrão; abre ao clicar num passo. Mensagem abre alta com editor + biblioteca; espera abre baixa só com os campos. Fecha por ×, clique no vazio e **Esc**. | **M** |
| R5 | **Mapa navegável.** Arrastar o fundo em todas as direções; roda = zoom ancorado no cursor; **piso de zoom (70%)** para fluxo grande abrir legível em vez de espremido; botão "Ajustar". | **M** |
| R6 | **Seletor de automação no topo** (substitui a lista lateral "Seus fluxos") e **gatilho na barra da automação**, fora do mapa — ele é condição de entrada, não passo. | **P** |
| R7 | **Correções de interface achadas pelo Junior usando:** botão desabilitado diz o que falta ("Falta dar um nome e escrever a mensagem") · biblioteca vazia instrui em vez de constatar · etiqueta de canal só em passo que tem canal · aviso de falha vira nota presa ao passo, não banner. | **P** |

### ⚠️ Armadilha técnica obrigatória (R3/R5) — leia antes de codar

`setPointerCapture`, necessário para o arrasto funcionar em todas as direções, **faz o navegador entregar o `click` ao palco e não ao cartão**. Se o clique do passo depender de `click`, ele **não dispara** — aconteceu duas vezes no mockup.

**Solução aplicada e validada:** guardar o elemento em `pointerdown`, decidir em `pointerup` (mouse não andou = clique; andou = arrasto). Teclado continua por `click` com `e.detail === 0`.

**Critério de aceite dos gestos:** (1) clicar num passo abre a doca certa; (2) arrastar a partir de cima de um cartão **não** abre a doca; (3) clicar no vazio fecha; (4) arrastar e soltar numa linha move o passo; (5) tentar mover a decisão mostra aviso.

---

## Bloco 2 — Funcionalidade prevista no plano original (F7–F9)

| # | Item | Tamanho |
|---|---|---|
| N1 | **Roteamento por etiqueta** (a etiqueta do lead escolhe o fluxo) + **reentrada e carência** (esfriou = 5 dias). **Ver N1.1 — etiquetas viram lista escolhida, não texto livre.** | **M** |
| N1.1 | **Etiquetas controladas, em duas famílias separadas** (decidido pelo Junior em 2026-07-20). **Motivo:** o avaliador casa etiqueta por **texto exato** (`deal_tags @> array[valor]`) — `Lentes` ≠ `lentes` faz o fluxo **não disparar sem erro nenhum**, e texto livre transformaria `indicação`/`indicacao`/`Indicação` em três origens no painel. **A secretária nunca digita: seleciona.** | **M** |
| N2 | **Passos de tarefa e de mover etapa/funil**, já usados no mockup (destino real: Funil de Vendas → "Triagem e Qualificação IA"). | **M** |
| N3 | **Mídia.** Bucket próprio `automation-media` (o `deal-files` **não serve** — as policies exigem `deal_id` como primeira pasta) · upload retomável · variantes por canal · **worker ffmpeg na VPS** convertendo para MP4 ≤16MB. Os 12 vídeos do piloto já estão convertidos à mão em `Desktop/Videos Follow-up Dra Jessica/COMPRIMIDOS-WHATSAPP/`. | **G** |
| N4 | **Observabilidade navegável** — ver o que rodou, o que falhou, e por quê. Precisa absorver os itens O2/O3/O4 abaixo. | **M** |

---

### N1.1 — as duas famílias de etiqueta (detalhe)

| | **Etiqueta de SERVIÇO** | **Etiqueta de ORIGEM** |
|---|---|---|
| Responde | o que o paciente quer | de onde o lead veio |
| Função | **escolhe qual automação dispara** (é o gatilho) | **atribuição** — alimenta painel comercial e, depois, conversão pro pixel |
| Exemplos | lentes · ortodontia · estética facial | Anúncio Instagram · Anúncio Google Ads · Perfil Instagram · Indicação |
| Quem cria | **junto com a automação** — o fluxo é dono do próprio gatilho | **configuração da clínica**, criada uma vez e usada por todos os funis |
| Quem usa | secretária **seleciona** | secretária **seleciona** |

**Por que separadas:** numa lista única a secretária veria `lentes` ao lado de `Indicação` sem saber se escolhe uma ou as duas, e o painel perderia o cruzamento que é justamente o objetivo — *quantos leads de indicação fecharam facetas × quantos de anúncio fecharam o mesmo*. São dois campos na mesma tela, cada um com sua lista.

**Regras:**
- A secretária **nunca digita** etiqueta que o sistema lê. Texto livre continua existindo apenas para anotação que nenhuma automação nem relatório consome.
- Renomear o rótulo visível **não** pode quebrar automação publicada nem histórico de métrica — mesma lição do `case_id` estável do `switch`: **identidade estável, rótulo humano separado.**
- Etiqueta de origem em uso não pode ser apagada silenciosamente; arquivar em vez de excluir (mesmo problema do O5).

### N1.2 — decisões fechadas pelo Junior (2026-07-20) — CONTRATO, não reabrir

Fechadas depois do parecer `OPINIAO-CODEX-ETIQUETAS.md` e da adjudicação
`REVIEW-OPINIAO-ETIQUETAS.md`. O Junior **dissolveu** as duas perguntas em aberto
em vez de escolher entre as opções apresentadas — as duas soluções abaixo são
dele, e são melhores que a minha proposta e a do Codex.

**D1 — Quando a paciente muda de interesse no meio do fluxo.**
Não é "congelar na entrada" *versus* "seguir o estado atual". São as duas, cada
uma no seu momento:

1. a paciente responde → **sai do follow-up e vai para atendimento humano**;
2. a secretária edita o procedimento e escreve o contexto na **área de notas**
   (dela ou da IA);
3. se a paciente esfriar de novo, ao **reentrar** no follow-up ela entra pelo
   **procedimento novo**.

Ou seja: o caminho **congela dentro de uma passagem** pelo fluxo, e a passagem
seguinte lê a etiqueta atual. Não é preciso oferecer a escolha por passo.

> 🔴 **O motor NÃO faz isso hoje — implementar na C2.** A mensagem *inbound* da
> paciente **não pausa** a inscrição; ela só resolve o passo se houver
> `automation_waits` com status `pending` (aí segue pelo ramo "Respondeu"). Quem
> pausa de fato é a **secretária ou a IA respondendo** —
> `pause_automation_enrollments_for_thread` é chamada no envio `outbound|internal`
> com motivo `manual_message`
> (`app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts:176-185`,
> `lib/conversations/aiReply.ts:380`).
> **Fresta:** paciente responde 22h · secretária vê 9h · follow-up agendado 8h
> **dispara** e pergunta "ainda tem interesse?" a quem já respondeu.
> **Correção:** inbound que **não** casa com wait — hoje vira
> `result_status = 'unmatched'` e **não faz nada**
> (`20260718040000_funil_f5_waits.sql:395-399`) — deve **pausar a inscrição** e
> mandar para o humano. O lugar já existe; falta a ação.

**D2 — Quando a paciente quer mais de um procedimento.**

> ⚠️ **LEIA ANTES DE IMPLEMENTAR: isto é a EXCEÇÃO, não o caminho normal.**
> **Caminho normal (a esmagadora maioria dos casos): um procedimento, a pessoa
> não responde → entra no follow-up direto.** Sem tarefa, sem porteiro, sem
> decisão humana, sem espera. Nada do que está descrito abaixo acontece.
> A tarefa-porteiro só existe quando há **2 ou mais procedimentos de interesse**
> e a pessoa parou de responder. Implementar o porteiro como etapa geral do
> roteamento **quebraria o fluxo principal do piloto** — é o oposto da decisão.
Nem tela de bloqueio (proposta do Codex), nem principal automático pela primeira
etiqueta (minha emenda). **A tarefa é porteiro, não paralela ao fluxo:**

1. a pessoa demonstra interesse em 2+ procedimentos e **para de responder**;
2. **cria-se a tarefa ANTES de qualquer follow-up** — para a secretária ou para a
   IA decidir pelo teor da conversa qual interesse é o real;
3. só **depois da decisão** ela entra no fluxo, e já entra no fluxo certo.

Como nenhum fluxo começa antes da decisão, **não existe a pergunta** "ela recebe
follow-up enquanto a tarefa está aberta" — não há follow-up para receber. Isso
elimina de vez o risco de começar pelo procedimento errado.

**Por que o caso é raro** (razão do Junior, e é a razão certa): o anúncio já vem
segmentado por procedimento, e quem debate dois procedimentos **está conversando**
— logo não está em follow-up. Não vale desenhar bloqueio para a exceção.

O passo `create_task` **já existe** no motor; isto não inventa mecanismo novo.

**Detalhe de execução que eu carrego para o plano** (julgamento meu, dentro do
escopo — não é decisão nova): a tarefa nasce com **prazo curto, do mesmo dia**.
Ela segura o encaminhamento, e o lead esfria em 5 dias — fila parada vira lead
perdido.

## Bloco 3 — Correções de operação (achadas ao usar, não estavam no plano)

Nenhuma é cosmética. Três delas só aparecem quando o sistema já está rodando na clínica.

| # | Item | Tamanho |
|---|---|---|
| O1 | **Permissão de automação.** Hoje `automation.operate` é **liberada por padrão** para `clinic_staff`/`vendedor` → a secretária veria o menu Automações. **Decisão do Junior:** visível só para agência e admin da clínica; qualquer outro **apenas por toggle manual**. Ação: incluir `automation.operate` em `CLINIC_STAFF_DENIED` + migration nova (o snapshot `role_permission_defaults` está travado por teste de integridade). **Supersede a decisão anterior "a secretária opera, o gestor edita".** | **P** |
| O2 | **O tick falha em silêncio.** `request_automation_tick()` tem `exception when others then return null`. Se a URL estiver errada, o app fora do ar ou o segredo rotacionado, **o motor inteiro para sem sinal nenhum**. Registrar tentativa/resultado do tick e expor na observabilidade. **É o pior modo de falha possível para o piloto.** | **M** |
| O3 | **Job de inscrição pausada queima retentativas.** O dispatch levanta `55000` corretamente (não envia), mas o worker tende a tratar como falha e gastar 5 tentativas até `dead_letter`. Takeover deve **estacionar** o job, não deixá-lo queimar. | **P** |
| O4 | **`unknown` e `dead_letter` param o lead em silêncio.** Comportamento conservador e correto, mas sem fila visível ninguém descobre. Entra na observabilidade (N4). | **P** |
| O5 | **Não é possível excluir uma clínica que já publicou automação.** Descoberto ao limpar o banco local: o guard de imutabilidade das versões bloqueia. Correto como proteção, **mas o cenário real existe** — cliente cancela e o tenant não sai. Definir caminho de **arquivar em vez de apagar**, ou rotina administrativa que remova na ordem certa. | **M** |
| O6 | **Higiene de teste** (herdado, não bloqueia): teste não deveria sequer resolver a URL de produção. Forçar loopback no setup do Vitest e falhar alto se aparecer o ref de produção. | **P** |

---

## Recomendação de fatiamento

**C1 — o que o Junior vê (Bloco 1 + O1).** Entrega a tela aprovada e fecha a permissão antes de qualquer pessoa a mais entrar no sistema. É o marco demonstrável.

**C2 — o que faz funcionar de verdade (N1, N2, O2, O3, O4).** Roteamento, tarefas e a observabilidade que torna as falhas visíveis. **O2 deveria vir junto com o primeiro envio real** — ligar envio de verdade com o motor podendo parar calado é o risco mais alto do projeto.

**C3 — mídia (N3) + O5.** É o bloco mais pesado e o único que depende de infraestrutura nova (worker na VPS). Separado, não atrasa o resto.

**O6** entra em qualquer uma, é pontual.

> **Regra que não muda:** nada é aplicado no banco da clínica nem deployado sem aprovação do Junior. `automation_live_enabled` segue `false` até ele mandar ligar.

## Critério de sucesso da C1

O Junior abre Automações na clínica de demonstração, monta um fluxo com três caminhos por serviço, move um passo de um ramo para outro arrastando, publica, roda o teste simulado — **sem precisar de mim para nada disso** — e a secretária, com o cargo dela, **não enxerga o menu Automações**.
