# BaseCRM Engineering Playbook

## Objetivo

Este playbook define como evoluir, validar e corrigir o BaseCRM com menos regressao, menos mistura entre clinicas e menos incidentes de navegacao, cache e permissao.

Ele serve como referencia de execucao para:

- construir novas features
- revisar mudancas estruturais
- investigar bugs
- corrigir incidentes sem reabrir problemas antigos
- decidir quando algo esta pronto para deploy

## Principios

1. O BaseCRM deve continuar como `modular monolith`.
- Evitar microservices prematuros.
- Separar por dominios bem definidos dentro do mesmo repositorio.

2. O sistema e `multi-tenant` em banco compartilhado.
- Toda entidade operacional relevante precisa respeitar `organization_id`.
- Tenant isolation deve existir no banco, no backend, no frontend e no cache.

3. O backend resolve contexto.
- O frontend pode escolher a clinica.
- O backend e o banco decidem o que o usuario realmente pode acessar.

4. UX nunca pode mascarar falha estrutural.
- Em vez de spinner infinito, a tela deve falhar rapido e claramente.
- Em vez de rota global quebrada, redirecionar para um contexto valido.

5. Mudancas grandes devem ser incrementais.
- Pequenos passos.
- Validacao curta em cada etapa.
- Rollback rapido quando necessario.

## Arquitetura Alvo

### 1. Boundaries de produto

Separar sempre:

- `agency workspace`
- `clinic workspace`

Regras:

- usuario da agencia pode operar varias clinicas
- usuario da clinica enxerga apenas a propria clinica
- a navegacao deve refletir isso explicitamente

### 2. Boundaries de codigo

Dominios recomendados:

- `auth`
- `tenancy`
- `boards`
- `deals`
- `contacts`
- `activities`
- `settings`
- `channels`
- `conversations`
- `ai`

Cada dominio deve concentrar:

- tipos
- services
- query hooks
- rotas server/API
- testes do proprio dominio

Evitar logica de negocio espalhada entre:

- `components`
- `contexts`
- `pages`

### 3. Multi-tenant

Obrigatorio para qualquer fluxo operacional:

- `organization_id` na entidade
- query filtrada na origem
- cache key com tenant
- permissao validada no backend
- RLS ativa no banco quando a tabela for tenantizada

## Regras Obrigatorias de Implementacao

### 1. Tenant-aware by default

Toda nova feature deve responder:

1. Qual e o `organization_id` dessa entidade?
2. Como o tenant atual e resolvido no backend?
3. Como o frontend sabe qual clinica esta operando?
4. Como o cache separa tenant A de tenant B?
5. Como o realtime/webhook/job evita vazamento?

Se uma dessas respostas estiver vaga, a feature ainda nao esta pronta.

### 2. Rota global vs rota tenant-scoped

Quando um modulo depende de uma clinica ativa, prefira rota tenant-scoped:

- correto: `/platform/tenants/[tenantId]/boards`
- evitar depender apenas de `/boards` quando a agencia esta operando uma clinica

Se uma rota global for mantida:

- ela precisa redirecionar para a clinica ativa
- ou bloquear de forma explicita quando nao houver clinica ativa

### 3. Cache

Toda query critica deve incluir tenant na identidade da cache.

Obrigatorio:

- deals: `getDealsViewQueryKey(organizationId)`
- demais entidades: chave contendo `organizationId`

Evitar:

- chave global para dados tenantizados
- optimistic update em cache diferente da consulta principal

### 4. Loading e erro

Nao deixar a tela em spinner eterno.

Toda tela critica precisa ter:

- estado de loading
- estado de empty
- estado de erro
- fallback quando tenant/contexto estiver ausente

### 5. Permissoes

Usar dois niveis:

- escopo do usuario
- permissao granular

Papeis atuais:

- `agency_admin`
- `agency_staff`
- `clinic_admin`
- `clinic_staff`

Regras:

- a UI pode esconder acao
- o backend precisa bloquear de verdade
- falha de leitura de override nunca deve derrubar o modulo inteiro

## Guardrails do MVP Imediato

Para colocar uma empresa rodando rapidamente sem comprometer o desenvolvimento futuro, as integracoes imediatas devem seguir estes guardrails:

1. O CRM continua como fonte de verdade.
2. O canal continua entrando pelo CRM antes de qualquer automacao externa.
3. O n8n atua como cerebro/orquestrador, nao como dono do estado operacional.
4. Toda nova automacao deve ser aditiva e reversivel.
5. O caminho manual da equipe precisa continuar funcionando mesmo se a automacao falhar.
6. Automacoes de atendimento nao devem assumir o controle do funil ativo nesta primeira fase.
7. Funil, follow-up e tarefas automaticas so entram depois de configuracao explicita e validacao da agencia.

Aplicacao imediata:

- `Evolution -> CRM -> n8n -> CRM -> Evolution`
- `Conversas` como modulo central do atendimento
- `Conexoes` como infraestrutura de canal
- sem mover oportunidades automaticamente no MVP inicial
- sem acoplar o atendimento a automacoes comerciais ainda incompletas

Objetivo:

- colocar a clinica operando rapido
- evitar gambiarra estrutural
- impedir que a evolucao futura quebre o funil ja em andamento

## Como Construir Nova Feature

Use esta sequencia.

### Etapa 1. Modelagem

Definir:

- dominio
- entidade
- tenant owner
- escopo de acesso
- impacto na UX da agencia e da clinica

