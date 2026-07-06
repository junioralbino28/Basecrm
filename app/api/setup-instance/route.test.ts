import { describe, expect, it, vi, afterEach } from 'vitest';

// Regressão do achado X: em produção, o wizard de setup (cria org + primeiro admin
// via service_role) NÃO pode provisionar sem opt-in explícito. Antes, bastava a
// requisição ser same-origin e a instância ainda não estar inicializada.

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));
// createStaticAdminClient nem deveria ser chamado quando o guard barra; mock só
// para o import do módulo não falhar.
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => {
    throw new Error('não deveria chegar no supabase quando o guard barra');
  },
}));

import { POST } from './route';

function makeReq() {
  return new Request('http://localhost:3000/api/setup-instance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ companyName: 'Clínica X', email: 'admin@x.com', password: 'senha123' }),
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/setup-instance — fail-closed em produção (achado X)', () => {
  it('403 em produção quando o instalador não está habilitado', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INSTALLER_ENABLED', '');
    vi.stubEnv('INSTALLER_TOKEN', '');
    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Installer disabled');
  });
});
