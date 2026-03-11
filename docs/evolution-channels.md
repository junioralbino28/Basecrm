# Evolution Channels

## Objetivo

Documentar a integracao atual da Evolution dentro do `Platform Admin`.

Este modulo ainda nao e o inbox final de WhatsApp. Ele cobre:

- cadastro da conexao
- healthcheck real
- solicitacao de pareamento
- exibicao do ultimo estado retornado
- webhook inbound do CRM para alimentar `Conversations`
- inbox operacional basico em `Conversations` para triagem

## Onde fica

Interface:

- `/platform/tenants/[tenantId]/channels`
- `/platform/tenants/[tenantId]/whatsapp`

Backend:

- `app/api/platform/tenants/[tenantId]/channels/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/disconnect/route.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `lib/channels/evolution.ts`
- `lib/conversations/evolutionWebhook.ts`

## Tabela usada

Tabela:

- `channel_connections`

Campos relevantes:

- `organization_id`
- `provider`
- `channel_type`
- `name`
- `status`
- `config`
- `metadata`
- `last_healthcheck_at`

## Provider suportado hoje

Provider ativo:

- `evolution`

Channel type ativo:

- `whatsapp`

## Campos operacionais usados

### `config`

- `apiUrl`
- `instanceName`
- `webhookUrl`
- `webhookSecret`
- `apiKey`

### `metadata`

- `phoneNumber`
- `apiKeyLast4`
- `notes`
- `lastHealthcheckState`
- `lastHealthcheckRaw`
- `lastHealthcheckError`
- `lastPairingCode`
- `lastPairingPayload`
- `lastPairingRequestedAt`
- `lastPairingError`
- `lastInboundAt`
- `lastInboundPhone`
- `lastInboundPreview`

## Healthcheck

Endpoint usado:

- `GET {apiUrl}/instance/connectionState/{instanceName}`

Cabecalho usado:

- `apikey: {apiKey}`

Mapeamento atual de status:

- `open`, `connected`, `online` -> `connected`
- `close`, `closed`, `disconnected`, `offline`, `connecting`, `qrcode`, `qr` -> `disconnected`
- qualquer outro retorno -> `error`

## Pareamento

Endpoint usado:

- `GET {apiUrl}/instance/connect/{instanceName}`

Query opcional:

- `number={phoneNumber}`

O sistema persiste:

- ultimo `pairingCode`
- payload bruto retornado
- horario da ultima solicitacao

## Desconexao

Endpoint usado:

- `DELETE {apiUrl}/instance/logout/{instanceName}`

Uso atual:

- botao `Desconectar` na tela de WhatsApp da clinica
- apos sucesso, a conexao volta para `disconnected`

## Webhook inbound para Conversations

Rota publica:

- `POST /api/public/channels/evolution/[connectionId]/webhook?secret={webhookSecret}`

Autenticacao aceita:

- query param `secret`
- header `X-Webhook-Secret`
- header `Authorization: Bearer ...`

Comportamento atual:

- valida a conexao `evolution` por `connectionId`
- valida o `webhookSecret` salvo em `channel_connections.config`
- interpreta payloads comuns de mensagem da Evolution
- cria ou reutiliza `conversation_threads`
- grava `conversation_messages`
- faz dedupe best-effort por `metadata.provider_message_id`
- atualiza `channel_connections.metadata` com ultimo inbound recebido
- atualiza metadata da thread com preview, direcao e contador de nao lidas
- tenta normalizar telefone para reaproveitar thread e vincular `contacts`

Limitacoes atuais:

- foco em mensagens individuais, nao grupos
- suporte best-effort para formatos comuns de payload
- ainda nao cria deal automaticamente
- vinculo com contato depende de telefone igual ao salvo em `contacts.phone`

## Como testar

1. abrir a clinica
2. entrar em `Canais`
3. cadastrar:
   - `API URL`
   - `Instance name`
   - `API key`
   - `Telefone` se desejar
4. clicar `Testar conexao`
5. clicar `Gerar pareamento`
6. copiar o `Webhook do CRM`
7. configurar essa URL na Evolution
8. enviar mensagem real para validar entrada em `Conversations`

## Estado atual da entrega

Ja entregue:

- CRUD basico de conexao
- healthcheck real
- solicitacao de pareamento
- desconexao real
- geracao automatica de `webhookSecret`
- exibicao da URL do webhook do CRM
- ingest inbound basico da Evolution em `Conversations`
- inbox operacional com filtros, atribuicao, status e timeline
- exibicao do estado e do ultimo codigo
- exibicao visual do payload de pareamento quando possivel
- edicao da conexao existente sem recriar o registro

Ainda pendente:

- renderizacao visual de QR Code
- fluxo de reconexao guiada mais completo
- sincronizacao outbound mais profunda e confirmacao posterior de entrega
- handoff humano dentro da conversa
- vinculacao manual mais profunda com contato/deal direto do inbox

## Outbound em Conversations

Estado atual:

- a tela de `Conversations` tenta envio outbound real pela Evolution para mensagens `outbound`
- o sistema usa fallback best-effort para formatos comuns do endpoint `sendText`
- se o envio falhar, a mensagem continua registrada no CRM com metadata de falha e aviso na interface
- a timeline mostra status de entrega e erro do outbound diretamente na mensagem

Observacao:

- esta camada ainda depende do endpoint da Evolution ser compativel com um dos formatos tentados pelo CRM

## Seguranca

Estado atual:

- `apiKey` esta salva em `config` para permitir operacao real

Melhoria recomendada:

- mover segredo para storage mais controlado ou criptografado
- limitar exibicao e update a admins
- revisar politica de auditoria desse modulo
