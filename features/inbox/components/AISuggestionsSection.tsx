import React from 'react';
import { AISuggestion, AISuggestionType } from '../hooks/useInboxController';
import { 
  Sparkles, 
  TrendingUp, 
  AlertTriangle, 
  Clock,
  Check, 
  X, 
  ChevronRight,
  Zap
} from 'lucide-react';

interface AISuggestionsSectionProps {
  suggestions: AISuggestion[];
  onAccept: (suggestion: AISuggestion) => void;
  onDismiss: (id: string) => void;
  onSnooze: (id: string) => void;
}

const getTypeConfig = (type: AISuggestionType) => {
  switch (type) {
    case 'UPSELL':
      return {
        icon: TrendingUp,
        color: 'text-green-500',
        bg: 'bg-green-50 dark:bg-green-500/10',
        border: 'border-green-200 dark:border-green-500/20',
        label: 'Upsell'
      };
    case 'STALLED':
      return {
        icon: AlertTriangle,
        color: 'text-orange-500',
        bg: 'bg-orange-50 dark:bg-orange-500/10',
        border: 'border-orange-200 dark:border-orange-500/20',
        label: 'Risco'
      };
    case 'RESCUE':
      return {
        icon: Zap,
        color: 'text-yellow-500',
        bg: 'bg-yellow-50 dark:bg-yellow-500/10',
        border: 'border-yellow-200 dark:border-yellow-500/20',
        label: 'Resgate'
      };
    default:
      return {
        icon: Sparkles,
        color: 'text-brand-500',
        bg: 'bg-brand-50 dark:bg-brand-500/10',
        border: 'border-brand-200 dark:border-brand-500/20',
        label: 'IA'
      };
  }
};

/**
 * Componente React `AISuggestionsSection`.
 *
 * @param {AISuggestionsSectionProps} {
  suggestions,
  onAccept,
  onDismiss,
  onSnooze
} - Parâmetro `{
  suggestions,
  onAccept,
  onDismiss,
  onSnooze
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const AISuggestionsSection: React.FC<AISuggestionsSectionProps> = ({
  suggestions,
  onAccept,
  onDismiss,
  onSnooze
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div className="mb-8">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 bg-gradient-to-br from-brand-500 to-purple-600 rounded-lg">
          <Sparkles size={16} className="text-white" />
        </div>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
          Sugestões da IA
        </h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-brand-100 dark:bg-brand-500/20 text-brand-600 dark:text-brand-400 font-medium">
          {suggestions.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {suggestions.map(suggestion => {
          const config = getTypeConfig(suggestion.type);
          const Icon = config.icon;

          return (
            <div
              key={suggestion.id}
              className={`group relative overflow-hidden rounded-xl border ${config.border} ${config.bg} p-4 transition-all hover:shadow-md`}
            >
              {/* Priority indicator */}
              {suggestion.priority === 'high' && (
                <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden">
                  <div className="absolute top-2 right-[-20px] w-[80px] text-center text-[10px] font-bold text-white bg-red-500 rotate-45 py-0.5">
                    URGENTE
                  </div>
                </div>
              )}

              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={`shrink-0 p-2 rounded-lg ${config.bg} border ${config.border}`}>
                  <Icon size={20} className={config.color} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${config.color}`}>
                      {config.label}
                    </span>
                  </div>
                  <h3 className="font-medium text-slate-900 dark:text-white mb-1">
                    {suggestion.title}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {suggestion.description}
                  </p>

                  {/* Deal/Contact info */}
                  {suggestion.data.deal && (
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      💰 R$ {suggestion.data.deal.value.toLocaleString('pt-BR')}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onSnooze(suggestion.id)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white/50 dark:hover:bg-white/10 rounded-lg transition-colors"
                    title="Adiar"
                  >
                    <Clock size={18} />
                  </button>
                  <button
                    onClick={() => onDismiss(suggestion.id)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Descartar"
                  >
                    <X size={18} />
                  </button>
                  <button
                    onClick={() => onAccept(suggestion)}
                    className="p-2 text-white bg-brand-500 hover:bg-brand-600 rounded-lg transition-colors shadow-sm"
                    title="Aceitar"
                  >
                    <Check size={18} />
                  </button>
                </div>
              </div>

              {/* Quick action button (mobile friendly) */}
              <button
                onClick={() => onAccept(suggestion)}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 rounded-lg transition-colors md:hidden"
              >
                Aceitar sugestão <ChevronRight size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