### Etapa 2. Banco

Definir:

- colunas
- `organization_id`
- indices
- policy/RLS
- estrategia de compatibilidade com dados antigos

### Etapa 3. Backend

Criar:

- service do dominio
- rota/API
- validacao de payload
- validacao de tenant
- validacao de permissao

### Etapa 4. Frontend

Criar:

- query hook tenant-aware
- componente/tela
- loading/error/empty states
- navegacao coerente com contexto

### Etapa 5. Teste

Cobrir no minimo:

- tenant A nao ve tenant B
- papel sem permissao recebe bloqueio correto
- cache nao mistura tenant
- tela responde bem a loading e erro

### Etapa 6. Documentacao

Atualizar:

- `docs/implementation-journal.md`
- hardening docs, quando mexer em multi-tenant
- eventual ADR, quando a decisao for estrutural

## Como Investigar Bugs

Sempre seguir esta ordem.

### 1. Classificar o bug

Categoria:

- `navegacao/contexto`
- `tenant mix`
- `cache/query`
- `RLS/permissao`
- `integracao externa`
- `UI state`
- `dados legados`

### 2. Descobrir a camada real da falha

Perguntas:

1. a rota abriu?
2. a query executou?
3. o tenant foi resolvido?
4. a policy bloqueou?
5. o cache reutilizou dado errado?
6. a UI ficou presa em loading sem erro?

### 3. Verificar o ponto comum

Quando varios modulos quebram ao mesmo tempo, procurar primeiro:

- `Layout`
- `TenantContext`
- `AuthContext`
- helpers de tenant
- helpers de permissao

Antes de mexer no modulo final.

### 4. Preferir hotfix seguro

Se o incidente estiver no ar:

- restaurar fluxo minimo
- usar fallback seguro
- remover loading infinito
- evitar reestruturacao grande no meio do incidente

Depois fazer a correcao definitiva.

## Como Corrigir com Menos Risco

### 1. Corrigir o ponto de entrada

Se um modulo inteiro quebra por causa de um helper comum, corrigir o helper antes da tela.

Exemplos:

- permissao
- tenant current
- link builder
- route guard

### 2. Falhar com degradacao segura

Sempre que possivel:

- usar permissao padrao do papel quando override falhar
- redirecionar para contexto valido quando tenant faltar
- mostrar erro explicito quando a query falhar

Evitar:

- travar tudo por dependencia secundaria
- esconder erro em spinner infinito

### 3. Testar antes de publicar

Minimo local:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Quando a mudanca tocar tenancy, cache ou auth:

- testes direcionados do modulo
- smoke manual multi-clinica

## Definition of Done

Uma mudanca so esta pronta quando:

1. tenant e permissao foram pensados
2. o modulo nao mistura dados entre clinicas
3. loading/error/empty state existem
4. `typecheck`, `lint` e `build` passaram
5. testes direcionados passaram quando a area e critica
6. journal foi atualizado
7. o fluxo foi validado no contexto certo: agencia ou clinica

## Checklist de Release

Antes de push/deploy:

1. revisar `git status`
2. remover residuos locais
3. confirmar docs alinhados com o codigo
4. rodar validacoes basicas

Antes de considerar a release segura:

1. abrir pelo menos 2 clinicas
2. validar:
- `Visao Geral`
- `Boards`
- `Contatos`
- `Atividades`
- `Settings`
- `WhatsApp`
- `Conversations`
3. confirmar que nao mistura dados nem volta para rota global errada

## Checklist de Incidente

Quando o sistema estiver quebrado em producao:

1. identificar o fluxo afetado
2. verificar se o problema e:
- tenant ausente
- permissao
- query
- cache
- layout/navigation
3. aplicar hotfix pequeno e reversivel
4. validar localmente
5. publicar
6. revalidar no ambiente
7. documentar causa raiz e correcao

## ADRs Recomendados

Criar ADR curto quando mexer em:

- modelo `agency vs clinic`
- tenant resolution
- query key strategy
- feature flags
- boundaries de AI
- handoff IA vs humano
- storage/export por tenant

Template sugerido:

- contexto
- decisao
- impacto
- riscos
- rollback

## O que Evitar

- query global com filtro client-side para dados tenantizados
- spinner infinito sem erro
- usar apenas a UI como controle de permissao
- feature flag sem dono e sem plano de remocao
- mudar varias camadas estruturais e publicar tudo junto sem smoke test
- corrigir bug de multi-tenant apenas no frontend

## Aplicacao Pratica no BaseCRM

Prioridades permanentes:

1. manter `agency workspace` e `clinic workspace` bem separados
2. continuar reduzindo dependencia de contextos agregados grandes
3. testar tenant-scoped navigation sempre que o shell mudar
4. exigir `organizationId` em qualquer novo modulo operacional
5. tratar hotfixes de producao como incidente, nao como refatoracao escondida

## Fontes-base desta logica

Esta logica foi consolidada a partir de praticas amplamente adotadas em:

- Martin Fowler
- Thoughtworks
- Google SRE
- AWS SaaS / tenant isolation
- Supabase docs
- TanStack Query docs
- Next.js docs
- artigos de engenharia de GitHub, Lyft e Uber sobre rollout, flags e seguranca operacional

O objetivo aqui nao e copiar um framework teorico, e sim transformar essas praticas em rotina de execucao do BaseCRM.
