'use client';

/**
 * Agenda NOSSA — fatia 1 (Junior, 28/07/2026). Controller da visão de DIA no
 * padrão que a recepção já conhece do Clinicorp: colunas por dentista, grade de
 * meia em meia hora. Nesta fatia NADA toca o Clinicorp.
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/context/TenantContext';
import { useToast } from '@/context/ToastContext';
import { appointmentsLocalService, type AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import type { AppointmentStatus } from '@/types';

/** Grade do dia: 08:00 às 19:00, de meia em meia hora (padrão de clínica). */
export const HORA_INICIO = 8;
export const HORA_FIM = 19;
export const MINUTOS_POR_VAGA = 30;

export function vagasDoDia(): string[] {
  const vagas: string[] = [];
  for (let h = HORA_INICIO; h < HORA_FIM; h += 1) {
    for (let m = 0; m < 60; m += MINUTOS_POR_VAGA) {
      vagas.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return vagas;
}

function hojeIso(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" + "HH:mm" LOCAIS → ISO UTC (o banco guarda timestamptz). */
export function paraIsoLocal(dataIso: string, hora: string): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const [h, m] = hora.split(':').map(Number);
  return new Date(ano, mes - 1, dia, h, m, 0, 0).toISOString();
}

/** ISO UTC → "HH:mm" local (pra encaixar a marcação na linha certa da grade). */
export function horaLocalDe(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type NovaConsulta = {
  contactId: string;
  professionalId: string;
  hora: string;
  duracaoMin: number;
  notes?: string;
};

export function useAgendaLocalController() {
  const { tenant } = useTenant();
  const organizationId = tenant?.organizationId || null;
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [date, setDate] = useState<string>(hojeIso());

  const chave = useMemo(() => ['agenda-dia', organizationId, date] as const, [organizationId, date]);

  const consulta = useQuery({
    queryKey: chave,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const deIso = paraIsoLocal(date, '00:00');
      const [ano, mes, dia] = date.split('-').map(Number);
      const ateIso = new Date(ano, mes - 1, dia + 1, 0, 0, 0, 0).toISOString();
      const { data, error } = await appointmentsLocalService.listar(organizationId as string, deIso, ateIso);
      if (error) throw error;
      return data;
    },
  });

  const recarregar = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['agenda-dia'] }),
    [queryClient],
  );

  const criarMutation = useMutation({
    mutationFn: async (nova: NovaConsulta) => {
      if (!organizationId) throw new Error('Clínica não carregada ainda.');
      const startsAtIso = paraIsoLocal(date, nova.hora);
      const fim = new Date(new Date(startsAtIso).getTime() + nova.duracaoMin * 60_000).toISOString();
      const { error } = await appointmentsLocalService.criar({
        organizationId,
        contactId: nova.contactId,
        professionalId: nova.professionalId,
        startsAtIso,
        endsAtIso: fim,
        notes: nova.notes,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta marcada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra marcar: ${e.message}`, 'error'),
  });

  const remarcarMutation = useMutation({
    mutationFn: async (params: { id: string; dataIso: string; hora: string; duracaoMin: number; professionalId?: string }) => {
      const startsAtIso = paraIsoLocal(params.dataIso, params.hora);
      const fim = new Date(new Date(startsAtIso).getTime() + params.duracaoMin * 60_000).toISOString();
      const { error } = await appointmentsLocalService.remarcar(params.id, {
        startsAtIso,
        endsAtIso: fim,
        professionalId: params.professionalId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta remarcada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra remarcar: ${e.message}`, 'error'),
  });

  const statusMutation = useMutation({
    mutationFn: async (params: { id: string; status: AppointmentStatus }) => {
      const { error } = await appointmentsLocalService.mudarStatus(params.id, params.status);
      if (error) throw error;
    },
    onSuccess: async () => {
      showToast('Consulta atualizada', 'success');
      await recarregar();
    },
    onError: (e: Error) => showToast(`Não deu pra atualizar: ${e.message}`, 'error'),
  });

  const irParaDia = useCallback((quantos: number) => {
    setDate((atual) => {
      const [ano, mes, dia] = atual.split('-').map(Number);
      const d = new Date(ano, mes - 1, dia + quantos);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
  }, []);

  return {
    date,
    setDate,
    irParaDia,
    voltarPraHoje: useCallback(() => setDate(hojeIso()), []),
    appointments: (consulta.data ?? []) as AppointmentDoDia[],
    isLoading: consulta.isLoading,
    error: consulta.error as Error | null,
    criar: criarMutation.mutateAsync,
    criando: criarMutation.isPending,
    remarcar: remarcarMutation.mutateAsync,
    remarcando: remarcarMutation.isPending,
    mudarStatus: statusMutation.mutateAsync,
    mudandoStatus: statusMutation.isPending,
  };
}
