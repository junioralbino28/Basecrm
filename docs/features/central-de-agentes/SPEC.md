# SPEC — Central de Agentes, fase 1: o editor do agente

> Status: **APROVADA pelo Junior (fase, critério e as 2 decisões, 29/09)**. Revisão adversarial interna integrada em 29/09 (`levantamento/revisao-adversarial-fatia-1.md`). Revisão técnica do Codex integrada em 29/09: 1ª rodada com 21 itens e 2ª devolutiva com 8 achados (seções no fim; a 2ª reabriu os achados 10, 13 e 15 e o estado final é o dela). Implementação começa pela fatia 1, em branch, sem tocar produção sem OK.
> Data: 29/09/2026. Base de leitura: worktree `feat/central-agentes`, HEAD `335f32b` (= produção).
> Levantamentos com arquivo e linha: `levantamento/mapa-A-prompt.md`, `mapa-B-comportamento.md`, `mapa-C-modelo-telas.md`.
> Análise da SquadOS que originou a proposta: https://claude.ai/artifact/DsFmx2E4sEfzWgtiGsNYrd (cópia no cérebro, `06-References/central-de-agentes-2026-09-29/`).
> Depois da aprovação, cada fatia ganha um `PLAN-fatia-N.md` técnico próprio.

## Para o Junior, em uma página

- **O agente vira um cadastro do cliente**, com nome, prompt, ajustes e modelo, ligado aos números de WhatsApp. Um número sem agente continua funcionando exatamente como hoje.
- **Aurora e Julia passam para o cadastro sem mudar uma vírgula.** A partir desta entrega, cada resposta real registra a impressão digital do prompt que usou. Antes de ligar cada uma, um script compara o prompt do cadastro com a impressão digital que a produção registrou na última resposta daquele número; se não bater, não liga. Desligar o cadastro volta tudo ao que era, com um clique.
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
| Prova da migração | Toda resposta nativa passa a gravar `prompt_sha256` no metadata (sha256 do texto do prompt usado, antes de trocar as variáveis) e, **depois de entregue**, um **evento de prova** em `ai_reply_events`: sha, chave usada, agente e versão (se houver), commit da publicação (`VERCEL_GIT_COMMIT_SHA`) e hora em que a Evolution aceitou a última parte. Só o caminho nativo escreve a tabela, com a chave de serviço; a prova lê só ela. O script só cria o agente e liga o número quando o sha que ele calcula bate com o do último evento do caminho de hoje daquele número, com a mesma chave e a mesma publicação. Erro de leitura do banco aborta o script em vez de cair no catálogo | Sem isso, a prova compara o script com ele mesmo, e um catálogo diferente na cópia local passaria (revisão adversarial, B1). Ler o metadata das mensagens deixava uma mensagem manual (`send_external: false`, gravada como entregue sem mandar nada) forjar a prova com o sha que quisesse (2ª devolutiva, achado 1); e o `sent_at` é fixado antes do envio, então envios simultâneos podiam terminar em ordem inversa (achado 5). |
| Rastro protegido | As rotas do n8n e manual descartam do metadata que recebem as chaves de rastro (`native_ai`, `prompt_source`, `prompt_sha256`, `agent_id`, `agent_version`, `ai_timing`). A prova da migração não lê metadata de mensagem nenhuma | Senão uma automação externa ou alguém com `conversations.reply` forja a leitura humana da conversa e, depois, os números da fatia 6. |
| Publicação no ar | O script lê na API da Vercel qual deployment o domínio serve (`/v4/aliases/{domínio}` → `/v13/deployments/{id}` → `meta.githubCommitSha`) e a lista de deployments do ramo. Só segue se esse commit for o da cópia e se não houver deployment mais novo do ramo construindo (transição) ou pronto sem ser o servido (rollback). Confere antes da prova, antes de ligar, dentro da função do banco (o evento tem que ter vindo desse commit) e de novo depois de ligar; se mudou, desliga na hora | `HEAD == origin/<ramo>` diz o que FOI publicado, não o que está no ar: depois de um rollback o ramo continua em A e o domínio responde com B (2ª devolutiva, achado 2). |
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
  - `central_agentes_ultima_resposta_nativa(p_connection_id)` devolve sha, chave, commit da publicação e hora da entrega do último evento do caminho de hoje (`agent_id` nulo) do número, pela hora da entrega;
  - `central_agentes_ligar_conexao(..., p_publicacao)` liga o número numa transação só, com a tabela de prompts travada contra escrita (`lock table ... in share row exclusive mode`, porque `for share` protege a linha que existe, não a ausência dela), o número travado (`for update`) e o agente travado (`for share`), e confere a chave efetiva pela mesma regra do código (2ª devolutiva, achados 4 e 7).
