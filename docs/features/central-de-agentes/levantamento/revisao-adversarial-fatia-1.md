# Revisão adversarial — SPEC Central de Agentes, fase 1

Base: worktree `feat/central-agentes`, código de produção `335f32b`. Só leitura: sem teste rodado e sem consulta ao banco.
Os caminhos são relativos à raiz do worktree. `webhook` = `app/api/public/channels/evolution/[connectionId]/webhook/route.ts`.

Placar: **1 BLOQUEANTE, 11 IMPORTANTES, 14 MENORES.**

---

## BLOQUEANTE

### B1. A `--prova` pode registrar uma linha de base errada sem avisar, e o `--ligar` confirmaria o erro

**O que a SPEC diz:** "calcula o conteúdo efetivo de hoje (o mesmo que `getResolvedPrompt` devolve) e o sha256". O `--ligar` "refaz a prova e só liga se o sha256 bater".

**O problema:** a prova e a nova prova usam o mesmo cálculo. Se ele errar, os dois erram igual, o hash bate e a checagem passa. Há três formas concretas de ele errar em silêncio.

1. **Confirmado: erro de banco vira catálogo.** `getResolvedPrompt` engole o erro de leitura de `ai_prompt_templates` e devolve o texto do catálogo (`lib/ai/prompts/server.ts:46-48` e `:62-68`). Imagine uma organização com override ativo. Um erro passageiro durante a `--prova`/`--criar` gravaria a v1 com o texto do catálogo. A nova prova do `--ligar` só dá o mesmo erro se a falha se repetir. Se ela der o mesmo erro, o hash bate e o número passa a responder com outro prompt.
2. **Confirmado: o script roda o `catalog.ts` da cópia local, não o que está em produção.** O conteúdo "de hoje" vem de `getPromptCatalogMap()` (`server.ts:35-36`), ou seja, do `lib/ai/prompts/catalog.ts` da cópia onde o script roda. O que responde de verdade é o `catalog.ts` do commit publicado. O texto da Aurora muda quase todo dia: `catalog.aurora.test.ts` tem blocos de 20/09, 21/09, 23/09, 27/09 e 29/09. Se o script rodar de uma cópia diferente do commit publicado, a v1 e a nova prova saem idênticas entre si e diferentes do que o lead recebe hoje.
3. **Confirmado: o import quebra.** `lib/ai/prompts/server.ts:1` importa `server-only`. O `index.js` desse pacote lança erro fora da condição `react-server`: conferido em `Basecrm/node_modules/server-only/index.js` e no `package.json` dele, cujo `exports` só aponta `react-server → empty.js`. Um `tsx scripts/...` que importe `getResolvedPrompt` quebra, a menos que rode com `--conditions=react-server`. **Inferência:** a saída natural é reimplementar a resolução dentro do script, e aí ela passa a divergir de `getResolvedPrompt`, o oposto do "o mesmo que devolve".

**Correção proposta:**
- a) A prova usa uma leitura estrita própria: erro de banco aborta o script, nunca cai no catálogo.
- b) O script grava em `origin` o sha do commit de onde leu o catálogo. O `--criar` e o `--ligar` recusam rodar se `git rev-parse HEAD` for diferente do sha do deploy de produção (lido da Vercel) ou se houver diff em `lib/ai/prompts/catalog.ts`.
- c) Rodar com `node --conditions=react-server` (via tsx) e importar o `getResolvedPrompt` de verdade, com a leitura estrita do item (a) ao lado, em vez de copiar a lógica.
- d) Para ter uma prova de verdade independente: depois do `--ligar`, comparar o **sha do prompt renderizado** gravado na primeira resposta real (ver I9) com o sha que o caminho antigo daria para a mesma conversa.

---

## IMPORTANTES

### I1. Num número ligado, `aiPromptKey` continua valendo: pode derrubar a IA e continua editável sem efeito

**O que a SPEC diz:** "Se houver agente [...] O conteúdo do prompt vem de `version.prompt`". A recusa de campos no PATCH fica só para a fatia 4 e só para o "primeiro grupo" de ajustes.

