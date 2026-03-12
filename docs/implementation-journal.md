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
- reconectar guiado mais completo
- inbox de conversas

## 2026-03-10 - Desconexao operacional da Evolution

Objetivo:

- permitir que a equipe desconecte um numero da clinica sem apagar a conexao do CRM

Entregas:

- rota de desconexao real via Evolution
- botao `Desconectar`
- botao `Reconectar` reaproveitando o fluxo de pareamento

Arquivos principais:

- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/disconnect/route.ts`
- `lib/channels/evolution.ts`
- `features/platform/tenants/TenantChannelsPage.tsx`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- fluxo mais profundo de reconexao guiada
- inbox de conversas

## 2026-03-10 - Base de Conversations

Objetivo:

- iniciar a camada de conversas por clinica para suportar WhatsApp, handoff e historico operacional

Entregas:

- tabelas `conversation_threads` e `conversation_messages`
- APIs para listar/criar conversas
- APIs para listar/criar mensagens
- tela inicial de `Conversations` por clinica

Arquivos principais:

- `supabase/migrations/20260310020000_platform_conversations.sql`
- `app/api/platform/tenants/[tenantId]/conversations/route.ts`
- `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`
- `app/(protected)/platform/tenants/[tenantId]/conversations/page.tsx`
- `features/platform/tenants/TenantConversationsPage.tsx`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- sincronizacao real com mensagens da Evolution
- vinculo automatico com contato/deal
- inbox operacional completo

## 2026-03-10 - Inbound basico da Evolution em Conversations

Objetivo:

- fazer mensagens reais da Evolution entrarem em `Conversations` sem depender de cadastro manual

Entregas:

- rota publica de webhook por conexao
- `webhookSecret` gerado automaticamente em novas conexoes
- URL do webhook do CRM exposta na tela de WhatsApp
- parse best-effort de payloads comuns da Evolution
- criacao ou reaproveitamento de `conversation_threads`
- registro de `conversation_messages`
- atualizacao de metadata da conexao com ultimo inbound recebido

Arquivos principais:

- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `lib/conversations/evolutionWebhook.ts`
- `app/api/platform/tenants/[tenantId]/channels/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`
- `features/platform/tenants/TenantChannelsPage.tsx`
- `docs/evolution-channels.md`

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- ampliar compatibilidade com mais formatos de payload da Evolution
- sincronizacao outbound real
- inbox operacional com vinculacao automatica mais profunda

## 2026-03-10 - Politica de checkpoint estavel

Objetivo:

- garantir ponto formal de retorno para rollback e diagnostico

Entregas:

- documento de checkpoints estaveis
- convencao de tags para marcos do CRM Clinica
- primeiro checkpoint registrado para a camada atual de WhatsApp e Conversations

Arquivos principais:

- `docs/release-checkpoints.md`

Validacao:

- checkpoint documentado
- tag git criada para o estado atual

Pendencias:

- seguir registrando novos checkpoints a cada marco estavel relevante

## 2026-03-10 - Inbox operacional de Conversations

Objetivo:

- evoluir `Conversations` de CRUD basico para uma mesa de operacao utilizavel em cima do inbound ja recebido da Evolution

Entregas:

- listagem de conversas enriquecida com preview, unread count, contagem de mensagens, conexao, contato, deal e responsavel
- resumo operacional com contadores de fila
- filtros de status, nao lidas, sem responsavel e busca textual
- painel de detalhe com timeline, atribuicao e atualizacao de status
- acao de marcar conversa como lida
- composer para registrar resposta outbound e nota interna
- metadata de thread atualizada de forma consistente em inbound e em mensagens registradas manualmente
- normalizacao de telefone no webhook da Evolution para melhorar reaproveitamento de thread e vinculo com contato

Arquivos principais:

- `features/platform/tenants/TenantConversationsPage.tsx`
- `app/api/platform/tenants/[tenantId]/conversations/route.ts`
- `app/api/platform/tenants/[tenantId]/conversations/[threadId]/route.ts`
- `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `lib/conversations/server.ts`
- `lib/conversations/threadMetadata.ts`
- `lib/conversations/types.ts`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- envio outbound real via Evolution ainda nao foi implementado
- vinculacao manual profunda com contato/deal ainda pode ser expandida
- realtime dedicado para inbox ainda nao foi adicionado; a tela usa refresh/polling

