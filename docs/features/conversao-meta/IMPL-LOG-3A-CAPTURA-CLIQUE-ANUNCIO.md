# IMPL-LOG 3a — Captura automática do clique de anúncio (Click-to-WhatsApp)

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (Claude constrói, inclusive motor; Codex revisa este pedaço fechado)
**Estado:** implementado, provado no Supabase local, **aguardando revisão pontual do Codex** e rollout
**SPEC:** `SPEC.md` nesta pasta (frente 3 inteira; esta é a primeira peça)

## 1. Decisão que originou

Junior, 13/09: *"toda a parte de mapeamento de lead e rastreamento de conversão para voltar para a API
da Meta qual o lead que queremos"*, uma das três coisas "para ontem". Esta peça vem primeiro porque é a
que perde dado por dia: cada lead de anúncio que chegava perdia a etiqueta do clique para sempre.

## 2. O que existia antes

- Histórico de origem (`lead_source_attributions`, C2A) com colunas para UTM/fbclid/gclid que
  **ninguém preenchia**: a única gravação era humana, pelo card do negócio (`DealOriginSelector`).
- O parser do webhook da Evolution não olhava o bloco do anúncio e a política de PII descarta o payload
  cru (`messageMetadata.ts`, achado X do Codex). O `ctwa_clid` morria antes do banco.
- Primeira mensagem de quem clica em anúncio pode chegar como `interactiveMessage`; o parser não
  extraía texto desse tipo, então **o lead era descartado** ("mensagem sem conteúdo").

## 3. O que foi construído

### Motor — `supabase/migrations/20260913000000_ctwa_captura_clique_anuncio.sql`

| Peça | O que faz |
|---|---|
| 6 colunas em `lead_source_attributions` | `ctwa_clid`, `ad_source_id` (id do anúncio), `ad_source_url`, `ad_source_app`, `ad_title`, `ad_media_url`; 2 índices parciais |
| `record_whatsapp_ad_attribution(...)` | função de sistema: **SECURITY INVOKER**, `search_path = ''`, executável **só pelo service_role** (`REVOKE ... FROM PUBLIC, anon, authenticated`). Cria (ou acha) a origem canônica **"Anúncio Meta (WhatsApp)"** (código `meta_whatsapp_ad`, uma por organização; `on conflict do nothing` sem alvo cobre a corrida entre dois webhooks), grava a atribuição com `provenance='automatic'`, `channel='whatsapp'`, `campaign` = título do anúncio, idempotência `ctwa:<conexão>:<id da mensagem>`, aponta `first_lead_source_id` (só se vazio) e `last_lead_source_id`, e preenche `contacts.source` **só quando está vazio**. Origem arquivada é reativada em vez de engolir o clique. |

### Aplicação

- `lib/conversations/evolutionWebhook.ts` — tipo `EvolutionAdClick` e `adClick` no resultado do parser:
  procura `externalAdReply` no nível do evento (onde a Evolution o sobe, inclusive para `conversation`) e
  dentro de cada tipo de mensagem; **nunca** dentro de `quotedMessage`. Guarda só etiqueta e identidade
  do anúncio (sem thumbnail, corpo, saudação), campos cortados em 512 caracteres. Passa a aceitar
  `interactiveMessage.body.text` como conteúdo.
