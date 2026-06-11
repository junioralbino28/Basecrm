import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { getConversationAssigneeDisplayName, loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { dispatchConversationMedia, type ConversationAttachmentKind } from '@/lib/conversations/conversationMedia';
import { toWhatsAppPhone } from '@/lib/phone';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ATTACHMENT_KINDS = ['image', 'video', 'document', 'audio'] as const;

// Anexo de conversa: o arquivo JÁ foi subido pro bucket `deal-files` (RLS por
// tenant) pelo cliente; aqui o servidor só recebe o ponteiro (file_path do deal)
// e gera o signed URL server-side pra Evolution. file_path nunca vem do browser
// como URL aberta — sempre re-resolvido pelo metadado do deal.
const AttachmentSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  file_path: z.string().min(1).max(400),
  file_name: z.string().max(240).optional(),
  mime_type: z.string().max(160).optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
}).strict();

const MessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound', 'internal']),
  message_type: z.string().min(1).max(50).optional(),
  author_name: z.string().max(160).optional(),
  // content vira opcional quando há anexo (caption pode ser vazio).
  content: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  send_external: z.boolean().optional(),
  attachment: AttachmentSchema.optional(),
}).strict().refine(
  (value) => Boolean(value.content?.trim()) || Boolean(value.attachment),
  { message: 'content ou attachment é obrigatório', path: ['content'] }
);

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
    .select('id, status, metadata, channel_connection_id, contact_phone, assigned_user_id, deal_id')
    .eq('id', threadId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (thread.error) return json({ error: thread.error.message }, 500);
  if (!thread.data) return json({ error: 'Thread not found' }, 404);

  const attachment = parsed.data.attachment ?? null;
  const messageContent = parsed.data.content?.trim() ?? '';
  // message_type: anexo manda o tipo (image/document/...); senão o que veio ou 'text'.
  const resolvedMessageType = attachment
    ? attachment.kind
    : parsed.data.message_type ?? 'text';

  // Anexo: re-resolve o arquivo pelo metadado `deal_files` (defesa em profundidade:
  // o file_path tem que pertencer a um deal DESTE tenant ligado à thread) e gera o
  // signed URL SERVER-SIDE — o browser nunca manda uma URL aberta pra Evolution.
  let attachmentMediaUrl: string | null = null;
  if (attachment) {
    const fileRow = await admin
      .from('deal_files')
      .select('id, deal_id, file_path, file_name, mime_type, file_size')
      .eq('file_path', attachment.file_path)
      .maybeSingle();

    if (fileRow.error) return json({ error: fileRow.error.message }, 500);
    if (!fileRow.data) return json({ error: 'Attachment file not found.' }, 404);

    // O arquivo precisa pertencer a um deal da própria thread/tenant.
    const dealOwner = await admin
      .from('deals')
      .select('id, organization_id')
      .eq('id', fileRow.data.deal_id)
      .maybeSingle();

    if (dealOwner.error) return json({ error: dealOwner.error.message }, 500);
    if (!dealOwner.data || dealOwner.data.organization_id !== tenantId) {
      return json({ error: 'Attachment does not belong to this tenant.' }, 403);
    }
    if (thread.data.deal_id && fileRow.data.deal_id !== thread.data.deal_id) {
      return json({ error: 'Attachment does not belong to this conversation deal.' }, 403);
    }

    const signed = await admin.storage
      .from('deal-files')
      .createSignedUrl(fileRow.data.file_path, 3600);

    if (signed.error || !signed.data?.signedUrl) {
      return json({ error: signed.error?.message || 'Falha ao gerar URL assinada do anexo.' }, 500);
    }
    attachmentMediaUrl = signed.data.signedUrl;
  }

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

    if (attachment && attachmentMediaUrl) {
      // Mídia/áudio: dispatcher server-side roteia sendMedia/sendWhatsAppAudio e
      // nunca lança — falha vira delivery_status: 'failed' (mensagem fica gravada).
      const delivery = await dispatchConversationMedia({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
        phone,
        attachment: {
          kind: attachment.kind as ConversationAttachmentKind,
          mediaUrl: attachmentMediaUrl,
          fileName: attachment.file_name,
          caption: messageContent || undefined,
          mimetype: attachment.mime_type,
        },
      });

      if (delivery.delivery_status === 'failed') {
        deliveryWarning = delivery.delivery_error || 'Falha ao enviar mídia pela Evolution.';
      }
      deliveryMetadata = {
        ...deliveryMetadata,
        ...delivery,
        credential_source: resolved.source,
      };
    } else {
      try {
        const sendResult = await sendEvolutionTextMessage({
          apiUrl: resolved.apiUrl,
          instanceName,
          apiKey: resolved.apiKey,
          phone,
          text: messageContent,
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
  }

  // Metadata de mídia pra UI renderizar a bolha (doc/áudio/imagem) sem refetch.
  if (attachment) {
    deliveryMetadata = {
      ...deliveryMetadata,
      attachment: {
        kind: attachment.kind,
        file_path: attachment.file_path,
        file_name: attachment.file_name ?? null,
        mime_type: attachment.mime_type ?? null,
        file_size: attachment.file_size ?? null,
      },
    };
  }

  const { data, error } = await admin
    .from('conversation_messages')
    .insert({
      thread_id: threadId,
      organization_id: tenantId,
      direction: parsed.data.direction,
      message_type: resolvedMessageType,
      author_name: authorName,
      // content é NOT NULL; mídia sem caption guarda um rótulo legível.
      content: messageContent || (attachment ? attachment.file_name || `[${attachment.kind}]` : ''),
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
        preview: (messageContent || (attachment ? attachment.file_name || `[${attachment.kind}]` : '')).slice(0, 160),
        messageType: resolvedMessageType,
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
