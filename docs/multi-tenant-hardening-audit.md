# Multi-Tenant Hardening Audit

Data: 2026-03-11

## Blindagens implementadas

1. Workspace da clinica
- o menu principal agora resolve rotas tenant-scoped quando a clinica ativa existe
- foram criadas rotas espelho em `/platform/tenants/[tenantId]/...` para `inbox`, `dashboard`, `boards`, `contacts`, `activities`, `reports` e `settings`
- abrir uma clinica leva direto para o dashboard da clinica
- rotas globais do CRM redirecionam de volta para o workspace da clinica quando a sessao esta operando uma clinica

2. Camada de queries
- `boards`, `deals`, `contacts`, `crm_companies` e `activities` buscam por `organization_id` ja na origem
- query keys de cache criticas carregam `organizationId`
- realtime agora assina `postgres_changes` com filtro por `organization_id`

3. AI e automacoes
- as AI tools removem a compatibilidade legada com `organization_id IS NULL`
- o contexto de AI e tarefas continua exigindo `organizationId` explicito
- webhook inbound de Evolution segue gravando por `organization_id`

4. Banco / RLS
- helper migration criada em `20260311010000_multi_tenant_policy_helpers.sql`
- migration core criada em `20260311013000_core_multi_tenant_rls.sql`
- a migration nova troca policies permissivas das tabelas core por policies tenant-aware e separa:
  - acesso operacional
  - acesso de configuracao
  - acesso a filhos de deal (`deal_notes`, `deal_files`)

5. Testes e validacao
- `typecheck`, `lint` e `build` passaram
- suite completa do Vitest passou localmente
- testes novos de guardrail passaram:
  - `test/multiTenantRlsPolicies.test.ts`
  - `test/tenantRealtimeAndAiGuardrails.test.ts`
- testes reais de isolamento multi-tenant passaram com Supabase:
  - `test/tools.multiTenant.test.ts`

## Riscos residuais

1. A migration de RLS core ainda precisa ser aplicada no banco real.
- no repositório, a blindagem SQL ja existe
- no ambiente Supabase, ela so entra em vigor depois do deploy da migration

2. Existem policies permissivas antigas no schema historico.
- elas ficam neutralizadas quando a migration nova e aplicada
- sem aplicar a migration nova no banco real, o hardening fica incompleto

3. O escopo de agencia ainda depende de navegacao e contexto de sessao.
- o fluxo ja esta muito mais consistente
- a separacao por dominio/subdominio ainda e um passo recomendado para fechar UX e entrada

## Criterio de pronto atual

O projeto esta pronto para seguir com deploy controlado do hardening, com este checklist:

1. aplicar `20260311013000_core_multi_tenant_rls.sql` no Supabase
2. validar manualmente uma clinica no workspace tenant-scoped
3. rerodar os testes de isolamento apos a migration aplicada

Sem o passo 1, a blindagem final de banco ainda nao esta ativa no ambiente real.

## Atualizacao 2026-03-11 - Banco real atualizado

- as migrations `20260311010000_multi_tenant_policy_helpers.sql` e `20260311013000_core_multi_tenant_rls.sql` foram aplicadas no projeto Supabase real
- a verificacao posterior confirmou as funcoes:
  - `normalize_profile_role`
  - `current_profile_app_role`
  - `is_agency_role`
  - `is_agency_admin_role`
  - `can_access_organization`
  - `can_operate_organization`
  - `can_configure_organization`
  - `can_access_deal`
  - `can_operate_deal`
- a verificacao posterior confirmou policies tenant-aware em:
  - `boards`
  - `deals`
  - `contacts`
  - `activities`
  - `organization_settings`
  - `api_keys`
  - `deal_notes`
  - `deal_files`
- a blindagem final de banco ja esta ativa no ambiente real
