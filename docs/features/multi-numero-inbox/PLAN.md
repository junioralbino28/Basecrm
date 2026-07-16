# Multi-número / Caixa unificada — PLAN (para o Codex)

> Para: Codex. De: Claude. Base: `SPEC.md` (intenção + critério de sucesso) + `MAPA-CODIGO.md` (superfície verificada). Branch: `feat/multi-numero-inbox` (a partir de `main`=`fd84dff`, que já tem E1+E2).
> Regras: TDD (teste antes), commits pequenos por tarefa, **sem push/deploy** até o Junior aprovar, portão `npm run precheck:fast` verde ao fim. Trabalhar SÓ nesta branch. Enquanto você implementa, o Claude fica read-only na pasta.

## Antes de codar — leia nesta ordem
1. `SPEC.md` + `MAPA-CODIGO.md` (esta pasta)
2. `AGENTS.md` do repo + `docs/basecrm-engineering-playbook.md`
3. `lib/channels/evolution.ts`, `app/api/platform/tenants/[tenantId]/channels/route.ts` e `[connectionId]/route.ts`, `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`, `features/platform/tenants/TenantConversationsPage.tsx` e `TenantChannelsPage.tsx`
4. Skill de código: `senku-fullstack` (padrões Next 16/React 19/Supabase) e a skill `evolution-api` (params do `/instance/create` — R8).

## Se discordar do desenho
Se achar caminho melhor em qualquer tarefa (ex.: onde aplicar o gate de IA, formato do seletor), **escreva `OPINIAO-CODEX.md` nesta pasta ANTES de implementar essa parte** e pare pra o Claude bater o martelo. Não reabra o que já está travado no SPEC (2 campos no cadastro; seletor visível pra todos com Conversas; excluir remove a row).

---

## Tarefa 1 — `createEvolutionInstance` na lib

**Arquivo:** `lib/channels/evolution.ts` (add) + teste em `lib/channels/evolution.test.ts` (ou vizinho existente).

- [ ] Teste: `createEvolutionInstance` faz `POST {apiUrl}/instance/create` com body `{ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS', groupsIgnore: true, rejectCall: true, alwaysOnline: true }` e header `apikey`, e devolve `{ raw, qrBase64, pairingCode, instanceName }` extraídos da resposta (o `/instance/create` com `qrcode:true` retorna o QR — procurar `qrcode.base64`/`base64`/`code` no payload, reusar o padrão de `collectPairingCandidates`/`extractPairingDisplay` de `TenantChannelsPage.tsx` se ajudar).
- [ ] Implementar seguindo o padrão das outras funções (`parseEvolutionResponse`, `cache: 'no-store'`).
- [ ] Rodar o teste (red→green).

## Tarefa 2 — Auto-gerar `instanceName` + criar instância no cadastro

**Arquivos:** `app/api/platform/tenants/[tenantId]/channels/route.ts` (POST) + teste vizinho.

- [ ] Teste: POST com body **só** `{ provider, channel_type, name, metadata.phoneNumber }` (sem `instanceName`) → gera um `instanceName` determinístico-único (ex.: slug de `name` + sufixo curto de `crypto.randomUUID()`; só `[a-z0-9-]`, evitar colisão) e persiste em `config.instanceName`. `webhookSecret` continua auto (já é).
- [ ] Decidir e implementar **onde a instância é criada na Evolution**: recomendado = no **connect** (Tarefa 3), pra manter o POST barato e idempotente. Então o POST só persiste a row + instanceName; a criação real na Evolution acontece no "Gerar QR". (Se preferir criar no POST, escreva na OPINIAO.)
- [ ] `default aiEnabled`: ao criar, setar `config.aiEnabled` = `true` por padrão (a UI decide; ver Tarefa 6).
- [ ] precheck verde.

## Tarefa 3 — Connect cria-ou-pareia + seta webhook + retorna QR

**Arquivo:** `app/api/platform/tenants/[tenantId]/channels/[connectionId]/connect/route.ts` + teste.

- [ ] Teste: ao chamar connect, se a instância ainda não existe na Evolution (ou sempre, de forma idempotente), chama `createEvolutionInstance` → depois `setEvolutionWebhook` com a **URL do webhook do CRM** (derivada de `connectionId` + `config.webhookSecret`, mesmo formato do `getCrmWebhookUrl` em `TenantChannelsPage.tsx`: `${origin}/api/public/channels/evolution/${id}/webhook?secret=...`) → devolve `{ qrBase64, pairingCode }`.
- [ ] Tratar o caso "instância já existe" (Evolution retorna erro de duplicado) → cair no fluxo de parear (`fetchEvolutionPairingCode`) sem quebrar. Idempotência é o objetivo: "Reparear" chama a mesma rota.
- [ ] Persistir o QR/pairing no `metadata` (como já é feito) pra a UI exibir.
- [ ] precheck verde.

## Tarefa 4 — Rota DELETE (excluir número)

**Arquivo:** `app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts` (add `DELETE`) + teste.

