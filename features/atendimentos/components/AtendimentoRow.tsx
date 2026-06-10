import React from 'react';
import { Pencil, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { Atendimento } from '@/types';

interface AtendimentoRowProps {
  atendimento: Atendimento;
  onEdit: (atendimento: Atendimento) => void;
  onDelete: (id: string) => void;
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);

/**
 * Linha de atendimento na lista. Mostra procedimento, valor líquido
 * (valor − desconto, o que de fato entra no faturamento) e status de recebimento.
 */
export const AtendimentoRow: React.FC<AtendimentoRowProps> = ({ atendimento, onEdit, onDelete }) => {
  const liquido = Math.max((atendimento.valor || 0) - (atendimento.desconto || 0), 0);

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface/60 transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink truncate">
          {atendimento.procedimento}
        </p>
        <p className="text-xs text-muted">
          {formatBRL(liquido)}
          {(atendimento.desconto || 0) > 0 && (
            <span className="text-faint"> · desconto {formatBRL(atendimento.desconto)}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            atendimento.recebido ? 'text-brand-600' : 'text-faint'
          }`}
        >
          {atendimento.recebido ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          {atendimento.recebido ? 'Recebido' : 'Pendente'}
        </span>
        <button
          type="button"
          aria-label="Editar atendimento"
          onClick={() => onEdit(atendimento)}
          className="text-faint hover:text-brand-600 transition-colors"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          aria-label="Excluir atendimento"
          onClick={() => onDelete(atendimento.id)}
          className="text-faint hover:text-red-600 transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
