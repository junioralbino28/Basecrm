// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VALIDADE_DO_RETRATO_MS, assinarRetrato, conferirRetrato } from './retratoDoTeste';
import type { RetratoDoTeste } from './tiposDoEditor';

const AGORA = Date.parse('2026-10-08T19:00:00.000Z');
const VINCULO = { tenantId: '11111111-1111-4111-8111-111111111111', agentId: '22222222-2222-4222-8222-222222222222', revisao: 3 };
const RESPOSTA = { partes: ['Oi!', 'Como posso ajudar?'], repasse: { tipo: 'human_requested', motivo: 'pediu humano' } };

function assinado(): RetratoDoTeste {
  const r = assinarRetrato({ ...VINCULO, prompt: 'Prompt renderizado', provedor: 'google', modelo: 'gemini-3-flash', resposta: RESPOSTA }, AGORA);
  if (!r) throw new Error('sem chave');
  return r;
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SECRET_KEY', 'segredo-de-teste');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('retrato assinado do teste sem enviar', () => {
  it('assinado e conferido com os mesmos dados: ok', () => {
    const retrato = assinado();
    expect(retrato.expiraEm).toBe(AGORA + VALIDADE_DO_RETRATO_MS);
    expect(retrato.assinatura).toMatch(/^[0-9a-f]{64}$/);
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: RESPOSTA }, AGORA + 60_000)).toBe('ok');
  });

  it.each([
    ['prompt', (r: RetratoDoTeste) => ({ retrato: { ...r, prompt: 'Outro prompt' } })],
    ['provedor', (r: RetratoDoTeste) => ({ retrato: { ...r, provedor: 'openai' as const } })],
    ['modelo', (r: RetratoDoTeste) => ({ retrato: { ...r, modelo: 'outro-modelo' } })],
    ['expiraEm', (r: RetratoDoTeste) => ({ retrato: { ...r, expiraEm: r.expiraEm + 60_000 } })],
    ['uma parte da resposta', () => ({ resposta: { ...RESPOSTA, partes: ['Oi!', 'Outra coisa'] } })],
    ['o motivo do repasse', () => ({ resposta: { ...RESPOSTA, repasse: { tipo: 'human_requested', motivo: 'outro' } } })],
    ['o cliente', () => ({ tenantId: '33333333-3333-4333-8333-333333333333' })],
    ['o agente', () => ({ agentId: '44444444-4444-4444-8444-444444444444' })],
    ['a revisão', () => ({ revisao: 4 })],
  ])('mudar %s depois de assinar: invalido', (_nome, mudar) => {
    const retrato = assinado();
    const entrada = { ...VINCULO, retrato, resposta: RESPOSTA, ...mudar(retrato) };
    expect(conferirRetrato(entrada, AGORA + 60_000)).toBe('invalido');
  });

  it('a mesma resposta com as chaves em outra ordem: ok', () => {
    const retrato = assinado();
    const reordenada = { repasse: { motivo: 'pediu humano', tipo: 'human_requested' }, partes: ['Oi!', 'Como posso ajudar?'] };
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: reordenada }, AGORA + 60_000)).toBe('ok');
  });

  it('16 minutos depois: vencido', () => {
    const retrato = assinado();
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: RESPOSTA }, AGORA + 16 * 60_000)).toBe('vencido');
  });

  it('assinatura fora do formato: invalido, sem lançar', () => {
    const retrato = { ...assinado(), assinatura: 'nao-e-hex' };
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: RESPOSTA }, AGORA)).toBe('invalido');
  });

  it('outro segredo no servidor: o retrato antigo não confere', () => {
    const retrato = assinado();
    vi.stubEnv('SUPABASE_SECRET_KEY', 'outro-segredo');
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: RESPOSTA }, AGORA)).toBe('invalido');
  });

  it('sem nenhum segredo no servidor: assinar devolve nulo e conferir, sem_chave', () => {
    const retrato = assinado();
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(assinarRetrato({ ...VINCULO, prompt: 'p', provedor: 'google', modelo: 'm', resposta: RESPOSTA }, AGORA)).toBeNull();
    expect(conferirRetrato({ ...VINCULO, retrato, resposta: RESPOSTA }, AGORA)).toBe('sem_chave');
  });
});
