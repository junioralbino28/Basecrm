-- Pacote 3 / Bloco 4: uma fonte para comissão e remuneração fixa.

ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS product_id uuid,
  ADD COLUMN IF NOT EXISTS specialty_id uuid;

UPDATE public.commission_rules c
SET product_id = p.id
FROM public.products p
WHERE c.product_id IS NULL
  AND c.procedimento IS NOT NULL
  AND p.organization_id = c.organization_id
  AND lower(btrim(p.name)) = lower(btrim(c.procedimento));

UPDATE public.commission_rules c
SET specialty_id = s.id
FROM public.specialties s
WHERE c.specialty_id IS NULL
  AND c.specialty IS NOT NULL
  AND s.organization_id = c.organization_id
  AND lower(btrim(s.name)) = lower(btrim(c.specialty));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_product_same_org_fk') THEN
    ALTER TABLE public.commission_rules
      ADD CONSTRAINT commission_rules_product_same_org_fk
      FOREIGN KEY (organization_id, product_id)
      REFERENCES public.products (organization_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rules_specialty_same_org_fk') THEN
    ALTER TABLE public.commission_rules
      ADD CONSTRAINT commission_rules_specialty_same_org_fk
      FOREIGN KEY (organization_id, specialty_id)
      REFERENCES public.specialties (organization_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE public.commission_rules VALIDATE CONSTRAINT commission_rules_product_same_org_fk;
ALTER TABLE public.commission_rules VALIDATE CONSTRAINT commission_rules_specialty_same_org_fk;

CREATE INDEX IF NOT EXISTS idx_commission_rules_canonical_lookup
  ON public.commission_rules (
    organization_id, professional_id, product_id, specialty_id, valid_from DESC, created_at DESC, id
  );

CREATE OR REPLACE FUNCTION public.resolve_commission_amount(
  p_organization_id uuid,
  p_professional_id uuid,
  p_product_id uuid,
  p_procedure_name text,
  p_performed_at timestamptz,
  p_base_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rule public.commission_rules%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL OR p_professional_id IS NULL OR p_performed_at IS NULL THEN
    RETURN 0;
  END IF;

  SELECT c.* INTO v_rule
  FROM public.commission_rules c
  WHERE c.organization_id = p_organization_id
    AND c.valid_from <= (p_performed_at AT TIME ZONE 'America/Sao_Paulo')::date
    AND (c.professional_id IS NULL OR c.professional_id = p_professional_id)
    AND (
      (c.product_id IS NULL AND c.procedimento IS NULL)
      OR c.product_id = p_product_id
      OR (c.product_id IS NULL AND c.procedimento = p_procedure_name)
    )
    AND (
      c.specialty_id IS NULL
      OR (
        EXISTS (
          SELECT 1 FROM public.professional_specialties ps
          WHERE ps.organization_id = p_organization_id
            AND ps.professional_id = p_professional_id
            AND ps.specialty_id = c.specialty_id
        )
        AND (
          p_product_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.specialty_products sp
            WHERE sp.organization_id = p_organization_id
              AND sp.specialty_id = c.specialty_id
              AND sp.product_id = p_product_id
          )
        )
      )
    )
  ORDER BY
    (c.professional_id IS NOT NULL) DESC,
    (c.product_id IS NOT NULL OR c.procedimento IS NOT NULL) DESC,
    (c.specialty_id IS NOT NULL) DESC,
    c.valid_from DESC,
    c.created_at DESC,
    c.id DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN 0; END IF;
  IF v_rule.amount_type = 'fixed' THEN RETURN v_rule.amount; END IF;
  RETURN greatest(coalesce(p_base_amount, 0), 0) * v_rule.amount / 100;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_commission_amount(uuid, uuid, uuid, text, timestamptz, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_commission_amount(uuid, uuid, uuid, text, timestamptz, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fixed_compensation_for_period(
  p_organization_id uuid,
  p_professional_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(sum(
    CASE WHEN v.active AND v.pay_type IN ('fixed', 'both')
      THEN v.fixed_amount / extract(day FROM (date_trunc('month', d.d) + interval '1 month - 1 day'))
      ELSE 0
    END
  ), 0)
  FROM generate_series(
    (p_start AT TIME ZONE 'America/Sao_Paulo')::date,
    (p_end AT TIME ZONE 'America/Sao_Paulo')::date,
    interval '1 day'
  ) d(d)
  LEFT JOIN LATERAL (
    SELECT cv.active, cv.pay_type, cv.fixed_amount
    FROM public.professional_compensation_versions cv
    WHERE cv.organization_id = p_organization_id
      AND cv.professional_id = p_professional_id
      AND cv.valid_from <= d.d::date
    ORDER BY cv.valid_from DESC, cv.created_at DESC, cv.id DESC
    LIMIT 1
  ) v ON true;
$$;

REVOKE ALL ON FUNCTION public.fixed_compensation_for_period(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixed_compensation_for_period(uuid, uuid, timestamptz, timestamptz)
  TO service_role;

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

  v_period_start := to_char(p_start AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
  v_period_end := to_char(p_end AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');

  WITH linhas AS (
    SELECT
      p.id AS professional_id,
      p.name AS professional_name,
      p.role,
      p.pay_type,
      count(a.id) AS atendimentos,
      coalesce(sum(public.resolve_commission_amount(
        v_org, p.id, a.product_id, a.procedimento, a.performed_at,
        a.valor - a.desconto
      )), 0) AS comissao,
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
    'sem_profissional', (SELECT json_build_object(
      'atendimentos', count(*),
      'faturamento', coalesce(sum(sp.valor - sp.desconto), 0)
    ) FROM public.atendimentos sp
      WHERE sp.organization_id = v_org AND sp.professional_id IS NULL
        AND sp.recebido = true AND sp.paid_at >= p_start AND sp.paid_at <= p_end)
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
  v_comissoes numeric;
  v_salarios_fixos numeric;
  v_taxas numeric;
  v_contas_mensal numeric;
  v_contas numeric;
  v_meses integer;
BEGIN
  v_org := coalesce(p_organization_id, public.current_profile_organization_id());
  IF v_org IS NULL OR NOT public.can_access_organization(v_org)
    OR NOT public.has_permission('reports.finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;

  SELECT coalesce(sum(public.resolve_commission_amount(
    v_org, a.professional_id, a.product_id, a.procedimento, a.performed_at,
    a.valor - a.desconto
  )), 0) INTO v_comissoes
  FROM public.atendimentos a
  WHERE a.organization_id = v_org AND a.professional_id IS NOT NULL
    AND a.performed_at >= p_start AND a.performed_at <= p_end;

  SELECT coalesce(sum(public.fixed_compensation_for_period(v_org, p.id, p_start, p_end)), 0)
  INTO v_salarios_fixos FROM public.professionals p WHERE p.organization_id = v_org;

  SELECT coalesce(sum(a.valor - a.desconto), 0) INTO v_faturamento
  FROM public.atendimentos a WHERE a.organization_id = v_org AND a.recebido = true
    AND a.paid_at >= p_start AND a.paid_at <= p_end;

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

  SELECT coalesce(sum(fc.amount), 0) INTO v_contas_mensal
  FROM public.fixed_costs fc WHERE fc.organization_id = v_org AND fc.active = true;
  v_meses := greatest(1,
    (extract(year FROM p_end AT TIME ZONE 'America/Sao_Paulo')::int * 12
      + extract(month FROM p_end AT TIME ZONE 'America/Sao_Paulo')::int)
    - (extract(year FROM p_start AT TIME ZONE 'America/Sao_Paulo')::int * 12
      + extract(month FROM p_start AT TIME ZONE 'America/Sao_Paulo')::int) + 1);
  v_contas := v_contas_mensal * v_meses;

  RETURN json_build_object(
    'faturamento', v_faturamento,
    'comissoes', v_comissoes,
    'salarios_fixos', v_salarios_fixos,
    'remuneracao_total', v_comissoes + v_salarios_fixos,
    'taxas', v_taxas,
    'contas_fixas', v_contas,
    'contas_fixas_mensal', v_contas_mensal,
    'meses_periodo', v_meses,
    'liquido', v_faturamento - v_comissoes - v_salarios_fixos - v_taxas - v_contas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_commission_report(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_net_result(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_commission_report(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_net_result(timestamptz, timestamptz, uuid) TO authenticated;
