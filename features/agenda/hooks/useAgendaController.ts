'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTenant } from '@/context/TenantContext';
import type { Appointment } from '@/types';
import type { ClinicorpAvailableTime } from '@/lib/channels/clinicorpTypes';
import { mapClinicorpAppointment } from '@/lib/channels/clinicorpMappers';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useAgendaController() {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;

  const [date, setDate] = useState<string>(todayIso());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [availableSlots, setAvailableSlots] = useState<ClinicorpAvailableTime[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookSlot, setBookSlot] = useState<ClinicorpAvailableTime | null>(null);

  const fetchDay = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const timesRes = await fetch(
        `/api/agenda/available-times?tenantId=${organizationId}&date=${date}`,
        { cache: 'no-store' }
      );
      const apptRes = await fetch(
        `/api/agenda/appointments?tenantId=${organizationId}&from=${date}&to=${date}`,
        { cache: 'no-store' }
      );

      if (!timesRes.ok) {
        const body = await timesRes.json().catch(() => ({}));
        throw new Error(body.error || 'Falha ao buscar horários livres.');
      }
      if (!apptRes.ok) {
        const body = await apptRes.json().catch(() => ({}));
        throw new Error(body.error || 'Falha ao buscar agendamentos.');
      }

      const timesBody = await timesRes.json();
      const apptBody = await apptRes.json();
      setAvailableSlots((timesBody.slots || []) as ClinicorpAvailableTime[]);
      setAppointments((apptBody.appointments || []) as Appointment[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a agenda.');
      setAvailableSlots([]);
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, date]);

  useEffect(() => {
    void fetchDay();
  }, [fetchDay]);

  const goToDate = useCallback((next: string) => setDate(next), []);
  const openBookModal = useCallback((slot: ClinicorpAvailableTime) => setBookSlot(slot), []);
  const closeBookModal = useCallback(() => setBookSlot(null), []);

  const book = useCallback(
    async (payload: {
      dentistPersonId: number;
      patientPersonId?: number;
      patientName?: string;
      patientMobilePhone?: string;
      patientEmail?: string;
      procedimento: string;
    }) => {
      if (!organizationId || !bookSlot) return { ok: false as const, error: 'Slot não selecionado.' };
      const res = await fetch('/api/agenda/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: organizationId,
          date,
          fromTime: bookSlot.From,
          toTime: bookSlot.To,
          ...payload,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false as const, error: body.error || 'Falha ao agendar.' };
      closeBookModal();
      await fetchDay();
      return { ok: true as const };
    },
    [organizationId, bookSlot, date, closeBookModal, fetchDay]
  );

  return {
    date,
    goToDate,
    appointments,
    availableSlots,
    loading,
    error,
    bookSlot,
    openBookModal,
    closeBookModal,
    book,
    refresh: fetchDay,
    mapClinicorpAppointment,
  };
}
