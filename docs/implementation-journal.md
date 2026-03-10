# Implementation Journal

## Objetivo

Registrar, em ordem cronologica, o que foi implementado no produto para que nenhuma evolucao se perca.

Regra operacional a partir deste ponto:

- toda evolucao relevante deve atualizar este arquivo
- toda nova feature deve apontar:
  - data
  - objetivo
  - entregas
  - migrations
  - validacao
  - riscos ou pendencias

## Template

```md
## YYYY-MM-DD - titulo curto

Objetivo:

- ...

Entregas:

- ...

Arquivos principais:

- ...

Migrations:

- ...

Validacao:

- ...

Pendencias:

- ...
```

## 2026-03-10 - Platform Admin base

Objetivo:

- iniciar a camada interna de implantacao do CRM Clinica

Entregas:

- `/platform`
- `/platform/tenants`
- `/platform/tenants/new`
- criacao de clinica com provisioning inicial
- generation de board inicial com IA

Arquivos principais:

- `app/(protected)/platform/...`
- `features/platform/...`
- `lib/provisioning/...`
- `app/api/platform/tenants/route.ts`

Migrations:

- `20260310000000_platform_provisioning.sql`

Validacao:

- `npm run typecheck`
- `npm run lint`
- deploy validado em `basecrm.vercel.app`

Pendencias:

- navegação mais clara
- canais reais
- agenda

## 2026-03-10 - Tenant por host e branding

Objetivo:

- introduzir identidade por clinica e operacao por subdominio/host

Entregas:

- resolucao de clinica por host
- branding carregado no layout
- paginas de branding e dominios
- contexto atual da clinica no app

Arquivos principais:

- `lib/tenancy/resolveTenant.ts`
- `lib/branding/getTenantBranding.ts`
- `context/TenantContext.tsx`
- `app/api/platform/tenant/current/route.ts`

Migrations:

- incluida em `20260310000000_platform_provisioning.sql`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- publicacao por dominio proprio

## 2026-03-10 - Registry de canais

Objetivo:

- criar a base operacional para WhatsApp/Evolution por clinica

Entregas:

- `channel_connections`
- tela de canais por clinica
- CRUD basico de conexao

Arquivos principais:

- `app/api/platform/tenants/[tenantId]/channels/...`
- `features/platform/tenants/TenantChannelsPage.tsx`
- `lib/channels/types.ts`

Migrations:

- `20260310010000_platform_channel_connections.sql`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- healthcheck real
- pareamento
- QR Code

## 2026-03-10 - Navegacao de plataforma

Objetivo:

- expor a area de implantacao sem depender de URL manual

Entregas:

- menu lateral com `Platform Admin`
- menu lateral com `Clinicas`
- menu lateral com `Nova Clinica`
- atalhos no menu de usuario
- indicador de contexto no header

Arquivos principais:

- `components/Layout.tsx`
- `components/navigation/navConfig.ts`
- `components/navigation/MoreMenuSheet.tsx`
- `components/navigation/NavigationRail.tsx`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- seletor mais avancado de clinica

## 2026-03-10 - Evolution healthcheck e pareamento

Objetivo:

- sair do registry estatico e operar a conexao real da Evolution

Entregas:

- healthcheck real via `connectionState`
- solicitacao de pareamento via `connect`
- exibicao do ultimo estado retornado
- exibicao do ultimo codigo de pareamento

Arquivos principais:

- `lib/channels/evolution.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`
- `features/platform/tenants/TenantChannelsPage.tsx`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- QR Code visual
- inbox
- sincronizacao de mensagens

## 2026-03-10 - Modulo WhatsApp mais explicito

Objetivo:

- deixar a operacao da Evolution menos tecnica e mais alinhada ao produto clinica

Entregas:

- rota amigavel `/platform/tenants/[tenantId]/whatsapp`
- card do workspace renomeado para `WhatsApp`
- tela com linguagem mais operacional
- edicao de conexao existente
- exibicao visual do payload de pareamento quando aproveitavel

Arquivos principais:

- `app/(protected)/platform/tenants/[tenantId]/whatsapp/page.tsx`
- `features/platform/tenants/TenantWorkspacePage.tsx`
- `features/platform/tenants/TenantChannelsPage.tsx`
- `docs/evolution-channels.md`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- QR Code visual 100% confiavel para todos os formatos de payload
- desconectar/reconectar guiado
- inbox de conversas