- O gatilho da conexão cuida só de "agente sem versão publicada" (P0001). Agente de outra organização é recusado pela FK composta (23503), e assim o teste local prova a própria FK (revisão do Codex, achado 14).

## Runtime (fatia 1)

1. O portão da IA (`loadFreshConversationAIGate`) passa a trazer `ai_agent_id`. Ele é lido depois do debounce, pelo webhook (`route.ts:137`) e de novo dentro do gerador (`aiReply.ts:399`). A carga inicial do webhook, anterior ao debounce, não precisa do agente. `undefined` conta como nulo. Se for nulo, **o caminho atual não muda em nada**.
2. Se houver agente, o gerador carrega a versão publicada logo depois do portão (agente e versão da mesma organização, duas leituras simples). O conteúdo do prompt vem de `version.prompt`, e não de `getResolvedPrompt`. O mesmo texto vale para as três decisões que dependem dele: `closing_unsupported`, o catálogo de etiquetas e o render. As 12 variáveis, o histórico, `renderPromptTemplate`, o esquema de saída e a medição continuam os mesmos.
3. Os ajustes **não mudam de lugar nesta fatia**: agrupar, dividir, memória, mídia, cutucada, encerramento, celular, nome e reunião continuam lidos da conexão e das constantes, como hoje.
4. O modelo vem de `version.model || <a expressão de hoje, intacta>` (`orgSettings.ai_model || AI_DEFAULT_MODELS[provider] || AI_DEFAULT_MODELS.google`). Na v1, `model` é nulo, logo o de hoje. Provedor e chave continuam os da organização.
5. O webhook passa a chamar o gerador também quando `aiPromptKey` é inválida mas o número tem agente. Se o agente sumir entre as duas leituras, o gerador recebe a chave nula e responde `missing_prompt`, nunca o prompt padrão.
6. O metadata ganha `prompt_sha256` em toda resposta nativa e `agent_id`/`agent_version` só em número com agente. `prompt_source` continua `override` ou `default`, e ganha `agent`. O webhook manda também `replyEvent` (sha, chave, origem, agente e versão); `executeConversationAIReply` grava o evento em `ai_reply_events` **depois** de a última parte ser aceita pela Evolution, com a hora lida ali e o commit de `VERCEL_GIT_COMMIT_SHA`. Falha ao gravar o evento só avisa, nunca derruba nem marca a resposta. A rota do n8n e a cutucada não mandam `replyEvent` e não gravam evento.
7. **Exceção declarada ao "número sem agente continua igual"** (revisão do Codex, achado 9; 2ª devolutiva, achado 1): as rotas do n8n e manual passam a descartar do metadata que recebem as seis chaves de rastro, em qualquer número. No código, ninguém lê essas chaves em mensagem do n8n ou manual, e a tela não manda nenhuma delas (conferido em 29/09: só o webhook as escreve). O único leitor fora do repositório é a consulta de tempo de resposta do cérebro, que mede resposta nativa. Antes de publicar, conferir os fluxos do n8n dos números com `webhookUrl`.

**Prova de equivalência** (teste obrigatório): com as mesmas entradas e o relógio congelado (a Aurora recebe `{{currentDateTime}}`, que vem de `new Date()` em `aiReply.ts:456`), o prompt renderizado pelo caminho antigo e o do agente com v1 migrada são strings idênticas. Isso vale para a Aurora, para a Julia, para um número com override em `ai_prompt_templates` e para um número sem nada. Hoje só o texto da Aurora tem testes de regressão; esta fatia cria a rede da Julia também.

## Migração da Aurora e da Julia (fatia 1)

Script `scripts/central-agentes/migrar-agentes.ts`, dentro do repositório, nunca commitado com segredo. Tem quatro modos:

