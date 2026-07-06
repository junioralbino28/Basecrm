import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regressão do achado C1: o GET /api/settings/ai devolvia a chave LLM CRUA pro browser
// (lida via service-role, sem redação). Após o fix, o admin recebe só o selo
// "configurada" + os últimos 4 dígitos — a chave crua nunca sai do servidor.

const authMock = vi.fn();

vi.mock('@/lib/platform/adminTenantContext', () => ({
  requireAdminTenantContext: (...a: unknown[]) => authMock(...a),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
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

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    targetOrganizationId: 'org-A',
    isAgencyAdmin: false,
    isClinicAdmin: true,
  });
});

describe('GET /api/settings/ai — redação da chave (C1)', () => {
  it('admin NÃO recebe a chave crua, só last4 + selo configurada', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    // A chave crua NUNCA vai pro browser.
    expect(body.aiGoogleKey).toBe('');
    expect(JSON.stringify(body)).not.toContain('super-secreta');

    // Mas o admin sabe que está configurada e reconhece pelos últimos 4.
    expect(body.aiHasGoogleKey).toBe(true);
    expect(body.aiGoogleKeyLast4).toBe('1234');
  });
});
