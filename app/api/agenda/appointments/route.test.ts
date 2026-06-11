import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const listAppointmentsMock = vi.fn();
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
  listAppointments: (...a: unknown[]) => listAppointmentsMock(...a),
}));

import { GET } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 'SECRET_TOKEN_abc', subscriberId: 's', codeLink: '4567', businessId: 111 };
const TENANT = '11111111-1111-4111-8111-111111111111';

function makeReq(url: string) {
  return new Request(url, { method: 'GET', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  listAppointmentsMock.mockResolvedValue([
    { id: 987, PatientName: 'Lucas', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: 222, StatusDescription: '1-Confirmado' },
  ]);
});

describe('GET /api/agenda/appointments', () => {
  it('exige from e to', async () => {
    const res = await GET(makeReq(`http://localhost:3000/api/agenda/appointments?tenantId=${TENANT}`));
    expect(res.status).toBe(400);
  });

  it('lista do Clinicorp e espelha no cache local (upsert dedupe)', async () => {
    const res = await GET(makeReq(`http://localhost:3000/api/agenda/appointments?tenantId=${TENANT}&from=2026-06-01&to=2026-06-30`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0].externalId).toBe('987');
    expect(listAppointmentsMock).toHaveBeenCalledWith(creds, '2026-06-01', '2026-06-30');
    expect(upsertMock).toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(creds.apiToken);
  });
});
