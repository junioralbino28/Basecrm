export interface EvolutionMetadataInput {
  /** Nome do evento Evolution (ex.: 'messages.upsert'); pode não vir. */
  event: string | null | undefined;
  /** ID da mensagem no provedor (pode não vir). */
  providerMessageId: string | null | undefined;
}

export interface EvolutionMessageMetadata {
  provider: 'evolution';
  event: string | null | undefined;
  provider_message_id: string | null | undefined;
}

/**
 * Metadata persistida em `conversation_messages` para o canal Evolution.
 *
 * Fix do achado X (auditoria Codex): NÃO incluir `raw_payload` (o payload cru do
 * WhatsApp). É PII redundante — o conteúdo útil já vai na coluna `content` — e
 * inflava a linha com dados sensíveis sem necessidade. Mantém só o rastro mínimo de
 * proveniência. Extraído como função pura para travar o invariante em teste: se
 * alguém reintroduzir o payload cru, o teste de regressão quebra.
 */
export function buildEvolutionMessageMetadata(
  input: EvolutionMetadataInput
): EvolutionMessageMetadata {
  return {
    provider: 'evolution',
    event: input.event,
    provider_message_id: input.providerMessageId,
  };
}