**Evidência (confirmado):**
- O webhook testa a chave ANTES de chamar o gerador: `promptKey ? await generateConversationAutoReply(...) : { ok:false, reason:'missing_prompt' }` (`webhook:227-239`). Se a chave for inválida, `resolveConversationAIAgentConfig` devolve `null` (`lib/conversations/aiAgentConfig.ts:23-27`). Uma chave inválida gravada no `config` derruba um número ligado, mesmo com um agente válido.
- O PATCH continua aceitando `aiPromptKey` (`app/api/platform/tenants/[tenantId]/channels/[connectionId]/route.ts:36`, merge em `:125`). Num número ligado, trocar a chave não muda nada até alguém desligar o agente. É exatamente a "mudança sem efeito" que a própria SPEC condena na linha 57.
- `aiPromptKey` não está em nenhum dos dois grupos da tabela de decisões (linha 55).

**Correção:**
- Com agente ligado, o webhook ignora `promptKey` (ou só o calcula quando `ai_agent_id` é nulo).
- Já na fatia 1, o PATCH recusa `aiPromptKey` num número ligado (409).
- Documentar que `aiPromptKey` é o que o `--desligar` restaura.

### I2. `on delete set null (ai_agent_id)` contradiz a regra "nunca responder em silêncio com outro prompt"

**O que a SPEC diz:** a linha 54 defende "Nunca responder em silêncio com outro prompt" (por isso `agent_unavailable`). A linha 86 põe `on delete set null (ai_agent_id)`.

**Efeito (confirmado pela semântica da FK; o caminho de exclusão é inferência):** apagar um agente zera `ai_agent_id` nos números e eles voltam **sem aviso** ao prompt de `config.aiPromptKey`/catálogo. Esse texto pode estar congelado há meses, ou ser o prompt da clínica da Dra. Jéssica, que é o padrão do sistema (`catalog.ts:131-135`). Isso seria a Aurora respondendo como a assistente da clínica.

**Correção:**
- `on delete restrict` na FK de `channel_connections`: não se apaga agente com número ligado; desliga primeiro.
- Na fase 1 não haver exclusão de agente; se houver, "arquivar".
- Isso também tira a dependência de PG15 do ponto 3 dos "Pontos para o Codex".

### I3. `published_version_id` com FK simples pode apontar para a versão de OUTRO agente

**O que a SPEC diz:** "`published_version_id uuid null -- fk para ai_agent_versions(id), deferrable`".

**Problema (confirmado pelo DDL da SPEC):** uma FK para `(id)` aceita qualquer versão de qualquer agente e de qualquer organização. O runtime da SPEC só confere "agente e versão da mesma organização" (linha 96). Uma versão de outro agente do mesmo cliente passaria. Se a leitura for pelo id e a checagem de organização esquecida, passaria também de outro cliente (G4).

**Correção:**
- `unique (agent_id, id)` em `ai_agent_versions`.
- FK composta `(id, published_version_id) references ai_agent_versions (agent_id, id) deferrable initially deferred`.
- A criação precisa de `ALTER TABLE` depois das duas tabelas, porque as FKs são circulares.

### I4. As FKs para `profiles` sem `on delete` travam a exclusão de usuário

**O que a SPEC diz:** `draft_updated_by uuid fk profiles`, `created_by uuid fk profiles`, `published_by uuid fk profiles`, sem ação de exclusão.

**Evidência (confirmado):**
- `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` (`supabase/migrations/20251201000000_schema_init.sql:74`).
- A remoção de usuário chama `admin.auth.admin.deleteUser(id)` (`app/api/admin/users/[id]/route.ts:108`) e depois `profiles.delete()` (`:111`).
- Com a FK padrão (`NO ACTION`), apagar alguém que já publicou uma versão ou salvou um rascunho falha.
- A tabela irmã `ai_prompt_templates` usa `ON DELETE SET NULL` (mapa A, `schema_init.sql:553-563`).

**Correção:** `on delete set null` nas três colunas. A versão continua existindo como registro; o autor vira nulo, ou guardar também um `published_by_label` em texto.

### I5. Função `security definer` que confere o papel por dentro não funciona se a rota chamar com a chave de serviço

**O que a SPEC diz:** "escrita só pelas funções `security definer` [...] A função confere o papel por dentro". O levantamento lembra que as rotas da plataforma usam `createStaticAdminClient()` (chave de serviço).

