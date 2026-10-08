// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoObjectGeneratedError } from 'ai';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

const roteiro = vi.hoisted(() => ({
  respostas: [] as Array<() => Promise<unknown>>,
  argumentos: [] as Array<Record<string, unknown>>,
}));
const loadGoogleBusyIntervalsMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async (args: Record<string, unknown>) => {
      roteiro.argumentos.push(args);
      const proxima = roteiro.respostas.shift();
      if (!proxima) throw new Error('generateText chamado sem resposta roteirizada');
      return proxima();
    }),
  };
});
vi.mock('@/lib/googleCalendar/freeBusy', () => ({
  loadGoogleBusyIntervals: (...args: unknown[]) => loadGoogleBusyIntervalsMock(...(args as [])),
}));

import { criarFetchContador } from '@/lib/ai/medicaoResposta';
import { carregarContextoDaResposta, responderComModelo, type ContextoDaResposta } from './aiReplyCore';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const SENTINELA = 'SENTINELA-NAO-LOGAR-7731';
const CALENDAR_CONFIG = {
  calendar: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    ownerId: OWNER,
    minimumNoticeMinutes: 60,
    schedulingHorizonDays: 7,
    humanConfirmationWeekdays: ['saturday'],
    weeklyHours: {
      monday: [{ start: '09:00', end: '12:00' }],
      tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
    },
  },
};

const CONTEXTO_SIMPLES: ContextoDaResposta = {
  prompt: 'Responda o lead.',
  calendarAvailability: { calendar: null, availableMeetingSlots: [], calendarContext: 'AGENDA_NAO_CONFIGURADA.' },
  calendarMs: 0,
  tagCatalog: [],
  wantsTagContext: false,
};

const saidaFora = (text: string, usage: Record<string, unknown>) => () =>
  Promise.reject(new NoObjectGeneratedError({
    message: 'No object generated: could not parse the response.',
    text,
    response: { id: 'r1', timestamp: new Date(), modelId: 'modelo-teste' } as never,
    usage: usage as never,
    finishReason: 'stop' as never,
  }));

function responder(extra: Partial<Parameters<typeof responderComModelo>[0]> = {}) {
  return responderComModelo({
    model: { modelId: 'modelo-teste' } as never,
    fetchContador: criarFetchContador(),
    organizationId: ORG,
    inicio: Date.now(),
    contexto: CONTEXTO_SIMPLES,
    closing: false,
    recentMessages: [],
    ...extra,
  });
}

function base(extra: Partial<Parameters<typeof carregarContextoDaResposta>[0]> = {}) {
  return {
    admin: createFakeSupabaseAdmin({ activities: [], conversation_calendar_blocks: [] }) as never,
    organizationId: ORG,
    connection: null,
    promptContent: 'Voce atende {{contactName}}.\nAGENDA: {{calendarContext}}\n{{recentMessagesText}}',
    organizationName: 'Empresa Teste',
    automationTimezone: null,
    contactName: 'Pedro',
    contactPhone: '5500000000000',
    recentMessages: [],
    closing: null,
    threadMetadata: null,
    ...extra,
  } satisfies Parameters<typeof carregarContextoDaResposta>[0];
}

