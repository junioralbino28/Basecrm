'use client';

/**
 * Grade do MÊS de UM profissional (pedido do Junior, 29/07/2026): calendário
 * clássico, cada dia mostrando as consultas em miniatura. Clicar na consulta
 * abre o detalhe; clicar no dia abre aquele dia na visão de dia.
 */
import React from 'react';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import { celulasDoMes, horaLocalDe } from '../hooks/useAgendaLocalController';
import { PONTO_DE_STATUS, ROTULOS_DE_STATUS, porDia } from './agendaFormato';

const CABECALHO = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
/** Quantas consultas cabem na célula antes de virar "+N". */
const CABEM_NA_CELULA = 3;

export function AgendaGradeMes({
  appointments,
  date,
  professionalName,
  hoje,
  onAbrirDia,
  onAbrirConsulta,
}: {
  appointments: AppointmentDoDia[];
  date: string;
  professionalName: string;
  hoje?: string;
  onAbrirDia: (dataIso: string) => void;
  onAbrirConsulta: (appt: AppointmentDoDia) => void;
}) {
  const celulas = celulasDoMes(date);
  const agrupadas = porDia(appointments);

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-7 bg-slate-50 dark:bg-white/5">
          {CABECALHO.map((rotulo) => (
            <div
              key={rotulo}
              className="px-2 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              {rotulo}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {celulas.map((dia, i) => {
            if (!dia) {
              return (
                <div
                  key={`vazia-${i}`}
                  className="min-h-[104px] border-t border-slate-100 bg-slate-50/50 dark:border-white/5 dark:bg-white/[0.02]"
                  aria-hidden
                />
              );
            }
            const doDia = agrupadas.get(dia) ?? [];
            const mostrar = doDia.slice(0, CABEM_NA_CELULA);
            const sobra = doDia.length - mostrar.length;
            const numero = Number(dia.split('-')[2]);
            return (
              <div
                key={dia}
                className={`min-h-[104px] border-t border-l border-slate-100 p-1.5 first:border-l-0 dark:border-white/5 ${
                  dia === hoje ? 'bg-brand-50/60 dark:bg-brand-500/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onAbrirDia(dia)}
                  aria-label={`Abrir ${dia} de ${professionalName}`}
                  className={`mb-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums transition hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-500/20 ${
                    dia === hoje
                      ? 'text-brand-700 dark:text-brand-200'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {numero}
                </button>
                <ul className="flex flex-col gap-0.5">
                  {mostrar.map((appt) => (
                    <li key={appt.id}>
                      <button
                        type="button"
                        onClick={() => onAbrirConsulta(appt)}
                        title={`${horaLocalDe(appt.startsAt)} · ${appt.contactName || 'Sem contato'} · ${ROTULOS_DE_STATUS[appt.status] || appt.status}`}
                        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${PONTO_DE_STATUS[appt.status] || PONTO_DE_STATUS.agendado}`}
                          aria-hidden
                        />
                        <span className="shrink-0 tabular-nums opacity-70">{horaLocalDe(appt.startsAt)}</span>
                        <span className={`truncate ${appt.status === 'cancelado' ? 'line-through opacity-60' : ''}`}>
                          {appt.contactName || 'Sem contato'}
                        </span>
                      </button>
                    </li>
                  ))}
                  {sobra > 0 ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => onAbrirDia(dia)}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-300"
                      >
                        +{sobra} {sobra === 1 ? 'consulta' : 'consultas'}
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
