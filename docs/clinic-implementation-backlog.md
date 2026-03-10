# CRM Clinica Implementation Backlog

## Objetivo

Este documento quebra a arquitetura do `CRM Clinica` em backlog tecnico executavel, com prioridades, dependencias e pontos de entrada no código atual.

Convencoes:

- `P0`: bloqueia o inicio da linha de produto
- `P1`: necessario para entrega comercial forte
- `P2`: evolucao posterior

## Sprint 1 - Platform Admin e Provisionamento Inicial

Prioridade: `P0`

Objetivo:

- criar a camada interna de implantacao
- registrar editions
- registrar runs de provisionamento
- criar tenant de clinica
- gerar board inicial usando a IA existente

Entregas:

- area interna `/platform`
- lista de tenants
- wizard `Nova Clinica`
- `editionRegistry` com edition `clinic`
- `runProvisioning()` inicial
- criacao de organization + edition + provisioning run
- criacao do board inicial via IA

Arquivos novos:

- `app/(protected)/platform/page.tsx`
- `app/(protected)/platform/tenants/page.tsx`
- `app/(protected)/platform/tenants/new/page.tsx`
- `features/platform/PlatformPage.tsx`
- `features/platform/tenants/TenantsPage.tsx`
- `features/platform/tenants/NewTenantPage.tsx`
- `features/platform/tenants/components/TenantProvisioningWizard.tsx`
- `lib/provisioning/types.ts`
- `lib/provisioning/editionRegistry.ts`
- `lib/provisioning/runProvisioning.ts`
- `lib/provisioning/aiPersonalization.ts`
- `app/api/platform/tenants/route.ts`
- `app/api/platform/tenants/[tenantId]/provision/route.ts`

Migrations:

- `organization_editions`
- `provisioning_runs`

Reaproveitar do projeto atual:

- `app/api/ai/tasks/boards/generate-structure/route.ts`
- `app/api/ai/tasks/boards/generate-strategy/route.ts`
- `app/api/ai/tasks/boards/refine/route.ts`
- `features/boards/components/BoardCreationWizard.tsx`
- `lib/supabase/boards.ts`

Dependencias:

- auth atual
- organizations atuais
- configuracao de IA por organization

Critério de pronto:

- o time interno consegue criar uma clinica
- a organization nasce com edition `clinic`
- um `provisioning_run` e salvo
- o board inicial e criado e persistido

## Sprint 2 - Tenant, Branding e Publicacao

Prioridade: `P0`

Objetivo:

- separar tenant por host/subdominio
- aplicar branding por tenant
- permitir publicar a entrega para o cliente

Entregas:

- subdominio por tenant
- resolucao de tenant por host
- branding por tenant
- tela interna de revisao de branding
- tela interna de revisao do board gerado
- criacao de usuarios iniciais
- acao de `publish tenant`

Arquivos novos:

- `app/(protected)/platform/tenants/[tenantId]/page.tsx`
- `app/(protected)/platform/tenants/[tenantId]/branding/page.tsx`
- `app/(protected)/platform/tenants/[tenantId]/pipeline/page.tsx`
- `app/(protected)/platform/tenants/[tenantId]/users/page.tsx`
- `app/(protected)/platform/tenants/[tenantId]/domains/page.tsx`
- `features/platform/tenants/TenantWorkspacePage.tsx`
- `lib/tenancy/resolveTenant.ts`
- `lib/branding/getTenantBranding.ts`
- `app/api/platform/tenants/[tenantId]/branding/route.ts`
- `app/api/platform/tenants/[tenantId]/users/route.ts`
- `app/api/platform/tenants/[tenantId]/domains/route.ts`

Migrations:

- `organization_domains`
- opcional: `organization_branding` se branding nao ficar em `organization_editions`

Pontos de integracao no core:

- layout global
- auth/login
- provider de settings
- loading inicial do tenant

Dependencias:

- Sprint 1

Critério de pronto:

- um tenant pode ser acessado por subdominio proprio
- a clinica visualiza marca correta
- usuarios iniciais podem ser criados antes da entrega

## Sprint 3 - Registry de Canais e Evolution

Prioridade: `P1`

Objetivo:

- preparar a camada de conexoes externas por tenant
- registrar e operar WhatsApp via Evolution

Entregas:

- `channel_connections`
- provider `evolution`
- tela interna para conectar, trocar numero e reconectar
- status de saude da conexao

Arquivos novos:

- `app/(protected)/platform/tenants/[tenantId]/channels/page.tsx`
- `features/platform/tenants/ChannelsPage.tsx`
- `lib/channels/types.ts`
- `lib/channels/providers/evolution.ts`
- `lib/channels/healthcheck.ts`
- `app/api/platform/tenants/[tenantId]/channels/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[channelId]/route.ts`

Migrations:

- `channel_connections`

Dependencias:

- Sprint 1
- Sprint 2

Critério de pronto:

- o implantador consegue registrar uma conexao WhatsApp por tenant
- consegue ver estado da conexao
- consegue trocar/reconectar sem mexer direto na base

## Sprint 4 - Conversations

Prioridade: `P1`

Objetivo:

- trazer WhatsApp para dentro da operacao do CRM

Entregas:

- modulo `Conversations`
- threads por contato
- mensagens por thread
- associacao com `contact_id` e `deal_id`
- notas internas
- handoff interno
- resumo do atendimento

