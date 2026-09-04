-- R-01 + R-08 (docs/REVIEW-CORRECOES-PACOTE-3.md). Decisão do Junior em 04/09:
-- cada relatório numa régua só, e nunca subtrair uma régua da outra.
--
--   Comercial      -> mês em que o lead virou ganho no funil (fora deste arquivo)
--   Profissionais  -> COMPETÊNCIA: o que cada colaborador tem a receber pelo que
--                     atendeu no período (performed_at)
--   Financeiro     -> CAIXA: só dinheiro que entrou e saiu no período
--
-- R-01: o bloco `sem_profissional` de get_commission_report ainda contava por
-- caixa (recebido + paid_at) dentro de um relatório que já era por competência.
-- Um atendimento sem colaborador feito em 30/06 e pago em 02/07 sumia de junho
-- e aparecia em julho. Passa a contar por performed_at, como as linhas.
--
-- R-08: get_net_result subtraía comissão e salário DEVIDOS (competência) da
-- receita RECEBIDA (caixa). Com parcelamento em 10x, o mês do atendimento
-- carregava 100% da comissão e 10% da receita: negativo estrutural sem nada
-- quebrado. Passa a ser caixa puro: o que saiu para a equipe é o que foi PAGO
-- no período (commission_payments.paid_at; a RPC de pagamento quita fixo e
-- comissão juntos). Comissão devida e salário do período continuam no
-- relatório de Profissionais, que é a régua certa para eles.
--
-- Contas fixas: o produto não registra pagamento delas; continuam como
-- estimativa mensal × meses do período, declarada no contrato (`regime`).
--
-- Cabeçalhos de segurança preservados nas duas funções (conferidos no catálogo
-- antes de reescrever): STABLE SECURITY DEFINER, search_path = '', gates
-- can_access_organization + reports.professionals / reports.finance.

