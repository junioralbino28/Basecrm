-- `pay_type = fixed` significa somente remuneração fixa. O resolvedor anterior
-- aplicava qualquer regra de comissão encontrada, mesmo para esse contrato.

CREATE OR REPLACE FUNCTION public.professional_pay_type_at(
  p_organization_id uuid,
  p_professional_id uuid,
  p_performed_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (
      SELECT cv.pay_type
      FROM public.professional_compensation_versions cv
      WHERE cv.organization_id = p_organization_id
        AND cv.professional_id = p_professional_id
        AND cv.valid_from <= (p_performed_at AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY cv.valid_from DESC, cv.created_at DESC, cv.id DESC
      LIMIT 1
    ),
    (
      SELECT p.pay_type
      FROM public.professionals p
      WHERE p.organization_id = p_organization_id
        AND p.id = p_professional_id
    ),
    'commission'
  );
$$;

REVOKE ALL ON FUNCTION public.professional_pay_type_at(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.professional_pay_type_at(uuid, uuid, timestamptz)
  TO service_role;

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

  IF public.professional_pay_type_at(
    p_organization_id,
    p_professional_id,
    p_performed_at
  ) = 'fixed' THEN
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
      (c.specialty_id IS NULL AND c.specialty IS NULL)
      OR (
        c.specialty_id IS NOT NULL
        AND EXISTS (
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
      OR (
        c.specialty_id IS NULL
        AND c.specialty IS NOT NULL
        AND public.professional_has_specialty(p_professional_id, c.specialty)
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

-- Não reescrever snapshots existentes automaticamente. O backfill inicial de
-- remuneração usa 1900-01-01 para representar o estado conhecido no cadastro,
-- mas isso não prova que a pessoa já era `fixed` quando um atendimento antigo
-- aconteceu. Qualquer saneamento retroativo exige preflight e evidência do
-- contrato vigente em cada período; fatos novos já ficam corretos pelo resolvedor.
