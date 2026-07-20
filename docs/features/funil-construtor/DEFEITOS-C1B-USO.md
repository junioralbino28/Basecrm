# Defeitos da C1B achados pelo Junior usando a tela

Data: 2026-07-20
Contexto: o Junior abriu o construtor no `dev:local` (parte combinada do aceite da
C1B — "se ele achar algo ruim de usar, é defeito, não pedido novo"). Reportou 3
coisas. Diagnostiquei cada uma no código antes de classificar.

---

## 1. 🔴 DEFEITO — clique no card não abre a doca (o mais grave)

**Sintoma do Junior:** "quando clico no card não abre a tela de edição."

**Causa-raiz, confirmada em `features/automations/AutomationFlowMap.tsx`:**

- `onPointerMove` (linha 237) marca `press.moved = true` assim que o ponteiro
  desloca **> 4px** do ponto inicial.
- `onPointerUp` (linha 255): `if (!press || press.moved) return;` — qualquer
  `moved` aborta **antes** de `onStepActivate`.
- Como o press começou num card, `press.stepKey` está preenchido e o pan é
  bloqueado na linha 245 (`if (press.stepKey) return;`).

Resultado: um clique com o menor tremor (> 4px) num card **não paneia** (é card) e
**não abre a doca** (moved abortou). O card fica morto para qualquer clique que
não seja cirurgicamente imóvel. Um clique de 0px abre; o dedo humano real quase
nunca é 0px.

**Por que passou no aceite do Codex:** o teste de gesto simula
`pointerdown → pointerup` sem movimento intermediário, então `moved` fica false e
a doca abre — teste verde. Só o uso humano, com micro-tremor, dispara. É
exatamente a classe de falha que só aparece no uso real, e o motivo de o retorno
do Junior ser parte da entrega.

**É a armadilha de gesto de novo, em variante nova.** Não é o `setPointerCapture`
roubando o clique (essa foi resolvida). É o threshold de `moved` tratando tremor
de clique como arrasto, **num nó onde arrastar não tem ação nesta fatia**.

**Correção pedida (o "o quê", não o "como" — o Codex decide a implementação):**
num press que começou num card (`stepKey != null`), como **mover card é C1C e não
existe aqui**, o movimento não deve invalidar o clique. Abrir a doca no
`pointerUp` quando o press é de card e não houve operação de mover válida. Ou
elevar o limiar de clique×arrasto para cards. **Escrever um teste que simule
pointerdown → pointermove de ~6px → pointerup e exija que a doca abra** — o teste
atual não cobre o tremor, e é essa lacuna que deixou o defeito passar.

## 2. 🎨 DEFEITO visual — fundo do mapa com a paleta errada

**Sintoma do Junior:** "o fundo pegou configuração antiga de UX."

**Confirmado:** `AutomationFlowMap.tsx:190` usa `bg-slate-950` — o dark azulado
genérico do resto do CRM. O mockup aprovado (`mockup-tela-real.html`) usa o
**verde-petróleo escuro** da identidade do construtor: `#10201C` / `#0F1614` /
`#04201C`. O grid de pontos radiais está correto (26px, branco a baixa opacidade);
só a cor de base do fundo destoa.

**Correção pedida:** trocar o fundo do mapa do `slate-950` para a base
verde-petróleo do mockup. Alinhar com os tokens do mockup, não inventar novo tom.

## 3. ✅ NÃO é defeito — cards não se movem (esperado nesta fatia)

**Sintoma do Junior:** "os cards não consigo mover."

**Esperado.** Mover passo soltando na linha é **R3**, deliberadamente adiado para
a **C1C** (decisão registrada no `PEDIDO-C1B.md`: "R2 e R3 ficam para a C1C").
O bloqueio de pan quando o press começa no card (linha 245) está lá justamente
porque a interação de mover card ainda vai existir; hoje ela só ainda não tem
ação.

**Ressalva:** a soma do item 1 com este faz o card parecer **completamente
morto** — não move e não abre. Corrigido o item 1, o card volta a responder ao
clique, e a ausência de arrasto passa a ser aceitável até a C1C.

---

## Encaminhamento

Itens 1 e 2 são **defeitos da C1B**, não pedidos novos — o critério de aceite era
"monta um funil do começo ao fim sem travar", e clicar num passo para editar é o
gesto central. Vão para o Codex corrigir na abertura da C1C, **antes** de começar
R2/R3. Item 3 é o próprio conteúdo da C1C.
