import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buildConversationThreadMetadataUpdate } from '@/lib/conversations/threadMetadata';
import { getConversationAssigneeDisplayName, loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { sendEvolutionTextMessage } from '@/lib/channels/evolution';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { dispatchConversationMedia, type ConversationAttachmentKind } from '@/lib/conversations/conversationMedia';
import { stripNativeTraceMetadata } from '@/lib/conversations/conversationDeliveryMetadata';
import {
  dispatchManualConversationOutbound,
  type OutboundDeliveryOutcome,
} from '@/lib/conversations/dispatchConversationOutbound';
import { toWhatsAppPhone } from '@/lib/phone';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import {
  LIMITE_LEGENDA_EXTERNA,
  LIMITE_TEXTO_EXTERNO,
  assinarMensagemDoAtendente,
  resolveAssinaturaAtivada,
  resolveNomeDoAtendente,
} from '@/lib/conversations/assinaturaAtendente';
import {
  conferirReplay,
  fingerprintDoPedido,
  warningDoReplay,
  type PedidoDeEnvio,
} from '@/lib/conversations/idempotenciaManual';

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
  idempotency_key: z.string().trim().min(1).max(200).optional(),
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

  const perfil = auth.profile as {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
  };

  // Autor SEMPRE do perfil autenticado. O `author_name` do corpo e campo livre de ate 160
  // caracteres: se vencesse, quem pode responder se passaria por outro atendente — e e exatamente
  // esse campo que a IA le em `formatRecentMessages` para montar o historico da conversa.
  const authorName = getConversationAssigneeDisplayName({
    email: perfil.email,
    first_name: perfil.first_name,
    last_name: perfil.last_name,
    nickname: perfil.nickname,
  });

  // Nome que o LEAD pode ver: sem o fallback de e-mail, que vazaria parte do endereco.
  const nomeDoAtendente = resolveNomeDoAtendente(perfil);

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
  const threadData = thread.data;

  const attachment = parsed.data.attachment ?? null;
  const messageContent = parsed.data.content?.trim() ?? '';
  // message_type: anexo manda o tipo (image/document/...); senão o que veio ou 'text'.
  const resolvedMessageType = attachment
    ? attachment.kind
    : parsed.data.message_type ?? 'text';

  // ---------------------------------------------------------------- idempotencia
  // A chave do CLIENTE identifica a tentativa logica; a consulta previa detecta replay ANTES de
  // qualquer efeito (validacao, pausa de automacao, signed URL, provider). Sem chave do cliente
  // (tela antiga), a rota gera uma no bloco de envio, como sempre — replay impossivel, custo zero.
  const chaveDoCliente =
    parsed.data.idempotency_key?.trim()
    || req.headers.get('idempotency-key')?.trim()
    || null;

  const pedidoDoEnvio: PedidoDeEnvio = {
    organizationId: tenantId,
    threadId,
    atorId: auth.profile.id,
    direction: parsed.data.direction,
    content: messageContent,
    attachmentPath: attachment?.file_path ?? null,
    sendExternal: parsed.data.send_external !== false,
  };

  const REPLAY_SELECT =
    'id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at, delivery_status, delivery_error';

  // Resposta de replay: a linha ORIGINAL e a thread ATUAL, sem update nenhum — o corpo do
  // segundo POST nunca vaza para o preview, e a pausa de automacao nao roda de novo.
  const responderReplay = async (linha: Record<string, unknown>) => {
    const { delivery_status, delivery_error, ...message } = linha as {
      delivery_status?: string | null;
      delivery_error?: string | null;
    } & Record<string, unknown>;
    try {
      const threadAtual = await loadConversationThreadInboxItem(admin, tenantId, threadId);
      return json({
        ok: true,
        replayed: true,
        message,
        thread: threadAtual,
        warning: warningDoReplay(delivery_status ?? null, delivery_error ?? null),
        delivery_status: delivery_status ?? null,
      }, 200);
    } catch (loadError) {
      return json({ error: loadError instanceof Error ? loadError.message : 'Falha ao carregar thread.' }, 500);
    }
  };

  const CONFLITO_DE_CHAVE = {
    error: 'Esta chave de envio ja foi usada com um pedido diferente. Nada foi reenviado.',
    code: 'IDEMPOTENCY_CONFLICT',
  };

  if (parsed.data.direction === 'outbound' && chaveDoCliente) {
    const existente = await admin
      .from('conversation_messages')
      .select(REPLAY_SELECT)
      .eq('organization_id', tenantId)
      .eq('idempotency_key', chaveDoCliente)
      .maybeSingle();
    if (existente.error) return json({ error: existente.error.message }, 500);
    if (existente.data) {
      // Replay e julgado contra o PEDIDO ORIGINAL, nunca contra perfil/configuracao/arquivo
      // atuais: o que ja foi tentado nao passa por validacao de novo.
      if (conferirReplay(existente.data, pedidoDoEnvio) === 'diferente') {
        return json(CONFLITO_DE_CHAVE, 409);
      }
      return responderReplay(existente.data);
    }
  }

  // O caminho de audio da Evolution (`sendAudio`) nao tem campo de legenda: o texto seria
  // descartado e a linha ficaria gravada como "enviado" com algo que o lead nunca recebeu.
  if (attachment?.kind === 'audio' && messageContent) {
    return json({
      error: 'Audio com texto ainda nao pode ser enviado junto. Mande o audio e o texto separados.',
    }, 422);
  }

  // A decisao de assinar e tomada AQUI, antes de qualquer efeito (reserva da mensagem, pausa de
  // automacao, chamada ao provider), e a mesma decisao vale do comeco ao fim desta tentativa.
  const vaiEnviarExterno =
    parsed.data.direction === 'outbound'
    && parsed.data.send_external !== false
    && Boolean(threadData.channel_connection_id);

  type ConnectionRow = {
    id: string;
    provider: string | null;
    channel_type: string | null;
    name: string | null;
    config: Record<string, unknown> | null;
  };
  let connectionRow: ConnectionRow | null = null;
  if (vaiEnviarExterno) {
    const connection = await admin
      .from('channel_connections')
      .select('id, provider, channel_type, name, config')
      .eq('id', threadData.channel_connection_id)
      .eq('organization_id', tenantId)
      .maybeSingle();
    if (connection.error) return json({ error: connection.error.message }, 500);
    if (!connection.data) return json({ error: 'Channel connection not found for this conversation.' }, 404);
    connectionRow = connection.data as ConnectionRow;
  }

  const assinaturaAtivada = vaiEnviarExterno && resolveAssinaturaAtivada(connectionRow?.config ?? null);

  if (assinaturaAtivada && !nomeDoAtendente) {
    return json({
      error: 'Complete seu nome ou apelido no perfil: este numero assina as respostas com o nome de quem atende.',
    }, 422);
  }

  const textoParaOLead = assinarMensagemDoAtendente({
    texto: messageContent,
    nomeDoAtendente,
    ativada: assinaturaAtivada,
  });

  // Teto medido DEPOIS do prefixo: o schema valida o corpo, nao o que sai daqui.
  const limiteExterno = attachment ? LIMITE_LEGENDA_EXTERNA : LIMITE_TEXTO_EXTERNO;
  if (vaiEnviarExterno && textoParaOLead.length > limiteExterno) {
    return json({
      error: `Mensagem longa demais para o WhatsApp: ${textoParaOLead.length} de ${limiteExterno} caracteres${assinaturaAtivada ? ' (o nome do atendente entra na conta)' : ''}.`,
    }, 422);
  }

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

  // O navegador não grava rastro de resposta nativa (prompt, agente, tempo): Central de Agentes, fatia 1.
  let deliveryMetadata: Record<string, unknown> = stripNativeTraceMetadata(parsed.data.metadata) ?? {};
  let deliveryWarning: string | null = null;
  let outboundDeliveryStatus: string | null = null;
  let persistedOutboundMessageId: string | null = null;

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

  // Quem de fato mandou, congelado no servidor DEPOIS do metadado que veio do navegador — o
  // payload nao pode forjar isto. Guarda o ator e o nome aplicado, nao o texto: reconstruir o
  // payload inteiro so seria necessario para exportacao fiel, que nao existe neste produto.
  deliveryMetadata = {
    ...deliveryMetadata,
    atendente: {
      versao: 1,
      atorId: auth.profile.id,
      nome: nomeDoAtendente,
      assinado: assinaturaAtivada,
    },
  };

  // O fingerprint do pedido logico congela o vinculo chave->pedido no servidor; como o
  // `atendente`, e escrito DEPOIS do spread para o navegador nao conseguir forjar.
  if (parsed.data.direction === 'outbound') {
    deliveryMetadata = {
      ...deliveryMetadata,
      intencao: { versao: 1, hash: fingerprintDoPedido(pedidoDoEnvio) },
    };
  }

  const storedContent =
    messageContent || (attachment ? attachment.file_name || `[${attachment.kind}]` : '');

  if (parsed.data.direction === 'outbound' || parsed.data.direction === 'internal') {
    const paused = await admin.rpc('pause_automation_enrollments_for_thread', {
      p_thread_id: threadId,
      p_actor_id: auth.profile.id,
      p_reason: 'manual_message',
    });
    if (paused.error) {
      return json({ error: 'Falha ao pausar automações da conversa.' }, 500);
    }
  }

  if (parsed.data.direction === 'outbound') {
    const idempotencyKey = chaveDoCliente || `manual:${threadId}:${randomUUID()}`;

    const deliver = async (): Promise<OutboundDeliveryOutcome> => {
      if (parsed.data.send_external === false || !threadData.channel_connection_id) {
        return {
          status: 'sent',
          providerMessageId: null,
          attemptLabel: 'local-only',
          error: null,
          metadata: { external_effect: false },
        };
      }

      // A conexão já foi lida e validada antes de qualquer efeito, junto com a decisão de assinar.
      if (!connectionRow) throw new Error('Channel connection not found for this conversation.');

      const instanceName = (connectionRow.config as any)?.instanceName;
      const resolved = await resolveEvolutionCredentials({
        admin,
        tenantId,
        connectionConfig: (connectionRow.config as Record<string, unknown> | null) || {},
        profileRole: auth.profile.role,
        requesterOrganizationId: auth.profile.organization_id,
      });
      const phone = toWhatsAppPhone(threadData.contact_phone);
      if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
        throw new Error(
          'WhatsApp connection requires instanceName and Evolution credentials before sending.'
        );
      }
      if (!phone) throw new Error('Conversation requires a valid contact phone before sending.');

      if (attachment && attachmentMediaUrl) {
        const result = await dispatchConversationMedia({
          apiUrl: resolved.apiUrl,
          instanceName,
          apiKey: resolved.apiKey,
          phone,
          attachment: {
            kind: attachment.kind as ConversationAttachmentKind,
            mediaUrl: attachmentMediaUrl,
            fileName: attachment.file_name,
            caption: textoParaOLead || undefined,
            mimetype: attachment.mime_type,
          },
        });
        return {
          status: result.delivery_status,
          providerMessageId: result.provider_message_id ?? null,
          attemptLabel: result.delivery_attempt ?? null,
          error: result.delivery_error ?? null,
          metadata: {
            ...result,
            credential_source: resolved.source,
          },
        };
      }

      const result = await sendEvolutionTextMessage({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
        phone,
        text: textoParaOLead,
      });
      return {
        status: 'sent',
        providerMessageId: result.providerMessageId,
        attemptLabel: result.attemptLabel,
        error: null,
        metadata: {
          provider: 'evolution',
          delivery_provider: 'evolution',
          delivery_raw: result.raw,
          credential_source: resolved.source,
        },
      };
    };

    const dispatched = await dispatchManualConversationOutbound({
      db: admin,
      message: {
        threadId,
        organizationId: tenantId,
        channelConnectionId: thread.data.channel_connection_id,
        idempotencyKey,
        messageType: resolvedMessageType,
        authorName,
        content: storedContent,
        metadata: deliveryMetadata,
        sentAt: now,
      },
      deliver,
    });
    persistedOutboundMessageId = dispatched.messageId;

    // Corrida que a consulta previa nao viu: dois POSTs simultaneos com a mesma chave, o INSERT
    // decidiu e este e o perdedor. A pausa de automacao dele ja rodou (idempotente — e o mesmo
    // efeito que o vencedor causou); daqui em diante, nenhum efeito novo.
    if (dispatched.duplicate) {
      const vencedora = await admin
        .from('conversation_messages')
        .select(REPLAY_SELECT)
        .eq('id', dispatched.messageId)
        .eq('organization_id', tenantId)
        .maybeSingle();
      if (vencedora.error) return json({ error: vencedora.error.message }, 500);
      if (!vencedora.data) return json({ error: 'Mensagem idempotente nao encontrada.' }, 500);
      if (conferirReplay(vencedora.data, pedidoDoEnvio) === 'diferente') {
        return json(CONFLITO_DE_CHAVE, 409);
      }
      return responderReplay(vencedora.data);
    }

    outboundDeliveryStatus = dispatched.status;
    // Falha e incerteza sao estados DIFERENTES: "failed" nao chegou e pode ser retentado;
    // "unknown" pode ter chegado — reenviar as cegas e o que duplica mensagem para o lead.
    deliveryWarning =
      dispatched.status === 'failed'
        ? dispatched.error || 'A entrega falhou antes de chegar ao WhatsApp.'
        : dispatched.status === 'unknown'
          ? dispatched.error || 'Entrega não confirmada pela Evolution.'
          : null;
  }

  const persisted = persistedOutboundMessageId
    ? await admin
      .from('conversation_messages')
      .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
      .eq('id', persistedOutboundMessageId)
      .eq('organization_id', tenantId)
      .single()
    : await admin
      .from('conversation_messages')
      .insert({
        thread_id: threadId,
        organization_id: tenantId,
        channel_connection_id: thread.data.channel_connection_id,
        direction: parsed.data.direction,
        message_type: resolvedMessageType,
        author_name: authorName,
        content: storedContent,
        metadata: deliveryMetadata,
        sent_at: now,
        created_at: now,
      })
      .select('id, thread_id, organization_id, direction, message_type, author_name, content, metadata, sent_at, created_at')
      .single();
  const { data, error } = persisted;

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
    return json({ ok: true, message: data, thread: updatedThread, warning: deliveryWarning, delivery_status: outboundDeliveryStatus }, 201);
  } catch (loadError) {
    return json({ error: loadError instanceof Error ? loadError.message : 'Falha ao carregar thread atualizada.' }, 500);
  }
}