## 2026-03-10 - Outbound real da Evolution em Conversations

Objetivo:

- permitir que o operador responda pela propria tela de `Conversations` e tente envio real pela Evolution

Entregas:

- composer outbound agora envia pela Evolution quando a thread possui conexao WhatsApp valida
- fallback best-effort para formatos comuns do endpoint `sendText`
- persistencia de `delivery_status`, `delivery_error`, `delivery_provider` e `provider_message_id` no metadata da mensagem
- aviso visual no composer quando a mensagem e registrada mas o envio externo falha

Arquivos principais:

- `lib/channels/evolution.ts`
- `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`
- `features/platform/tenants/TenantConversationsPage.tsx`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- confirmar em ambiente real qual variante de payload/endpoint da Evolution e a definitiva
- adicionar status de entrega mais profundo se a Evolution expuser confirmacao posterior

## 2026-03-10 - Observabilidade de entrega outbound

Objetivo:

- tornar o outbound da Evolution auditavel na propria timeline de `Conversations`

Entregas:

- badge visual de `Enviada` ou `Falhou` na mensagem outbound
- exibicao de erro de entrega na propria bolha da conversa
- persistencia de `delivery_attempt` para diagnostico de compatibilidade da Evolution
- ampliacao do best-effort com mais uma variante comum de payload para `sendText`

Arquivos principais:

- `features/platform/tenants/TenantConversationsPage.tsx`
- `lib/conversations/types.ts`
- `lib/channels/evolution.ts`
- `app/api/platform/tenants/[tenantId]/conversations/[threadId]/messages/route.ts`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`

Pendencias:

- confirmar online qual tentativa de envio vira padrao da instancia Evolution usada em producao

## 2026-03-10 - Ferramenta de migracao do tenant legado

Objetivo:

- preparar uma migracao segura do tenant legado da conta master para uma clinica correta depois da validacao geral do projeto

Entregas:

- script de auditoria e migracao por `organization_id`
- escopo principal para `boards`, `deals`, `contacts`, `products`, `activities` e relacionamentos diretos
- escopo estendido opcional para `settings`, `IA`, `conversations`, `channels`, `webhooks` e `api_keys`
- abort de seguranca quando o tenant de destino ja possui dados no escopo principal
- documentacao operacional da migracao

Arquivos principais:

- `scripts/legacy-tenant-migration.mjs`
- `docs/legacy-tenant-migration.md`
- `package.json`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run test:run`

Pendencias:

- executar `audit` com os UUIDs reais do tenant legado e da clinica destino
- depois rodar a migracao real em ambiente com service role configurado

## 2026-03-11 - Hardening multi-tenant aplicado no Supabase real

Objetivo:

- fechar a blindagem multi-clinica em banco compartilhado
- reduzir o risco de mistura entre paineis, caches, queries e dados de clinicas

Entregas:

- workspace tenant-scoped expandido para `dashboard`, `boards`, `contacts`, `activities`, `reports`, `settings` e `inbox`
- navegacao principal orientada por clinica ativa
- sincronizacao do tenant ativo ao entrar por `/platform/tenants/[tenantId]`
- queries core (`boards`, `deals`, `contacts`, `activities`, `products`) filtradas na origem por `organization_id`
- realtime endurecido com filtro por `organization_id`
- AI tools endurecidas para nao consultar dados fora do tenant
- helper SQL multi-tenant por papel, organizacao e deal
- RLS core tenant-aware aplicado no Supabase real

Arquivos principais:

- `components/Layout.tsx`
- `components/navigation/navConfig.ts`
- `components/navigation/useTenantScopedHref.ts`
- `context/TenantContext.tsx`
- `lib/query/hooks/useBoardsQuery.ts`
- `lib/query/hooks/useDealsQuery.ts`
- `lib/query/hooks/useContactsQuery.ts`
- `lib/query/hooks/useActivitiesQuery.ts`
- `lib/realtime/useRealtimeSync.ts`
- `lib/ai/tools.ts`
- `docs/multi-tenant-hardening-plan.md`
- `docs/multi-tenant-hardening-audit.md`

Migrations:

- `20260311010000_multi_tenant_policy_helpers.sql`
- `20260311013000_core_multi_tenant_rls.sql`

