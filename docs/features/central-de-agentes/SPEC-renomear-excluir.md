# Central de Agentes — renomear e excluir agente (SPEC curta + plano)

Decisão do Junior (09/10/2026 ~16h55), depois de criar um agente de teste em produção e não ter como apagar:
- **excluir de vez:** somem o agente, o rascunho e as versões; as conversas e o histórico de respostas continuam;
- agente com número ligado não exclui: a tela pede para desligar o número antes;
- confirmação antes de apagar;
- **agora, antes do bloco 3**, junto com o renomear, pelo rito de sempre: Codex, ensaio no teste, OK para publicar e para a migration (regra 4).

O renomear e o excluir tinham ficado fora do bloco 2 (`SPEC-bloco-2.md`, "fora do escopo") e de todos os blocos do roteiro.

## O que muda para quem usa

Na página do agente (só agência, como todo o editor):
- **Renomear:** um botão de lápis ao lado do nome abre o diálogo "Renomear agente", com o campo "Nome do agente" (1 a 80 caracteres, sem espaço nas pontas). Salvar troca o nome na hora.
- **Excluir:** o botão "Excluir" no cabeçalho fica travado durante a edição do texto, com o motivo "Salve ou cancele a edição antes de excluir." Ele abre um diálogo:
  - **com número ligado:** "Este agente atende {n} número(s): {nomes}. Desligue o número antes de excluir." Só o botão Fechar; nada é enviado;
  - **sem número:** "Excluir o agente {nome}? Somem o agente, o rascunho e {as N versões publicadas | a versão publicada | (nada, se não houver)}. As conversas e o histórico de respostas continuam. Não dá para desfazer." Botões Cancelar e **"Excluir de vez"**. No sucesso: aviso "Agente excluído." e volta para a lista de agentes do cliente.
- **Corrida:** se o número for ligado entre abrir o diálogo e confirmar, o servidor recusa com 409. O diálogo mostra a mensagem do servidor e recarrega o agente.

## Banco: migration `20261009180000_central_agentes_renomear_excluir.sql`

- **ADITIVA:** só duas funções novas; nenhuma tabela muda.
- **Sem barra invertida no arquivo.**
- **Cabeçalho igual ao das funções do bloco 2:**
  - `security definer`, `set search_path = ''`;
  - gate `is_agency_admin_role()` (`42501`) antes da primeira leitura;
  - organização de destino com `deleted_at is null` e `for share` (`cliente_inexistente`, `P0002`);
  - `revoke all ... from public, anon, authenticated, service_role` e `grant execute ... to authenticated`.

```sql
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

create or replace function public.delete_ai_agent(p_organization_id uuid, p_agent_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_numeros integer;
  v_versoes integer;
begin
  if not public.is_agency_admin_role() then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = p_organization_id and o.deleted_at is null for share;
  if not found then
    raise exception 'cliente_inexistente' using errcode = 'P0002';
  end if;
  -- FOR UPDATE: duas exclusões, ou exclusão e salvamento do rascunho, não se cruzam.
  perform 1 from public.ai_agents a where a.organization_id = p_organization_id and a.id = p_agent_id for update;
  if not found then
    raise exception 'agente_inexistente' using errcode = 'P0002';
  end if;
  select count(*) into v_numeros from public.channel_connections c
   where c.organization_id = p_organization_id and c.ai_agent_id = p_agent_id;
  if v_numeros > 0 then
    raise exception 'agente_com_numero' using errcode = 'P0001', detail = v_numeros::text;
  end if;
  select count(*) into v_versoes from public.ai_agent_versions v
   where v.organization_id = p_organization_id and v.agent_id = p_agent_id;
  -- A FK de channel_connections (on delete no action) é a rede: um número ligado por outra transação entre a
  -- contagem e o delete faz o delete falhar, e a falha vira o mesmo erro da tela.
  begin
    delete from public.ai_agents a where a.organization_id = p_organization_id and a.id = p_agent_id;
  exception when foreign_key_violation then
    raise exception 'agente_com_numero' using errcode = 'P0001';
  end;
  return v_versoes;
end;
$$;
```

O que o `delete` leva junto:
- As versões, pela FK `on delete cascade` da fundação. O gatilho das versões não recusa `delete`, de propósito: a fundação já previa a cascata de apagar um agente sem número.

O que fica:
- **`ai_reply_events.agent_id`:** sem FK, o histórico de respostas fica com o id.
- **Origem de modelos e agentes copiados:** a `origin` de quem nasceu deste agente (modelo salvo dele, cópia dele) é JSON e fica como prova de derivação.
- **Cópia local da tela:** a cópia de recuperação do rascunho em outra aba fica até expirar (7 dias). Ao abrir, o agente não existe mais e a tela mostra "Agente não encontrado".

**Volta (`docs/features/central-de-agentes/volta-renomear-excluir.sql`):**
- `begin`, `drop function` das duas, `delete` da linha `20261009180000` em `supabase_migrations.schema_migrations`, `commit`;
- o código que chama as funções sai do ar antes;
- a volta não devolve agentes apagados enquanto as funções estiveram no ar: para isso existe o dump do rito.

## Servidor e rotas

