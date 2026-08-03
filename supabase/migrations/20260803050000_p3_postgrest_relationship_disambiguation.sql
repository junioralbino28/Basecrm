-- As FKs compostas same-org substituem as FKs simples. Manter ambas cria dois
-- caminhos de relacionamento no PostgREST e torna embeds como
-- professional_specialties(..., specialties(name)) ambíguos.

ALTER TABLE public.professional_specialties
  DROP CONSTRAINT IF EXISTS professional_specialties_professional_id_fkey,
  DROP CONSTRAINT IF EXISTS professional_specialties_specialty_id_fkey;

ALTER TABLE public.specialty_products
  DROP CONSTRAINT IF EXISTS specialty_products_specialty_id_fkey,
  DROP CONSTRAINT IF EXISTS specialty_products_product_id_fkey;

ALTER TABLE public.professional_product_overrides
  DROP CONSTRAINT IF EXISTS professional_product_overrides_professional_id_fkey,
  DROP CONSTRAINT IF EXISTS professional_product_overrides_product_id_fkey;

NOTIFY pgrst, 'reload schema';
