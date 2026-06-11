/**
 * Tipos do boundary Clinicorp (espelham VERBATIM o OpenAPI lido ao vivo).
 * Schemas confirmados em sessão: endpoints HTTP 200, OpenAPI 4839 linhas.
 *
 * SEGURANÇA: o `apiToken` (ClinicorpCredentials.apiToken) é secret — só server-side.
 * Nunca devolver este objeto inteiro ao browser; nada de token em JSON de resposta.
 */

export const CLINICORP_API_BASE_URL = 'https://api.clinicorp.com/rest/v1';

/** Credenciais resolvidas por tenant (server-side only, token nunca vai ao client). */
export type ClinicorpCredentials = {
  apiUrl: string;
  apiUser: string;
  apiToken: string;
  subscriberId: string;
  codeLink: string;
  businessId: number;
};

/** GET /appointment/get_avaliable_times_calendar → array de slots. */
export type ClinicorpAvailableTime = {
  From: string;
  To: string;
  DayWeek: number;
  BusinessId: number;
  ProfessionalId: number;
};

/** GET /appointment/get_avaliable_days → array de dias. */
export type ClinicorpAvailableDay = {
  Date: string;
  Week: string;
  DayWeek: number;
  day: number;
  month: number;
  year: number;
};

/** GET /appointment/list → array de agendamentos. */
export type ClinicorpAppointment = {
  id: number;
  PatientName: string | null;
  date: string | null;
  fromTime: string | null;
  toTime: string | null;
  MobilePhone: string | null;
  Email: string | null;
  Dentist_PersonId: number | null;
  Clinic_BusinessId?: number | null;
  StatusDescription?: string | null;
  Notes?: string | null;
};

/** POST /appointment/create_appointment_by_api → body. */
export type ClinicorpCreateAppointmentPayload = {
  date: string;
  fromTime: string;
  toTime: string;
  Clinic_BusinessId: number;
  Dentist_PersonId?: number;
  Patient_PersonId?: number;
  PatientName?: string;
  MobilePhone?: string;
  Email?: string;
  Procedures: string;
  CategoryColor?: string;
  CategoryDescription?: string;
};

/** POST /appointment/create_appointment_by_api → array `[{ Status, id }]`. */
export type ClinicorpCreatedAppointment = {
  Status: string;
  id: number;
};

/** GET /professional/list_all_professionals → array `[{ id, name, cpf }]`. */
export type ClinicorpProfessional = {
  id: number;
  name: string;
  cpf: string | null;
};
