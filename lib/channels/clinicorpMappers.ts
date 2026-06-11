/**
 * Funções puras do boundary Clinicorp:
 *  - buildCreateAppointmentPayload: monta o body exato de create_appointment_by_api.
 *  - mapClinicorpAppointment: transforma o raw do Clinicorp no Appointment local (cache).
 *
 * SEGURANÇA: o map devolve o MÍNIMO (sem payload cru de paciente). Usado server-side;
 * o resultado vai pro browser, então não inclui mais do que nome+telefone em `notes`.
 */
import type {
  ClinicorpAppointment,
  ClinicorpCreateAppointmentPayload,
} from './clinicorpTypes';
import type { Appointment, AppointmentStatus } from '@/types';

type SlotInput = { date: string; fromTime: string; toTime: string };

type PatientInput = {
  personId?: number;
  name?: string;
  mobilePhone?: string;
  email?: string;
};

/** Função pura: monta o body exato de POST /appointment/create_appointment_by_api. */
export function buildCreateAppointmentPayload(params: {
  slot: SlotInput;
  businessId: number;
  dentistPersonId: number;
  patient: PatientInput;
  procedimento: string;
}): ClinicorpCreateAppointmentPayload {
  const { slot, businessId, dentistPersonId, patient, procedimento } = params;

  const base: ClinicorpCreateAppointmentPayload = {
    date: slot.date,
    fromTime: slot.fromTime,
    toTime: slot.toTime,
    Clinic_BusinessId: businessId,
    Dentist_PersonId: dentistPersonId,
    Procedures: procedimento,
  };

  if (typeof patient.personId === 'number') {
    return { ...base, Patient_PersonId: patient.personId };
  }

  if (patient.name && patient.name.trim()) {
    return {
      ...base,
      PatientName: patient.name.trim(),
      ...(patient.mobilePhone ? { MobilePhone: patient.mobilePhone } : {}),
      ...(patient.email ? { Email: patient.email } : {}),
    };
  }

  throw new Error('Paciente sem identificacao: informe Patient_PersonId ou nome do paciente.');
}

function mapStatus(statusDescription: string | null | undefined): AppointmentStatus {
  const value = String(statusDescription || '').toLowerCase();
  if (value.includes('desmarc') || value.includes('cancel')) return 'cancelado';
  if (value.includes('falt') || value.includes('no-show')) return 'faltou';
  if (value.includes('confirm') || value.includes('atend') || value.includes('comparec')) return 'compareceu';
  if (value.includes('remarc')) return 'remarcado';
  return 'agendado';
}

/** Normaliza `9:00`/`09:00` → `09:00:00` e monta o ISO local `YYYY-MM-DDThh:mm:ss`. */
function buildIso(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const trimmed = (time || '').trim();
  if (!trimmed) return `${date}T00:00:00`;
  const [hh = '0', mm = '0'] = trimmed.split(':');
  const hours = hh.padStart(2, '0');
  const minutes = mm.padStart(2, '0');
  return `${date}T${hours}:${minutes}:00`;
}

/** Função pura: transforma o raw do Clinicorp no Appointment local (cache de resiliência). */
export function mapClinicorpAppointment(
  raw: ClinicorpAppointment,
  ctx: { organizationId: string }
): Appointment {
  const startsAt = buildIso(raw.date, raw.fromTime) || new Date().toISOString();
  const endsAt = buildIso(raw.date, raw.toTime);

  return {
    organizationId: ctx.organizationId,
    externalId: String(raw.id),
    source: 'clinicorp_api',
    status: mapStatus(raw.StatusDescription),
    startsAt,
    endsAt: endsAt || undefined,
    notes: [raw.PatientName, raw.MobilePhone].filter(Boolean).join(' · ') || undefined,
  };
}
