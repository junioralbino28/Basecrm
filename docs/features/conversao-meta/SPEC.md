# SPEC — Mapeamento de lead e conversão de volta para a Meta

**Data:** 2026-09-13
**Branch:** `feat/funil-construtor`
**Construído por:** Claude (modelo de trabalho desde 04/09: Claude constrói, inclusive motor; Codex revisa pedaços fechados)
**Estado:** 3a em implementação · 3b, 3c, 3d a seguir

## 1. Decisão que originou

Junior, 13/09: *"3 coisas que precisam ficar prontas para ontem: IA de atendimento; automações de funis e
follow-ups; toda a parte de mapeamento de lead e rastreamento de conversão para voltar para a API da
Meta qual o lead que queremos."* Esta SPEC é a terceira. Ela vem primeiro porque é a que perde dado
por dia: cada lead que chega de anúncio hoje perde a etiqueta do clique para sempre.

Requisito de origem (10/09, projeto da Dra. Jéssica, vale para qualquer CRM da Cenoura):
`WorkSync/workspaces/Dra Jessica Barros/06-crm-secretaria/REQUISITO-conversao-de-volta-pra-meta.md`.
Em uma frase: *"A Meta só enxerga que a conversa começou. Quem sabe que virou agendamento é a
recepção. O CRM é a única peça que pode guardar as duas pontas juntas e fechar o ciclo."*

## 2. O que existia antes (mapa de 13/09)

- Origem do lead: catálogo `lead_sources`, histórico `lead_source_attributions` (com colunas para
  UTM, fbclid, gclid), ponteiros `deals.first_lead_source_id` / `last_lead_source_id`, RPC
  `record_lead_source_attribution`. **Tudo manual:** a secretária escolhe a origem no card do negócio.
- Webhook da Evolution (`app/api/public/channels/evolution/[connectionId]/webhook/route.ts`):
  materializa contato, conversa e negócio no primeiro inbound, mas o parser não olhava o bloco do
  anúncio e o payload cru é descartado por política de PII. O `ctwa_clid` se perdia antes do banco.
- Marcos do lead: `deals.closed_at` (ganho/perdido), `appointments` (cache da agenda, `contact_id`,
  sem `deal_id`, status `compareceu`/`faltou` sem data própria), `atendimentos.performed_at`/`paid_at`.
  Nada de `agendou_em` / `compareceu_em` por lead.
- Meta Conversions API: zero linhas de código. Roadmap dizia "pra depois".
- Relatório comercial (04/09) já agrupa fechados por origem (1º toque) e por campanha (último toque).

## 3. O que entra, em ordem

### 3a — Captura automática do clique de anúncio ✅ (esta entrega)

Fonte, conferida em 384 mensagens reais da Jéssica: a Evolution entrega `contextInfo.externalAdReply`
no evento `messages.upsert` (no nível do evento para `conversation`; dentro do tipo para
`interactiveMessage`, `audioMessage`), com `ctwaClid`, `title`, `sourceId` (id do anúncio),
`sourceUrl`, `sourceApp` (`instagram`/`facebook`), `sourceType` (`ad`), `mediaUrl`. 328 dos 16.753
inbound do dataset tinham a etiqueta.

- **Parser** (`lib/conversations/evolutionWebhook.ts`): novo campo `adClick` com só etiqueta e
  identidade do anúncio (nada de thumbnail, corpo, saudação). Ignora o anúncio de mensagem citada.
  Passa a aceitar `interactiveMessage.body.text` como conteúdo (57 casos reais eram descartados).
- **Migration** `20260913000000_ctwa_captura_clique_anuncio.sql`: colunas `ctwa_clid`,
  `ad_source_id`, `ad_source_url`, `ad_source_app`, `ad_title`, `ad_media_url` em
  `lead_source_attributions`; função de sistema `record_whatsapp_ad_attribution` (INVOKER,
  `search_path` vazio, só `service_role`) que cria a origem canônica **"Anúncio Meta (WhatsApp)"**
  (código `meta_whatsapp_ad`, uma por organização), grava a atribuição com `provenance = 'automatic'`,
  idempotente por conexão + id da mensagem, aponta primeiro/último toque no negócio e preenche
  `contacts.source` **só quando está vazio** (a escolha humana nunca é sobrescrita). `campaign`
  recebe o título do anúncio, então "qual anúncio fechou" já aparece no relatório comercial.
