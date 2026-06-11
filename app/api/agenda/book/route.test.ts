import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const createAppointmentMock = vi.fn();

vi.mock('@/lib/platform/tenantAccess', () => ({
  requireTenantAccess: (...a: unknown[]) => requireTenantAccessMock(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createStaticAdminClient: () => ({ tag: 'admin' }),
}));
vi.mock('@/lib/channels/clinicorpCredentials', () => ({
  resolveClinicorpCredentials: (...a: unknown[]) => resolveCredsMock(...a),
}));
vi.mock('@/lib/channels/clinicorp', () => ({
  createAppointment: (...a: unknown[]) => createAppointmentMock(...a),
}));

import { POST } from './route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 'SECRET_TOKEN_abc', subscriberId: 's', codeLink: '4567', businessId: 111 };
const TENANT = '11111111-1111-4111-8111-111111111111';

function makeReq(body: unknown) {
  return new Request('http://localhost:3000/api/agenda/book', {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  createAppointmentMock.mockResolvedValue({ Status: 'CREATED', id: 987 });
});

describe('POST /api/agenda/book', () => {
  it('rejeita payload sem campos obrigatórios', async () => {
    const res = await POST(makeReq({ tenantId: TENANT }));
    expect(res.status).toBe(400);
  });

  it('cria o agendamento ao vivo no Clinicorp com o payload do slot/dentista/paciente', async () => {
    const res = await POST(
      makeReq({
        tenantId: TENANT,
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        dentistPersonId: 222,
        patientPersonId: 333,
        procedimento: 'Facetas em resina',
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toEqual({ Status: 'CREATED', id: 987 });
    expect(createAppointmentMock).toHaveBeenCalledWith(
      creds,
      expect.objectContaining({
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        Clinic_BusinessId: 111,
        Dentist_PersonId: 222,
        Patient_PersonId: 333,
        Procedures: 'Facetas em resina',
      })
    );
    expect(JSON.stringify(body)).not.toContain(creds.apiToken);
  });
});
