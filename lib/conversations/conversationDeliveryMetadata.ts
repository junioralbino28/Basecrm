export function mergeConversationDeliveryMetadata(
  externalMetadata: Record<string, unknown> | null | undefined,
  systemMetadata: Record<string, unknown>,
) {
  return {
    ...(externalMetadata || {}),
    ...systemMetadata,
  };
}

/**
 * Chaves que só o caminho nativo grava (webhook → gerador). As rotas do n8n e manual aceitam metadata livre,
 * e o merge acima só protege as chaves do sistema: sem esta limpeza, quem tem o segredo do webhook, ou quem
 * responde pela tela, grava uma "resposta nativa" com os campos que quiser (a prova da migração não lê o
 * metadata, mas a leitura humana e a visão da agência leem).
 */
export const NATIVE_TRACE_METADATA_KEYS = [
  'native_ai',
  'prompt_source',
  'prompt_sha256',
  'agent_id',
  'agent_version',
  'ai_timing',
] as const;

export function stripNativeTraceMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return undefined;
  const cleaned = { ...metadata };
  for (const key of NATIVE_TRACE_METADATA_KEYS) delete cleaned[key];
  return cleaned;
}
