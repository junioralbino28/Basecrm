import { createHash } from 'node:crypto';

export function buildConversationScopedEventId(input: {
  organizationId: string;
  threadId: string;
  eventId: string;
}) {
  const digest = createHash('sha256')
    .update(`${input.organizationId}:${input.threadId}:${input.eventId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');

  digest[12] = '5';
  digest[16] = ((Number.parseInt(digest[16] ?? '0', 16) & 0x3) | 0x8).toString(16);

  const hex = digest.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
