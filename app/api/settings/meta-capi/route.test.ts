import { describe, it, expect, vi, beforeEach } from 'vitest';

// Defeito medido em producao (23/09/2026): NINGUEM conseguia salvar o token do CAPI por esta
// tela — as 4 organizacoes estavam com `hasToken: false` desde sempre. A causa nao era
// permissao de aplicacao: `authenticated` NAO tem SELECT em `meta_capi_access_token` (de
// proposito, para o token nunca voltar ao navegador), e um `upsert` referencia
// `excluded.<coluna>`, o que o Postgres so permite com leitura da coluna. O banco respondia
// "permission denied for table organization_settings" — erro de GRANT, que parece erro de RLS.
//
// Correcao: o lote normal continua indo pelo cliente do USUARIO (e ele que faz a RLS
// `can_configure` decidir, e e a PROVA de que a pessoa pode configurar a organizacao); so a
// coluna ilegivel vai depois, por `update` no cliente administrativo.

const authMock = vi.fn();
const upsertMock = vi.fn();
const upsertErro = vi.fn(() => ({ error: null as { message: string } | null }));
const adminUpdateMock = vi.fn();
const adminEqMock = vi.fn();
const adminUpdateErro = vi.fn(() => ({ error: null as { message: string } | null }));

vi.mock('@/lib/platform/adminTenantContext', () => ({
  requireAdminTenantContext: (...a: unknown[]) => authMock(...a),
}));

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: () => ({
        upsert: (...a: unknown[]) => {
          upsertMock(...a);
          return Promise.resolve(upsertErro());
        },
      }),
    }),
  createStaticAdminClient: () => ({
    from: () => {
      // `update(...).eq(...)` resolve na propria cadeia; `select(...).eq(...).maybeSingle()`
      // so resolve no maybeSingle. Por isso a cadeia e "thenable": ela e o resultado do update.
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          adminEqMock(coluna, valor);
          return cadeia;
        },
        maybeSingle: () => Promise.resolve({ data: { meta_capi_event_map: {} }, error: null }),
        update: (valores: unknown) => {
          adminUpdateMock(valores);
          return cadeia;
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(adminUpdateErro()).then(resolve),
      };
      return cadeia;
    },
  }),
}));

import { POST } from './route';

const ADMIN = { targetOrganizationId: 'org-A', isAgencyAdmin: true, isClinicAdmin: false };

function pedido(body: Record<string, unknown>) {
  return new Request('https://crm.exemplo/api/settings/meta-capi', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(ADMIN);
  upsertErro.mockReturnValue({ error: null });
  adminUpdateErro.mockReturnValue({ error: null });
});

describe('POST /api/settings/meta-capi — gravar o token do CAPI', () => {
  it('o TOKEN nao entra no upsert do usuario (era isso que o banco recusava)', async () => {
    const res = await POST(pedido({ accessToken: 'EAA-token-de-teste' }));

    expect(res.status).toBe(200);
    const enviado = upsertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('meta_capi_access_token');
    expect(enviado.organization_id).toBe('org-A');
  });

  it('o token vai por `update` administrativo, PRESO a organizacao do contexto', async () => {
    await POST(pedido({ accessToken: 'EAA-token-de-teste' }));

    expect(adminUpdateMock).toHaveBeenCalledTimes(1);
    expect(adminUpdateMock.mock.calls[0][0]).toMatchObject({
      meta_capi_access_token: 'EAA-token-de-teste',
    });
    // Sem este filtro, a chave de servico escreveria o token em TODAS as organizacoes.
    expect(adminEqMock).toHaveBeenCalledWith('organization_id', 'org-A');
  });

  it('se o `update` administrativo falhar, a resposta e erro — nao "ok" mentiroso', async () => {
    adminUpdateErro.mockReturnValue({ error: { message: 'coluna inexistente' } });

    const res = await POST(pedido({ accessToken: 'EAA-token-de-teste' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'coluna inexistente' });
  });

  it('sem token no corpo, NAO escreve pelo caminho administrativo', async () => {
    await POST(pedido({ datasetId: '771586931744397' }));

    expect(adminUpdateMock).not.toHaveBeenCalled();
    expect(upsertMock.mock.calls[0][0]).toMatchObject({ meta_capi_dataset_id: '771586931744397' });
  });

  it('se a RLS recusar a escrita do usuario, o token NAO e gravado (a recusa vale)', async () => {
    upsertErro.mockReturnValue({ error: { message: 'new row violates row-level security policy' } });

    const res = await POST(pedido({ accessToken: 'EAA-token-de-teste' }));

    expect(res.status).toBe(500);
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });

  it('sem permissao de admin, nada e escrito', async () => {
    authMock.mockResolvedValue({ error: new Response('nao', { status: 403 }) });

    const res = await POST(pedido({ accessToken: 'EAA-token-de-teste' }));

    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(adminUpdateMock).not.toHaveBeenCalled();
  });

  it('apagar o token (string vazia) tambem passa pelo caminho administrativo, como null', async () => {
    await POST(pedido({ accessToken: '   ' }));

    expect(adminUpdateMock.mock.calls[0][0]).toMatchObject({ meta_capi_access_token: null });
  });
});