beforeEach(() => {
  roteiro.respostas.length = 0;
  roteiro.argumentos.length = 0;
  loadGoogleBusyIntervalsMock.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('carregarContextoDaResposta', () => {
  it('sem número: agenda "não configurada" e nenhuma leitura de agenda', async () => {
    const entrada = base();
    const lidas = vi.spyOn(entrada.admin as unknown as { from: (t: string) => unknown }, 'from');
    const r = await carregarContextoDaResposta(entrada);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contexto.calendarAvailability.calendar).toBeNull();
    expect(r.contexto.prompt).toContain('AGENDA: AGENDA_NAO_CONFIGURADA');
    const tabelas = lidas.mock.calls.map(([t]) => t);
    expect(tabelas).not.toContain('activities');
    expect(tabelas).not.toContain('conversation_calendar_blocks');
    expect(loadGoogleBusyIntervalsMock).not.toHaveBeenCalled();
  });

  it('somenteLeitura: a agenda do Google é lida sem registrar falha e sem preencher o cache', async () => {
    await carregarContextoDaResposta(base({ connection: { id: CONN, config: CALENDAR_CONFIG }, somenteLeitura: true }));
    expect(loadGoogleBusyIntervalsMock).toHaveBeenCalledWith(expect.objectContaining({ recordFailures: false, fillCache: false }));
  });

  it('sem somenteLeitura (atendimento real): registra falha e preenche o cache, como sempre', async () => {
    await carregarContextoDaResposta(base({ connection: { id: CONN, config: CALENDAR_CONFIG } }));
    expect(loadGoogleBusyIntervalsMock).toHaveBeenCalledWith(expect.objectContaining({ recordFailures: true, fillCache: true }));
  });

  it('encerramento com prompt sem {{conversationStageContext}}: closing_unsupported', async () => {
    const r = await carregarContextoDaResposta(base({
      promptContent: 'Voce atende {{contactName}}.',
      closing: {
        handoff: {
          type: 'human_requested', eventId: null, summary: null, reason: 'Pediu humano', requestedAt: '2026-09-20T09:00:00.000Z',
          requestedScheduleAt: null, requestedScheduleText: null, scheduleStatus: null, scheduleUpdatedAt: null,
          scheduleUpdatedBy: null, contactName: 'Pedro', contactPhone: '5500000000000',
        },
        repliesUsed: 0,
      },
    }));
    expect(r).toEqual({ ok: false, reason: 'closing_unsupported' });
  });
});

describe('responderComModelo', () => {
  it('soma o consumo das duas gerações quando a primeira sai fora do formato', async () => {
    roteiro.respostas.push(
      saidaFora('nada de json', { inputTokens: 10, outputTokens: 5 }),
      () => Promise.resolve({
        output: { replyText: 'Oi!', shouldHandoff: false },
        usage: { inputTokens: 20, outputTokens: 7, outputTokenDetails: { reasoningTokens: 3 }, inputTokenDetails: { cacheReadTokens: 4 } },
      }),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await responder();
    expect(r.uso).toEqual({ entrada: 30, saida: 12, raciocinio: 3, entradaEmCache: 4 });
    expect(r.timing.generations).toBe(2);
  });

  it('provedor sem consumo informado: tudo nulo, nunca zero inventado', async () => {
    roteiro.respostas.push(() => Promise.resolve({ output: { replyText: 'Oi!', shouldHandoff: false } }));
    const r = await responder();
    expect(r.uso).toEqual({ entrada: null, saida: null, raciocinio: null, entradaEmCache: null });
  });

  it('o log da saída fora do formato nunca leva o texto, em nenhum caminho (G22): só o tamanho e a forma', async () => {
    const cru = `{"replyText": "texto cru com ${SENTINELA}`;
    roteiro.respostas.push(saidaFora(cru, {}), () => Promise.resolve({ output: { replyText: 'Oi!', shouldHandoff: false } }));
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await responder();
    const registrado = avisos.mock.calls.map((chamada) => JSON.stringify(chamada)).join('\n');
    expect(registrado).not.toContain(SENTINELA);
    const aviso = avisos.mock.calls.find((chamada) => String(chamada[0]).includes('could not be parsed'));
    expect(aviso?.[1]).toMatchObject({ textLength: cru.length, startsWithBrace: true, endsWithBrace: false });
  });

  it('G22: duas falhas de formato seguidas lançam o erro, e o log continua sem o texto do modelo', async () => {
    roteiro.respostas.push(
      saidaFora(`{"replyText": "primeira ${SENTINELA}`, {}),
      saidaFora(`{"replyText": "segunda ${SENTINELA}`, {}),
    );
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(responder()).rejects.toThrow();
    expect(avisos.mock.calls.map((chamada) => JSON.stringify(chamada)).join('\n')).not.toContain(SENTINELA);
  });

  it('prazo: com abortSignal, o modelo recebe o sinal; sem ele, a chamada sai sem a chave, como hoje', async () => {
    const sinal = AbortSignal.timeout(45_000);
    roteiro.respostas.push(() => Promise.resolve({ output: { replyText: 'Oi!', shouldHandoff: false } }));
    await responder({ abortSignal: sinal });
    expect(roteiro.argumentos[0].abortSignal).toBe(sinal);

    roteiro.respostas.push(() => Promise.resolve({ output: { replyText: 'Oi!', shouldHandoff: false } }));
    await responder();
    expect(Object.keys(roteiro.argumentos[1])).not.toContain('abortSignal');
  });
});
