-- R-02 (docs/REVIEW-CORRECOES-PACOTE-3.md): a regra de comissão no formato LEGADO — a que
-- guarda o nome da especialidade em texto (`specialty`) em vez do vínculo (`specialty_id`) —
-- casava olhando só se o colaborador TEM aquela especialidade, sem conferir se o procedimento
-- do atendimento pertence a ela. O ramo canônico (`specialty_id`) já fazia as duas perguntas.
-- Resultado medido pela revisão: a MESMA regra pagava R$ 500 no formato legado e R$ 0 no
-- canônico, ou seja, comissão sobre procedimento de outra especialidade.
--
-- Exposição hoje: ZERO. Medido em 16/09 em produção (0 de 90 regras nessa condição) e no
-- ambiente de teste (0 de 92), porque o gatilho `canonicalize_commission_rule_refs` preenche o
-- `specialty_id` sempre que o nome existe no catálogo. O estado legado volta a nascer quando a
-- especialidade é criada DEPOIS da regra, ou quando o nome nunca existiu no catálogo — por isso
-- a correção entra antes do rollout, e não depois.
--
-- A função é recriada a partir da versão vigente em
-- `20260803090000_p3_fixed_only_commission_guard.sql`, com o cabeçalho copiado literalmente
-- (STABLE, SECURITY DEFINER, search_path vazio), o gate de `pay_type = 'fixed'`, a mesma ordem
-- de precedência e os mesmos REVOKE/GRANT. A ÚNICA mudança de lógica é o bloco marcado abaixo.

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
        -- R-02: o ramo legado passa a exigir o MESMO que o canônico — o procedimento tem de
        -- pertencer à especialidade. Quando o nome não existe no catálogo da organização, o
        -- EXISTS é falso e a regra não casa (fail-closed, comissão 0): regra que aponta para
        -- especialidade inexistente não deve pagar.
        c.specialty_id IS NULL
        AND c.specialty IS NOT NULL
        AND public.professional_has_specialty(p_professional_id, c.specialty)
        AND (
          p_product_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.specialties s
            JOIN public.specialty_products sp
              ON sp.specialty_id = s.id
             AND sp.organization_id = s.organization_id
            WHERE s.organization_id = p_organization_id
              AND lower(btrim(s.name)) = lower(btrim(c.specialty))
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
