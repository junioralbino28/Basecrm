# SPEC — Central de Agentes, bloco 2: criar agentes (Novo agente e modelos da agência)

> Status: **rascunho para a revisão do Codex** (09/10/2026). Roteiro aprovado pelo Junior em 08/10 (`ROTEIRO-painel-completo-2026-10-08.md`, bloco 2); OK dele para seguir em 09/10 ("OK para seguir com tudo"). Processo leve: SPEC curta, revisão do Codex, PLAN, implementação, ensaio no ambiente de teste e publicação com o OK dele.
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
| Preencher lacuna | O servidor troca **todas** as ocorrências de cada lacuna pelo valor. Valor de 1 a 500 caracteres, sem `{{`, `}}`, `[` nem `]`; vazio = a lacuna fica | Sem `{{` o valor não vira variável de runtime nem erro de Publicar; sem colchete o valor não cria lacuna nova. |
| Versões do modelo | **Não há.** O modelo é editado no lugar, com conferência de concorrência (`updated_at` esperado) | O agente leva uma cópia do texto no rascunho; o histórico que importa é o do agente. Versão de modelo é custo sem uso agora. |
| Modelo arquivado | `archived_at`; some da escolha do "Novo agente" e da lista padrão; pode ser restaurado. Não se apaga | Apagar perderia a origem registrada nos agentes. |
| Rastro de origem | `ai_agents.origin` do agente novo é montado **no banco**, nunca vindo da tela: `{"kind":"blank"}`, `{"kind":"template","templateId":...,"templateSha256":...}` ou `{"kind":"copy","agentId":...,"version":...,"sha256":...}` | Origem vinda do cliente HTTP seria forjável (G19). O índice único de migração só vale para `kind = 'migration'` e não é afetado. |
| Agente novo | Nasce com `draft = {"prompt": ...}`, `draft_revision = 1`, sem versão publicada e sem número | Mesmo estado de um rascunho salvo. Testar e publicar usam as funções de hoje, sem mudança. |
| "Padrão em branco" | O texto de `task_conversations_whatsapp_auto_reply` do catálogo, lido no servidor | É o começo neutro que já existe e já passa na verificação. "Vazio" de verdade não passa no `prompt` mínimo de 1 caractere e não ajuda ninguém. |
| Copiar agente | Só a **versão publicada** do agente de origem, de qualquer cliente | A publicada foi testada; o rascunho pode estar pela metade. A agência já enxerga todos os clientes. |
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
  origin jsonb not null default '{}' check (jsonb_typeof(origin) = 'object'), -- {"kind":"blank"} | {"kind":"agent","agentId","version","sha256"}
  created_by uuid null fk profiles on delete set null, updated_by uuid null fk profiles on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  archived_at timestamptz null
)
```

- RLS ligada; `select` só com `using (public.is_agency_admin_role())`; nenhuma policy de escrita. `revoke all` de `anon` e `authenticated`, `grant select` a `authenticated`, `all` a `service_role`.
- Funções novas, todas `security definer`, `set search_path = ''`, com `if not public.is_agency_admin_role() then raise ... '42501'` antes da primeira leitura, autor de `auth.uid()`, `revoke all ... from public, anon, authenticated, service_role` e `grant execute ... to authenticated` (o mesmo cabeçalho das três da fatia 2, conferido por teste):
  - `create_ai_agent(p_organization_id uuid, p_name text, p_prompt text, p_origin_kind text, p_origin_id uuid) returns uuid`: confere que a organização existe e não está apagada (`deleted_at is null`), nome e texto nos limites, `central_agentes_variavel_desconhecida(p_prompt)` nula; para `template`, o modelo existe e não está arquivado; para `copy`, o agente de origem tem versão publicada (de qualquer organização). Monta `origin` lendo o modelo ou a versão de origem (sha256 calculado no banco). Insere com `draft_revision = 1`, `draft_updated_by = auth.uid()`, `created_by = auth.uid()`.
  - `save_ai_agent_template(p_template_id uuid, p_expected_updated_at timestamptz, p_name text, p_description text, p_prompt text) returns table (out_id uuid, out_updated_at timestamptz)`: `p_template_id` nulo cria; senão trava a linha (`for update`), recusa arquivado e recusa `updated_at` diferente do esperado (`modelo_mudou`, P0001). Mesma checagem de variável desconhecida.
  - `create_ai_agent_template_from_agent(p_organization_id uuid, p_agent_id uuid, p_name text, p_description text) returns uuid`: copia a versão publicada; `origin = {"kind":"agent",...}`; recusa agente sem versão publicada.
  - `set_ai_agent_template_archived(p_template_id uuid, p_archived boolean, p_expected_updated_at timestamptz) returns timestamptz`.
- **Não destrutiva:** só `create table`, `create policy`, `create function`, `grant`/`revoke`. Nenhum `alter`, `drop`, `delete` ou `update` de tabela existente. Volta (`docs/features/central-de-agentes/volta-bloco-2.sql`): `begin`, `drop function` das quatro, `drop table ai_agent_templates`, `delete` da linha em `supabase_migrations.schema_migrations`, `commit`. Antes da volta, o código que usa as funções sai do ar (mesma ordem da fatia 2).
- Agentes criados pela tela continuam depois da volta (são linhas comuns de `ai_agents`); só a `origin` fica apontando para um modelo que deixou de existir.

## Rotas

| Rota | Faz | Porta |
|---|---|---|
| `POST /api/platform/tenants/[tenantId]/agents` | Cria agente: `{ nome, inicio: {tipo:'branco'} \| {tipo:'modelo', modeloId, respostas: {"[Lacuna]": "valor"}} \| {tipo:'copia', agenteId} }` → `{ agenteId }` | `abrirRotaDoCliente(escreve: true)`; zod estrito; o servidor monta o texto (catálogo, modelo + respostas, ou versão publicada de origem) e chama `create_ai_agent` com o JWT do usuário |
| `GET /api/platform/agency/agent-templates` | Lista modelos (`?arquivados=1` inclui os arquivados): id, nome, descrição, lacunas encontradas, atualizado em e por quem, quantos agentes nasceram dele | `requireAgencyAdminProfile` no padrão de `agency/evolution`; leitura pelo cliente do usuário (RLS) |
| `POST /api/platform/agency/agent-templates` | Cria modelo: `{nome, descricao?, prompt}` ou `{nome, descricao?, deAgente: {tenantId, agenteId}}` | mesma porta + `isAllowedOrigin` |
| `GET/PUT /api/platform/agency/agent-templates/[templateId]` | Lê / salva (`{nome, descricao?, prompt, atualizadoEmEsperado}`) | mesma porta |
| `POST /api/platform/agency/agent-templates/[templateId]/archive` | Arquiva ou restaura (`{arquivar, atualizadoEmEsperado}`) | mesma porta |

- Corpo limitado como no bloco 1 (`lerCorpoLimitado`), 256 KB. Erros do banco mapeados como na fatia 2: `42501` → 403, `P0002` → 404, `modelo_mudou`/`rascunho_mudou` → 409, `variavel_desconhecida` → 422 com o nome.
- O servidor recusa resposta para lacuna que não existe no modelo (400), para não aceitar campo solto (G19).
- Log de falha sem o texto do prompt nem das respostas (G22, como no bloco 1).

## Telas

1. **Lista de agentes do cliente** (`TenantAgentsPage`): botão "Novo agente" no cabeçalho. O estado vazio troca o texto de hoje por "Nenhum agente neste cliente ainda." e o mesmo botão.
2. **Diálogo "Novo agente"** (`Modal` de `components/ui/Modal.tsx`, como o `DialogoPublicar`):
   - "Nome do agente" (1 a 80; com modelo, nasce com o nome do modelo).
   - "Começar de": **Modelo da agência** (lista com nome e descrição; sem modelo, a opção aparece desabilitada com "Nenhum modelo ainda. Crie em Modelos de agente."), **Padrão em branco** ou **Copiar de outro agente** (cliente e agente; só agentes com versão publicada).
   - Com modelo: um campo por lacuna, rotulado com o próprio texto da lacuna, opcional, com a nota "O que ficar em branco continua entre colchetes e a verificação do Publicar avisa."
   - "Criar" abre o editor do agente novo (rascunho, sem versão publicada), onde o "Testar sem enviar" já funciona.
   - No celular (320 px), campo e botão visíveis acima da barra de navegação: conferir com `elementFromPoint`, como no bloco 1.
3. **Modelos de agente** (menu da agência, `/platform/agent-templates`): lista com nome, descrição, lacunas, "usado em N agentes", atualizado em; "Novo modelo" (em branco ou a partir de um agente); "Mostrar arquivados".
4. **Editor do modelo** (`/platform/agent-templates/[templateId]`): nome, descrição, texto (o mesmo campo do editor do agente), as lacunas encontradas listadas ao lado, "Salvar" e "Arquivar". Avisa quando outra pessoa salvou antes (409).
5. **Editor do agente**: botão "Salvar como modelo" (só com versão publicada), pede nome e descrição e abre o editor do modelo novo.

## Fora do escopo

Ligar número a agente pela tela (bloco 8); assistente de criação (bloco 3); conhecimento (bloco 4); renomear e apagar agente; versões de modelo; categorias de modelo (a descrição basta); modelos prontos semeados pela migration (a biblioteca nasce vazia; o "Padrão em branco" cobre o começo, e o Junior cria os modelos dele pela tela).

## Critérios de aceite e testes obrigatórios

1. **Contrato da migration** (`test/centralAgentesModelosMigration.test.ts`, lendo o arquivo): tabela, checks, RLS e a policy exata; grants; as quatro funções com o cabeçalho de segurança, o gate antes da primeira leitura, `auth.uid()`, revoke e grant; "não destrutiva"; a volta com a sequência exata.
2. **Banco local de verdade** (como `webhookDoNumero.real.test.ts`): `clinic_admin`, `agency_staff` e anônimo recebem 42501 nas quatro funções; `agency_admin` cria agente nos três começos com a `origin` montada pelo banco; modelo arquivado e agente sem versão publicada recusados; `updated_at` velho = `modelo_mudou`; `{{desconhecida}}` = `variavel_desconhecida`; organização apagada recusada.
3. **Rotas:** corpo estrito, resposta para lacuna inexistente = 400, origem cruzada = 403, porta da agência (`clinic_admin` = 403), mapeamento de erros, e prova de que nenhuma rota manda `origin` ao banco.
4. **Lacunas:** as mesmas que a verificação acha (o teste usa a mesma expressão exportada, não uma cópia); troca de todas as ocorrências; valor com `{{`, `}}`, `[` ou `]` recusado; lacuna sem resposta continua e vira pendência na verificação.
5. **Telas:** diálogo nos três começos, lacunas, erro de servidor visível, botão desabilitado enquanto cria; lista de modelos e editor com 409; "Salvar como modelo" só com versão publicada.
6. **Ensaio no ambiente de teste** (descartável `agency_admin`): criar modelo com lacunas, criar agente a partir dele, testar sem enviar, publicar a v1, salvar um agente como modelo, arquivar; contagem antes e depois provando que só `ai_agent_templates`, `ai_agents` e `ai_agent_versions` mudaram (e o limitador do teste).

## Portões de segurança (G1–G25)

- **G3/G4:** porta da agência no servidor e gate no banco (as duas); `tenantId` e `agenteId` conferidos juntos; modelo é global, mas só a agência lê (RLS).
- **G5/G19:** zod estrito; `origin` e autor nunca vêm da tela; respostas só para lacunas do modelo.
- **G13:** escrita só por função com o JWT do usuário; a chave de serviço só lê o catálogo do código e nada escreve.
- **G20:** modelo arquivado, agente sem versão publicada e organização apagada recusados no banco, não só na tela.
- **G22/G24:** sem texto de prompt nem resposta em log; erro com código.
- **G23:** migration não destrutiva, com volta e rito completo (regra 4).
- **G25:** RLS ligada e grants explícitos; sem execute para `anon`, `public` e `service_role` nas funções novas.
- G7/G18: sem chamada de IA nova (ver "Limite de criação").

## Pontos para o Codex aprovar ou contestar

1. Lacuna = a expressão `PENDENCIA` (sem lista de variáveis). Risco: texto do cliente que já tenha colchetes com maiúscula vira lacuna no modelo; aceito, porque a tela lista as lacunas antes de salvar.
2. Modelo sem versões, editado no lugar, com concorrência por `updated_at`.
3. `create_ai_agent` recebe o texto já montado pelo servidor (o banco confere variável e limites, e monta só a `origin`). A alternativa é o banco montar o texto do modelo com as respostas; recusei porque a troca de lacunas ficaria duplicada em SQL e em TypeScript.
4. Copiar agente de outro cliente: a agência enxerga todos; o texto de um cliente vai para outro só por ação explícita de `agency_admin`.
5. A biblioteca nasce vazia.
