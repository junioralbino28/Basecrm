-- =============================================================================
-- PLATFORM PROVISIONING
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.organization_editions (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    edition_key TEXT NOT NULL,
    branding_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.organization_editions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.organization_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    host TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.organization_domains ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_domains_host_unique
    ON public.organization_domains(host);

CREATE INDEX IF NOT EXISTS idx_organization_domains_org
    ON public.organization_domains(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.provisioning_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    edition_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.provisioning_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_provisioning_runs_org
    ON public.provisioning_runs(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provisioning_runs_status
    ON public.provisioning_runs(status, created_at DESC);

DROP POLICY IF EXISTS "Members can view organization editions" ON public.organization_editions;
CREATE POLICY "Members can view organization editions"
    ON public.organization_editions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_editions.organization_id
        )
    );

DROP POLICY IF EXISTS "Admins can manage organization editions" ON public.organization_editions;
CREATE POLICY "Admins can manage organization editions"
    ON public.organization_editions
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_editions.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_editions.organization_id
              AND role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Members can view provisioning runs" ON public.provisioning_runs;
CREATE POLICY "Members can view provisioning runs"
    ON public.provisioning_runs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = provisioning_runs.organization_id
        )
    );

DROP POLICY IF EXISTS "Members can view organization domains" ON public.organization_domains;
CREATE POLICY "Members can view organization domains"
    ON public.organization_domains
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_domains.organization_id
        )
    );

DROP POLICY IF EXISTS "Admins can manage organization domains" ON public.organization_domains;
CREATE POLICY "Admins can manage organization domains"
    ON public.organization_domains
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_domains.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = organization_domains.organization_id
              AND role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admins can manage provisioning runs" ON public.provisioning_runs;
CREATE POLICY "Admins can manage provisioning runs"
    ON public.provisioning_runs
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = provisioning_runs.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = provisioning_runs.organization_id
              AND role = 'admin'
        )
    );