Validacao:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npx vitest run --maxWorkers=1`
- `npx vitest test/multiTenantRlsPolicies.test.ts --run`
- `npx vitest test/tenantRealtimeAndAiGuardrails.test.ts --run`
- aplicacao confirmada no Supabase real com verificacao posterior das funcoes e policies

Pendencias:

- separar melhor UX de troca de clinica e troca de board
- deixar a tela `Clinicas` claramente clicavel/editavel
- continuar validacao manual do workspace multi-clinica depois do hardening de banco

## 2026-03-11 - UX do workspace multi-clinica refinada

Objetivo:

- deixar a operacao da clinica mais clara no app antes do push final
- reduzir a ambiguidade entre clinica ativa, board ativo e painel da agencia

Entregas:

- switcher reutilizavel de clinica ativa no header e em pontos operacionais
- `Boards` agora separa melhor a troca de clinica da troca de funil
- seletor de board passou a se apresentar explicitamente como `Funil`
- sidebar da area tenant-scoped prioriza itens da clinica ativa antes dos atalhos da agencia
- branding do sidebar em workspace de clinica passou a refletir a clinica ativa
- tela `Clinicas` ficou visualmente mais explicita como ponto de entrada no workspace

Arquivos principais:

- `components/navigation/TenantClinicSwitcher.tsx`
- `components/Layout.tsx`
- `features/boards/components/BoardSelector.tsx`
- `features/boards/components/Kanban/KanbanHeader.tsx`
- `features/boards/components/PipelineView.tsx`
- `features/dashboard/DashboardPage.tsx`
- `features/platform/tenants/TenantsPage.tsx`
- `lib/tenancy/workspaceRoutes.ts`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Pendencias:

- validar manualmente o fluxo com pelo menos duas clinicas reais no browser
- decidir se `WhatsApp` e `Conversations` devem continuar como itens secundarios ou subir para grupo principal do menu

## 2026-03-11 - Playbook de engenharia do BaseCRM

Objetivo:

- consolidar uma referencia pratica de arquitetura, validacao e correcao para reduzir regressao e mistura entre clinicas

Entregas:

- playbook interno de construcao, investigacao de bugs, Definition of Done e checklist de release
- consolidacao das regras de multi-tenant, cache, permissao, UX e hotfix operacional

Arquivos principais:

- `docs/basecrm-engineering-playbook.md`

Migrations:

- nenhuma

Validacao:

- revisao manual do documento
- alinhamento com `multi-tenant-hardening-plan` e `multi-tenant-hardening-audit`

Pendencias:

- transformar o playbook em rotina operacional da equipe
- criar ADR template e checklist de release separado se a equipe passar a usar isso com frequencia

## 2026-03-11 - MVP imediato de IA no WhatsApp com n8n

Objetivo:

- colocar uma empresa operando com IA no WhatsApp no menor prazo possivel
- preservar o funil comercial que ja vai entrar em andamento
- evitar acoplamento ruim entre atendimento, canal e pipeline

Decisoes:

- o CRM continua como fonte de verdade da conversa
- a Evolution continua como canal de entrada e saida
- o n8n entra como cerebro/orquestrador da IA
- o fluxo oficial passa a ser `Evolution -> CRM -> n8n -> CRM -> Evolution`
- a IA atua inicialmente em `Conversas`, resumo e handoff
- a IA nao movimenta automaticamente o funil nesta fase

Entregas:

- helper de automacao externa por conversa no CRM
- endpoint publico `ai-reply` para retorno do n8n
- webhook inbound da Evolution ajustado para disparar automacao quando a thread estiver em `ai_active`
- workflow `agente CRM` gerado a partir do fluxo da clinica, removendo dependencias frageis de Redis e envio direto para Evolution

Arquivos principais:

- `lib/conversations/n8nAutomation.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts`
- `scripts/build-n8n-agente-crm.mjs`
- `tmp/n8n/agente-crm.workflow.json`
- `docs/n8n-agente-crm-mvp.md`

Validacao:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- revisao funcional do fluxo CRM -> n8n -> CRM

Guardrails:

- nao mexer automaticamente em etapas do funil
- nao ligar follow-up automatico agora
- nao acoplar o atendimento ao pipeline ativo da clinica
- qualquer automacao futura de funil deve ser adicionada por configuracao explicita

Pendencias:

- ativar workflow do n8n no ambiente real
- configurar `webhookUrl` e `webhookSecret` na conexao da empresa
- validar ponta a ponta com uma conversa real no WhatsApp

## 2026-03-12 - Evolution com credencial global da agencia

Objetivo:

- reduzir friccao de implantacao do WhatsApp nas clinicas
- evitar que cada clinica precise preencher API URL e token tecnico da Evolution

Entregas:

- credencial global da Evolution salva no contexto da agencia
- resolucao de credencial por fallback:
  - primeiro pela conexao da clinica
  - depois pela credencial global da agencia
- vinculo tecnico entre clinica e agencia preservado para reaproveitar a credencial global
- fluxo assistido de conexao para a clinica trabalhar com instancia + numero

Arquivos principais:

- `app/api/platform/agency/evolution/route.ts`
- `lib/channels/evolutionCredentials.ts`
- `app/api/platform/tenants/[tenantId]/channels/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts`
- `lib/provisioning/runProvisioning.ts`
- `features/platform/tenants/TenantChannelsPage.tsx`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- deploy em `main`

Pendencias:

- manter a UX da clinica o mais simples possivel e esconder configuracao tecnica desnecessaria
- validar o fluxo com mais de uma clinica operando na mesma Evolution

## 2026-03-12 - Pareamento QR e conexao visual do WhatsApp

Objetivo:

- permitir que a clinica conecte o numero via QR code direto no CRM
- reduzir dependencia do painel tecnico da Evolution para o time da clinica

Entregas:

- modal de `Conectar WhatsApp` dentro de `Conversas`
- leitura de conexoes da clinica e selecao de numero/instancia ativa
- acao de `Gerar QR code`
- acao de `Atualizar status`
- renderizacao visual ampliada do QR code e exibicao do codigo de pareamento
- ajustes para evitar retorno de QR pouco escaneavel

Arquivos principais:

- `features/platform/tenants/TenantConversationsPage.tsx`
- `features/platform/tenants/TenantChannelsPage.tsx`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts`
- `lib/channels/evolution.ts`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- pareamento real validado ate estado `connected`

