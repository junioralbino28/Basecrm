// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG = '11111111-1111-4111-8111-111111111111';
const CHAVE = 'task_conversations_whatsapp_auto_reply';
const ADMIN = { papel: 'admin' };

const mocks = vi.hoisted(() => ({ auth: vi.fn(), resumir: vi.fn() }));
vi.mock('@/lib/platform/adminTenantContext', () => ({ requireAdminTenantContext: mocks.auth }));
vi.mock('@/lib/agents/numerosDaChave', () => ({ resumirNumerosDaChave: mocks.resumir }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        order: () => consulta,
        limit: () => Promise.resolve({ data: [{ key: CHAVE, content: 'texto', version: 1, is_active: true }], error: null }),
      };
      return consulta;
    },
  }),
  createStaticAdminClient: () => ADMIN,
}));

import { GET } from './route';

const chamar = () => GET(new Request('http://localhost/api/settings/ai-prompts/x'), { params: Promise.resolve({ key: CHAVE }) });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/settings/ai-prompts/[key] — números com agente', () => {
  it('agência: devolve o resumo dos números da chave, contado para a organização da rota', async () => {
    const resumo = { organizationId: ORG, numerosDaChave: 2, numerosComAgente: 1, agentes: [{ id: 'a1', nome: 'Julia' }] };
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: true });
    mocks.resumir.mockResolvedValue(resumo);
    const corpo = await (await chamar()).json();
    expect(corpo.agentes).toEqual(resumo);
    expect(corpo.active).toMatchObject({ key: CHAVE, is_active: true });
    expect(mocks.resumir).toHaveBeenCalledWith(ADMIN, ORG, CHAVE);
  });

  it('admin do cliente: sem resumo (só a agência edita prompt)', async () => {
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: false });
    const corpo = await (await chamar()).json();
    expect(corpo.agentes).toBeNull();
    expect(mocks.resumir).not.toHaveBeenCalled();
  });

  it('falha ao contar: 500 sem o detalhe interno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.auth.mockResolvedValue({ targetOrganizationId: ORG, isAgencyAdmin: true });
    mocks.resumir.mockRejectedValue(new Error('channel_connections: relation x'));
    const r = await chamar();
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('relation');
  });
});