- `lib/conversations/types.ts` + `threadMetadata.ts` — `firstAdClick` (nunca sobrescrito) e
  `lastAdClick` na metadata da conversa, saneados na leitura.
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts` — em inbound com clique, depois
  de garantir o negócio, chama a função de sistema. Falha **não derruba o webhook**: vai para o log do
  servidor e para o JSON de resposta (`ad_attribution_error`), visível no painel da Evolution.

**Não construído, de propósito:** tela mostrando "veio do anúncio X" na caixa (a metadata já está lá);
reprocessar os 328 cliques históricos da Jéssica (decisão à parte, a partir do dump da Evolution);
UTM/fbclid nas rotas públicas de formulário (FM Vistos não entra agora).

## 4. Provas

| Prova | Resultado |
|---|---|
| Forma real do payload | 35.873 mensagens do dump da Evolution (Jéssica, 08/09): `contextInfo.externalAdReply.ctwaClid` no nível do evento em **384** casos, dentro de `interactiveMessage` em 57, `audioMessage` em 6; **328 de 16.753 inbound** com etiqueta |
| Migration aplicada no Supabase local | ledger em `20260913000000`; catálogo: `anon => false`, `authenticated => false`, `service_role => true`; `INVOKER`, `search_path=""`; 6 colunas presentes |
| `lib/conversations/evolutionWebhook.test.ts` (+6 casos) | 8/8: nível do evento, dentro do tipo + `interactiveMessage` como texto, anúncio citado ignorado, sem anúncio, snake_case e bloco só com id, corte em 512 |
| `test/ctwaCapturaMigration.test.ts` (estático) | 4/4 |
| `test/evolutionWebhookAdClick.test.ts` (estático da rota) | 3/3 |
| **`test/ctwaCapturaRpc.local.test.ts`** (função real) | **7/7**: grava e cria a origem canônica com ponteiros; reenvio idempotente; segundo clique = novo toque com primeiro toque preservado e uma origem só; não sobrescreve origem humana no contato; reativa origem arquivada; anônimo e admin autenticado recebem `42501` sem gravar nada; sem etiqueta e sem id → `22023`; negócio de outra org → `23503` |
| **`test/evolutionWebhookAdClick.local.test.ts`** (rota de ponta a ponta, payload real) | **5/5**: primeira mensagem com clique vira contato com origem, negócio com ponteiros, atribuição e metadata da conversa (IA desligada → `human_queue`); reenvio cai no dedupe; mensagem sem anúncio não mexe no clique; outro anúncio = último toque muda, primeiro fica; segredo errado = 401 e nada entra. Banco limpo depois (contagem 0) |
| Testes vizinhos do webhook | 18/18 (`messageMetadata`, `routing`, dedupe, não-lido, gate de IA) |
| `tsc --noEmit` · ESLint `--max-warnings 0` nos arquivos tocados | limpos |
| Suíte completa `npm run test:local` | **241 arquivos / 1.163 testes, zero falhas** (202 s). Eram 237 / 1.138: os +4 / +25 são exatamente os testes novos. Saída em arquivo, lida em comando separado antes do commit |

## 5. Auto-revisão adversarial (escrita antes de declarar pronto)

1. **Falha na atribuição é engolida de propósito.** Se a função falhar, o webhook responde 200 com
   `ad_attribution_error` e loga; a mensagem já estava gravada e um reenvio da Evolution cai no dedupe
   **sem repetir a atribuição**. Ou seja: uma falha transitória perde o clique daquela mensagem. A
   varredura de retry planejada na 3c (tick de 5 min) é o lugar de reprocessar mensagens com clique sem
   atribuição, lendo... o quê? A metadata da conversa guarda `lastAdClick`, então dá para reconciliar.
   Registrado como dívida da 3c.
2. **Organização sem board → negócio nulo → atribuição só no contato.** O relatório comercial agrupa por
   negócio, então esse clique não aparece lá; aparece em `contacts.source` e no histórico. Hoje toda
   organização real tem board.
3. **Contato `@lid` sem telefone (armadilha do requisito).** Pré-existente e **não corrigido aqui**: o
   parser transforma `192543551684621@lid` em "telefone" (remove tudo que não é dígito). O lead é criado
   com o lid no campo de telefone. Não é desta peça, mas entra na 3b/3c porque o envio à Meta e a
   identidade do lead dependem disso. Registrado.
4. **`campaign` = título do anúncio.** Dois anúncios com o mesmo título se fundem em "por campanha"; o
   `ad_source_id` os distingue e fica na linha. Escolha consciente: o relatório é para leitura humana.
5. **Origem arquivada é reativada pelo automático.** Alguém que arquivou "Anúncio Meta (WhatsApp)" de
   propósito vai vê-la voltar no próximo clique. Preferi não perder dado; testado e documentado.
6. **Confiança no payload.** Quem tem o segredo do webhook pode injetar etiqueta e título falsos, no mesmo
   nível de confiança do texto da mensagem. Campos cortados em 512; títulos vão para a tela via React
   (escapado). Sem HTML cru em lugar nenhum.
7. **`interactiveMessage` agora vira mensagem.** Mensagens interativas sem anúncio, que antes eram
   descartadas como "sem conteúdo", passam a entrar na caixa com o texto do corpo. É o comportamento
   correto, mas é uma mudança de comportamento fora do tema: fica aqui registrada.
8. **Metadata da conversa.** `readConversationThreadMetadata` passa a devolver `firstAdClick`/`lastAdClick`
   (nulos quando ausentes). Os outros caminhos que atualizam metadata espalham o objeto atual, então
   nada é perdido. Nenhum teste existente comparava a metadata inteira por igualdade.
9. **Diff do cabeçalho de segurança** (regra do PROJECT LEARNINGS): função nova, não substitui nenhuma;
   `record_lead_source_attribution` (humana, DEFINER com gate) ficou intocada. Conferido no catálogo,
   não na migration.
10. **Fim de linha.** O teste estático da rota falhou na primeira rodada por CRLF no Windows;
    normalizado no teste. Nenhum código de produção depende disso.

## 6. Próximos passos

- **Codex:** revisão pontual deste pedaço (1 migration + parser + rota + 4 testes).
- **3b:** marcos por lead (`agendou`, `compareceu`, `fechou`) com a agenda apontando o negócio.
- **3c:** envio à Meta pelo CRM, com a varredura de retry cobrindo também o item 1 desta revisão.
- **Rollout:** vai com a cadeia do Pacote 3 (uma janela só). Preflight extra: contar em produção
  quantas conversas têm `lastAdClick` sem atribuição (deve ser zero depois da janela).
