# IMPL-LOG — C2B (o motor passa a rotear)

Data: 2026-07-22  
Branch: `feat/funil-construtor`  
Escopo executado: somente C2B de `PEDIDO-C2B.md`, com a correção conceitual e o
marco temporal aprovados em `REVIEW-PLANO-C2B.md`. Tela (C2C), executores gerais e
observabilidade N2 (C2D), mídia (C3), push e deploy não foram iniciados.

## Resultado

A C2B encerra o estado “publica, mas ninguém entra” sem iniciar follow-up durante
uma conversa ativa:

- aplicar, remover ou tornar principal uma etiqueta continua sendo operação de
  CRM e **não cria inscrição**;
- toda mensagem da conversa, inbound ou outbound, atualiza um relógio tenant-safe
  para cinco dias após o evento mais recente;
- o tick reconcilia relógios vencidos por `FOR UPDATE SKIP LOCKED` e cria um evento
  imutável ligado à mensagem e à conversa de origem;
- com um procedimento elegível, o evento e a inscrição são persistidos na mesma
  transação; a inscrição congela `entry_tag_id`, `routing_event_id`, versão,
  conversa, contato e canal;
- a unicidade por evento torna retry e ticks concorrentes idempotentes;
- com dois ou mais procedimentos, nasce somente a tarefa-porteiro especializada,
  com prazo no mesmo dia local. Nenhuma inscrição é criada antes da decisão;
- resolver o porteiro duas vezes com a mesma escolha devolve a mesma inscrição;
  uma escolha diferente ou um porteiro cancelado é recusado;
- nova atividade cancela tarefa/porteiro ainda abertos e reinicia a carência;
- inbound que não corresponde a uma espera pendente pausa a passagem ativa com
  `pause_reason = patient_inbound`; inbox duplicada não repete a transição;
- inbound que corresponde a uma espera continua seguindo o ramo `answered`, sem
  ser convertido em takeover;
- a reentrada só ocorre depois de cinco dias completos e consulta novamente as
  atribuições atuais. O teste troca o procedimento entre passagens e confirma que
  a nova inscrição usa o novo UUID;
- publicação nova usa `schemaVersion: 3`, trigger `tagId` e switch
  `deal.tag_ids`; `caseId` continua sendo a identidade independente do ramo;
- snapshots v1/v2 permanecem imutáveis e o executor textual por `deal.tags`
  continua funcionando lado a lado;
- publicar duas automações ativas para o mesmo gatilho é recusado com orientação
  para pausar a atual antes de publicar outra;
- o tick interno passou a executar o roteamento antes de expirar waits e
  materializar jobs, e informa a contagem `routed`.

## Modelo de consistência

| Risco | Garantia implementada |
| --- | --- |
| Dois ticks para a mesma conversa | lock com `SKIP LOCKED` + evento único por mensagem de origem |
| Retry do roteamento | inscrição única por `routing_event_id` |
| Inscrição sem etiqueta | atribuição ativa é validada e evento/inscrição fecham na mesma transação |
| Contexto escolhido por chute | thread, contato, negócio e canal vêm do relógio da própria conversa |
| Mudança de procedimento no meio do fluxo | `entry_tag_id` congela a passagem atual; nova passagem resolve o estado atual |
| Resposta concorrendo com envio | inscrição pausada impede `prepare_automation_outbound` de materializar a mensagem |
| Ambiguidade com 2+ interesses | tarefa-porteiro; nenhuma inscrição antes da resolução |

## Migrations novas

| Migration | Responsabilidade |
| --- | --- |
| `20260722040000_c2b_publication_v3.sql` | dependências v2/v3, serialização da publicação e gatilho único ativo |
| `20260722050000_c2b_cooling_routing.sql` | relógio, eventos/candidatos, porteiro, inscrição atômica e tick concorrente |
| `20260722060000_c2b_switch_exec_v3.sql` | executor UUID v3 com caminho textual v1/v2 preservado |
| `20260722070000_c2b_inbound_pause.sql` | pausa idempotente do follow-up no inbound sem wait |
| `20260722080000_c2b_routing_lint.sql` | remove estado PL/pgSQL não utilizado, sem alterar a semântica do roteador |

Nenhuma migration anterior foi modificada e nenhuma versão publicada foi
reescrita.

## Commits

| Fase | Commit | Descrição |
| --- | --- | --- |
| Publicação v3 | `2c37f7a` | `feat(automacoes): publica gatilhos e caminhos por etiqueta UUID` |
| Esfriamento/porteiro | `0e1270f` | `feat(automacoes): roteia conversas esfriadas com porteiro` |
| Executor v3 | `f014b2b` | `feat(automacoes): executa caminhos v3 por etiqueta UUID` |
| Inbound/reentrada | `1923ce2` | `fix(automacoes): pausa follow-up ao receber inbound` |
| Fixture herdada | `0188b10` | `test(automacoes): usa gatilho UUID na outbox local` |
| Lint SQL | `65ab278` | `chore(automacoes): elimina warning do roteador` |

## Evidências de TDD e corrida

As baterias de contrato foram executadas em RED antes das migrations
correspondentes. A validação local cobre:

- atribuir interesse sem criar inscrição;
- dois roteadores concorrentes produzindo um evento e uma inscrição;
- mensagem inbound ou outbound mais recente reiniciando exatamente cinco dias;
- um procedimento seguindo direto, sem tarefa;
- dois procedimentos criando uma tarefa e zero inscrições;
- resolução repetida do porteiro retornando a mesma inscrição;
- publicação concorrente/duplicada para o mesmo gatilho sendo recusada;
- switch v3 com múltiplos UUIDs respeitando `order` e `caseId`;
- snapshot v2 real executando pelo nome legado sem conversão;
- resposta e materialização disputando a passagem sem gerar outbound após pausa;
- inbox duplicada permanecendo idempotente;
- reentrada barrada antes da carência e aceita depois com o procedimento atual;
- FKs compostas impedindo referências entre tenants.

O baseline registrado no pedido era **848/848**. Gates finais, executados depois
da última migration:

- `npm run test:local`: **191 arquivos, 869 testes passando, 0 falha**;
- `npm run precheck:fast`: lint e TypeScript verdes; **728 testes passando, 141
  ignorados, 0 falha**;
- `supabase db lint --local --level warning`: **No schema errors found**.

O runner ainda imprime um `DELETE ... deal_notes ... 400` de uma suíte herdada,
como já registrado na C2A; o teste e os gates encerram verdes.

## Segurança operacional

- Somente o Supabase local em `127.0.0.1:54321` foi usado.
- O projeto de produção `eqidsihasmwwamkaqfka` não foi acessado.
- A conferência final encontrou **0** organizações locais com
  `automation_live_enabled = true`.
- As **56** automações presentes no banco local após os gates estavam em
  `delivery_mode = simulation`.
- Não houve `db reset`, push nem deploy.

## Como o Junior valida esta fatia

A C2B é intencionalmente invisível na interface; a operação visual entra na C2C.
O aceite desta fatia é automatizado:

1. Abra um terminal no repositório com Docker/Supabase local ativo.
2. Rode `npm run test:local`.
3. O resultado esperado é `191 passed` e `869 passed`, sem falhas.
4. Rode `npm run precheck:fast`; lint, TypeScript e a suíte padrão devem encerrar
   verdes.

O comportamento demonstrado pelos testes é: etiqueta registra interesse; cinco
dias sem atividade roteiam; um interesse inicia o follow-up; dois ou mais criam o
porteiro; resposta da pessoa pausa a passagem; uma nova passagem só nasce após uma
nova carência completa.
