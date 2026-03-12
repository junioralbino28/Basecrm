# Tenant Data Map

## Objetivo

Documentar o mapa de dados multi-tenant do BaseCRM com foco em:

- entidades principais
- ownership por `organization_id`
- tabelas mais sensiveis a vazamento entre clinicas
- relacoes criticas para operacao

Este documento nao substitui o schema SQL completo. Ele serve como referencia rapida para desenvolvimento e investigacao.

## Modelo Geral

O BaseCRM opera hoje em `banco compartilhado`, com isolamento logico por tenant.

Entidade-raiz do tenant:

- `organizations`

Regra geral:

- qualquer dado operacional de clinica precisa se ligar direta ou indiretamente a uma `organization`

## Entidades de Base

### `organizations`

Papel:

- raiz logica da clinica/tenant

Uso:

- identifica a clinica
- ancora branding, dominio, settings e modulos

### `profiles`

Papel:

- identidade do usuario
- vinculo com `organization_id`
- papel do usuario

Campos criticos:

- `id`
- `organization_id`
- `role`

## Entidades Tenantizadas Principais

### Core CRM

- `organization_settings`
- `crm_companies`
- `boards`
- `board_stages`
- `contacts`
- `deals`
- `deal_items`
- `activities`
- `deal_notes`
- `deal_files`
- `api_keys`

### Platform / Tenant Setup

- `organization_editions`
- `organization_domains`
- `provisioning_runs`

### Canais e Atendimento

- `channel_connections`
- `conversation_threads`
- `conversation_messages`

### Permissoes

- `profile_permissions`

## Relacoes Operacionais Importantes

### Boards

- `boards.organization_id -> organizations.id`
- `board_stages.organization_id -> organizations.id`
- `board_stages.board_id -> boards.id`

### Deals

- `deals.organization_id -> organizations.id`
- `deals.board_id -> boards.id`
- `deals.contact_id -> contacts.id`
- `deals.company_id / client_company_id -> crm_companies.id`
- `deal_items.deal_id -> deals.id`
- `deal_notes.deal_id -> deals.id`
- `deal_files.deal_id -> deals.id`

### Contacts e Companies

- `contacts.organization_id -> organizations.id`
- `crm_companies.organization_id -> organizations.id`

### Activities

- `activities.organization_id -> organizations.id`
- opcionalmente ligadas a `deals`

### Tenant Setup

- `organization_editions.organization_id -> organizations.id`
- `organization_domains.organization_id -> organizations.id`
- `provisioning_runs.organization_id -> organizations.id`

### WhatsApp / Conversations

- `channel_connections.organization_id -> organizations.id`
- `conversation_threads.organization_id -> organizations.id`
- `conversation_threads.channel_connection_id -> channel_connections.id`
- `conversation_threads.contact_id -> contacts.id`
- `conversation_threads.deal_id -> deals.id`
- `conversation_threads.assigned_user_id -> profiles.id`
- `conversation_messages.organization_id -> organizations.id`
- `conversation_messages.thread_id -> conversation_threads.id`

## Ownership por Dominio

### Agency / Plataforma

Tabelas usadas mais pela camada de agencia:

- `organizations`
- `organization_editions`
- `organization_domains`
- `provisioning_runs`

### Clinic / Operacao

Tabelas usadas na operacao da clinica:

- `organization_settings`
- `crm_companies`
- `contacts`
- `boards`
- `board_stages`
- `deals`
- `deal_items`
- `activities`
- `channel_connections`
- `conversation_threads`
- `conversation_messages`

## Tabelas Criticas para Isolamento

Estas sao as tabelas que mais causam risco quando tenant filtering falha:

- `boards`
- `board_stages`
- `contacts`
- `crm_companies`
- `deals`
- `activities`
- `organization_settings`
- `channel_connections`
- `conversation_threads`
- `conversation_messages`

## Regras Operacionais de Dados

1. Toda query critica deve ser escopada por `organization_id`.
2. Toda cache key de dados tenantizados deve incluir `organizationId`.
3. Nenhuma tela operacional deve depender de fetch global seguido de filtro client-side.
4. Toda rota server de operacao precisa validar acesso ao tenant antes de consultar ou mutar.
5. Tabelas tenantizadas precisam de RLS adequada.

## RLS / Hardening

Hardening ja documentado e aplicado:

- `20260311010000_multi_tenant_policy_helpers.sql`
- `20260311013000_core_multi_tenant_rls.sql`

Escopo central endurecido:

- `boards`
- `deals`
- `contacts`
- `activities`
- `organization_settings`
- `api_keys`
- `deal_notes`
- `deal_files`

## Tabelas que Merecem Revisao Complementar Continua

Mesmo com o hardening principal aplicado, estas areas merecem revisao sempre que evoluirem:

- `channel_connections`
- `conversation_threads`
- `conversation_messages`
- storage/exportacoes ligadas a arquivos
- quaisquer novas tabelas tenantizadas futuras

## Como Usar Este Documento

Antes de criar ou mexer em uma entidade:

1. ela tem `organization_id`?
2. quem e o owner do tenant?
3. quais tabelas filhas herdam esse contexto?
4. a API e o cache refletem esse ownership?

