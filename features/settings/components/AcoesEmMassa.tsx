import React from 'react';
import { CheckSquare, RotateCcw, Square } from 'lucide-react';

/**
 * Ligar/desligar tudo de uma vez, e voltar ao padrão.
 *
 * Pedido do Junior (2026-07-27): *"seria interessante também que esses toggles
 * possuam uma opção de ativar/desativar todos com apenas um clique, em todos os
 * lugares que tiver toggle. Um também para restaurar padrões."*
 *
 * Um componente só para os três lugares (procedimentos da especialidade, o que a
 * pessoa faz, permissões da equipe) — telas iguais escritas três vezes divergem
 * na primeira correção.
 *
 * `onRestaurar` é opcional porque "padrão" nem sempre existe: na lista de
 * procedimentos de uma especialidade não há padrão nenhum a que voltar.
 */
export const AcoesEmMassa: React.FC<{
  onMarcarTodos: () => void;
  onDesmarcarTodos: () => void;
  onRestaurar?: () => void;
  /** Some quando a ação não faz sentido (nada na tela, tudo já marcado…). */
  desabilitado?: boolean;
  /** Texto do botão de voltar ao padrão — diga a que padrão se volta. */
  rotuloRestaurar?: string;
  /** Complemento do rótulo quando há filtro: "Marcar todos os 12 visíveis". */
  escopo?: string;
}> = ({
  onMarcarTodos, onDesmarcarTodos, onRestaurar,
  desabilitado, rotuloRestaurar, escopo,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <button
      type="button"
      onClick={onMarcarTodos}
      disabled={desabilitado}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-card text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <CheckSquare className="h-3.5 w-3.5 text-muted" />
      Marcar {escopo || 'todos'}
    </button>
    <button
      type="button"
      onClick={onDesmarcarTodos}
      disabled={desabilitado}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-card text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Square className="h-3.5 w-3.5 text-muted" />
      Desmarcar {escopo || 'todos'}
    </button>
    {onRestaurar && (
      <button
        type="button"
        onClick={onRestaurar}
        disabled={desabilitado}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-card text-xs font-semibold text-muted hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {rotuloRestaurar || 'Restaurar padrão'}
      </button>
    )}
  </div>
);
