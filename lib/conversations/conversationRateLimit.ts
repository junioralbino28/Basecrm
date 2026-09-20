import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export async function consumeConversationRateLimit(input: {
  admin: AdminClient;
  scopeKey: string;
  limit: number;
  windowSeconds: number;
}) {
  const result = await input.admin.rpc('consume_conversation_ai_rate_limit', {
    p_scope_key: input.scopeKey,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });

  if (result.error) {
    return { allowed: false, retryAfterSeconds: input.windowSeconds };
  }

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || typeof row !== 'object') {
    return { allowed: false, retryAfterSeconds: input.windowSeconds };
  }

  const source = row as Record<string, unknown>;
  return {
    allowed: source.allowed === true,
    retryAfterSeconds:
      typeof source.retry_after_seconds === 'number'
        ? Math.max(1, Math.ceil(source.retry_after_seconds))
        : input.windowSeconds,
  };
}
