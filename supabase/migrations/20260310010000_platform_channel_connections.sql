-- =============================================================================
-- PLATFORM CHANNEL CONNECTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.channel_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_healthcheck_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_channel_connections_org
    ON public.channel_connections(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_connections_provider
    ON public.channel_connections(provider, status, created_at DESC);

DROP POLICY IF EXISTS "Members can view channel connections" ON public.channel_connections;
CREATE POLICY "Members can view channel connections"
    ON public.channel_connections
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = channel_connections.organization_id
        )
    );

DROP POLICY IF EXISTS "Admins can manage channel connections" ON public.channel_connections;
CREATE POLICY "Admins can manage channel connections"
    ON public.channel_connections
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = channel_connections.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = channel_connections.organization_id
              AND role = 'admin'
        )
    );
