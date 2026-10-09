# Central de Agentes — renomear e excluir agente (SPEC curta + plano), v2.1

Decisão do Junior (09/10/2026 ~16h55), depois de criar um agente de teste em produção e não ter como apagar:
- **excluir de vez:** somem o agente, o rascunho e as versões; as conversas e o histórico de respostas continuam;
- agente com número ligado não exclui: a tela pede para desligar o número antes;
- confirmação antes de apagar;
- **agora, antes do bloco 3**, junto com o renomear, pelo rito de sempre: Codex, ensaio no teste, OK para publicar e para a migration (regra 4).

O renomear e o excluir tinham ficado fora do bloco 2 (`SPEC-bloco-2.md`, "fora do escopo") e de todos os blocos do roteiro.

v2: a revisão do Codex da rodada 1 (`devolutiva-codex-1-renomear-excluir.md`) está respondida na seção do fim. v2.1: as três notas da rodada 2 (GO para implementar, `devolutiva-codex-2-renomear-excluir.md`).

## O que muda para quem usa

Na página do agente (só agência, como todo o editor):

- **Renomear:** um lápis ao lado do nome abre o diálogo "Renomear agente", com o campo "Nome do agente" (1 a 80 caracteres, sem espaço nas pontas). Salvar troca o nome. Se duas pessoas renomearem ao mesmo tempo, vale o último.
- **Excluir:** o botão "Excluir" no cabeçalho fica travado durante a edição do texto, com o motivo "Salve ou cancele a edição antes de excluir." Ele abre um diálogo:
  - **com número ligado:** "Este agente atende {n} número(s): {nomes}. Desligue o número antes de excluir." Só o botão Fechar; nada é enviado.
  - **sem número:** "Excluir o agente {nome}? Somem o agente, o rascunho e todas as versões publicadas. As conversas e o histórico de respostas continuam. Não dá para desfazer." Botões Cancelar e **"Excluir de vez"**.
  - **Sucesso:** aviso "Agente excluído." e volta para a lista de agentes do cliente.
- **O que a tela mostrou vale:** a confirmação manda o nome, a revisão do rascunho e a versão publicada que a pessoa viu.
  - Se outra pessoa salvou, publicou ou renomeou no meio, o servidor recusa com 409 e nada é apagado.
  - O diálogo mostra "O agente mudou desde que você abriu esta confirmação. A tela foi atualizada; confira e confirme de novo." e recarrega o agente.
  - Se um número foi ligado no meio, também 409, com a mensagem do número.

## Banco: migration `20261009180000_central_agentes_renomear_excluir.sql`

- **ADITIVA:** uma tabela nova (o registro das exclusões) e duas funções; nenhuma tabela existente muda.
- **Sem barra invertida no arquivo.**
- **Cabeçalho igual ao das funções do bloco 2:**
  - `security definer`, `set search_path = ''`;
  - gate `is_agency_admin_role()` (`42501`) antes da primeira leitura;
  - organização com `deleted_at is null` e `for share` (`cliente_inexistente`, `P0002`);
  - `revoke all ... from public, anon, authenticated, service_role` e `grant execute ... to authenticated`.

