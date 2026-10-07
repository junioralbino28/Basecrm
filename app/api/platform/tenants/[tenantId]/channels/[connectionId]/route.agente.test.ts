import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const AGENTE = '33333333-3333-4333-8333-333333333333';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';
const requireTenantAccessMock = vi.fn();
const bindingMock = vi.fn();
const updateMock = vi.fn();
const condicaoMock = vi.fn();
const baseConfig = { apiUrl: 'https://evolution.example.com', instanceName: 'comercial-a1b2', webhookSecret: 'S', apiKey: 'K', sendMode: 'number_text' };
const SEM_AGENTE = { id: CONNECTION, config: baseConfig, metadata: {}, ai_agent_id: null };
const LIGADO = { id: CONNECTION, config: baseConfig, metadata: {}, ai_agent_id: AGENTE };
/** Cada leitura de channel_connections consome o próximo item: a primeira é a da rota, a segunda é a releitura. */
let leituras: Array<Record<string, unknown> | null> = [];
/** O que a gravação devolve: a linha gravada, ou nenhuma (a condição não casou). */
let gravacaoCasa = true;

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
          const linha = {
            id: CONNECTION, provider: 'evolution', channel_type: 'whatsapp', name: 'Comercial', status: 'connected', config: updates.config, metadata: {},
          };
          const resposta = () => Promise.resolve({ data: gravacaoCasa ? linha : null, error: null });
          const encadeamento = {
            eq: () => encadeamento,
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
