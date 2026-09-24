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
  dia,
  livres,
  contacts,
  salvando,
  onConfirmar,
  onFechar,
}: {
  professionalId: string;
  professionalName: string;
  hora: string;
  /** Dia por extenso ("qua 29/07"). Nas visões de semana e mês a vaga clicada
   *  pode não ser hoje — sem isso a pessoa marca achando que é o dia atual. */
  dia?: string;
  /** Livres naquela vaga, quando a marcação veio da visão "Todos": aí quem
   *  atende ainda não foi escolhido e o campo aparece no formulário. */
  livres?: { id: string; name: string }[];
  contacts: Contact[];
  salvando: boolean;
  onConfirmar: (nova: NovaConsulta) => Promise<unknown>;
  onFechar: () => void;
}) {
  const [contactId, setContactId] = React.useState('');
  const [escolhido, setEscolhido] = React.useState(professionalId);
  const [duracaoMin, setDuracaoMin] = React.useState(30);
  const [notes, setNotes] = React.useState('');
  const [busca, setBusca] = React.useState('');
  /**
   * Marcar para quem NÃO está em Contatos (pedido do Junior, 24/09/2026): indicação que chamou
   * no WhatsApp pessoal, lead prospectado por ele. Como dono da agenda, a tela não pode barrar.
   */
  const [modoNovo, setModoNovo] = React.useState(false);
  const [novoNome, setNovoNome] = React.useState('');
  const [novoTelefone, setNovoTelefone] = React.useState('');

  // Só pergunta "com quem" quando a vaga tem mais de um dentista livre.
  const escolherProfissional = Boolean(livres && livres.length > 1);

  // Acento importa: quem digita "Pulpitos" precisa achar "Púlpitos". Comparar sem os sinais
  // dos dois lados — foi exatamente assim que uma busca "não achou" um contato que existia.
  const semAcento = (valor: string) =>
    valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const filtrados = React.useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return contacts.slice(0, 50);
    return contacts.filter((c) => semAcento(c.name || '').includes(q)).slice(0, 50);
  }, [contacts, busca]);

  const buscaVazia = busca.trim() !== '' && filtrados.length === 0;
  const nomeNovo = novoNome.trim();
  const podeMarcar = modoNovo ? nomeNovo !== '' : contactId !== '';
  const faltaDizer = modoNovo
    ? 'Escreva o nome de quem vai ser atendido.'
    : buscaVazia
      ? 'Ninguém com esse nome na lista. Use "Marcar para alguém de fora da lista" aqui embaixo.'
      : 'Escolha o contato na lista acima — só digitar o nome na busca não basta.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Marcar consulta" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-dark-card">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Marcar consulta</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {escolherProfissional ? '' : `${professionalName} · `}
              {dia ? `${dia} · ` : ''}
              {hora}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!podeMarcar || !escolhido) return;
            await onConfirmar({
              contactId: modoNovo ? '' : contactId,
              novoContato: modoNovo
                ? { name: nomeNovo, phone: novoTelefone.trim() || undefined }
                : undefined,
              professionalId: escolhido,
              hora,
              duracaoMin,
              notes,
            });
            onFechar();
          }}
        >
          {modoNovo ? (
            <div>
              <label htmlFor="agenda-novo-nome" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Quem vai ser atendido
              </label>
              <input
                id="agenda-novo-nome"
                type="text"
                placeholder="Nome de quem vai ser atendido"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                className={`${CAMPO} mb-2`}
                autoFocus
              />
              <input
                aria-label="Telefone (opcional)"
                type="tel"
                placeholder="Telefone (opcional)"
                value={novoTelefone}
                onChange={(e) => setNovoTelefone(e.target.value)}
                className={CAMPO}
              />
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Entra em Contatos como lead, para a marcação contar nos seus números.
              </p>
              <button
                type="button"
                onClick={() => { setModoNovo(false); setNovoNome(''); setNovoTelefone(''); }}
                className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                Voltar para a lista de contatos
              </button>
            </div>
          ) : (
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
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className={CAMPO}
              >
                <option value="">Escolha o contato…</option>
                {filtrados.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { setModoNovo(true); setContactId(''); setNovoNome(busca.trim()); }}
                className="mt-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                Marcar para alguém de fora da lista
              </button>
            </div>
          )}

          {escolherProfissional ? (
            <div>
              <label htmlFor="agenda-profissional" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Com quem
              </label>
              <select
                id="agenda-profissional"
                required
                value={escolhido}
                onChange={(e) => setEscolhido(e.target.value)}
                className={CAMPO}
              >
                <option value="">Escolha o profissional…</option>
                {livres?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ) : null}

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

          {/* Botão apagado sem explicação é o que travou o Junior em 24/09/2026: ele digitou o
              nome na busca (que é só filtro), o botão não acendeu e a tela não disse nada. */}
          {!podeMarcar ? (
            <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {faltaDizer}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={salvando || !podeMarcar}
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
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {appt.contactName || appt.titulo || 'Sem contato'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {ROTULOS_DE_STATUS[appt.status] || appt.status}
              {appt.source === 'clinicorp_api' ? ' · veio do Clinicorp' : ''}
              {appt.source === 'aurora' ? ' · marcada pela IA na conversa' : ''}
              {appt.notes ? ` · ${appt.notes}` : ''}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {appt.somenteLeitura ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Esta reunião foi marcada pela IA e também existe no Google Agenda, com o link da chamada.
            Para remarcar ou cancelar, use a conversa com o lead — é ela que avisa a pessoa e corrige o
            Google. Mudar só por aqui deixaria as duas agendas contando histórias diferentes.
          </p>
        ) : null}

        <div className={`mb-4 flex flex-wrap gap-2 ${appt.somenteLeitura ? 'hidden' : ''}`}>
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
          className={`space-y-3 border-t border-slate-100 pt-4 dark:border-white/5 ${appt.somenteLeitura ? 'hidden' : ''}`}
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
