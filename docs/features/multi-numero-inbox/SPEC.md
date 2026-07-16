# Multi-número / Caixa unificada — SPEC

> Autor: Claude (Opus 4.8). Data: 2026-07-15. Aprovado pelo Junior (conceito) em 2026-07-15.
> Modelo de trabalho: Claude escreve SPEC (linguagem natural + critério de sucesso) + PLAN (técnico); Codex implementa; Junior aprova. Nada de deploy até aprovação.

## Por que essa feature existe

O CRM precisa operar **vários números de WhatsApp da mesma clínica ao mesmo tempo**, com controle de atendimento dentro do sistema. Caso concreto: a Dra. Jéssica tem um número da **secretária/comercial** (humano) e vai ter um número da **IA (Julia)** — separados. Pensando no produto vendável, uma 2ª clínica pode ter 3 pessoas no comercial, cada uma com/atendendo números, e todo o acompanhamento tem que ficar no CRM (igual Kommo/GHL: caixa unificada + seletor de canal/número).

Hoje o CRM **já é multi-número por baixo** (tabela `channel_connections` N por clínica; webhook por conexão; cada conversa já guarda de qual número veio em `conversation_threads.channel_connection_id`), mas faltam 3 coisas na superfície pra isso virar uma experiência de produto.

## Escopo — 3 peças

### Peça 1 — Cadastro simplificado de número (parear fácil)

Hoje adicionar um número pede dados técnicos (instance name, API URL, token, send mode...). **Tem que ficar simples.**

- O admin clica **"Adicionar número"** e o modal pede **apenas 2 campos**:
  1. **Número** (telefone do WhatsApp)
  2. **Nome de identificação** (quem fica com o número — ex.: "Comercial – Vitória", "IA – Julia")
- Clica **"Gerar QR code"** → o CRM cria a instância na Evolution, configura o webhook sozinho e mostra o **QR na hora**.
- O admin escaneia o QR no WhatsApp daquele número → **conecta e instala direto**.
- Campos técnicos (API URL, token, instance name, send mode) **não aparecem** no fluxo simples — o CRM gera/preenche sozinho (instance name automático, segredo automático, credencial da agência global). Ficam, no máximo, atrás de um "Avançado" opcional pra quem é da agência.

### Peça 2 — Lista de números

- Todo número cadastrado aparece numa **lista de números**, cada um com: **nome de identificação**, **telefone** e **status** (Conectado / Desconectado / Pendente / Erro).
- Em cada número, 3 ações: **Editar** (renomear a identificação), **Reparear** (gerar novo QR se caiu a conexão) e **Excluir** (remove o número da lista + desconecta a instância).

### Peça 3 — Switch de número na tela de Conversas (o "Kommo/GHL")

- No topo da lista de Conversas, um **seletor de número**: "Todos os números" + um item por número conectado (pelo nome de identificação).
- Ao escolher um número, a lista de conversas mostra **só as conversas daquele número**. "Todos os números" mostra tudo.
- Cada conversa exibe um **selo de origem** (de qual número veio), pra dar pra distinguir na visão "Todos".
- O seletor fica visível pra **todo usuário com acesso a Conversas** (secretária/comercial incluídos) — o objetivo do modelo é controle multi-atendente. (Restrição de "cada atendente só vê o número dele" = iteração futura, não entra agora.)

### Peça transversal — IA liga/desliga por número

- Cada número tem um ajuste **"IA responde automático" (liga/desliga)**.
- **Número da IA** (ex.: Julia) = IA ligada → responde automático como hoje.
- **Número do comercial/secretária** = IA desligada → mensagem recebida **NÃO** dispara a Julia; a conversa entra direto na **fila humana** pra pessoa atender. Os botões de passar humano↔IA que já existem continuam funcionando por conversa.

## Critério de sucesso (como sabemos que está pronto)

1. **Cadastro simples:** um admin adiciona um número informando **só número + nome de identificação**, clica em gerar QR, o QR aparece, ele escaneia e o número fica **Conectado** — sem digitar instance name, API URL ou token.
2. **Lista:** o número aparece na lista com o nome de identificação + status; **Editar** renomeia, **Reparear** gera novo QR, **Excluir** tira da lista e desconecta.
3. **2 números ao mesmo tempo:** dá pra ter o número da IA e o número do comercial conectados juntos, os dois recebendo mensagens que caem em Conversas.
4. **Switch:** na tela de Conversas, o seletor troca a visão entre "Todos", número da IA e número do comercial; a lista filtra certo; cada conversa mostra de qual número veio.
5. **IA por número:** mensagem que chega no **número do comercial (IA off)** entra em fila humana **sem** resposta automática da Julia; mensagem no **número da IA (IA on)** recebe resposta automática da Julia.
6. **Sem regressão:** a suíte inteira passa (`npm run precheck:fast` verde); o número TEMP atual da agência continua funcionando; nada some de quem já usa.

## Fora de escopo (fica pra depois)

- Restrição de "cada atendente vê só o número dele" (por-usuário) — v1 mostra todos os números da clínica pra quem tem acesso a Conversas.
- Distribuição/round-robin de conversas entre atendentes por número.
- Métricas/relatório de atendimento por número.
- Números de outros canais além de WhatsApp/Evolution (Instagram, etc.).

## Governança

- Quem **cadastra/pareia/exclui** número = quem tem a permissão `whatsapp.manage_connection` (pelos defaults E2: admin da clínica/agência sim; secretária não).
- Quem **vê e usa** a caixa de Conversas + o seletor = quem tem `conversations.access`.
- Teste de tudo em **não-prod** primeiro (Supabase local `supabase start`); **nada de deploy** até o Junior aprovar no localhost.
- Branch própria `feat/multi-numero-inbox`. TDD. Sem push/deploy no fluxo do Codex até o aval.
