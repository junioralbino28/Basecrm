# SPEC — Central de Agentes, bloco 2: criar agentes (Novo agente e modelos da agência)

> Status: **v2, depois do NO-GO da rodada 1 do Codex** (09/10/2026; seis achados aceitos, ver o fim). Roteiro aprovado pelo Junior em 08/10 (`ROTEIRO-painel-completo-2026-10-08.md`, bloco 2); OK dele para seguir em 09/10 ("OK para seguir com tudo"). Processo leve: SPEC curta, revisão do Codex, PLAN, implementação, ensaio no ambiente de teste e publicação com o OK dele.
> Base de leitura: worktree `feat/central-agentes`, HEAD `a64b8d7` (= produção `7d8fcd1` + a regra 4 do `AGENTS.md`).
> **Tem migration.** Pela regra 4 do `AGENTS.md` (09/10), aplicar em produção exige o OK do Junior para ESTA migration, dump antes, ensaio no banco de teste e na cópia restaurada e a aplicação só por `aplicar_migration.py`.

## Para o Junior, em uma página

- **Botão "Novo agente" na lista de agentes de cada cliente.** Você dá um nome e escolhe o começo: um **modelo da agência**, o **padrão em branco** (o texto neutro de 8 seções que os números novos já usam) ou a **cópia de um agente que já existe**, deste cliente ou de outro.
- **Modelos da agência** ganham uma tela própria no menu da agência ("Modelos de agente"). Um modelo é um texto com lacunas entre colchetes, como `[Nome da empresa]`, `[Serviços]` e `[Horário de atendimento]`. Ao criar o agente a partir dele, a tela pede uma resposta para cada lacuna. A lacuna que ficar sem resposta continua no texto e a verificação do Publicar avisa, como já faz hoje.
- **"Salvar como modelo"** no editor de qualquer agente transforma a versão publicada dele em modelo. Depois você troca o que é do cliente por lacunas.
- **O agente nasce em rascunho.** Você testa sem enviar (bloco 1) e publica. Nada muda em agente nenhum que já existe, e mudar um modelo não mexe nos agentes criados a partir dele (cada agente leva uma cópia do texto).
- **O que fica para depois:** ligar o agente novo a um número pela tela é o bloco 8 (conectores). Até lá, a ligação continua pelo script, com o seu OK, como foi com a Aurora. O assistente que escreve o texto com você é o bloco 3.

## Decisões que esta SPEC não reabre

1. Nada de ramo por cliente (25/09): todo cliente ganha a mesma capacidade.
2. O controle da IA mora no painel da agência; só `agency_admin` (e o legado `admin`) cria, edita, testa e publica (fase 1, "Quem mexe").
3. Nada muda um agente publicado sem Publicar (roteiro, "Riscos e fronteiras").
4. Migration em produção só pelo rito e com o OK do Junior para ela (regra 4, 09/10).
5. Os tokens do Supabase não mudam (06/10).

## Como funciona hoje (levantamento de 09/10, com arquivo e linha)

- Agente só nasce pelo script de migração, com `create_ai_agent_from_legacy_prompt` (`20260930000000_central_agentes_fundacao.sql:244`, só `service_role`). Não há `POST` de criar agente nem função para `authenticated`.
- Editar, publicar e restaurar são funções `security definer`, `search_path = ''`, com o gate `is_agency_admin_role()` por dentro e execute só para `authenticated`, chamadas com o JWT do usuário (`20261007120000_central_agentes_editor.sql:51-301`; `lib/agents/editorAgentes.ts:356-415`).
- Publicar já aceita agente sem versão publicada: com `p_expected_version = 0` nasce a versão 1 com `source = 'publish'` (`20261007120000_central_agentes_editor.sql:142-176`).
- A "agência" é só o papel em `profiles.role`; não existe organização da agência (`20251201000000_schema_init.sql:38-44`; `20260311013000_core_multi_tenant_rls.sql:24-42`). A agência enxerga todos os clientes.
- A verificação do Publicar já marca `[Texto com maiúscula]` como **pendência** (aviso que precisa ser confirmado), sem contar link de markdown (`lib/agents/verificarPrompt.ts:62,100-108`). Marcador `{{x}}` fora das 12 variáveis de runtime é erro (`:57,87-98`), e o banco tem a mesma regra (`central_agentes_variavel_desconhecida`).
- As rotas de nível agência ficam em `app/api/platform/agency/`, cada uma com a própria checagem de papel (padrão `requireAgencyAdminProfile`, `app/api/platform/agency/evolution/route.ts:63`). O menu da agência fica em `components/Layout.tsx:434-443` e `components/navigation/navConfig.ts:88-90`.
- A lista de agentes do cliente (`features/agents/TenantAgentsPage.tsx`) não tem botão de criar; o estado vazio diz que criar "vem na fase 2" (`:75`).

