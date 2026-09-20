export function mergeConversationDeliveryMetadata(
  externalMetadata: Record<string, unknown> | null | undefined,
  systemMetadata: Record<string, unknown>,
) {
  return {
    ...(externalMetadata || {}),
    ...systemMetadata,
  };
}
