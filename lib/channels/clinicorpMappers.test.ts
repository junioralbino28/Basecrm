import { describe, expect, it } from 'vitest';
import { buildCreateAppointmentPayload, mapClinicorpAppointment } from './clinicorpMappers';

describe('buildCreateAppointmentPayload', () => {
  it('monta payload por paciente cadastrado (Patient_PersonId)', () => {
    const payload = buildCreateAppointmentPayload({
      slot: { date: '2026-06-12', fromTime: '09:00', toTime: '10:00' },
      businessId: 111,
      dentistPersonId: 222,
      patient: { personId: 333 },
      procedimento: 'Facetas em resina',
    });
    expect(payload).toEqual({
      date: '2026-06-12',
      fromTime: '09:00',
      toTime: '10:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      Patient_PersonId: 333,
      Procedures: 'Facetas em resina',
    });
  });

  it('monta payload por paciente avulso (nome+telefone+email) quando não há personId', () => {
    const payload = buildCreateAppointmentPayload({
      slot: { date: '2026-06-12', fromTime: '14:00', toTime: '15:00' },
      businessId: 111,
      dentistPersonId: 222,
      patient: { name: 'Maria Souza', mobilePhone: '(47) 98870-0805', email: 'maria@x.com' },
      procedimento: 'Avaliacao',
    });
    expect(payload).toEqual({
      date: '2026-06-12',
      fromTime: '14:00',
      toTime: '15:00',
      Clinic_BusinessId: 111,
      Dentist_PersonId: 222,
      PatientName: 'Maria Souza',
      MobilePhone: '(47) 98870-0805',
      Email: 'maria@x.com',
      Procedures: 'Avaliacao',
    });
  });

  it('lança erro quando não há nem personId nem nome', () => {
    expect(() =>
      buildCreateAppointmentPayload({
        slot: { date: '2026-06-12', fromTime: '09:00', toTime: '10:00' },
        businessId: 111,
        dentistPersonId: 222,
        patient: {},
        procedimento: 'X',
      })
    ).toThrow('Paciente sem identificacao');
  });
});

describe('mapClinicorpAppointment', () => {
  it('transforma o raw do Clinicorp em Appointment local com source clinicorp_api', () => {
    const result = mapClinicorpAppointment(
      {
        id: 987,
        PatientName: 'Lucas',
        date: '2026-06-12',
        fromTime: '09:00',
        toTime: '10:00',
        MobilePhone: '(47) 99999-9999',
        Email: 'lucas@x.com',
        Dentist_PersonId: 222,
        StatusDescription: '1-Confirmado',
      },
      { organizationId: 'org-1' }
    );
    expect(result.externalId).toBe('987');
    expect(result.source).toBe('clinicorp_api');
    expect(result.status).toBe('compareceu');
    expect(result.startsAt).toBe('2026-06-12T09:00:00');
    expect(result.endsAt).toBe('2026-06-12T10:00:00');
    expect(result.organizationId).toBe('org-1');
    expect(result.notes).toContain('Lucas');
  });

  it('mapeia status cancelado/desmarcado', () => {
    const result = mapClinicorpAppointment(
      { id: 1, PatientName: 'X', date: '2026-06-12', fromTime: '09:00', toTime: '10:00', MobilePhone: null, Email: null, Dentist_PersonId: null, StatusDescription: '3-Desmarcado' },
      { organizationId: 'org-1' }
    );
    expect(result.status).toBe('cancelado');
  });
});
