import { describe, expect, it } from 'vitest';
import {
  NATIVE_TRACE_METADATA_KEYS,
  mergeConversationDeliveryMetadata,
  stripNativeTraceMetadata,
} from './conversationDeliveryMetadata';

describe('conversation delivery metadata', () => {
  it('nao permite que metadado externo sobrescreva campos controlados pelo sistema', () => {
    expect(
      mergeConversationDeliveryMetadata(
        { provider: 'attacker', delivery_status: 'sent', campaign: 'meta-cenno' },
        { provider: 'evolution', delivery_status: 'failed' },
      )
    ).toEqual({
      provider: 'evolution',
      delivery_status: 'failed',
      campaign: 'meta-cenno',
    });
  });
});

describe('rastro da resposta nativa', () => {
  it('tira só as chaves de rastro do metadata externo', () => {
    expect(stripNativeTraceMetadata({
      native_ai: true,
      prompt_source: 'agent',
      prompt_sha256: 'a'.repeat(64),
      agent_id: 'forjado',
      agent_version: 9,
      ai_timing: { total_ms: 1 },
      campaign: 'meta-cenno',
    })).toEqual({ campaign: 'meta-cenno' });
  });

  it('a lista cobre as seis chaves que a leitura humana e a visão da agência leem', () => {
    expect([...NATIVE_TRACE_METADATA_KEYS].sort()).toEqual(
      ['agent_id', 'agent_version', 'ai_timing', 'native_ai', 'prompt_sha256', 'prompt_source'],
    );
  });

  it('sem metadata, devolve undefined', () => {
    expect(stripNativeTraceMetadata(undefined)).toBeUndefined();
  });
});