Pendencias:

- continuar simplificando a jornada da clinica para virar apenas `conectar` e `reconectar`
- revisar se o QR deve continuar em modal ou embutido no painel de conversa

## 2026-03-12 - Webhook inbound Evolution e chegada de mensagens em Conversations

Objetivo:

- fazer o CRM receber mensagens reais do WhatsApp em tempo operacional
- evitar que a conexao apareca como `connected` sem entregar mensagens no inbox

Entregas:

- configuracao automatica do webhook do CRM na Evolution ao gerar QR code ou atualizar status
- refresh mais agressivo da tela de conversas para refletir novas mensagens em poucos segundos
- endurecimento do endpoint inbound da Evolution com fallback por `instanceName` quando o webhook chega sem `secret`
- gravacao de metadados operacionais de webhook na conexao para diagnostico

Arquivos principais:

- `lib/channels/evolution.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts`
- `app/api/platform/tenants/[tenantId]/channels/[connectionId]/healthcheck/route.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `features/platform/tenants/TenantConversationsPage.tsx`
- `features/platform/tenants/TenantChannelsPage.tsx`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- deploy em `main`

Pendencias:

- confirmar no ambiente real a entrada ponta a ponta `WhatsApp -> Evolution -> CRM`
- se ainda houver falha, expor na UI o ultimo webhook recebido e o ultimo motivo de descarte

## 2026-03-12 - Simplificacao da tela Conversations para layout fixo de chat

Objetivo:

- abandonar o layout intermediario e aproximar a experiencia visual do WhatsApp
- manter a tela sempre em formato de chat, sem blocos analiticos competindo com a operacao

Entregas:

- remocao dos cards superiores de resumo dentro da tela `Conversas`
- remocao da criacao manual de conversa da interface principal
- manutencao apenas do botao `Conectar WhatsApp` no topo
- lista de conversas escura e persistente na coluna esquerda
- area principal mantida como painel de chat
- composer horizontal no rodape para resposta operacional

Arquivos principais:

- `features/platform/tenants/TenantConversationsPage.tsx`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- deploy em `main`

Pendencias:

- aproximar ainda mais o header da conversa do visual do WhatsApp
- concluir a ligacao funcional com mensagens reais inbound antes de considerar a tela pronta

## 2026-03-12 - Evolution inbound materializa lead/oportunidade e conversa ganha base de mensageria real

Objetivo:

- fechar o gap entre `WhatsApp conectado` e `CRM realmente operacional`
- garantir que a mensagem inbound entre no inbox e gere oportunidade no funil
- aproximar a tela `Conversas` do padrao de apps de mensageria

Entregas:

- `setEvolutionWebhook` passou a registrar o webhook base sem `webhook_by_events`, reduzindo incompatibilidade com a rota publica do CRM
- criacao de rota catch-all para aceitar posts da Evolution em caminhos por evento (`/messages-upsert`, `/connection-update`, etc.)
- inbound agora faz upsert de `contacts` por telefone e cria/reaproveita `deals` abertos no primeiro inbound
- `conversation_threads.deal_id` passa a ser vinculado automaticamente quando a oportunidade e materializada
- lista de `Conversas` ficou mais densa e com hierarquia mais parecida com mensageiros reais
- header e composer da conversa foram simplificados para uma experiencia mais proxima de WhatsApp

Arquivos principais:

- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/[...eventPath]/route.ts`
- `lib/channels/evolution.ts`
- `features/platform/tenants/TenantConversationsPage.tsx`
- `docs/evolution-channels.md`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Pendencias:

