-- =============================================================================
-- Funil "Consultoria de Diagnóstico" — Cenno Hub (downsell do gate de capacidade)
-- =============================================================================
-- Decisão do Junior (27/09/2026): a consultoria é produto próprio, então é um
-- SEGUNDO funil — não etapas enfiadas no CASA. Fonte:
-- WorkSync/workspaces/CENNO HUB/docs/campanha/FUNIL-AURORA-GATE-E-CONSULTORIA.md
--
-- Isto é SEED DE DADO de um tenant (org Cenno Hub), não migration de schema:
-- roda uma vez em cada banco (teste primeiro, produção com o "pode"), via
-- execute_sql, nunca via db push. Reversível: delete do board cascateia etapas.
--
-- Etapas: Oferecida -> Paga -> Feita -> Virou mensalidade (ganho) / Perdida (perda).
-- As duas finais medem a conversão do crédito — o número que a campanha vai ler.
-- v1: movimentação manual; a automação de movimento entra com a rota 2.

do $$
declare
  -- ESCOLHA O BANCO antes de rodar (id e nome sao verificados juntos logo abaixo;
  -- id de um banco rodado no outro estoura em vez de criar no lugar errado):
  --   producao (eqidsihasmwwamkaqfka): fdab204e-d85e-467c-b6c2-e6e00d088621 / 'Cenno Hub'
  --   teste    (zvwngsrflkicbbzfmrgy): bd43a9bc-5bab-410a-a5a6-c214f3836f0e / 'BaseCRM - Ambiente de Teste Pacote 3'
  v_org uuid := 'bd43a9bc-5bab-410a-a5a6-c214f3836f0e';
  v_nome_esperado text := 'BaseCRM - Ambiente de Teste Pacote 3';
  v_nome text;
  v_board uuid;
  v_won uuid;
  v_lost uuid;
begin
  select name into v_nome from public.organizations where id = v_org;
  if v_nome is distinct from v_nome_esperado then
    raise exception 'org % nao e a esperada neste banco (achei: %)', v_org, coalesce(v_nome, 'nada');
  end if;

  if exists (
    select 1 from public.boards
    where organization_id = v_org and key = 'consultoria-diagnostico' and deleted_at is null
  ) then
    raise exception 'board consultoria-diagnostico ja existe nesta organizacao';
  end if;

  insert into public.boards
    (key, name, description, type, is_default, template, linked_lifecycle_stage, position, organization_id)
  values
    ('consultoria-diagnostico',
     'Consultoria de Diagnóstico',
     'Downsell do gate de capacidade: R$997 (60 min + plano escrito + grupo de 1 mês). Vira crédito se fechar a mensalidade em até 1 mês.',
     'SALES', false, 'CUSTOM', 'LEAD', 1, v_org)
  returning id into v_board;

  insert into public.board_stages (board_id, name, label, color, "order", organization_id, linked_lifecycle_stage) values
    (v_board, 'Oferecida', 'Oferecida', 'bg-orange-500', 0, v_org, 'PROSPECT'),
    (v_board, 'Paga',      'Paga',      'bg-teal-500',   1, v_org, 'CUSTOMER'),
    (v_board, 'Feita',     'Feita',     'bg-purple-500', 2, v_org, 'CUSTOMER');

  insert into public.board_stages (board_id, name, label, color, "order", organization_id, linked_lifecycle_stage)
  values (v_board, 'Virou mensalidade', 'Virou mensalidade', 'bg-green-500', 3, v_org, 'CUSTOMER')
  returning id into v_won;

  insert into public.board_stages (board_id, name, label, color, "order", organization_id, linked_lifecycle_stage)
  values (v_board, 'Perdida', 'Perdida', 'bg-red-500', 4, v_org, 'OTHER')
  returning id into v_lost;

  update public.boards
  set won_stage_id = v_won, lost_stage_id = v_lost, updated_at = now()
  where id = v_board;

  -- Provas: 5 etapas, ganho e perda amarrados.
  if (select count(*) from public.board_stages where board_id = v_board) <> 5 then
    raise exception 'esperava 5 etapas no funil da consultoria';
  end if;
  if (select won_stage_id is null or lost_stage_id is null from public.boards where id = v_board) then
    raise exception 'won/lost do funil da consultoria ficaram sem amarrar';
  end if;
end $$;
