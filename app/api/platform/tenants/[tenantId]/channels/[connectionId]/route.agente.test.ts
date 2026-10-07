import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const requireTenantAccessMock = vi.fn();
const bindingMock = vi.fn();
const updateMock = vi.fn();
const condicaoMock = vi.fn();
/** Toda condição `.eq(coluna, valor)` das gravações (a gravação e o desfazer). */
const eqDaGravacaoMock = vi.fn();
const baseConfig = { apiUrl: 'https://evolution.example.com', instanceName: 'comercial-a1b2', webhookSecret: 'S', apiKey: 'K', sendMode: 'number_text' };
const ANTES = { name: 'Comercial', status: 'connected', last_healthcheck_at: null, updated_at: '2026-10-01T12:00:00.000+00:00' };
const SEM_AGENTE = { id: CONNECTION, ...ANTES, config: baseConfig, metadata: {}, ai_agent_id: null };
const LIGADO = { id: CONNECTION, ...ANTES, config: baseConfig, metadata: {}, ai_agent_id: AGENTE };
/** Cada leitura de channel_connections consome o próximo item: a primeira é a da rota, a segunda é a releitura. */
let leituras: Array<Record<string, unknown> | null> = [];
/** O que a gravação devolve: a linha gravada, ou nenhuma (a condição não casou). */
let gravacaoCasa = true;
/**
 * Quando não vazia, cada gravação consome o próximo item no lugar de `gravacaoCasa` (a gravação e depois o desfazer):
 * true = a linha casa, false = não casa, 'lanca' = a chamada lança (rede).
 */
let respostasDaGravacao: Array<boolean | 'lanca'> = [];

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: (role: unknown) => role === 'agency_admin' }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  ensureTenantAgencyBinding: (...args: unknown[]) => bindingMock(...args),
  resolveEvolutionCredentials: vi.fn(),
}));
vi.mock('@/lib/channels/evolution', () => ({ logoutEvolutionInstance: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === 'ai_agents') {
        const consulta = { select: () => consulta, eq: () => consulta, maybeSingle: () => Promise.resolve({ data: { name: 'Aurora' }, error: null }) };
        return consulta;
      }
      const leitura = {
        select: () => leitura,
        eq: () => leitura,
        maybeSingle: () => Promise.resolve({ data: leituras.shift() ?? null, error: null }),
      };
      return {
        select: () => leitura,
        update: (updates: Record<string, unknown>) => {
          updateMock(updates);
          const casa = respostasDaGravacao.length > 0 ? respostasDaGravacao.shift() : gravacaoCasa;
          const linha = {
            id: CONNECTION, provider: 'evolution', channel_type: 'whatsapp', name: 'Comercial', status: 'connected', config: updates.config, metadata: {},
            updated_at: updates.updated_at,
          };
          const resposta = () =>
            casa === 'lanca'
              ? Promise.reject(new Error('Falha de rede simulada.'))
              : Promise.resolve({ data: casa ? linha : null, error: null });
          const encadeamento = {
            eq: (coluna: string, valor: unknown) => {
              eqDaGravacaoMock(coluna, valor);
              return encadeamento;
            },
            is: (coluna: string, valor: unknown) => {
              condicaoMock(coluna, valor);
              return encadeamento;
            },
            select: () => ({ single: resposta, maybeSingle: resposta }),
          };
          return encadeamento;
        },
      };
    },
  }),
}));

import { PATCH } from './route';

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost:3000/api/platform/tenants/${TENANT}/channels/${CONNECTION}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tenantId: TENANT, connectionId: CONNECTION }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  gravacaoCasa = true;
  respostasDaGravacao = [];
  // Admin da agência entrando no cliente: é o caminho que passa pela vinculação do cliente à agência.
  requireTenantAccessMock.mockResolvedValue({ profile: { role: 'agency_admin', organization_id: 'org-agencia' }, canManageChannelConfig: true });
});

