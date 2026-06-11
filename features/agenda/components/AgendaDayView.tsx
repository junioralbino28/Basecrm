'use client';

import React from 'react';
import type { Appointment, Professional } from '@/types';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';

export interface AgendaDayViewProps {
  date: string;
  appointments: Appointment[];
  availableSlots: ClinicorpAvailableTime[];
  professionals: Professional[];
  selectedProfessionalId: string | null;
  onSelectProfessional: (professionalId: string | null) => void;
  loading: boolean;
  error: string | null;
  onBookSlot: (slot: ClinicorpAvailableTime) => void;
}

function formatTime(iso: string): string {
  const time = iso.includes('T') ? iso.split('T')[1] : iso;
  return time.slice(0, 5);
}

export function AgendaDayView({
  date,
  appointments,
  availableSlots,
  professionals,
  selectedProfessionalId,
  onSelectProfessional,
  loading,
  error,
  onBookSlot,
}: AgendaDayViewProps) {
  const dentistPicker = (
    <label className="flex items-center gap-2 px-4 pt-4 text-sm">
      Dentista
      <select
        aria-label="Dentista da agenda"
        value={selectedProfessionalId ?? ''}
        onChange={(e) => onSelectProfessional(e.target.value || null)}
        className="rounded border p-2"
      >
        <option value="">Selecione um dentista…</option>
        {professionals
          .filter((p) => p.externalId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </label>
  );

  if (loading) {
    return (
      <div>
        {dentistPicker}
        <div role="status" className="p-6 text-sm text-muted-foreground">
          Carregando a agenda do dia…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {dentistPicker}
        <div role="alert" className="p-6 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  const isEmpty = appointments.length === 0 && availableSlots.length === 0;
  if (isEmpty) {
    return (
      <div>
        {dentistPicker}
        <div className="p-6 text-sm text-muted-foreground">
          {selectedProfessionalId
            ? `Nenhum horário disponível e sem agendamentos para ${date}.`
            : `Escolha um dentista para ver os horários livres de ${date}.`}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      {dentistPicker}
      <section aria-label="Agendamentos do dia">
        <h3 className="mb-2 text-sm font-semibold">Agendamentos</h3>
        {appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem agendamentos para este dia.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {appointments.map((appt) => (
              <li key={appt.id ?? appt.externalId} className="flex items-center gap-3 rounded border p-3 text-sm">
                <span className="font-medium tabular-nums">{formatTime(appt.startsAt)}</span>
                <span className="text-muted-foreground">{appt.notes || 'Paciente'}</span>
                <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs">{appt.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Horários livres">
        <h3 className="mb-2 text-sm font-semibold">Horários livres</h3>
        {availableSlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {selectedProfessionalId
              ? 'Nenhum horário livre para este dia.'
              : 'Escolha um dentista para ver os horários livres.'}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {availableSlots.map((slot, index) => (
              <li key={`${slot.From}-${slot.ProfessionalId}-${index}`}>
                <button
                  type="button"
                  onClick={() => onBookSlot(slot)}
                  className="rounded border px-3 py-1 text-sm hover:bg-muted"
                >
                  {slot.From} — Agendar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