- `--prova`: só leitura.
  - Para cada número com IA ligada ou chave de prompt definida, calcula o conteúdo efetivo de hoje com a mesma regra do runtime. A leitura é estrita: erro de banco aborta. As conexões são lidas em páginas, porque o PostgREST corta leitura grande sem erro (revisão do Codex, achado 18).
  - Compara o sha256 calculado com o do **evento de prova** da última resposta **entregue** pelo caminho de hoje daquele número, e confere junto a chave e a publicação. O resultado é uma de cinco situações:
    - `CONFERE`: mesmo sha, mesma chave, mesma publicação;
    - `DIVERGE`: mesma chave e publicação, sha diferente (o texto mudou);
    - `CHAVE DIVERGE`: o evento respondeu com outra chave (a configuração do número mudou depois da resposta);
    - `PUBLICAÇÃO DIVERGE`: o evento veio de outra publicação (deploy ou rollback depois da resposta), ou sem commit;
    - `SEM RESPOSTA AINDA`: nenhum evento do caminho de hoje.
  - Quem escolhe esse evento é a função do banco `central_agentes_ultima_resposta_nativa`, só para `service_role`: o mais recente em `ai_reply_events` com `agent_id` nulo, pela hora da entrega (`delivered_at`, lida depois de a Evolution aceitar a última parte), em ordem determinística. Ela não lê `conversation_messages`: mensagem manual ou do n8n não entra, com o metadata que tiver (2ª devolutiva, achado 1); resposta dada por um agente, num número ligado e depois desligado, também não prova o caminho de hoje. Um limite de conversas ou de mensagens no script podia deixar a resposta mais nova de fora e usar uma antiga como prova (revisão do Codex, achados 11 e 12).
  - Número com chave de prompt inválida fica de fora (`CHAVE INVÁLIDA`): hoje ele responde `missing_prompt`, e virar agente faria ele passar a responder.
  - Agrupa num agente os números da mesma organização com o mesmo conteúdo, imprime o relatório e não grava nada.
- `--criar --org <id>`: organização obrigatória. Cria o agente e a v1 (`source = 'migration'`, `settings = {}`, `model = null`) só para grupos em que todos os números estão em `CONFERE`. Não liga número nenhum. É idempotente: o mesmo sha na mesma organização não cria duplicado.
- `--ligar <connectionId>`: acha no banco o agente de migração com o sha de hoje e pede à função `central_agentes_ligar_conexao` que ligue, passando o commit que o domínio serve. A função trava a tabela de prompts contra escrita, a linha do número e a do agente e, na mesma transação, confere de novo:
  - a chave bruta da conexão e a efetiva (a aparada, ou a padrão quando vazia, como `resolveConversationAIAgentConfig`), para um chamador privilegiado não satisfazer a prova com uma chave que não é a do número (2ª devolutiva, achado 7);
  - o override ativo, inclusive a **ausência** dele: a trava da tabela espera uma publicação de override em andamento terminar e a enxerga (2ª devolutiva, achado 4);
  - a versão publicada do agente, com a linha dele travada;
  - a última resposta da produção: mesma publicação, mesma chave efetiva, mesmo sha.

  Qualquer mudança no caminho recusa, com o motivo (revisão do Codex, achado 13). Depois de ligar, o script lê a publicação de novo; se ela mudou, desliga na hora e sai com erro.
- `--desligar <connectionId>`: volta `ai_agent_id` para nulo e confirma a linha. Número inexistente é avisado, nunca dado como desligado (achado 19).
- **Trava de banco:** toda escrita exige `--confirmar-banco <ref>` igual à referência que o script imprime. O `origin` do agente registra o commit do catálogo lido, para rastreio.
- **Trava da versão publicada:** `--prova`, `--criar` e `--ligar` exigem `--ramo-publicado <ramo>`: `main` em produção, a branch da prévia no teste. Depois de um `git fetch`, o script só segue se:
  - a cópia estiver exatamente no commit publicado (`HEAD == origin/<ramo>`);
  - os arquivos que decidem o prompt (`lib/ai/prompts/`, `lib/agents/`, `lib/conversations/aiAgentConfig.ts`) não tiverem mudança local.

  Por quê (revisão do Codex, achado 10): comparar só o sha e a idade da resposta deixava passar uma publicação nova feita depois da última resposta. Uma cópia ainda no texto antigo calcularia o texto antigo e daria `CONFERE`.
