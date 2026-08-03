-- Pacote 3 / Bloco 3: vínculos same-org e menor privilégio.
-- A migration é aditiva. As FKs entram NOT VALID para reduzir o lock inicial e
-- são validadas ainda nesta execução; dado cruzado faz a migration falhar em
-- vez de ser corrigido silenciosamente.

CREATE UNIQUE INDEX IF NOT EXISTS uq_professionals_organization_id_id
  ON public.professionals (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_specialties_organization_id_id
  ON public.specialties (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_organization_id_id
  ON public.products (organization_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_specialties_professional_same_org_fk') THEN
    ALTER TABLE public.professional_specialties
      ADD CONSTRAINT professional_specialties_professional_same_org_fk
      FOREIGN KEY (organization_id, professional_id)
      REFERENCES public.professionals (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_specialties_specialty_same_org_fk') THEN
    ALTER TABLE public.professional_specialties
      ADD CONSTRAINT professional_specialties_specialty_same_org_fk
      FOREIGN KEY (organization_id, specialty_id)
      REFERENCES public.specialties (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialty_products_specialty_same_org_fk') THEN
    ALTER TABLE public.specialty_products
      ADD CONSTRAINT specialty_products_specialty_same_org_fk
      FOREIGN KEY (organization_id, specialty_id)
      REFERENCES public.specialties (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'specialty_products_product_same_org_fk') THEN
    ALTER TABLE public.specialty_products
      ADD CONSTRAINT specialty_products_product_same_org_fk
      FOREIGN KEY (organization_id, product_id)
      REFERENCES public.products (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_product_overrides_professional_same_org_fk') THEN
    ALTER TABLE public.professional_product_overrides
      ADD CONSTRAINT professional_product_overrides_professional_same_org_fk
      FOREIGN KEY (organization_id, professional_id)
      REFERENCES public.professionals (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professional_product_overrides_product_same_org_fk') THEN
    ALTER TABLE public.professional_product_overrides
      ADD CONSTRAINT professional_product_overrides_product_same_org_fk
      FOREIGN KEY (organization_id, product_id)
      REFERENCES public.products (organization_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.professional_specialties
  VALIDATE CONSTRAINT professional_specialties_professional_same_org_fk;
ALTER TABLE public.professional_specialties
  VALIDATE CONSTRAINT professional_specialties_specialty_same_org_fk;
ALTER TABLE public.specialty_products
  VALIDATE CONSTRAINT specialty_products_specialty_same_org_fk;
ALTER TABLE public.specialty_products
  VALIDATE CONSTRAINT specialty_products_product_same_org_fk;
ALTER TABLE public.professional_product_overrides
  VALIDATE CONSTRAINT professional_product_overrides_professional_same_org_fk;
ALTER TABLE public.professional_product_overrides
  VALIDATE CONSTRAINT professional_product_overrides_product_same_org_fk;

REVOKE ALL ON TABLE public.job_roles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.specialties FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_specialties FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.specialty_products FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.professional_product_overrides FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.specialties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.professional_specialties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.specialty_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.professional_product_overrides TO authenticated;
GRANT ALL ON TABLE public.job_roles TO service_role;
GRANT ALL ON TABLE public.specialties TO service_role;
GRANT ALL ON TABLE public.professional_specialties TO service_role;
GRANT ALL ON TABLE public.specialty_products TO service_role;
GRANT ALL ON TABLE public.professional_product_overrides TO service_role;

REVOKE ALL ON FUNCTION public.professional_has_specialty(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.professional_has_specialty(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.professional_does_product(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.professional_does_product(uuid, uuid) TO authenticated, service_role;