## Decisões de desenho

| Questão | Decisão | Motivo |
|---|---|---|
| Onde mora o modelo | Tabela nova `ai_agent_templates`, **sem** `organization_id` (a agência não é organização) | Modelo é da agência e serve a qualquer cliente. Pôr num cliente "dono" criaria um ramo por cliente. |
| Variáveis do modelo | As lacunas são os próprios trechos `[Texto com maiúscula]` do texto, a mesma expressão da pendência (`PENDENCIA` em `verificarPrompt.ts`). Não há lista de variáveis separada | Uma convenção só para modelo, verificação e o assistente do bloco 3. Lacuna sem resposta continua como pendência e a verificação avisa. Lista separada poderia dessincronizar do texto. |
| Preencher lacuna | **O banco monta o texto** (rodada 1 do Codex, achado 1): troca **todas** as ocorrências de cada lacuna respondida com `replace()` do Postgres, que é literal (um valor como `$&` não é interpretado). Valor de 1 a 500 caracteres, sem `{`, `}`, `[` nem `]`; resposta vazia = a lacuna fica. Depois da troca, o banco confere o **resultado**: a lista de marcadores `{{...}}` é a mesma do modelo, na mesma ordem, e as lacunas que sobraram são exatamente as do modelo menos as respondidas; senão `lacuna_invalida` (22023) | Proibir só `{{` e colchete no valor não basta: `{[Campo]contactName}}` com o valor `{` vira `{{contactName}}`, e `[[Nome]]` com `Cliente` vira uma lacuna nova `[Cliente]` (achado 4). Conferir o resultado pega toda junção de borda, qualquer que seja o valor. |
| Versões do modelo | **Não há.** O modelo é editado no lugar, com **revisão inteira** (`revision`, começa em 1): salvar, arquivar e restaurar travam a linha (`for update`), recusam revisão diferente da esperada (`modelo_mudou`, P0001) e sobem a revisão em 1 (achado 3) | O agente leva uma cópia do texto no rascunho; o histórico que importa é o do agente. Revisão inteira avança sempre, ao contrário de `updated_at`, que repete dentro da mesma transação. |
| Modelo arquivado | `archived_at`; some da escolha do "Novo agente" e da lista padrão; pode ser restaurado. Não se apaga | Apagar perderia a origem registrada nos agentes. |
| O que a origem garante | `ai_agents.origin` do agente novo é montado **no banco**, nunca vindo da tela, e sempre com `kind` explícito e o `promptSha256` do texto final. **Modelo e cópia: prova de derivação.** O banco monta o texto na mesma transação, a partir do modelo travado (`for share`, revisão esperada conferida) ou da versão publicada de origem (imutável); a função não recebe texto. **Branco: registro da escolha.** O texto do catálogo vive no código, não no banco; a função recebe o texto e a origem diz só `{"kind":"blank","promptSha256":...}`, sem afirmar de onde ele veio | Na v1 da SPEC, a função recebia o texto pronto e o id da fonte: um `agency_admin` chamando direto gravaria um texto qualquer com a origem de um modelo, e a rota podia ler o modelo antes de uma edição (achado 1). O índice único de migração só vale para `kind = 'migration'` e não é afetado. |
| Agente novo | Nasce com `draft = {"prompt": ...}`, `draft_revision = 1`, sem versão publicada e sem número | Mesmo estado de um rascunho salvo. Testar e publicar usam as funções de hoje, sem mudança. |
| "Padrão em branco" | O texto de `task_conversations_whatsapp_auto_reply` do catálogo, lido no servidor | É o começo neutro que já existe e já passa na verificação. "Vazio" de verdade não passa no `prompt` mínimo de 1 caractere e não ajuda ninguém. |
| Copiar agente | Só a **versão publicada** do agente de origem, de qualquer cliente; a função recebe a organização e o agente de origem juntos e confere que um é do outro; a tela mostra o cliente de origem e o de destino | A publicada passou pela verificação do Publicar (não necessariamente pelo teste sem enviar: publicar não exige teste, achado 5); o rascunho pode estar pela metade. A agência já enxerga todos os clientes. |
| Salvar como modelo | A partir da versão publicada; o nome e a descrição vêm da tela; o texto vai igual e a agência troca o que é do cliente por lacunas na tela do modelo | Generalizar automaticamente (achar o nome da empresa e trocar) erraria em silêncio. |
| Quem mexe | Só `agency_admin` e o legado `admin`, nas duas telas e nas funções | Fase 1, "Quem mexe". |
| Limite de criação | Sem balde novo: criar e salvar modelo não chamam IA | O custo que precisa de limite é o do modelo de IA, e ele continua só no teste (bloco 1). |

