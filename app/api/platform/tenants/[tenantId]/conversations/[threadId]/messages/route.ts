import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { getConversationAssigneeDisplayName, loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { toWhatsAppPhone } from '@/lib/phone';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const MessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound', 'internal']),
  message_type: z.string().min(1).max(50).optional(),
  author_name: z.string().max(160).optional(),
  content: z.string().min(1).max(4000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  send_external: z.boolean().optional(),
}).strict();

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  const { tenantId, threadId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();

  const { data, error } = await admin
    .from('conversation_messages')
    .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
    .eq('organization_id', tenantId)
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true });

  if (error) return json({ error: error.message }, 500);
  return json({ messages: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, threadId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.reply'],
  });
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = MessageSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const authorName =
    parsed.data.author_name?.trim() ||
    getConversationAssigneeDisplayName({
      email: (auth.profile as { email?: string | null }).email,
      first_name: (auth.profile as { first_name?: string | null }).first_name,
      last_name: (auth.profile as { last_name?: string | null }).last_name,
      nickname: (auth.profile as { nickname?: string | null }).nickname,
    });

  const now = new Date().toISOString();
  const admin = createStaticAdminClient();

  const thread = await admin
    .from('conversation_threads')
    .select('id, status, metadata, channel_connection_id, contact_phone, assigned_user_id')
    .eq('id', threadId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (thread.error) return json({ error: thread.error.message }, 500);
  if (!thread.data) return json({ error: 'Thread not found' }, 404);

  let deliveryMetadata: Record<string, unknown> = parsed.data.metadata ?? {};
  let deliveryWarning: string | null = null;

  if (parsed.data.direction === 'outbound' && parsed.data.send_external !== false && thread.data.channel_connection_id) {
    const connection = await admin
      .from('channel_connections')
      .select('id, provider, channel_type, name, config')
      .eq('id', thread.data.channel_connection_id)
      .eq('organization_id', tenantId)
      .maybeSingle();

    if (connection.error) return json({ error: connection.error.message }, 500);
    if (!connection.data) {
      return json({ error: 'Channel connection not found for this conversation.' }, 404);
    }

    const instanceName = (connection.data.config as any)?.instanceName;
    let resolved: Awaited<ReturnType<typeof resolveEvolutionCredentials>> = null;
    try {
      resolved = await resolveEvolutionCredentials({
        admin,
        tenantId,
        connectionConfig: (connection.data.config as Record<string, unknown> | null) || {},
        profileRole: auth.profile.role,
        requesterOrganizationId: auth.profile.organization_id,
      });
    } catch (resolveError) {
      return json(
        {
          error:
            resolveError instanceof Error
              ? resolveError.message
              : 'Failed to resolve Evolution credentials for outbound message.',
        },
        500
      );
    }
    const phone = toWhatsAppPhone(thread.data.contact_phone);

    if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
      return json(
        {
          error:
            'WhatsApp connection requires instanceName and Evolution credentials (connection config or agency defaults) before sending.',
        },
        400
      );
    }

    if (!phone) {
      return json({ error: 'Conversation requires a valid contact phone before sending.' }, 400);
    }

    try {
      const sendResult = await sendEvolutionTextMessage({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
        phone,
        text: parsed.data.content.trim(),
      });

      deliveryMetadata = {
        ...deliveryMetadata,
        provider: 'evolution',
        provider_message_id: sendResult.providerMessageId,
        delivery_status: 'sent',
        delivery_provider: 'evolution',
        delivery_attempt: sendResult.attemptLabel,
        delivery_raw: sendResult.raw,
        credential_source: resolved.source,
      };
    } catch (sendError) {
      deliveryWarning = sendError instanceof Error ? sendError.message : 'Falha ao enviar pela Evolution.';
      deliveryMetadata = {
        ...deliveryMetadata,
        provider: 'evolution',
        delivery_status: 'failed',
        delivery_provider: 'evolution',
        delivery_attempt: 'all-failed',
        delivery_error: deliveryWarning,
        credential_source: resolved.source,
      };
    }
  }

  const { data, error } = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: tenantId,
      direction: parsed.data.direction,
      message_type: parsed.data.message_type ?? 'text',
      author_name: authorName,
      content: parsed.data.content.trim(),
      metadata: deliveryMetadata,
      sent_at: now,
      created_at: now,
    })
    .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
    .single();

  if (error) return json({ error: error.message }, 500);

  const nextStatus =
    parsed.data.direction === 'outbound'
      ? 'human_active'
      : parsed.data.direction === 'inbound'
        ? thread.data.status === 'resolved'
          ? 'ai_active'
          : thread.data.status
        : thread.data.status;

  const updateThread = await admin
    .from('conversation_threads')
    .update({
      last_message_at: now,
      updated_at: now,
      status: nextStatus,
      metadata: buildConversationThreadMetadataUpdate(thread.data.metadata, {
        direction: parsed.data.direction,
        preview: parsed.data.content.trim().slice(0, 160),
        messageType: parsed.data.message_type ?? 'text',
        sentAt: now,
        authorName,
        unreadCount: parsed.data.direction === 'outbound' || parsed.data.direction === 'internal' ? 0 : null,
        incrementUnread: parsed.data.direction === 'inbound',
        routingMode:
          parsed.data.direction === 'outbound' || parsed.data.direction === 'internal'
            ? 'human'
            : thread.data.status === 'resolved'
              ? 'ai'
              : undefined,
        humanLocked:
          parsed.data.direction === 'outbound' || parsed.data.direction === 'internal'
            ? true
            : thread.data.status === 'resolved'
              ? false
              : undefined,
        aiLockedReason:
          parsed.data.direction === 'outbound' || parsed.data.direction === 'internal'
            ? 'human_active'
            : thread.data.status === 'resolved'
              ? null
              : undefined,
        resolvedAt: parsed.data.direction === 'inbound' && thread.data.status === 'resolved' ? null : undefined,
        resolvedBy: parsed.data.direction === 'inbound' && thread.data.status === 'resolved' ? null : undefined,
        queueAssignedUserId:
          parsed.data.direction === 'outbound' || parsed.data.direction === 'internal'
            ? thread.data.assigned_user_id ?? auth.profile.id
            : undefined,
      }),
    })
    .eq('id', threadId)
    .eq('organization_id', tenantId);

  if (updateThread.error) return json({ error: updateThread.error.message }, 500);

  try {
    const updatedThread = await loadConversationThreadInboxItem(admin, tenantId, threadId);
    return json({ ok: true, message: data, thread: updatedThread, warning: deliveryWarning }, 201);
  } catch (loadError) {
    return json({ error: loadError instanceof Error ? loadError.message : 'Falha ao carregar thread atualizada.' }, 500);
  }
}
