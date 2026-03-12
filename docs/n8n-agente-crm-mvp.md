# Agente CRM no n8n

## Objetivo
Colocar uma clinica operando com IA no WhatsApp sem tirar o CRM do papel de fonte de verdade.

Arquitetura escolhida:

1. `Evolution -> CRM`
2. `CRM -> n8n`
3. `n8n -> CRM`
4. `CRM -> Evolution`

Isso preserva:
- historico em `Conversas`
- estados `ai_active`, `human_queue`, `human_active`, `resolved`
- handoff humano
- futura integracao com funil, tarefas e relatorios

## O que ja foi implementado no CRM

- O webhook inbound da Evolution grava a mensagem no CRM.
- Se a thread estiver `ai_active` e a conexao tiver `webhookUrl`, o CRM chama o webhook do n8n.
- O CRM expõe o endpoint `POST /api/public/channels/evolution/[connectionId]/ai-reply`.
- O endpoint `ai-reply` grava a resposta da IA, envia pelo WhatsApp e opcionalmente coloca a thread em `human_queue`.

Arquivos relacionados:

- [webhook route](/c:/Users/PC%20Gamer/Downloads/Projeto%20CRM/Basecrm/app/api/public/channels/evolution/[connectionId]/webhook/route.ts)
- [ai-reply route](/c:/Users/PC%20Gamer/Downloads/Projeto%20CRM/Basecrm/app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts)
- [n8nAutomation.ts](/c:/Users/PC%20Gamer/Downloads/Projeto%20CRM/Basecrm/lib/conversations/n8nAutomation.ts)

## Payload enviado pelo CRM para o n8n

```json
{
  "source": "basecrm.conversations.inbound",
  "organizationId": "org-id",
  "connectionId": "connection-id",
  "threadId": "thread-id",
  "messageId": "message-id",
  "status": "ai_active",
  "contact": {
    "id": "contact-id-or-null",
    "name": "Nome",
    "phone": "5511999999999"
  },
  "message": {
    "direction": "inbound",
    "type": "text",
    "content": "Mensagem do lead",
    "providerMessageId": "provider-id",
    "sentAt": "2026-03-11T03:00:00.000Z"
  },
  "recentMessages": [
    {
      "id": "msg-1",
      "direction": "inbound",
      "message_type": "text",
      "author_name": null,
      "content": "Oi",
      "sent_at": "2026-03-11T02:58:00.000Z",
      "metadata": {}
    }
  ],
  "connection": {
    "provider": "evolution",
    "channelType": "whatsapp",
    "name": "WhatsApp principal"
  },
  "aiReplyUrl": "https://basecrm.vercel.app/api/public/channels/evolution/<connectionId>/ai-reply"
}
```

## Payload que o n8n deve devolver para o CRM

```json
{
  "threadId": "thread-id",
  "replyText": "Ola! Posso te ajudar com isso.",
  "summary": "Lead pediu informacoes iniciais sobre atendimento.",
  "shouldHandoff": false,
  "handoffReason": null,
  "authorName": "IA de atendimento"
}
```

Exemplo com handoff:

```json
{
  "threadId": "thread-id",
  "replyText": "Vou encaminhar seu atendimento para um atendente humano continuar com mais precisao.",
  "summary": "Contato entrou em negociacao especifica e precisa de atendimento humano.",
  "shouldHandoff": true,
  "handoffReason": "Negociacao humana necessaria",
  "authorName": "IA de atendimento"
}
```

## Workflow recomendado

Workflow-base para adaptacao:

- `[EA] [CLINICA] AGENTE ODONTOLOGICO [TESTE WHATSAPP VISUAL]`

Nome final:

- `agente CRM`

Motivo da escolha:

- mais leve
- mais rapido para adaptar
- menor risco que o template gigante

## Estrutura do workflow

### 1. Webhook

Recebe o payload do CRM.

Regras:

- metodo `POST`
- JSON
- validar `status`

### 2. Normalizar payload

Extrair:

- `threadId`
- `organizationId`
- `contactName`
- `contactPhone`
- `messageText`
- `messageType`
- `status`
- `recentMessages`
- `aiReplyUrl`
- `webhookSecret` vindo do header

### 3. Filtro inicial

Continuar apenas se:

