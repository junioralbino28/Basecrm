# SPEC — Central de Agentes, fase 1: o editor do agente

> Status: **APROVADA pelo Junior (fase, critério e as 2 decisões, 29/09)**. Revisão adversarial interna integrada em 29/09 (`levantamento/revisao-adversarial-fatia-1.md`). Revisão técnica do Codex integrada em 29/09: 1ª rodada com 21 itens e 2ª devolutiva com 8 achados (seções no fim; a 2ª reabriu os achados 10, 13 e 15 e o estado final é o dela); 3ª devolutiva em 05/10, com 9 achados novos (ela reabriu o achado 2 da 2ª); 4ª devolutiva em 05/10, com 4 achados novos e os achados 1 e 3 da 3ª ainda parciais (última seção). Implementação começa pela fatia 1, em branch, sem tocar produção sem OK.
> Data: 29/09/2026. Base de leitura: worktree `feat/central-agentes`, HEAD `335f32b` (= produção).
> Levantamentos com arquivo e linha: `levantamento/mapa-A-prompt.md`, `mapa-B-comportamento.md`, `mapa-C-modelo-telas.md`.
> Análise da SquadOS que originou a proposta: https://claude.ai/artifact/DsFmx2E4sEfzWgtiGsNYrd (cópia no cérebro, `06-References/central-de-agentes-2026-09-29/`).
> Depois da aprovação, cada fatia ganha um `PLAN-fatia-N.md` técnico próprio.

## Para o Junior, em uma página

- **O agente vira um cadastro do cliente**, com nome, prompt, ajustes e modelo, ligado aos números de WhatsApp. Um número sem agente continua funcionando exatamente como hoje.
- **Aurora e Julia passam para o cadastro sem mudar uma vírgula.** A partir desta entrega, cada resposta real registra a impressão digital do prompt que usou. Antes de ligar cada uma, um script compara o prompt do cadastro com a impressão digital que a produção registrou ao responder por aquele número; se não bater, não liga. Nesta primeira entrega, ligar um número de verdade só acontece no ambiente de teste. Desligar o cadastro volta tudo ao que era, com um clique.
- **Rascunho e publicado ficam separados.** Você edita, testa numa conversa simulada que não manda nada no WhatsApp e publica. A próxima resposta real já sai com a versão nova, e cada resposta registra qual versão respondeu.
- **Toda publicação vira uma versão** com autor e data; comparar e voltar uma versão é um clique.
- **Seis entregas, nesta ordem:** (1) o cadastro e a migração da Aurora e da Julia, sem tela; (2) o editor com versões e Publicar; (3) o teste sem enviar. Com as três, o critério de pronto que você aprovou está cumprido. Depois: (4) os ajustes escondidos na tela, escritos como frase; (5) o modelo por agente com tempo e custo de cada resposta; (6) a tela da agência com todos os agentes.
- **Suas duas decisões (29/09):** a pausa do lado do cliente continua só para o cliente inteiro, e o teste ganha o botão "Explicar esta resposta".

## Problema e resultado esperado

Para mudar a abertura da Aurora foi preciso editar `lib/ai/prompts/catalog.ts` e publicar o sistema inteiro. O prompt da Aurora não aparece em tela nenhuma: a Central de I.A só lista a chave padrão (`features/settings/components/AIFeaturesSection.tsx:56-61`). Dos ajustes de comportamento, quatro são constantes no código, três só mudam direto no banco e a cutucada tem rota mas não tem tela (mapa B).

Critério de pronto aprovado pelo Junior em 29/09:

> Você abre a Central de Agentes, entra na Aurora, muda a abertura, testa numa conversa simulada sem mandar nada no WhatsApp e publica. A próxima resposta real já sai com a mudança, sem publicar código. Se não gostar, volta a versão anterior com um clique. Até alguém mexer, Aurora e Julia respondem exatamente como hoje.

## Decisões do Junior que esta SPEC não reabre

1. Fase 1 e critério de pronto aprovados (29/09). A fase 2 começa pela biblioteca de modelos.
2. Nada de ramo por cliente (25/09): toda capacidade é campo que todo cliente ganha, com o comportamento de hoje como padrão.
3. O controle da IA mora no painel da agência; o cliente só pausa (30/07, emenda 2; 17/09, C2B).
4. A Central nasce dentro do painel da agência (30/07).
5. Contrato do plug (30/07): o agente muda por cliente; as portas (receber, responder, agendar, etiquetar, ser pausado, entregar resumo) não mudam. O agente é do cliente, não do número.
6. A SquadOS fica como referência; nada lá é excluído (29/09).

## Como funciona hoje (resumo dos levantamentos)

- **Prompt.** A conexão guarda `config.aiPromptKey` (padrão `task_conversations_whatsapp_auto_reply`, cujo texto é o da clínica da Dra. Jéssica). `getResolvedPrompt` (`lib/ai/prompts/server.ts:30-69`) usa a linha ativa de `ai_prompt_templates` da organização, se houver, e senão o texto do catálogo. `renderPromptTemplate` troca 12 variáveis montadas em `lib/conversations/aiReply.ts:501-515`. O texto inteiro vai como `prompt` único para `generateText` com `Output.object` (`aiReply.ts:519-530`). Não há cache: toda resposta relê prompt e configuração.
- **Versões que já existem.** `ai_prompt_templates` guarda versão e `is_active` por organização e chave. O "publicar" atual (`app/api/settings/ai-prompts/route.ts:43-97`) faz um UPDATE e um INSERT separados, sem transação, e a tela só edita a chave padrão.
- **Ajustes.** Agrupar (7 s, ou 2 s vindo de anúncio: `webhook/route.ts:1425`), dividir (até 3 partes de 240 caracteres, `aiReply.ts:207-252`), memória (12 mensagens, `webhook/route.ts:193-200`) e encerramento (2 respostas em 60 min, `closingReply.ts:14-15`) são constantes. `media.mode`, `manualReplyPausesAI` e `automationSendSpacing` estão no `config` da conexão, sem rota de escrita. `aiIdleNudge`, `aiAgentName`, `meetingHostName` e `meetingChannelText` têm rota (`PATCH /api/platform/tenants/[tenantId]/channels/[connectionId]`, merge campo a campo) e não têm tela.
- **Liga e desliga, em três camadas:** `config.aiEnabled` da conexão, `organization_settings.ai_enabled` e a linha `ai_conversation_auto_reply` de `ai_feature_flags`. As três precisam ser `true` (`lib/conversations/conversationAIGate.ts`).
- **Modelo.** Provedor, modelo e chave são por organização (`organization_settings`). As chaves ficam em texto puro, protegidas por GRANT de coluna. O `usage` (tokens) do `generateText` não é lido, e não existe tabela de preço.
- **Permissão.** A rota da conexão exige `whatsapp.manage_connection`, que desde 26/09 é só da agência. A trava "o cliente pausa, não configura" existe só no liga/desliga da organização (`app/api/settings/ai/route.ts:105-117`).

## Decisões de desenho

