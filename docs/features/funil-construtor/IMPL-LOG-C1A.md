# IMPL-LOG — C1A (contrato e segurança)

Data: 2026-07-20  
Branch: `feat/funil-construtor`  
Escopo executado: `PLAN-C1A.md`, T1 a T8, na ordem.

## Resultado

A C1A foi concluída como a fatia invisível prevista no plano:

- toda a bateria de testes fica impedida de resolver o Supabase de produção;
- o contrato persistido e o compilador aceitam `switch` N-ário com outcomes tipados;
- o builder v1 recusa convergência e mantém a invariante de árvore com pai único;
- publicações novas usam `schemaVersion: 2`, mantendo snapshots v1 legíveis;
- o motor avalia o `switch`, registra o ramo escolhido e reaproveita a transição existente;
- os defaults de permissão v1 foram preservados, v2 foi ativada por ponteiro e
  `automation.operate` ficou negada para `clinic_staff` e `vendedor`;
- o tick passou a registrar tentativa, emissão, recebimento, conclusão e falha;
- o banco recusa habilitar envio real quando o tick está degradado, sem bloquear
  o consumo de jobs que já estavam materializados.

Nenhuma alteração visual faz parte desta entrega. A interface continua reservada
para a C1B.

## Commits

| Tarefa | Commit | Descrição |
| --- | --- | --- |
| T1 | `8971a5d` | `test: impede a bateria de resolver o Supabase de producao` |
| T2 | `9476cb1` | `feat(funil): adiciona tipo switch ao schema` |
| T3 | `4482086` | `feat(funil): compilador valida passo switch` |
| T4 | `fff3592` | `feat(funil): builder v1 exige arvore com pai unico` |
| T5 | `2c9fa79` | `feat(funil): publica definicao com schemaVersion 2` |
| T6 | `5413163` | `feat(funil): motor avalia passo switch` |
| T7 | `cc4a16c` | `feat(auth): defaults v2 com ponteiro ativo e automation.operate restrita` |
| T8 | `7e24b64` | `feat(funil): saude do tick e gate para habilitar envio real` |

## Evidências de TDD e verificação

Cada tarefa começou com teste vermelho para o comportamento novo e terminou com
`precheck:fast` verde. A contagem de testes aprovados ao fim de cada fase foi:

- T1: 626;
- T2: 626;
- T3: 634;
- T4: 635;
- T5: 635;
- T6: 635;
- T7: 641;
- T8: 646.

Na T8, os testes vermelhos cobriram migration ausente e rota sem ciclo de saúde.
Depois da implementação:

- testes estáticos e da rota: 5 passando, 0 falhas;
- saúde do tick no Supabase local: 5 passando, 0 falhas;
- regressão isolada do scheduler F4: 4 passando, 0 falhas;
- reset completo do Supabase local seguido da bateria integrada de T2, T5, T6,
  T7, T8 e F4: 36 passando, 0 falhas;
- `npm run precheck:fast`: lint e TypeScript verdes; 646 testes passando,
  125 ignorados e 0 falhas.

O teste bloqueante derrubou a saúde do tick de propósito, confirmou erro SQL
`55000` ao tentar ativar `automation_live_enabled` e provou que um job já
materializado continuava disponível para claim.

## Decisões e desvios registrados

1. A migration de T2 também incluiu `switch` no constraint de
   `automation_jobs.step_type`. O plano citava apenas o constraint do authoring,
   mas omitir o constraint da fila impediria a execução de um switch publicado.
2. O executor do switch usa `deals.tags`, que é o campo de etiquetas existente no
   schema real. `contacts` não possui coluna `tags`. O contrato legado de
   `condition` que consulta `contact.tags` não foi alterado nesta fatia.
3. Como não existia uma ação central de ativação do envio real, T8 criou defesa em
   profundidade: trigger no banco para toda transição `false -> true` e RPC interna
   `set_automation_live_enabled`. Assim, uma escrita alternativa não contorna o
   gate de saúde.
4. O plano exigia limites, mas não fixava números. Foram adotados: no máximo 20
   casos por switch, rótulo de até 80 caracteres e valor de até 200 caracteres.
5. A saúde usa estado singleton, portanto não cresce a cada tick. O token UUID da
   tentativa impede que uma resposta atrasada conclua uma tentativa mais nova.

## Segurança operacional

- Todos os resets, migrations e testes de banco usaram somente o Supabase local.
- O ref de produção `eqidsihasmwwamkaqfka` não foi acessado.
- `automation_live_enabled` permaneceu `false`; a única tentativa de ativação foi
  local, propositalmente degradada e recusada pelo gate.
- Não houve push nem deploy.

## O que não foi possível verificar sem navegador

A C1A não altera interface, portanto não há jornada visual nova para demonstrar.
Os testes verificaram a ocultação do menu por permissão e o `403` do endpoint,
mas esta sessão não fez uma inspeção visual autenticada com os cinco cargos.

Também não foi executado um tick HTTP real com secrets válidos e uma aplicação
local aberta. O contrato ponta a ponta foi validado no banco e na rota, com o
`pg_net` local, incluindo os estados de emissão, recebimento, sucesso e falha.

## Próximo gate

Não iniciar a C1B antes da revisão independente do Claude em
`REVIEW-ENTREGA-C1A.md`.
