# Evolution Channels

## Objetivo

Documentar a integracao atual da Evolution dentro do `Platform Admin`.

Este modulo ainda nao e o inbox final de WhatsApp. Ele cobre:

- cadastro da conexao
- healthcheck real
- solicitacao de pareamento
- exibicao do ultimo estado retornado

## Onde fica

Interface:

- `/platform/tenants/[tenantId]/channels`
- `/platform/tenants/[tenantId]/whatsapp`

Backend:

- `app/api/platform/tenants/[tenantId]/channels/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`
- `lib/channels/evolution.ts`

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

## Estado atual da entrega

Ja entregue:

- CRUD basico de conexao
- healthcheck real
- solicitacao de pareamento
- exibicao do estado e do ultimo codigo
- exibicao visual do payload de pareamento quando possivel
- edicao da conexao existente sem recriar o registro

Ainda pendente:

- renderizacao visual de QR Code
- fluxo de reconexao guiada
- inbox de mensagens
- sincronizacao inbound/outbound
- handoff humano dentro da conversa

## Seguranca

Estado atual:

- `apiKey` esta salva em `config` para permitir operacao real

Melhoria recomendada:

- mover segredo para storage mais controlado ou criptografado
- limitar exibicao e update a admins
- revisar politica de auditoria desse modulo
