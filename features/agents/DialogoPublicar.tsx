'use client';

import React from 'react';
import { Loader2, Send } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import type { ResultadoDaVerificacao } from '@/lib/agents/verificarPrompt';
import { ErroDaApi, agentesApi } from './agentesApi';
import { PainelDaVerificacao } from './PainelDaVerificacao';

/**
 * Publica o rascunho salvo como versão N+1. Aviso só passa com a confirmação marcada; o servidor verifica de novo e,
 * se achar outra coisa (422), o diálogo mostra a verificação dele e pede a confirmação outra vez.
 */
export function DialogoPublicar(props: {
  tenantId: string;
  agente: AgenteNoEditor;
  verificacao: ResultadoDaVerificacao;
  onFechar: () => void;
  onPublicado: (versao: number) => void;
  onConflito: (mensagem: string) => void;
}) {
  const { tenantId, agente, verificacao, onFechar, onPublicado, onConflito } = props;
  const [nota, setNota] = React.useState('');
  const [confirmou, setConfirmou] = React.useState(false);
  const [doServidor, setDoServidor] = React.useState<ResultadoDaVerificacao | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const atual = doServidor ?? verificacao;
  const proxima = (agente.publicada?.versao ?? 0) + 1;
  const precisaConfirmar = atual.avisos.length > 0;
  const bloqueado = atual.erros.length > 0;

  const publicar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await agentesApi.publicar(tenantId, agente.id, {
        versaoEsperada: agente.publicada?.versao ?? 0,
        revisao: agente.rascunho.revisao,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
        confirmarAvisos: confirmou ? atual.avisos.map((a) => a.codigo) : [],
      });
      onPublicado(r.versao);
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 422 && e.verificacao) {
        setDoServidor(e.verificacao);
        setConfirmou(false);
        setErro(e.message);
      } else if (e instanceof ErroDaApi && e.status === 409) {
        onConflito(e.message);
      } else {
        setErro(e instanceof Error ? e.message : 'Falha ao publicar.');
      }
    } finally {
      setEnviando(false);
    }
  };

  const numeros = agente.numeros.map((n) => n.nome).join(', ');
  return (
    <Modal isOpen onClose={enviando ? () => undefined : onFechar} title={`Publicar versão ${proxima}`} size="lg" bodyClassName="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {agente.numeros.length === 0
          ? 'Nenhum número está ligado a este agente ainda: a versão fica pronta para quando ligar.'
          : `As respostas ${agente.numeros.length === 1 ? 'do número' : 'dos números'} ${numeros} que começarem depois da publicação já saem com esta versão. Uma resposta que já estava sendo gerada ainda sai com a anterior.`}
      </p>
      <PainelDaVerificacao verificacao={atual} />
      {precisaConfirmar ? (
        <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
          <input type="checkbox" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} className="mt-1" />
          Li os avisos e quero publicar assim.
        </label>
      ) : null}
      <div>
        <label htmlFor="nota-da-versao" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Nota da versão (opcional)
        </label>
        <textarea
          id="nota-da-versao"
          value={nota}
          maxLength={200}
          rows={2}
          onChange={(e) => setNota(e.target.value)}
          placeholder="O que mudou, em uma frase"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-white/10 dark:bg-card dark:text-white"
        />
        <p className="mt-1 text-right text-xs text-slate-500 dark:text-slate-400">{nota.length}/200</p>
      </div>
      {erro ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{erro}</p> : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onFechar}
          disabled={enviando}
          className="rounded-xl px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void publicar()}
          disabled={enviando || bloqueado || (precisaConfirmar && !confirmou)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {`Publicar versão ${proxima}`}
        </button>
      </div>
    </Modal>
  );
}
