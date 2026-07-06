import { describe, expect, it } from 'vitest';
import { buildEvolutionMessageMetadata } from './messageMetadata';

// Regressão do achado X: a metadata da mensagem NÃO pode voltar a carregar o payload
// cru do WhatsApp (raw_payload). Se alguém reintroduzir, este teste quebra.

describe('buildEvolutionMessageMetadata — não persiste payload cru (achado X)', () => {
  it('não inclui raw_payload e mantém só a proveniência mínima', () => {
    const md = buildEvolutionMessageMetadata({
      event: 'messages.upsert',
      providerMessageId: 'ABC123',
    });
    expect(md).not.toHaveProperty('raw_payload');
    expect(Object.keys(md).sort()).toEqual(['event', 'provider', 'provider_message_id']);
    expect(md.provider).toBe('evolution');
    expect(md.event).toBe('messages.upsert');
    expect(md.provider_message_id).toBe('ABC123');
  });

  it('aceita provider_message_id ausente', () => {
    const md = buildEvolutionMessageMetadata({ event: 'messages.upsert', providerMessageId: null });
    expect(md).not.toHaveProperty('raw_payload');
    expect(md.provider_message_id).toBeNull();
  });
});
