import { describe, expect, it } from 'vitest';
import { aplicarGateCapacidade, lerGateCapacidade } from './gateCapacidade';
import { ConversationAutoReplySchema } from './aiReply';

const T1 = '2026-09-27T12:00:00.000Z';
const T2 = '2026-09-28T09:00:00.000Z';

describe('gate de capacidade — gravacao na metadata da conversa', () => {
  it('turno sem gate passa direto, sem inventar chave', () => {
    const proxima = { lastDirection: 'outbound' };
    expect(aplicarGateCapacidade(proxima, null, null, T1)).toBe(proxima);
    expect(aplicarGateCapacidade(proxima, null, undefined, T1)).toBe(proxima);
  });

  it('primeiro registro grava atual e primeiro iguais', () => {
    const r = aplicarGateCapacidade({}, null, 'failed', T1);
    expect(r.gateCapacidade).toEqual({
      resultado: 'failed',
      em: T1,
      primeiroResultado: 'failed',
      primeiroEm: T1,
    });
  });

  it('unanswered NUNCA rebaixa um passed/failed ja decidido', () => {
    const anterior = aplicarGateCapacidade({}, null, 'passed', T1);
    const r = aplicarGateCapacidade({}, anterior, 'unanswered', T2);
    expect(r.gateCapacidade).toEqual(anterior.gateCapacidade);
  });

  it('o lead pode mudar de situacao (failed -> passed), mas o PRIMEIRO resultado e imutavel', () => {
    // A campanha mede o gate do primeiro contato por anuncio; a operacao ve o estado atual.
    const anterior = aplicarGateCapacidade({}, null, 'failed', T1);
    const r = aplicarGateCapacidade({}, anterior, 'passed', T2);
    expect(r.gateCapacidade).toEqual({
      resultado: 'passed',
      em: T2,
      primeiroResultado: 'failed',
      primeiroEm: T1,
    });
  });

  it('unanswered primeiro, decisao depois: o primeiro registrado e o unanswered', () => {
    const anterior = aplicarGateCapacidade({}, null, 'unanswered', T1);
    const r = aplicarGateCapacidade({}, anterior, 'passed', T2);
    expect(r.gateCapacidade).toEqual({
      resultado: 'passed',
      em: T2,
      primeiroResultado: 'unanswered',
      primeiroEm: T1,
    });
  });

  it('preserva o resto da metadata que ia ser gravada', () => {
    const r = aplicarGateCapacidade({ unreadCount: 0, provider: 'evolution' }, null, 'passed', T1);
    expect(r.unreadCount).toBe(0);
    expect(r.provider).toBe('evolution');
  });

  it('leitura tolera formato invalido sem quebrar', () => {
    expect(lerGateCapacidade(null)).toBeNull();
    expect(lerGateCapacidade({})).toBeNull();
    expect(lerGateCapacidade({ gateCapacidade: 'passed' })).toBeNull();
    expect(lerGateCapacidade({ gateCapacidade: { resultado: 'talvez', em: T1 } })).toBeNull();
  });
});

describe('gate de capacidade — contrato do structured output', () => {
  const base = { replyText: 'ok' };

  it('aceita os tres resultados e null', () => {
    for (const v of ['passed', 'failed', 'unanswered', null]) {
      const parsed = ConversationAutoReplySchema.safeParse({ ...base, capacityGate: v });
      expect(parsed.success, String(v)).toBe(true);
    }
  });

  it('rejeita valor fora do enum (o detector funciona)', () => {
    const parsed = ConversationAutoReplySchema.safeParse({ ...base, capacityGate: 'maybe' });
    expect(parsed.success).toBe(false);
  });

  it('campo ausente continua valido (prompts sem gate nao mudam)', () => {
    expect(ConversationAutoReplySchema.safeParse(base).success).toBe(true);
  });
});
