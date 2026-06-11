import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  listAvailableTimes,
  listAppointments,
  createAppointment,
  confirmAppointment,
  cancelAppointment,
  listProfessionals,
} from './clinicorp';

const creds = {
  apiUrl: 'https://api.clinicorp.com/rest/v1',
  apiUser: 'apiuser',
  apiToken: 'secret-token',
  subscriberId: 'sub-123',
  codeLink: '4567',
  businessId: 111,
};

function mockFetchOnce(payload: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clinicorp adapter', () => {
  it('listAvailableTimes monta URL com subscriber_id+date+code_link e auth Basic', async () => {
    const fetchMock = mockFetchOnce([{ From: '9:00', To: '10:00', DayWeek: 1, BusinessId: 111, ProfessionalId: 222 }]);
    vi.stubGlobal('fetch', fetchMock);

    const res = await listAvailableTimes(creds, '2026-06-12');

    expect(res).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/get_avaliable_times_calendar');
    expect(String(url)).toContain('subscriber_id=sub-123');
    expect(String(url)).toContain('date=2026-06-12');
    expect(String(url)).toContain('code_link=4567');
    const expectedAuth = `Basic ${Buffer.from('apiuser:secret-token').toString('base64')}`;
    expect((init as RequestInit).headers).toMatchObject({ authorization: expectedAuth });
    expect((init as RequestInit).method).toBe('GET');
  });

  it('listAppointments envia from/to/businessId', async () => {
    const fetchMock = mockFetchOnce([{ id: 1, PatientName: 'X', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: 222 }]);
    vi.stubGlobal('fetch', fetchMock);

    await listAppointments(creds, '2026-06-01', '2026-06-30');

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/list');
    expect(String(url)).toContain('from=2026-06-01');
    expect(String(url)).toContain('to=2026-06-30');
    expect(String(url)).toContain('businessId=111');
  });

  it('createAppointment faz POST com body do payload e retorna o created', async () => {
    const fetchMock = mockFetchOnce([{ Status: 'CREATED', id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);

    const created = await createAppointment(creds, {
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      Patient_PersonId: 333,
      Procedures: 'Facetas',
    });

    expect(created).toEqual({ Status: 'CREATED', id: 987 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/create_appointment_by_api');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ Patient_PersonId: 333, Procedures: 'Facetas' });
  });

  it('confirmAppointment envia subscriber_id+id no body', async () => {
    const fetchMock = mockFetchOnce([{ id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);
    await confirmAppointment(creds, 987);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/confirm_appointment');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ subscriber_id: 'sub-123', id: 987 });
  });

  it('cancelAppointment envia subscriber_id+id no body', async () => {
    const fetchMock = mockFetchOnce([{ id: 987 }]);
    vi.stubGlobal('fetch', fetchMock);
    await cancelAppointment(creds, 987);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/appointment/cancel_appointment');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ subscriber_id: 'sub-123', id: 987 });
  });

  it('listProfessionals retorna os dentistas (id=Dentist_PersonId)', async () => {
    const fetchMock = mockFetchOnce([{ id: 222, name: 'Dra. Jessica', cpf: '000' }]);
    vi.stubGlobal('fetch', fetchMock);
    const list = await listProfessionals(creds);
    expect(list[0].id).toBe(222);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/professional/list_all_professionals');
  });

  it('propaga erro HTTP do boundary', async () => {
    const fetchMock = mockFetchOnce('upstream down', false, 500);
    vi.stubGlobal('fetch', fetchMock);
    await expect(listAvailableTimes(creds, '2026-06-12')).rejects.toThrow(/Clinicorp respondeu HTTP 500|upstream down/);
  });
});
