'use client';

/**
 * Grade da SEMANA de UM profissional (pedido do Junior, 29/07/2026): colunas por
 * dia (segunda a domingo), linhas de meia em meia hora. Mesma leitura da grade
 * do dia — só troca "quem" por "quando". Nada toca o Clinicorp.
 */
import React from 'react';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import {
  vagasDoDia,
  horaLocalDe,
  diasDaSemana,
  MINUTOS_POR_VAGA,
} from '../hooks/useAgendaLocalController';
import { CORES_DE_STATUS, ROTULOS_DE_STATUS, diaLocalDe, rotuloCurtoDoDia } from './agendaFormato';

function linhasOcupadas(appt: AppointmentDoDia): number {
  if (!appt.endsAt) return 1;
  const minutos = (new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60_000;
  return Math.max(1, Math.round(minutos / MINUTOS_POR_VAGA));
}

export function AgendaGradeSemana({
  appointments,
  date,
  professionalName,
  hoje,
  onMarcar,
  onAbrirConsulta,
}: {
  appointments: AppointmentDoDia[];
  date: string;
  professionalName: string;
  hoje?: string;
  onMarcar: (dataIso: string, hora: string) => void;
  onAbrirConsulta: (appt: AppointmentDoDia) => void;
}) {
  const vagas = vagasDoDia();
  const dias = diasDaSemana(date);

  // consulta por (dia, hora de início) — cancelada não segura a vaga
  const porCelula = new Map<string, AppointmentDoDia>();
  const ocupadasPorContinuacao = new Set<string>();
  for (const appt of appointments) {
    const dia = diaLocalDe(appt.startsAt);
    const hora = horaLocalDe(appt.startsAt);
    const chave = `${dia}|${hora}`;
    if (!porCelula.has(chave) || appt.status !== 'cancelado') porCelula.set(chave, appt);
    if (appt.status !== 'cancelado') {
      const inicio = vagas.indexOf(hora);
      for (let i = 1; i < linhasOcupadas(appt) && inicio >= 0 && inicio + i < vagas.length; i += 1) {
        ocupadasPorContinuacao.add(`${dia}|${vagas[inicio + i]}`);
      }
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <caption className="sr-only">Semana de {professionalName}</caption>
        <thead>
          <tr className="bg-slate-50 dark:bg-white/5">
            <th scope="col" className="w-16 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Hora
            </th>
            {dias.map((dia) => (
              <th
                key={dia}
                scope="col"
                className={`px-2 py-3 text-left text-xs font-semibold uppercase tracking-wide ${
                  dia === hoje
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {rotuloCurtoDoDia(dia)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vagas.map((hora) => (
            <tr key={hora} className="border-t border-slate-100 dark:border-white/5">
              <td className="px-2 py-1 align-top text-xs font-medium tabular-nums text-slate-400">{hora}</td>
              {dias.map((dia) => {
                const chave = `${dia}|${hora}`;
                const appt = porCelula.get(chave);
                if (appt) {
                  return (
                    <td key={dia} className="px-1 py-1 align-top">
                      <button
                        type="button"
                        onClick={() => onAbrirConsulta(appt)}
                        className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition hover:opacity-80 ${CORES_DE_STATUS[appt.status] || CORES_DE_STATUS.agendado}`}
                      >
                        <span className="block truncate font-semibold">{appt.contactName || 'Sem contato'}</span>
                        <span className="block truncate opacity-80">
                          {horaLocalDe(appt.startsAt)}
                          {appt.endsAt ? `–${horaLocalDe(appt.endsAt)}` : ''} ·{' '}
                          {ROTULOS_DE_STATUS[appt.status] || appt.status}
                          {appt.source === 'clinicorp_api' ? ' · veio do Clinicorp' : ''}
                        </span>
                      </button>
                    </td>
                  );
                }
                if (ocupadasPorContinuacao.has(chave)) {
                  return <td key={dia} className="px-1 py-1" aria-hidden />;
                }
                return (
                  <td key={dia} className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => onMarcar(dia, hora)}
                      aria-label={`Marcar ${hora} de ${rotuloCurtoDoDia(dia)} com ${professionalName}`}
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
