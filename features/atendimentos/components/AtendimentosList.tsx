import React from 'react';
import { Atendimento } from '@/types';
import { AtendimentoRow } from './AtendimentoRow';

interface AtendimentosListProps {
  atendimentos: Atendimento[];
  isLoading: boolean;
  onEdit: (atendimento: Atendimento) => void;
  onDelete: (id: string) => void;
}

/**
 * Lista de atendimentos com estados de loading e vazio.
 */
export const AtendimentosList: React.FC<AtendimentosListProps> = ({
  atendimentos,
  isLoading,
  onEdit,
  onDelete,
}) => {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-sm text-muted">Carregando atendimentos...</div>
    );
  }

  if (atendimentos.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        Nenhum atendimento registrado ainda.
      </div>
    );
  }

  return (
    <div className="bg-card border border-line rounded-2xl overflow-hidden">
      {atendimentos.map(atendimento => (
        <AtendimentoRow
          key={atendimento.id}
          atendimento={atendimento}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};