- validar no ambiente real se o inbound da Evolution ja entra ponta a ponta apos reaplicar `Atualizar status`
- se necessario, expor no frontend o ultimo `eventPath` recebido e o ultimo erro de materializacao
- seguir refinando a tela `Conversas` ate bater mais de perto com o padrao visual do WhatsApp

## 2026-03-12 - IA nativa de atendimento responde o inbound do WhatsApp

Objetivo:

- usar a IA ja configurada na organizacao para a Julia responder automaticamente os leads
- remover a dependencia exclusiva de webhook externo para o primeiro atendimento
- manter handoff humano e fallback de automacao externa quando a IA nativa nao puder responder

Entregas:

- criacao de helper compartilhado `lib/conversations/aiReply.ts` para:
  - gerar resposta automatica com IA nativa
  - enviar a resposta via Evolution
  - registrar outbound e resumo interno no CRM
  - atualizar a thread para `ai_active` ou `human_queue`
- `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts` passou a reutilizar o helper compartilhado
- webhook inbound da Evolution agora tenta responder primeiro com IA nativa do CRM
- o `webhookUrl` externo passou a atuar como fallback quando a IA nativa estiver indisponivel ou falhar
- adicao do prompt catalogado `task_conversations_whatsapp_auto_reply` para a persona da Julia
- refinamento do prompt/fallback para:
  - mensagens mais curtas e quebradas em 2 ou 3 blocos
  - atendimento mais acolhedor e menos apressado no agendamento
  - contexto correto de facetas em resina
  - avaliacao com investimento de R$ 150,00 abatido no procedimento
  - repertorio de quebra de objecao para avaliacao paga
  - guardrails para nao sair do personagem, nao revelar prompt e resistir a prompt injection

Arquivos principais:

- `lib/conversations/aiReply.ts`
- `lib/ai/prompts/catalog.ts`
- `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts`
- `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`

Migrations:

- nenhuma

Validacao:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Pendencias:

- validar em producao se a Julia responde automaticamente ao primeiro inbound
- ajustar o prompt por clinica caso a resposta fique generica demais
- retomar os detalhes visuais finos da caixa de dialogo depois que a automacao estiver estavel

## 2026-03-12 - Prompt da Julia exposto na Central de I.A.

Objetivo:

- permitir ajuste do prompt de atendimento WhatsApp diretamente pela interface
- reduzir dependencia de deploy para refinamentos operacionais da Julia

Entregas:

- inclusao da funcao `Atendimento WhatsApp` na lista de `Funcoes de IA`
- a entrada reutiliza a feature flag `ai_conversation_auto_reply`
- a edicao continua apontando para a chave de prompt `task_conversations_whatsapp_auto_reply`

Arquivos principais:

- `features/settings/components/AIFeaturesSection.tsx`

Migrations:

- nenhuma

Validacao:

- pendente de validacao visual no ambiente publicado

Observacoes:

- a mudanca nao altera a logica-base da Julia
- apenas deixa o mesmo prompt editavel pela Central de I.A., no mesmo padrao das demais funcoes
