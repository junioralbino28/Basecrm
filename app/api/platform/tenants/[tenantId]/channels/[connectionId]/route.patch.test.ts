import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';

const requireTenantAccessMock = vi.fn();
const updateMock = vi.fn();

const TENANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const baseConfig = {
  apiUrl: 'https://evolution.example.com',
  instanceName: 'comercial-vitoria-a1b2c3d4',
  webhookSecret: 'WEBHOOK-SECRET',
  apiKey: 'EVOLUTION-KEY',
  sendMode: 'number_text',
};
// A configuração "gravada" é mutável para cada caso montar o cenário (com/sem chave própria).
let currentConfig: Record<string, unknown> = { ...baseConfig };

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  return { lookup, default: { lookup } };
});
vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/auth/scope', () => ({ isAgencyAdminRole: () => false }));
vi.mock('@/lib/channels/evolutionCredentials', () => ({
  ensureTenantAgencyBinding: vi.fn(),
  resolveEvolutionCredentials: vi.fn(),
}));
vi.mock('@/lib/channels/evolution', () => ({ logoutEvolutionInstance: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: { id: CONNECTION, config: currentConfig, metadata: { phoneNumber: '5511999' } },
              error: null,
            }),
          }),
        }),
      }),
      update: (updates: Record<string, unknown>) => {
        updateMock(updates);
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: CONNECTION,
                    provider: 'evolution',
                    channel_type: 'whatsapp',
                    name: 'Comercial',
                    status: 'connected',
                    config: updates.config,
                    metadata: { phoneNumber: '5511999' },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    }),
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
  currentConfig = { ...baseConfig };
  delete process.env.EVOLUTION_ALLOW_PRIVATE_HOSTS; // a guarda do B7 tem que estar ligada aqui
  requireTenantAccessMock.mockResolvedValue({
    profile: { role: 'clinic_admin', organization_id: TENANT },
    canManageChannelConfig: true,
  });
});

describe('PATCH channel connection — aiEnabled', () => {
  it('altera somente o gate de IA e preserva toda a configuração da Evolution', async () => {
    const response = await patch({ config: { aiEnabled: false } });

    expect(response.status).toBe(200);
    expect(requireTenantAccessMock).toHaveBeenCalledWith(TENANT, {
      requiredPermissions: ['whatsapp.manage_connection'],
    });
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: { ...baseConfig, aiEnabled: false },
    });
  });

  it('não reabre a validação do par quando o pedido não mexe em apiUrl/apiKey (conexão legada parcial)', async () => {
    currentConfig = { ...baseConfig, apiKey: undefined };
    const response = await patch({ config: { aiEnabled: false } });
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
  });

  it('configura a identidade e o prompt da Aurora sem apagar a Evolution', async () => {
    const response = await patch({
      config: {
        aiAgentName: 'Aurora',
        aiPromptKey: 'task_conversations_whatsapp_cenno_aurora',
      },
    });

    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        ...baseConfig,
        aiAgentName: 'Aurora',
        aiPromptKey: 'task_conversations_whatsapp_cenno_aurora',
      },
    });
  });

  it('recusa nome ou chave de prompt fora do contrato', async () => {
    const response = await patch({
      config: { aiAgentName: '<script>Aurora</script>', aiPromptKey: '../../prompt' },
    });

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('recusa uma chave bem formada que nao existe no catalogo', async () => {
    const response = await patch({
      config: { aiAgentName: 'Aurora', aiPromptKey: 'task_prompt_inexistente' },
    });

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('PATCH channel connection — agenda da IA', () => {
  it('salva uma agenda valida sem apagar a configuracao da Evolution', async () => {
    const calendar = {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      ownerId: '33333333-3333-4333-8333-333333333333',
      minimumNoticeMinutes: 60,
      schedulingHorizonDays: 14,
      weeklyHours: {
        monday: [{ start: '09:00', end: '18:00' }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
    };

    const response = await patch({ config: { calendar } });

    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: { ...baseConfig, calendar },
    });
  });

  it('recusa agenda habilitada sem faixa de atendimento', async () => {
    const response = await patch({
      config: {
        calendar: {
          enabled: true,
          timezone: 'America/Sao_Paulo',
          ownerId: '33333333-3333-4333-8333-333333333333',
          minimumNoticeMinutes: 60,
          schedulingHorizonDays: 14,
          weeklyHours: {
            monday: [], tuesday: [], wednesday: [], thursday: [],
            friday: [], saturday: [], sunday: [],
          },
        },
      },
    });

    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('PATCH channel connection — regra do par (parecer do Codex, B7)', () => {
  it('apiUrl sem chave (nem nova, nem gravada) é recusado com 400 e nada é gravado', async () => {
    currentConfig = { ...baseConfig, apiKey: undefined };
    const response = await patch({ config: { apiUrl: 'https://host-do-atacante.example', apiKey: '' } });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(String(body.error)).toMatch(/informe também a chave/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('apiUrl para rede interna é recusado mesmo com chave', async () => {
    const response = await patch({ config: { apiUrl: 'http://169.254.169.254/latest', apiKey: 'nova' } });

    expect(response.status).toBe(400);
    expect(String((await response.json()).error)).toMatch(/rede interna/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('host público que resolve para IP interno é recusado (DNS conferido)', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never);
    const response = await patch({ config: { apiUrl: 'https://parece-publico.example.com', apiKey: 'nova' } });

    expect(response.status).toBe(400);
    expect(String((await response.json()).error)).toMatch(/rede interna/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('apiUrl novo com a chave já gravada é aceito e o par completo fica na conexão', async () => {
    const response = await patch({ config: { apiUrl: 'https://nova.example.com', apiKey: '' } });

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(updateMock.mock.calls[0]?.[0]).toMatchObject({
      config: { ...baseConfig, apiUrl: 'https://nova.example.com', apiKey: 'EVOLUTION-KEY' },
    });
  });

  it('apagar o endereço próprio é aceito: a conexão volta a usar o par da agência', async () => {
    const response = await patch({ config: { apiUrl: '' } });

    expect(response.status).toBe(200);
    const saved = updateMock.mock.calls[0]?.[0] as { config: Record<string, unknown> };
    expect(saved.config.apiUrl).toBeUndefined();
  });
});
