'use client';

import React from 'react';
import type { Appointment } from '@/types';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';

export interface AgendaDayViewProps {
  date: string;
  appointments: Appointment[];
  availableSlots: ClinicorpAvailableTime[];
  loading: boolean;
  error: string | null;
  onBookSlot: (slot: ClinicorpAvailableTime) => void;
}

function formatTime(iso: string): string {
  const time = iso.includes('T') ? iso.split('T')[1] : iso;
  return time.slice(0, 5);
}

export function AgendaDayView({ date, appointments, availableSlots, loading, error, onBookSlot }: AgendaDayViewProps) {
  if (loading) {
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        Carregando a agenda do dia…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-6 text-sm text-red-600">
        {error}
      </div>
    );
  }

  const isEmpty = appointments.length === 0 && availableSlots.length === 0;
  if (isEmpty) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Nenhum horário disponível e sem agendamentos para {date}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
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
          <p className="text-sm text-muted-foreground">Nenhum horário livre para este dia.</p>
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