**`lib/agents/editorAgentes.ts`:**
- `renomearAgente(c, { tenantId, agentId, nome })`: `c.usuario.rpc('rename_ai_agent')`, devolve `{ nome }`;
- `excluirAgente(c, { tenantId, agentId, usuarioId })`: `c.usuario.rpc('delete_ai_agent')`, devolve `{ versoesExcluidas }`;
- nenhuma das duas usa `c.admin`;
- `ERROS_DO_BANCO` ganha `agente_com_numero`: 409 `AGENTE_COM_NUMERO`, "Este agente atende um número. Desligue o número dele antes de excluir.";
- a exclusão bem-sucedida registra no log do servidor uma linha estruturada (G24), só com ids e números: organização, agente, quem excluiu e quantas versões; nenhum texto do agente.

**`app/api/platform/tenants/[tenantId]/agents/[agentId]/route.ts`:**
- ganha `PATCH` (corpo estrito `{ nome: string }`, até 200 caracteres no zod; o banco confere 1 a 80 depois do `btrim`) e `DELETE` (sem corpo);
- os dois abrem com `abrirRotaDoAgente(req, params, { escreve: true })`: origem (`isAllowedOrigin`, 403), id do agente como UUID (400) e `requireTenantAccess(tenantId, { adminOnly: true })`;
- respostas: 200 `{ nome }` e 200 `{ excluido: true, versoesExcluidas }`.

**`features/agents/agentesApi.ts`:** `renomear(tenantId, agenteId, nome)` e `excluir(tenantId, agenteId)`.

## Tela

- **`features/agents/AgentEditorPage.tsx`:** o lápis de "Renomear agente" ao lado do `h1` e o botão "Excluir" no cabeçalho.
- **Diálogos novos:** `features/agents/DialogoRenomearAgente.tsx` e `features/agents/DialogoExcluirAgente.tsx`, com o `Modal` do app.
- **Contagem de versões do texto:** é a `versao` da publicada. As versões são numeradas em sequência e a restauração cria versão nova, então a publicada é sempre a última.

## Testes, com o que cada um prova

1. **Contrato estático da migration** (`test/centralAgentesRenomearExcluirMigration.test.ts`):
   - o cabeçalho das duas;
   - o gate antes da primeira leitura;
   - revoke e grant;
   - `for update` no agente, a contagem de números antes do `delete` e o `exception when foreign_key_violation`;
   - nenhuma barra invertida e nenhum `alter`, `drop` ou `delete` fora da função.
2. **Local, no Supabase de verdade** (`test/centralAgentesRenomearExcluir.local.test.ts`, JWT real):
   - renomear: apara o nome; `nome_invalido` com vazio e com 81; agente de outro cliente dá `agente_inexistente`; cliente apagado dá `cliente_inexistente`; `clinic_admin` e `agency_staff` dão `42501`;
   - excluir sem número: o agente e as versões somem, a função devolve o número de versões, e a `origin` de um modelo salvo dele continua;
   - excluir com número: `agente_com_numero`, e o agente continua;
   - **corrida, com duas conexões `pg`:**
     - T1 liga o número sem fazer commit;
     - T2 chama a exclusão, que passa pela contagem e espera na FK;
     - T1 faz commit;
     - T2 recebe `agente_com_numero`, e o agente continua;
   - agente de outro cliente dá `agente_inexistente`; `42501` para quem não é agência;
   - catálogo: nenhuma FK de `ai_reply_events` para `ai_agents`;
   - **provas contrárias:** sem o `exception when foreign_key_violation`, a corrida sai com `23503` cru; sem a contagem, o caso "com número" também sai com `23503`.
3. **Camada:** as duas funções chamam `c.usuario.rpc` com `c.admin` como `Proxy` que lança erro; o 409 é traduzido; dado fora do tipo vira 500.
4. **Rota:**
   - `PATCH` e `DELETE` com origem recusada dão 403 sem chamar nada;
   - agente fora do formato UUID dá 400;
   - corpo inválido no `PATCH` (sobra de campo, tipo errado) dá 400;
   - sucesso com a forma da resposta.
5. **Tela:**
   - renomear manda o `PATCH` e o cabeçalho troca;
   - excluir com número mostra o bloqueio, sem botão de excluir, e nenhum pedido sai;
   - excluir sem número manda o `DELETE`, avisa e volta para a lista;
   - 409 do servidor mostra a mensagem e recarrega o agente;
   - em edição, "Excluir" fica travado com o motivo.

Suíte completa, tsc, lint e build antes de cada commit, com o resultado lido em comando separado.

## Rito

1. Codex: esta SPEC.
2. Implementação e revisão de código do Codex.
3. **Ensaio no banco de teste:**
   - migration pelo `aplicar_migration.py teste`, com a entrada no manifesto;
   - push em `feat/aurora-implantacao`;
   - prévia provada pelo login;
   - telas com descartável: renomear um agente do ensaio do bloco 2; excluir outro; tentar excluir a Aurora de teste, que tem número, e ver o bloqueio;
   - contagens;
   - descartável apagado.
4. **OK do Junior para publicar E para esta migration:**
   - dump, `ciclo_g23` com a migration e a volta;
   - `aplicar_migration.py producao`, com a migration antes do código;
   - push `main`;
   - alias de teste de volta;
   - `prova_login`.
5. **Depois de publicado,** o Junior apaga pela tela o agente de teste que criou em produção. Nada é apagado em produção pelo agente.

## Fora do escopo

- Excluir pela lista de agentes: só pela página do agente.
- Lixeira ou restaurar agente: a decisão foi excluir de vez.
- Desligar número pela tela: é do bloco 8. Hoje desligar número é pelo rito (`migrar-agentes.ts --desligar`).
- Renomear modelo: o editor do modelo já tem o campo nome.
