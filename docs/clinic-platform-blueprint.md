# CRM Clinica Blueprint

## Objetivo

Este documento define a arquitetura-alvo para transformar o `NossoCRM` em uma base multi-tenant com implantacao concierge, permitindo entregar um `CRM Clinica` pronto para cada cliente sem expor conceitos internos como template, snapshot, seed ou edition.

Premissas do produto:

- o cliente final nao faz setup estrutural;
- a implantacao e feita internamente pelo nosso time;
- o cliente recebe o CRM pronto, com branding e funil configurados;
- o cliente pode fazer apenas customizacoes leves no dia a dia;
- a IA atual continua sendo parte central do produto;
- a base deve servir futuramente para outras verticais alem de clinicas.

## Principios

- `core compartilhado`: auth, multi-tenant, boards, deals, contacts, activities, IA, API publica e webhooks continuam na mesma base.
- `implantacao invisivel`: seeds, editions e perfis de vertical ficam restritos ao time interno.
- `produto entregue pronto`: cada tenant nasce provisionado, com subdominio, branding e configuracao inicial publicados.
- `IA como personalizacao final`: a seed instala uma base confiavel; a IA ajusta o funil e a estrategia ao contexto real da clinica.
- `modulos desacoplados`: conversations, appointments e channels entram como modulos habilitaveis por tenant.

## Superficies do produto

### 1. Core CRM

Camada compartilhada entre todos os produtos.

Responsabilidades:

- autenticacao e perfis
- isolamento por `organization_id`
- boards, stages, deals e contacts
- activities
- API publica
- webhooks inbound/outbound
- IA operacional e chat agent
- settings gerais

Partes ja existentes que devem ser reaproveitadas:

- `app/api/ai/chat/route.ts`
- `lib/ai/crmAgent.ts`
- `lib/ai/tools.ts`
- `features/boards/components/BoardCreationWizard.tsx`
- `app/api/ai/tasks/boards/generate-structure/route.ts`
- `app/api/ai/tasks/boards/generate-strategy/route.ts`
- `app/api/ai/tasks/boards/refine/route.ts`

### 2. Platform Admin

Camada interna, usada apenas pelo nosso time.

Responsabilidades:

- criar e gerenciar tenants
- escolher edition interna e perfil de vertical
- iniciar o provisionamento
- revisar board gerado
- configurar branding
- configurar dominio/subdominio
- configurar canais como WhatsApp
- criar usuarios iniciais
- publicar a entrega

Essa camada nao aparece para o cliente final.

### 3. Clinic Workspace

Camada entregue para a clinica.

Responsabilidades:

- operar pipeline
- operar inbox e conversas
- acompanhar agenda
- usar IA do CRM
- editar tags, scripts, usuarios e ajustes leves do funil
- atualizar logo e tema quando permitido

O cliente nao deve ver termos como:

- snapshot
- template
- seed
- edition
- vertical profile

### 4. Setup Engine

Camada de backend responsavel por provisionar tenants e aplicar configuracoes.

Responsabilidades:

- criar organization
- registrar edition
- habilitar modulos
- aplicar branding
- instalar base de board/campos/configuracoes
- acionar IA para personalizacao
- criar papeis iniciais
- registrar canais
- auditar o processo em `provisioning_runs`

## Modelo operacional

O produto deve assumir explicitamente que e um `SaaS multi-tenant com implantacao concierge`.

Na pratica:

- o setup principal e feito por nos;
- o cliente usa o sistema pronto;
- o cliente nao precisa aprender a criar CRM do zero;
- a flexibilidade estrutural fica concentrada no nosso time interno.

## Fluxo de implantacao

1. o implantador acessa `Platform Admin`
2. cria um novo tenant
3. informa dados do negocio e contexto da clinica
4. seleciona o perfil interno de seed
5. o `Setup Engine` cria a organization
6. a seed instala o baseline da edition `clinic`
7. a IA gera ou refina o board inicial
8. o implantador revisa funil, nomenclaturas e branding
9. o implantador configura subdominio
10. o implantador conecta o WhatsApp
11. o implantador cria os usuarios iniciais
12. o tenant e publicado
13. a clinica recebe acesso ja pronto

## IA no produto

### Papel 1. AI Setup Concierge

Usado no onboarding interno.

Responsabilidades:

- interpretar briefing da clinica
- gerar estrutura inicial do board
- definir estrategia do board
- ajustar nomes de etapas
- sugerir automacoes

### Papel 2. AI CRM Operator

Usado dentro do CRM entregue.

Responsabilidades:

- responder perguntas sobre o CRM
- analisar pipeline
- gerar scripts
- criar e mover registros
- apoiar a equipe na operacao

