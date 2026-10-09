'use client';

import React from 'react';
import { Library, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { AgenteNoEditor } from '@/lib/agents/tiposDoEditor';
import { agentesApi } from './agentesApi';

/**
 * Bloco 2: transforma a versão PUBLICADA deste agente num modelo da agência. O texto vai igual (copiado no servidor);
 * depois, no editor do modelo, a agência troca o que é deste cliente por lacunas.
 */
export function DialogoSalvarComoModelo(props: {
  tenantId: string;
  agente: AgenteNoEditor;
  onFechar: () => void;
  onCriado: (modeloId: string) => void;
}) {
  const { tenantId, agente, onFechar, onCriado } = props;
  const [nome, setNome] = React.useState(agente.nome);
  const [descricao, setDescricao] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const publicada = agente.publicada;

  const criar = async () => {
    if (!publicada) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await agentesApi.modelos.criar({
        nome: nome.trim(),
        ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
        deAgente: { tenantId, agenteId: agente.id, versaoEsperada: publicada.versao },
      });
      onCriado(r.id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao criar o modelo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal isOpen onClose={enviando ? () => undefined : onFechar} title="Salvar como modelo" size="md" bodyClassName="space-y-4">
      <p className="text-sm text-slate-700 dark:text-slate-200">
        O modelo nasce com o texto da versão {publicada?.versao} publicada. Depois, troque o que é deste cliente por lacunas, como [Nome da
        empresa].
      </p>
      <div>
        <label htmlFor="nome-do-novo-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Nome do modelo
        </label>
        <input
          id="nome-do-novo-modelo"
          value={nome}
          maxLength={80}
          onChange={(e) => setNome(e.target.value)}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white"
        />
      </div>
      <div>
        <label htmlFor="descricao-do-novo-modelo" className="mb-1 block text-sm font-medium text-slate-800 dark:text-slate-100">
          Descrição (opcional)
        </label>
        <input
          id="descricao-do-novo-modelo"
          value={descricao}
          maxLength={280}
          onChange={(e) => setDescricao(e.target.value)}
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
          onClick={() => void criar()}
          disabled={enviando || !publicada || nome.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-on-brand transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {enviando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Library size={16} aria-hidden="true" />}
          Criar modelo
        </button>
      </div>
    </Modal>
  );
}
