/**
 * Adapter do boundary Clinicorp — funções fetch() puras tipadas (sem SDK).
 * Espelha o padrão de lib/channels/evolution.ts: parse central, sem throw silencioso.
 * SEGURANÇA: chamadas SERVER-SIDE apenas. apiToken é secret (HTTP Basic password) —
 * nunca chamar do browser, nunca logar a resposta crua (PII de paciente em /appointment/list).
 */
import type {
  ClinicorpCredentials,
  ClinicorpAvailableTime,
  ClinicorpListAvailableTimesDay,
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

/** Converte "YYYY-MM-DD" → "YYYYMMDD" (formato que o endpoint de horários exige). */
function toCompactDate(date: string): string {
  return date.replace(/-/g, '');
}

/**
 * GET /business/list_available_times (professionalId, clinicId, fromDate, toDate).
 * Horários livres REAIS por dentista — caminho SEM code_link (a clínica piloto não usa
 * agendamento online). Achata a resposta crua (um item por dia) em slots prontos pra UI.
 * @param professionalId external_id do dentista no Clinicorp (professionals.external_id).
 * @param date dia alvo no formato "YYYY-MM-DD".
 */
export async function listAvailableTimes(
  creds: ClinicorpCredentials,
  professionalId: number,
  date: string
): Promise<ClinicorpAvailableTime[]> {
  const compactDate = toCompactDate(date);
  const payload = await clinicorpGet(creds, '/business/list_available_times', {
    professionalId: String(professionalId),
    clinicId: String(creds.businessId),
    fromDate: compactDate,
    toDate: compactDate,
  });

  const days = asArray<ClinicorpListAvailableTimesDay>(payload);
  const slots: ClinicorpAvailableTime[] = [];
  for (const day of days) {
    const isoDate = formatCompactDate(day.date);
    for (const slot of day.slots || []) {
      slots.push({
        From: slot.fromTime,
        To: slot.toTime,
        Date: isoDate,
        ProfessionalId: professionalId,
      });
    }
  }
  return slots;
}

/** Converte o inteiro YYYYMMDD da resposta em "YYYY-MM-DD". */
function formatCompactDate(value: number): string {
  const text = String(value);
  if (text.length !== 8) return text;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
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
