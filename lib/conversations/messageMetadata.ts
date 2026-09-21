import type { InboundMediaInfo, InboundMediaMetadata, InboundMediaStatus } from './inboundMedia';

export interface EvolutionMetadataInput {
  /** Nome do evento Evolution (ex.: 'messages.upsert'); pode não vir. */
  event: string | null | undefined;
  /** ID da mensagem no provedor (pode não vir). */
  providerMessageId: string | null | undefined;
  /** Mídia reconhecida pelo parser; só existe com a chave de mídia da conexão ligada. */
  media?: (InboundMediaInfo & { status: InboundMediaStatus }) | null;
}

export interface EvolutionMessageMetadata {
  provider: 'evolution';
  event: string | null | undefined;
  provider_message_id: string | null | undefined;
  media?: InboundMediaMetadata;
}

/**
 * Metadata persistida em `conversation_messages` para o canal Evolution.
 *
 * Fix do achado X (auditoria Codex): NÃO incluir `raw_payload` (o payload cru do
 * WhatsApp). É PII redundante — o conteúdo útil já vai na coluna `content` — e
 * inflava a linha com dados sensíveis sem necessidade. Mantém só o rastro mínimo de
 * proveniência. Extraído como função pura para travar o invariante em teste: se
 * alguém reintroduzir o payload cru, o teste de regressão quebra.
 *
 * `media` (SPEC-midia-recebida) entra campo a campo, em lista fechada: tipo, tamanho declarado e
 * estado. Nunca `url`, `directPath`, `mediaKey` nem miniatura. Sem mídia, a chave nem existe.
 */
export function buildEvolutionMessageMetadata(
  input: EvolutionMetadataInput
): EvolutionMessageMetadata {
  const metadata: EvolutionMessageMetadata = {
    provider: 'evolution',
    event: input.event,
    provider_message_id: input.providerMessageId,
  };

  if (input.media) {
    metadata.media = {
      kind: input.media.kind,
      mimetype: input.media.mimetype,
      seconds: input.media.seconds,
      fileLength: input.media.fileLength,
      isAnimated: input.media.isAnimated,
      isLottie: input.media.isLottie,
      viewOnce: input.media.viewOnce,
      placeholder: input.media.placeholder,
      status: input.media.status,
    };
  }

  return metadata;
}
