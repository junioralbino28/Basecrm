import { describe, expect, it, vi, beforeEach } from 'vitest';

// Regressão do achado Medium 6: a rota pública de summary (token na query) devolvia
// 'cache-control: private, max-age=300' e não setava Referrer-Policy/X-Robots-Tag —
// deixando a resposta autenticada cacheável 5min e a URL com token indexável/vazável via referer.

const authMock = vi.fn();

vi.mock('@/lib/public-api/auth', () => ({
  authReportTokenFromQuery: (...a: unknown[]) => authMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({ createStaticAdminClient: () => ({}) }));
vi.mock('@/lib/reports/summaryCsv', () => ({
  buildSummaryCsv: async () => 'faturamento_mes,total\n100,200',
}));

import { GET } from './route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/public/v1/reports/summary', () => {
  it('200: cache-control=no-store + referrer-policy=no-referrer + x-robots-tag=noindex', async () => {
    authMock.mockResolvedValue({ ok: true, organizationId: 'org1' });
    const res = await GET(new Request('https://x/api/public/v1/reports/summary?token=t'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('token inválido: também não cacheia (no-store)', async () => {
    authMock.mockResolvedValue({ ok: false, status: 401 });
    const res = await GET(new Request('https://x/api/public/v1/reports/summary?token=bad'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
