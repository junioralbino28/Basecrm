# Revisão — Entrega C1C (mover passo + divide caminho)

Data: 2026-07-21
Entrega revisada: `e9bf4c4`, branch `feat/funil-construtor`
Método: verificação independente. Nenhuma alegação do relatório aceita sem conferir
no código ou executar na minha mão.

---

## Veredito

**APROVADA, sem correção pendente.** É a primeira entrega desta série que passa
sem eu abrir defeito.

As **3 condições** que impus no adendo do `PEDIDO-C1C.md` foram cumpridas — e uma
delas foi **implementada melhor do que eu pedi** (§2). As **2 dívidas** foram pagas
do jeito certo.

---

## 1. Produção intacta — por construção

- `main` segue em `be7fe35`, **34 migrations**, nada deployado.
- **A C1C não tem uma linha de migration:**
  `git diff --name-only ab82093..e9bf4c4 -- supabase/` → **0 arquivos**.
  Toda a entrega é aplicação e teste. Não havia como afetar o banco da clínica.
- Worktree limpo, sem push.

## 2. Condição nº2 (meu achado) — CUMPRIDA, e generalizada

Era a mais importante: **o caminho do `switch` não pode sumir** quando o último
passo dele é arrastado para fora.

`automationGraphMove.ts:99-112`:

```ts
if (
  !replacementForIncoming        // o nó movido não tinha filho
  && parent
  && (parent.stepType === 'switch' || parentBranchCount > 1)
) {
  const placeholderKey = createStepKey();
  replacementForIncoming = placeholderKey;
  nextSteps.push({ ... config: { title: 'Configurar este caminho' } });
}
```

**Ele foi além da minha condição.** Eu escrevi "se o pai for um `switch`"; ele
cobriu `parent.stepType === 'switch' **|| parentBranchCount > 1**`. Isso pega
também o `wait_for_event`, que tem dois caminhos (`respondeu` / `não respondeu`) e
sofreria exatamente do mesmo apagamento silencioso. **A generalização está certa e
eu não tinha visto.**

**Teste explícito existe**, como exigi — `automationGraphMove.test.ts:100`:
*"ao mover uma folha de caminho do switch preserva a aresta com placeholder"*,
inclusive afirmando `expect(moved.edges).not.toContainEqual(switchEdge)` e a nova
aresta apontando para o placeholder.

## 3. Condições nº1 e nº3 — CUMPRIDAS, com o texto pedido

`automationSwitchDraft.ts:8-10`:

- remoção bloqueada: *"Este caminho tem passos abaixo. Mova ou remova esses passos
  antes de apagar o caminho."* — **diz o que fazer**, não barra seco (régua do R7);
- limite: *"Limite de 20 caminhos atingido. Remova um caminho antes de adicionar
  outro."* — PT-BR claro, não erro de validação.

## 4. A regra de precedência está visível (condição herdada da adjudicação C1)

`AutomationSwitchEditor.tsx:65`: *"Avaliamos de cima para baixo: o primeiro caminho
compatível vence."* e `:213` *"Caminho final · para quem não se encaixa"*.

Era condição explícita do `REVIEW-OPINIAO-C1.md`: a ordem não pode ser surpresa
para quem monta. Cumprida.

## 5. Dívidas — as duas pagas corretamente

**`npm run test:local` (`scripts/test-local.mjs`):**
- recusa alvo não-local **duas vezes**, com erro explícito:
  *"RECUSADO: o runner aceita somente o Supabase local em 127.0.0.1:54321."*;
- **não vaza chave** — o único `console.log` diz apenas
  `"Testes: Supabase LOCAL (127.0.0.1:54321) — dados de teste."`, e eu tinha
  alertado que `supabase status -o env` imprime `ANON_KEY`/`SERVICE_ROLE_KEY` em
  texto;
- tem teste próprio (`test/testLocalRunner.test.ts`).

**Teste de isolamento herdado da C1A** — corrigido do jeito exigido: **inverteu
apenas a expectativa**, `expect(selected.data).toEqual([])`, e renomeou o caso para
*"operador não lê nem altera draft, grafo ou templates"*. **A policy não foi
tocada** (confirmei no diff). Era a linha vermelha: o sistema estava certo, o teste
é que não tinha acompanhado a decisão do Junior.

## 6. Gates rodados na minha mão

| Gate | Resultado |
|---|---|
| `npm run test:local` | **830 / 830 passando**, 180 arquivos, 0 falhas |
| `npm run lint` | verde (`--max-warnings 0`) |
| `npx tsc --noEmit` | verde |

**O número 830 é o ponto alto desta entrega.** Até ontem o gate dizia "0 falhas"
rodando 668 e **ignorando 125 testes em silêncio** — foi a dívida que eu mesmo
levantei na revisão da C1B. Agora a suíte completa roda de verdade, com trava que
recusa qualquer banco que não seja o local.

## 7. Observação sem gravidade

Durante a suíte apareceu um `DELETE ... /deal_notes ... 400 (Bad Request)` na
limpeza de fixtures. **Não falhou teste algum** (830/830) e não é da C1C — é ruído
de teardown. Registrado para não virar surpresa depois; não bloqueia nada.

---

## O que falta para o Junior

Nada meu. **Falta ele operar a tela** — como na C1B, o retorno dele usando é parte
do aceite, e foi assim que apareceram os defeitos que nenhum teste pegaria.

Roteiro no `IMPL-LOG-C1C.md`. O que exercitar:
1. **arrastar um passo e soltar sobre uma linha** — a linha acende dentro do raio;
2. tentar **arrastar o primeiro passo** e o **passo que divide caminhos** — devem
   recusar com aviso no topo do palco;
3. **mover pelo teclado**, pela doca ("entre X e Y");
4. criar um **"Divide caminho"** com 3 caminhos + o final, e conferir se dá para
   entender **qual vence primeiro** só olhando;
5. **arrastar o último passo de um caminho** e confirmar que o caminho **continua
   lá**, com o passo "Configurar este caminho" — é o achado desta rodada.
