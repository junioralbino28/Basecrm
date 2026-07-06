import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regressão do achado High 4: a API pública gravava deal com board_id/stage_id/contact_id
// de OUTRO tenant (só sanitizeUUID + insert via service-role que bypassa RLS).
// Após o fix, um FK que não pertence à org da API key retorna 422 antes do insert.

const authMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({ authPublicApi: (...a: unknown[]) => authMock(...a) }));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    // Toda checagem de pertencimento resolve para "não existe nesta org" → data:null.
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
  }),
}));

import { POST } from './route';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

function makeReq(body: unknown) {
  return new Request('http://localhost:3000/api/public/v1/deals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'k' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, organizationId: 'org-A' });
});

describe('POST /api/public/v1/deals — isolamento cross-tenant (H4)', () => {
  it('rejeita (422) quando board_id não pertence à org da API key', async () => {
    const res = await POST(makeReq({ title: 'Deal X', board_id: UUID_B, stage_id: UUID_A, contact_id: UUID_C }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.error).toContain('board_id');
  });
});