- [ ] Teste: `DELETE` com permissão `whatsapp.manage_connection` → tenta `logoutEvolutionInstance` (best-effort; se falhar, loga e segue) → remove a row de `channel_connections` (`.delete().eq('id', connectionId).eq('organization_id', tenantId)`) → 200. As `conversation_threads` daquele número ficam com `channel_connection_id = null` (FK já é ON DELETE SET NULL — as conversas NÃO somem, só perdem o vínculo de número).
- [ ] `isAllowedOrigin` + `requireTenantAccess(... ['whatsapp.manage_connection'])` iguais ao PATCH.
- [ ] precheck verde.

## Tarefa 5 — Cadastro simplificado na UI (2 campos) + lista + excluir

**Arquivo:** `features/platform/tenants/TenantChannelsPage.tsx` (+ teste de componente se houver padrão; senão, teste manual documentado).

- [ ] Modal de criação em **modo simples**: só **Número** + **Nome de identificação** + botão **Gerar QR**. Ao submeter: POST (Tarefa 2) → connect (Tarefa 3) → exibir o QR retornado no próprio modal. Os campos técnicos (apiUrl/token/instanceName/sendMode) vão pra um `<details>`/"Avançado" recolhido (mantém pra agency power-user) ou somem no modo simples.
- [ ] A **lista de números** (cards) no modo simples mostra: **nome de identificação**, **telefone**, **status** (badge) e 3 ações: **Editar** (renomeia — PATCH `name`), **Reparear** (chama connect → novo QR), **Excluir** (chama DELETE, com confirmação). Esconder os campos técnicos do card quando não for agency-admin (já há `canManageInfrastructure`).
- [ ] Não quebrar o fluxo avançado atual (agency). precheck verde.

## Tarefa 6 — Flag "IA liga/desliga" por número

**Arquivos:** `TenantChannelsPage.tsx` (toggle no card/modal), `lib/channels/publicChannel.ts` (expor `aiEnabled`), webhook + routing.

- [ ] `config.aiEnabled` (boolean, default `true`) — sem migration (jsonb). Expor em `toPublicChannelConnection`. Toggle na UI do número ("IA responde automático").
- [ ] Teste (gate de IA): no webhook `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`, quando a conexão tem `config.aiEnabled === false`:
  - a thread nova daquele número **nasce `human_queue`** (não `ai_active`) — ajustar na criação da thread e/ou em `getConversationStatusAfterInbound` (`lib/conversations/routing.ts`) passando o `aiEnabled` da conexão;
  - a IA nativa **não dispara** (o gate `latestThreadStatus !== 'ai_active'` da L186 já cobre isso uma vez que a thread não é ai_active; adicionar também um curto-circuito explícito `if (connectionConfig.aiEnabled === false) return;` antes do `generateConversationAutoReply` como cinto-e-suspensório).
- [ ] Teste: conexão com `aiEnabled !== false` (default) continua respondendo automático (sem regressão do comportamento atual da Julia).
- [ ] precheck verde.

## Tarefa 7 — Seletor de número + filtro + selo na tela de Conversas

**Arquivo:** `features/platform/tenants/TenantConversationsPage.tsx` + teste.

- [ ] **Seletor** no topo da lista (dropdown ou abas): "Todos os números" + um item por conexão (usar `tenant.channel_connections`, rótulo = `connection.name`). Estado novo tipo `selectedConnectionId: string | 'all'` (pode reusar/renomear o `activeConnectionId` já existente na L273, mas cuidado: hoje ele é usado pra ação de parear — separar as responsabilidades se necessário).
- [ ] **Filtro:** em `filteredThreads` (L568), adicionar: `if (selectedConnectionId !== 'all' && thread.channel_connection_id !== selectedConnectionId) return false;`. Garantir que o objeto `thread` carregue `channel_connection_id` (verificar o fetch/tipo em `useTenantDetail`/conversas; se não vier, incluir no select).
- [ ] **Selo de origem** em cada item da lista de conversa: um chip pequeno com o nome de identificação do número (mapear `thread.channel_connection_id` → `channel_connections[].name`). Mostrar principalmente na visão "Todos".
- [ ] Visível pra **todo usuário com `conversations.access`** (não gatear por agency-admin). Default = "Todos os números".
- [ ] precheck verde.

## Tarefa 8 — Fechamento

- [ ] Escrever `IMPL-LOG.md` nesta pasta (o que fez, decisões, arquivos, commits).
- [ ] `npm run precheck:fast` verde (lint 0 / typecheck 0 / testes).
- [ ] Se der pra testar o gate de IA e o filtro contra o Supabase local (`supabase start`), melhor; senão, cobrir por unit/mocks.
- [ ] **NÃO** fazer push/deploy — avisar o Junior/Claude pra revisão (`REVIEW.md` do Claude) antes de qualquer merge.

## Notas de risco
- **Não** mexer no schema por causa do `aiEnabled` (é jsonb).
- **Não** apagar conversas ao excluir número (FK SET NULL preserva; conferir que a UI de Conversas aguenta `channel_connection_id = null` → mapear pra "sem número"/"número removido").
- Cuidado com a idempotência do connect (criar instância 2x na Evolution → tratar o erro de duplicado).
- Manter o número TEMP da agência funcionando (não regredir o fluxo avançado existente).
- Segredo do webhook e token **nunca** vão pro client — continuar redigindo via `toPublicChannelConnection`.
