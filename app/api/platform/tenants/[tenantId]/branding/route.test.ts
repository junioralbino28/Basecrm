import { beforeEach, describe, expect, it, vi } from 'vitest';

// Marca do cliente (tema visual por organização): só a agência configura, e o campo
// brandTheme aceita apenas os temas que existem no CSS.

let papel = 'agency_admin';
const updateMock = vi.fn();

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          single: () => Promise.resolve({ data: { id: 'u1', role: papel, organization_id: 'org-agencia' }, error: null }),
        };
        return chain;
      },
    }),
  createStaticAdminClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: { branding_config: { displayName: 'Clínica X' } }, error: null }),
        update: (valor: unknown) => {
          updateMock(valor);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
      return chain;
    },
  }),
}));

import { PATCH } from './route';

function pedido(body: Record<string, unknown>) {
  return new Request('https://crm.exemplo/api/platform/tenants/org-cliente/branding', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ tenantId: 'org-cliente' }) };

beforeEach(() => {
  vi.clearAllMocks();
  papel = 'agency_admin';
});

describe('PATCH /api/platform/tenants/[tenantId]/branding', () => {
  it('agency_admin grava o tema visual do cliente, preservando o resto da marca', async () => {
    const res = await PATCH(pedido({ brandTheme: 'clinica' }), ctx);
    expect(res.status).toBe(200);
    const gravado = updateMock.mock.calls[0][0] as { branding_config: Record<string, unknown> };
    expect(gravado.branding_config).toMatchObject({ displayName: 'Clínica X', brandTheme: 'clinica' });
  });

  it('o papel legado admin continua podendo', async () => {
    papel = 'admin';
    const res = await PATCH(pedido({ brandTheme: 'cenno' }), ctx);
    expect(res.status).toBe(200);
  });

  it('admin do cliente não configura a marca (403) e nada é gravado', async () => {
    papel = 'clinic_admin';
    const res = await PATCH(pedido({ brandTheme: 'cenno' }), ctx);
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('tema que não existe é recusado (400)', async () => {
    const res = await PATCH(pedido({ brandTheme: 'roxo' }), ctx);
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