**Problema (inferência forte, com base no código):**
- `is_agency_admin_role()` lê `auth.uid()` através de `current_profile_role()` (`supabase/migrations/20260311010000_multi_tenant_policy_helpers.sql`, função `current_profile_role`).
- Chamada com a chave de serviço, `auth.uid()` é nulo. Aí das duas uma:
  - a função recusa sempre;
  - ou alguém põe um "atalho para service_role", e aí a checagem de papel e o `published_by` deixam de valer.
- O padrão do repositório para RPC com checagem de papel é chamar com o JWT do usuário: `lib/supabase/reports.ts:239` chama `get_commission_report` pelo cliente do usuário.

**Correção:**
- Escrever na SPEC que as rotas de publicar, restaurar e salvar rascunho chamam a RPC com `createClient()` (JWT do usuário).
- `published_by`/`draft_updated_by` vêm de `auth.uid()` dentro da função, nunca de parâmetro (G19).
- A função recebe `p_organization_id` e confere `agent.organization_id = p_organization_id` (G4).
- Seguir a convenção do repositório: `revoke all on function ... from public, anon` antes do `grant execute ... to authenticated`. O Postgres dá EXECUTE a PUBLIC por padrão; o repositório revoga em toda função sensível (ex.: `supabase/migrations/20260913040000_funil_live_envio_real.sql:196`, `20260904000000_v01_fechar_rpcs_publicas.sql:91-93`).
- Nas tabelas, revogar também insert, update, delete e truncate de `anon, authenticated`, como em `20260913010000_conversao_marcos_por_negocio.sql:107`. "Sem policy" não é "sem grant": o Supabase dá privilégio padrão às tabelas novas.

### I6. O gerador não é livre de efeito colateral, e o portão fica DENTRO dele (fatia 3)

**O que a SPEC diz:** `generateAgentReplyPreview` "reaproveita o gerador com o rascunho e sem o portão de envio: nada é enviado, então o agente pode estar pausado". E "Sem efeito colateral nenhum", provado contando linhas antes e depois.

**Evidência (confirmado):**
- **O portão está no gerador, não só no envio:**
  - `generateConversationAutoReply` chama `loadFreshConversationAIGate` (`lib/conversations/aiReply.ts:399-406`), que exige `config.aiEnabled`, `ai_feature_flags.ai_conversation_auto_reply` e `organization_settings.ai_enabled` (`lib/conversations/conversationAIGate.ts:34-65`);
  - e confere `ai_enabled` de novo em `aiReply.ts:417-419`.
  - Com o agente, o número ou o cliente pausado, o gerador devolve `connection_ai_disabled`, `feature_disabled` ou `ai_disabled`. O preview "com agente pausado funciona" (critério da fatia 3) só é possível extraindo o núcleo do gerador. Isso mexe no caminho de produção e cai no ponto 6 dos "Pontos para o Codex".
- **Grava no banco:**
  - o gerador chama `loadAvailableMeetingSlots` → `loadGoogleBusyIntervals` (`aiReply.ts:322-328`);
  - quando o Google falha, `lib/googleCalendar/freeBusy.ts:155-162` chama `markGoogleCalendarConnectionIssue`, que pode gravar `status: 'reconnect_required'` na conexão da agenda;
  - e faz `upsert` em `system_notifications` (`freeBusy.ts:57-67`).
  - O teste "nenhuma linha nova" pode falhar, e um teste de prompt pode marcar a agenda real do cliente como "reconectar".
- O gerador também chama `getResolvedPrompt` (`aiReply.ts:447`). O rascunho precisa entrar como conteúdo, não como chave.

**Correção:**
- Extrair um `buildConversationReplyCore({ promptContent, connectionConfig, orgSettings, ... })` puro no que diz respeito ao banco.
- Nele, a agenda é lida por uma variante de `loadGoogleBusyIntervals` com `recordFailures: false`.
- O webhook continua chamando o gerador de hoje, que envolve o núcleo, e a prova de equivalência cobre o núcleo.
- Na lista de "sem efeito" da SPEC, entram `google_calendar_connections` e `system_notifications`.

### I7. Publicar não amarra a versão ao rascunho que foi testado (fatia 2)

