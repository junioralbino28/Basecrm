'use client';

import React from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { agentesApi } from './agentesApi';

/** Renomeia o agente (SPEC-renomear-excluir.md). O banco confere de 1 a 80 caracteres depois de aparar. */
export function DialogoRenomearAgente(props: {
  tenantId: string;
  agenteId: string;
  nomeAtual: string;
  onFechar: () => void;
  onRenomeado: (nome: string) => void;
}) {
  const { tenantId, agenteId, nomeAtual, onFechar, onRenomeado } = props;
  const [nome, setNome] = React.useState(nomeAtual);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const aparado = nome.trim();
  const podeSalvar = !enviando && aparado.length > 0 && aparado.length <= 80 && aparado !== nomeAtual;

  const salvar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await agentesApi.renomear(tenantId, agenteId, aparado);
      onRenomeado(r.nome);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao renomear o agente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen onClose={enviando ? () => undefined : onFechar} title="Renomear agente" size="md" bodyClassName="space-y-4">
      <div>
        <label htmlFor="novo-nome-do-agente" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Nome do agente
        </label>
        <input
          id="novo-nome-do-agente"
          value={nome}
          maxLength={80}
          disabled={enviando}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && podeSalvar) void salvar();
          }}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white"
        />
      </div>
      {erro ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          disabled={enviando}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 dark:border-white/10 dark:text-slate-200"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void salvar()}
          disabled={!podeSalvar}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
          Salvar nome
        </button>
      </div>
    </Modal>
  );
}
