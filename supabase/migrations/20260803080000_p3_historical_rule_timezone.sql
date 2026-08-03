-- A manutenção 20260803060000 preservou o bypass interno, mas voltou a usar
-- CURRENT_DATE. O banco pode operar em UTC; a vigência financeira usa o dia
-- civil de America/Sao_Paulo em todo o restante do motor.

CREATE OR REPLACE FUNCTION public.protect_historical_commission_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Manutenção/cleanup controlado. `authenticated` nunca assume estes roles.
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.valid_from < v_today THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'regra histórica não pode ser apagada; crie uma nova vigência';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.valid_from < v_today THEN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
      OR OLD.professional_id IS DISTINCT FROM NEW.professional_id
      OR OLD.specialty_id IS DISTINCT FROM NEW.specialty_id
      OR OLD.product_id IS DISTINCT FROM NEW.product_id
      OR OLD.specialty IS DISTINCT FROM NEW.specialty
      OR OLD.procedimento IS DISTINCT FROM NEW.procedimento
      OR OLD.amount_type IS DISTINCT FROM NEW.amount_type
      OR OLD.amount IS DISTINCT FROM NEW.amount
      OR OLD.percent IS DISTINCT FROM NEW.percent
      OR OLD.valid_from IS DISTINCT FROM NEW.valid_from THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'regra histórica não pode ser reescrita; crie uma nova vigência';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_historical_commission_rule()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_historical_commission_rule()
  TO service_role;
