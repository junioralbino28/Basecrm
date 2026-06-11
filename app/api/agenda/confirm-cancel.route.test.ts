import { describe, expect, it, vi, beforeEach } from 'vitest';

const requireTenantAccessMock = vi.fn();
const resolveCredsMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();

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
  confirmAppointment: (...a: unknown[]) => confirmMock(...a),
  cancelAppointment: (...a: unknown[]) => cancelMock(...a),
}));

import { POST as confirmPOST } from './confirm/route';
import { POST as cancelPOST } from './cancel/route';

const creds = { apiUrl: 'x', apiUser: 'u', apiToken: 'SECRET_TOKEN_abc', subscriberId: 's', codeLink: '4567', businessId: 111 };
const TENANT = '11111111-1111-4111-8111-111111111111';

function makeReq(path: string, body: unknown) {
  return new Request(`http://localhost:3000/api/agenda/${path}`, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantAccessMock.mockResolvedValue({ profile: { organization_id: 'org-1', role: 'clinic_staff' } });
  resolveCredsMock.mockResolvedValue(creds);
  confirmMock.mockResolvedValue([{ id: 987 }]);
  cancelMock.mockResolvedValue([{ id: 987 }]);
});

describe('POST /api/agenda/confirm e /cancel', () => {
  it('confirm chama confirmAppointment com o id', async () => {
    const res = await confirmPOST(makeReq('confirm', { tenantId: TENANT, id: 987 }));
    expect(res.status).toBe(200);
    expect(confirmMock).toHaveBeenCalledWith(creds, 987);
  });

  it('cancel chama cancelAppointment com o id', async () => {
    const res = await cancelPOST(makeReq('cancel', { tenantId: TENANT, id: 987 }));
    expect(res.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith(creds, 987);
  });

  it('rejeita sem id', async () => {
    const res = await confirmPOST(makeReq('confirm', { tenantId: TENANT }));
    expect(res.status).toBe(400);
  });
});
