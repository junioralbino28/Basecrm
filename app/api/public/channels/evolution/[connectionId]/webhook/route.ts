import { createStaticAdminClient } from '@/lib/supabase/server';
import { parseEvolutionWebhookPayload } from '@/lib/conversations/evolutionWebhook';
import {
  buildConversationThreadMetadataUpdate,
  buildConversationPhoneCandidates,
  getCanonicalConversationPhone,
} from '@/lib/conversations/threadMetadata';
import { getConversationStatusAfterInbound } from '@/lib/conversations/routing';

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

function buildThreadTitle(contactName: string | null, contactPhone: string) {
  return `WhatsApp - ${contactName || contactPhone}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const secret = getSecretFromRequest(req);
  if (!secret) return json({ error: 'Secret ausente' }, 401);

  const payload = await req.json().catch(() => null);
  if (!payload) return json({ error: 'JSON invalido' }, 400);

  const parsed = parseEvolutionWebhookPayload(payload);
  if (!parsed) {
    return json({
      ok: true,
      ignored: true,
      reason: 'payload sem mensagem suportada',
    });
  }
  const contactPhone = parsed.contactPhone;
  const content = parsed.content;
  if (!contactPhone || !content) {
    return json({ ok: true, ignored: true, reason: 'mensagem sem telefone ou conteudo' });
  }

  const admin = createStaticAdminClient();
  const connectionResult = await admin
    .from('channel_connections')
    .select('id, organization_id, provider, channel_type, name, config, metadata')
    .eq('id', connectionId)
    .eq('provider', 'evolution')
    .eq('channel_type', 'whatsapp')
    .maybeSingle();

  if (connectionResult.error) return json({ error: connectionResult.error.message }, 500);
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);

  const expectedSecret = String((connectionResult.data.config as Record<string, unknown> | null)?.webhookSecret || '').trim();
  if (!expectedSecret || expectedSecret !== secret) return json({ error: 'Secret invalido' }, 401);

  if (parsed.providerMessageId) {
    const existingMessage = await admin
      .from('conversation_messages')
      .select('id, thread_id')
      .eq('organization_id', connectionResult.data.organization_id)
      .eq('metadata->>provider_message_id', parsed.providerMessageId)
      .limit(1)
      .maybeSingle();

    if (existingMessage.error) return json({ error: existingMessage.error.message }, 500);
    if (existingMessage.data) {
      return json({
        ok: true,
        duplicate: true,
        thread_id: existingMessage.data.thread_id,
        message_id: existingMessage.data.id,
      });
    }
  }

  let contactId: string | null = null;
  const phoneCandidates = buildConversationPhoneCandidates(contactPhone);
  const canonicalPhone = getCanonicalConversationPhone(contactPhone) || contactPhone;
  const contactResult = await admin
    .from('contacts')
    .select('id, name, phone')
    .eq('organization_id', connectionResult.data.organization_id)
    .in('phone', phoneCandidates.length > 0 ? phoneCandidates : [contactPhone])
    .limit(1)
    .maybeSingle();

  if (contactResult.error) return json({ error: contactResult.error.message }, 500);
  if (contactResult.data?.id) {
    contactId = contactResult.data.id;
  }

  const threadResult = await admin
    .from('conversation_threads')
    .select('id, status, metadata')
    .eq('organization_id', connectionResult.data.organization_id)
    .eq('channel_connection_id', connectionId)
    .in('contact_phone', phoneCandidates.length > 0 ? phoneCandidates : [contactPhone])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (threadResult.error) return json({ error: threadResult.error.message }, 500);

  const now = new Date().toISOString();
  let threadId = threadResult.data?.id ?? null;

  if (!threadId) {
    const createdThread = await admin
      .from('conversation_threads')
      .insert({
        organization_id: connectionResult.data.organization_id,
        channel_connection_id: connectionId,
        contact_id: contactId,
        title: buildThreadTitle(parsed.contactName || contactResult.data?.name || null, canonicalPhone),
        contact_name: parsed.contactName || contactResult.data?.name || null,
        contact_phone: canonicalPhone,
        status: parsed.direction === 'inbound' ? 'ai_active' : 'resolved',
        metadata: buildConversationThreadMetadataUpdate(
          {
            provider: 'evolution',
            autoCreated: true,
            routingMode: 'ai',
          },
          {
            direction: parsed.direction,
            event: parsed.event,
            preview: content.slice(0, 160),
            messageType: parsed.messageType,
            sentAt: parsed.sentAt,
            authorName: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
            incrementUnread: parsed.direction === 'inbound',
            provider: 'evolution',
            humanLocked: false,
            aiLockedReason: null,
          }
        ),
        last_message_at: parsed.sentAt,
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (createdThread.error) return json({ error: createdThread.error.message }, 500);
    threadId = createdThread.data.id;
  } else {
    const updatedThread = await admin
      .from('conversation_threads')
      .update({
        contact_id: contactId ?? undefined,
        contact_name: parsed.contactName || contactResult.data?.name || undefined,
        contact_phone: canonicalPhone,
        status:
          parsed.direction === 'inbound'
            ? getConversationStatusAfterInbound(threadResult.data?.status)
            : threadResult.data?.status ?? 'resolved',
        last_message_at: parsed.sentAt,
        updated_at: now,
        metadata: buildConversationThreadMetadataUpdate(threadResult.data?.metadata, {
          provider: 'evolution',
          direction: parsed.direction,
          event: parsed.event,
          preview: content.slice(0, 160),
          messageType: parsed.messageType,
          sentAt: parsed.sentAt,
          authorName: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
          incrementUnread: parsed.direction === 'inbound',
          unreadCount: parsed.direction === 'outbound' ? 0 : null,
          humanLocked:
            parsed.direction === 'inbound'
              ? ['human_active', 'human_queue'].includes(threadResult.data?.status || '')
              : undefined,
          aiLockedReason:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
          resolvedAt:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
          resolvedBy:
            parsed.direction === 'inbound' && threadResult.data?.status === 'resolved'
              ? null
              : undefined,
        }),
      })
      .eq('id', threadId)
      .eq('organization_id', connectionResult.data.organization_id);

    if (updatedThread.error) return json({ error: updatedThread.error.message }, 500);
  }

  const insertedMessage = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: connectionResult.data.organization_id,
      direction: parsed.direction,
      message_type: parsed.messageType,
      author_name: parsed.direction === 'inbound' ? parsed.contactName : connectionResult.data.name,
      content,
      metadata: {
        provider: 'evolution',
        event: parsed.event,
        provider_message_id: parsed.providerMessageId,
        raw_payload: parsed.raw,
      },
      sent_at: parsed.sentAt,
      created_at: now,
    })
    .select('id')
    .single();

  if (insertedMessage.error) return json({ error: insertedMessage.error.message }, 500);

  const currentConnectionMetadata = (connectionResult.data.metadata as Record<string, unknown> | null) || {};
  const connectionUpdate = await admin
    .from('channel_connections')
    .update({
      updated_at: now,
      metadata: {
        ...currentConnectionMetadata,
        lastInboundAt: parsed.sentAt,
        lastInboundPhone: contactPhone,
        lastInboundPreview: content.slice(0, 160),
      },
    })
    .eq('id', connectionId)
    .eq('organization_id', connectionResult.data.organization_id);

  if (connectionUpdate.error) return json({ error: connectionUpdate.error.message }, 500);

  return json({
    ok: true,
    thread_id: threadId,
    message_id: insertedMessage.data.id,
    direction: parsed.direction,
  });
}
