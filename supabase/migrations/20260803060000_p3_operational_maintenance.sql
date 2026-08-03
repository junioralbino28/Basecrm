-- Ajustes operacionais sem reabrir escrita financeira para authenticated.

-- Jobs internos/service_role que fazem importação recebem uma chave própria;
-- usuários normais seguem sem INSERT direto e usam a RPC com chave explícita.
ALTER TABLE public.commission_payments
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid();

-- Se não há atendimento, o profissional pode ser removido e suas versões não
-- têm fato para preservar. Se há atendimento, a FK de atendimentos continua
-- bloqueando a exclusão do profissional e, portanto, preserva o histórico.
ALTER TABLE public.professional_compensation_versions
  DROP CONSTRAINT IF EXISTS professional_compensation_versions_professional_same_org_fk;
ALTER TABLE public.professional_compensation_versions
  ADD CONSTRAINT professional_compensation_versions_professional_same_org_fk
  FOREIGN KEY (organization_id, professional_id)
  REFERENCES public.professionals (organization_id, id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.protect_historical_commission_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Manutenção/cleanup controlado. `authenticated` nunca assume estes roles.
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.valid_from < CURRENT_DATE THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'regra histórica não pode ser apagada; crie uma nova vigência';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.valid_from < CURRENT_DATE THEN
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

REVOKE ALL ON FUNCTION public.protect_historical_commission_rule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_historical_commission_rule() TO service_role;
