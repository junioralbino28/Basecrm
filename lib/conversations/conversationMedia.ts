import {
  sendEvolutionMediaMessage,
  sendEvolutionAudioMessage,
  type EvolutionMediaType,
} from '@/lib/channels/evolution';

/**
 * Tipos de anexo que a conversa envia. `audio` vai por sendWhatsAppAudio (PTT);
 * o resto vai por sendMedia. Espelha os mediatypes da Evolution.
 */
export type ConversationAttachmentKind = EvolutionMediaType;

export type ConversationAttachment = {
  kind: ConversationAttachmentKind;
  /** URL pública/assinada OU base64 que a Evolution (server) consegue buscar. */
  mediaUrl: string;
  fileName?: string;
  caption?: string;
  mimetype?: string;
};

export type DispatchConversationMediaParams = {
  apiUrl: string;
  instanceName: string;
  apiKey: string;
  phone: string;
  attachment: ConversationAttachment;
};

/** Delivery metadata no MESMO formato do envio de texto (ver messages/route.ts). */
export type ConversationMediaDeliveryMetadata = {
  provider: 'evolution';
  provider_message_id?: string | null;
  delivery_status: 'sent' | 'failed';
  delivery_provider: 'evolution';
  delivery_attempt?: string;
  delivery_error?: string;
  delivery_raw?: unknown;
};

type Senders = {
  sendMedia: typeof sendEvolutionMediaMessage;
  sendAudio: typeof sendEvolutionAudioMessage;
};

const DEFAULT_SENDERS: Senders = {
  sendMedia: sendEvolutionMediaMessage,
  sendAudio: sendEvolutionAudioMessage,
};

/**
 * Roteia o anexo para a função Evolution correta (server-side) e devolve a
 * metadata de entrega — nunca lança: falha vira `delivery_status: 'failed'` pra
 * o registro da mensagem nunca se perder (lição F4: erro nunca silencioso, mas
 * a mensagem fica gravada como "falhou" pra reenvio).
 *
 * `senders` é injetável só pra teste; em produção usa as funções reais.
 */
export async function dispatchConversationMedia(
  params: DispatchConversationMediaParams,
  senders: Senders = DEFAULT_SENDERS
): Promise<ConversationMediaDeliveryMetadata> {
  const { attachment } = params;

  try {
    if (attachment.kind === 'audio') {
      const result = await senders.sendAudio({
        apiUrl: params.apiUrl,
        instanceName: params.instanceName,
        apiKey: params.apiKey,
        phone: params.phone,
        audio: attachment.mediaUrl,
      });
      return {
        provider: 'evolution',
        provider_message_id: result.providerMessageId,
        delivery_status: 'sent',
        delivery_provider: 'evolution',
        delivery_attempt: result.attemptLabel,
        delivery_raw: result.raw,
      };
    }

    const result = await senders.sendMedia({
      apiUrl: params.apiUrl,
      instanceName: params.instanceName,
      apiKey: params.apiKey,
      phone: params.phone,
      mediatype: attachment.kind,
      media: attachment.mediaUrl,
      caption: attachment.caption,
      fileName: attachment.fileName,
      mimetype: attachment.mimetype,
    });
    return {
      provider: 'evolution',
      provider_message_id: result.providerMessageId,
      delivery_status: 'sent',
      delivery_provider: 'evolution',
      delivery_attempt: result.attemptLabel,
      delivery_raw: result.raw,
    };
  } catch (error) {
    return {
      provider: 'evolution',
      delivery_status: 'failed',
      delivery_provider: 'evolution',
      delivery_attempt: 'all-failed',
      delivery_error: error instanceof Error ? error.message : 'Falha ao enviar mídia pela Evolution.',
    };
  }
}