### Papel 3. AI Frontline Agent

Usado no atendimento via WhatsApp.

Responsabilidades:

- qualificar lead
- responder duvidas iniciais
- registrar contexto
- acionar agenda
- fazer handoff para humano

Esses papeis devem permanecer separados em arquitetura e configuracao, mesmo que compartilhem provider e modelos.

## Personalizacao invisivel

Internamente podem existir seeds como:

- `clinic_odonto_v1`
- `clinic_estetica_v1`
- `clinic_nutri_v1`

Mas isso nao deve aparecer na interface do cliente. Para o cliente, a experiencia deve ser:

- CRM configurado
- funil pronto
- equipe pronta
- marca aplicada
- canal principal conectado

## Limites de customizacao do cliente

Permitido para o cliente:

- logo
- tema light/dark
- ajuste leve de etapas
- tags
- scripts
- usuarios da equipe
- campos leves quando permitido

Reservado ao time interno:

- edition
- seed/vertical profile
- configuracao estrutural do tenant
- subdominio
- modulos habilitados
- WhatsApp provider
- automacoes criticas
- configuracao do agente

## Multi-tenant e acesso

Modelo recomendado:

- `clinicax.seudominio.com`

Regras:

- cada tenant possui host proprio
- tenant e resolvido pelo host
- branding e configuracoes carregam a partir da organization
- no futuro, dominio proprio pode ser opcional

## Modulos da edition clinic

### Modulos base

- `crm_core`
- `ai_assistant`
- `boards_pipeline`
- `contacts`
- `activities`

### Modulos da vertical clinica

- `conversations`
- `appointments`
- `channels`
- `clinic_reporting`

### Modulos futuros

- `campaigns`
- `rebilling`
- `multiunit`
- `custom_domains`

## Entidades novas

### `organization_editions`

Responsabilidade:

- definir qual edition esta aplicada ao tenant
- guardar branding base e modulos habilitados

Campos sugeridos:

- `organization_id`
- `edition_key`
- `branding_config`
- `enabled_modules`
- `created_at`
- `updated_at`

### `organization_domains`

Responsabilidade:

- mapear hosts e subdominios por tenant

Campos sugeridos:

- `organization_id`
- `host`
- `is_primary`
- `status`
- `created_at`

### `organization_modules`

Responsabilidade:

- habilitar ou desabilitar modulos por tenant

Campos sugeridos:

- `organization_id`
- `module_key`
- `enabled`
- `config`

### `provisioning_runs`

Responsabilidade:

- auditar a implantacao
- registrar briefing, status e resultado do setup

Campos sugeridos:

- `id`
- `organization_id`
- `edition_key`
- `status`
- `input_payload`
- `result_payload`
- `created_by`
- `created_at`

### `channel_connections`

Responsabilidade:

- registrar conexoes externas como Evolution

Campos sugeridos:

- `id`
- `organization_id`
- `provider`
- `status`
- `config`
- `last_healthcheck_at`
- `created_at`

### Entidades da fase de conversas

- `conversation_threads`
- `conversation_messages`

### Entidade da fase de agenda

- `appointments`

## Superficie tecnica inicial

Rotas internas previstas:

- `/platform`
- `/platform/tenants`
- `/platform/tenants/new`
- `/platform/tenants/[tenantId]`
- `/platform/tenants/[tenantId]/branding`
- `/platform/tenants/[tenantId]/pipeline`
- `/platform/tenants/[tenantId]/channels`
- `/platform/tenants/[tenantId]/users`
- `/platform/tenants/[tenantId]/domains`

## Estrategia de implementacao

### Fase 1

- `Platform Admin`
- `Provisioning Engine`
- edition `clinic`
- IA de setup

### Fase 2

- subdominio por tenant
- branding por tenant
- usuarios e papeis iniciais

### Fase 3

- channels
- Evolution
- conversas

### Fase 4

- appointments
- handoff IA -> humano
- dashboards clinicos

## Decisoes de arquitetura

- nao criar outro repositório agora
- evoluir a base atual para `core + platform + editions`
- usar a IA existente como motor de personalizacao e operacao
- tratar WhatsApp como modulo de produto, nao como detalhe acoplado
- manter conceitos internos de template/seed fora da interface do cliente

## Resultado esperado

Ao final dessa evolucao, o produto deve permitir:

- criar e entregar um CRM de clinica pronto em cima da base atual;
- repetir o mesmo modelo para outras verticais futuramente;
- aproveitar a IA ja existente para setup e operacao;
- preservar um core unico sem duplicar manutencao.