describe('PATCH da conexão — número ligado a um agente', () => {
  it('aiPromptKey num número ligado: 409 com o nome do agente, sem gravar nada, nem a vinculação à agência', async () => {
    leituras = [LIGADO];
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(409);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ code: 'NUMERO_COM_AGENTE', agentId: AGENTE });
    expect(corpo.error).toContain('Aurora');
    expect(updateMock).not.toHaveBeenCalled();
    expect(bindingMock).not.toHaveBeenCalled();
  });

  it('número ligado: os outros campos continuam editáveis (pausar a IA no número), sem a condição da chave', async () => {
    leituras = [LIGADO];
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(condicaoMock).not.toHaveBeenCalled();
  });

  it('número sem agente: aiPromptKey continua aceita, gravada só se ele seguir sem agente', async () => {
    leituras = [SEM_AGENTE];
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(200);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({ config: { aiPromptKey: AURORA } });
    expect(condicaoMock).toHaveBeenCalledWith('ai_agent_id', null);
    // A vinculação à agência continua acontecendo, mas só DEPOIS da gravação que deu certo (rodada 2).
    expect(bindingMock).toHaveBeenCalledOnce();
    expect(bindingMock.mock.invocationCallOrder[0]).toBeGreaterThan(updateMock.mock.invocationCallOrder[0]);
  });

  it('ligação feita entre a leitura e a gravação: a gravação não pega a linha e a resposta é 409, nunca 200', async () => {
    leituras = [SEM_AGENTE, LIGADO];
    gravacaoCasa = false;
    const r = await patch({ config: { aiPromptKey: AURORA } });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'NUMERO_COM_AGENTE', agentId: AGENTE });
    // Nenhuma gravação sobra num pedido recusado, nem a vinculação à agência (revisão do Codex, rodada 2).
    expect(bindingMock).not.toHaveBeenCalled();
  });

  it('número que sumiu entre a leitura e a gravação: 404', async () => {
    leituras = [SEM_AGENTE, null];
    gravacaoCasa = false;
    expect((await patch({ config: { aiPromptKey: AURORA } })).status).toBe(404);
    expect(bindingMock).not.toHaveBeenCalled();
  });
});

describe('PATCH da conexão — vinculação à agência falha depois da gravação (revisão do Codex, rodada 3)', () => {
  it('a gravação passou e a vinculação falhou: a conexão volta ao que era e a resposta é 500', async () => {
    leituras = [SEM_AGENTE];
    bindingMock.mockRejectedValueOnce(new Error('Falha simulada na vinculação.'));
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ code: 'VINCULACAO_FALHOU' });
    expect(corpo.error).toContain('Nada foi alterado na conexão.');

    expect(updateMock).toHaveBeenCalledTimes(2);
    const [gravou, desfez] = updateMock.mock.calls.map(([updates]) => updates as Record<string, unknown>);
    expect(gravou.config).toMatchObject({ aiEnabled: false });
    // O desfazer devolve exatamente as colunas gravadas ao valor lido antes, inclusive o updated_at...
    expect(desfez).toEqual({ config: SEM_AGENTE.config, updated_at: SEM_AGENTE.updated_at });
    // ...e só pega a linha se ela ainda é a que esta rota gravou (ninguém gravou depois)...
    expect(eqDaGravacaoMock).toHaveBeenCalledWith('updated_at', gravou.updated_at);
    // ...e se continua sem agente, como foi lida: ligar não muda o updated_at (rodada 4). A gravação deste pedido não
    // usa `.is` (não traz aiPromptKey), então a condição é do desfazer.
    expect(condicaoMock).toHaveBeenCalledWith('ai_agent_id', null);
  });

  it('a vinculação falhou e o desfazer não pegou a linha (alguém gravou ou ligou depois): 500 com o aviso', async () => {
    leituras = [SEM_AGENTE];
    respostasDaGravacao = [true, false];
    bindingMock.mockRejectedValueOnce(new Error('Falha simulada na vinculação.'));
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ code: 'VINCULACAO_FALHOU_SEM_DESFAZER' });
    expect(corpo.error).toContain('pode ter ficado alterada');
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('o desfazer lança (rede): 500 com o aviso, nunca uma exceção solta (rodada 4)', async () => {
    leituras = [SEM_AGENTE];
    respostasDaGravacao = [true, 'lanca'];
    bindingMock.mockRejectedValueOnce(new Error('Falha simulada na vinculação.'));
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ code: 'VINCULACAO_FALHOU_SEM_DESFAZER' });
  });

  it('número ligado: o desfazer só pega a linha se ela continua com o MESMO agente lido (rodada 4)', async () => {
    leituras = [LIGADO];
    bindingMock.mockRejectedValueOnce(new Error('Falha simulada na vinculação.'));
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ code: 'VINCULACAO_FALHOU' });
    expect(eqDaGravacaoMock).toHaveBeenCalledWith('ai_agent_id', AGENTE);
    expect(condicaoMock).not.toHaveBeenCalled();
  });

  it('vinculação que dá certo: uma gravação só, sem desfazer', async () => {
    leituras = [SEM_AGENTE];
    const r = await patch({ config: { aiEnabled: false } });
    expect(r.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(eqDaGravacaoMock).not.toHaveBeenCalledWith('updated_at', expect.anything());
  });
});
