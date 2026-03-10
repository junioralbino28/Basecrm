# Platform Admin Operations

## Objetivo

Este documento registra o que ja foi implementado no `Platform Admin`, como validar cada parte e quais dependencias externas precisam estar funcionando.

Use este arquivo como referencia operacional quando houver:

- deploy novo
- erro em producao
- onboarding de nova clinica
- duvida sobre o fluxo de implantacao

## Escopo atual

A camada `Platform Admin` hoje cobre:

- painel interno em `/platform`
- lista de clinicas em `/platform/tenants`
- criacao de nova clinica em `/platform/tenants/new`
- workspace da clinica em `/platform/tenants/[tenantId]`
- branding da clinica
- dominios/subdominios da clinica
- canais da clinica
- contexto visual de `Modo Plataforma` e `Workspace da Clinica`

## Rotas protegidas

Rotas ja entregues:

- `/platform`
- `/platform/tenants`
- `/platform/tenants/new`
- `/platform/tenants/[tenantId]`
- `/platform/tenants/[tenantId]/branding`
- `/platform/tenants/[tenantId]/domains`
- `/platform/tenants/[tenantId]/channels`
- `/platform/tenants/[tenantId]/whatsapp`
- `/platform/tenants/[tenantId]/conversations`

## APIs internas

Rotas internas ja entregues:

- `GET/POST /api/platform/tenants`
- `GET /api/platform/tenants/[tenantId]`
- `GET/PATCH /api/platform/tenants/[tenantId]/branding`
- `GET/POST /api/platform/tenants/[tenantId]/domains`
- `GET/POST /api/platform/tenants/[tenantId]/channels`
- `PATCH /api/platform/tenants/[tenantId]/channels/[connectionId]`
- `POST /api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck`
- `POST /api/platform/tenants/[tenantId]/channels/[connectionId]/connect`
- `POST /api/platform/tenants/[tenantId]/channels/[connectionId]/disconnect`
- `GET/POST /api/platform/tenants/[tenantId]/conversations`
- `GET/POST /api/platform/tenants/[tenantId]/conversations/[threadId]/messages`
- `GET /api/platform/tenant/current`

## Migrations obrigatorias

Ja aplicadas na instancia `basecrm.vercel.app`:

- `supabase/migrations/20260310000000_platform_provisioning.sql`
- `supabase/migrations/20260310010000_platform_channel_connections.sql`

Essas migrations criam:

- `organization_editions`
- `organization_domains`
- `provisioning_runs`
- `channel_connections`
- `conversation_threads`
- `conversation_messages`

## Dependencias externas

Para o `Platform Admin` funcionar corretamente, a instancia precisa de:

- deploy atualizado na Vercel
- schema atualizado no Supabase
- autenticacao funcionando
- usuario com `profile.role = admin`

Para canais Evolution:

- `apiUrl` da Evolution valida
- `instanceName` existente
- `apiKey` valida

## Fluxo de validacao

### 1. Validar acesso

1. fazer login
2. abrir `/platform`
3. confirmar que o menu lateral mostra:
   - `Platform Admin`
   - `Clinicas`
   - `Nova Clinica`

### 2. Validar criacao de clinica

1. abrir `/platform/tenants/new`
2. preencher briefing
3. concluir criacao
4. validar redirecionamento para `/platform/tenants`
5. abrir a clinica criada

### 3. Validar branding

1. abrir `/platform/tenants/[tenantId]/branding`
2. alterar `displayName`, `accentColor` ou `themeMode`
3. salvar
4. voltar ao workspace e confirmar reflexo visual

### 4. Validar dominios

1. abrir `/platform/tenants/[tenantId]/domains`
2. cadastrar um host
3. confirmar listagem

### 5. Validar canais

1. abrir `/platform/tenants/[tenantId]/channels`
2. cadastrar conexao Evolution
3. executar `Testar conexao`
4. executar `Gerar pareamento`

## Comandos locais de validacao

Antes de publicar:

- `npm run typecheck`
- `npm run lint`

## Riscos conhecidos

- o termo tecnico `tenant` ainda existe internamente em nomes de arquivo, hooks e APIs
- o QR Code visual ainda nao foi implementado; o sistema hoje registra o retorno do pareamento
- `channel_connections.config.apiKey` esta sendo salvo para permitir operacao real da Evolution; isso deve ser revisado futuramente para endurecimento de seguranca

## Checklist de deploy

1. aplicar migrations novas no Supabase
2. publicar commit no `main`
3. aguardar deploy na Vercel
4. validar `/platform`
5. validar uma clinica ja existente
6. validar `Canais`

## Troubleshooting

### `/platform` retorna 404

Causa provavel:

- deploy antigo na Vercel

### `/platform` retorna 500

Causas provaveis:

- migration nao aplicada
- tabela nova ausente

### `Testar conexao` falha

Causas provaveis:

- `apiUrl` invalida
- `instanceName` incorreta
- `apiKey` invalida
- Evolution indisponivel

### `Gerar pareamento` falha

Causas provaveis:

- conexao sem `apiUrl`, `instanceName` ou `apiKey`
- endpoint da Evolution diferente do esperado
- numero da instancia invalido
