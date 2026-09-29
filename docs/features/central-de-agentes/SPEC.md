# SPEC — Central de Agentes, fase 1: o editor do agente

> Status: **PROPOSTA para revisão (Codex) e aprovação do Junior.** Não implementar antes da aprovação.
> Data: 29/09/2026. Base de leitura: worktree `feat/central-agentes`, HEAD `335f32b` (= produção).
> Levantamentos com arquivo e linha: `levantamento/mapa-A-prompt.md`, `mapa-B-comportamento.md`, `mapa-C-modelo-telas.md`.
> Análise da SquadOS que originou a proposta: https://claude.ai/artifact/DsFmx2E4sEfzWgtiGsNYrd (cópia no cérebro, `06-References/central-de-agentes-2026-09-29/`).
> Depois da aprovação, cada fatia ganha um `PLAN-fatia-N.md` técnico próprio.

## Para o Junior, em uma página

- **O agente vira um cadastro do cliente**, com nome, prompt, ajustes e modelo, ligado aos números de WhatsApp. Um número sem agente continua funcionando exatamente como hoje.
- **Aurora e Julia passam para o cadastro sem mudar uma vírgula.** Antes de ligar cada uma, um script compara o prompt de hoje com o do cadastro, letra por letra. Desligar o cadastro volta tudo ao que era, com um clique.
- **Rascunho e publicado ficam separados.** Você edita, testa numa conversa simulada que não manda nada no WhatsApp e publica. A próxima resposta real já sai com a versão nova, e cada resposta registra qual versão respondeu.
- **Toda publicação vira uma versão** com autor e data; comparar e voltar uma versão é um clique.
- **Seis entregas, nesta ordem:** (1) o cadastro e a migração da Aurora e da Julia, sem tela; (2) o editor com versões e Publicar; (3) o teste sem enviar. Com as três, o critério de pronto que você aprovou está cumprido. Depois: (4) os ajustes escondidos na tela, escritos como frase; (5) o modelo por agente com tempo e custo de cada resposta; (6) a tela da agência com todos os agentes.
- **Preciso de você em duas decisões pequenas**, no fim do documento.

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
| Ligar número a agente | Coluna `channel_connections.ai_agent_id`, nula por padrão, com FK composta `(organization_id, ai_agent_id)` → `ai_agents(organization_id, id)` | Nula = caminho de hoje, byte a byte. A FK composta impede ligar o número de um cliente ao agente de outro. |
| O que a migração muda na conexão | Só `ai_agent_id`. O `config` da conexão não é tocado | Desligar (`ai_agent_id = null`) volta ao comportamento anterior sem restaurar nada. |
| Rascunho | `ai_agents.draft` (jsonb: `prompt`, `settings`, `model`) com `draft_updated_at` e `draft_updated_by` | Editar e testar sem tocar o atendimento real. |
| Publicar e Restaurar | Função SQL única `publish_ai_agent_version` (`security definer`, `search_path=''`, só agência), atômica, com trava otimista pela versão esperada (conflito vira 409). Restaurar = publicar o conteúdo da versão escolhida como versão nova | Histórico linear e auditável, sem a corrida do publicar atual. |
| Agente ligado sem versão publicada | Ligar exige versão publicada. Se mesmo assim faltar em tempo de execução, a resposta falha com motivo `agent_unavailable`, como já acontece com `missing_prompt` | Nunca responder em silêncio com outro prompt. |
| Ajustes do agente × do número | Do **agente** (versionados): nome, prompt, modelo, agrupar, dividir, memória, mídia, cutucada, encerramento, quem conduz e formato da reunião, pausar quando alguém responde pelo celular. Do **número** (ficam na conexão): IA ligada no número, assinatura do atendente, espaçamento da régua, agenda, URL, chave e modo de envio da Evolution | O primeiro grupo é como a IA se comporta; o segundo é do aparelho, da régua ou da operação. |
| Leitura dos ajustes do agente | Na fatia 1 o agente assume **só o prompt** (e o modelo, nulo na v1); os ajustes continuam sendo lidos de onde são hoje. Na fatia 4, com o número ligado, cada ajuste segue a ordem: valor publicado no agente → valor da conexão (o de hoje) → constante do código. A v1 nasce com `settings = {}` | Ler os ajustes do agente muda 10 pontos do webhook e o executor da cutucada (ver fatia 4). Se a migração gravasse os valores na fatia 1 e eles só fossem lidos na fatia 4, uma mudança feita no número nesse meio-tempo se perderia na virada. Com a v1 vazia, a virada da fatia 4 não muda nada até alguém publicar um valor. |
| Rotas antigas depois de ligar | Fatia 1: a Central de I.A troca o editor do WhatsApp por um aviso com link para a Central de Agentes nos clientes com agente ligado. Fatia 4: o PATCH da conexão recusa (409, "configurado no agente X") os campos do primeiro grupo num número ligado | Mudança que não tem efeito é pior que mudança recusada. |
| Catálogo no código | Os textos de `catalog.ts` viram "modelo de origem" (base da biblioteca da fase 2) e continuam valendo para números sem agente | Depois da migração, editar o catálogo não muda Aurora nem Julia. O `describe` de `catalog.aurora.test.ts` passa a dizer isso. |
| Rastro | Toda resposta grava no metadata `agent_id`, `agent_version` e `prompt_source` (`agent`, `override` ou `catalog`), junto do `ai_timing` | Prova que "a próxima resposta já saiu com a mudança". |
| Quem mexe | Só `agency_admin` (e o legado `admin`) cria, edita, testa, publica e liga | Decisões de 30/07 e 17/09. `agency_staff` e o cliente não entram na fase 1. |