- `status === "ai_active"`
- `message.direction === "inbound"`
- `message.type === "text"`

Se nao passar:

- encerrar o fluxo sem erro

### 4. Montar contexto

Transformar o historico recente em texto simples.

Exemplo:

```text
[inbound] Cliente: Oi
[outbound] IA de atendimento: Ola, como posso ajudar?
[inbound] Cliente: Quero saber valores
```

Usar apenas as ultimas 6 a 10 mensagens.

### 5. IA Atendimento

Melhor pratica para o MVP:

- resposta curta
- portugues do Brasil
- JSON obrigatorio
- sem tools
- sem MCP em runtime
- sem RAG pesado
- temperatura baixa

Prompt sugerido:

```text
Voce e a IA de atendimento da empresa no CRM.

Seu trabalho e responder leads e clientes de forma clara, educada, objetiva e natural em portugues do Brasil.

Regras:
- Resolva sozinha o que for simples.
- Se o caso exigir negociacao humana, excecao, analise especifica, insistencia do cliente, pedido explicito para falar com humano, ou qualquer situacao sensivel, marque handoff.
- Nao invente informacoes.
- Nao diga que vai fazer algo que voce nao pode fazer.
- Seja breve e util.
- Se houver contexto suficiente para seguir, responda normalmente.
- Se nao houver contexto suficiente, faca uma pergunta curta para avancar.
- Nunca retorne texto fora do JSON.

Contexto do contato:
Nome: {{$json.contactName}}
Telefone: {{$json.contactPhone}}

Mensagem atual do contato:
{{$json.messageText}}

Historico recente:
{{$json.historyText}}

Voce deve retornar APENAS um JSON valido com este formato:
{
  "replyText": "resposta da IA para o contato",
  "summary": "resumo curto do que foi entendido ou resolvido",
  "shouldHandoff": false,
  "handoffReason": null,
  "authorName": "IA de atendimento"
}
```

Configuracao sugerida:

- temperatura: `0.2` a `0.4`
- sem memoria obrigatoria
- sem tool calling

### 6. Normalizar resposta da IA

Garantir que:

- `replyText` exista
- `summary` exista
- `shouldHandoff` seja boolean
- `handoffReason` seja `null` quando vazio
- `threadId` seja recolocado no payload final

### 7. HTTP Request final para o CRM

Em vez de enviar para a Evolution, o workflow deve chamar o `aiReplyUrl`.

Configuracao:

- metodo: `POST`
- URL: `{{$json.aiReplyUrl}}`
- headers:
  - `Content-Type: application/json`
  - `x-webhook-secret: {{$json.webhookSecret}}`
  - opcional: `Authorization: Bearer {{$json.webhookSecret}}`

Body:

```json
{
  "threadId": "{{$json.threadId}}",
  "replyText": "{{$json.replyText}}",
  "summary": "{{$json.summary}}",
  "shouldHandoff": {{$json.shouldHandoff}},
  "handoffReason": "{{$json.handoffReason}}",
  "authorName": "IA de atendimento"
}
```

## O que sai do fluxo antigo

Remover ou desativar:

- envio direto para Evolution
- dependencias da plataforma antiga de entrada
- qualquer logica que faca o n8n ser a fonte oficial do atendimento

## Escopo do MVP de amanha

Entra:

- texto inbound
- thread em `ai_active`
- resposta automatica
- handoff simples
- resumo curto

Fica fora por enquanto:

- audio
- imagem
- follow-up automatico
- movimentacao automatica de funil
- tarefas automaticas
- MCP como runtime
- RAG pesado

## Teste ponta a ponta

1. configurar `webhookUrl` da conexao WhatsApp com o webhook do n8n
2. garantir que a conexao tenha `webhookSecret`
3. enviar mensagem real para o numero da clinica
4. confirmar:
   - mensagem entra em `Conversas`
   - n8n recebe o payload
   - CRM recebe `ai-reply`
   - resposta sai no WhatsApp
   - se houver handoff, thread vai para `human_queue`

## Observacao importante

Durante esta implementacao, a API do n8n permaneceu rejeitando a API key fornecida no ambiente de automacao externo. Por isso, o caminho seguro foi registrar o blueprint completo dentro do projeto para importacao/aplicacao rapida assim que a autenticacao correta do n8n estiver disponivel.