```sql
-- Registro das exclusões: gravado DENTRO da função, na mesma transação do delete. Sem ele, nada é apagado.
-- Só a chave de serviço lê (RLS ligada, sem policy). deleted_by e agent_id sem FK: o registro sobrevive à
-- remoção da pessoa e do agente.
create table if not exists public.ai_agent_deletions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null,
  agent_name text not null,
  draft_revision integer not null,
  published_version_id uuid null,
  versions_deleted integer not null,
  deleted_by uuid null,
  deleted_at timestamptz not null default now()
);
alter table public.ai_agent_deletions enable row level security;
revoke all on table public.ai_agent_deletions from anon, authenticated;
grant all on table public.ai_agent_deletions to service_role;

create or replace function public.rename_ai_agent(p_organization_id uuid, p_agent_id uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  v_nome := btrim(coalesce(p_name, ''));
  if char_length(v_nome) < 1 or char_length(v_nome) > 80 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  update public.ai_agents a set name = v_nome, updated_at = now()
   where a.organization_id = p_organization_id and a.id = p_agent_id;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  return v_nome;
end;
$$;

create or replace function public.delete_ai_agent(
  p_organization_id uuid,
  p_agent_id uuid,
  p_expected_name text,
  p_expected_draft_revision integer,
  p_expected_published_version_id uuid
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_nome text;
  v_revisao integer;
  v_publicada uuid;
  v_numeros integer;
  v_versoes integer;
  v_restricao text;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  -- FOR UPDATE: salvar rascunho, publicar, renomear e ligar número (que trava o agente FOR SHARE) esperam
  -- esta transação, ou esta espera a deles; depois da espera, a comparação abaixo vê o estado novo.
  select a.name, a.draft_revision, a.published_version_id
    into v_nome, v_revisao, v_publicada
  from public.ai_agents a
  where a.organization_id = p_organization_id and a.id = p_agent_id
  for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  if v_nome is distinct from p_expected_name
     or v_revisao is distinct from p_expected_draft_revision
     or v_publicada is distinct from p_expected_published_version_id then
    raise exception 'agente_mudou' using errcode = 'P0001';
  end if;
  select count(*) into v_numeros from public.channel_connections c
   where c.organization_id = p_organization_id and c.ai_agent_id = p_agent_id;
  if v_numeros > 0 then
    raise exception 'agente_com_numero' using errcode = 'P0001', detail = v_numeros::text;
  end if;
  select count(*) into v_versoes from public.ai_agent_versions v
   where v.organization_id = p_organization_id and v.agent_id = p_agent_id;
  -- Defesa a mais, não o caminho comum: com as travas acima, um número ligado por outra transação é visto pela
  -- contagem. Só a FK do número vira o erro da tela; qualquer outra violação sobe como veio.
  begin
    delete from public.ai_agents a where a.organization_id = p_organization_id and a.id = p_agent_id;
  exception when foreign_key_violation then
    get stacked diagnostics v_restricao = constraint_name;
    if v_restricao = 'channel_connections_ai_agent_fk' then
      raise exception 'agente_com_numero' using errcode = 'P0001';
    end if;
    raise;
  end;
  insert into public.ai_agent_deletions
    (organization_id, agent_id, agent_name, draft_revision, published_version_id, versions_deleted, deleted_by)
  values
    (p_organization_id, p_agent_id, v_nome, v_revisao, v_publicada, v_versoes, auth.uid());
  return v_versoes;
end;
$$;
```

### O que o `delete` leva junto e o que fica

**Leva junto:** as versões, pela FK `on delete cascade` da fundação. O gatilho das versões só atua em `update`.

**Fica:**
- **Histórico de respostas:** `ai_reply_events.agent_id` (sem FK).
- **Mensagens enviadas:** `conversation_messages.metadata`, com `agent_id` e `agent_version` (JSON).
- **Origem de quem nasceu deste agente:** a `origin` do modelo salvo dele e das cópias dele (JSON).
- **Registro novo** em `ai_agent_deletions`, com o **nome** do agente, os ids, a revisão, a versão publicada, a contagem e quem excluiu. "Excluir de vez" apaga o agente e o texto dele; o nome fica nesse registro, que só a chave de serviço lê.
- **Prazo de vida do registro:** acompanha o cliente. A FK `organization_id ... on delete cascade` apaga o registro numa exclusão física do cliente; enquanto o cliente existir (inclusive com a exclusão lógica, `deleted_at`), o registro fica.

Nas migrations versionadas não há outra FK para `ai_agents` além da das versões e da do número (conferido também pelo Codex).

**Cópia local da tela:** a de recuperação do rascunho, em outra aba, fica até expirar (7 dias). Ao abrir, a tela mostra "Agente não encontrado".

### Travas: o que acontece em cada ordem

Medido pela análise das travas, conferida pelo Codex; o teste local prova as duas ordens.

- **Ligar primeiro:** a ligação trava o agente `FOR SHARE` (`fundacao.sql`, função de ligar) e a FK trava `FOR KEY SHARE`.
  - A exclusão espera no `FOR UPDATE`.
  - Com o commit da ligação, a exclusão segue, a contagem vê o número e recusa com `agente_com_numero`.
- **Excluir primeiro:** a exclusão segura o `FOR UPDATE`.
  - A ligação espera.
  - Com o commit da exclusão, a ligação falha do lado dela: o agente não existe mais.
- **O `exception when foreign_key_violation`** fica como defesa a mais, não provada por essas duas ordens. Só converte a violação da `channel_connections_ai_agent_fk`.

### Volta (`docs/features/central-de-agentes/volta-renomear-excluir.sql`)

`begin`, depois:
1. recusa se `ai_agent_deletions` tiver linhas: apagar o registro é decisão do Junior;
2. `drop function` das duas;
3. `drop table ai_agent_deletions`;
4. `delete` da linha `20261009180000` em `supabase_migrations.schema_migrations`;

