'use client';

/**
 * Grade do dia — colunas por dentista, linhas de meia em meia hora, no padrão
 * que a recepção já conhece do Clinicorp (referência pedida pelo Junior).
 * Clicar numa vaga livre marca; clicar numa consulta abre os detalhes.
 */
import React from 'react';
import type { Professional } from '@/types';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import { vagasDoDia, horaLocalDe, MINUTOS_POR_VAGA } from '../hooks/useAgendaLocalController';

export const ROTULOS_DE_STATUS: Record<string, string> = {
  agendado: 'Agendado',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
  faltou: 'Faltou',
  cancelado: 'Cancelado',
  remarcado: 'Remarcado',
};

const CORES_DE_STATUS: Record<string, string> = {
  agendado: 'border-brand-400/60 bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200',
  confirmado: 'border-emerald-400/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  compareceu: 'border-teal-400/60 bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200',
  faltou: 'border-red-400/60 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200',
  cancelado: 'border-slate-300 bg-slate-50 text-slate-500 line-through dark:bg-white/5 dark:text-slate-400',
  remarcado: 'border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
};

/** Quantas linhas da grade a consulta ocupa (mínimo 1). */
function linhasOcupadas(appt: AppointmentDoDia): number {
  if (!appt.endsAt) return 1;
  const minutos = (new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60_000;
  return Math.max(1, Math.round(minutos / MINUTOS_POR_VAGA));
}

export function AgendaGradeDia({
  appointments,
  professionals,
  onMarcar,
  onAbrirConsulta,
}: {
  appointments: AppointmentDoDia[];
  professionals: Professional[];
  onMarcar: (professionalId: string, hora: string) => void;
  onAbrirConsulta: (appt: AppointmentDoDia) => void;
}) {
  const vagas = vagasDoDia();

  // consulta por (dentista, hora de início) — canceladas não seguram a vaga
  const porCelula = new Map<string, AppointmentDoDia>();
  const ocupadasPorContinuacao = new Set<string>();
  for (const appt of appointments) {
    if (!appt.professionalId) continue;
    const hora = horaLocalDe(appt.startsAt);
    const chave = `${appt.professionalId}|${hora}`;
    if (!porCelula.has(chave) || appt.status !== 'cancelado') {
      porCelula.set(chave, appt);
    }
    if (appt.status !== 'cancelado') {
      const inicio = vagas.indexOf(hora);
      for (let i = 1; i < linhasOcupadas(appt) && inicio >= 0 && inicio + i < vagas.length; i += 1) {
        ocupadasPorContinuacao.add(`${appt.professionalId}|${vagas[inicio + i]}`);
      }
    }
  }

  if (professionals.length === 0) {
    return (
      <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Cadastre os profissionais em Configurações → Equipe para a agenda ganhar colunas.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-white/5">
            <th scope="col" className="w-16 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Hora
            </th>
            {professionals.map((pro) => (
              <th key={pro.id} scope="col" className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                {pro.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vagas.map((hora) => (
            <tr key={hora} className="border-t border-slate-100 dark:border-white/5">
              <td className="px-2 py-1 align-top text-xs font-medium tabular-nums text-slate-400">{hora}</td>
              {professionals.map((pro) => {
                const chave = `${pro.id}|${hora}`;
                const appt = porCelula.get(chave);
                if (appt) {
                  return (
                    <td key={pro.id} className="px-1 py-1 align-top">
                      <button
                        type="button"
                        onClick={() => onAbrirConsulta(appt)}
                        className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition hover:opacity-80 ${CORES_DE_STATUS[appt.status] || CORES_DE_STATUS.agendado}`}
                      >
                        <span className="block truncate font-semibold">{appt.contactName || 'Sem contato'}</span>
                        <span className="block truncate opacity-80">
                          {horaLocalDe(appt.startsAt)}
                          {appt.endsAt ? `–${horaLocalDe(appt.endsAt)}` : ''} · {ROTULOS_DE_STATUS[appt.status] || appt.status}
                          {appt.source === 'clinicorp_api' ? ' · veio do Clinicorp' : ''}
                        </span>
                      </button>
                    </td>
                  );
                }
                if (ocupadasPorContinuacao.has(chave)) {
                  return <td key={pro.id} className="px-1 py-1" aria-hidden />;
                }
                return (
                  <td key={pro.id} className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onMarcar(pro.id, hora)}
                      aria-label={`Marcar ${hora} com ${pro.name}`}
                      className="h-7 w-full rounded-lg border border-dashed border-slate-200 text-[11px] text-transparent transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 dark:border-white/10 dark:hover:bg-brand-500/10"
                    >
                      Marcar
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