**O que a SPEC diz:** trava otimista em `draft_updated_at` para salvar e "trava otimista pela versão esperada" para publicar.

**Problema (inferência a partir do desenho):**
- A trava de publicar só confere a **versão publicada** esperada.
- Se outra aba salvar um rascunho entre o teste e o clique em Publicar, a função publica o rascunho do banco, que ninguém testou. A trava de versão passa, porque ninguém publicou.
- Além disso, `timestamptz` tem precisão de microssegundo e o `Date` do JS de milissegundo. Se o cliente fizer `new Date(x).toISOString()`, a comparação dá conflito sempre (inferência, depende da implementação).

**Correção:**
- Um `draft_revision int` que incrementa a cada salvamento.
- Publicar recebe `p_expected_version` **e** `p_expected_draft_revision`.
- O teste da fatia 3 devolve a `draft_revision` usada.
- A função trava a linha com `select ... for update` em `ai_agents`.

### I8. Depois do `--ligar`, editar `catalog.ts` não muda mais nada, e a rede de testes da Aurora passa a proteger um texto que não está em produção

**O que a SPEC diz:** "Depois da migração, editar o catálogo não muda Aurora nem Julia. O `describe` [...] passa a dizer isso."

**Problema (confirmado quanto ao que os testes cobrem):**
- `lib/ai/prompts/catalog.aurora.test.ts` testa `PROMPT_CATALOG` direto (mapa A §6).
- Hoje o fluxo de mudança da Aurora é editar `catalog.ts` e publicar (a própria SPEC, linha 20).
- Depois do `--ligar`, uma mudança dessas passa em todos os testes, vai para produção e **não tem efeito nenhum**, sem erro.
- As versões publicadas pela tela não têm teste nenhum.

**Correção:**
- Na mesma entrega do `--ligar`, um teste ou guarda que falhe quando `catalog.ts` mudar o texto de uma chave que tenha agente de origem migrado. Por exemplo, um arquivo `migrated-prompts.lock.json` com o sha da v1 de cada chave: mudou o catálogo, o teste pede decisão explícita.
- Aviso no topo das chaves `task_conversations_whatsapp_cenno_aurora` e `_auto_reply`.
- Considerar a verificação ao vivo (fatia 2) rodando as asserções de texto da Aurora como avisos no editor.

### I9. Onde o agente é lido e de onde vem o rastro: a SPEC aponta a leitura errada

**O que a SPEC diz:** "As leituras da conexão (`loadFreshConversationAIGate`, a carga inicial do webhook) passam a trazer `ai_agent_id`."

**Evidência (confirmado):**
- Há **três** leituras frescas no caminho da resposta:
  - `webhook:137` (depois do debounce);
  - `aiReply.ts:399` (dentro do gerador, de onde sai o `config` usado no prompt, `generationConnectionConfig`);
  - `aiReply.ts:696` (no envio).
- A "carga inicial" (`webhook:762-768`) é ANTERIOR ao debounce, portanto velha, e na fatia 1 não precisa do agente.
- Três decisões dependem do texto do prompt, não só o `render`:
  - `closing_unsupported` (`aiReply.ts:478-480`);
  - `wantsTagContext` (`:484`);
  - o próprio `render` (`:501`).
- O `prompt_source` gravado vem do retorno do gerador (`webhook:292`, `source: resolvedPrompt.source` em `aiReply.ts:619`).

**Risco (inferência):**
- Se o agente for resolvido no webhook e a versão carregada em outra consulta, o metadata pode registrar uma versão diferente da usada.
- Um `undefined` vindo de mocks ou de `select` sem a coluna deve ser tratado como nulo, nunca como "tem agente".

**Correção:**
- Resolver agente e versão numa leitura só, DENTRO do gerador, logo depois de `aiReply.ts:399`.
- O gerador devolve `{ source, agentId, agentVersion }` e usa o mesmo texto nas três decisões.
- Gravar também `prompt_sha256` do texto usado: é isso que torna verificável o "a próxima resposta já saiu com a mudança".
- Com versões imutáveis, publicar durante o debounce é seguro: a resposta sai com a versão lida depois do debounce e o rastro diz qual foi.
- Incluir `agent_unavailable` em `nativeFailureStage = 'configuration'` (`webhook:305-307`).