## Modelo de dados (fatia 1)

```sql
ai_agents (
  id uuid pk, organization_id uuid not null fk organizations on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  published_version_id uuid null,   -- fk para ai_agent_versions(id), deferrable
  draft jsonb not null default '{}', draft_updated_at timestamptz, draft_updated_by uuid fk profiles,
  origin jsonb not null default '{}', -- ex.: {"kind":"migration","promptKey":"...","promptSource":"catalog","sha256":"..."}
  created_by uuid fk profiles, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (organization_id, id)
)
ai_agent_versions (
  id uuid pk, agent_id uuid not null, organization_id uuid not null,
  version int not null check (version >= 1),
  prompt text not null check (char_length(prompt) between 1 and 50000),
  settings jsonb not null default '{}', model text null,
  source text not null check (source in ('migration','publish','restore')),
  restored_from int null, note text null check (char_length(note) <= 200),
  published_by uuid fk profiles, published_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references ai_agents (organization_id, id) on delete cascade,
  unique (agent_id, version)
)
channel_connections + ai_agent_id uuid null,
  foreign key (organization_id, ai_agent_id) references ai_agents (organization_id, id) on delete set null (ai_agent_id)
```

- **RLS ligada nas duas tabelas.** `select` só para quem é agência (`is_agency_admin_role()`). Nenhuma policy de insert, update ou delete para `authenticated`: escrita só pelas funções `security definer`.
- **GRANT explícito**: `select` para `authenticated` (a RLS filtra), `all` para `service_role`, `execute` das funções para `authenticated`. A função confere o papel por dentro. RLS sozinha não concede nada; sem GRANT, a tela quebra com `permission denied`.
- `ai_agent_versions` é imutável: nenhuma função atualiza versão publicada.

## Runtime (fatia 1)

1. As leituras da conexão (`loadFreshConversationAIGate`, a carga inicial do webhook) passam a trazer `ai_agent_id`. Se ele for nulo, **o caminho atual não muda em nada**.
2. Se houver agente, uma leitura carrega a versão publicada (agente e versão da mesma organização). O conteúdo do prompt vem de `version.prompt`, e não de `getResolvedPrompt`. As 12 variáveis, o histórico, `renderPromptTemplate`, o esquema de saída e a medição continuam os mesmos.
3. Os ajustes **não mudam de lugar nesta fatia**: agrupar, dividir, memória, mídia, cutucada, encerramento, celular, nome e reunião continuam lidos da conexão e das constantes, como hoje.
4. O modelo vem de `version.model ?? organization_settings.ai_model ?? AI_DEFAULT_MODELS[provider]`. Na v1, `model` é nulo, logo o de hoje. Provedor e chave continuam os da organização.
5. O metadata da resposta ganha `agent_id`, `agent_version` e `prompt_source`.

**Prova de equivalência** (teste obrigatório): com as mesmas entradas, o prompt renderizado pelo caminho antigo e o do agente com v1 migrada são strings idênticas. Isso vale para a Aurora, para a Julia, para um número com override em `ai_prompt_templates` e para um número sem nada. Hoje só o texto da Aurora tem testes de regressão; esta fatia cria a rede da Julia também.

## Migração da Aurora e da Julia (fatia 1)

Script `scripts/central-agentes/migrar-agentes.ts`, dentro do repositório, nunca commitado com segredo. Tem quatro modos:

- `--prova`: só leitura. Para cada número com IA ligada ou chave de prompt definida, calcula o conteúdo efetivo de hoje (o mesmo que `getResolvedPrompt` devolve) e o sha256. Agrupa num agente os números da mesma organização com o mesmo conteúdo. Imprime o relatório e não grava nada.
- `--criar`: cria os agentes e a v1 (`source = 'migration'`, `settings = {}`, `model = null`) a partir do relatório, sem ligar nenhum número.
- `--ligar <connectionId>`: refaz a prova daquele número no momento e só liga se o sha256 bater.
- `--desligar <connectionId>`: volta `ai_agent_id` para nulo.

Ordem: banco de teste primeiro (`zvwngsrflkicbbzfmrgy`); depois, em produção e com o OK do Junior, a migration (tabelas vazias, nada muda), `--prova`, `--criar`, `--ligar` na Aurora, observação das próximas respostas reais (`agent_version = 1`, sem falha, tempo normal) e, por fim, a Julia.

## Fatia 2 — editor com versões e Publicar

- **Rotas de tela:**
  - `/platform/tenants/[tenantId]/agents` (lista do cliente) e `/platform/tenants/[tenantId]/agents/[agentId]` (editor). As duas entram em `TENANT_SCOPED_BASE_ROUTES`; o teste que lê o disco trava isso.
  - Item "Agentes" em `getTenantWorkspaceNav`.
- **Editor, na seção Prompt:** mostra a leitura formatada e troca para edição ao clicar em "Editar". A barra mostra: "Versão N publicada em [data] por [pessoa]", "Rascunho com mudanças" e "Publicar".
- **Salvar rascunho** usa trava otimista por `draft_updated_at`: se outra aba salvou antes, avisa em vez de sobrescrever.
- **Histórico:** lista de versões com autor, data e nota. Compara quaisquer duas (texto linha a linha e ajustes campo a campo). "Restaurar" pede confirmação e publica como versão nova.
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
- **Motor:** chama `generateAgentReplyPreview`, que reaproveita o gerador com o **rascunho** e **sem o portão de envio**: nada é enviado, então o agente pode estar pausado. Precisa de chave de IA configurada.
- **Sem efeito colateral nenhum:**
  - não grava conversa nem mensagem;
  - não envia;
  - não agenda (a agenda só é lida);
  - não aplica etiqueta, não mexe no negócio;
  - não agenda cutucada, não manda evento para a Meta.

  O teste da rota conta as linhas das tabelas antes e depois.
- **O que devolve:**
  - as partes da resposta como sairiam no WhatsApp;
  - "o que o agente fez": os campos estruturados já existentes (repasse e motivo, pedido de horário, nome, e-mail, empresa e segmento captados, etiquetas sugeridas, gate de capacidade, resumo);
  - o tempo (`ai_timing`) e os tokens.
- **Explicar esta resposta:** botão sob demanda que faz uma segunda chamada, depois da resposta, e mostra "por que respondeu assim" em português, rotulado como explicação gerada depois. Não altera a resposta testada. (Decisão 2 abaixo.)
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
- dividir: `aiReply.ts:885`;
- encerramento: `webhook/route.ts:176` e `:1360`, com `closingReply.ts:14-15`;
- mídia: `webhook/route.ts:817` e `:186`;
- celular: `webhook/route.ts:944`;
- cutucada: agendamento em `webhook/route.ts:440` e **envio no executor separado `lib/conversations/idleNudgeRunner.ts:156`**, que também precisa resolver pelo agente;
- nome: `aiAgentConfig.ts` e `webhook/route.ts:145/288`;
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
- **Tela:** grid no padrão de `TenantsPage.tsx`, com estados de carregando, erro e vazio.

## Critérios de aceite e testes obrigatórios

- **Fatia 1:**
  - equivalência byte a byte (4 cenários acima);
  - `ai_agent_id` nulo não muda nenhuma saída dos testes atuais (suíte completa verde antes e depois);
  - a FK composta recusa ligar um número a agente de outro cliente;
  - RLS e GRANT testados com chamada autenticada de verdade: agência lê, admin do cliente não lê, ninguém escreve direto;
  - agente sem versão não liga;
  - `agent_unavailable` registrado como falha.
- **Fatia 2:**
  - publicar cria N+1 e move o ponteiro atomicamente;
  - duas publicações com a mesma versão esperada: uma ganha, a outra recebe 409;
  - restaurar cria versão nova com `restored_from`;
  - a verificação ao vivo aponta cada item da lista, e os prompts atuais não disparam nenhum;
  - a Central de I.A mostra o aviso com link, e não o editor, em cliente com agente ligado;
  - admin do cliente recebe 403 em todas as rotas.