## Modelo de dados (migration `<timestamp>_central_agentes_modelos.sql`)

```sql
ai_agent_templates (
  id uuid pk default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text null check (description is null or char_length(description) <= 280),
  prompt text not null check (char_length(prompt) between 1 and 50000),
  origin jsonb not null check (jsonb_typeof(origin) = 'object' and origin ->> 'kind' in ('blank', 'agent')), -- sem default: a função grava o tipo
  revision integer not null default 1 check (revision >= 1),
  created_by uuid null fk profiles on delete set null, updated_by uuid null fk profiles on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz null
)
```

- RLS ligada; `select` só com `using (public.is_agency_admin_role())`; nenhuma policy de escrita. `revoke all` de `anon` e `authenticated`, `grant select` a `authenticated`, `all` a `service_role`.
- **O que "escrita só por função" garante** (achado 6): é a garantia do **caminho da aplicação**. Os papéis comuns não escrevem na tabela (sem policy nem grant de escrita) e as rotas não escrevem com a chave de serviço (teste de fonte: nenhuma rota chama `.insert`, `.update`, `.upsert` ou `.delete` em `ai_agent_templates` ou `ai_agents`). A `service_role` tem `all`, como nas tabelas da fase 1, e quem tem a chave de serviço escreve direto.
- Funções novas, todas `security definer`, `set search_path = ''`, com `if not public.is_agency_admin_role() then raise ... '42501'` antes da primeira leitura, autor de `auth.uid()`, `revoke all ... from public, anon, authenticated, service_role` e `grant execute ... to authenticated` (o mesmo cabeçalho das três da fatia 2, conferido por teste). Todas conferem que a organização de destino existe e não está apagada (`deleted_at is null`), nome de 1 a 80, descrição até 280, texto de 1 a 50.000 e `central_agentes_variavel_desconhecida` nula no texto final. Os agentes nascem com `draft = {"prompt": <texto final>}`, `draft_revision = 1`, `draft_updated_by` e `created_by` = `auth.uid()`, e a `origin` sempre leva `kind` e `promptSha256` do texto final.
  - `create_ai_agent_blank(p_organization_id uuid, p_name text, p_prompt text) returns uuid`: origem `{"kind":"blank","promptSha256":...}` (registro da escolha, não prova).
  - `create_ai_agent_from_template(p_organization_id uuid, p_name text, p_template_id uuid, p_expected_template_revision integer, p_answers jsonb) returns uuid`: trava o modelo (`for share`), recusa arquivado e revisão diferente (`modelo_mudou`); `p_answers` é um objeto de até 50 chaves, cada chave uma lacuna que existe no texto do modelo (`[` + maiúscula + até 80 caracteres + `]`, a mesma forma da `PENDENCIA`) e cada valor de 1 a 500 caracteres sem `{ } [ ]`; monta o texto com `replace()` e confere o resultado (lista de `{{...}}` igual à do modelo; lacunas restantes = as do modelo menos as respondidas; senão `lacuna_invalida`). Origem `{"kind":"template","templateId","templateRevision","templateSha256","answered":[...],"promptSha256"}` (prova de derivação).
  - `create_ai_agent_from_copy(p_organization_id uuid, p_name text, p_source_organization_id uuid, p_source_agent_id uuid, p_expected_source_version integer) returns uuid`: lê o agente de origem pela organização e pelo id juntos, recusa sem versão publicada e versão publicada diferente da esperada (`versao_publicada_mudou`); o texto é o da versão publicada. Origem `{"kind":"copy","organizationId","agentId","version","sha256","promptSha256"}` (prova de derivação; `sha256` = `promptSha256`, porque a cópia é literal).
  - `save_ai_agent_template(p_template_id uuid, p_expected_revision integer, p_name text, p_description text, p_prompt text) returns table (out_id uuid, out_revision integer)`: `p_template_id` nulo cria com `origin = {"kind":"blank"}` e revisão 1; senão trava (`for update`), recusa arquivado e revisão diferente (`modelo_mudou`) e sobe a revisão.
  - `create_ai_agent_template_from_agent(p_organization_id uuid, p_agent_id uuid, p_expected_version integer, p_name text, p_description text) returns uuid`: copia a versão publicada (conferida pela versão esperada); `origin = {"kind":"agent","organizationId","agentId","version","sha256"}`; recusa agente sem versão publicada.
  - `set_ai_agent_template_archived(p_template_id uuid, p_archived boolean, p_expected_revision integer) returns integer`: trava, confere a revisão, grava ou limpa `archived_at` e sobe a revisão.
