# Multi-Tenant Hardening Plan

## Objetivo

Blindar o BaseCRM para operacao multi-clinica em banco compartilhado com risco operacional extremamente baixo de mistura de dados, paineis e automacoes.

## Achados Atuais

1. O produto ja opera com subcontas logicas via `organizations` e `organization_id`.
2. Modulos mais novos (`platform`, `channels`, `conversations`) ja usam RLS e rotas escopadas.
3. O nucleo legado ainda tem pontos de risco:
   - rotas globais fora do workspace da clinica
   - queries client-side que buscavam tudo e filtravam depois
   - policies antigas permissivas com `USING (true)` em tabelas centrais
   - caches e query keys que nem sempre carregavam `organizationId`
4. Isso significa que o modelo multi-tenant e viavel, mas a implementacao ainda precisa de blindagem em camadas.

## Meta de Seguranca

Nao existe risco zero absoluto. A meta correta para este projeto e:

- isolamento por tenant no banco
- contexto de tenant resolvido no backend
- frontend sempre tenant-aware
- automacoes/realtime/storage tenant-aware
- testes de nao-vazamento em camadas criticas

## Camadas de Blindagem

### Fase 1 - App Layer

Objetivo:
- impedir mistura imediata de dados no app atual

Escopo:
- sincronizar `tenant ativo` ao entrar em rotas `/platform/tenants/[tenantId]`
- query keys com `organizationId`
- fetch de `boards`, `deals`, `contacts`, `companies`, `activities` ja filtrado na origem
- menu e header orientados ao workspace da clinica

Status:
- concluida

### Fase 2 - Policy Helpers

Objetivo:
- preparar base SQL para policies consistentes

Escopo:
- criar helpers SQL para identificar `auth.uid()`, org do profile e papel do usuario
- padronizar funcoes reutilizaveis para policies

Status:
- concluida

### Fase 3 - Core RLS Hardening

Objetivo:
- remover policies permissivas de tabelas core

Tabelas prioritarias:
- `boards`
- `board_stages`
- `crm_companies`
- `contacts`
- `deals`
- `deal_items`
- `activities`
- `organization_settings`
- `api_keys`

Regra alvo:
- membro so acessa registros do proprio `organization_id`
- admin da clinica gerencia o proprio `organization_id`
- agencia acessa clinicas por rotas server-side dedicadas, nao por bypass client-side

Observacao:
- essa fase precisa vir junto com a separacao definitiva entre workspace da agencia e workspace da clinica, para nao quebrar o uso atual do cliente Supabase no browser

Status:
- implementada no repositório via migration dedicada
- pendente de aplicacao no banco real

### Fase 4 - Agency vs Clinic Boundary

Objetivo:
- impedir que o painel da agencia e o CRM da clinica compartilhem a mesma navegacao mental

Escopo:
- rotas e menus distintos
- header sempre mostrando clinica ativa quando em workspace da clinica
- usuarios da clinica nunca entram no painel master
- agencia troca clinica explicitamente

Status:
- concluida no app shell e na navegacao principal

### Fase 5 - Realtime, Jobs, AI, Webhooks

Objetivo:
- impedir vazamento fora das telas

Escopo:
- canais realtime filtrados por `organization_id`
- jobs e webhooks sempre recebem `tenantId` explicito
- IA nunca executa query sem `organization_id`
- storage e exportacoes com prefixo por tenant

Status:
- realtime e IA endurecidos
- storage/exportacoes ainda exigem revisao complementar

### Fase 6 - Testes de Nao-Vazamento

Objetivo:
- transformar isolamento multi-tenant em criterio de release

Suite minima:
- tenant A nao ve boards do tenant B
- tenant A nao ve deals do tenant B
- dashboard nao mistura contatos/atividades
- cache nao reaproveita dados entre tenants
- agencia troca tenant sem vazar estado anterior
- usuario de clinica nao acessa painel de agencia

Status:
- testes staticos adicionados
- teste real `tools.multiTenant` validado

## Ordem Recomendada

1. concluir Fase 1
2. concluir Fase 2
3. executar Fase 3 em migration dedicada
4. concluir Fase 4
5. fechar Fase 5
6. subir suite da Fase 6

## Riscos Conhecidos

1. Policies permissivas legadas ainda existem no schema inicial.
2. Agencia admin hoje ainda depende parcialmente de contexto selecionado na sessao e navegacao global.
3. Alguns modulos legados ainda precisam migrar de fluxo client-side global para escopo forte por tenant.

## Definicao de Pronto

O ambiente pode ser considerado blindado para multi-clinica quando:

- nenhuma tabela tenantizada tiver policy permissiva global
- toda query critica incluir `organization_id` ou usar rota server-side escopada
- o dashboard de uma clinica nao misturar contatos, atividades, deals ou boards de outra
- trocar de clinica nunca reutilizar cache do tenant anterior
- testes de isolamento passarem no CI

## Atualizacao 2026-03-11

- as migrations `20260311010000_multi_tenant_policy_helpers.sql` e `20260311013000_core_multi_tenant_rls.sql` foram aplicadas no projeto Supabase real
- a blindagem de banco deixou de ser apenas planejada/repositório e passou a estar ativa no ambiente
- os riscos restantes agora estao concentrados na UX do workspace multi-clinica, nao mais na ausencia do RLS core