e `commit`.

O código que chama as funções sai do ar antes. A volta não devolve agentes apagados; para isso existe o dump do rito.

## Servidor e rotas

**`lib/agents/editorAgentes.ts`:**
- `renomearAgente(c, { tenantId, agentId, nome })`: `c.usuario.rpc('rename_ai_agent')`, devolve `{ nome }`.
- `excluirAgente(c, { tenantId, agentId, nomeEsperado, revisaoEsperada, versaoPublicadaEsperada })`: `c.usuario.rpc('delete_ai_agent')`, devolve `{ versoesExcluidas }`.
- Nenhuma das duas usa `c.admin`.
- `ERROS_DO_BANCO` ganha:
  - `agente_com_numero`: 409 `AGENTE_COM_NUMERO`, "Este agente atende um número. Desligue o número dele antes de excluir.";
  - `agente_mudou`: 409 `AGENTE_MUDOU`, "O agente mudou desde que você abriu esta confirmação. A tela foi atualizada; confira e confirme de novo."

**Rotas novas, no mesmo padrão de `/publish`, `/restore` e do `/archive` dos modelos:**
- `POST /api/platform/tenants/[tenantId]/agents/[agentId]/rename`: corpo estrito `{ nome }`, até 200 caracteres no zod; o banco confere de 1 a 80 depois do `btrim`.
- `POST .../[agentId]/delete`: corpo estrito `{ nomeEsperado: string, revisaoEsperada: inteiro >= 0, versaoPublicadaEsperada: uuid | null }`.
- **Ordem das recusas, a de `abrirRotaDoAgente`:**
  1. id do agente fora do formato UUID: 400 (antes de tudo, sem tocar no banco);
  2. origem (`isAllowedOrigin`): 403;
  3. `requireTenantAccess(tenantId, { adminOnly: true })`;
  4. corpo: 400.
- **Respostas:** 200 `{ nome }` e 200 `{ excluido: true, versoesExcluidas }`.

**`features/agents/agentesApi.ts`:** `renomear(tenantId, agenteId, nome)` e `excluir(tenantId, agenteId, esperado)`.

## Tela

- **`features/agents/AgentEditorPage.tsx`:** o lápis "Renomear agente" ao lado do `h1` e o botão "Excluir" no cabeçalho.
- **Diálogos novos:** `features/agents/DialogoRenomearAgente.tsx` e `features/agents/DialogoExcluirAgente.tsx`, com o `Modal` do app.
- **Estado esperado mandado pelo diálogo de excluir:** `agente.nome`, `agente.rascunho.revisao` e `agente.publicada?.id ?? null`, do agente carregado.
- **No 409, o diálogo:**
  - pede ao editor que recarregue o agente;
  - continua aberto com o estado novo e a mensagem;
  - só exclui com um novo clique.

## Testes, com o que cada um prova

### 1. Contrato estático da migration

Arquivo: `test/centralAgentesRenomearExcluirMigration.test.ts`. Confere:
- o cabeçalho das duas funções e o gate antes da primeira leitura;
- revoke e grant;
- a tabela de registro com RLS, sem policy e sem grant para `anon` nem `authenticated`;
- no `delete`:
  - `for update` no agente e a comparação dos três esperados antes da contagem de números;
  - a contagem antes do `delete`;
  - o `exception` restrito a `channel_connections_ai_agent_fk`, com `raise;` para o resto;
  - o `insert` do registro depois do `delete`, na mesma função;
- nenhuma barra invertida;
- nenhum `alter` nem `drop` de tabela existente.

### 2. Local, no Supabase de verdade

Arquivo: `test/centralAgentesRenomearExcluir.local.test.ts`, com JWT real.

**Renomear:**
- apara o nome;
- `nome_invalido` com vazio e com 81 caracteres;
- agente de outro cliente: `agente_inexistente`;
- cliente apagado: `cliente_inexistente`;
- `clinic_admin` e `agency_staff`: `42501`.

**Excluir, caminho certo** (RPC chamada direto com o JWT da agência, sem a rota):
- o agente e as versões somem;
- a função devolve o número de versões;
- fica exatamente uma linha em `ai_agent_deletions`, com `deleted_by` = o usuário, o nome, a revisão, a publicada e a contagem;
- a `origin` de um modelo salvo dele continua;
- uma mensagem com `metadata.agent_id` dele continua.