### I10. A fatia 4 esquece pontos de leitura

**O que a SPEC diz:** a lista de "10 pontos" mais o executor da cutucada.

**Faltam (confirmado por grep):**
- `lib/conversations/aiReply.ts:731`: nova checagem de elegibilidade do encerramento no momento da reivindicação atômica, com `CLOSING_REPLY_MAX`. Se o agente publicar máximo 3, a 3ª resposta é gerada e descartada como `closing_not_eligible`.
- `lib/conversations/closingReply.ts:106`: `buildClosingStageContext` usa `CLOSING_REPLY_MAX - 1` para decidir o texto de "fechamento". O prompt passaria a mentir o limite.
- `lib/conversations/meetingReminder.ts:332`: nome do agente no lembrete de reunião.
- `lib/conversations/aiReply.ts:779`: nome de reserva no envio.
- `lib/conversations/inboundMediaPending.ts:91`: filtro SQL `config->media->>mode = 'understand'`. Com a mídia no agente, esse filtro não enxerga os números ligados.
- `splitReplyIntoParts` (`aiReply.ts:885`) roda em `executeConversationAIReply`, que também atende a rota n8n `app/api/public/channels/evolution/[connectionId]/ai-reply/route.ts:85`. Resolver dividir pelo agente muda também o caminho n8n.

**Correção:** incluir esses pontos na lista e nos testes de caracterização. Para o encerramento, passar `max`/`window` como parâmetro de `resolveClosingReplyEligibility` e `buildClosingStageContext`.

### I11. Fatias 5 e 6: modelo congelado na versão × provedor da organização, e rastro replicado por parte

**Evidência (confirmado):**
- O provedor é da organização (`aiReply.ts:421`). Com `version.model` congelado (fatia 5), trocar o provedor da organização faz todas as versões fixadas mandarem um modelo de outro provedor para `getModel` (`aiReply.ts:440-445`). O resultado é falha em todas as respostas dos números ligados, e ninguém mexeu no agente.
- O metadata da resposta (`ai_timing`, e no futuro tokens e `agent_version`) é copiado para **cada parte** enviada: `outboundRows = replyParts.map(... metadata: { ...deliveryMetadata, reply_part_index, reply_part_total })` (`aiReply.ts:939-952`). Somar tokens, custo ou "respostas (7 dias)" por linha de `conversation_messages` conta até 3 vezes.
- Não há índice em `metadata->>'agent_id'`: a agregação da fatia 6 seria varredura em jsonb (inferência; o EXPLAIN previsto pela SPEC vai mostrar).

**Correção:**
- Guardar provedor e modelo juntos na versão, e a troca de provedor da organização recusar ou avisar quando houver agente fixado em outro provedor. Ou validar na leitura e cair no modelo da organização com aviso.
- Agregar só `reply_part_index = 0`, ou melhor, gravar um registro por resposta numa tabela própria (`ai_reply_events`, com `agent_id`, `version`, tokens e ms), indexada por `(organization_id, agent_id, created_at)`.

---

## MENORES

1. **`prompt_source` já existe e o valor proposto muda o de hoje.**
   - Confirmado: `webhook:292` já grava `prompt_source: nativeReply.source`, com valores `'override' | 'default'` (`lib/ai/prompts/server.ts:9`).
   - A SPEC diz que o metadata "ganha" `prompt_source`, com valores `agent/override/catalog`. Trocar `default` por `catalog`, e acrescentar `agent_id: null` a toda resposta, muda o que números SEM agente gravam. Isso contradiz "o caminho atual não muda em nada" e quebra a série histórica.
   - Correção: manter `'default'`; `agent_id`/`agent_version` só quando houver agente.
2. **A fórmula do modelo usa `??`; o código usa `||`.**
   - Hoje: `orgSettings?.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google` (`aiReply.ts:443`). A SPEC: `version.model ?? organization_settings.ai_model ?? AI_DEFAULT_MODELS[provider]`.
   - Com `ai_model = ''` (possível por edição direta no banco; a rota exige `min(1)`, `app/api/settings/ai/route.ts:32`) ou com provedor desconhecido, o resultado muda.
   - Correção: `version.model || <expressão atual inalterada>`.
