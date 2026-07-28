-- =============================================================================
-- PROCEDIMENTO ↔ ESPECIALIDADE (pré-seleção) + EXCEÇÕES POR PESSOA
-- =============================================================================
-- Pedido do Junior (2026-07-27):
--
--   "na parte especialidades, poderia ter uma seleção prévia de cada procedimento
--    que cabe naquela especialidade; assim quando eu cadastrar um profissional e
--    colocar a especialidade nele já ativa um toggle de todos os procedimentos
--    daquela especialidade, mas apareceria toda a lista como já aparece hoje
--    quando clica em comissão, e os procedimentos que não estiverem pré
--    selecionados eu consigo adicionar um a um via toggle — igual fizemos na hora
--    de criar acesso a quem vai usar o CRM no menu equipe."
--
-- DESENHO: o que a pessoa FAZ é **derivado + exceções**, não uma cópia.
--
--   faz(pessoa, procedimento) =
--       existe exceção com enabled = true                  → SIM
--       existe exceção com enabled = false                 → NÃO
--       senão: o procedimento cabe em alguma especialidade da pessoa
--
-- Por que derivado e não uma cópia congelada no momento do cadastro: quando a
-- clínica cadastrar um procedimento novo e marcar como Ortodontia, ele passa a
-- valer para TODO MUNDO que tem Ortodontia, sem ninguém precisar reabrir ficha
-- por ficha. Quem não faz aquele procedimento desliga na ficha, e o desligamento
-- fica gravado como exceção — não some na próxima mudança.
--
-- Um procedimento pode caber em VÁRIAS especialidades de propósito (uma consulta
-- inicial serve a todas). Fixar uma só exigiria migration pra desfazer na
-- primeira vez que precisasse repetir.
--
-- ⚠️ Isto NÃO altera o cálculo da comissão. A regra de comissão continua sendo
-- `commission_rules`; aqui é só QUAIS procedimentos aparecem ligados na ficha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quais procedimentos cabem em cada especialidade
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.specialty_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  specialty_id uuid NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_specialty_products
  ON public.specialty_products (specialty_id, product_id);
CREATE INDEX IF NOT EXISTS idx_specialty_products_org
  ON public.specialty_products (organization_id, specialty_id);
CREATE INDEX IF NOT EXISTS idx_specialty_products_produto
  ON public.specialty_products (organization_id, product_id);

-- -----------------------------------------------------------------------------
-- 2. Exceções por pessoa (o que ela faz além, ou deixa de fazer)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_product_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- true  = faz, mesmo não vindo de nenhuma especialidade dela
  -- false = NÃO faz, mesmo vindo de uma especialidade dela
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_professional_product_overrides
  ON public.professional_product_overrides (professional_id, product_id);
CREATE INDEX IF NOT EXISTS idx_professional_product_overrides_org
  ON public.professional_product_overrides (organization_id, professional_id);

-- -----------------------------------------------------------------------------
-- 3. RLS + GRANT (nas DUAS — RLS só restringe; sem GRANT o Postgres nega antes
--    de olhar a policy, que foi o bug de 24/07 em job_roles)
-- -----------------------------------------------------------------------------
ALTER TABLE public.specialty_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_product_overrides ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['specialty_products', 'professional_product_overrides'] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$s_select_by_tenant ON public.%1$s;
      CREATE POLICY %1$s_select_by_tenant ON public.%1$s
        FOR SELECT TO authenticated
        USING (public.can_access_organization(organization_id));

      DROP POLICY IF EXISTS %1$s_insert_by_admin ON public.%1$s;
      CREATE POLICY %1$s_insert_by_admin ON public.%1$s
        FOR INSERT TO authenticated
        WITH CHECK (public.can_configure_organization(organization_id));

      DROP POLICY IF EXISTS %1$s_update_by_admin ON public.%1$s;
      CREATE POLICY %1$s_update_by_admin ON public.%1$s
        FOR UPDATE TO authenticated
        USING (public.can_configure_organization(organization_id))
        WITH CHECK (public.can_configure_organization(organization_id));

      DROP POLICY IF EXISTS %1$s_delete_by_admin ON public.%1$s;
      CREATE POLICY %1$s_delete_by_admin ON public.%1$s
        FOR DELETE TO authenticated
        USING (public.can_configure_organization(organization_id));
    $f$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.specialty_products TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_product_overrides TO authenticated, service_role;

COMMENT ON TABLE public.specialty_products IS
  'Quais procedimentos cabem em cada especialidade. Um procedimento pode caber '
  'em várias — uma consulta inicial serve a todas.';
COMMENT ON TABLE public.professional_product_overrides IS
  'Exceções da pessoa sobre o que a especialidade dela já traz: enabled=true '
  'adiciona um procedimento de fora, enabled=false remove um de dentro. Sem '
  'linha aqui, vale o que a especialidade diz.';

-- -----------------------------------------------------------------------------
-- 4. "Essa pessoa faz este procedimento?" — a regra derivada, num lugar só
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.professional_does_product(
  p_professional_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    -- 1º) a exceção da pessoa manda, quando existe
    (SELECT o.enabled
       FROM public.professional_product_overrides o
      WHERE o.professional_id = p_professional_id
        AND o.product_id = p_product_id),
    -- 2º) senão, cabe em alguma especialidade dela?
    EXISTS (
      SELECT 1
        FROM public.professional_specialties ps
        JOIN public.specialty_products sp ON sp.specialty_id = ps.specialty_id
       WHERE ps.professional_id = p_professional_id
         AND sp.product_id = p_product_id
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.professional_does_product(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.professional_does_product(uuid, uuid) IS
  'true se a pessoa faz o procedimento: a exceção dela manda; sem exceção, vale '
  'o que a especialidade traz. NÃO decide comissão — só o que aparece ligado.';
