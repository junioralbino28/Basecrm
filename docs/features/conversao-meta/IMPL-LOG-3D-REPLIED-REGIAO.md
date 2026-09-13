# IMPL-LOG 3d — "Lead respondeu e é da região" (evento intermediário para otimização)

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (Claude constrói, inclusive motor; Codex revisa este pedaço fechado)
**Estado:** implementado, provado no Supabase local, **aguardando revisão pontual do Codex** e rollout
**SPEC:** `SPEC.md` nesta pasta (frente 3; quarta e última peça do rastreamento)

## 1. Decisão que originou

Requisito (10/09): *"A Meta precisa de perto de 50 eventos por semana em cada conjunto para otimizar por
um evento. Agendamento não tem esse volume. Por isso 'Agendou' entra como medição, e quem carrega a
otimização é o evento intermediário, mais raso e mais frequente."* O requisito deixou em aberto "qual
evento intermediário adotar, e com que critério a régua marca 'é da região'". Decisão assumida em 13/09
(o Junior pode virar): **lead respondeu** (mandou mensagem depois de a clínica ter falado) **e o DDD
do telefone está na lista do cliente**.

## 2. O que foi construído

| Peça | O que faz |
|---|---|
| `record_lead_replied_event(org, negócio, contato, quando, telefone)` — migration `20260913030000` | função de sistema (INVOKER, `search_path` vazio, só service_role). Lê `conversion_region_ddds` do cliente (criada na 3c); telefone `55 + DDD + número` → DDD; lista vazia = qualquer região; sem 55 na frente = fora. **O marco nasce sempre** (fato do funil), mas fora da região já nasce `skipped` com motivo `fora_da_regiao`, então nunca vai à Meta. Um por negócio (`replied:<negócio>`), reenvio devolve o existente |
| Webhook da Evolution | em inbound com negócio, **se a conversa já tinha uma saída antes desta mensagem** (`lastOutboundAt` da leitura anterior da conversa), chama a função. Depois do clique de anúncio, antes de atualizar a conexão. Falha vai para o log, nunca derruba o webhook |

O despachante da 3c manda `replied` como `LeadSubmitted` por padrão (mapa por cliente).

**Não construído, de propósito:** critério por CEP/cidade (o WhatsApp não dá isso; DDD é o que existe);
"respondeu" por mensagem da IA vs. do humano (qualquer saída conta: o que importa é o lead ter voltado);
marcador na conversa para evitar a chamada em toda mensagem (a função é idempotente e barata).

## 3. Provas

| Prova | Resultado |
|---|---|
| Migration aplicada no Supabase local | ledger em `20260913030000`; `INVOKER`, `search_path=""`, `anon=false auth=false service=true` |
| `test/conversaoRepliedMigration.test.ts` (estático, migration + encaixe na rota) | 4/4 |
| **`test/conversaoReplied.local.test.ts`** (função real) | **5/5**: DDD 22 da lista → `pending`, repetir não duplica; DDD 11 fora → `skipped` `fora_da_regiao`; +1 305 (sem 55) → fora; cliente sem lista → qualquer região; negócio de outra org → `23503`; anônimo e admin → `42501` |
| **`test/evolutionWebhookAdClick.local.test.ts`** (rota de ponta a ponta, caso novo) | **6/6**: mensagens do lead antes de a clínica falar não geram "respondeu"; saída da clínica (`fromMe`) pelo mesmo webhook não gera; a resposta seguinte do lead gera **um** `replied` pendente (DDD 22 na região); outra resposta não duplica |
| `tsc --noEmit` · ESLint `--max-warnings 0` nos arquivos tocados | limpos |
| Suíte completa `npm run test:local` | **249 arquivos / 1.206 testes, zero falhas** (191 s). Eram 243 / 1.174: os +6 / +32 são exatamente os testes novos de 3c e 3d (mais 1 caso no teste de ponta a ponta). Saída em arquivo, lida em comando separado antes do commit |

## 4. Auto-revisão adversarial

1. **"A clínica já tinha falado" vem da leitura da conversa feita antes desta mensagem.** Se a saída
   e a resposta chegarem no mesmo webhook fora de ordem (Evolution entrega a saída depois), a primeira
   resposta não gera o marco; a segunda gera. Aceitável: o marco é "respondeu", não "respondeu à 1ª".
2. **Uma chamada à função por mensagem inbound em conversa engajada.** Custo: um `insert ... on
   conflict do nothing` + um `select`. Com o volume da Jéssica (centenas por semana) é nada. Se um dia
   pesar, um marcador na conversa resolve.
3. **DDD por telefone sofre da armadilha `@lid`** (3a, item 3): contato sem telefone real vira "fora
   da região" quando há lista. É o comportamento correto (não dá para afirmar a região), e o marco
   fica registrado com o motivo.
4. **Lista vazia = qualquer região.** Um cliente que esqueceu de configurar manda tudo como
   "da região". Preferi isso a silenciar por padrão; a tela de configuração (futura) mostra a lista.
5. **`replied` nasce em toda conversa, com ou sem anúncio.** O despachante descarta sem etiqueta
   (`sem_etiqueta`), então nada vai à Meta; o relatório do funil ganha "respondeu" para todos.
6. **Diff de cabeçalho:** função nova; a rota ganhou um bloco entre dois existentes, sem mudar o que
   já estava lá. ACL conferida no catálogo.

## 5. Próximos passos

- **Codex:** revisão pontual (1 migration + 1 bloco na rota + 3 testes).
- **Junior:** confirmar o critério (DDD) ou trocar; preencher a lista de DDDs da Jéssica.
- **Frente 3 fechada em código.** Rollout com a cadeia do Pacote 3; antes, 2d (segredos do tick).