- **Trava da publicação no ar** (2ª devolutiva, achado 2): os mesmos três modos exigem `--dominio <host>` (`crm.basea2.com` em produção, `teste.crm.basea2.com` no teste) e leem na API da Vercel qual deployment o domínio serve e o commit dele. O script só segue se:
  - esse commit for o `HEAD` da cópia;
  - o deployment for do ramo e estiver `READY`;
  - não houver deployment mais novo do ramo construindo (transição) nem pronto sem ser o servido (rollback).

  A premissa antiga ("se a publicação estiver atrás do ramo, a prova dá `DIVERGE`") era falsa num rollback sem resposta nova: a última resposta tinha vindo do commit A, o ramo e o HEAD continuavam em A, e o domínio já respondia com B. O evento de prova agora carrega o commit que respondeu, e a função do banco exige que ele seja o que o script conferiu no domínio.

Ordem (revista em 29/09, ao escrever o PLAN):
1. Banco de teste primeiro (`zvwngsrflkicbbzfmrgy`), nesta ordem:
   - a migration;
   - as variáveis de ambiente da prévia **restritas à branch** `feat/central-agentes`, apontando para o banco de teste. Sem elas, a prévia de uma branch nova recebe as variáveis genéricas de Preview, que apontam para o banco de PRODUÇÃO (aprendizado de 19/09). Por isso o primeiro push leva `[vercel skip]`; as variáveis são criadas depois que a branch existe no GitHub, e só então um commit vazio dispara o build;
   - a prova de qual banco a prévia usa, pelo pedido real de login, antes de apontar `teste.crm.basea2.com` para ela;
   - "Enable access to System Environment Variables" marcado no projeto da Vercel (sem isso o evento sai sem commit e a prova falha fechada);
   - uma resposta real do ensaio, que grava `prompt_sha256` e um evento com `release_commit` igual ao sha do deployment da prévia;
   - `--prova`, `--criar`, `--ligar` e `--desligar` num número de teste, com `--ramo-publicado feat/central-agentes --dominio teste.crm.basea2.com`;
   - um commit novo na branch, para ver o `--ligar` recusar com `em_transicao` enquanto a prévia constrói e com `rollback` enquanto o alias ainda aponta para a antiga.

   A resposta seguinte do ensaio tem que sair com `agent_version = 1` e o mesmo `prompt_sha256`.
2. Produção, com o OK do Junior:
   - antes de publicar, ver quais números têm automação n8n (`config.webhookUrl`) e se os fluxos deles mandam alguma das seis chaves de rastro no metadata do `/ai-reply`, que passam a ser descartadas (só leitura, com o OK dele);
   - **a migration ANTES do deploy.** A leitura da conexão passa a pedir `ai_agent_id`; se o código chegar antes da coluna, a leitura falha e a IA para em todos os clientes;
   - depois o deploy, que fica **adormecido**: nenhum número ligado, e as únicas mudanças são o `prompt_sha256` novo no metadata das respostas nativas, o evento de prova gravado depois de cada entrega e a limpeza das chaves de rastro nas rotas do n8n e manual;
   - por fim, depois de uma resposta real de cada uma, o `--prova`, só leitura, com `--ramo-publicado main --dominio crm.basea2.com`.
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
  - toda resposta nativa **entregue** grava um evento em `ai_reply_events`, depois do último envio, com a hora da entrega e o commit da publicação; entrega que falhou não grava; a rota do n8n e a cutucada não gravam; falha ao gravar só avisa;
  - a FK composta recusa ligar um número a agente de outro cliente (23503); agente sem versão publicada, o gatilho recusa (P0001);
  - evento de uma organização apontando para número ou conversa de outra é recusado (23503); sha fora do formato e agente sem versão são recusados (23514);
  - apagar agente com número ligado é recusado; sem número ligado, apaga; apagar a organização inteira continua funcionando e leva os eventos junto;
  - `update` numa versão é recusado; apagar o usuário que publicou uma versão não trava (o autor vira nulo e o resto não muda);
  - matriz de acesso do G2, com chamada de verdade (revisão do Codex, achado 15; 2ª devolutiva, achado 6):
    - identidades: anônimo, `agency_admin`, `agency_staff`, o legado `admin`, cliente A e cliente B;
    - operações: SELECT, INSERT, UPDATE e DELETE nas duas tabelas do agente, contra a organização A **e** a B; SELECT e INSERT em `ai_reply_events`; e as três funções;
    - resultado: `agency_admin` e `admin` leem as duas organizações; `agency_staff` e os clientes leem vazio sem erro (se a policy passasse a `is_agency_role()`, o staff leria e o teste cai); ninguém escreve direto; ninguém que não seja `service_role` lê ou escreve o evento; só `service_role` chama as funções;
  - chave de prompt inválida e sem agente responde `missing_prompt`, nunca o prompt padrão;
  - `agent_unavailable` registrado como falha de configuração;
  - as rotas do n8n e manual descartam as chaves de rastro do metadata que recebem, inclusive no envio local (`send_external: false`); a rota do n8n não manda evento nem quando o corpo tenta;
  - migração:
    - `--criar` e `--ligar` recusam sem `CONFERE`;
    - erro de leitura aborta;
    - `--criar` sem `--org` é recusado;
    - fora do commit publicado ou com mudança local nos arquivos do prompt, o script recusa;
    - sem `--dominio`, com o domínio servindo outro commit, com um deployment mais novo do ramo construindo (`em_transicao`) ou pronto sem ser o servido (`rollback`), o script recusa; depois de ligar, se a publicação mudou, desliga na hora;
    - a função do banco lê só o evento, pela hora da entrega, só do caminho de hoje; uma mensagem manual com o rastro forjado no metadata não entra;
    - ligar recusa, com o motivo, se a chave bruta, a chave efetiva, o override, a versão, a publicação ou a resposta divergem;
    - corrida do override: com uma escrita em `ai_prompt_templates` aberta em outra sessão, a ligação espera e, ao fim, recusa com `override_mudou` (duas sessões de verdade no banco local);
    - corrida do ponteiro: com a publicação de outra versão aberta em outra sessão, a ligação espera e recusa com `versao_publicada_diverge`;
    - criação concorrente: duas chamadas simultâneas do mesmo (organização, sha) voltam o mesmo agente, sem 23505;
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
- **G23:** migration só aditiva, sem reescrever `config` de conexão (revisão do Codex, achado 20). Antes da escrita em produção:
  - a data do último backup e o estado do PITR registrados;
  - a volta (`volta-fatia-1.sql`) provada no banco local: aplicar, voltar, aplicar;
  - o ensaio completo no banco de teste.