- **Webhook**: em inbound com clique, chama a função depois de garantir o negócio; falha não derruba
  o webhook (fica no log e no JSON de resposta, visível no painel da Evolution). Resumo do clique
  (`firstAdClick`/`lastAdClick`) na metadata da conversa para a caixa de entrada mostrar.

**Como vamos saber que está pronto:** um lead que manda mensagem clicando num anúncio aparece no CRM
com a origem "Anúncio Meta (WhatsApp)" e o título do anúncio, sem ninguém marcar nada; um segundo
clique do mesmo lead vira novo toque sem apagar o primeiro; e o mesmo evento reenviado pela Evolution
não duplica. Provado por teste com o payload real e por RPC no Supabase local.

### 3b — Marcos por lead (agendou, compareceu, fechou) ✅ (entregue, ver IMPL-LOG-3B)

Tabela `deal_conversion_events` (tipo: `replied` | `scheduled` | `attended` | `no_show` | `won`,
`occurred_at`, fonte, valor no `won`, `meta_event_id`, status/data do envio). Preenchida sozinha por
gatilhos: consulta criada e ligada ao negócio → `scheduled` (a agenda passou a apontar o negócio);
status `compareceu` → `attended` na hora da consulta; `faltou` → `no_show` já descartado para a Meta;
`is_won` virando verdadeiro por qualquer caminho → `won` com o valor do negócio. Arrependimento antes
do envio descarta o marco pendente. A recepção não ganhou botão novo.

**Como vamos saber que está pronto:** a recepção marca a consulta e o comparecimento onde já marca, o
negócio vira ganho como sempre, e cada um desses momentos aparece como uma linha datada no negócio,
com id único para a Meta, sem ninguém preencher nada. Provado com gatilhos reais no Supabase local.

### 3c — Envio à Meta pelo próprio CRM

Não pelo n8n: o CRM é o dono do estado. Configuração por cliente (dataset/pixel e token guardados como
as chaves de IA, nunca no navegador), disparo **na hora** da mudança de status mais varredura de
retry a cada 5 min no tick que já existe, id único por evento, só evento genérico e etiqueta.
**Nunca procedimento nem dado clínico.** Janela de envio confirmada na documentação da Meta antes do
primeiro envio.

### 3d — Evento intermediário para otimização

"Lead respondeu e é da região": critério proposto = DDD do telefone numa lista por cliente. É o evento
com volume para a Meta otimizar; "Agendou" e "Compareceu" servem para medir.

## 4. Fora de escopo (por enquanto)

- UTM/fbclid/gclid nas rotas públicas de formulário (API v1 e webhook de entrada): FM Vistos não entra
  no CRM agora (decisão de 04/09); fica anotado.
- Tela dedicada de atribuição: a origem já aparece no card e no relatório comercial.
- Reprocessar o histórico da Jéssica (os 328 cliques antigos): possível a partir do dump da Evolution,
  decisão à parte.

## 5. LGPD e segurança

- O que sai para a Meta (3c) é só o evento e a etiqueta. Procedimento, valor clínico, mensagens: nunca.
- O que entra no CRM (3a) é identidade do anúncio, não da pessoa além do que o WhatsApp já dá.
- Função de gravação executável só pelo servidor; ACL conferida no catálogo, não só na migration.

## 6. Decisões assumidas (Junior pode virar)

- Envio da Meta sai do CRM, não do n8n.
- "Da região" = lista de DDD por cliente.
- Recepção marca agendou/compareceu na agenda, sem botão novo.
- Origem canônica única "Anúncio Meta (WhatsApp)"; o anúncio específico fica na atribuição e no
  relatório por campanha, não vira uma origem por anúncio.
