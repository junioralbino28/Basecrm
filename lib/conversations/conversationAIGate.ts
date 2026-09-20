import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export type FreshConversationAIConnection = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
};

export async function loadFreshConversationAIGate(input: {
  admin: AdminClient;
  connectionId: string;
  organizationId: string;
}) {
  const connectionResult = await input.admin
    .from('channel_connections')
    .select('id, organization_id, name, config')
    .eq('id', input.connectionId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (connectionResult.error) {
    return { ok: false as const, reason: 'ai_gate_unavailable' as const };
  }
  if (!connectionResult.data) {
    return { ok: false as const, reason: 'connection_not_found' as const };
  }

  const connection = connectionResult.data as FreshConversationAIConnection;
  if (connection.config?.aiEnabled !== true) {
    return { ok: false as const, reason: 'connection_ai_disabled' as const };
  }

  const featureResult = await input.admin
    .from('ai_feature_flags')
    .select('enabled')
    .eq('organization_id', input.organizationId)
    .eq('key', 'ai_conversation_auto_reply')
    .maybeSingle();

  if (featureResult.error) {
    return { ok: false as const, reason: 'ai_gate_unavailable' as const };
  }
  if (featureResult.data?.enabled !== true) {
    return { ok: false as const, reason: 'feature_disabled' as const };
  }

  const settingsResult = await input.admin
    .from('organization_settings')
    .select('ai_enabled')
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (settingsResult.error) {
    return { ok: false as const, reason: 'ai_gate_unavailable' as const };
  }
  if (settingsResult.data?.ai_enabled !== true) {
    return { ok: false as const, reason: 'organization_ai_disabled' as const };
  }

  return { ok: true as const, connection };
}
