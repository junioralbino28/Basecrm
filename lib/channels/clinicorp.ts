/**
 * Adapter do boundary Clinicorp — funções fetch() puras tipadas (sem SDK).
 * Espelha o padrão de lib/channels/evolution.ts: parse central, sem throw silencioso.
 * SEGURANÇA: chamadas SERVER-SIDE apenas. apiToken é secret (HTTP Basic password) —
 * nunca chamar do browser, nunca logar a resposta crua (PII de paciente em /appointment/list).
 */
import type {
  ClinicorpCredentials,
  ClinicorpAvailableTime,
  ClinicorpAvailableDay,
  ClinicorpAppointment,
  ClinicorpCreateAppointmentPayload,
  ClinicorpCreatedAppointment,
  ClinicorpProfessional,
} from './clinicorpTypes';

async function parseClinicorpResponse(response: Response): Promise<unknown> {
  const rawText = await response.text();
  let payload: unknown = rawText;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload || `Clinicorp respondeu HTTP ${response.status}`
        : `Clinicorp respondeu HTTP ${response.status}`
    );
  }

  return payload;
}

function basicAuthHeader(creds: ClinicorpCredentials): string {
  const token = Buffer.from(`${creds.apiUser}:${creds.apiToken}`).toString('base64');
  return `Basic ${token}`;
}

function buildUrl(creds: ClinicorpCredentials, path: string, query: Record<string, string>): string {
  const baseUrl = creds.apiUrl.replace(/\/+$/, '');
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function clinicorpGet(creds: ClinicorpCredentials, path: string, query: Record<string, string>): Promise<unknown> {
  const response = await fetch(buildUrl(creds, path, query), {
    method: 'GET',
    headers: {
      authorization: basicAuthHeader(creds),
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  return parseClinicorpResponse(response);
}

async function clinicorpPost(creds: ClinicorpCredentials, path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(buildUrl(creds, path, {}), {
    method: 'POST',
    headers: {
      authorization: basicAuthHeader(creds),
      accept: 'application/json',
      'content-type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  return parseClinicorpResponse(response);
}

function asArray<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/** GET /appointment/get_avaliable_times_calendar (subscriber_id, date, code_link). */
export async function listAvailableTimes(
  creds: ClinicorpCredentials,
  date: string
): Promise<ClinicorpAvailableTime[]> {
  const payload = await clinicorpGet(creds, '/appointment/get_avaliable_times_calendar', {
    subscriber_id: creds.subscriberId,
    date,
    code_link: creds.codeLink,
  });
  return asArray<ClinicorpAvailableTime>(payload);
}

/** GET /appointment/get_avaliable_days (subscriber_id, code_link, from, to, showAvailableTimes). */
export async function listAvailableDays(
  creds: ClinicorpCredentials,
  from: string,
  to: string
): Promise<ClinicorpAvailableDay[]> {
  const payload = await clinicorpGet(creds, '/appointment/get_avaliable_days', {
    subscriber_id: creds.subscriberId,
    code_link: creds.codeLink,
    from,
    to,
    showAvailableTimes: 'X',
  });
  return asArray<ClinicorpAvailableDay>(payload);
}

/** GET /appointment/list (subscriber_id, from, to, businessId). ⚠️ resposta tem PII — server-side only. */
export async function listAppointments(
  creds: ClinicorpCredentials,
  from: string,
  to: string
): Promise<ClinicorpAppointment[]> {
  const payload = await clinicorpGet(creds, '/appointment/list', {
    subscriber_id: creds.subscriberId,
    from,
    to,
    businessId: String(creds.businessId),
  });
  return asArray<ClinicorpAppointment>(payload);
}

/** POST /appointment/create_appointment_by_api. Retorna o primeiro item do array `[{ Status, id }]`. */
export async function createAppointment(
  creds: ClinicorpCredentials,
  payload: ClinicorpCreateAppointmentPayload
): Promise<ClinicorpCreatedAppointment> {
  const raw = await clinicorpPost(creds, '/appointment/create_appointment_by_api', payload as Record<string, unknown>);
  const list = asArray<ClinicorpCreatedAppointment>(raw);
  const created = list[0];
  if (!created) {
    throw new Error('Clinicorp nao retornou o agendamento criado.');
  }
  return created;
}

/** POST /appointment/confirm_appointment (subscriber_id, id). */
export async function confirmAppointment(creds: ClinicorpCredentials, id: number): Promise<unknown> {
  return clinicorpPost(creds, '/appointment/confirm_appointment', {
    subscriber_id: creds.subscriberId,
    id,
  });
}

/** POST /appointment/cancel_appointment (subscriber_id, id). */
export async function cancelAppointment(creds: ClinicorpCredentials, id: number): Promise<unknown> {
  return clinicorpPost(creds, '/appointment/cancel_appointment', {
    subscriber_id: creds.subscriberId,
    id,
  });
}

/** GET /professional/list_all_professionals (id = Dentist_PersonId). */
export async function listProfessionals(creds: ClinicorpCredentials): Promise<ClinicorpProfessional[]> {
  const payload = await clinicorpGet(creds, '/professional/list_all_professionals', {
    subscriber_id: creds.subscriberId,
  });
  return asArray<ClinicorpProfessional>(payload);
}