3. **A `--prova` tem escopo largo demais.**
   - "Para cada número com IA ligada ou chave de prompt definida" e o `--criar` "a partir do relatório" criariam agentes para TODOS os clientes. Inclui os que rodam o prompt padrão (da clínica) por falta de chave: isso é inferência, o banco não foi consultado.
   - Um número com chave inválida hoje não responde (`missing_prompt`). Se virar agente, passa a responder.
   - Correção: `--org <id>` obrigatório no `--criar`; pular número com `promptKey = null`; `--criar` idempotente (não cria duplicado se já existir agente com o mesmo `origin.sha256` na organização).
4. **O fallback n8n responde com outro prompt.**
   - Confirmado: qualquer falha nativa com `config.webhookUrl` definido vai para o n8n (`webhook:359-405`). `agent_unavailable` faria o lead ser atendido pela automação externa, justamente o "outro prompt" que a linha 54 quer evitar.
   - Já é assim com `missing_prompt`. Decidir e escrever.
5. **O rastro pode ser forjado pela rota n8n.**
   - Confirmado: `ai-reply/route.ts:27-31` aceita um `metadata` livre (até 20 chaves), e `mergeConversationDeliveryMetadata` (`lib/conversations/conversationDeliveryMetadata.ts`) só sobrescreve as chaves do sistema.
   - `agent_id`, `agent_version`, `prompt_source`, `ai_timing` e `native_ai` não estão entre elas: quem tem o segredo do webhook consegue gravá-los. Isso afeta G24 e a agregação da fatia 6.
   - Correção: pôr o rastro em `systemMetadata`, ou tirar essas chaves do metadata externo.
6. **A imutabilidade das versões é só convenção.** A `service_role` (script, rotas) pode dar UPDATE ou DELETE. Correção: trigger `before update or delete on ai_agent_versions` que recusa, no padrão do `trg_protect_historical_commission_rule` já usado no projeto.
7. **"Ligar exige versão publicada" não está no banco.** Só o script confere. Correção: trigger em `channel_connections` que recusa `ai_agent_id` apontando agente com `published_version_id` nulo, ou função `link_ai_agent` como único caminho de escrita.
8. **Embed do PostgREST ambíguo.** Com FKs nos dois sentidos entre `ai_agents` e `ai_agent_versions`, o embed `ai_agents(..., ai_agent_versions(...))` dá erro de relação ambígua (inferência pelo comportamento conhecido do PostgREST). Correção: usar o hint `!<nome_da_fk>` ou duas consultas (a versão por id é imutável).
9. **A versão do Postgres de produção não foi verificada.** `supabase/config.toml:26` diz `major_version = 15` (local). A sintaxe `set null (coluna)` é do PG15. Produção: rodar `select version()` antes. Se I2 for aceito (`restrict`), a dependência some.
10. **O item 6 dos "Achados fora do escopo" está errado.** A SPEC diz que "A policy de `channel_connections` é de 10/03 e usa o papel legado". Confirmado: as duas policies foram **removidas** em `supabase/migrations/20260630000000_m6_security_hardening.sql:169-170`. A tabela está fechada para `authenticated` (negada para todos, só a service_role acessa). O mapa B também erra nisso.
11. **Contradição de escopo na fatia 1.** O resumo diz fatia 1 "sem tela"; a tabela de decisões (linha 57) põe na fatia 1 a troca do editor da Central de I.A por um aviso; e o critério de aceite correspondente está na fatia 2 (linha 229). Definir em qual fatia fica.
12. **`whatsapp.manage_connection` pode ser concedida por override individual.** Confirmado: `resolvePermissionMap` deixa o override vencer o padrão do papel (`lib/auth/permissions.ts:229-238`), então "só da agência desde 26/09" vale para o padrão, não para todos. As rotas de agente devem usar `requireTenantAccess(tenantId, { adminOnly: true })` (`lib/platform/tenantAccess.ts:54`), baseado em papel, e não uma permissão.
13. **G19 "ignoram campo fora da lista".** O repositório usa `.strict()`, que recusa com 400 (ex.: `ai-reply/route.ts:32`). Ignorar em silêncio contradiz a própria regra "mudança recusada > mudança sem efeito". O `settings jsonb` recebido pela função SQL também precisa de validação de chaves, senão a fatia 4 lê lixo.
14. **O teste de equivalência precisa congelar o relógio.** `currentDateTime = new Date().toISOString()` (`aiReply.ts:456`) entra no prompt pela Aurora (`{{currentDateTime}}`, `{{currentDateTimeLocal}}`). Sem `vi.useFakeTimers`, a comparação "strings idênticas" é instável.