Arquivos novos:

- `app/(protected)/conversations/page.tsx`
- `features/conversations/ConversationsPage.tsx`
- `features/conversations/components/...`
- `lib/conversations/service.ts`
- `app/api/conversations/threads/route.ts`
- `app/api/conversations/messages/route.ts`

Migrations:

- `conversation_threads`
- `conversation_messages`

Pontos de integracao no core:

- `contacts`
- `deals`
- `activities`
- `lib/ai/tools.ts`

Dependencias:

- Sprint 3

Critério de pronto:

- uma mensagem recebida pode abrir ou atualizar o contexto do lead
- o time consegue operar atendimento dentro do CRM
- o atendimento consegue alimentar pipeline e follow-up

## Sprint 5 - Appointments

Prioridade: `P1`

Objetivo:

- suportar agendamento de avaliacao/consulta dentro da edition clinica

Entregas:

- entidade `appointments`
- statuses de agendamento
- lista ou calendario simples
- vinculo com contato, deal e usuario
- reagendamento, cancelamento e no-show

Arquivos novos:

- `app/(protected)/appointments/page.tsx`
- `features/appointments/AppointmentsPage.tsx`
- `features/appointments/components/...`
- `lib/appointments/service.ts`
- `app/api/appointments/route.ts`
- `app/api/appointments/[appointmentId]/route.ts`

Migrations:

- `appointments`

Dependencias:

- Sprint 4

Critério de pronto:

- a clinica consegue operar avaliacao/agendamento no sistema
- no-show e remarcacao passam a ser eventos do pipeline

## Sprint 6 - Roles, Assigned Data e Dashboards Clinicos

Prioridade: `P1`

Objetivo:

- separar visoes por perfil
- fechar a operacao da clinica com governanca

Entregas:

- papeis clinicos
- permissao `only_assigned_data`
- visao gerente x usuario
- dashboards clinicos basicos
- revisao dos prompts/agentes para contexto clinico

Papeis sugeridos:

- `clinic_admin`
- `manager`
- `receptionist`
- `sales`
- `doctor`

Dependencias:

- Sprint 2
- Sprint 4
- Sprint 5

Critério de pronto:

- usuarios veem apenas o que devem ver
- gerente tem visao operacional consolidada
- a clinica opera sem ter acesso ao setup estrutural

## P2 - Evolucao posterior

Itens futuros:

- dominio proprio por tenant
- multiunidade
- rebilling por add-on
- campanhas
- automacoes por vertical
- templates de mensagens administrados por tenant
- onboarding interno semi-automatizado

## Ordem de execucao obrigatoria

Sequencia recomendada:

1. `Platform Admin`
2. `Provisioning Engine`
3. `tenant by host`
4. `branding`
5. `channels`
6. `conversations`
7. `appointments`
8. `roles and dashboards`

Nao inverter `conversations` e `channels`, nem `appointments` antes de tenant e branding.

## Regras de produto

- o cliente final nao ve `edition`, `seed`, `snapshot` ou `template`;
- o time interno usa esses conceitos no `Platform Admin`;
- o cliente pode fazer apenas customizacao leve;
- a implantacao pesada continua com o nosso time;
- a IA atual deve ser usada como acelerador de implantacao e operacao.

## Primeiras tasks tecnicas

### Task 1. Criar migration de editions

Descricao:

- criar tabela `organization_editions`
- relacionar 1:1 com `organizations`
- guardar edition e branding base

Prioridade:

- `P0`

### Task 2. Criar migration de provisioning runs

Descricao:

- criar tabela `provisioning_runs`
- guardar input, status e resultado do setup

Prioridade:

- `P0`

### Task 3. Criar registry de editions

Descricao:

- adicionar `lib/provisioning/editionRegistry.ts`
- registrar edition `clinic`
- listar modulos e defaults da edition

Prioridade:

- `P0`

### Task 4. Criar wizard interno `Nova Clinica`

Descricao:

- criar tela interna no `Platform Admin`
- coletar briefing minimo
- disparar provisionamento inicial

Prioridade:

- `P0`

### Task 5. Criar `runProvisioning()`

Descricao:

- criar organization
- salvar edition
- abrir provisioning run
- chamar IA para gerar board
- persistir board inicial

Prioridade:

- `P0`

### Task 6. Implementar tenant por subdominio

Descricao:

- resolver organization pelo host
- carregar branding/configuracao do tenant

Prioridade:

- `P0`

### Task 7. Criar `channel_connections`

Descricao:

- preparar camada de canais para Evolution

Prioridade:

- `P1`

### Task 8. Criar modulo `Conversations`

Descricao:

- trazer WhatsApp para dentro do CRM

Prioridade:

- `P1`

### Task 9. Criar modulo `Appointments`

Descricao:

- suportar a operacao clinica de agendamento

Prioridade:

- `P1`

## Checklist de validacao da linha de produto

- um tenant pode ser criado sem mexer manualmente no banco
- o cliente recebe o sistema pronto
- o cliente nao ve conceitos internos de implantacao
- o board inicial nasce com IA + seed
- branding funciona por tenant
- WhatsApp pode ser conectado por tenant
- atendimento alimenta pipeline
- agenda se conecta ao fluxo comercial