- **Não destrutiva:** só `create table`, `create policy`, `create function`, `grant`/`revoke`. Nenhum `alter`, `drop`, `delete` ou `update` de tabela existente. Volta (`docs/features/central-de-agentes/volta-bloco-2.sql`): `begin`, `drop function` das seis, `drop table ai_agent_templates`, `delete` da linha em `supabase_migrations.schema_migrations`, `commit`. Antes da volta, o código que usa as funções sai do ar (mesma ordem da fatia 2).
- Agentes criados pela tela continuam depois da volta (são linhas comuns de `ai_agents`); só a `origin` fica apontando para um modelo que deixou de existir.

## Rotas

| Rota | Faz | Porta |
|---|---|---|
| `POST /api/platform/tenants/[tenantId]/agents` | Cria agente: `{ nome, inicio: {tipo:'branco'} \| {tipo:'modelo', modeloId, revisaoDoModelo, respostas: {"[Lacuna]": "valor"}} \| {tipo:'copia', clienteDeOrigemId, agenteId, versaoEsperada} }` → `{ agenteId }` | `abrirRotaDoCliente(escreve: true)` (que já confere `isAllowedOrigin`); zod estrito; branco: o servidor lê o catálogo e chama `create_ai_agent_blank`; modelo e cópia: repassa ids e respostas para `create_ai_agent_from_template` / `_from_copy`, que montam o texto no banco. Tudo com o JWT do usuário |
| `GET /api/platform/agency/agent-templates` | Lista modelos (`?arquivados=1` inclui os arquivados): id, nome, descrição, revisão, lacunas encontradas, atualizado em e por quem, quantos agentes nasceram dele | `requireAgencyAdminProfile` no padrão de `agency/evolution`; leitura pelo cliente do usuário (RLS) |
| `POST /api/platform/agency/agent-templates` | Cria modelo: `{nome, descricao?, prompt}` ou `{nome, descricao?, deAgente: {tenantId, agenteId, versaoEsperada}}` | mesma porta + `isAllowedOrigin` |
| `GET/PUT /api/platform/agency/agent-templates/[templateId]` | Lê / salva (`{nome, descricao?, prompt, revisaoEsperada}`) | mesma porta; o PUT confere `isAllowedOrigin` (achado 2) |
| `POST /api/platform/agency/agent-templates/[templateId]/archive` | Arquiva ou restaura (`{arquivar, revisaoEsperada}`) | mesma porta + `isAllowedOrigin` (achado 2) |

- **Toda rota que escreve confere `isAllowedOrigin` antes de qualquer outra coisa**, com teste de origem recusada (403) em cada uma (achado 2), no mesmo padrão de `agency/evolution/route.ts:106`.
- Corpo limitado como no bloco 1 (`lerCorpoLimitado`), 256 KB. Erros do banco mapeados como na fatia 2: `42501` → 403, `P0002` → 404, `modelo_mudou`/`versao_publicada_mudou` → 409, `variavel_desconhecida` → 422 com o nome, `lacuna_invalida` → 422.
- A rota recusa antes do banco (400) resposta para lacuna que não existe no modelo, chave fora da forma de lacuna e valor com `{ } [ ]`, para dar uma mensagem clara na tela; quem garante é o banco (G19).
- As lacunas que a tela mostra vêm de um detector **exportado** de `verificarPrompt.ts` (hoje a `PENDENCIA` é privada), o mesmo que a verificação do Publicar usa; o teste do banco confere que a forma da lacuna no SQL casa com ele nos mesmos exemplos (Codex, decisão 1).
- Log de falha sem o texto do prompt nem das respostas (G22, como no bloco 1).