**Excluir com estado desatualizado:**
- três casos: rascunho salvo depois da leitura, versão publicada depois e nome trocado depois;
- os três dão `agente_mudou`;
- o agente continua, sem linha de registro.

**Excluir com número:** `agente_com_numero`; o agente continua, sem registro.

**Registro que falha:**
- numa transação de teste, um gatilho que recusa `insert` em `ai_agent_deletions`;
- a exclusão falha e o agente continua;
- é a prova de que o registro e a exclusão são atômicos.

**As duas ordens das travas, com duas conexões `pg`:**
- *ligar primeiro:*
  - T1 liga o número sem fazer commit;
  - T2 chama a exclusão e fica esperando; o teste conferirá a espera em `pg_stat_activity`, com `wait_event_type = 'Lock'`;
  - T1 faz commit;
  - T2 recebe `agente_com_numero`, e o agente continua;
- *excluir primeiro:*
  - T2 exclui numa transação aberta;
  - T1 tenta ligar e espera;
  - T2 faz commit;
  - T1 falha, o agente não existe e o número fica sem agente.

**Outros:**
- agente de outro cliente: `agente_inexistente`;
- `42501` para quem não é agência;
- catálogo: nenhuma FK de `ai_reply_events` nem de `conversation_messages` para `ai_agents`.

**Provas contrárias:**
- sem a comparação dos esperados, os três casos desatualizados apagam;
- com o `insert` do registro movido para fora da função, o caso do registro que falha apaga;
- sem a contagem, o caso "com número" ainda dá `agente_com_numero` pelo `exception`; sem a contagem e sem o `exception`, dá `23503` cru;
- as duas últimas provam que o `exception` funciona quando é alcançado.

### 3. Camada

- As duas funções chamam `c.usuario.rpc`, com `c.admin` como `Proxy` que lança erro.
- Os dois 409 são traduzidos.
- Dado fora do tipo vira 500.

### 4. Rota

- **`rename` e `delete`:**
  - origem recusada: 403, sem chamar nada;
  - agente fora do formato UUID: 400;
  - origem recusada junto com UUID inválido: 400 (a ordem real);
  - corpo inválido (campo a mais, tipo errado, `versaoPublicadaEsperada` que não é uuid nem null): 400.
- **Sucesso,** com a forma da resposta.

### 5. Tela

- Renomear manda o pedido e o cabeçalho troca.
- Excluir com número mostra o bloqueio, sem botão de excluir, e nenhum pedido sai.
- Excluir sem número manda o estado que a tela mostrou, avisa e volta para a lista.
- 409 `AGENTE_MUDOU`: a mensagem aparece, o agente é recarregado e nenhuma navegação acontece.
- Em edição, "Excluir" fica travado com o motivo.

Suíte completa, tsc, lint e build antes de cada commit, com o resultado lido em comando separado.

## Rito

1. Codex: esta SPEC.
2. Implementação e revisão de código do Codex.
3. **Ensaio no banco de teste:**
   - migration pelo `aplicar_migration.py teste`, com a entrada no manifesto;
   - push em `feat/aurora-implantacao`;
   - prévia provada pelo login;
   - telas com descartável: renomear um agente do ensaio do bloco 2, excluir outro, tentar excluir a Aurora de teste (que tem número) e ver o bloqueio;
   - registro de exclusão conferido por leitura;
   - contagens;
   - descartável apagado.
4. **OK do Junior para publicar E para esta migration:**
   - dump e `ciclo_g23` com a migration e a volta;
   - `aplicar_migration.py producao`, com a migration antes do código;
   - push `main`;
   - alias de teste de volta;
   - `prova_login`.
5. **Depois de publicado,** o Junior apaga pela tela o agente de teste que criou em produção. Nada é apagado em produção pelo agente.

## Fora do escopo e limites declarados

- **Excluir pela lista de agentes:** só pela página do agente.
- **Lixeira ou restaurar agente:** a decisão foi excluir de vez.
- **Desligar número pela tela:** é do bloco 8. Hoje desligar número é pelo rito (`migrar-agentes.ts --desligar`).
- **Renomear modelo:** o editor do modelo já tem o campo nome.
- **G24:** o registro durável da exclusão não é um G24 completo; faltam alerta, retenção formal, integridade, responsável e exercício. Não fica PASS.
- **Resposta já em geração quando o número é desligado** (rodada 1, achado 4; rodada 2, nota 1): ver a resposta ao achado 4, abaixo. Tem uma janela em que excluir muda o tratamento: entre ler o vínculo do número e ler a versão publicada (`aiReply.ts`, `agentRuntime.ts`), se o agente for desligado **e excluído**, a leitura da versão devolve `agent_unavailable` e o webhook pode acionar o fallback, se configurado; sem a exclusão, a versão ainda carregaria. A mudança no fluxo de entrega fica para o bloco 8, como o Codex aceitou.

