-- Pacote 3: pagamento parcial idempotente, serializado e limitado ao saldo.

ALTER TABLE public.commission_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_payments_org_idempotency
  ON public.commission_payments (organization_id, idempotency_key);

CREATE OR REPLACE FUNCTION public.record_commission_payment(
  p_organization_id uuid,
  p_professional_id uuid,
  p_amount numeric,
  p_period text,
  p_paid_at timestamptz,
  p_idempotency_key uuid
)
RETURNS public.commission_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.commission_payments%ROWTYPE;
  v_result public.commission_payments%ROWTYPE;
  v_start_date date;
  v_end_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_due numeric;
  v_already_paid numeric;
BEGIN
  IF p_organization_id IS NULL OR NOT public.can_configure_organization(p_organization_id)
    OR NOT public.has_permission('reports.finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valor do pagamento deve ser positivo';
  END IF;
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'competência inválida';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chave de idempotência obrigatória';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals p
    WHERE p.id = p_professional_id
      AND p.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'colaborador não pertence à organização';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(
    p_organization_id::text || ':' || p_professional_id::text || ':' || p_period
  ));

  SELECT * INTO v_existing FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_existing; END IF;

  v_start_date := (p_period || '-01')::date;
  v_end_date := (v_start_date + interval '1 month - 1 day')::date;
  v_start := v_start_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end := (v_end_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' - interval '1 microsecond';

  SELECT coalesce(sum(public.resolve_commission_amount(
    p_organization_id, a.professional_id, a.product_id, a.procedimento,
    a.performed_at, a.valor - a.desconto
  )), 0)
  + public.fixed_compensation_for_period(
      p_organization_id, p_professional_id, v_start, v_end
    )
  INTO v_due
  FROM public.atendimentos a
  WHERE a.organization_id = p_organization_id
    AND a.professional_id = p_professional_id
    AND a.performed_at >= v_start
    AND a.performed_at <= v_end;

  SELECT coalesce(sum(cp.amount), 0) INTO v_already_paid
  FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.professional_id = p_professional_id
    AND cp.period = p_period;

  IF p_amount > greatest(v_due - v_already_paid, 0) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'valor excede o saldo de remuneração';
  END IF;

  INSERT INTO public.commission_payments (
    organization_id, professional_id, amount, period, paid_at,
    owner_id, idempotency_key
  ) VALUES (
    p_organization_id, p_professional_id, p_amount, p_period,
    coalesce(p_paid_at, now()), (SELECT auth.uid()), p_idempotency_key
  )
  ON CONFLICT (organization_id, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_commission_payment(uuid, uuid, numeric, text, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_commission_payment(uuid, uuid, numeric, text, timestamptz, uuid)
  TO authenticated, service_role;
