# Pedido de execução — Entrega C1C (mover passo + divide caminho)

> Fatia visível nº2 do construtor. **R2 e R3** do `SPEC-ENTREGA-C.md`.
> Referência visual e de comportamento: **`mockup-tela-real.html`** — aprovado pelo
> Junior depois de 5 iterações. **Não redesenhar: implementar.**

## Contexto — o que mudou desde a C1B

A C1B foi entregue, aprovada (`REVIEW-ENTREGA-C1B.md`) e depois **polida ao vivo**:
o Junior operou a tela e eu corrigi 7 coisas com ele testando ao lado (commits
`f258c88` → `e314d7a`, mais `684de95` na sidebar). **Leia antes de começar**, porque
mexe direto no que você vai tocar:

| O que mudou | Onde | Por que te afeta na C1C |
|---|---|---|
| **`CLICK_SLOP = 10`** — clique num card abre a doca mesmo com tremor até 10px | `AutomationFlowMap.tsx` (`onPointerUp`) | **É exatamente o ponto que a C1C reescreve.** Hoje qualquer press que começa num card e anda >10px **não faz nada** — esse "nada" vira o arrasto de mover. |
| **Câmera centraliza no passo** ao abrir a doca (`centerAutomationViewportOn`) | `automationViewport.ts` | Ao mover um passo, a árvore relayouta; cuidar para a câmera não dar pulo. |
| **`wheel` preso com `{ passive: false }`** | `AutomationFlowMap.tsx` | Não voltar a usar `onWheel` do React: o `preventDefault` é ignorado e a página rola. |
| **`fitMap` usa o contorno real da árvore** | `AutomationFlowMap.tsx` | Depois de mover, "Ajustar" precisa continuar certo. |
| **Cores do mockup** (`#0F1614` mapa, `#0B100F` barra/doca, bordas `white/10`) | mapa, doca, barra | Estados novos (arrastando, linha-alvo) usam os tokens do mockup, não slate. |

**Regra que continua valendo:** a C1C **não pode** criar seletor de gatilho por
texto livre de `deals.tags` — a fronteira `service-tag-entity-v3` espera o seletor
de entidades da C2 (UUID + `schemaVersion: 3`).

---

## R3 — Mover passo soltando na linha

O mockup implementa isto por inteiro (linhas ~605-712). **Copie o comportamento, não
invente.** O que ele faz:

**1. A linha mais próxima acende.** Durante o arrasto, calcula a distância do cursor
ao ponto médio de cada aresta e destaca a mais próxima **dentro de um raio de 150px**
(`dist = 150` no mockup). Se nenhuma estiver no raio, nenhuma acende e soltar não faz
nada. No mockup o alvo é uma faixa (`.drop.on`: 6px, cor `--accent`, halo suave).

**2. Ao soltar, o nó é recosturado** (função `mover(n, aresta)`):
- o **filho do nó movido assume o lugar dele** no pai (`meu.node` ocupa `iNoPai`);
  se ele não tinha filho, o nó simplesmente sai da lista do pai;
- a aresta destino `A -> B` vira `A -> n`, e **`n -> B`**.
Ou seja: o passo é **extraído e reinserido no meio da aresta escolhida**, sem
quebrar a corrente.

**3. Três impedimentos obrigatórios** (`podeMover` + o filtro do laço):
- **raiz não move** → aviso: *"O primeiro passo não pode mudar de lugar."*
- **passo que divide caminhos não move** (mais de um filho) → aviso: *"Um passo que
  divide caminhos não pode ser movido — moveria a árvore inteira junto."*
- **arestas da própria subárvore não são alvo** (`naSubarvore(n, B) || a.pai === n
  || B === n`) → impede o laço que o compilador da F2 recusaria no publicar.

O aviso do mockup aparece **no topo do palco** e some sozinho (~2,6s), não é banner
de página. Ele é mostrado **no momento em que o arrasto começa** (não ao soltar) —
o gesto é abortado ali.

**4. O gesto** — máquina de estados com captura tardia, como você mesmo propôs na
`OPINIAO-CODEX-C1.md`, respeitando o que já está no código:
- `pointerdown` num card registra o candidato (não captura ainda);
- passou do limiar → vira arrasto: valida `podeMover`, marca o card como
  `is-dragging`, o palco como `is-sorting`;
