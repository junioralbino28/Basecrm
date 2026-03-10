-- =============================================================================
-- PLATFORM CONVERSATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    channel_connection_id UUID NULL REFERENCES public.channel_connections(id) ON DELETE SET NULL,
    contact_id UUID NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
    deal_id UUID NULL REFERENCES public.deals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    contact_name TEXT NULL,
    contact_phone TEXT NULL,
    assigned_user_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'open',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_message_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversation_threads_org
    ON public.conversation_threads(organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_threads_status
    ON public.conversation_threads(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    author_name TEXT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread
    ON public.conversation_messages(thread_id, sent_at ASC);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_org
    ON public.conversation_messages(organization_id, sent_at DESC);

DROP POLICY IF EXISTS "Members can view conversation threads" ON public.conversation_threads;
CREATE POLICY "Members can view conversation threads"
    ON public.conversation_threads
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_threads.organization_id
        )
    );

DROP POLICY IF EXISTS "Admins can manage conversation threads" ON public.conversation_threads;
CREATE POLICY "Admins can manage conversation threads"
    ON public.conversation_threads
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_threads.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_threads.organization_id
              AND role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Members can view conversation messages" ON public.conversation_messages;
CREATE POLICY "Members can view conversation messages"
    ON public.conversation_messages
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_messages.organization_id
        )
    );

DROP POLICY IF EXISTS "Admins can manage conversation messages" ON public.conversation_messages;
CREATE POLICY "Admins can manage conversation messages"
    ON public.conversation_messages
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_messages.organization_id
              AND role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE id = auth.uid()
              AND organization_id = conversation_messages.organization_id
              AND role = 'admin'
        )
    );
