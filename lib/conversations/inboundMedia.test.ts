import { describe, expect, it } from 'vitest';
import {
  describeInboundMediaBadge,
  readInboundMediaMetadata,
  resolveInboundMediaMode,
  type InboundMediaMetadata,
} from './inboundMedia';
import { buildInboundMediaNotification } from './inboundMediaNotification';

const audio: InboundMediaMetadata = {
  kind: 'audio',
  mimetype: 'audio/ogg; codecs=opus',
  seconds: 21,
  fileLength: 48211,
  isAnimated: false,
  isLottie: false,
  viewOnce: false,
  placeholder: true,
  status: 'recorded',
};

describe('resolveInboundMediaMode: só dois valores ligam a chave', () => {
  it.each([
    [undefined, 'off'],
    [null, 'off'],
    [{}, 'off'],
    [{ media: null }, 'off'],
    [{ media: 'understand' }, 'off'],
    [{ media: ['understand'] }, 'off'],
    [{ media: {} }, 'off'],
    [{ media: { mode: 'off' } }, 'off'],
    [{ media: { mode: 'UNDERSTAND' } }, 'off'],
    [{ media: { mode: true } }, 'off'],
    [{ media: { mode: 'record' } }, 'record'],
    [{ media: { mode: 'understand', enabledAt: '2026-09-21', enabledBy: 'junior' } }, 'understand'],
  ])('%j → %s', (config, expected) => {
    expect(resolveInboundMediaMode(config as Record<string, unknown> | null | undefined)).toBe(expected);
  });
});

describe('readInboundMediaMetadata: só aceita o formato que o servidor escreve', () => {
  it('lê o que o webhook gravou', () => {
    expect(readInboundMediaMetadata({ provider: 'evolution', media: audio })).toEqual(audio);
  });

  it('sem media, tipo desconhecido ou formato errado = sem selo', () => {
    expect(readInboundMediaMetadata(null)).toBeNull();
    expect(readInboundMediaMetadata({ provider: 'evolution' })).toBeNull();
    expect(readInboundMediaMetadata({ media: 'audio' })).toBeNull();
    expect(readInboundMediaMetadata({ media: { kind: 'hologram' } })).toBeNull();
    expect(readInboundMediaMetadata({ media: { kind: 'toString' } })).toBeNull();
  });

  it('estado desconhecido cai para "recorded" e número inválido vira null', () => {
    const read = readInboundMediaMetadata({ media: { kind: 'audio', status: 'hackeado', seconds: -3, fileLength: 'muito' } });
    expect(read).toMatchObject({ status: 'recorded', seconds: null, fileLength: null, placeholder: false });
  });
});

describe('describeInboundMediaBadge: texto do selo', () => {
  it('áudio gravado sem texto manda ouvir no aparelho', () => {
    expect(describeInboundMediaBadge(audio)).toEqual({ label: 'Áudio · 0:21', note: 'ouça no aparelho', tone: 'neutral' });
  });

  it('duração em minutos e visualização única', () => {
    expect(describeInboundMediaBadge({ ...audio, seconds: 125, viewOnce: true }).label).toBe('Áudio · 2:05 · visualização única');
    expect(describeInboundMediaBadge({ ...audio, kind: 'image', seconds: 9 }).label).toBe('Imagem');
  });

  it('imagem com legenda não ganha nota', () => {
    expect(describeInboundMediaBadge({ ...audio, kind: 'image', seconds: null, placeholder: false }).note).toBeNull();
  });

  it.each([
    ['pending', 'entendendo…', 'neutral'],
    ['done', 'transcrição automática, pode conter erro', 'neutral'],
    ['empty', 'sem fala reconhecível: ouça no aparelho', 'warning'],
    ['failed', 'não transcrito: ouça no aparelho', 'warning'],
    ['timeout', 'não transcrito: ouça no aparelho', 'warning'],
    ['limit', 'limite de mídia atingido: ouça no aparelho', 'warning'],
    ['skipped_no_key', 'sem chave de IA para esta mídia: ouça no aparelho', 'warning'],
  ] as const)('áudio em %s', (status, note, tone) => {
    expect(describeInboundMediaBadge({ ...audio, status })).toMatchObject({ note, tone });
  });

  it('imagem fala em descrição e em ver no aparelho', () => {
    const image = { ...audio, kind: 'image' as const, seconds: null };
    expect(describeInboundMediaBadge({ ...image, status: 'done' }).note).toBe('descrição automática, pode conter erro');
    expect(describeInboundMediaBadge({ ...image, status: 'failed' }).note).toBe('não descrito: veja no aparelho');
  });
});

describe('buildInboundMediaNotification: avisa sem tirar a conversa da IA', () => {
  const base = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    threadId: '33333333-3333-4333-8333-333333333333',
    contactLabel: 'Maria',
    kind: 'sticker' as const,
  };

  it('monta o aviso com link da conversa', () => {
    const notification = buildInboundMediaNotification({ ...base, createdAt: '2026-09-21T16:00:00.000Z' });
    expect(notification).toMatchObject({
      organization_id: base.organizationId,
      type: 'SYSTEM_ALERT',
      severity: 'medium',
      read_at: null,
      link: `/platform/tenants/${base.organizationId}/conversations?thread=${base.threadId}`,
    });
    expect(notification.message).toContain('Maria: chegou figurinha sem texto');
    expect(notification.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('rajada na mesma conversa vira um aviso só; outra conversa ou outra janela, outro aviso', () => {
    const first = buildInboundMediaNotification({ ...base, createdAt: '2026-09-21T16:00:05.000Z' });
    const burst = buildInboundMediaNotification({ ...base, createdAt: '2026-09-21T16:04:00.000Z' });
    const later = buildInboundMediaNotification({ ...base, createdAt: '2026-09-21T16:31:00.000Z' });
    const other = buildInboundMediaNotification({ ...base, threadId: '44444444-4444-4444-8444-444444444444', createdAt: '2026-09-21T16:00:05.000Z' });

    expect(burst.id).toBe(first.id);
    expect(later.id).not.toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });
});