---

## Verificado e correto

- `is_agency_admin_role()` existe, com definição única, em `supabase/migrations/20260311013000_core_multi_tenant_rls.sql:34-42`: `current_profile_app_role() in ('agency_admin','admin')`, `security definer`. Exclui `agency_staff`, coerente com "só agency_admin".
- `on delete set null (ai_agent_id)` com lista de coluna é a sintaxe certa para FK composta: sem a lista, o PG tentaria anular `organization_id` também (inferência pela semântica do PG15).
- `channel_connections` não tem GRANT/REVOKE por coluna em nenhuma migration, então a coluna nova não cai na armadilha de "coluna nasce sem grant".
- Não há cache de prompt: `getResolvedPrompt` consulta a cada chamada (`lib/ai/prompts/server.ts:38-44`), e o gerador relê conexão e configuração (`aiReply.ts:399-413`).
- Julia: `defaultTemplate` de `task_conversations_whatsapp_auto_reply` usa exatamente 4 variáveis (`organizationName`, `contactName`, `contactPhone`, `recentMessagesText`), cita `replyText` e não tem `{{conversationStageContext}}`. A Aurora usa as 12. O catálogo não tem interpolação `${}` de código.
- O encerramento exige `{{conversationStageContext}}`: `aiReply.ts:476-480`.
- As 12 variáveis estão em `aiReply.ts:501-515`, e `renderPromptTemplate` troca a ausente por `''` (`lib/ai/prompts/render.ts:17-23`).
- As constantes batem com o código: debounce `7000/2000` (`webhook:1425`), `.limit(12)` (`webhook:193-200`), divisão em 240/3 (`aiReply.ts:207-252`), `CLOSING_REPLY_MAX = 2`/`WINDOW = 60` (`closingReply.ts:14-15`), mídia `webhook:817` e `:186`, celular `webhook:944`, cutucada `webhook:440` e `idleNudgeRunner.ts:156`.
- O `usage` do `generateText` não é lido: só `.output` (`aiReply.ts:553`, `:569`).
- A trava por campo "cliente pausa, não configura" existe em `app/api/settings/ai/route.ts:105-117`.
- `whatsapp.manage_connection` está negada por padrão ao `clinic_admin` (`lib/auth/permissions.ts:187-191`) e ao `agency_staff` (`:194-199`).
- `aiIdleNudge`, `aiAgentName`, `meetingHostName`, `meetingChannelText` e `aiPromptKey` não aparecem em `features/` nem em `components/`: têm rota e não têm tela.
- As policies de `ai_prompt_templates` (papel legado `'admin'`) não foram reescritas por nenhuma migration posterior: nenhuma outra migration cita a tabela. O `POST /api/settings/ai-prompts` usa o cliente do usuário (`createClient`) e dois comandos separados (UPDATE e INSERT sem transação), como a SPEC diz.
- A Central de I.A lista só a chave padrão para o WhatsApp (`features/settings/components/AIFeaturesSection.tsx:56-61`).

## Não verificado

- A versão do Postgres de produção, quais conexões têm `aiPromptKey`/override hoje, se existe override ativo para a Aurora e a Julia, e se algum número tem `config.webhookUrl` (fallback n8n). Tudo isso depende de consulta ao banco, fora do escopo.
- `AIConfigSection.tsx:141` e `GET /api/settings/ai` (achados 1 e 2 da SPEC): não abri esses trechos.
- Se `getGoogleCalendarAccessToken`/`readGoogleCalendarRefreshToken` gravam no banco ao renovar o token. O trecho lido (`lib/googleCalendar/oauth.ts:127-160`) usa só cache em memória, mas não segui `readGoogleCalendarRefreshToken` até o fim.
- Se os mocks dos testes atuais conferem a string exata do `select` do gate. Se conferirem, acrescentar `ai_agent_id` exige ajustar os mocks, e isso afeta o critério "suíte verde sem mudar saída".