- **abaixo de `CLICK_SLOP` (10px) continua sendo clique e abre a doca** — este
  comportamento é **regressão proibida**: foi defeito relatado pelo Junior
  (`DEFEITOS-C1B-USO.md` §1) e tem teste (`AutomationFlowMap.test.tsx`, "abre a
  edição no clique com o tremor natural da mão"). **Não apagar esse teste.**
- **arrastar o fundo continua sendo pan** (o card não pode roubar o pan).

**5. Teclado.** O mockup é mouse-only; a tela real precisa de caminho por teclado
para mover (a doca já fecha por `Esc`, o card já ativa por teclado com
`event.detail === 0`). Proponha o mínimo viável e descreva no `IMPL-LOG`.

**6. Persistência.** Mover altera `automation_step_edges`. Salvar segue pelo caminho
que já existe (`salvar rascunho` com `expected_draft_revision`) — **não criar rota
nova**. Depois de mover, o rascunho fica sujo como qualquer outra edição.

---

## R2 — Passo "Divide caminho"

O motor **já suporta** (entregue na C1A, não reimplementar):

- tipo de passo **`switch`** com N casos, cada um com **`case_id` estável** e rótulo
  separado (renomear rótulo não quebra publicação);
- **avaliador N-ário** no banco (`evaluate_automation_switch`), ordenação por
  `order` e depois `caseId`, com saída `case:<uuid>` ou `otherwise`;
- outcome no formato `case:<uuid>` já aceito pela constraint
  (`20260720000000_funil_c1a_switch.sql`);
- `unique (from_step_id, "order")`.

**Falta a interface.** O que ela precisa entregar:
- criar um passo que divide em **N caminhos nomeados** + o caminho final
  **"para quem não se encaixa"** (`otherwise`);
- cada caminho com **rótulo editável** (o que aparece escrito na linha da árvore);
- ordem dos caminhos **visível e reordenável** — a regra é **"o primeiro caminho
  compatível vence"**, e isso não pode ser surpresa para quem monta (foi condição
  explícita da adjudicação `REVIEW-OPINIAO-C1.md`);
- respeitar `schemaVersion: 2` na publicação; **não antecipar o `v3`** (é C2).

**Atenção ao campo de comparação:** o whitelist do avaliador é literal em SQL
(`'deal.tags'`, `'contact.phone'`, `'deal.stage_id'`, `'deal.board_id'` —
`20260720010000_funil_c1a_switch_exec.sql:62`). A C1C **não** adiciona campo novo e
**não** consolida seletor de etiqueta por texto — deixa a mesma fronteira da C1B.

---

## Fora de escopo (não começar)

- Qualquer coisa de **etiquetas / `tag_ids` / `schemaVersion: 3`** → é C2.
- Pausar automação no inbound `unmatched` → é C2.
- Mídia, ciclo de vida do tenant → é C3.

## Dívidas a pagar junto (pequenas, já diagnosticadas)

1. **`test/funilAuthoringIsolation.local.test.ts` falha** — herdado da C1A. O sistema
   está certo: `clinic_staff` não lê automações desde que `automation.operate` saiu
   do default. **Inverter a expectativa do teste. Nunca mexer na policy.**
   (`REVIEW-ENTREGA-C1B.md` §2)
2. **`npm run test:local`** — exportar `E2_SUPABASE_*` a partir de `supabase status`
   **validando que a URL é 127.0.0.1 antes de rodar**. Sem isso, `precheck:fast`
   ignora 125 de 793 testes **em silêncio** e "0 falhas" não significa o que parece.
   (`REVIEW-ENTREGA-C1B.md` §3)

## Regras da entrega

- Supabase **local** apenas; nunca `eqidsihasmwwamkaqfka`.
- **Sem push, sem deploy.** `automation_live_enabled = false`,
  `delivery_mode = 'simulation'`.
- `npm run precheck:fast` verde — **e rode também a suíte local completa** (é o
  ponto da dívida nº2). Hoje o baseline é **670 passando, 0 falhas**.
- TDD, commits separados por tarefa, `IMPL-LOG-C1C.md` ao final.
- Ler o `AGENTS.md` — **as regras valem mesmo sem prompt de aprovação**.
- PT-BR.

## Critério de aceite

O Junior abre `npm run dev:local`, **arrasta um passo e solta sobre uma linha**, e o
fluxo se recompõe do jeito que ele espera — sem o card ficar morto, sem laço, sem
perder o clique que abre a edição. E consegue **criar um passo que divide em 3
caminhos** e entender, olhando a tela, **qual vence primeiro**.

Como na C1B: **o retorno dele usando é parte da entrega.** Se ele achar ruim de usar,
é defeito da C1C, não pedido novo.