- **G24:** o rastro (versão e sha em cada resposta) é registro, não detecção. Esta fatia não cria alerta, então o G24 fica **NÃO-TESTADO** (revisão do Codex, achado 21).
- **G25:** nenhum default de plataforma novo nesta fatia (N/A).

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
| A prova só vale para a publicação que está no ar | commit no evento + leitura do domínio na Vercel antes, dentro e depois de ligar | Tasks 2, 10 e 11 |
| Rastro nativo não é forjado pelas rotas do n8n e manual | limpeza nas duas rotas | Task 9 |

## Achados fora do escopo, registrados para não se perderem

1. `AIConfigSection.tsx:141` mostra provedor, modelo e chave para o admin do cliente, e o servidor recusa (`settings/ai/route.ts:115-117`). É correção pequena e independente; pode entrar antes da fatia 1.
2. O `GET /api/settings/ai` responde `ai_enabled = true` quando a organização não tem linha em `organization_settings`, e o motor trata a ausência como desligado (`aiReply.ts:417`). A tela pode mostrar "ligada" com a IA parada.
3. Os dois `GET` de `ai-prompts` aceitam o admin do cliente, que lê prompt e versões pela API mesmo sem botão na tela.
4. As policies de `ai_prompt_templates` usam o papel legado `'admin'` (`schema_init.sql:580-610`). Conferir se migrations posteriores as reescreveram antes de confiar nelas.
5. O tipo `ChannelConnectionConfig` (`lib/channels/types.ts:9-16`) não lista nenhum campo de IA.
6. ~~A policy de `channel_connections` é de 10/03 e usa o papel legado.~~ Corrigido na revisão: as duas policies de 10/03 foram removidas em `20260630000000_m6_security_hardening.sql:169-170`. Hoje `authenticated` não lê nem escreve a tabela (sem policy, a RLS nega tudo) e todo acesso passa pelas rotas, com a chave de serviço. Para a Central, isso quer dizer que a tela nunca lê `channel_connections` direto do navegador.
7. `boards.agent_*` (nome e comportamento por funil) não alimenta o atendimento. Fica para a fase 3 ("agente por funil"), que decide se unifica.

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
| 7 | importante | A Task 13 tem os comandos próprios desta entrega; o rito da branch da Aurora não é seguido ao pé da letra. A prévia nova só é construída depois de ganhar as variáveis da própria branch, porque sem elas usaria o banco de produção. |
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
| 20 | importante | G23: backup e PITR registrados antes da escrita, e a volta provada no banco local. |
| 21 | menor | As invariantes foram para o G20, com tabela e testes negativos. O G24 fica NÃO-TESTADO e o G25 é N/A nesta fatia. |