| Questão | Decisão | Motivo |
|---|---|---|
| Onde mora o agente | Tabelas novas `ai_agents` e `ai_agent_versions` | O agente é do cliente (contrato do plug) e a versão precisa congelar prompt, ajustes e modelo juntos, para "voltar com um clique" ser verdade. |
| Reaproveitar `ai_prompt_templates` | Não, para o agente. Ela continua servindo as outras IAs (copiloto, CRM Pilot) | Versiona só texto por chave, sem rascunho, e o publicar atual não é atômico. |
| Ligar número a agente | Coluna `channel_connections.ai_agent_id`, nula por padrão, com FK composta `(organization_id, ai_agent_id)` → `ai_agents(organization_id, id)` **`on delete no action`**: agente com número ligado não se apaga; desliga-se antes | Nula = caminho de hoje, byte a byte. A FK composta impede ligar o número de um cliente ao agente de outro. Com `set null`, apagar o agente devolveria o número em silêncio ao prompt antigo, que no caso padrão é o da clínica (revisão adversarial, I2). `no action` é o mesmo padrão das FKs compostas do funil que apontam para `channel_connections` (`20260718010000_funil_f2_publication.sql:103`): a checagem roda depois das cascatas do mesmo comando, então apagar a organização inteira continua funcionando. O teste local prova. |
| O que a migração muda na conexão | Só `ai_agent_id`. O `config` da conexão não é tocado; o `aiPromptKey` que ficou lá é o que `--desligar` devolve | Desligar (`ai_agent_id = null`) volta ao comportamento anterior sem restaurar nada. |
| Rascunho | `ai_agents.draft` (jsonb: `prompt`, `settings`, `model`) com `draft_revision` (inteiro que sobe a cada salvamento), `draft_updated_at` e `draft_updated_by` | Editar e testar sem tocar o atendimento real. |
| Publicar e Restaurar | Função SQL única `publish_ai_agent_version` (`security definer`, `search_path=''`), chamada **com o JWT do usuário** (`createClient`), nunca com a chave de serviço. Ela confere o papel por dentro, trava a linha (`select ... for update`) e só publica se a versão publicada **e** a `draft_revision` forem as esperadas; conflito vira 409. O autor vem de `auth.uid()`, nunca de parâmetro. Restaurar = publicar o conteúdo da versão escolhida como versão nova | Histórico linear e auditável, sem a corrida do publicar atual. Amarrar a `draft_revision` garante que o que foi publicado é o que foi testado (I5, I7). |
| Agente ligado sem versão publicada | Ligar exige versão publicada, e um gatilho no banco garante isso. Se mesmo assim faltar em tempo de execução, a resposta falha com motivo `agent_unavailable`, que segue o mesmo caminho de `missing_prompt`: vai para a automação n8n do cliente, se houver uma configurada | Nunca responder em silêncio com outro prompt nosso. A automação n8n é o reserva que o próprio cliente configurou. |
| Versões imutáveis | Gatilho recusa `update` em `ai_agent_versions`, exceto zerar o autor quando o usuário que publicou é apagado. Os papéis comuns não escrevem nem apagam versão (GRANT) | A versão não muda depois de gravada, sem travar a exclusão de usuário. Não é histórico inviolável: a chave de serviço ainda apaga uma versão antiga não publicada, e nenhum código faz isso (revisão do Codex, achado 16). |
| Prova da migração | Toda resposta nativa passa a gravar `prompt_sha256` no metadata (sha256 do texto do prompt usado, antes de trocar as variáveis) e, **depois de entregue**, um **evento de prova** em `ai_reply_events`: sha, chave usada, agente e versão (se houver), commit e deployment da publicação (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`) e hora em que a Evolution aceitou a última parte. Só o caminho nativo escreve a tabela, com a chave de serviço; a prova lê só ela. O script só cria o agente e liga o número quando o sha que ele calcula bate com o do último evento do caminho de hoje daquele número, com a mesma chave, a mesma origem (catálogo ou override) e a mesma publicação. Erro de leitura do banco aborta o script em vez de cair no catálogo. O evento usado é o último **registrado** do caminho de hoje, não necessariamente o da última resposta entregue (ver "O que a prova afirma") | Sem isso, a prova compara o script com ele mesmo, e um catálogo diferente na cópia local passaria (revisão adversarial, B1). Ler o metadata das mensagens deixava uma mensagem manual (`send_external: false`, gravada como entregue sem mandar nada) forjar a prova com o sha que quisesse (2ª devolutiva, achado 1); e o `sent_at` é fixado antes do envio, então envios simultâneos podiam terminar em ordem inversa (achado 5). |
| Rastro protegido | As rotas do n8n e manual descartam do metadata que recebem as chaves de rastro (`native_ai`, `prompt_source`, `prompt_sha256`, `agent_id`, `agent_version`, `ai_timing`). A prova da migração não lê metadata de mensagem nenhuma | Senão uma automação externa ou alguém com `conversations.reply` forja a leitura humana da conversa e, depois, os números da fatia 6. |
| Publicação no ar | O ambiente sai do banco conectado, numa lista fechada: banco → projeto da Vercel → ramo → **todos** os domínios que atendem aquele banco. O script lê na API da Vercel o deployment de cada domínio (`/v4/aliases/{domínio}` → `/v13/deployments/{id}` → `meta.githubCommitSha`) e a lista de deployments do ramo. Só segue se todos servem o mesmo deployment, do projeto e do ramo certos, com o commit da cópia; se em produção ele é o de produção promovido e no teste **não** é o de produção; e se não há rollout nem deployment mais novo do ramo construindo ou pronto sem ser o servido. Confere antes da prova, antes de ligar, dentro da função do banco (o evento tem que ter vindo desse commit **e desse deployment**) e de novo depois de ligar (o mesmo deployment); depois de ligar, qualquer coisa que impeça confirmar (inclusive erro de rede) desfaz a ligação, só do agente recém-ligado, e o resultado diz o que a linha mostra, inclusive outro agente | `HEAD == origin/<ramo>` diz o que FOI publicado, não o que está no ar: depois de um rollback o ramo continua em A e o domínio responde com B (2ª devolutiva, achado 2). Um domínio informado à mão não estava amarrado ao banco nem ao projeto, e um erro na conferência depois de ligar deixava o número ligado (3ª devolutiva, achados 3 e 4). Um redeploy do mesmo commit pode ter outras variáveis de ambiente, e um número ligado por outra pessoa no meio saía como "desfeito" (4ª devolutiva, achados 10 e 12). |
| Ajustes do agente × do número | Do **agente** (versionados): nome, prompt, modelo, agrupar, dividir, memória, mídia, cutucada, encerramento, quem conduz e formato da reunião, pausar quando alguém responde pelo celular. Do **número** (ficam na conexão): IA ligada no número, assinatura do atendente, espaçamento da régua, agenda, URL, chave e modo de envio da Evolution | O primeiro grupo é como a IA se comporta; o segundo é do aparelho, da régua ou da operação. |
| Leitura dos ajustes do agente | Na fatia 1 o agente assume **só o prompt** (e o modelo, nulo na v1); os ajustes continuam sendo lidos de onde são hoje. Na fatia 4, com o número ligado, cada ajuste segue a ordem: valor publicado no agente → valor da conexão (o de hoje) → constante do código. A v1 nasce com `settings = {}` | Ler os ajustes do agente muda os pontos de leitura listados na fatia 4: o webhook, o gerador, o encerramento, o lembrete de reunião, o varredor de mídia e o executor da cutucada. Se a migração gravasse os valores na fatia 1 e eles só fossem lidos na fatia 4, uma mudança feita no número nesse meio-tempo se perderia na virada. Com a v1 vazia, a virada da fatia 4 não muda nada até alguém publicar um valor. |
| Rotas antigas depois de ligar | Fatia 2 (quando os primeiros números são ligados em produção): a Central de I.A mostra, no editor do WhatsApp, quantos números daquela chave têm agente. Se todos têm, troca o editor por um aviso com link para a Central de Agentes; se só alguns têm, avisa que a edição vale apenas para os números sem agente. Também na fatia 2: o PATCH da conexão recusa `aiPromptKey` num número ligado (409). Fatia 4: o PATCH recusa os demais campos do primeiro grupo num número ligado | Mudança que não tem efeito é pior que mudança recusada. |
| Catálogo no código | Os textos de `catalog.ts` viram "modelo de origem" (base da biblioteca da fase 2) e continuam valendo para números sem agente. Na fatia 2, junto com a primeira ligação em produção, entra `lib/ai/prompts/migrated-prompts.lock.json` com o sha256 de cada chave migrada, e um teste falha quando o texto dessa chave muda no catálogo, pedindo decisão explícita. As duas chaves ganham um aviso no topo | Depois da migração, editar o catálogo não muda Aurora nem Julia. Sem a trava, a mudança passaria nos testes, iria para produção e não teria efeito, sem erro nenhum (I8). |
| Rastro | Toda resposta nativa grava `prompt_sha256` e mantém `prompt_source` como é hoje (`override` ou `default`, e agora `agent`). `agent_id` e `agent_version` entram só em número com agente | Prova que "a próxima resposta já saiu com a mudança". Número sem agente não ganha chave nula (chave nula parece presente em `metadata ? 'x'`); o `prompt_sha256` é chave nova e sempre preenchida. |
| Quem mexe | Só `agency_admin` (e o legado `admin`) cria, edita, testa, publica e liga | Decisões de 30/07 e 17/09. `agency_staff` e o cliente não entram na fase 1. |

## Modelo de dados (fatia 1)

```sql
ai_agents (
  id uuid pk, organization_id uuid not null fk organizations on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  published_version_id uuid null,
  draft jsonb not null default '{}', draft_revision int not null default 0,
  draft_updated_at timestamptz, draft_updated_by uuid fk profiles on delete set null,
  origin jsonb not null default '{}', -- ex.: {"kind":"migration","promptKey":"...","promptSource":"default","sha256":"..."}
  created_by uuid fk profiles on delete set null, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (organization_id, id),
  foreign key (organization_id, id, published_version_id)          -- a publicada é do próprio agente
    references ai_agent_versions (organization_id, agent_id, id)
)
ai_agent_versions (
  id uuid pk, agent_id uuid not null, organization_id uuid not null,
  version int not null check (version >= 1),
  prompt text not null check (char_length(prompt) between 1 and 50000),
  settings jsonb not null default '{}', model text null,
  source text not null check (source in ('migration','publish','restore')),
  restored_from int null, note text null check (char_length(note) <= 200),
  published_by uuid fk profiles on delete set null, published_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references ai_agents (organization_id, id) on delete cascade,
  unique (agent_id, version), unique (organization_id, agent_id, id)
)
channel_connections + ai_agent_id uuid null,
  foreign key (organization_id, ai_agent_id) references ai_agents (organization_id, id) on delete no action
ai_reply_events (                                   -- uma linha por resposta nativa ENTREGUE (prova da migração)
  id bigint identity pk, organization_id uuid not null, channel_connection_id uuid not null, thread_id uuid not null,
  prompt_sha256 text not null check (~ '^[0-9a-f]{64}$'), prompt_key text null, prompt_source text not null,
  agent_id uuid null, agent_version int null,         -- os dois juntos, só quando prompt_source = 'agent'
  release_commit text null check (null ou 40 hex),     -- VERCEL_GIT_COMMIT_SHA da publicação que respondeu
  release_deployment text null check (null ou dpl_*),  -- VERCEL_DEPLOYMENT_ID do deployment que respondeu
  delivered_at timestamptz not null,                   -- a Evolution aceitou a última parte
  created_at timestamptz default now(),
  foreign key (organization_id, channel_connection_id) references channel_connections (organization_id, id) on delete cascade,
  foreign key (organization_id, thread_id) references conversation_threads (organization_id, id) on delete cascade
)
```

- **RLS ligada nas três tabelas.** Nas do agente, `select` só para quem é agência (`is_agency_admin_role()`); nenhuma policy de insert, update ou delete para `authenticated`: escrita só pelas funções `security definer`. Em `ai_reply_events`, nenhuma policy: só a chave de serviço lê e escreve.
- **GRANT explícito**: `revoke all` de `anon` e `authenticated` nas tabelas, depois `select` para `authenticated` nas duas do agente (a RLS filtra) e `all` para `service_role` nas três (`ai_reply_events` não ganha grant nenhum para os papéis comuns, nem na sequência do id). Nas funções, `revoke all ... from public, anon` antes de qualquer `grant execute`. RLS sozinha não concede nada; sem GRANT, a tela quebra com `permission denied`.
- **O evento de prova é da organização do número e da conversa** pelas duas FKs compostas (as chaves `(organization_id, id)` já existem desde o funil): evento de uma organização apontando para número ou conversa de outra é recusado (23503). Sem isso, uma conversa de B apontando para um número de A entraria na prova de A (2ª devolutiva, achado 3).
- **Gatilhos:** `ai_agent_versions` recusa `update`, com uma exceção: zerar `published_by`. É o `update` que o próprio Postgres faz quando o usuário que publicou é apagado (FK `on delete set null`); recusá-lo travaria a exclusão do usuário. `channel_connections` recusa `ai_agent_id` apontando agente sem versão publicada.
- O gatilho das versões não recusa `delete`: se recusasse, travaria a cascata de apagar um agente sem número e de apagar a organização. A versão publicada fica protegida pela FK, só a chave de serviço consegue apagar uma versão antiga solta, e nenhum código faz isso.
- As FKs para `profiles` usam `on delete set null`, como `ai_prompt_templates`: apagar um usuário não pode travar por ele ter publicado uma versão.
- Com FK nos dois sentidos entre as duas tabelas, o embed do PostgREST (`ai_agents(..., ai_agent_versions(...))`) fica ambíguo. Agente e versão são lidos em duas consultas simples.
- **Funções da migração** (`security definer`, só `service_role`; ver "Migração"):
  - `create_ai_agent_from_legacy_prompt(...)` cria o agente com a v1, serializando por (organização, sha) com `pg_advisory_xact_lock`: duas chamadas simultâneas voltam o mesmo agente, em vez de uma delas receber o 23505 do índice único (2ª devolutiva, achado 8);
  - `central_agentes_ultima_resposta_nativa(p_connection_id)` devolve sha, chave, origem, commit e deployment da publicação e hora da entrega do último evento do caminho de hoje (`agent_id` nulo) do número, pela hora da entrega;
  - `central_agentes_ligar_conexao(..., p_publicacao, p_deployment)` liga o número numa transação só, com a tabela de prompts travada contra escrita (`lock table ... in share row exclusive mode`, porque `for share` protege a linha que existe, não a ausência dela), o número travado (`for update`) e o agente travado (`for share`), e confere a chave efetiva pela mesma regra do código (2ª devolutiva, achados 4 e 7).
- O gatilho da conexão cuida só de "agente sem versão publicada" (P0001). Agente de outra organização é recusado pela FK composta (23503), e assim o teste local prova a própria FK (revisão do Codex, achado 14).

## Runtime (fatia 1)

1. O portão da IA (`loadFreshConversationAIGate`) passa a trazer `ai_agent_id`. Ele é lido depois do debounce, pelo webhook (`route.ts:137`) e de novo dentro do gerador (`aiReply.ts:399`). A carga inicial do webhook, anterior ao debounce, não precisa do agente. `undefined` conta como nulo. Se for nulo, **o caminho atual não muda em nada**.
2. Se houver agente, o gerador carrega a versão publicada logo depois do portão (agente e versão da mesma organização, duas leituras simples). O conteúdo do prompt vem de `version.prompt`, e não de `getResolvedPrompt`. O mesmo texto vale para as três decisões que dependem dele: `closing_unsupported`, o catálogo de etiquetas e o render. As 12 variáveis, o histórico, `renderPromptTemplate`, o esquema de saída e a medição continuam os mesmos.
3. Os ajustes **não mudam de lugar nesta fatia**: agrupar, dividir, memória, mídia, cutucada, encerramento, celular, nome e reunião continuam lidos da conexão e das constantes, como hoje.
4. O modelo vem de `version.model || <a expressão de hoje, intacta>` (`orgSettings.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google`). Na v1, `model` é nulo, logo o de hoje. Provedor e chave continuam os da organização.
5. O webhook passa a chamar o gerador também quando `aiPromptKey` é inválida mas o número tem agente. Se o agente sumir entre as duas leituras, o gerador recebe a chave nula e responde `missing_prompt`, nunca o prompt padrão.
6. O metadata ganha `prompt_sha256` em toda resposta nativa e `agent_id`/`agent_version` só em número com agente. `prompt_source` continua `override` ou `default`, e ganha `agent`. O webhook manda também `replyEvent` (sha, chave, origem, agente e versão); `executeConversationAIReply` grava o evento em `ai_reply_events` **depois** de a última parte ser aceita pela Evolution, com a hora lida ali, o commit de `VERCEL_GIT_COMMIT_SHA` e o deployment de `VERCEL_DEPLOYMENT_ID`. Falha ao gravar o evento só avisa, nunca derruba nem marca a resposta. A rota do n8n e a cutucada não mandam `replyEvent` e não gravam evento.
7. **Exceção declarada ao "número sem agente continua igual"** (revisão do Codex, achado 9; 2ª devolutiva, achado 1): as rotas do n8n e manual passam a descartar do metadata que recebem as seis chaves de rastro, em qualquer número. No código, ninguém lê essas chaves em mensagem do n8n ou manual, e a tela não manda nenhuma delas (conferido em 29/09: só o webhook as escreve). O único leitor fora do repositório é a consulta de tempo de resposta do cérebro, que mede resposta nativa. Antes de publicar, conferir os fluxos do n8n dos números com `webhookUrl`.

**Prova de equivalência** (teste obrigatório): com as mesmas entradas e o relógio congelado (a Aurora recebe `{{currentDateTime}}`, que vem de `new Date()` em `aiReply.ts:456`), o prompt renderizado pelo caminho antigo e o do agente com v1 migrada são strings idênticas. Isso vale para a Aurora, para a Julia, para um número com override em `ai_prompt_templates` e para um número sem nada. Hoje só o texto da Aurora tem testes de regressão; esta fatia cria a rede da Julia também.

## Migração da Aurora e da Julia (fatia 1)

Script `scripts/central-agentes/migrar-agentes.ts`, dentro do repositório, nunca commitado com segredo. Tem quatro modos:

- `--prova`: só leitura.
  - Para cada número com IA ligada ou chave de prompt definida, calcula o conteúdo efetivo de hoje com a mesma regra do runtime. A leitura é estrita: erro de banco aborta. As conexões são lidas em páginas, porque o PostgREST corta leitura grande sem erro (revisão do Codex, achado 18).
  - Compara o sha256 calculado com o do último **evento de prova** registrado pelo caminho de hoje daquele número, e confere junto a chave, a origem do texto (catálogo ou override) e a publicação. O resultado é uma de cinco situações:
    - `CONFERE`: mesmo sha, mesma chave, mesma origem, mesma publicação;
    - `DIVERGE`: mesma chave e publicação, sha ou origem diferente (o texto mudou, ou veio de um override em vez do catálogo);
    - `CHAVE DIVERGE`: o evento respondeu com outra chave (a configuração do número mudou depois da resposta);
    - `PUBLICAÇÃO DIVERGE`: o evento veio de outra publicação (deploy, redeploy do mesmo commit ou rollback depois da resposta), ou sem commit ou deployment;
    - `SEM RESPOSTA AINDA`: nenhum evento do caminho de hoje.
  - Quem escolhe esse evento é a função do banco `central_agentes_ultima_resposta_nativa`, só para `service_role`: o mais recente em `ai_reply_events` com `agent_id` nulo, pela hora da entrega (`delivered_at`, lida depois de a Evolution aceitar a última parte), em ordem determinística. Ela não lê `conversation_messages`: mensagem manual ou do n8n não entra, com o metadata que tiver (2ª devolutiva, achado 1); resposta dada por um agente, num número ligado e depois desligado, também não prova o caminho de hoje. Um limite de conversas ou de mensagens no script podia deixar a resposta mais nova de fora e usar uma antiga como prova (revisão do Codex, achados 11 e 12).
  - Número com chave de prompt inválida fica de fora (`CHAVE INVÁLIDA`): hoje ele responde `missing_prompt`, e virar agente faria ele passar a responder.
  - Agrupa num agente os números da mesma organização com o mesmo conteúdo, imprime o relatório e não grava nada.
- `--criar --org <id>`: organização obrigatória. Cria o agente e a v1 (`source = 'migration'`, `settings = {}`, `model = null`) só para grupos em que todos os números estão em `CONFERE`. Não liga número nenhum. É idempotente: o mesmo sha na mesma organização não cria duplicado.
- `--ligar <connectionId>`: acha no banco o agente de migração com o sha de hoje e pede à função `central_agentes_ligar_conexao` que ligue, passando o commit e o deployment que os domínios do ambiente servem. A função trava a tabela de prompts contra escrita, a linha do número e a do agente e, na mesma transação, confere de novo:
  - a chave bruta da conexão e a efetiva (a aparada, ou a padrão quando vazia, como `resolveConversationAIAgentConfig`), para um chamador privilegiado não satisfazer a prova com uma chave que não é a do número (2ª devolutiva, achado 7);
  - o override ativo, inclusive a **ausência** dele: a trava da tabela espera uma publicação de override em andamento terminar e a enxerga (2ª devolutiva, achado 4);
  - a versão publicada do agente, com a linha dele travada;
  - o último evento de prova: mesma publicação (commit e deployment), mesma chave efetiva, mesma origem (catálogo ou override), mesmo sha.

  Qualquer mudança no caminho recusa, com o motivo (revisão do Codex, achado 13). Depois de ligar, o script lê a publicação de novo e exige o mesmo deployment, não só o mesmo commit (4ª devolutiva, achado 12). Se ela mudou, ficou inconclusiva ou a leitura falhou, a ligação é desfeita: o desfazer só vale para o agente recém-ligado (não derruba uma ligação diferente feita por outra pessoa nesse meio-tempo) e a linha é lida de novo para conferir. Se nem o desfazer puder ser confirmado, o script sai com código 3 e diz que o número pode estar ligado (3ª devolutiva, achado 3). A chamada à função que falha **sem resposta do banco** (rede, tempo esgotado, deadlock) recebe o mesmo tratamento, porque a transação pode ter sido gravada antes de a resposta se perder: a linha é conferida e, se o número ficou com o agente, a ligação é desfeita. O resultado sempre diz o que a **linha** mostra no fim (4ª devolutiva, achado 10): se outra pessoa ligou o número a outro agente no meio, o script sai com código 4 e o agente atual, sem desligar nada, e nunca diz "desfeito" ou "não ligou"; e mesmo com tudo confirmado, "ligado" só sai com a linha relida no agente desta chamada. **Nesta fatia, `--ligar` só roda no ambiente de teste**; em produção o script recusa antes de qualquer chamada de rede (ver "O que a prova afirma").
- `--desligar <connectionId>`: volta `ai_agent_id` para nulo e confirma a linha. Número inexistente é avisado, nunca dado como desligado (achado 19). Com `--se-agente <id>`, só desliga se o número ainda estiver com aquele agente: é o que o script manda usar depois de um `incerto`, para não derrubar a ligação de outra pessoa.
- **Trava de banco:** toda escrita exige `--confirmar-banco <ref>` igual à referência que o script imprime. O `origin` do agente registra o commit do catálogo lido, para rastreio.
- **Trava da versão publicada:** `--prova`, `--criar` e `--ligar` usam o ramo do ambiente (`main` em produção, `feat/aurora-implantacao` no teste; ver a trava seguinte). Depois de um `git fetch`, o script só segue se:
  - a cópia estiver exatamente no commit publicado (`HEAD == origin/<ramo>`);
  - os arquivos que decidem o prompt (`lib/ai/prompts/`, `lib/agents/`, `lib/conversations/aiAgentConfig.ts`) não tiverem mudança local.

  Por quê (revisão do Codex, achado 10): comparar só o sha e a idade da resposta deixava passar uma publicação nova feita depois da última resposta. Uma cópia ainda no texto antigo calcularia o texto antigo e daria `CONFERE`.
- **Trava da publicação no ar** (2ª devolutiva, achado 2; 3ª devolutiva, achados 3 e 4): o ambiente sai do **banco conectado**, numa lista fechada dentro do script. Para qualquer outro banco, os três modos são recusados.

  | Banco | Ambiente | Ramo | Domínios (todos conferidos) |
  |---|---|---|---|
  | `eqidsihasmwwamkaqfka` | produção | `main` | `crm.basea2.com`, `crm.cennohub.com.br`, `basecrm.vercel.app` |
  | `zvwngsrflkicbbzfmrgy` | teste | `feat/aurora-implantacao` | `teste.crm.basea2.com` |

  O script lê na API da Vercel os domínios do projeto e o deployment que **cada** domínio serve, e só segue se:
  - a lista fechada é exatamente a dos domínios do projeto que servem conteúdo (domínio que só redireciona não conta): um domínio novo na Vercel, ou um que saiu, recusa com `dominios_do_projeto_divergem` até a lista ser atualizada;
  - todos os domínios servem o mesmo deployment, do projeto certo, sem redirecionar;
  - o deployment é do ramo, está `READY` e o commit dele é o `HEAD` da cópia;
  - em produção ele é o deployment de produção e está promovido; no teste ele **não** é o de produção (toda publicação de produção leva o domínio de teste junto, e nessa hora o "teste" é a produção);
  - não há rollout em andamento, nem deployment mais novo do ramo construindo (transição) ou pronto sem ser o servido (rollback, ou promoção que ainda não aconteceu: recusa conservadora).

  A premissa antiga ("se a publicação estiver atrás do ramo, a prova dá `DIVERGE`") era falsa num rollback sem resposta nova: a última resposta tinha vindo do commit A, o ramo e o HEAD continuavam em A, e o domínio já respondia com B. O evento de prova agora carrega o commit que respondeu, e a função do banco exige que ele seja o que o script conferiu nos domínios.

**O que a prova afirma, e o que não afirma** (3ª devolutiva, achado 5). O evento de prova não é "a última resposta entregue": uma resposta cujo registro falhou não tem evento (o insert do evento só avisa), e a função devolve o último evento **registrado**. A prova do texto não depende de recência. O que se quer garantir é "o texto da v1 do agente é o texto que o runtime usaria agora para este número", e isso sai de quatro coisas conferidas na hora de ligar:

1. a cópia que calcula o texto está no commit R (`HEAD == origin/<ramo>`, sem mudança local) e todos os domínios do ambiente servem o mesmo deployment D, do commit R;
2. a chave do número é K agora (linha travada; chave bruta e efetiva);
3. o override de K é o que o script viu, inclusive ausente (tabela travada);
4. o evento mostra que o runtime do deployment **D** (commit **R**), com a chave **K** e a mesma origem **O** (catálogo ou override), chegou a um texto de sha **S**, igual ao calculado. E, por ter sido gravado **neste** banco por D, mostra que D lê e escreve neste banco (4ª devolutiva, achado 12): um redeploy do mesmo commit é outro deployment, com as variáveis de ambiente do momento em que foi feito, e só passa a valer depois de gravar um evento aqui.

O item 4 é uma testemunha da publicação, não do momento. Para o texto do catálogo, "R com K e sem override dá S" é função só de R e de K, então não depende de quando o evento foi gravado; para o override, o banco confere o conteúdo ativo direto. A origem entra na conferência porque um evento de override com o mesmo sha não provaria o texto do catálogo (ao escrever este argumento, esse caso apareceu e foi fechado: a função da prova devolve `prompt_source` e a de ligar exige a mesma origem). O que o evento protege é o cálculo do script divergir do cálculo do runtime (fim de linha do checkout, resolução de módulo, banco errado). Uma resposta posterior sem evento, mesmo que tenha saído com outro texto (um override que existiu e foi apagado), não muda nenhuma das quatro conferências.

"Usaria agora" vale **com as leituras do banco funcionando** (4ª devolutiva, ponto frágil 3). No caminho de hoje, uma falha transitória na leitura do override faz o runtime cair no catálogo sem avisar (`lib/ai/prompts/server.ts:46-49`); com agente, uma falha na leitura da versão vira `agent_unavailable`, sem cair em texto nenhum (Runtime). A prova compara os dois caminhos na resolução normal; ela não promete que os dois falham do mesmo jeito.

Por isso a 3ª devolutiva corrigiu a **afirmação** e não trouxe a reconciliação com `conversation_messages`: ela voltaria a ler metadata de mensagem, que a 2ª devolutiva tirou, e criaria um jeito novo de travar a ligação sem fechar risco. O `--prova` imprime a hora da entrega do evento usado, para o operador ver a idade dele, e o rito exige uma resposta real nova logo antes de qualquer `--prova` ou `--ligar`.

**O que a prova não cobre nesta fatia: o endereço do webhook do número.** A trava da publicação confere os domínios do projeto. O endereço em que a Evolution entrega o webhook de cada número é gravado pelo CRM com a origem de quem clicou em conectar ou no healthcheck daquele número (`lib/channels/evolutionWebhookRegistration.ts`, `requestOrigin`): pode ser uma prévia, ou um dos endereços automáticos que a Vercel dá a cada branch e a cada deployment, que não dá para listar de forma fechada e podem servir outro código. Um evento antigo não diz por onde o webhook chega hoje; um evento novo diz (`release_commit` e `release_deployment`, e o deployment tem que ser o que os domínios servem), e é por isso que o rito pede a resposta real logo antes. Como isso não está conferido pelo script, nesta fatia **`--ligar` é recusado em produção** (`LIGAR_EM_PRODUCAO_LIBERADO = false`), e a fatia 2 só libera depois de o script ler na Evolution (`GET /webhook/find`) o endereço registrado de cada número e exigir um domínio da lista fechada. No ensaio, o número de teste tem o webhook em `teste.crm.basea2.com`, e a resposta real do Step 1 prova isso pelo `release_commit` e pelo `release_deployment` da prévia.

Ordem (revista em 29/09, ao escrever o PLAN):
1. Banco de teste primeiro (`zvwngsrflkicbbzfmrgy`), nesta ordem:
   - a leitura do ambiente, antes de qualquer push ou escrita: variáveis de Preview próprias da branch de ensaio, variáveis de sistema expostas (sem isso o evento sai sem commit e sem deployment e a prova falha fechada), nenhum rollout, domínios no lugar (Task 13, Step 0);
   - **a prova do banco da próxima prévia, antes do push** (4ª devolutiva, achado 1): nenhuma variável da branch criada ou alterada depois do deployment que o domínio de teste serve, as cinco de banco sobrescrevendo as genéricas, a URL do Supabase da branch apontando para o banco de teste, e o login do domínio de teste provando o banco dele. Sem isso, nada de push;
   - o `prova_login.py` aceitando um endereço e o banco esperado, e saindo com erro quando não confere (4ª devolutiva, achado 11), e o `aplicar_migration.py`, o único caminho de escrita de migration (aplica o arquivo lido do disco, só com o sha256 conferido);
   - a migration;
   - o push para a **branch de ensaio que já existe**, `feat/aurora-implantacao`. Ela tem as variáveis do banco de teste, está no mesmo commit do `main` e é a prévia que `teste.crm.basea2.com` serve. **Nenhuma branch nova vai para o GitHub** (3ª devolutiva, achado 1; lido na Vercel em 05/10): as variáveis de banco genéricas do projeto valem para Preview e Production ao mesmo tempo, o projeto não tem Ignored Build Step nem `vercel.json`, a documentação da Vercel não lista `[vercel skip]` como jeito de pular build, e as prévias são públicas. Uma branch nova viraria uma prévia pública com as credenciais de produção;
   - a prova de qual banco a prévia nova usa, pelo pedido real de login, antes de apontar `teste.crm.basea2.com` para ela;
   - uma resposta real do ensaio, que grava `prompt_sha256` e um evento com `release_commit` igual ao sha do deployment da prévia e `release_deployment` igual ao id dele;
   - `--prova`, `--criar`, `--ligar` e `--desligar` num número de teste;
   - um commit novo na branch de ensaio, para ver o `--ligar` recusar com `em_transicao` enquanto a prévia constrói e com `mais_novo_nao_servido` enquanto o alias ainda aponta para a antiga, e o `--prova` dar `PUBLICAÇÃO DIVERGE` até uma resposta real nova.

   A resposta seguinte do ensaio tem que sair com `agent_version = 1` e o mesmo `prompt_sha256`.
2. Produção, com o OK do Junior:
   - antes de publicar, ver quais números têm automação n8n (`config.webhookUrl`) e se os fluxos deles mandam alguma das seis chaves de rastro no metadata do `/ai-reply`, que passam a ser descartadas (só leitura, com o OK dele);
   - **G23: backup nosso e restauração testada** (3ª devolutiva, achado 8). A organização do Supabase está no plano Free, sem backup automático nem PITR (lido em 05/10). Antes da migration: dump de produção com a CLI, restauração numa stack local temporária, contagens conferidas contra a produção, a migration e a volta aplicadas na cópia restaurada, e a evidência no cérebro (Task 13, Step 2). Sem isso a migration não vai para produção. O dump tem dado pessoal: pasta fora do Git e do WorkSync, cifrada pelo EFS do Windows, com acesso só da conta do Junior, e apagada em até 7 dias depois da produção conferida, salvo decisão dele registrada (4ª devolutiva, achado 13). A escrita em produção é uma só, pelo `aplicar_migration.py`, com o OK dele registrado (achado 8);
   - **a migration ANTES do deploy.** A leitura da conexão passa a pedir `ai_agent_id`; se o código chegar antes da coluna, a leitura falha e a IA para em todos os clientes;
   - depois o deploy, que fica **adormecido**: nenhum número ligado, e as únicas mudanças são o `prompt_sha256` novo no metadata das respostas nativas, o evento de prova gravado depois de cada entrega e a limpeza das chaves de rastro nas rotas do n8n e manual;
   - por fim, depois de uma resposta real de cada uma, o `--prova`, só leitura, com as credenciais de produção (o ambiente, com os três domínios, sai do banco conectado).
   - Na operação: num número com agente, uma falha do agente (`agent_unavailable`) segue o caminho de `missing_prompt` e cai na automação n8n do cliente, se houver uma configurada, como já acontece com qualquer falha da IA nativa.
3. **Ligar a Aurora e a Julia em produção fica para a entrega da fatia 2**, quando já existe o editor. Ligar antes deixaria as duas sem tela para editar o prompt. O aviso na Central de I.A também vai para a fatia 2, com o link para a página nova.

## Fatia 2 — editor com versões e Publicar

- **Rotas de tela:**
  - `/platform/tenants/[tenantId]/agents` (lista do cliente) e `/platform/tenants/[tenantId]/agents/[agentId]` (editor). As duas entram em `TENANT_SCOPED_BASE_ROUTES`; o teste que lê o disco trava isso.
  - Item "Agentes" em `getTenantWorkspaceNav`.
- **Editor, na seção Prompt:** mostra a leitura formatada e troca para edição ao clicar em "Editar". A barra mostra: "Versão N publicada em [data] por [pessoa]", "Rascunho com mudanças" e "Publicar".
- **Rotas de API:** todas com `requireTenantAccess(tenantId, { adminOnly: true })` e corpo validado por zod com `.strict()` (campo fora da lista vira 400). Salvar rascunho e publicar chamam as funções SQL com o cliente do usuário (`createClient`, JWT), nunca com a chave de serviço, para o `auth.uid()` e a checagem de papel valerem.
- **Salvar rascunho** manda a `draft_revision` que a tela leu; se outra aba salvou antes, avisa em vez de sobrescrever (409).
- **Publicar** manda a versão publicada e a `draft_revision` que a tela mostrou. A função recebe também a organização e confere que o agente é dela; depois trava a linha e publica exatamente aquele rascunho. Se qualquer um dos dois números mudou, devolve 409 e a tela recarrega.
- **Histórico:** lista de versões com autor, data e nota. Compara quaisquer duas (texto linha a linha e ajustes campo a campo). "Restaurar" pede confirmação e publica como versão nova.
- **Primeira ligação em produção (Aurora e Julia), junto com esta entrega:**
  - antes de ligar, o script lê na Evolution (`GET /webhook/find`) o endereço em que o webhook de cada número está registrado e exige um domínio da lista fechada; só então `LIGAR_EM_PRODUCAO_LIBERADO` vira verdadeiro (fatia 1, "O que a prova afirma");
  - o PATCH da conexão passa a recusar `aiPromptKey` num número ligado (409, "configurado no agente X"), porque ali a chave não tem mais efeito;
  - entra `lib/ai/prompts/migrated-prompts.lock.json` com o sha256 de cada chave migrada, e o teste de trava falha quando o texto dela muda no catálogo;
  - a Central de I.A mostra o aviso descrito na tabela de decisões.
- **Verificação ao vivo:** função pura compartilhada pela tela e pela rota de publicar; o servidor revalida.
  - Erro, bloqueia Publicar: variável `{{x}}` fora das 12 conhecidas.
  - Aviso, pede confirmação:
    - trecho com cara de pendência (`[Texto com maiúscula]`);
    - `{{calendarContext}}` sem nenhum número ligado com agenda;
    - prompt acima de 30 mil caracteres.
  - Aviso **só quando o rascunho perde algo que a versão publicada tinha** (é regressão):
    - `{{conversationStageContext}}`, porque sem ele o encerramento depois do repasse desliga (`aiReply.ts:476-480`);
    - a instrução de `replyText`;
    - qualquer outra das 12 variáveis.

    Quando a versão publicada já não tinha, a tela mostra uma informação, sem pedir confirmação. Por exemplo: "este agente não faz encerramento depois do repasse".

  Medido em 29/09 no catálogo:
  - **Aurora:** 18.848 caracteres, as 12 variáveis, com `replyText` e sem pendência. Não dispara nada.
  - **Julia:** 2.569 caracteres, 4 variáveis (`organizationName`, `contactName`, `contactPhone`, `recentMessagesText`), com `replyText` e **sem `{{conversationStageContext}}`**. Hoje ela não encerra depois do repasse; o editor mostra isso como informação.

  O teste confere as duas.

## Fatia 3 — testar sem enviar

- **Rota:** `POST /api/platform/tenants/[tenantId]/agents/[agentId]/test`, só agência. Corpo: mensagens simuladas (lead ou agente) e, opcionalmente, o número de referência, usado para agenda e quem conduz (padrão: o primeiro número ligado).
- **Motor:** antes da rota, o miolo de `generateConversationAutoReply` é extraído para uma função pura que recebe tudo já carregado (prompt, contexto, histórico, modelo) e só chama o modelo. O webhook continua chamando o gerador de sempre, que agora usa esse miolo; o teste chama `generateAgentReplyPreview`, que monta as entradas a partir do **rascunho** e das mensagens simuladas e usa o mesmo miolo, **sem o portão de envio**. Nada é enviado, então o agente pode estar pausado. Precisa de chave de IA configurada.
- **Agenda só lida, sem registrar falha:** hoje `loadGoogleBusyIntervals`, quando o Google falha, marca a conexão da agenda (`reconnect_required` em `invalid_grant`, `freeBusy.ts:159`) e grava um aviso em `system_notifications` (`freeBusy.ts:57`). O teste passa uma opção nova, `recordFailures: false`, que só pula esses dois registros; o padrão continua `true` e o atendimento real não muda.
- **Sem efeito colateral nenhum:**
  - não grava conversa nem mensagem;
  - não envia;
  - não agenda (a agenda só é lida);
  - não aplica etiqueta, não mexe no negócio;
  - não agenda cutucada, não manda evento para a Meta;
  - não grava em `system_notifications` nem muda o status da conexão do Google, mesmo com o Google falhando.

  O teste da rota conta as linhas das tabelas antes e depois.
- **O que devolve:**
  - as partes da resposta como sairiam no WhatsApp;
  - "o que o agente fez": os campos estruturados já existentes (repasse e motivo, pedido de horário, nome, e-mail, empresa e segmento captados, etiquetas sugeridas, gate de capacidade, resumo);
  - o tempo (`ai_timing`) e os tokens.
- **Explicar esta resposta:** botão sob demanda que faz uma segunda chamada, depois da resposta, e mostra "por que respondeu assim" em português, rotulado como explicação gerada depois. Não altera a resposta testada. Aprovado pelo Junior em 29/09. Entra no mesmo limite de testes.
- **Limites:**
  - 20 testes a cada 10 minutos por pessoa;
  - no máximo 30 mensagens simuladas de 2 mil caracteres cada;
  - `maxOutputTokens` igual ao de produção.
- **Segurança:** a mensagem simulada é entrada não confiável. O preview não tem ferramenta nem efeito, e a resposta aparece como texto, nunca como HTML.

**Com as fatias 1, 2 e 3 o critério de pronto aprovado está cumprido.** Validação: o Junior muda a abertura da Aurora pela tela, testa, publica. A próxima resposta real mostra `agent_version` novo e a abertura nova, e "Restaurar" traz a anterior.

## Fatia 4 — comportamento como frase

Antes de mexer: **testes de caracterização** que travam o comportamento atual, porque hoje nenhum teste fixa 7000/2000 ms, as 240 letras e 3 partes, as 12 mensagens ou as 2 respostas em 60 min (mapa B).

**Pontos de leitura que passam a usar `resolveAgentSettings`** (agente → conexão → constante), só para número ligado:
- agrupar: `webhook/route.ts:1425`, calculado antes de agendar a resposta;
- memória: `webhook/route.ts:193-200`;
- dividir: `aiReply.ts:885`, dentro de `executeConversationAIReply` (`aiReply.ts:685`). Essa função também entrega a resposta do n8n (`ai-reply/route.ts:85`) e a cutucada (`idleNudgeRunner.ts:187`); num número ligado, o valor do agente vale para as três, como hoje as três usam a mesma constante;
- encerramento: `webhook/route.ts:176` e `:1360`, com `closingReply.ts:14-15`; a nova checagem na hora de reivindicar a resposta (`aiReply.ts:731`); e a instrução de "última mensagem", que usa `CLOSING_REPLY_MAX - 1` (`closingReply.ts:106`);
- mídia: `webhook/route.ts:817` e `:186`; e o varredor de mídia pendente, que filtra as conexões no SQL por `config->media->>mode = 'understand'` (`inboundMediaPending.ts:91`) e passa a incluir os números cujo agente publicou `understand`;
- celular: `webhook/route.ts:944`;
- cutucada: agendamento em `webhook/route.ts:440` e **envio no executor separado `lib/conversations/idleNudgeRunner.ts:156`**, que também precisa resolver pelo agente;
- nome: `aiAgentConfig.ts` e `webhook/route.ts:145/288`; o nome de reserva quando a resposta não traz autor (`aiReply.ts:779`); e o nome no lembrete de reunião (`meetingReminder.ts:332`);
- reunião: `resolveMeetingHostName` (`aiReply.ts:347-371`) e `readMeetingChannelText` (`closingReply.ts:20-23`).

Número sem agente continua lendo como hoje. Se números ligados ao mesmo agente têm valores diferentes na conexão, a tela mostra "varia por número" até alguém publicar um valor no agente.

| Ajuste | Frase na tela | Padrão (= hoje) | Limites |
|---|---|---|---|
| Agrupar | "Espera **7** segundos depois da última mensagem antes de responder (**2** segundos quando o lead vem de um anúncio)." | 7 s / 2 s | 1–60 s / 0–60 s |
| Dividir | "Divide respostas longas em até **3** mensagens de até **240** caracteres." (1 = não divide) | 3 / 240 | 1–5 / 80–1000 |
| Memória | "Lê as últimas **12** mensagens da conversa." | 12 | 4–40 |
| Mídia | "Quando chega áudio ou imagem, a IA **[não olha / só registra / entende]**." | não olha (`off`) | enum |
| Cutucada | "Se o lead sumir, manda **[texto]** depois de **15** minutos." / "Se ele pedir para falar depois, retoma às **9** h com **[texto]**." / ligada ou desligada | valores de `idleNudge.ts:18-34` | 5–1440 min; 0–23 h |
| Encerramento | "Depois de passar para uma pessoa, responde no máximo **2** vezes em **60** minutos para encerrar." | 2 / 60 | 0–5 / 10–240 |
| Celular | "Quando alguém da equipe responde pelo celular, a IA **[pausa / continua]**." | continua | booleano |
| Reunião | "Quem conduz a reunião é **[nome]** (vazio: o dono da agenda)." / "A reunião acontece **[texto]**." | cadeia atual de `aiPromptContext.ts` / `closingReply.ts:16` | 80 / 200 caracteres |
| Nome | "O agente se chama **[nome]**." | "Assistente" | regex atual |

Cada frase tem "Voltar ao padrão". Os valores entram no rascunho e só valem depois de Publicar.

## Fatia 5 — modelo por agente, tempo e custo

- O modelo é escolhido entre os do provedor da organização, a partir de uma lista curada em código com preço em USD por milhão de tokens. **O preço é copiado da página oficial de cada provedor no dia da implementação, com a data e o link**, e nunca estimado de memória. Trocar de provedor continua sendo da organização (chave do cliente).
- **A versão guarda provedor e modelo juntos** (coluna `provider` nova em `ai_agent_versions`, com checagem de que os dois são nulos ou os dois preenchidos). O runtime só usa o modelo da versão quando o provedor dela é o provedor atual da organização; se a organização trocou de provedor, usa o modelo de hoje e a tela do agente avisa. Nunca manda o modelo de um provedor para outro.
- O `usage` do `generateText` passa a ser lido e gravado no `ai_timing`, somando as duas gerações quando houver reparo: `input_tokens`, `output_tokens` e, quando o provedor devolver, `cached_input_tokens` e `reasoning_tokens`, mais `provider` e `model`.
- O custo é calculado na leitura, pela tabela de preço com data, e mostrado como "estimado". O banco guarda o fato (tokens); o preço fica versionado no código.

## Fatia 6 — visão da agência

- `/platform/agents`, com item em `getSecondaryNav`. Uma linha por agente de cada cliente:
  - cliente, agente;
  - versão publicada (data e autor), rascunho pendente;
  - números ligados, com a IA ligada ou pausada em cada um;
  - modelo;
  - tempo médio de resposta (7 dias), respostas (7 dias), repasses, falhas;
  - custo estimado (30 dias).
- **Agregação:** função SQL só para agência, com período limitado. O `EXPLAIN` é conferido em cópia de leitura com volume real antes de publicar.
- **Uma linha por resposta, não por mensagem.** Uma resposta dividida em 3 partes vira 3 linhas em `conversation_messages`, e cada uma carrega o metadata inteiro, com `ai_timing` e tokens (`aiReply.ts:939-953`). Somar tudo contaria a resposta 3 vezes. A fatia 1 já cria `ai_reply_events`, uma linha por resposta nativa entregue (sha, chave, agente, versão, publicação e hora da entrega): respostas e versão por período saem dela. Tempo e tokens ainda ficam no metadata; se o `EXPLAIN` mostrar que ler `reply_part_index = 0` não escala, a fatia 6 acrescenta essas colunas ao evento em vez de somar metadata.
- **Tela:** grid no padrão de `TenantsPage.tsx`, com estados de carregando, erro e vazio.

## Critérios de aceite e testes obrigatórios

- **Fatia 1:**
  - equivalência byte a byte (4 cenários acima), incluindo o mesmo `prompt_sha256` nos dois caminhos;
  - `ai_agent_id` nulo não muda nenhuma saída dos testes atuais (suíte completa verde antes e depois);
  - toda resposta nativa grava `prompt_sha256`; `agent_id` e `agent_version` só aparecem em número com agente;
  - toda resposta nativa **entregue** grava um evento em `ai_reply_events`, depois do último envio, com a hora da entrega e o commit e o deployment da publicação; entrega que falhou não grava; a rota do n8n e a cutucada não gravam; falha ao gravar só avisa;
  - a FK composta recusa ligar um número a agente de outro cliente (23503); agente sem versão publicada, o gatilho recusa (P0001);
  - evento de uma organização apontando para número ou conversa de outra é recusado (23503); sha fora do formato e agente sem versão são recusados (23514);
  - apagar agente com número ligado é recusado; sem número ligado, apaga; apagar a organização inteira continua funcionando e leva os eventos junto;
  - `update` numa versão é recusado; apagar o usuário que publicou uma versão não trava (o autor vira nulo e o resto não muda);
  - matriz de acesso do G2, com chamada de verdade (revisão do Codex, achado 15; 2ª devolutiva, achado 6):
    - identidades: anônimo, `agency_admin`, `agency_staff`, o legado `admin`, cliente A e cliente B;
    - operações: SELECT, INSERT, UPDATE e DELETE nas duas tabelas do agente, contra a organização A **e** a B; as mesmas quatro em `ai_reply_events` (3ª devolutiva, achado 9); e as três funções;
    - resultado: `agency_admin` e `admin` leem as duas organizações; `agency_staff` e os clientes leem vazio sem erro (se a policy passasse a `is_agency_role()`, o staff leria e o teste cai); ninguém escreve direto; ninguém que não seja `service_role` lê ou escreve o evento; só `service_role` chama as funções;
  - chave de prompt inválida e sem agente responde `missing_prompt`, nunca o prompt padrão;
  - `agent_unavailable` registrado como falha de configuração;
  - as rotas do n8n e manual descartam as chaves de rastro do metadata que recebem, inclusive no envio local (`send_external: false`); na rota do n8n, um corpo com `replyEvent` recebe 400 (o schema é estrito) e um pedido válido nunca leva evento ao executor;
  - migração:
    - `--criar` e `--ligar` recusam sem `CONFERE`;
    - erro de leitura aborta;
    - `--criar` sem `--org` é recusado;
    - fora do commit publicado ou com mudança local nos arquivos do prompt, o script recusa;
    - o script recusa `--prova`, `--criar` e `--ligar` contra um banco fora da lista fechada de ambientes;
    - a leitura da publicação recusa: lista fechada diferente dos domínios do projeto que servem conteúdo (`dominios_do_projeto_divergem`, inclusive lista paginada); domínios do ambiente servindo deployments diferentes; alias de outro projeto ou que só redireciona; deployment de outro ramo, sem commit ou não pronto; domínio de teste servido pelo deployment de produção, ou produção não promovida (`alvo_diverge`); rollout em andamento ou deployment mais novo do ramo construindo (`em_transicao`); deployment mais novo pronto sem ser o servido (`mais_novo_nao_servido`);
    - depois de ligar, se a publicação mudou, ficou inconclusiva ou a leitura lançou erro, a ligação é desfeita só do agente recém-ligado e a linha é conferida; uma ligação diferente feita por outra pessoa nesse meio-tempo não é derrubada e aparece como `ligado_a_outro`; se não der para confirmar, o resultado é `incerto` (saída 3), nunca "desfeito"; a chamada à função de ligar que falha sem resposta do banco (erro devolvido, erro lançado ou resposta sem resultado) é tratada do mesmo jeito: a linha é conferida e sai `desfeito`, `nao_ligou` ou `incerto` conforme o que ela mostra;
    - o script recusa `--ligar` contra o banco de produção nesta fatia, antes de qualquer chamada de rede (`LIGAR_EM_PRODUCAO_LIBERADO = false`);
    - a função do banco lê só o evento, pela hora da entrega, só do caminho de hoje; uma mensagem manual com o rastro forjado no metadata não entra;
    - ligar recusa, com o motivo, se a chave bruta, a chave efetiva, o override, a versão, a publicação ou a resposta divergem;
    - quando a linha conferida mostra outro agente, o resultado é `ligado_a_outro`, com o agente atual e saída 4, nas três rotas: ligação confirmada que não se confirma depois, resposta perdida da chamada, e ligação confirmada com a linha trocada no fim; `ligado` só sai com a linha relida no agente desta chamada, e linha ilegível no fim é `incerto` (4ª devolutiva, achado 10);
    - a função de ligar recusa com `publicacao_diverge` um evento do mesmo commit e de outro deployment (redeploy), e com `publicacao_invalida` um deployment fora do formato `dpl_...`; o `--prova` dá `PUBLICAÇÃO DIVERGE` no mesmo caso; e outro deployment do mesmo commit depois de ligar desfaz a ligação (4ª devolutiva, achado 12);
    - a função de ligar recusa com `prova_nao_confere` um evento com a mesma chave e o mesmo sha, mas de origem diferente (override quando o número está no catálogo, e vice-versa);
    - corrida do override: com uma escrita em `ai_prompt_templates` aberta em outra sessão, a ligação espera e, ao fim, recusa com `override_mudou` (duas sessões de verdade no banco local);
    - corrida do ponteiro: com a publicação de outra versão aberta em outra sessão, a ligação espera e recusa com `versao_publicada_diverge`;
    - criação concorrente: com a primeira criação aberta em outra sessão, a segunda espera e volta o mesmo agente, sem 23505;
    - nas três corridas a espera é **observada** (3ª devolutiva, achado 7): a sessão que segura a transação vê a outra bloqueada por ela (`pg_blocking_pids`) e confere em `pg_locks` qual trava está pendente (`ShareRowExclusiveLock` da tabela de prompts, `transactionid` da linha do agente, `advisory` da criação) antes do `commit`. Tempo de espera não prova trava;
    - os testes de corrida só abrem sessão no Postgres local: a URL é constante, sem variável de ambiente (3ª devolutiva, achado 2);
    - a leitura de conexões pagina (teste acima de 1.000 linhas);
    - desligar confirma a linha;
    - a volta da migration foi provada no banco local.
- **Fatia 2:**
  - publicar cria N+1 e move o ponteiro atomicamente;
  - duas publicações com a mesma versão esperada: uma ganha, a outra recebe 409; publicar com `draft_revision` diferente da mostrada também recebe 409;
  - restaurar cria versão nova com `restored_from`;
  - a verificação ao vivo aponta cada item da lista; os prompts atuais não disparam erro nem aviso (a Julia mostra só a informação do encerramento);
  - a Central de I.A mostra o aviso com link, e não o editor, quando todos os números da chave têm agente; e avisa quando só alguns têm;
  - o PATCH de `aiPromptKey` num número ligado recebe 409;
  - o teste de trava do catálogo falha quando o texto de uma chave migrada muda;
  - campo fora da lista recebe 400;
  - admin do cliente recebe 403 em todas as rotas.
- **Fatia 3:**
  - nenhuma linha nova em conversas, mensagens, negócios, contatos, etiquetas, jobs, eventos e `system_notifications` depois de um teste, e a conexão do Google não muda de status, mesmo com o Google falhando;
  - nenhuma chamada à Evolution;
  - limite de testes respeitado;
  - preview com agente pausado funciona.
- **Fatia 4:**
  - caracterização antes;
  - agente sem valor = valor da conexão = comportamento de hoje, em todos os pontos de leitura listados, no executor da cutucada e no varredor de mídia;
  - limites rejeitados pela validação;
  - o PATCH da conexão recusa ajustes de agente num número ligado.
- **Fatia 5:** tokens gravados nas duas gerações; custo nulo quando o modelo não está na tabela, nunca inventado; versão com provedor diferente do da organização usa o modelo de hoje.
- **Fatia 6:** só agência; período limitado; uma resposta dividida em 3 partes conta como 1; tela com os três estados.
- **Toda fatia:**
  - suíte completa verde lida num comando separado antes do commit;
  - `git diff --stat` conferido;
  - prévia provada pelo login real, que mostra qual banco a prévia usa;
  - produção só com o OK do Junior.

## Portões de segurança aplicáveis (G1–G25)

- **G2 e G13:** RLS e GRANT nas tabelas novas, provados pela matriz anônimo × `agency_admin` × `agency_staff` × `admin` legado × cliente A × cliente B, em CRUD contra as duas organizações e nas RPCs (Task 2 do PLAN). Escrita só por função `security definer` com `search_path=''`; `ai_reply_events` é só da chave de serviço, escrita por um único caminho do servidor.
- **G3:** autorização no servidor em toda rota (`requireTenantAccess` com `adminOnly`), e as funções de escrita conferem o papel de novo por dentro.
- **G4:** FK composta e checagem de organização em toda leitura.
- **G5 e G19:** zod com `.strict()`, lista fechada de campos e limites: campo fora da lista recebe 400, nunca é ignorado em silêncio. A função de publicar também recusa chave desconhecida em `settings`, e o autor vem de `auth.uid()`, nunca do corpo.
- **G7 e G18:** limite no teste e teto de tamanho.
- **G15, G16 e G17:** preview sem ferramenta nem efeito, saída tratada como texto.
- **G22:** a chave de IA nunca sai do servidor.
- **G20 (regra de negócio):** a tabela de invariantes abaixo. Cada uma tem teste negativo e fica garantida no banco ou no servidor, não na tela.
- **G23:** migration só aditiva, sem reescrever `config` de conexão (revisão do Codex, achado 20). O gate pede backup **e** restauração testada, e a organização do Supabase está no plano Free, sem backup automático nem PITR (lido em 05/10; 3ª devolutiva, achado 8). O G23 fica **PENDENTE** até a Task 13, Step 2, registrar:
  - o dump de produção (roles, esquema e dados) tirado por nós, numa pasta fora do Git e do WorkSync, cifrada pelo EFS do Windows e com acesso só da conta do Junior (conferido com `cipher` depois do dump), apagado em até 7 dias depois da produção conferida, salvo decisão dele registrada (4ª devolutiva, achado 13);
  - o OK dele para a escrita em produção, citado com data e hora, e a escrita feita só pelo `aplicar_migration.py`, com o sha256 que já rodou no banco de teste e na cópia restaurada (4ª devolutiva, achado 8). O "agente sem poder destrutivo direto" fica cumprido por processo nesta escrita, não por permissão (achados fora do escopo, item 10);
  - a restauração numa stack local temporária, com as contagens conferidas contra a produção;
  - a migration e a volta (`volta-fatia-1.sql`) aplicadas na cópia restaurada, além da volta já provada no banco local (aplicar, voltar, aplicar);
  - o ensaio completo no banco de teste.
- **G24:** o rastro (versão e sha em cada resposta) é registro, não detecção. Esta fatia não cria alerta, então o G24 fica **NÃO-TESTADO** (revisão do Codex, achado 21).
- **G25:** nenhum default de plataforma novo nesta fatia (N/A). O default inseguro que já existe no projeto (variáveis de banco genéricas valendo para Preview e Production, e prévias públicas) está em "Achados fora do escopo", item 9; esta entrega não depende dele, porque não cria branch nova.

| Invariante (G20) | Onde fica garantida | Teste negativo |
|---|---|---|
| Número sem agente responde como hoje | runtime: `ai_agent_id` nulo = caminho atual | equivalência (Task 7) e suíte atual verde |
| Chave inválida, sem agente, não responde | gerador: chave nula vira `missing_prompt` | Tasks 6 e 8 |
| Número não liga a agente de outro cliente | FK composta | Task 2 (23503) |
| Número não liga a agente sem versão publicada | gatilho | Task 2 (P0001) |
| Versão não muda depois de gravada | gatilho (exceto zerar o autor) | Task 2 |
| Agente ligado não se apaga | FK `on delete no action` | Task 2 |
| Um agente de migração por (cliente, sha), mesmo sob concorrência | índice único + `pg_advisory_xact_lock` na função | Task 2 (duas sessões) |
| Só liga com a prova em `CONFERE` e o estado igual ao conferido | `central_agentes_ligar_conexao`, numa transação, com a tabela de prompts, o número e o agente travados | Tasks 2 (inclusive as duas corridas) e 10 |
| A prova só vem de resposta nativa entregue, da organização do número | `ai_reply_events`: só `service_role` escreve, um único caminho do servidor, FKs compostas | Tasks 2 e 8 |
| A prova só vale para a publicação que está no ar | commit e deployment no evento + leitura de todos os domínios do ambiente na Vercel antes, dentro e depois de ligar (o mesmo deployment); não conseguir confirmar depois de ligar desfaz a ligação, e o resultado diz o que a linha mostra | Tasks 2, 10 e 11 |
| Rastro nativo não é forjado pelas rotas do n8n e manual | limpeza nas duas rotas | Task 9 |

## Achados fora do escopo, registrados para não se perderem

1. `AIConfigSection.tsx:141` mostra provedor, modelo e chave para o admin do cliente, e o servidor recusa (`settings/ai/route.ts:115-117`). É correção pequena e independente; pode entrar antes da fatia 1.
2. O `GET /api/settings/ai` responde `ai_enabled = true` quando a organização não tem linha em `organization_settings`, e o motor trata a ausência como desligado (`aiReply.ts:417`). A tela pode mostrar "ligada" com a IA parada.
3. Os dois `GET` de `ai-prompts` aceitam o admin do cliente, que lê prompt e versões pela API mesmo sem botão na tela.
4. As policies de `ai_prompt_templates` usam o papel legado `'admin'` (`schema_init.sql:580-610`). Conferir se migrations posteriores as reescreveram antes de confiar nelas.
5. O tipo `ChannelConnectionConfig` (`lib/channels/types.ts:9-16`) não lista nenhum campo de IA.
6. ~~A policy de `channel_connections` é de 10/03 e usa o papel legado.~~ Corrigido na revisão: as duas policies de 10/03 foram removidas em `20260630000000_m6_security_hardening.sql:169-170`. Hoje `authenticated` não lê nem escreve a tabela (sem policy, a RLS nega tudo) e todo acesso passa pelas rotas, com a chave de serviço. Para a Central, isso quer dizer que a tela nunca lê `channel_connections` direto do navegador.
7. `boards.agent_*` (nome e comportamento por funil) não alimenta o atendimento. Fica para a fase 3 ("agente por funil"), que decide se unifica.
8. **O banco de produção não tem backup da plataforma.** A organização do Supabase está no plano Free: a lista de backups do projeto vem vazia e o PITR não está disponível (API de gerenciamento, 05/10). A documentação do Supabase diz que projeto Free não tem backup automático e recomenda `supabase db dump` regular com cópia externa. Esta fatia tira o próprio dump antes da migration (G23), mas o risco é do CRM inteiro e a decisão é do Junior: plano Pro (backup diário, 7 dias) ou dump agendado com cópia fora do Supabase.
9. **Prévia de branch sem variável própria herda o banco de produção, e as prévias são públicas.** As cinco variáveis de banco genéricas do projeto na Vercel valem para Preview e Production ao mesmo tempo; só `feat/aurora-implantacao` e `feat/funil-construtor` têm as suas. Em 05/10 existia uma prévia `READY` de `feat/rebrand-cenno`, que pela configuração herda as de produção (não provei pelo pedido de login), e o projeto não tem proteção de prévia (`ssoProtection` nulo). Correção estrutural, fora desta fatia: valores de produção só no alvo Production, Preview genérico apontando para o banco de teste e, se fizer sentido, proteção de prévia.
10. **O MCP do Supabase desta máquina e o token de gerenciamento escrevem em qualquer projeto.** Onde aparece: `~/.claude.json`, servidor `supabase` (`npx @supabase/mcp-server-supabase` com token de conta, sem `--read-only` e sem `--project-ref`; lido em 05/10). É por isso que o G23 não pode dizer "agente sem poder destrutivo direto em prod" por permissão: nesta fatia isso vale por processo (Task 13, Step 2.3). Padrão que recomendo: o servidor do MCP em `--read-only` no dia a dia, e escrita de migration só pelo `aplicar_migration.py`, com o OK do Junior. A decisão é dele, porque o mesmo MCP serve outros projetos.

## Decisões do Junior sobre esta SPEC (29/09, ~05h20)

1. **Pausar por número, do lado do cliente: "manter assim".** Na fase 1 o admin do cliente continua pausando só a IA do cliente inteiro (`/api/settings/ai`). Pausar um número ou um agente continua com a agência.
2. **"Explicar esta resposta" no teste: "pode incluir".** Entra na fatia 3 como botão sob demanda: uma chamada a mais, só quando alguém clica, sem alterar a resposta testada.

## Pontos para o Codex aprovar ou contestar

1. A divisão entre ajustes do agente e do número, a ordem agente → conexão → constante, e o PATCH recusar (em vez de ignorar) campo de agente em número ligado.
2. Falhar com `agent_unavailable` em vez de cair no prompt antigo.
3. FK composta com `on delete no action` (trocada depois da revisão adversarial; antes era `set null`): agente ligado não se apaga, e apagar a organização em cascata continua passando, porque a checagem de `no action` roda depois das cascatas do mesmo comando (padrão já usado pelas FKs compostas do funil). O teste local prova os três casos.
4. Rascunho na própria linha do agente × tabela de rascunhos.
5. Custo calculado na leitura × gravado na escrita.
6. O preview contornar o portão de envio só pela função nova, sem flag no gerador que o webhook usa.

## Revisão do Codex (29/09) — como ficou

Pontos 1, 2, 4, 5 e 6 aprovados. O 3 foi aprovado condicionado ao teste local da cascata, que continua obrigatório (Task 2 do PLAN, com ordem de parar se falhar). A 2ª devolutiva (seção seguinte) reabriu os achados 10, 13 e 15; o estado final deles é o descrito lá. Achados:

| # | Gravidade | O que mudou |
|---|---|---|
| 7 | importante | A Task 13 tem os comandos próprios desta entrega; o rito da branch da Aurora não é seguido ao pé da letra. A prévia nova só é construída depois de ganhar as variáveis da própria branch, porque sem elas usaria o banco de produção. **Superado** (3ª devolutiva, achado 1): nenhuma branch nova vai para o GitHub; o ensaio usa a branch que já tem as variáveis do banco de teste. |
| 8 | bloqueante | O banco falso dos testes ganhou `.not`, com a semântica de NULL do SQL, antes do teste de equivalência da Aurora. |
| 9 | menor | A limpeza das chaves de rastro na rota do n8n está declarada como exceção (Runtime, item 7). Os fluxos do n8n são conferidos antes de publicar. |
| 10 | bloqueante | Trava da versão publicada: o script só roda com `HEAD == origin/<ramo publicado>` e sem mudança local nos arquivos do prompt. A janela de 72 horas saiu. **Insuficiente sozinha** (2ª devolutiva, achado 2): entrou a trava da publicação no ar, lida na Vercel. |
| 11 | bloqueante | A última resposta é escolhida por função do banco, entre todas as conversas do número. **Revisto** (2ª devolutiva, achados 1, 3 e 5): a função passou a ler só `ai_reply_events`, pela hora da entrega. |
| 12 | importante | Só conta resposta entregue, uma linha por resposta, e sem sha a prova falha fechada (`RESPOSTA SEM SHA`). **Superado**: o evento sempre tem sha (check do banco); a situação `RESPOSTA SEM SHA` deixou de existir e entraram `CHAVE DIVERGE` e `PUBLICAÇÃO DIVERGE`. |
| 13 | importante | A ligação é feita por `central_agentes_ligar_conexao`, numa transação só, com a linha travada. Ela confere de novo a chave, o override, a versão e a resposta. **Revisto** (2ª devolutiva, achados 4 e 7): tabela de prompts e agente travados, chave efetiva e publicação conferidas. |
| 14 | importante | O gatilho cuida só de agente sem versão (P0001), e a FK composta responde por agente de outro cliente (23503). O teste agora prova a FK. |
| 15 | importante | A matriz de acesso cobre anônimo, agência, cliente A e cliente B, em CRUD nas duas tabelas e nas três funções. **Ampliada** (2ª devolutiva, achado 6): `agency_staff`, `admin` legado, CRUD contra as duas organizações e `ai_reply_events`. |
| 16 | menor | A redação da garantia de histórico mudou: protege contra UPDATE e contra os papéis comuns, sem prometer que a versão é inviolável para `service_role`. |
| 17 | importante | O banco falso ganhou projeção opcional do `select`. O teste do portão fica vermelho sem a coluna nova. |
| 18 | menor | A leitura de conexões pagina (teste acima de 1.000 linhas), e o agente candidato é achado por filtro no banco. |
| 19 | menor | `--desligar` confirma a linha e distingue número inexistente. |
| 20 | importante | G23: backup e PITR registrados antes da escrita, e a volta provada no banco local. **Ampliado** (3ª devolutiva, achado 8): não há backup da plataforma (plano Free); o backup é nosso, com restauração testada, e o G23 fica PENDENTE até lá. |
| 21 | menor | As invariantes foram para o G20, com tabela e testes negativos. O G24 fica NÃO-TESTADO e o G25 é N/A nesta fatia. |

## 2ª devolutiva do Codex (29/09) — como ficou

Cópia literal em `levantamento/devolutiva-codex-2-fatia-1.md`. Os seis vereditos de desenho não mudaram. Cada achado foi conferido no código (`335f32b`) antes de ser aceito; todos os oito foram aceitos.

| # | Gravidade | Conferido | O que mudou |
|---|---|---|---|
| 1 | bloqueante | Sim: `MessageSchema` aceita `metadata` livre com `conversations.reply`; com `send_external: false` o `deliver()` devolve `status: 'sent'` sem mandar nada; o dispatcher preserva as chaves recebidas | A prova deixou de ler metadata de mensagem. Nasceu `ai_reply_events`, gravada só pelo caminho nativo com a chave de serviço, depois da entrega; a função da prova lê só ela. A rota manual também limpa as seis chaves. Teste local com a mensagem manual forjada; teste da rota manual com `send_external: false`. |
| 2 | bloqueante | Sim: `HEAD == origin/<ramo>` não diz o que o domínio serve | O evento carrega `release_commit` (`VERCEL_GIT_COMMIT_SHA`). O script exige `--dominio`, lê na API da Vercel o deployment ativo do domínio e a lista do ramo, recusa transição e rollback, e exige commit igual ao HEAD; a função do banco exige que o evento venha desse commit; depois de ligar, confere de novo e desliga se mudou. **Reaberto** na 3ª devolutiva (achados 3 e 4): o ambiente passou a sair do banco, com todos os domínios, e a falha na conferência depois de ligar passou a desfazer a ligação. |
| 3 | importante | Sim: a FK de `conversation_threads.channel_connection_id` é simples (`20260310020000`) | O evento tem FKs compostas `(organization_id, channel_connection_id)` e `(organization_id, thread_id)`; evento cruzado é 23503. Teste local com os dois cruzamentos. |
| 4 | importante | Sim: `IF EXISTS` não protege a ausência de linha; o publicador atual faz UPDATE e INSERT separados; o ponteiro era lido sem lock | `lock table ai_prompt_templates in share row exclusive mode` como primeiro comando da ligação (espera escrita em andamento e a enxerga) e `for share` na linha do agente, em dois passos. Duas corridas provadas no banco local com uma sessão `pg` segurando a transação e o `rpc` esperando. Congelamento operacional de override e catálogo durante a entrega (Task 13). **Reforçado** (3ª devolutiva, achado 7): a espera pela trava é observada em `pg_locks`, não presumida por tempo. |
| 5 | importante | Sim: `sent_at` e `created_at` são fixados antes dos envios (`aiReply.ts:724,951-952`) | O evento grava `delivered_at` lido depois de a última parte ser aceita; a prova ordena por ele. |
| 6 | importante | Sim: `is_agency_role()` inclui `agency_staff`; a matriz só tinha `agency_admin` e dois `clinic_admin`, e escrevia só contra A | Matriz com seis identidades (anônimo, `agency_admin`, `agency_staff`, `admin` legado, cliente A, cliente B), CRUD contra A e B, a agência lendo os ids das duas organizações, o staff lendo vazio, e `ai_reply_events` negada a todos. **Ampliado** (3ª devolutiva, achado 9): UPDATE e DELETE em `ai_reply_events` também. |
| 7 | menor | Sim: a RPC confiava em `p_prompt_key` | A função calcula a chave efetiva no SQL (aparada, ou a padrão quando vazia) e recusa com `chave_efetiva_diverge`; o teste do texto trava a chave padrão contra `DEFAULT_CONVERSATION_AI_PROMPT_KEY`; teste local negativo. |
| 8 | menor | Sim: duas buscas vazias → dois INSERT → 23505 | `pg_advisory_xact_lock(hashtextextended(org || ':' || sha, 0))` antes da busca; duas sessões simultâneas no banco local voltam o mesmo agente. |

Assumido e dito: a chave efetiva no SQL espelha `resolveConversationAIAgentConfig` só no corte (`btrim`) e no padrão; a validade da chave no catálogo continua com o script. Espaço fora do comum no começo ou no fim da chave faz banco e código divergirem, e aí a ligação é recusada, nunca feita errada. O `release_commit` depende de "Enable access to System Environment Variables" na Vercel; sem ele a prova falha fechada (`PUBLICAÇÃO DIVERGE` em todo número), e a Task 13 confere isso antes do ensaio.

## 3ª devolutiva do Codex (05/10) — como ficou

Cópia literal em `levantamento/devolutiva-codex-3-fatia-1.md`. Os seis vereditos de desenho não mudaram. Dos oito achados da 2ª devolutiva, o Codex deu seis como fechados e o 2 como **não fechado** (virou os achados 3 e 4 abaixo); ele não executou nada, e os testes continuam por rodar na implementação. Cada achado novo foi conferido antes de ser aceito: **oito aceitos, e o 5 aceito em parte**. A configuração real da Vercel e do Supabase foi lida em 05/10 (só leitura, `06-References/basecrm-rito-publicacao/ler_config_publicacao.py` no cérebro), e o que ela mostrou refez a Task 13.

| # | Gravidade | Conferido | O que mudou |
|---|---|---|---|
| 1 | bloqueante | Sim, e pior do que o achado dizia: `commandForIgnoringBuildStep` nulo, sem `vercel.json`, `[vercel skip]` não documentado pela Vercel, as cinco variáveis de banco genéricas valendo para Preview **e** Production, e prévias públicas (`ssoProtection` nulo) | Nenhuma branch nova vai para o GitHub nesta entrega. O ensaio usa `feat/aurora-implantacao`, que já tem as variáveis do banco de teste, está no mesmo commit do `main` e é a prévia que `teste.crm.basea2.com` serve. A Task 13 ganhou um Step 0 de leitura do ambiente antes de qualquer push ou escrita. **Reforçado** na 4ª devolutiva (achado 1): a prova do banco da próxima prévia passou a vir antes do push. |
| 2 | bloqueante | Sim: `DB_URL` aceitava `SUPABASE_DB_URL`, e o runner repassa o ambiente inteiro | A URL do Postgres é constante (`127.0.0.1:54322`), sem variável de ambiente, conferida por `exigirPostgresLocal()` antes de qualquer sessão. |
| 3 | bloqueante | Sim: erro lançado na leitura depois de ligar caía em `main().catch` com o número ligado, e o desligar por id derrubaria uma ligação concorrente | `ligarComConferencia` (Task 10): qualquer falha em confirmar, inclusive erro lançado, desfaz a ligação **condicionada ao agente recém-ligado** e lê a linha de novo; se não confirmar o desfazer, devolve `incerto` e o script sai com código 3. Ao escrever, apareceu o caso irmão: a **chamada de ligar** que falha sem resposta do banco (a transação pode ter sido gravada antes de a resposta se perder). Ela também vira "ligação possível": linha conferida, e `desfeito`, `nao_ligou` ou `incerto` conforme o que a linha mostra. Nove testes. **Reforçado** na 4ª devolutiva (achado 10): a linha com outro agente vira `ligado_a_outro` (saída 4), e `ligado` exige a linha relida. |
| 4 | bloqueante | Sim: o `projectId` do alias era ignorado, só um domínio era lido, e nada amarrava domínio a banco. Lido em 05/10: os três domínios de produção no mesmo deployment `PROMOTED`, `rollingRelease` nulo | O ambiente sai do banco conectado, numa lista fechada (banco → projeto → ramo → todos os domínios); banco fora da lista é recusado. `lerPublicacaoNoAr` confere **todos** os domínios, o projeto, o ramo, o alvo e a promoção, e recusa rollout (`ROLLING`), transição e deployment mais novo não servido. A lista fechada é conferida contra os domínios do projeto na Vercel a cada leitura (`dominios_do_projeto_divergem`). O que a trava não enxerga é o endereço do webhook de cada número: por isso `--ligar` fica recusado em produção nesta fatia (ver "O que a prova afirma"). **Reforçado** na 4ª devolutiva (achado 12): o deployment entrou no evento, na prova e na conferência depois de ligar. |
| 5 | importante | Sim quanto à afirmação: "última resposta entregue" não é garantida, porque o insert do evento só avisa | **Aceito em parte.** A afirmação foi corrigida em todo lugar ("último evento registrado"), e o argumento de por que a prova do texto não depende de recência está em "O que a prova afirma". Ao escrever o argumento apareceu um caso que ele não cobria (evento de override com o mesmo sha do catálogo), fechado amarrando a **origem**: a função da prova devolve `prompt_source`, a de ligar exige a mesma origem e o `--prova` dá `DIVERGE` quando ela difere. A reconciliação com `conversation_messages` **não entrou**: voltaria a ler metadata de mensagem (2ª devolutiva, achado 1) e, como o `sent_at` é fixado antes do envio, nem detectaria toda lacuna. O que de fato depende de recência é o endereço do webhook do número, tratado como limite declarado, com `--ligar` recusado em produção e a resposta real nova exigida pelo rito. |
| 6 | importante | Sim: `AIReplySchema` é `.strict()`; o teste quebraria em `mock.calls[0]` | O teste espera 400 e zero chamadas ao executor para o corpo com `replyEvent`; um pedido válido prova que o executor não recebe `replyEvent`. |
| 7 | importante | Sim: `Promise.race` de 400 ms não prova espera | A sessão que segura a transação observa, com `pg_blocking_pids`, a outra sessão bloqueada por ela e lê em `pg_locks` **qual** trava está pendente (`ShareRowExclusiveLock` da tabela de prompts, `transactionid` do agente, `advisory` da criação) antes do `commit`. Vale para as três corridas. |
| 8 | importante | Sim: o G23 pede restauração testada, e a organização do Supabase está no plano Free, sem backup nem PITR (lido em 05/10) | G23 fica **PENDENTE** até o Step 2 da Task 13 registrar: dump de produção pela CLI, restauração numa stack local temporária com a mesma versão do Postgres, contagens conferidas, migration e volta aplicadas na cópia restaurada. **Reforçado** na 4ª devolutiva (achados 8 e 13): dump cifrado com retenção, e a escrita em produção só pelo `aplicar_migration.py`, com o OK registrado. |
| 9 | menor | Sim | UPDATE e DELETE em `ai_reply_events` entraram na matriz, para as seis identidades. |

Pontos frágeis (2.1 a 2.6): 2.1 (inversão de ordem de travas numa exclusão concorrente de organização) fica como está, porque um deadlock aborta uma das transações e a chamada que falha agora é conferida pela linha, nunca dada como ligada; 2.2 (visibilidade depois da espera) é o que os testes de corrida provam, agora com a espera observada; 2.3 (recusa conservadora de deployment pronto e não promovido) ganhou o nome `mais_novo_nao_servido`; 2.4 virou o achado 5; 2.5 (metadata legítimo) continua coberto pela leitura dos fluxos do n8n antes de publicar; 2.6 virou o achado 7.

Achado próprio, fora da devolutiva: o endereço do webhook de cada número é gravado na Evolution com a origem de quem clica em conectar ou no healthcheck, então pode ficar fora da lista fechada e ser servido por outro código. Está descrito em "O que a prova afirma", `--ligar` fica recusado em produção nesta fatia, e a fatia 2 só libera depois de ler esse endereço na Evolution.

**Fatos lidos em 05/10 que a SPEC passa a assumir:** `autoExposeSystemEnvs = true` (o `release_commit` existe); produção `main` em `dpl_HZm47C1VqGKSeUwLSsWAvpXhebUd` (`335f32b`, `PROMOTED`) nos três domínios; `teste.crm.basea2.com` na prévia de `feat/aurora-implantacao` do mesmo commit (`STAGED`, `target` nulo); os quatro domínios do projeto são exatamente a lista fechada; o filtro `branch` da lista de deployments é aplicado de verdade; `{"rollingRelease": null}` na configuração e no estado de rollout; organização do Supabase em plano Free, `backups = []` e `pitr_enabled = false` nos dois projetos.

## 4ª devolutiva do Codex (05/10) — como ficou

Cópia literal em `levantamento/devolutiva-codex-4-fatia-1.md`. Dos nove achados da 3ª devolutiva, o Codex deu seis como resolvidos no plano (2, 4, 5, 6, 7 e 9; quatro deles ainda por executar), o 8 com o rito adequado e o gate pendente, e o 1 e o 3 como **parciais**. Ele não executou nada. Os quatro achados novos foram conferidos antes de serem aceitos, e os quatro foram aceitos. A configuração real foi lida de novo em 05/10, ~20h (só leitura; `06-References/basecrm-rito-publicacao/ler_env_ensaio.py` no cérebro, que não imprime valor de variável).

| # | Gravidade | Conferido | O que mudou |
|---|---|---|---|
| 1 (da 3ª) | bloqueante, parcial | Sim: o Step 0 conferia os nomes das variáveis da branch, não os valores, e a prova de login só vinha depois do push | **A prova do banco da próxima prévia vem antes do push.** Lido em 05/10: as nove variáveis de Preview de `feat/aurora-implantacao` são de 19/09 23h42 e nunca foram alteradas, antes do deployment de 29/09 01h27 que `teste.crm.basea2.com` serve; as cinco de banco sobrescrevem as genéricas; a URL do Supabase e a chave anon da branch apontam para `zvwngsrflkicbbzfmrgy`. Junto com o login do domínio de teste, isso prova os valores com que a próxima prévia nasce (a Vercel resolve as variáveis na criação do deployment). As chaves secretas são "sensíveis" e a API não as devolve, mas o destino de todo acesso ao banco, no navegador e no servidor, é `NEXT_PUBLIC_SUPABASE_URL` (conferido no código), e uma chave de outro projeto recebe 401. Sem a prova, nada de push. |
| 3 (da 3ª) | bloqueante, parcial | Virou o achado 10 | Ver o 10. |
| 10 | bloqueante | Sim: `desfazerEConferir` só distinguia "a linha está com este agente"; com outro agente na linha, devolvia `desfeito` ou `nao_ligou`, e o script dizia que a ligação tinha sido desfeita | Estado novo `ligado_a_outro`, com o agente atual e saída 4 ("não rode `--desligar` sem falar com quem ligou"), nas duas rotas pedidas (ligação confirmada que não se confirma depois, e resposta perdida da chamada). Além do pedido, o caminho de sucesso também relê a linha: `ligado` só sai com a linha no agente desta chamada; trocada, vira `ligado_a_outro`; ilegível, `incerto`; vazia, `desfeito`. `--desligar` ganhou `--se-agente`, que a mensagem de `incerto` passa a recomendar. O teste que esperava `desfeito` com outro agente na linha passou a esperar `ligado_a_outro`; `migracaoAgentes` foi de 22 para 25 testes. |
| 11 | importante | Sim: o `prova_login.py` percorre três domínios fixos e só imprime | Passo explícito no Step 0, antes do push, com o código novo: `--url` e `--ref`, saída 1 sem pedido de login ou com banco diferente (o modo sem argumentos também passa a falhar). No Step 1, o deployment novo é provado pela URL dele antes do alias; saída diferente de 0 deixa o alias onde está e apaga a prévia nova. |
| 12 | importante | Sim. Das duas correções que o Codex ofereceu, entrou a de amarrar o evento ao deployment: `VERCEL_DEPLOYMENT_ID` está na lista oficial de variáveis de sistema da Vercel, disponível em tempo de execução, no mesmo formato `dpl_...` que a API de alias devolve | O evento ganhou `release_deployment`, a prova o devolve, a função de ligar recebe `p_deployment` (passa a ter 8 parâmetros) e recusa evento de outro deployment com `publicacao_diverge`; o `--prova` dá `PUBLICAÇÃO DIVERGE` no mesmo caso, e `ligarComConferencia` exige o mesmo deployment antes e depois. De quebra, a outra correção vem junto: um evento gravado **neste** banco pelo deployment que os domínios servem prova que esse deployment usa este banco, sem depender de grep de bundle. |
| 13 | importante | Sim | Pasta `C:\Users\PC Gamer\BaseCRM-dumps\<data>\`, fora do Git, do WorkSync e do OneDrive; cifrada pelo EFS (`cipher /e`) e com acesso só da conta do Junior (`icacls`), conferida com `cipher` depois do dump; nenhum agente lê o conteúdo; retenção de até 7 dias depois da produção conferida, ou decisão dele registrada; a cópia do container some com `npx supabase stop --no-backup`. |
| 8 (controle do agente) | importante | Sim: o G23 pede "agente sem poder destrutivo direto em prod", e o MCP do Supabase desta máquina tem escrita em todos os projetos | A escrita em produção é uma só, pelo `aplicar_migration.py`: lê o arquivo do disco, recusa sha256 diferente do que já rodou no teste e na cópia restaurada, recusa CRLF e versão já registrada, aplica pelo endpoint oficial de migration da API de gerenciamento (`POST /v1/projects/{ref}/database/migrations`, conferido na especificação pública, com `Idempotency-Key` igual ao sha256) e alinha a versão. O OK do Junior para essa escrita fica citado no registro. Cumprido por processo, não por permissão (achados fora do escopo, item 10). |

Pontos frágeis:
- **Inversão de travas numa exclusão concorrente:** fica. A chamada que falha agora tem a linha conferida, inclusive com `ligado_a_outro`.
- **`mais_novo_nao_servido`:** recusa conservadora, deliberada.
- **Falha transitória na leitura do override:** aceito. "Usaria agora" passou a dizer "com as leituras do banco funcionando", e a SPEC registra a assimetria: no caminho de hoje a falha cai calada no catálogo; com agente, vira `agent_unavailable`. Sem reconciliar mensagens.
- **O processo morrer entre a ligação e a conferência:** continua declarado; o `--prova` seguinte mostra o número como `ja_ligada`.
- **n8n, corridas e G23:** continuam gates de execução, sem resultado ainda.

**Fatos lidos em 05/10, ~20h, que a SPEC passa a assumir:**
- as variáveis de Preview de `feat/aurora-implantacao` (nove) foram criadas em 19/09 23h42 e nunca alteradas;
- as duas chaves secretas são do tipo `sensitive`, e a URL e a chave anon são `encrypted`, legíveis pela API;
- a URL do Supabase e o `ref` da chave anon da branch são `zvwngsrflkicbbzfmrgy`;
- `VERCEL_DEPLOYMENT_ID` está documentada como disponível no build e em tempo de execução;
- o MCP do Supabase roda com token de conta, sem `--read-only` e sem projeto fixo;
- a API de gerenciamento documenta `POST /v1/projects/{ref}/database/migrations` com `Idempotency-Key`, e `GET` da mesma rota devolvendo `version` e `name`.