## Revisão do Codex, rodada 1 (09/10, NO-GO) — como ficou

Parecer literal no cérebro: `devolutiva-codex-1-renomear-excluir.md`.

| Achado | Como ficou |
|---|---|
| 1. Exclusão de um estado diferente do confirmado | **Aceito.** A função recebe nome, `draft_revision` e `published_version_id` esperados e compara sob o `FOR UPDATE`; diferença = `agente_mudou` (409). A tela manda o que mostrou, recarrega no 409 e pede nova confirmação. O renomear fica livre (vale o último), como o Codex aceitou. Testes de salvar, publicar e renomear concorrentes |
| 2. Registro contornável por RPC direta | **Aceito.** `ai_agent_deletions` gravada DENTRO da função, depois do `delete`, na mesma transação: falha no registro desfaz a exclusão. Testes da RPC direta (com o JWT, sem a rota) e da falha do registro. O log no servidor saiu (redundante). G24 **não** fica PASS por isso (limite declarado) |
| 3. A prova de corrida não alcançava o `exception` | **Aceito.** A SPEC descreve onde a espera acontece em cada ordem, e o teste prova as duas (com a espera conferida em `pg_stat_activity`). O `exception` fica como defesa a mais, restrito a `channel_connections_ai_agent_fk`, com `raise;` para o resto. Que ele funciona é provado pelas provas contrárias (sem a contagem, ele ainda devolve `agente_com_numero`; sem os dois, `23503`) |
| 4. Resposta em geração pode sair depois de desligar e excluir | **Não entra nesta entrega,** com o motivo. A corrida é do **desligar**: a fatia 1 já a tem hoje, sem exclusão nenhuma, porque o gate da entrega confere `aiEnabled`, não o agente. Excluir não a cria (para excluir é preciso desligar antes), mas **muda o tratamento numa janela rara** (corrigido na rodada 2, nota 1): se desligar e excluir acontecerem entre a leitura do vínculo e a leitura da versão, a geração cai em `agent_unavailable` e no fallback do webhook, se configurado. Fora dessa janela, a resposta que sairia é a mesma (o texto já foi gerado; `ai_reply_events` e a mensagem não têm FK para o agente). A correção sugerida mexe no caminho de entrega de todos os clientes, inclusive a Aurora em produção, e tem custo de produto: descartar a resposta deixa a mensagem do lead sem resposta, ou pede uma nova geração. Hoje desligar é um passo manual do rito, raro e com janela de segundos. **Fica registrado como limite, e entra no bloco 8,** quando desligar virar botão e a janela ficar comum |
| 5. Faltava `conversation_messages.metadata` em "O que fica" | **Aceito.** Na lista, e o teste local confere que a mensagem continua |
| 6. `publicada.versao` não garante a contagem | **Aceito.** A confirmação diz "todas as versões publicadas", sem número |
| 7. Ordem das recusas da rota | **Aceito.** A SPEC descreve a ordem real de `abrirRotaDoAgente` (UUID 400, origem 403, acesso, corpo), e o teste prova a combinação de origem recusada com UUID inválido (400). As duas recusas acontecem antes de qualquer leitura |

## Revisão do Codex, rodada 2 (09/10): GO para implementar

Parecer literal no cérebro: `devolutiva-codex-2-renomear-excluir.md`. Os bloqueios da rodada 1 fechados. As três notas entraram na v2.1:

| Nota | Como ficou |
|---|---|
| 1. "Excluir não a piora" não é verdade numa janela | Corrigido no limite declarado e na resposta ao achado 4: entre ler o vínculo e ler a versão, desligar e excluir levam a `agent_unavailable` e ao fallback do webhook. Fica para o bloco 8 |
| 2. Prazo de vida do registro e o nome guardado | Declarado: o registro acompanha o cliente (`on delete cascade` numa exclusão física; fica com a exclusão lógica). O nome do agente fica no registro, só para a chave de serviço; explicitado em "O que fica" |
| 3. Ressalva do G24 incompleta | A lista agora tem alerta, retenção formal, integridade, responsável e exercício. Não fica PASS |
