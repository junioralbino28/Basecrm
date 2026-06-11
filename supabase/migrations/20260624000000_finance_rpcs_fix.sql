-- =============================================================================
-- RELATÓRIOS FINANCEIROS — CORREÇÕES DO REVIEW ADVERSARIAL (F8) — fix RPCs
-- =============================================================================
-- create or replace das 3 RPCs de 20260621000000 mantendo assinatura e as 3
-- blindagens (search_path = '' · validação interna can_configure · revoke
-- public/anon + grant authenticated). NÃO regride nenhuma delas.
--
-- Achados corrigidos:
--   HIGH-1  get_net_result: contas fixas são MENSAIS mas entravam 1× cheio
--           independente do range — em "este ano" superestima lucro, em
--           "7 dias" mostra prejuízo falso. Fix: pró-ratear pela contagem de
--           meses cobertos pelo range no fuso SP (inclusivo). Rótulo da tela:
--           "contas fixas pró-rateadas por mês do período".
--   HIGH-2  get_net_result (taxas): config grava bandeira free-text ('Visa') e
--           atendimento grava lowercase ('visa') — comparação case-sensitive
--           zerava a taxa em silêncio. Fix: lower(trim()) nos DOIS lados.
--   HIGH-3  get_commission_report + get_net_result: regra de comissão por
--           especialidade era ignorada quando havia professional_id. NÃO existe
--           especialidade POR ATENDIMENTO no schema (atendimentos não tem
--           coluna specialty; professionals.specialty é a única — uma por
--           dentista). Fix honesto: a regra que casa specialty = p.specialty
--           (a do DENTISTA) vence a regra de specialty NULL no desempate. Até
--           existir especialidade por atendimento, "especialidade da regra casa
--           com a especialidade do dentista" — documentado aqui e na tela.
--   MEDIUM-8 get_commission_report: o join interno é INNER (só atendimento COM
--           dentista), então a "Receita" da tabela Profissionais diverge do
--           "Recebido bruto" do Financeiro sem explicação. Fix: devolver
--           sem_profissional { atendimentos, faturamento } dos atendimentos sem
--           professional_id no range, pra UI exibir o rodapé.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_commission_report — corrige desempate da regra (HIGH-3) + sem_profissional
-- (MEDIUM-8). Faturamento/comissão por profissional permanece via INNER join
-- (linha precisa de um profissional); os atendimentos órfãos saem num bloco à
-- parte para reconciliar com o Financeiro.
-- -----------------------------------------------------------------------------
create or replace function public.get_commission_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_period_start text;
  v_period_end text;
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null or not public.can_configure_organization(v_org) then
    raise exception 'acesso negado: agregados financeiros exigem permissão de administrador da organização';
  end if;

  -- períodos YYYY-MM cobertos pelo range, no fuso da clínica (comparação
  -- lexicográfica funciona no formato YYYY-MM)
  v_period_start := to_char(p_start at time zone 'America/Sao_Paulo', 'YYYY-MM');
  v_period_end := to_char(p_end at time zone 'America/Sao_Paulo', 'YYYY-MM');

  select json_build_object(
    'total_comissao', coalesce(sum(linha.comissao), 0),
    'por_profissional', coalesce(
      json_agg(
        json_build_object(
          'professional_id', linha.professional_id,
          'professional_name', linha.professional_name,
          'atendimentos', linha.atendimentos,
          'comissao', linha.comissao,
          'faturamento_base', linha.faturamento_base,
          'pago', linha.pago
        )
        order by linha.comissao desc
      ),
      '[]'::json
    ),
    -- MEDIUM-8: atendimentos recebidos SEM dentista no range (não entram na
    -- tabela por-profissional acima — INNER join). Reconcilia "Receita" da
    -- tabela com "Recebido bruto" do Financeiro.
    'sem_profissional', (
      select json_build_object(
        'atendimentos', count(*),
        'faturamento', coalesce(sum(sp.valor - sp.desconto), 0)
      )
      from public.atendimentos sp
      where sp.organization_id = v_org
        and sp.professional_id is null
        and sp.recebido = true
        and sp.paid_at >= p_start
        and sp.paid_at <= p_end
    )
  )
  into result
  from (
    select
      p.id as professional_id,
      p.name as professional_name,
      count(a.id) as atendimentos,
      coalesce(sum((a.valor - a.desconto) * regra.percent / 100), 0) as comissao,
      coalesce(sum(a.valor - a.desconto), 0) as faturamento_base,
      coalesce((
        select sum(cp.amount)
        from public.commission_payments cp
        where cp.organization_id = v_org
          and cp.professional_id = p.id
          and cp.period >= v_period_start
          and cp.period <= v_period_end
      ), 0) as pago
    from public.atendimentos a
    join public.professionals p
      on p.id = a.professional_id
     and p.organization_id = v_org
    left join lateral (
      select c.percent
      from public.commission_rules c
      where c.organization_id = v_org
        -- regra casa se: específica do profissional (e, se ela tem especialidade,
        -- a especialidade do DENTISTA bate) OU coringa por especialidade do
        -- dentista (sem professional_id). NÃO existe especialidade por
        -- atendimento no schema (atendimentos.specialty não existe;
        -- professionals.specialty é a única) — "especialidade da regra casa com
        -- a especialidade do dentista" até isso mudar.
        and (
          (c.professional_id = a.professional_id
            and (c.specialty is null or c.specialty = p.specialty))
          or (c.professional_id is null and c.specialty = p.specialty)
        )
      -- HIGH-3: desempate por especificidade — regra do profissional vence a
      -- coringa por especialidade; dentro de cada nível, a que casa a
      -- especialidade (specialty NOT NULL) vence a genérica; empate → mais recente.
      order by
        (c.professional_id is not null) desc,
        (c.specialty is not null and c.specialty = p.specialty) desc,
        c.created_at desc
      limit 1
    ) regra on true
    where a.organization_id = v_org
      and a.recebido = true
      and a.paid_at >= p_start
      and a.paid_at <= p_end
    group by p.id, p.name
  ) linha;

  return result;
