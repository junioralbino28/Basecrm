import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regressão do achado C1: o GET /api/settings/ai devolvia a chave LLM CRUA pro browser
// (lida via service-role, sem redação). Após o fix, a chave crua nunca sai do servidor.
//
// C2B (Junior, 17/09/2026): o motor de IA é da AGÊNCIA. O admin do CLIENTE não escolhe
// provedor, não vê os últimos dígitos da chave e não troca o modelo — mas continua podendo
// PAUSAR a IA (`aiEnabled`), que é o único campo liberado para ele.

const authMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('@/lib/platform/adminTenantContext', () => ({
  requireAdminTenantContext: (...a: unknown[]) => authMock(...a),
}));

vi.mock('@/lib/security/sameOrigin', () => ({
  isAllowedOrigin: () => true,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: () => ({
        upsert: (...a: unknown[]) => {
          upsertMock(...a);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  createStaticAdminClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              ai_enabled: true,
              ai_provider: 'google',
              ai_model: 'gemini-x',
              ai_google_key: 'AIzaSyD-EXEMPLO-super-secreta-1234',
              ai_openai_key: null,
              ai_anthropic_key: null,
            },
            error: null,
          }),
      };
      return chain;
    },
  }),
}));

import { GET, POST } from './route';

const comoClinica = { targetOrganizationId: 'org-A', isAgencyAdmin: false, isClinicAdmin: true };
const comoAgencia = { targetOrganizationId: 'org-A', isAgencyAdmin: true, isClinicAdmin: false };

function pedido(body: Record<string, unknown>) {
  return new Request('https://crm.exemplo/api/settings/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(comoClinica);
});

describe('GET /api/settings/ai — redação da chave (C1)', () => {
  it('a chave crua NUNCA vai pro browser, nem para a agência', async () => {
    authMock.mockResolvedValue(comoAgencia);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.aiGoogleKey).toBe('');
    expect(JSON.stringify(body)).not.toContain('super-secreta');

    // A agência reconhece a chave pelos últimos 4 dígitos.
    expect(body.aiHasGoogleKey).toBe(true);
    expect(body.aiGoogleKeyLast4).toBe('1234');
  });

  it('o admin do cliente NÃO recebe os últimos 4 dígitos (C2B)', async () => {
    const res = await GET();
    const body = await res.json();

    expect(body.aiGoogleKey).toBe('');
    expect(body.aiGoogleKeyLast4).toBeUndefined();
    // Ele ainda sabe que a IA está ligada e configurada, sem enxergar a credencial.
    expect(body.aiHasGoogleKey).toBe(true);
    expect(body.aiEnabled).toBe(true);
  });
});

describe('POST /api/settings/ai — quem configura o motor (C2B)', () => {
  it('recusa o admin do cliente trocando o provedor', async () => {
    const res = await POST(pedido({ aiProvider: 'anthropic' }));
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('recusa o admin do cliente trocando o modelo', async () => {
    const res = await POST(pedido({ aiModel: 'claude-sonnet-5' }));
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('recusa o admin do cliente gravando chave de API', async () => {
    const res = await POST(pedido({ aiAnthropicKey: 'sk-ant-qualquer-coisa' }));
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('DEIXA o admin do cliente pausar a IA', async () => {
    const res = await POST(pedido({ aiEnabled: false }));
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      organization_id: 'org-A',
      ai_enabled: false,
    });
    // A pausa não pode carregar configuração junto.
    expect(upsertMock.mock.calls[0][0]).not.toHaveProperty('ai_provider');
    expect(upsertMock.mock.calls[0][0]).not.toHaveProperty('ai_anthropic_key');
  });

  it('deixa a agência configurar o motor', async () => {
    authMock.mockResolvedValue(comoAgencia);
    const res = await POST(pedido({ aiProvider: 'anthropic', aiModel: 'claude-sonnet-5' }));
    expect(res.status).toBe(200);
    expect(upsertMock.mock.calls[0][0]).toMatchObject({
      ai_provider: 'anthropic',
      ai_model: 'claude-sonnet-5',
    });
  });
});
