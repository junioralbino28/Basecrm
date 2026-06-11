import { describe, expect, it } from 'vitest';
import { CHANNEL_PROVIDERS } from './types';
import {
  CLINICORP_API_BASE_URL,
  type ClinicorpAvailableTime,
  type ClinicorpAppointment,
  type ClinicorpCreatedAppointment,
  type ClinicorpProfessional,
} from './clinicorpTypes';

describe('clinicorp channel types', () => {
  it('registra o provider clinicorp na union de canais', () => {
    expect(CHANNEL_PROVIDERS).toContain('clinicorp');
  });

  it('expõe a base REST oficial do Clinicorp', () => {
    expect(CLINICORP_API_BASE_URL).toBe('https://api.clinicorp.com/rest/v1');
  });

  it('tipa as respostas-chave da API (smoke de shape)', () => {
    const time: ClinicorpAvailableTime = {
      From: '9:00',
      To: '10:00',
      Date: '2026-06-12',
      ProfessionalId: 456,
    };
    const appt: ClinicorpAppointment = {
      id: 987,
      PatientName: 'Joao',
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      MobilePhone: '(47) 99999-9999',
      Email: 'a@b.com',
      Dentist_PersonId: 456,
      StatusDescription: '1-Confirmado',
    };
    const created: ClinicorpCreatedAppointment = { Status: 'CREATED', id: 987 };
    const prof: ClinicorpProfessional = { id: 456, name: 'Dra. Jessica', cpf: '00000000000' };
    expect(time.ProfessionalId).toBe(456);
    expect(appt.id).toBe(987);
    expect(created.Status).toBe('CREATED');
    expect(prof.id).toBe(456);
  });
});