## Telas

1. **Lista de agentes do cliente** (`TenantAgentsPage`): botão "Novo agente" no cabeçalho. O estado vazio troca o texto de hoje por "Nenhum agente neste cliente ainda." e o mesmo botão.
2. **Diálogo "Novo agente"** (`Modal` de `components/ui/Modal.tsx`, como o `DialogoPublicar`):
   - "Nome do agente" (1 a 80; com modelo, nasce com o nome do modelo).
   - "Começar de": **Modelo da agência** (lista com nome e descrição; sem modelo, a opção aparece desabilitada com "Nenhum modelo ainda. Crie em Modelos de agente."), **Padrão em branco** ou **Copiar de outro agente** (cliente e agente; só agentes com versão publicada; a tela diz "Copiar a versão N de <agente>, do cliente <origem>, para o cliente <destino>").
   - Com modelo: um campo por lacuna, rotulado com o próprio texto da lacuna, opcional, com a nota "O que ficar em branco continua entre colchetes e a verificação do Publicar avisa."
   - "Criar" abre o editor do agente novo (rascunho, sem versão publicada), onde o "Testar sem enviar" já funciona.
   - No celular (320 px), campo e botão visíveis acima da barra de navegação: conferir com `elementFromPoint`, como no bloco 1.
3. **Modelos de agente** (menu da agência, `/platform/agent-templates`): lista com nome, descrição, lacunas, "usado em N agentes", atualizado em; "Novo modelo" (em branco ou a partir de um agente); "Mostrar arquivados".
4. **Editor do modelo** (`/platform/agent-templates/[templateId]`): nome, descrição, texto (o mesmo campo do editor do agente), as lacunas encontradas listadas ao lado, "Salvar" e "Arquivar". Avisa quando outra pessoa salvou antes (409).
5. **Editor do agente**: botão "Salvar como modelo" (só com versão publicada), pede nome e descrição e abre o editor do modelo novo.

## Fora do escopo

Ligar número a agente pela tela (bloco 8); assistente de criação (bloco 3); conhecimento (bloco 4); renomear e apagar agente; versões de modelo; categorias de modelo (a descrição basta); modelos prontos semeados pela migration (a biblioteca nasce vazia; o "Padrão em branco" cobre o começo, e o Junior cria os modelos dele pela tela).

## Critérios de aceite e testes obrigatórios

1. **Contrato da migration** (`test/centralAgentesModelosMigration.test.ts`, lendo o arquivo): tabela, checks, RLS e a policy exata; grants; as seis funções com o cabeçalho de segurança, o gate antes da primeira leitura, `auth.uid()`, revoke e grant; "não destrutiva"; a volta com a sequência exata.
2. **Banco local de verdade** (como `webhookDoNumero.real.test.ts`):
   - `clinic_admin`, `agency_staff` e anônimo recebem 42501 nas seis funções;
   - `agency_admin` cria agente nos três começos, com a `origin` montada pelo banco e o `promptSha256` igual ao sha do rascunho gravado;
   - **chamada direta** (achado 1): não há parâmetro de texto em `_from_template` nem em `_from_copy`, e o texto gravado é sempre o derivado (conferido por sha);
   - **edição concorrente** (achados 1 e 3): salvar o modelo entre a leitura da tela e o criar → `modelo_mudou`; duas edições com a mesma revisão → uma passa e a outra recebe `modelo_mudou`; arquivar e restaurar sobem a revisão e recusam revisão velha;
   - **junções de borda** (achado 4): `{[Campo]contactName}}` com `{` e `[[Nome]]` com `Cliente` recusados (o valor já cai na regra dos caracteres; o teste também chama com o caractere permitido em volta para provar a conferência do resultado); valor `$&` gravado literalmente; lacuna repetida trocada em todas as ocorrências; lacuna sem resposta continua;
   - cópia com organização e agente que não combinam → `agente_inexistente` (P0002); sem versão publicada e versão esperada velha recusadas;
   - modelo arquivado recusado; `{{desconhecida}}` = `variavel_desconhecida`; organização apagada recusada.
