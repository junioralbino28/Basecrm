# Pedido de execução ao Codex — Entrega C1B (a fatia visível)

Data do despacho: 2026-07-20
Entregue ao Codex pelo Junior. Registrado aqui para não viver só no chat.

---

## Contexto

As decisões de etiquetas foram fechadas e adjudicadas enquanto o Codex estava
fora. Leitura obrigatória antes de começar, nesta ordem:

1. `REVIEW-OPINIAO-ETIQUETAS.md` — adjudicação do parecer dele. **Aceito**, com
   uma emenda e uma correção de medição minha.
2. `SPEC-ENTREGA-C.md` **§N1.2** — o contrato fechado pelo Junior. **Não
   reabrir.**
3. `AGENTS.md` — as regras valem mesmo sem prompt de aprovação.

## T0 — correção pendente da C1A (antes de tudo)

`test/funilTickHealth.local.test.ts` só passa em banco limpo: asserta valor
absoluto num contador singleton persistente (`REVIEW-ENTREGA-C1A.md` §4).
Corrigir para assertar **delta**, não valor absoluto.

**Critério:** rodar a suíte local duas vezes seguidas, sem `db reset` no meio, e
passar nas duas.

> Decisão minha: T0 entra **dentro** desta entrega em vez de virar rodada
> separada. É pequena, e ida e volta por causa dela só atrasa a tela.

## Escopo — R1, R4, R5, R6, R7 do `SPEC-ENTREGA-C.md`

**R2 e R3 ficam para a C1C.** Não implementar mover-soltando-na-linha agora.

| | Item |
|---|---|
| **R1** | Árvore com layout automático: coluna = profundidade, pai centralizado entre primeiro e último filho, fios em curva SVG com o rótulo da condição escrito na linha. |
| **R4** | Doca inferior contextual: escondida por padrão, abre ao clicar num passo. Mensagem abre alta (editor + biblioteca); espera abre baixa. Fecha por ×, clique no vazio e **Esc**. |
| **R5** | Mapa navegável: arrastar o fundo em todas as direções, roda = zoom ancorado no cursor, **piso de zoom 70%**, botão "Ajustar". |
| **R6** | Seletor de automação no topo (substitui a lista lateral "Seus fluxos") e gatilho na barra da automação, fora do mapa. |
| **R7** | Correções de interface achadas pelo Junior usando: botão desabilitado diz o que falta · biblioteca vazia instrui · etiqueta de canal só onde há canal · falha vira nota presa ao passo. |

**Referência visual oficial:** `mockup-tela-real.html`, aprovado pelo Junior
depois de 5 iterações. **Implementar, não redesenhar.** Mapa navegável **não é
canvas livre** — o sistema posiciona.

## Duas amarrações obrigatórias

**1. Nada de acoplamento novo a texto.** A C1B **não pode** criar seletor de
gatilho baseado em texto livre de `deals.tags`. Onde a tela precisar de etiqueta,
deixar fronteira substituível pelo seletor de entidades da C2 (UUID +
`schemaVersion: 3`). Consolidar texto agora faz a C2 nascer desfazendo trabalho
novo — foi exatamente assim que GHL e Kommo se prenderam
(`PESQUISA-ETIQUETAS.md`).

**2. Armadilha de gesto — já custou 2 rodadas.** `setPointerCapture` faz o clique
ir para o palco, não para o cartão. Usar a máquina de estados com captura tardia
que o próprio Codex propôs em `OPINIAO-CODEX-C1.md`. O `mockup-tela-real.html`
tem a solução funcionando: `pressStep` registrado no `pointerdown`, decidido no
`pointerup`.

## Regras

- Supabase **local** apenas; nunca o banco da clínica (`eqidsihasmwwamkaqfka`).
- **Sem push, sem deploy.**
- `automation_live_enabled` segue `false`; `delivery_mode` segue `simulation`.
- `npm run precheck:fast` tem que passar.
- PT-BR.

## Entrega

Commits separados por tarefa + `IMPL-LOG-C1B.md`. **Não iniciar a C1C.**

## Critério de aceite

O Junior abre a tela no localhost (`npm run dev:local`) e monta um funil do começo
ao fim sem travar.

**O retorno dele é parte da entrega: se ele achar algo ruim de usar, isso é
defeito da C1B, não pedido novo.**

> Decisão minha, e é proposital: sem isso escrito, retorno de usabilidade vira
> "escopo extra" e escorrega para a entrega seguinte — foi assim que o design
> ficou ruim na primeira vez.
