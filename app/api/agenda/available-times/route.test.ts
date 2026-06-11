import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listAvailableTimesMock = vi.fn();
const professionalMaybeSingleMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...args: unknown[]) => requireTenantAccessMock(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  // admin.from('professionals').select(...).eq(...).eq(...).maybeSingle()
  createStaticAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: (...a: unknown[]) => professionalMaybeSingleMock(...a) }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...args: unknown[]) => resolveCredsMock(...args),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  listAvailableTimes: (...args: unknown[]) => listAvailableTimesMock(...args),
}));

import { GET } from './route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROF = '22222222-2222-4222-8222-222222222222';

const creds = {
  apiUrl: 'https://api.clinicorp.com/rest/v1',
  apiUser: 'u',
  apiToken: 'SECRET_CLINICORP_TOKEN_xyz',
  subscriberId: 's',
  businessId: 111,
};

function makeReq(query: string) {
  return new Request(`http://localhost:3000/api/agenda/available-times?${query}`, {
    method: 'GET',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  professionalMaybeSingleMock.mockResolvedValue({ data: { external_id: '222' }, error: null });
  listAvailableTimesMock.mockResolvedValue([
    { From: '8:00', To: '8:30', Date: '2026-06-12', ProfessionalId: 222 },
  ]);
});

describe('GET /api/agenda/available-times', () => {
  it('exige tenantId, professionalId e date', async () => {
    const res = await GET(makeReq(`tenantId=${TENANT}&date=2026-06-12`));
    expect(res.status).toBe(400);
  });

  it('barra acesso não-autorizado ao tenant', async () => {
    requireTenantAccessMock.mockResolvedValue({ error: new Response('Forbidden', { status: 403 }) });
    const res = await GET(makeReq(`tenantId=${TENANT}&professionalId=${PROF}&date=2026-06-12`));
    expect(res.status).toBe(403);
  });

  it('retorna 409 quando a config Clinicorp do tenant está ausente', async () => {
    resolveCredsMock.mockResolvedValue(null);
    const res = await GET(makeReq(`tenantId=${TENANT}&professionalId=${PROF}&date=2026-06-12`));
    expect(res.status).toBe(409);
  });

  it('retorna 409 quando o dentista não tem external_id (não sincronizado)', async () => {
    professionalMaybeSingleMock.mockResolvedValue({ data: { external_id: null }, error: null });
    const res = await GET(makeReq(`tenantId=${TENANT}&professionalId=${PROF}&date=2026-06-12`));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/não sincronizado/i);
  });

  it('chama o adapter com o external_id resolvido e devolve os slots; token nunca aparece', async () => {
    const res = await GET(makeReq(`tenantId=${TENANT}&professionalId=${PROF}&date=2026-06-12`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slots).toHaveLength(1);
    expect(listAvailableTimesMock).toHaveBeenCalledWith(creds, 222, '2026-06-12');
    expect(JSON.stringify(body)).not.toContain('apiToken');
    expect(JSON.stringify(body)).not.toContain(creds.apiToken);
  });
});
