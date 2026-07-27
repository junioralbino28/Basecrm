-- =============================================================================
-- Catálogos de CARGO e ESPECIALIDADE (listas configuráveis da equipe)
-- =============================================================================
-- Pedido do Junior (2026-07-24): cargo e especialidade eram TEXTO LIVRE na tela
-- de Profissionais. É a mesma classe de erro que já corrigimos no procedimento:
-- "Ortodontia" e "ortodontia" viram duas coisas diferentes e o agrupamento e os
-- relatórios quebram **em silêncio**. Vira lista: cadastra-se uma vez, seleciona
-- depois.
--
-- Forma ESPELHADA de `lead_sources` de propósito (regra "sem espaguete": um jeito
-- de fazer cada coisa) — mesmas colunas, mesmo desenho de RLS.
-- Portão de acesso: `can_configure_organization`, o mesmo de `professionals`,
-- porque cargo e especialidade são configuração da equipe.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.job_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  owner_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.specialties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  owner_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem duplicata por diferença de caixa/espaço — é o ponto de todo o exercício.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_roles_org_name
  ON public.job_roles (organization_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_specialties_org_name
  ON public.specialties (organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS idx_job_roles_org ON public.job_roles (organization_id, name);
CREATE INDEX IF NOT EXISTS idx_specialties_org ON public.specialties (organization_id, name);

ALTER TABLE public.job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_roles', 'specialties'] LOOP
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

-- ⚠️ RLS NÃO concede acesso — só restringe. Sem o GRANT abaixo o Postgres
-- devolve "permission denied for table job_roles" antes mesmo de olhar a policy
-- (foi o que aconteceu na primeira versão desta migration).
-- Damos SÓ para `authenticated` e `service_role`: as policies são TO authenticated,
-- então grant para `anon` seria peso morto — e a tabela é configuração da clínica.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_roles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.specialties TO authenticated, service_role;

COMMENT ON TABLE public.job_roles IS
  'Cargos da equipe (dentista, secretária, comercial…). Lista configurável — a '
  'tela de Profissionais SELECIONA daqui, nunca aceita texto livre.';
COMMENT ON TABLE public.specialties IS
  'Especialidades da equipe. Lista configurável — mesma razão de job_roles: '
  'texto livre gera "Ortodontia" × "ortodontia" e quebra agrupamento/relatório.';

-- Semeia a partir do que já foi digitado à mão, pra ninguém perder cadastro.
INSERT INTO public.job_roles (organization_id, name)
SELECT DISTINCT p.organization_id, btrim(p.role)
  FROM public.professionals p
 WHERE p.role IS NOT NULL AND btrim(p.role) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.specialties (organization_id, name)
SELECT DISTINCT p.organization_id, btrim(p.specialty)
  FROM public.professionals p
 WHERE p.specialty IS NOT NULL AND btrim(p.specialty) <> ''
ON CONFLICT DO NOTHING;
