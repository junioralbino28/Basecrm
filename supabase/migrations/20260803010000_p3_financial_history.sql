-- Pacote 3 / Bloco 5: remuneração versionada e passado financeiro imutável.

CREATE TABLE IF NOT EXISTS public.professional_compensation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL,
  pay_type text NOT NULL CHECK (pay_type IN ('fixed', 'commission', 'both')),
  fixed_amount numeric NOT NULL CHECK (fixed_amount >= 0),
  active boolean NOT NULL,
  valid_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT professional_compensation_versions_professional_same_org_fk
    FOREIGN KEY (organization_id, professional_id)
    REFERENCES public.professionals (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT professional_compensation_versions_professional_valid_from_key
    UNIQUE (professional_id, valid_from)
);

ALTER TABLE public.professional_compensation_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_compensation_versions_select ON public.professional_compensation_versions;
CREATE POLICY professional_compensation_versions_select
  ON public.professional_compensation_versions FOR SELECT TO authenticated
  USING (
    public.can_access_organization(organization_id)
    AND public.has_permission('reports.professionals')
  );

DROP POLICY IF EXISTS professional_compensation_versions_insert ON public.professional_compensation_versions;
CREATE POLICY professional_compensation_versions_insert
  ON public.professional_compensation_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_configure_organization(organization_id));

REVOKE ALL ON TABLE public.professional_compensation_versions FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.professional_compensation_versions TO authenticated;
GRANT ALL ON TABLE public.professional_compensation_versions TO service_role;

INSERT INTO public.professional_compensation_versions (
  organization_id, professional_id, pay_type, fixed_amount, active, valid_from
)
SELECT p.organization_id, p.id, p.pay_type, p.fixed_amount, p.active, DATE '1900-01-01'
FROM public.professionals p
ON CONFLICT (professional_id, valid_from) DO NOTHING;

CREATE OR REPLACE FUNCTION public.version_professional_compensation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR OLD.pay_type IS DISTINCT FROM NEW.pay_type
    OR OLD.fixed_amount IS DISTINCT FROM NEW.fixed_amount
    OR OLD.active IS DISTINCT FROM NEW.active THEN
    INSERT INTO public.professional_compensation_versions (
      organization_id, professional_id, pay_type, fixed_amount, active, valid_from, created_by
    ) VALUES (
      NEW.organization_id, NEW.id, NEW.pay_type, NEW.fixed_amount, NEW.active,
      CURRENT_DATE, (SELECT auth.uid())
    )
    ON CONFLICT (professional_id, valid_from) DO UPDATE
      SET pay_type = EXCLUDED.pay_type,
          fixed_amount = EXCLUDED.fixed_amount,
          active = EXCLUDED.active,
          created_at = now(),
          created_by = EXCLUDED.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_version_professional_compensation ON public.professionals;
CREATE TRIGGER trg_version_professional_compensation
  AFTER INSERT OR UPDATE OF pay_type, fixed_amount, active ON public.professionals
  FOR EACH ROW EXECUTE FUNCTION public.version_professional_compensation();

REVOKE ALL ON FUNCTION public.version_professional_compensation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.version_professional_compensation() TO authenticated, service_role;

-- Percentual tem uma fonte: amount. A coluna percent permanece apenas por
-- compatibilidade e recebe sempre o mesmo valor.
UPDATE public.commission_rules
SET amount = percent
WHERE amount_type = 'percent' AND amount IS DISTINCT FROM percent;

UPDATE public.commission_rules
SET percent = 0
WHERE amount_type = 'fixed' AND percent <> 0;

CREATE OR REPLACE FUNCTION public.sync_commission_rule_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.amount_type = 'percent' THEN
    NEW.percent := NEW.amount;
  ELSE
    NEW.percent := 0;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_percent_consistency_chk;
ALTER TABLE public.commission_rules
  ADD CONSTRAINT commission_rules_percent_consistency_chk
  CHECK (
    (amount_type = 'percent' AND amount = percent)
    OR (amount_type = 'fixed' AND percent = 0)
  );

CREATE OR REPLACE FUNCTION public.protect_historical_commission_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_protect_historical_commission_rule ON public.commission_rules;
CREATE TRIGGER trg_protect_historical_commission_rule
  BEFORE UPDATE OR DELETE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public.protect_historical_commission_rule();

REVOKE ALL ON FUNCTION public.sync_commission_rule_amount() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.protect_historical_commission_rule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_commission_rule_amount() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.protect_historical_commission_rule() TO authenticated, service_role;