CREATE OR REPLACE FUNCTION public.get_commission_report(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_period_start text;
  v_period_end text;
  result json;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());
  IF v_org IS NULL OR NOT public.can_access_organization(v_org)
    OR NOT public.has_permission('reports.professionals') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'período inválido';
  END IF;

  v_period_start := to_char(p_start AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  v_period_end := to_char(p_end AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');

  WITH linhas AS (
    SELECT
      p.id AS professional_id,
      p.name AS professional_name,
      p.role,
      p.pay_type,
      count(a.id) AS atendimentos,
      coalesce(sum(a.commission_amount), 0) AS comissao,
      public.fixed_compensation_for_period(v_org, p.id, p_start, p_end) AS fixo,
      coalesce(sum(a.valor - a.desconto), 0) AS faturamento_base,
      coalesce((SELECT sum(cp.amount) FROM public.commission_payments cp
        WHERE cp.organization_id = v_org AND cp.professional_id = p.id
          AND cp.period >= v_period_start AND cp.period <= v_period_end), 0) AS pago
    FROM public.professionals p
    LEFT JOIN public.atendimentos a
      ON a.organization_id = v_org
     AND a.professional_id = p.id
     AND a.performed_at >= p_start
     AND a.performed_at <= p_end
    WHERE p.organization_id = v_org
      AND (
        p.active = true OR a.id IS NOT NULL OR EXISTS (
          SELECT 1 FROM public.commission_payments cp
          WHERE cp.organization_id = v_org AND cp.professional_id = p.id
            AND cp.period >= v_period_start AND cp.period <= v_period_end
        ) OR EXISTS (
          SELECT 1
          FROM public.professional_compensation_versions cv
          WHERE cv.organization_id = v_org
            AND cv.professional_id = p.id
            AND cv.active = true
            AND cv.pay_type IN ('fixed', 'both')
            AND cv.valid_from <= (p_end AT TIME ZONE 'America/Sao_Paulo')::date
            AND coalesce((
              SELECT min(next_cv.valid_from)
              FROM public.professional_compensation_versions next_cv
              WHERE next_cv.organization_id = cv.organization_id
                AND next_cv.professional_id = cv.professional_id
                AND next_cv.valid_from > cv.valid_from
            ), 'infinity'::date) > (p_start AT TIME ZONE 'America/Sao_Paulo')::date
        )
      )
    GROUP BY p.id, p.name, p.role, p.pay_type
  )
  SELECT json_build_object(
    'total_comissao', coalesce(sum(l.comissao), 0),
    'total_fixo', coalesce(sum(l.fixo), 0),
    'total_remuneracao', coalesce(sum(l.comissao + l.fixo), 0),
    'por_profissional', coalesce(json_agg(json_build_object(
      'professional_id', l.professional_id,
      'professional_name', l.professional_name,
      'role', l.role,
      'pay_type', l.pay_type,
      'fixed_amount', l.fixo,
      'atendimentos', l.atendimentos,
      'comissao', l.comissao,
      'remuneracao_total', l.comissao + l.fixo,
      'faturamento_base', l.faturamento_base,
      'pago', l.pago
    ) ORDER BY (l.comissao + l.fixo) DESC, l.professional_name), '[]'::json),
    -- R-01: mesma régua das linhas (competência por performed_at), sem exigir
    -- recebimento. Antes contava por recebido + paid_at.
    'sem_profissional', (SELECT json_build_object(
      'atendimentos', count(*),
      'faturamento', coalesce(sum(sp.valor - sp.desconto), 0)
    ) FROM public.atendimentos sp
      WHERE sp.organization_id = v_org AND sp.professional_id IS NULL
        AND sp.performed_at >= p_start AND sp.performed_at <= p_end)
  ) INTO result
  FROM linhas l;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_net_result(
  p_start timestamptz,
  p_end timestamptz,
  p_organization_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_faturamento numeric;
  v_taxas numeric;
  v_remuneracao_paga numeric;
  v_contas_mensal numeric;
  v_contas numeric;
  v_meses integer;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());
  IF v_org IS NULL OR NOT public.can_access_organization(v_org)
    OR NOT public.has_permission('reports.finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'período inválido';
  END IF;

  -- Entradas: o que o cliente pagou no período (data do pagamento).
  SELECT coalesce(sum(a.valor - a.desconto), 0) INTO v_faturamento
  FROM public.atendimentos a WHERE a.organization_id = v_org AND a.recebido = true
    AND a.paid_at >= p_start AND a.paid_at <= p_end;

  -- Taxas sobre o que entrou (forma + bandeira + parcelas, normalizadas).
  SELECT coalesce(sum((a.valor - a.desconto) * taxa.fee_percent / 100), 0) INTO v_taxas
  FROM public.atendimentos a
  LEFT JOIN LATERAL (
    SELECT f.fee_percent FROM public.payment_method_fees f
    WHERE f.organization_id = v_org AND f.payment_type = a.payment_method
      AND lower(btrim(coalesce(f.card_brand, ''))) = lower(btrim(coalesce(a.card_brand, '')))
      AND f.installments = a.installments ORDER BY f.created_at DESC LIMIT 1
  ) taxa ON true
  WHERE a.organization_id = v_org AND a.recebido = true
    AND a.paid_at >= p_start AND a.paid_at <= p_end;

  -- Saídas para a equipe: o que foi PAGO no período (fixo + comissão juntos,
  -- como a RPC de pagamento quita). O devido por competência fica em
  -- get_commission_report.
  SELECT coalesce(sum(cp.amount), 0) INTO v_remuneracao_paga
  FROM public.commission_payments cp
  WHERE cp.organization_id = v_org
    AND cp.paid_at >= p_start AND cp.paid_at <= p_end;

  -- Contas fixas: estimativa mensal × meses do período (sem registro de pagamento).
  SELECT coalesce(sum(fc.amount), 0) INTO v_contas_mensal
  FROM public.fixed_costs fc WHERE fc.organization_id = v_org AND fc.active = true;
  v_meses := greatest(1,
    (extract(year FROM p_end AT TIME ZONE 'America/Sao_Paulo')::int * 12
      + extract(month FROM p_end AT TIME ZONE 'America/Sao_Paulo')::int)
    - (extract(year FROM p_start AT TIME ZONE 'America/Sao_Paulo')::int * 12
      + extract(month FROM p_start AT TIME ZONE 'America/Sao_Paulo')::int) + 1);
  v_contas := v_contas_mensal * v_meses;

  RETURN json_build_object(
    'regime', 'caixa',
    'faturamento', v_faturamento,
    'taxas', v_taxas,
    'remuneracao_paga', v_remuneracao_paga,
    'contas_fixas', v_contas,
    'contas_fixas_mensal', v_contas_mensal,
    'meses_periodo', v_meses,
    'liquido', v_faturamento - v_taxas - v_remuneracao_paga - v_contas
  );
END;
$$;

-- Superfície inalterada; reafirmada por segurança (idempotente).
REVOKE ALL ON FUNCTION public.get_commission_report(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_net_result(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_report(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_net_result(timestamptz, timestamptz, uuid) TO authenticated;