3. **Rotas:** corpo estrito; resposta para lacuna inexistente = 400; **origem HTTP recusada = 403 em cada rota que escreve** (achado 2); porta da agência (`clinic_admin` = 403); mapeamento de erros; teste de fonte de que nenhuma rota escreve direto nas tabelas nem manda `origin` ao banco.
4. **Lacunas na tela:** as mesmas que a verificação acha (o teste usa o detector exportado, não uma cópia); lacuna sem resposta continua e vira pendência na verificação do Publicar.
5. **Telas:** diálogo nos três começos, lacunas, erro de servidor visível, botão desabilitado enquanto cria; lista de modelos e editor com 409; "Salvar como modelo" só com versão publicada.
6. **Ensaio no ambiente de teste** (descartável `agency_admin`): criar modelo com lacunas, criar agente a partir dele, testar sem enviar, publicar a v1, salvar um agente como modelo, arquivar; contagem antes e depois provando que só `ai_agent_templates`, `ai_agents` e `ai_agent_versions` mudaram (e o limitador do teste).

## Portões de segurança (G1–G25)

- **G3/G4:** porta da agência no servidor e gate no banco (as duas); `tenantId` e `agenteId` conferidos juntos; modelo é global, mas só a agência lê (RLS).
- **G5/G19:** zod estrito; `origin`, autor e (em modelo e cópia) o próprio texto nunca vêm da tela; respostas só para lacunas do modelo, conferidas no banco.
- **G13:** no caminho da aplicação, escrita só por função com o JWT do usuário; as rotas não escrevem com a chave de serviço (teste de fonte). A `service_role` mantém `all` nas tabelas, como na fase 1 (achado 6).
- **G20:** modelo arquivado, agente sem versão publicada e organização apagada recusados no banco, não só na tela.
- **G22/G24:** sem texto de prompt nem resposta em log; erro com código.
- **G23:** migration não destrutiva, com volta e rito completo (regra 4).
- **G25:** RLS ligada e grants explícitos; sem execute para `anon`, `public` e `service_role` nas funções novas.
- G7/G18: sem chamada de IA nova (ver "Limite de criação").

## Rodada 1 do Codex (09/10, NO-GO) — como ficou

Parecer literal no cérebro: `devolutiva-codex-1-bloco-2.md`. Os seis achados foram aceitos.

| Achado | Como ficou |
|---|---|
| 1. A origem não prova o texto (chamada direta com texto arbitrário; corrida entre ler o modelo e criar) | Uma função por começo. Modelo e cópia não recebem texto: o banco monta, com o modelo travado e a revisão esperada conferida, ou a partir da versão publicada esperada. A origem é prova de derivação nesses dois e registro da escolha no branco, dito com essas palavras; toda origem leva o `promptSha256` do texto final. Testes de chamada direta e de edição concorrente. |
| 2. `isAllowedOrigin` só no POST de criação | Exigido em toda rota que escreve, com teste de 403 em cada uma. |
| 3. `updated_at` sem regra de avanço | Revisão inteira; salvar, arquivar e restaurar travam (`for update`), conferem e sobem a revisão. |
| 4. Valor de lacuna pode formar marcador na borda | O banco confere o resultado (mesmos `{{...}}` do modelo, lacunas restantes = as do modelo menos as respondidas); valor sem `{ } [ ]`; `replace()` literal do Postgres. |
| 5. "A publicada foi testada" | Corrigido para "passou pela verificação do Publicar". |
| 6. Default `{}` contra o `kind` prometido; "escrita só por função" | `origin` sem default, com `kind` obrigatório por check; a garantia é dita como do caminho da aplicação, com a `service_role` mantendo `all`. |

Decisões do Codex: aprovou a lacuna = `PENDENCIA` (com o detector exportado), modelo sem versões (com o achado 3), cópia entre clientes por ação explícita (tela com cliente de origem e de destino; organização e agente conferidos juntos) e a biblioteca vazia. A decisão 3 (texto montado fora do banco) foi revista pelo achado 1.
