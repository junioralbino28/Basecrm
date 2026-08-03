-- Pacote 3: pagamento parcial idempotente, serializado e limitado ao saldo.

ALTER TABLE public.commission_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

-- Linhas anteriores à RPC recebem uma chave própria; daqui em diante nenhuma
-- escrita pode existir sem idempotência no próprio banco.
UPDATE public.commission_payments
SET idempotency_key = gen_random_uuid()
WHERE idempotency_key IS NULL;

ALTER TABLE public.commission_payments
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_payments_org_idempotency
  ON public.commission_payments (organization_id, idempotency_key);

-- Feche o caminho REST direto. As policies antigas validavam só o tenant e
-- permitiam contornar saldo, serialização e idempotência da RPC.
DROP POLICY IF EXISTS "commission_payments_mutate_by_tenant_admin"
  ON public.commission_payments;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.commission_payments
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.commission_payments TO authenticated;

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
  IF p_organization_id IS NULL
    OR NOT coalesce(public.can_configure_organization(p_organization_id), false)
    OR NOT coalesce(public.has_permission('settings.finance'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'valor do pagamento deve ser positivo';
  END IF;
  IF p_period IS NULL OR p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
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

  -- A chave tem lock próprio: duas requisições que reutilizem a mesma chave
  -- com payloads/profissionais diferentes também precisam se serializar.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commission-payment-idempotency:' || p_organization_id::text || ':' || p_idempotency_key::text,
    0
  ));

  SELECT * INTO v_existing FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.professional_id IS DISTINCT FROM p_professional_id
      OR v_existing.amount IS DISTINCT FROM p_amount
      OR v_existing.period IS DISTINCT FROM p_period
      OR (p_paid_at IS NOT NULL AND v_existing.paid_at IS DISTINCT FROM p_paid_at) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'chave de idempotência reutilizada com payload diferente';
    END IF;
    RETURN v_existing;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commission-payment-balance:' || p_organization_id::text || ':'
      || p_professional_id::text || ':' || p_period,
    0
  ));

  v_start_date := (p_period || '-01')::date;
  v_end_date := (v_start_date + interval '1 month - 1 day')::date;
  v_start := v_start_date::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_end := (v_end_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' - interval '1 microsecond';

  SELECT coalesce(sum(a.commission_amount), 0)
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

-- O histórico continua permitindo "desfazer", mas somente pela mesma barreira
-- de autorização e pelo mesmo lock usado no cálculo de saldo.
CREATE OR REPLACE FUNCTION public.delete_commission_payment(
  p_organization_id uuid,
  p_payment_id uuid
)
RETURNS public.commission_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.commission_payments%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR NOT coalesce(public.can_configure_organization(p_organization_id), false)
    OR NOT coalesce(public.has_permission('settings.finance'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;

  SELECT cp.* INTO v_payment
  FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'pagamento não encontrado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commission-payment-balance:' || p_organization_id::text || ':'
      || v_payment.professional_id::text || ':' || v_payment.period,
    0
  ));

  DELETE FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.id = p_payment_id
  RETURNING cp.* INTO v_payment;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'pagamento não encontrado';
  END IF;
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_commission_payment_paid_at(
  p_organization_id uuid,
  p_payment_id uuid,
  p_paid_at timestamptz
)
RETURNS public.commission_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.commission_payments%ROWTYPE;
BEGIN
  IF p_organization_id IS NULL
    OR NOT coalesce(public.can_configure_organization(p_organization_id), false)
    OR NOT coalesce(public.has_permission('settings.finance'), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;
  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'data de pagamento obrigatória';
  END IF;

  SELECT cp.* INTO v_payment
  FROM public.commission_payments cp
  WHERE cp.organization_id = p_organization_id
    AND cp.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'pagamento não encontrado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'commission-payment-balance:' || p_organization_id::text || ':'
      || v_payment.professional_id::text || ':' || v_payment.period,
    0
  ));

  UPDATE public.commission_payments cp
  SET paid_at = p_paid_at
  WHERE cp.organization_id = p_organization_id
    AND cp.id = p_payment_id
  RETURNING cp.* INTO v_payment;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'pagamento não encontrado';
  END IF;
  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.record_commission_payment(uuid, uuid, numeric, text, timestamptz, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_commission_payment(uuid, uuid, numeric, text, timestamptz, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_commission_payment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_commission_payment(uuid, uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_commission_payment_paid_at(uuid, uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_commission_payment_paid_at(uuid, uuid, timestamptz)
  TO authenticated, service_role;
