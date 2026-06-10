-- =============================================================================
-- RELATÓRIOS FINANCEIROS — RPCs (faturamento · comissão · líquido) — F8
-- =============================================================================
-- security definer FURA RLS. Blindagens (advisor Supabase, espelha o hardening
-- das funções legadas):
--   (a) set search_path = '' — TODA referência é schema-qualificada;
--   (b) validação INTERNA: a org efetiva (param opcional OU a do caller via
--       public.current_profile_organization_id()) passa por
--       public.can_configure_organization() — agregado financeiro é dado do
--       Adel; clinic_staff NÃO obtém (erro), clinic_admin/agency_admin sim;
--   (c) revoke de public/anon + grant execute só para authenticated
--       (a checagem interna barra quem não pode).
--
-- Fronteira de dia/mês no fuso da clínica (consideração do review F4):
-- agregações por mês/semana convertem paid_at para America/Sao_Paulo — um
-- pagamento às 23h de terça NÃO cai na quarta.
--
-- Faturamento = SÓ recebido = true (paid_at no range) e o valor real é
-- valor − desconto (o líquido não é persistido — lição F4).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. get_revenue_report — faturamento (valor − desconto) de atendimentos
--    RECEBIDOS com paid_at no range + breakdown por mês e por semana (fuso SP).
-- -----------------------------------------------------------------------------
create or replace function public.get_revenue_report(
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
  result json;
begin
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());

  if v_org is null or not public.can_configure_organization(v_org) then
    raise exception 'acesso negado: agregados financeiros exigem permissão de administrador da organização';
  end if;

  select json_build_object(
    'faturamento', coalesce(sum(a.valor - a.desconto), 0),
    'total_atendimentos', count(*),
    'por_mes', coalesce((
      select json_agg(m order by m->>'mes')
      from (
        select json_build_object(
          'mes', to_char(date_trunc('month', a2.paid_at at time zone 'America/Sao_Paulo'), 'YYYY-MM'),
          'faturamento', coalesce(sum(a2.valor - a2.desconto), 0)
        ) as m
        from public.atendimentos a2
        where a2.organization_id = v_org
          and a2.recebido = true
          and a2.paid_at >= p_start
          and a2.paid_at <= p_end
        group by date_trunc('month', a2.paid_at at time zone 'America/Sao_Paulo')
      ) sub
    ), '[]'::json),
    'por_semana', coalesce((
      select json_agg(s order by s->>'semana')
      from (
        select json_build_object(
          'semana', to_char(date_trunc('week', a3.paid_at at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD'),
          'faturamento', coalesce(sum(a3.valor - a3.desconto), 0),
          'atendimentos', count(*)
        ) as s
        from public.atendimentos a3
        where a3.organization_id = v_org
          and a3.recebido = true
          and a3.paid_at >= p_start
          and a3.paid_at <= p_end
        group by date_trunc('week', a3.paid_at at time zone 'America/Sao_Paulo')
      ) sub2
    ), '[]'::json)
  )
  into result
  from public.atendimentos a
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  return result;
end;
$$;

revoke all on function public.get_revenue_report(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_revenue_report(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_revenue_report(timestamptz, timestamptz, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. get_commission_report — comissão por profissional no range + "Paga"
--    (commission_payments do(s) período(s) YYYY-MM cobertos pelo range, fuso SP).
--    A regra é ÚNICA por atendimento (lateral limit 1): regra específica do
--    profissional vence a regra por especialidade — evita dupla contagem
--    quando as duas existem ("o sistema acha a regra certa").
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
        and (
          c.professional_id = a.professional_id
          or (c.professional_id is null and c.specialty = p.specialty)
        )
      order by (c.professional_id is not null) desc, c.created_at desc
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
-- 3. get_net_result — líquido = faturamento(recebido no range)
--    − comissões(regra única por atendimento) − taxas de cartão
--    (payment_method_fees por forma+bandeira+parcelas, base valor − desconto)
--    − contas fixas ativas (mensais — relatório é mês-orientado).
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
  v_contas numeric;
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

  -- Comissões: regra ÚNICA por atendimento (específica > especialidade)
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
        c.professional_id = a.professional_id
        or (c.professional_id is null and c.specialty = p.specialty)
      )
    order by (c.professional_id is not null) desc, c.created_at desc
    limit 1
  ) regra on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Taxas de cartão: payment_method_fees casando forma + bandeira + parcelas
  -- (taxa única por atendimento — lateral limit 1 evita dupla contagem)
  select coalesce(sum((a.valor - a.desconto) * taxa.fee_percent / 100), 0)
  into v_taxas
  from public.atendimentos a
  left join lateral (
    select f.fee_percent
    from public.payment_method_fees f
    where f.organization_id = v_org
      and f.payment_type = a.payment_method
      and coalesce(f.card_brand, '') = coalesce(a.card_brand, '')
      and f.installments = a.installments
    order by f.created_at desc
    limit 1
  ) taxa on true
  where a.organization_id = v_org
    and a.recebido = true
    and a.paid_at >= p_start
    and a.paid_at <= p_end;

  -- Contas fixas: soma das despesas fixas ativas da organização
  select coalesce(sum(fc.amount), 0)
  into v_contas
  from public.fixed_costs fc
  where fc.organization_id = v_org
    and fc.active = true;

  result := json_build_object(
    'faturamento', v_faturamento,
    'comissoes', v_comissoes,
    'taxas', v_taxas,
    'contas_fixas', v_contas,
    'liquido', v_faturamento - v_comissoes - v_taxas - v_contas
  );

  return result;
end;
$$;

revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from public;
revoke all on function public.get_net_result(timestamptz, timestamptz, uuid) from anon;
grant execute on function public.get_net_result(timestamptz, timestamptz, uuid) to authenticated;
