'use client';

/**
 * Modal de MARCAR (vaga livre clicada) e de DETALHE (consulta clicada) —
 * remarcar, confirmar presença/falta e cancelar, tudo em linguagem de recepção.
 */
import React from 'react';
import { X } from 'lucide-react';
import type { Contact, Professional, AppointmentStatus } from '@/types';
import type { AppointmentDoDia } from '@/lib/supabase/appointmentsLocal';
import { horaLocalDe, vagasDoDia, type NovaConsulta } from '../hooks/useAgendaLocalController';
import { ROTULOS_DE_STATUS } from './AgendaGradeDia';

const DURACOES = [30, 60, 90, 120];

const CAMPO =
  'block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/50 dark:border-line dark:bg-card/50 dark:text-white';

export function MarcarConsultaModal({
  professionalId,
  professionalName,
  hora,
  contacts,
  salvando,
  onConfirmar,
  onFechar,
}: {
  professionalId: string;
  professionalName: string;
  hora: string;
  contacts: Contact[];
  salvando: boolean;
  onConfirmar: (nova: NovaConsulta) => Promise<unknown>;
  onFechar: () => void;
}) {
  const [contactId, setContactId] = React.useState('');
  const [duracaoMin, setDuracaoMin] = React.useState(30);
  const [notes, setNotes] = React.useState('');
  const [busca, setBusca] = React.useState('');

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return contacts.slice(0, 50);
    return contacts.filter((c) => (c.name || '').toLowerCase().includes(q)).slice(0, 50);
  }, [contacts, busca]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Marcar consulta" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-dark-card">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Marcar consulta</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{professionalName} · {hora}</p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!contactId) return;
            await onConfirmar({ contactId, professionalId, hora, duracaoMin, notes });
            onFechar();
          }}
        >
          <div>
            <label htmlFor="agenda-busca-contato" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Contato</label>
            <input
              id="agenda-busca-contato"
              type="text"
              placeholder="Buscar pelo nome…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className={`${CAMPO} mb-2`}
            />
            <select
              aria-label="Contato da consulta"
              required
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className={CAMPO}
            >
              <option value="">Escolha o contato…</option>
              {filtrados.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="agenda-duracao" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Duração</label>
            <select id="agenda-duracao" value={duracaoMin} onChange={(e) => setDuracaoMin(Number(e.target.value))} className={CAMPO}>
              {DURACOES.map((d) => <option key={d} value={d}>{d} minutos</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="agenda-notas" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Observações (opcional)</label>
            <input id="agenda-notas" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={CAMPO} placeholder="Ex.: avaliação, retorno…" />
          </div>

          <button
            type="submit"
            disabled={salvando || !contactId}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-500 disabled:opacity-50"
          >
            {salvando ? 'Marcando…' : 'Marcar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function DetalheConsultaModal({
  appt,
  professionals,
  date,
  remarcando,
  mudandoStatus,
  onRemarcar,
  onMudarStatus,
  onFechar,
}: {
  appt: AppointmentDoDia;
  professionals: Professional[];
  date: string;
  remarcando: boolean;
  mudandoStatus: boolean;
  onRemarcar: (params: { id: string; dataIso: string; hora: string; duracaoMin: number; professionalId?: string }) => Promise<unknown>;
  onMudarStatus: (params: { id: string; status: AppointmentStatus }) => Promise<unknown>;
  onFechar: () => void;
}) {
  const duracaoAtual = appt.endsAt
    ? Math.max(30, Math.round((new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60_000))
    : 30;
  const [dataIso, setDataIso] = React.useState(date);
  const [hora, setHora] = React.useState(horaLocalDe(appt.startsAt));
  const [duracaoMin, setDuracaoMin] = React.useState(duracaoAtual);
  const [professionalId, setProfessionalId] = React.useState(appt.professionalId || '');

  const statusRapidos: AppointmentStatus[] = ['confirmado', 'compareceu', 'faltou'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Detalhes da consulta" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-dark-card">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{appt.contactName || 'Sem contato'}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {ROTULOS_DE_STATUS[appt.status] || appt.status}
              {appt.source === 'clinicorp_api' ? ' · veio do Clinicorp' : ''}
              {appt.notes ? ` · ${appt.notes}` : ''}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {statusRapidos.map((status) => (
            <button
              key={status}
              type="button"
              disabled={mudandoStatus || appt.status === status}
              onClick={async () => { await onMudarStatus({ id: appt.id, status }); onFechar(); }}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50 dark:border-white/10 dark:text-slate-200"
            >
              {ROTULOS_DE_STATUS[status]}
            </button>
          ))}
          <button
            type="button"
            disabled={mudandoStatus || appt.status === 'cancelado'}
            onClick={async () => { await onMudarStatus({ id: appt.id, status: 'cancelado' }); onFechar(); }}
            className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400"
          >
            Cancelar consulta
          </button>
        </div>

        <form
          className="space-y-3 border-t border-slate-100 pt-4 dark:border-white/5"
          onSubmit={async (e) => {
            e.preventDefault();
            await onRemarcar({ id: appt.id, dataIso, hora, duracaoMin, professionalId: professionalId || undefined });
            onFechar();
          }}
        >
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Remarcar</p>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Nova data" type="date" value={dataIso} onChange={(e) => setDataIso(e.target.value)} className={CAMPO} />
            <select aria-label="Novo horário" value={hora} onChange={(e) => setHora(e.target.value)} className={CAMPO}>
              {vagasDoDia().map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select aria-label="Duração" value={duracaoMin} onChange={(e) => setDuracaoMin(Number(e.target.value))} className={CAMPO}>
              {DURACOES.map((d) => <option key={d} value={d}>{d} minutos</option>)}
            </select>
            <select aria-label="Dentista" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={CAMPO}>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={remarcando}
            className="w-full rounded-xl border border-brand-500 px-4 py-2 text-sm font-bold text-brand-600 transition hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
          >
            {remarcando ? 'Remarcando…' : 'Remarcar consulta'}
          </button>
        </form>
      </div>
    </div>
  );
}
