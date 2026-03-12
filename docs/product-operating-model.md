# Product Operating Model

## Objetivo

Registrar o modelo operacional real do BaseCRM a partir do que ja foi implementado, decidido e aprendido na evolucao de `CRM unico` para `plataforma multi-clinica`.

Este documento foca em:

- contexto de produto
- papeis e escopos
- fronteira agencia vs clinica
- responsabilidades operacionais
- pontos ainda em aberto

## Estado Atual do Produto

O BaseCRM hoje e um SaaS `multi-tenant` em banco compartilhado.

Modelo atual:

- a plataforma central opera varias clinicas
- cada clinica existe como uma `organization`
- o isolamento operacional acontece por `organization_id`
- a agencia opera a implantacao, governanca e suporte
- a clinica opera o CRM da propria unidade

Nao existe hoje:

- banco fisico separado por clinica
- projeto Supabase separado por clinica

Existe hoje:

- subconta logica por clinica
- branding por clinica
- modulos habilitados por clinica
- workspace tenant-scoped por clinica

## Operacao Imediata

Para a ativacao imediata de uma empresa com IA no WhatsApp, o produto passa a operar com um `MVP controlado` sem quebrar a visao maior da plataforma.

Escopo desse MVP:

- canal principal: WhatsApp
- entrada: Evolution API
- orquestracao de IA: n8n
- fonte de verdade: BaseCRM
- modulo central da operacao: `Conversas`
- tipo de atendimento: texto
- estados ativos: `ai_active`, `human_queue`, `human_active`, `resolved`, `closed`

Regras desse modo imediato:

- a IA atende, resume e faz handoff
- a conversa continua sendo registrada no CRM
- a empresa opera `Conversas`
- a agencia configura o agente e o canal
- o funil comercial da empresa nao e automatizado nesta primeira fase

Fora do escopo imediato:

- movimentacao automatica de oportunidade
- follow-up automatico
- tarefas automaticas de pipeline
- painel completo da `IA de atendimento`
- MCP em runtime

Objetivo:

- colocar a empresa operando rapidamente
- preservar o funil ja em andamento
- permitir evolucao futura sem refazer a arquitetura

## Contextos do Produto

### 1. Agency Workspace

Uso esperado:

- criacao de clinicas
- provisionamento
- ajustes estruturais
- suporte e operacao multi-clinica

Responsabilidades:

- criar tenant
- configurar branding e dominio
- revisar e corrigir implantacao
- gerenciar usuarios e papeis
- conectar canais
- entrar no workspace de uma clinica

### 2. Clinic Workspace

Uso esperado:

- operacao diaria do CRM da clinica
- boards
- contatos
- atividades
- settings da propria clinica
- WhatsApp e Conversations quando permitido

Responsabilidades:

- operar pipeline
- operar atendimento
- gerenciar equipe da clinica dentro das permissoes recebidas
- usar IA e automacoes no escopo da clinica

## Papeis Atuais

Papeis suportados hoje no codigo:

- `agency_admin`
- `agency_staff`
- `clinic_admin`
- `clinic_staff`
- `admin` e `vendedor` como legado/compatibilidade

### Papel: `agency_admin`

Escopo:

- agencia
- multi-clinica

Capacidades esperadas:

- acesso total da agencia
- troca livre entre clinicas
- gestao de permissao e cargo
- acesso estrutural de implantacao

### Papel: `agency_staff`

Escopo:

- agencia

Capacidades esperadas:

- opera a agencia com acesso customizado por permissao
- nao deve receber automaticamente todos os poderes do `agency_admin`

### Papel: `clinic_admin`

Escopo:

- apenas a propria clinica

Capacidades esperadas:

- administrar a equipe e a operacao da propria clinica
- operar settings locais da clinica

### Papel: `clinic_staff`

Escopo:

- apenas a propria clinica

Capacidades esperadas:

- operacao diaria limitada
- acesso determinado por permissao granular

## Permissoes Granulares Atuais

Permissoes implementadas hoje:

- `whatsapp.access`
- `whatsapp.manage_connection`
- `conversations.access`
- `conversations.reply`
- `settings.users.manage`

Regra operacional consolidada:

- cargo define `onde` o usuario pode atuar
- permissao define `o que` ele pode fazer

## Fronteira Agencia vs Clinica

Regra consolidada:

- agencia pode operar varias clinicas
- clinica nao pode ver o painel da agencia
- o workspace da clinica deve manter contexto explicito de tenant

Problemas historicos que ja apareceram:

- rotas globais abrindo sem clinica ativa
- misturar troca de clinica com troca de funil
- menu lateral cair de volta no contexto da agencia
- header mostrar usuario em vez da clinica ativa

Aprendizado:

- a separacao entre `agency workspace` e `clinic workspace` precisa aparecer na navegacao, no tenant context e nas queries

## Modulos Principais Hoje

Core:

- boards
- deals
- contacts
- activities
- settings
- AI

Operacao de clinica:

- WhatsApp
- Conversations

Infra de plataforma:

- Platform Admin
- provisioning
- branding
- domains
- user/permission management

## Fluxo de Implantacao Atual

Fluxo consolidado:

1. agencia cria a clinica
2. sistema provisiona a organization e dados iniciais
3. agencia revisa branding e estrutura
4. agencia conecta WhatsApp se necessario
5. agencia cria usuarios e define papeis/permissoes
6. clinica passa a operar o proprio workspace

## Regras Operacionais Ja Consolidadas

1. Uma clinica pode ter mais de um board.
2. Troca de clinica e diferente de troca de board.
3. WhatsApp e Conversations pertencem ao contexto da clinica.
4. Atendimento pode alternar entre IA e humano.
5. O mesmo numero de WhatsApp pode ser operado por varios atendentes.
6. O nome do atendente deve poder aparecer no contexto da mensagem.

## WhatsApp e Conversations

Estado do produto:

- integracao Evolution implementada
- inbound alimenta `Conversations`
- outbound best-effort implementado
- fila operacional ja existe
- handoff IA -> humano ja foi modelado

Fluxo consolidado:

- `ai_active`
- `human_queue`
- `human_active`
- `resolved`
- `closed`

Aprendizado:

- esse modulo precisa ser tratado como operacao central da clinica, nao como detalhe tecnico escondido em Platform Admin

## O que Ja e Decisao Consolidada

Isto ja pode ser tratado como decisao do produto:

- modelo multi-clinica em banco compartilhado
- workspace separado agencia vs clinica
- tenant-scoped navigation
- permissao granular por usuario
- WhatsApp e Conversations por clinica
- handoff IA/humano no inbox

## O que Ainda Esta em Aberto

Pontos que ainda pedem decisao de negocio ou UX:

- posicao final de `WhatsApp` e `Conversations` no menu
- separacao definitiva por dominio/subdominio de entrada
- escopo final de `agency_staff`
- hierarquia detalhada dentro da clinica alem de `clinic_admin` e `clinic_staff`
- estrategia final de relatorios por clinica

## Como Usar Este Documento

Use este arquivo para responder:

- essa feature pertence a agencia ou a clinica?
- esse usuario deve ver isso em qual contexto?
- essa regra e estrutural ou apenas de interface?
- essa mudanca exige tenant-scoped route?
