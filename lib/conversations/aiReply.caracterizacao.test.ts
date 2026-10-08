// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoObjectGeneratedError } from 'ai';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';

/**
 * Caracterização do OBJETO de resposta de `generateConversationAutoReply`, escrita ANTES de o miolo sair para
 * `aiReplyCore.ts` (Central de Agentes, fatia 3, Task 2 Step 0; revisão do Codex, rodada 1, achado 6). Trava o que o
 * atendimento real devolve hoje nos quatro ramos que a extração move: reparo da saída, política da agenda,
 * encerramento depois do repasse e etiquetas. Depois da extração, este arquivo continua passando sem mudar.
 */
const roteiro = vi.hoisted(() => ({ respostas: [] as Array<() => Promise<unknown>>, chamadas: 0 }));

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('ai')>();
  return {
    ...real,
    generateText: vi.fn(async () => {
      roteiro.chamadas += 1;
      const proxima = roteiro.respostas.shift();
      if (!proxima) throw new Error('generateText chamado sem resposta roteirizada');
      return proxima();
    }),
  };
});
vi.mock('@/lib/ai/config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/config')>();
  return { ...real, getModel: vi.fn(() => ({ modelId: 'modelo-teste' })) };
});
vi.mock('@/lib/googleCalendar/freeBusy', () => ({ loadGoogleBusyIntervals: vi.fn(async () => []) }));

import { generateConversationAutoReply } from './aiReply';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONN = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const HISTORICO = [
  { id: 'm1', direction: 'inbound', message_type: 'text', author_name: 'Pedro', content: 'Oi, quero marcar', sent_at: '2026-09-20T09:58:00.000Z', metadata: {} },
];

const PROMPT_SIMPLES = 'Voce atende {{contactName}}.\n{{recentMessagesText}}';
const PROMPT_AGENDA = 'Voce atende {{contactName}}.\nAGENDA: {{calendarContext}}\n{{recentMessagesText}}';
const PROMPT_ENCERRAMENTO = 'Voce atende {{contactName}}.\n{{conversationStageContext}}\n{{recentMessagesText}}';
const PROMPT_ETIQUETAS = 'Voce atende {{contactName}}.\nETIQUETAS: {{availableTagsContext}}\n{{recentMessagesText}}';

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

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** O objeto de uma resposta simples, sem nada marcado. `suggestedTags` é nulo quando o prompt não pede etiquetas. */
const NADA_MARCADO = {
  replyText: 'Oi Pedro!',
  summary: null,
  shouldHandoff: false,
  handoffType: null,
  handoffReason: null,
  requestedScheduleAt: null,
  requestedScheduleText: null,
  leadEmail: null,
  leadSegment: null,
  leadName: null,
  leadCompany: null,
  capacityGate: null,
  suggestedTags: null,
  conversationEnded: false,
};

function semear(prompt: string, opcoes: { config?: Record<string, unknown>; extras?: Record<string, Record<string, unknown>[]> } = {}) {
  return createFakeSupabaseAdmin({
    channel_connections: [{ id: CONN, organization_id: ORG, name: 'Comercial', config: { aiEnabled: true, ...(opcoes.config ?? {}) }, ai_agent_id: null }],
    ai_feature_flags: [{ organization_id: ORG, key: 'ai_conversation_auto_reply', enabled: true }],
    organization_settings: [{ organization_id: ORG, ai_enabled: true, ai_provider: 'anthropic', ai_model: 'claude-sonnet-5', ai_anthropic_key: 'sk-ant-teste' }],
    organizations: [{ id: ORG, name: 'Empresa Teste' }],
    ai_prompt_templates: [{ organization_id: ORG, key: PADRAO, content: prompt, version: 1, is_active: true, updated_at: '2026-09-01T00:00:00Z' }],
    activities: [],
    conversation_calendar_blocks: [],
    ...(opcoes.extras ?? {}),
  });
}

