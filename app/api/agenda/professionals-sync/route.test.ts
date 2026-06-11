import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listProfessionalsMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsertMock(...a); return Promise.resolve({ error: null }); } }),
  }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  listProfessionals: (...a: unknown[]) => listProfessionalsMock(...a),
}));

import { POST } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 'SECRET_TOKEN_abc', subscriberId: 's', codeLink: '4567', businessId: 111 };
const TENANT = '11111111-1111-4111-8111-111111111111';

function makeReq(body: unknown) {
  return new Request('http://localhost:3000/api/agenda/professionals-sync', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_admin' } });
  resolveCredsMock.mockResolvedValue(creds);
  listProfessionalsMock.mockResolvedValue([
    { id: 222, name: 'Dra. Jessica', cpf: '000' },
    { id: 333, name: 'Dr. Adel', cpf: '111' },
  ]);
});

describe('POST /api/agenda/professionals-sync', () => {
  it('exige tenantId', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('lista os dentistas e devolve o mapa id→name (Dentist_PersonId)', async () => {
    const res = await POST(makeReq({ tenantId: TENANT }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.professionals).toHaveLength(2);
    expect(body.professionals[0]).toMatchObject({ externalId: '222', name: 'Dra. Jessica' });
    expect(listProfessionalsMock).toHaveBeenCalledWith(creds);
    expect(upsertMock).toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(creds.apiToken);
  });

  it('barra clinic_staff (só admin sincroniza)', async () => {
    requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
    const res = await POST(makeReq({ tenantId: TENANT }));
    expect(res.status).toBe(403);
  });
});