end;
$$;

revoke all on function public.get_commission_report(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_commission_report(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_commission_report(timestamptz, timestamptz, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- get_net_result — pró-rateio de contas fixas (HIGH-1), normalização da
-- bandeira (HIGH-2) e mesmo desempate de comissão do report (HIGH-3).
-- -----------------------------------------------------------------------------
create or replace function public.get_net_result(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid default null
)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_faturamento numeric;
  v_comissoes numeric;
  v_taxas numeric;
  v_contas_mensal numeric;
  v_contas numeric;
  v_meses integer;
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null or not public.can_configure_organization(v_org) then
    raise exception 'acesso negado: agregados financeiros exigem permissão de administrador da organização';
  end if;

  -- Faturamento: atendimentos recebidos no range (valor − desconto)
  select coalesce(sum(a.valor - a.desconto), 0)
  into v_faturamento
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Comissões: regra ÚNICA por atendimento. Mesma lógica do get_commission_report:
  -- regra específica do profissional, especialidade do DENTISTA desempata (HIGH-3).
  select coalesce(sum((a.valor - a.desconto) * regra.percent / 100), 0)
  into v_comissoes
  from public.atendimentos a
  join public.professionals p
    on p.id = a.professional_id
   and p.organization_id = v_org
  left join lateral (
    select c.percent
    from public.commission_rules c
    where c.organization_id = v_org
      and (
        (c.professional_id = a.professional_id
          and (c.specialty is null or c.specialty = p.specialty))
        or (c.professional_id is null and c.specialty = p.specialty)
      )
    order by
      (c.professional_id is not null) desc,
      (c.specialty is not null and c.specialty = p.specialty) desc,
      c.created_at desc
    limit 1
  ) regra on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Taxas de cartão: payment_method_fees casando forma + bandeira + parcelas.
  -- HIGH-2: bandeira comparada normalizada (lower(trim)) — config grava free-text
  -- ('Visa') e atendimento grava lowercase ('visa'); sem isso o left join zerava
  -- a taxa em silêncio. coalesce p/ ambos os lados (sem cartão → '').
  select coalesce(sum((a.valor - a.desconto) * taxa.fee_percent / 100), 0)
  into v_taxas
  from public.atendimentos a
  left join lateral (
    select f.fee_percent
    from public.payment_method_fees f
    where f.organization_id = v_org
      and f.payment_type = a.payment_method
      and lower(trim(coalesce(f.card_brand, ''))) = lower(trim(coalesce(a.card_brand, '')))
      and f.installments = a.installments
    order by f.created_at desc
    limit 1
  ) taxa on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Contas fixas MENSAIS ativas (soma de uma mensalidade).
  select coalesce(sum(fc.amount), 0)
  into v_contas_mensal
  from public.fixed_costs fc
  where fc.organization_id = v_org
    and fc.active = true;

  -- HIGH-1: nº de meses-calendário cobertos pelo range no fuso SP (inclusivo).
  -- date_trunc('month') de start e end; diferença em meses + 1. "Este ano" →
  -- 12×; "7 dias" dentro de um mês → 1×; range cruzando 2 meses → 2×.
  v_meses := (
    (extract(year from date_trunc('month', p_end at time zone 'America/Sao_Paulo'))::int * 12
      + extract(month from date_trunc('month', p_end at time zone 'America/Sao_Paulo'))::int)
    - (extract(year from date_trunc('month', p_start at time zone 'America/Sao_Paulo'))::int * 12
      + extract(month from date_trunc('month', p_start at time zone 'America/Sao_Paulo'))::int)
  ) + 1;
  if v_meses < 1 then
    v_meses := 1;
  end if;

  v_contas := v_contas_mensal * v_meses;

  result := json_build_object(
    'faturamento', v_faturamento,
    'comissoes', v_comissoes,
    'taxas', v_taxas,
    'contas_fixas', v_contas,
    'contas_fixas_mensal', v_contas_mensal,
    'meses_periodo', v_meses,
    'liquido', v_faturamento - v_comissoes - v_taxas - v_contas
  );

  return result;
end;
$$;

revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_net_result(timestamptz, timestamptz, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- MEDIUM-5: unique parcial pra travar pagamento de comissão duplo no mesmo
-- (org, profissional, período). A ação "pagar" da tela Profissionais grava
-- period = mês do fim do range; sem esta unique, dois cliques (ou dois ranges
-- caindo no mesmo mês) gravavam dois pagamentos. A tela passa a travar "pagar"
-- a ranges de 1 mês e desabilitar o botão até o refetch; esta unique é o gate
-- duro no banco (defense-in-depth).
-- -----------------------------------------------------------------------------
create unique index if not exists uniq_commission_payments_org_prof_period
  on public.commission_payments(organization_id, professional_id, period);
