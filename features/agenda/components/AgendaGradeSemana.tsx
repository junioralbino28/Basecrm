'use client';

/**
 * Grade da SEMANA — colunas por dia (segunda a domingo), linhas de meia em meia
 * hora. Funciona de dois jeitos com o MESMO código:
 *  - UM profissional: igual à grade do dia, só trocando "quem" por "quando";
 *  - TODOS: cada célula mostra quem já está ocupado e quantos estão livres, que
 *    é o que a recepção precisa pra fazer encaixe sem abrir agenda por agenda
 *    (pedido do Junior, 29/07/2026).
 * Nada aqui toca o Clinicorp.
 */
import React from 'react';
import type { Professional } from '@/types';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import {
  vagasDoDia,
  horaLocalDe,
  diasDaSemana,
  MINUTOS_POR_VAGA,
} from '../hooks/useAgendaLocalController';
import {
  CORES_DE_STATUS,
  ROTULOS_DE_STATUS,
  corDoProfissional,
  diaLocalDe,
  primeiroNome,
  rotuloCurtoDoDia,
} from './agendaFormato';

function linhasOcupadas(appt: AppointmentDoDia): number {
  if (!appt.endsAt) return 1;
  const minutos = (new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60_000;
  return Math.max(1, Math.round(minutos / MINUTOS_POR_VAGA));
}

export function AgendaGradeSemana({
  appointments,
  professionals,
  date,
  hoje,
  onMarcar,
  onAbrirConsulta,
}: {
  appointments: AppointmentDoDia[];
  /** Um só = agenda individual. Vários = visão "Todos". */
  professionals: Professional[];
  date: string;
  hoje?: string;
  /** `livres` = quem está disponível naquela vaga. A conta de ocupação mora só
   *  aqui; a página não recalcula (senão viram duas verdades). */
  onMarcar: (dataIso: string, hora: string, livres: Professional[]) => void;
  onAbrirConsulta: (appt: AppointmentDoDia) => void;
}) {
  const vagas = vagasDoDia();
  const dias = diasDaSemana(date);
  const individual = professionals.length === 1;

  // ocupação por (profissional, dia, hora) — cancelada não segura a vaga
  const inicios = new Map<string, AppointmentDoDia>();
  const continuacoes = new Set<string>();
  for (const appt of appointments) {
    if (!appt.professionalId) continue;
    const dia = diaLocalDe(appt.startsAt);
    const hora = horaLocalDe(appt.startsAt);
    const chave = `${appt.professionalId}|${dia}|${hora}`;
    if (!inicios.has(chave) || appt.status !== 'cancelado') inicios.set(chave, appt);
    if (appt.status !== 'cancelado') {
      const i = vagas.indexOf(hora);
      for (let k = 1; k < linhasOcupadas(appt) && i >= 0 && i + k < vagas.length; k += 1) {
        continuacoes.add(`${appt.professionalId}|${dia}|${vagas[i + k]}`);
      }
    }
  }

  if (professionals.length === 0) {
    return (
      <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
        Cadastre os profissionais em Configurações → Equipe para a agenda ganhar a semana.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
      <table className="w-full min-w-[900px] border-collapse text-sm">
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
                  dia === hoje ? 'text-brand-600 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300'
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
                const ocupados = professionals
                  .map((pro) => ({ pro, appt: inicios.get(`${pro.id}|${dia}|${hora}`) }))
                  .filter((x): x is { pro: Professional; appt: AppointmentDoDia } => Boolean(x.appt));
                const livres = professionals.filter(
                  (pro) =>
                    !inicios.has(`${pro.id}|${dia}|${hora}`) &&
                    !continuacoes.has(`${pro.id}|${dia}|${hora}`),
                );

                // Agenda individual: mesma leitura da grade do dia.
                if (individual) {
                  const so = ocupados[0];
                  if (so) {
                    return (
                      <td key={dia} className="px-1 py-1 align-top">
                        <ConsultaChip appt={so.appt} onAbrir={onAbrirConsulta} />
                      </td>
                    );
                  }
                  if (livres.length === 0) return <td key={dia} className="px-1 py-1" aria-hidden />;
                  return (
                    <td key={dia} className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => onMarcar(dia, hora, livres)}
                        aria-label={`Marcar ${hora} de ${rotuloCurtoDoDia(dia)} com ${professionals[0].name}`}
                        className="h-7 w-full rounded-lg border border-dashed border-slate-200 text-[11px] text-transparent transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 dark:border-white/10 dark:hover:bg-brand-500/10"
                      >
                        Marcar
                      </button>
                    </td>
                  );
                }

                // Visão "Todos": quem está ocupado + quantos ainda cabem.
                return (
                  <td key={dia} className="px-1 py-1 align-top">
                    <div className="flex flex-col gap-0.5">
                      {ocupados.map(({ pro, appt }) => (
                        <ConsultaChip key={pro.id} appt={appt} nomeDoProfissional={pro.name} onAbrir={onAbrirConsulta} />
                      ))}
                      {livres.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onMarcar(dia, hora, livres)}
                          aria-label={`Marcar ${hora} de ${rotuloCurtoDoDia(dia)} — ${livres.length} ${livres.length === 1 ? 'profissional livre' : 'profissionais livres'}`}
                          title={`Livres: ${livres.map((p) => p.name).join(', ')}`}
                          className="rounded-lg border border-dashed border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:border-brand-400 hover:bg-brand-50 hover:text-brand-600 dark:border-white/10 dark:hover:bg-brand-500/10"
                        >
                          {livres.length} {livres.length === 1 ? 'livre' : 'livres'}
                        </button>
                      ) : null}
                    </div>
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

function ConsultaChip({
  appt,
  nomeDoProfissional,
  onAbrir,
}: {
  appt: AppointmentDoDia;
  /** Só na visão "Todos": aí o cartão precisa dizer de quem é. */
  nomeDoProfissional?: string;
  onAbrir: (appt: AppointmentDoDia) => void;
}) {
  const cor = nomeDoProfissional && appt.professionalId ? corDoProfissional(appt.professionalId) : null;
  return (
    <button
      type="button"
      onClick={() => onAbrir(appt)}
      className={`relative w-full overflow-hidden rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition hover:opacity-80 ${cor ? 'pl-3' : ''} ${CORES_DE_STATUS[appt.status] || CORES_DE_STATUS.agendado}`}
    >
      {/* faixa = quem atende; fundo = situação da consulta */}
      {cor ? <span className={`absolute inset-y-0 left-0 w-1.5 ${cor.faixa}`} aria-hidden /> : null}
      <span className="block truncate font-semibold">
        {nomeDoProfissional ? (
          <span className={cor?.texto}>{primeiroNome(nomeDoProfissional)} · </span>
        ) : null}
        {appt.contactName || 'Sem contato'}
      </span>
      <span className="block truncate opacity-80">
        {horaLocalDe(appt.startsAt)}
        {appt.endsAt ? `–${horaLocalDe(appt.endsAt)}` : ''} · {ROTULOS_DE_STATUS[appt.status] || appt.status}
        {appt.source === 'clinicorp_api' ? ' · veio do Clinicorp' : ''}
      </span>
    </button>
  );
}