## 2ª devolutiva do Codex (29/09) — como ficou

Cópia literal em `levantamento/devolutiva-codex-2-fatia-1.md`. Os seis vereditos de desenho não mudaram. Cada achado foi conferido no código (`335f32b`) antes de ser aceito; todos os oito foram aceitos.

| # | Gravidade | Conferido | O que mudou |
|---|---|---|---|
| 1 | bloqueante | Sim: `MessageSchema` aceita `metadata` livre com `conversations.reply`; com `send_external: false` o `deliver()` devolve `status: 'sent'` sem mandar nada; o dispatcher preserva as chaves recebidas | A prova deixou de ler metadata de mensagem. Nasceu `ai_reply_events`, gravada só pelo caminho nativo com a chave de serviço, depois da entrega; a função da prova lê só ela. A rota manual também limpa as seis chaves. Teste local com a mensagem manual forjada; teste da rota manual com `send_external: false`. |
| 2 | bloqueante | Sim: `HEAD == origin/<ramo>` não diz o que o domínio serve | O evento carrega `release_commit` (`VERCEL_GIT_COMMIT_SHA`). O script exige `--dominio`, lê na API da Vercel o deployment ativo do domínio e a lista do ramo, recusa transição e rollback, e exige commit igual ao HEAD; a função do banco exige que o evento venha desse commit; depois de ligar, confere de novo e desliga se mudou. |
| 3 | importante | Sim: a FK de `conversation_threads.channel_connection_id` é simples (`20260310020000`) | O evento tem FKs compostas `(organization_id, channel_connection_id)` e `(organization_id, thread_id)`; evento cruzado é 23503. Teste local com os dois cruzamentos. |
| 4 | importante | Sim: `IF EXISTS` não protege a ausência de linha; o publicador atual faz UPDATE e INSERT separados; o ponteiro era lido sem lock | `lock table ai_prompt_templates in share row exclusive mode` como primeiro comando da ligação (espera escrita em andamento e a enxerga) e `for share` na linha do agente, em dois passos. Duas corridas provadas no banco local com uma sessão `pg` segurando a transação e o `rpc` esperando. Congelamento operacional de override e catálogo durante a entrega (Task 13). |
| 5 | importante | Sim: `sent_at` e `created_at` são fixados antes dos envios (`aiReply.ts:724,951-952`) | O evento grava `delivered_at` lido depois de a última parte ser aceita; a prova ordena por ele. |
| 6 | importante | Sim: `is_agency_role()` inclui `agency_staff`; a matriz só tinha `agency_admin` e dois `clinic_admin`, e escrevia só contra A | Matriz com seis identidades (anônimo, `agency_admin`, `agency_staff`, `admin` legado, cliente A, cliente B), CRUD contra A e B, a agência lendo os ids das duas organizações, o staff lendo vazio, e `ai_reply_events` negada a todos. |
| 7 | menor | Sim: a RPC confiava em `p_prompt_key` | A função calcula a chave efetiva no SQL (aparada, ou a padrão quando vazia) e recusa com `chave_efetiva_diverge`; o teste do texto trava a chave padrão contra `DEFAULT_CONVERSATION_AI_PROMPT_KEY`; teste local negativo. |
| 8 | menor | Sim: duas buscas vazias → dois INSERT → 23505 | `pg_advisory_xact_lock(hashtextextended(org || ':' || sha, 0))` antes da busca; duas sessões simultâneas no banco local voltam o mesmo agente. |

Assumido e dito: a chave efetiva no SQL espelha `resolveConversationAIAgentConfig` só no corte (`btrim`) e no padrão; a validade da chave no catálogo continua com o script. Espaço fora do comum no começo ou no fim da chave faz banco e código divergirem, e aí a ligação é recusada, nunca feita errada. O `release_commit` depende de "Enable access to System Environment Variables" na Vercel; sem ele a prova falha fechada (`PUBLICAÇÃO DIVERGE` em todo número), e a Task 13 confere isso antes do ensaio.