- **Fatia 3:**
  - nenhuma linha nova em conversas, mensagens, negócios, contatos, etiquetas, jobs e eventos depois de um teste;
  - nenhuma chamada à Evolution;
  - limite de testes respeitado;
  - preview com agente pausado funciona.
- **Fatia 4:**
  - caracterização antes;
  - agente sem valor = valor da conexão = comportamento de hoje, nos 10 pontos de leitura e no executor da cutucada;
  - limites rejeitados pela validação;
  - o PATCH da conexão recusa ajustes de agente num número ligado.
- **Fatia 5:** tokens gravados nas duas gerações; custo nulo quando o modelo não está na tabela, nunca inventado.
- **Fatia 6:** só agência; período limitado; tela com os três estados.
- **Toda fatia:**
  - suíte completa verde lida num comando separado antes do commit;
  - `git diff --stat` conferido;
  - prévia provada pelo login real, que mostra qual banco a prévia usa;
  - produção só com o OK do Junior.

## Portões de segurança aplicáveis (G1–G25)

- **G2 e G13:** RLS e GRANT nas tabelas novas, escrita só por função `security definer` com `search_path=''` e papel conferido por dentro.
- **G3:** autorização no servidor em toda rota.
- **G4:** FK composta e checagem de organização em toda leitura.
- **G5 e G19:** zod com lista fechada de campos e limites; as funções ignoram campo fora da lista.
- **G7 e G18:** limite no teste e teto de tamanho.
- **G15, G16 e G17:** preview sem ferramenta nem efeito, saída tratada como texto.
- **G22:** a chave de IA nunca sai do servidor.
- **G23:** migration só aditiva, sem reescrever `config` de conexão.
- **G24:** versões são o registro de quem publicou o quê, e cada resposta registra a versão.
- **G25:** agente sem versão não liga; ausência de agente = caminho atual.

## Achados fora do escopo, registrados para não se perderem

1. `AIConfigSection.tsx:141` mostra provedor, modelo e chave para o admin do cliente, e o servidor recusa (`settings/ai/route.ts:115-117`). É correção pequena e independente; pode entrar antes da fatia 1.
2. O `GET /api/settings/ai` responde `ai_enabled = true` quando a organização não tem linha em `organization_settings`, e o motor trata a ausência como desligado (`aiReply.ts:417`). A tela pode mostrar "ligada" com a IA parada.
3. Os dois `GET` de `ai-prompts` aceitam o admin do cliente, que lê prompt e versões pela API mesmo sem botão na tela.
4. As policies de `ai_prompt_templates` usam o papel legado `'admin'` (`schema_init.sql:580-610`). Conferir se migrations posteriores as reescreveram antes de confiar nelas.
5. O tipo `ChannelConnectionConfig` (`lib/channels/types.ts:9-16`) não lista nenhum campo de IA.
6. A policy de `channel_connections` é de 10/03 e usa o papel legado. Hoje a proteção real está nas rotas, que usam a chave de serviço.
7. `boards.agent_*` (nome e comportamento por funil) não alimenta o atendimento. Fica para a fase 3 ("agente por funil"), que decide se unifica.

## Decisões pedidas ao Junior

1. **Pausar por número, do lado do cliente.**
   - Hoje o admin do cliente só pausa a IA do cliente inteiro; pausar um número ficou só com a agência desde 26/09.
   - Recomendo manter assim na fase 1. Se quiser que o cliente pause um agente específico, isso entra depois como botão próprio, sem abrir o resto da configuração.
2. **"Explicar esta resposta" no teste.**
   - É um botão que, depois da resposta de teste, pede ao modelo uma frase dizendo por que respondeu assim.
   - Gasta uma chamada a mais da chave do cliente, só quando alguém clica.
   - Recomendo incluir: é o "motivo" que a fase aprovada promete, sem mexer na resposta testada.

## Pontos para o Codex aprovar ou contestar

1. A divisão entre ajustes do agente e do número, a ordem agente → conexão → constante, e o PATCH recusar (em vez de ignorar) campo de agente em número ligado.
2. Falhar com `agent_unavailable` em vez de cair no prompt antigo.
3. FK composta com `on delete set null (ai_agent_id)` (Postgres 15+). Conferir a versão do Supabase do projeto.
4. Rascunho na própria linha do agente × tabela de rascunhos.
5. Custo calculado na leitura × gravado na escrita.
6. O preview contornar o portão de envio só pela função nova, sem flag no gerador que o webhook usa.
