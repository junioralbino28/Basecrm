-- O service_role executa imports, fixtures e manutenção auditada. Ele já possui
-- acesso total às tabelas e não deve depender das permissões de um profile.
CREATE OR REPLACE FUNCTION public.guard_professional_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF (
      TG_OP = 'INSERT'
      AND (
        NEW.pay_type IS DISTINCT FROM 'commission'
        OR NEW.fixed_amount IS DISTINCT FROM 0
      )
    ) OR (
      TG_OP = 'UPDATE'
      AND (
        OLD.pay_type IS DISTINCT FROM NEW.pay_type
        OR OLD.fixed_amount IS DISTINCT FROM NEW.fixed_amount
      )
    ) THEN
    IF NOT coalesce(public.has_permission('settings.finance'), false) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'sem permissão para alterar remuneração';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_professional_financial_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_professional_financial_fields() TO authenticated, service_role;