function gerar(admin: ReturnType<typeof semear>, closing: Parameters<typeof generateConversationAutoReply>[0]['closing'] = null) {
  return generateConversationAutoReply({
    admin: admin as never,
    organizationId: ORG,
    connectionId: CONN,
    contactName: 'Pedro',
    contactPhone: '5511999999999',
    recentMessages: HISTORICO as never,
    promptKey: PADRAO,
    closing,
    threadMetadata: {},
  });
}

const responde = (output: Record<string, unknown>) => () => Promise.resolve({ output });
const saidaFora = (text: string) => () =>
  Promise.reject(new NoObjectGeneratedError({
    message: 'No object generated: could not parse the response.',
    text,
    response: { id: 'r1', timestamp: new Date(), modelId: 'modelo-teste' } as never,
    usage: { inputTokens: 10, outputTokens: 5 } as never,
    finishReason: 'stop' as never,
  }));

beforeEach(() => {
  roteiro.respostas.length = 0;
  roteiro.chamadas = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('caracterização do objeto de resposta (antes de extrair o miolo)', () => {
  it('reparo: a saída fora do formato com o objeto numa cerca de markdown é recortada, sem segunda geração', async () => {
    roteiro.respostas.push(saidaFora('```json\n{"replyText":"Oi Pedro!","shouldHandoff":false}\n```'));
    const r = await gerar(semear(PROMPT_SIMPLES));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r).sort()).toEqual(['agent', 'object', 'ok', 'promptSha256', 'source', 'timing']);
    expect(r.object).toEqual(NADA_MARCADO);
    expect(r.source).toBe('override');
    expect(r.agent).toBeNull();
    expect(r.promptSha256).toBe(sha256(PROMPT_SIMPLES));
    expect(r.timing).toMatchObject({ generations: 1, repaired: true });
    expect(roteiro.chamadas).toBe(1);
  });

  it('reparo: saída irreparável → segunda geração, e é ela que vale', async () => {
    roteiro.respostas.push(saidaFora('nada de json aqui'), responde({ replyText: 'Segunda tentativa', shouldHandoff: false }));
    const r = await gerar(semear(PROMPT_SIMPLES));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual({ ...NADA_MARCADO, replyText: 'Segunda tentativa' });
    expect(r.timing).toMatchObject({ generations: 2, repaired: false });
    expect(roteiro.chamadas).toBe(2);
  });

  it('agenda: reunião confirmada num horário livre fica confirmada, com o horário em ISO UTC', async () => {
    roteiro.respostas.push(responde({
      replyText: 'Fechado, segunda as 9h.',
      shouldHandoff: true,
      handoffType: 'meeting_confirmed',
      handoffReason: 'Reuniao marcada',
      requestedScheduleAt: '2026-09-21T09:00:00-03:00',
      requestedScheduleText: 'segunda as 9h',
    }));
    const r = await gerar(semear(PROMPT_AGENDA, { config: CALENDAR_CONFIG }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual({
      ...NADA_MARCADO,
      replyText: 'Fechado, segunda as 9h.',
      shouldHandoff: true,
      handoffType: 'meeting_confirmed',
      handoffReason: 'Reuniao marcada',
      requestedScheduleAt: '2026-09-21T12:00:00.000Z',
      requestedScheduleText: 'segunda as 9h',
    });
  });

  it('agenda: reunião "confirmada" fora dos horários livres vira oferta de horários, sem repasse', async () => {
    roteiro.respostas.push(responde({
      replyText: 'Fechado, segunda as 15h.',
      shouldHandoff: true,
      handoffType: 'meeting_confirmed',
      handoffReason: 'Reuniao marcada',
      requestedScheduleAt: '2026-09-21T15:00:00-03:00',
      requestedScheduleText: 'segunda as 15h',
    }));
    const r = await gerar(semear(PROMPT_AGENDA, { config: CALENDAR_CONFIG }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual({
      ...NADA_MARCADO,
      replyText: expect.stringMatching(/^Ainda nao confirmei a reuniao\. Posso te oferecer .+ ou .+\. Qual horario funciona melhor para voce\?$/),
      // O motivo que o modelo escreveu continua no objeto, mesmo sem repasse: é assim hoje.
      handoffReason: 'Reuniao marcada',
      requestedScheduleText: 'segunda as 15h',
    });
  });

  it('encerramento: com o marcador, nunca abre repasse nem mexe na agenda, mesmo com o modelo pedindo', async () => {
    roteiro.respostas.push(responde({
      replyText: 'Ate logo!',
      shouldHandoff: true,
      handoffType: 'human_requested',
      handoffReason: 'quer falar com humano',
      requestedScheduleAt: '2026-09-21T09:00:00-03:00',
    }));
    const r = await gerar(semear(PROMPT_ENCERRAMENTO), {
      handoff: {
        type: 'human_requested',
        eventId: null,
        summary: null,
        reason: 'Pediu humano',
        requestedAt: '2026-09-20T09:00:00.000Z',
        requestedScheduleAt: null,
        requestedScheduleText: null,
        scheduleStatus: null,
        scheduleUpdatedAt: null,
        scheduleUpdatedBy: null,
        contactName: 'Pedro',
        contactPhone: '5511999999999',
      },
      repliesUsed: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual({ ...NADA_MARCADO, replyText: 'Ate logo!', handoffReason: 'quer falar com humano' });
  });

  it('encerramento: sem o marcador, closing_unsupported e o modelo nem é chamado', async () => {
    const r = await gerar(semear(PROMPT_SIMPLES), {
      handoff: {
        type: 'human_requested', eventId: null, summary: null, reason: 'Pediu humano', requestedAt: '2026-09-20T09:00:00.000Z',
        requestedScheduleAt: null, requestedScheduleText: null, scheduleStatus: null, scheduleUpdatedAt: null,
        scheduleUpdatedBy: null, contactName: 'Pedro', contactPhone: '5511999999999',
      },
      repliesUsed: 0,
    });
    expect(r).toEqual({ ok: false, reason: 'closing_unsupported' });
    expect(roteiro.chamadas).toBe(0);
  });

  it('etiquetas: com o marcador, só o nome do catálogo passa (pelo nome cadastrado); o inventado sai', async () => {
    roteiro.respostas.push(responde({ replyText: 'Oi Pedro!', shouldHandoff: false, suggestedTags: ['quente', 'Inventada'] }));
    const r = await gerar(semear(PROMPT_ETIQUETAS, {
      extras: {
        tag_categories: [{ id: 'c1', organization_id: ORG, label: 'Interesse', cardinality: 'single', archived_at: null }],
        tags: [{ id: 't1', organization_id: ORG, name: 'Quente', normalized_name: 'quente', category_id: 'c1', archived_at: null }],
      },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual({ ...NADA_MARCADO, suggestedTags: ['Quente'] });
  });

  it('etiquetas: sem o marcador, suggestedTags nulo e o catálogo nem é lido', async () => {
    roteiro.respostas.push(responde({ replyText: 'Oi Pedro!', shouldHandoff: false, suggestedTags: ['Quente'] }));
    const admin = semear(PROMPT_SIMPLES, {
      extras: {
        tag_categories: [{ id: 'c1', organization_id: ORG, label: 'Interesse', cardinality: 'single', archived_at: null }],
        tags: [{ id: 't1', organization_id: ORG, name: 'Quente', normalized_name: 'quente', category_id: 'c1', archived_at: null }],
      },
    });
    const lidas = vi.spyOn(admin, 'from');
    const r = await gerar(admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toEqual(NADA_MARCADO);
    const tabelas = lidas.mock.calls.map(([tabela]) => tabela);
    expect(tabelas).not.toContain('tags');
    expect(tabelas).not.toContain('tag_categories');
    expect(tabelas).toContain('organization_settings');
  });
});
