import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { toWhatsAppPhone } from '@/lib/phone';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function getSecretFromRequest(req: Request) {
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret')?.trim();
  if (querySecret) return querySecret;

  const headerSecret = req.headers.get('x-webhook-secret')?.trim();
  if (headerSecret) return headerSecret;

  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  return '';
}

const AIReplySchema = z.object({
  threadId: z.string().uuid(),
  replyText: z.string().min(1).max(4000),
  summary: z.string().max(2000).nullable().optional(),
  shouldHandoff: z.boolean().optional(),
  handoffReason: z.string().max(240).nullable().optional(),
  authorName: z.string().max(160).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const secret = getSecretFromRequest(req);
  if (!secret) return json({ error: 'Secret ausente' }, 401);

  const body = await req.json().catch(() => null);
  const parsed = AIReplySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Payload invalido', details: parsed.error.flatten() }, 400);
  }

  const admin = createStaticAdminClient();
  const connectionResult = await admin
    .from('channel_connections')
    .select('id, organization_id, name, config')
    .eq('id', connectionId)
    .eq('provider', 'evolution')
    .eq('channel_type', 'whatsapp')
    .maybeSingle();

  if (connectionResult.error) return json({ error: connectionResult.error.message }, 500);
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);

  const expectedSecret = String((connectionResult.data.config as Record<string, unknown> | null)?.webhookSecret || '').trim();
  if (!expectedSecret || expectedSecret !== secret) return json({ error: 'Secret invalido' }, 401);

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, organization_id, channel_connection_id, contact_phone, status, metadata, assigned_user_id')
    .eq('id', parsed.data.threadId)
    .eq('organization_id', connectionResult.data.organization_id)
    .eq('channel_connection_id', connectionId)
    .maybeSingle();

  if (threadResult.error) return json({ error: threadResult.error.message }, 500);
  if (!threadResult.data) return json({ error: 'Thread nao encontrada' }, 404);

  if (threadResult.data.status === 'human_active' || threadResult.data.status === 'human_queue') {
    return json({ ok: true, ignored: true, reason: 'thread_em_atendimento_humano' });
  }

  const apiUrl = String((connectionResult.data.config as Record<string, unknown> | null)?.apiUrl || '').trim();
  const instanceName = String((connectionResult.data.config as Record<string, unknown> | null)?.instanceName || '').trim();
  const apiKey = String((connectionResult.data.config as Record<string, unknown> | null)?.apiKey || '').trim();
  const sendMode = ((connectionResult.data.config as Record<string, unknown> | null)?.sendMode || 'auto') as
    | 'auto'
    | 'number_text'
    | 'number_textMessage'
    | 'number_message'
    | 'number_body';

  const phone = toWhatsAppPhone(threadResult.data.contact_phone);
  if (!apiUrl || !instanceName || !apiKey) {
    return json({ error: 'Conexao WhatsApp sem apiUrl, instanceName ou apiKey configurados.' }, 400);
  }
  if (!phone) {
    return json({ error: 'Thread sem telefone valido para envio.' }, 400);
  }

  const now = new Date().toISOString();
  let deliveryMetadata: Record<string, unknown> = {
    provider: 'evolution',
    automation_source: 'n8n',
    ai_summary: parsed.data.summary ?? null,
    ai_handoff_reason: parsed.data.handoffReason ?? null,
    ...parsed.data.metadata,
  };
  let deliveryWarning: string | null = null;

  try {
    const sendResult = await sendEvolutionTextMessage({
      apiUrl,
      instanceName,
      apiKey,
      phone,
      text: parsed.data.replyText.trim(),
      sendMode,
    });

    deliveryMetadata = {
      ...deliveryMetadata,
      provider_message_id: sendResult.providerMessageId,
      delivery_status: 'sent',
      delivery_provider: 'evolution',
      delivery_attempt: sendResult.attemptLabel,
      delivery_raw: sendResult.raw,
    };
  } catch (error) {
    deliveryWarning = error instanceof Error ? error.message : 'Falha ao enviar resposta automatica.';
    deliveryMetadata = {
      ...deliveryMetadata,
      delivery_status: 'failed',
      delivery_provider: 'evolution',
      delivery_attempt: 'all-failed',
      delivery_error: deliveryWarning,
    };
  }

  const insertedMessage = await admin
    .from('conversation_messages')
    .insert({
      thread_id: parsed.data.threadId,
      organization_id: connectionResult.data.organization_id,
      direction: 'outbound',
      message_type: 'text',
      author_name: parsed.data.authorName?.trim() || 'IA de atendimento',
      content: parsed.data.replyText.trim(),
      metadata: deliveryMetadata,
      sent_at: now,
      created_at: now,
    })
    .select('id')
    .single();

  if (insertedMessage.error) return json({ error: insertedMessage.error.message }, 500);

  const nextStatus = parsed.data.shouldHandoff ? 'human_queue' : 'ai_active';
  const nextMetadata = buildConversationThreadMetadataUpdate(threadResult.data.metadata, {
    direction: 'outbound',
    preview: parsed.data.replyText.trim().slice(0, 160),
    messageType: 'text',
    sentAt: now,
    authorName: parsed.data.authorName?.trim() || 'IA de atendimento',
    unreadCount: 0,
    routingMode: parsed.data.shouldHandoff ? 'human' : 'ai',
    humanLocked: parsed.data.shouldHandoff ? true : false,
    aiLockedReason: parsed.data.shouldHandoff ? (parsed.data.handoffReason?.trim() || 'human_handoff') : null,
    handoffRequestedAt: parsed.data.shouldHandoff ? now : null,
    handoffReason: parsed.data.shouldHandoff ? (parsed.data.handoffReason?.trim() || 'human_handoff') : null,
    queueAssignedUserId: parsed.data.shouldHandoff ? threadResult.data.assigned_user_id ?? null : null,
    provider: 'evolution',
  });

  const threadUpdate = await admin
    .from('conversation_threads')
    .update({
      status: nextStatus,
      last_message_at: now,
      updated_at: now,
      metadata: nextMetadata,
    })
    .eq('id', parsed.data.threadId)
    .eq('organization_id', connectionResult.data.organization_id);

  if (threadUpdate.error) return json({ error: threadUpdate.error.message }, 500);

  if (parsed.data.summary?.trim()) {
    const summaryInsert = await admin
      .from('conversation_messages')
      .insert({
        thread_id: parsed.data.threadId,
        organization_id: connectionResult.data.organization_id,
        direction: 'internal',
        message_type: 'note',
        author_name: 'IA de atendimento',
        content: `Resumo IA: ${parsed.data.summary.trim()}`,
        metadata: {
          provider: 'evolution',
          automation_source: 'n8n',
          note_type: 'ai_summary',
        },
        sent_at: now,
        created_at: now,
      });

    if (summaryInsert.error) {
      return json({ error: summaryInsert.error.message }, 500);
    }
  }

  const thread = await loadConversationThreadInboxItem(admin, connectionResult.data.organization_id, parsed.data.threadId);
  return json({
    ok: true,
    warning: deliveryWarning,
    thread,
    status: nextStatus,
  });
}
