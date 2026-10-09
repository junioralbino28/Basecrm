'use client';

import React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import { ErroDaApi, agentesApi } from './agentesApi';

/**
 * Exclui o agente DE VEZ (decisão do Junior, 09/10; SPEC-renomear-excluir.md). Com número ligado não há botão de
 * excluir: a pessoa desliga o número antes. A confirmação manda o estado que a tela mostrou; se outra pessoa mudou o
 * agente no meio (rascunho, publicação, nome) ou ligou um número, o servidor recusa com 409, nada é apagado, o editor
 * recarrega o agente e este diálogo continua aberto, com o estado novo, esperando um novo clique.
 */
export function DialogoExcluirAgente(props: {
  tenantId: string;
  agente: AgenteNoEditor;
  onFechar: () => void;
  onExcluido: () => void;
  onMudou: () => Promise<void> | void;
}) {
  const { tenantId, agente, onFechar, onExcluido, onMudou } = props;
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const numeros = agente.numeros;

  const excluir = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await agentesApi.excluir(tenantId, agente.id, {
        nomeEsperado: agente.nome,
        revisaoEsperada: agente.rascunho.revisao,
        versaoPublicadaEsperada: agente.publicada?.id ?? null,
      });
      onExcluido();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao excluir o agente.');
      if (e instanceof ErroDaApi && e.status === 409) await onMudou();
    } finally {
      setEnviando(false);
    }
  };

  const fechar = enviando ? () => undefined : onFechar;

  if (numeros.length > 0) {
    return (
      <Modal isOpen onClose={fechar} title="Excluir agente" size="md" bodyClassName="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {`Este agente atende ${numeros.length === 1 ? '1 número' : `${numeros.length} números`}: ${numeros.map((n) => n.nome).join(', ')}. Desligue o número antes de excluir.`}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 dark:border-white/10 dark:text-slate-200"
          >
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={fechar} title="Excluir agente" size="md" bodyClassName="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        {`Excluir o agente ${agente.nome}? Somem o agente, o rascunho e todas as versões publicadas. As conversas e o histórico de respostas continuam. Não dá para desfazer.`}
      </p>
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
          onClick={() => void excluir()}
          disabled={enviando}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          Excluir de vez
        </button>
      </div>
    </Modal>
  );
}
