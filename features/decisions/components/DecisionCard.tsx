/**
 * Decision Card Component
 * Card individual para uma decisão na fila
 */

import React, { useState } from 'react';
import {
  Phone,
  Mail,
  Calendar,
  MessageCircle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  Target,
  Loader2,
} from 'lucide-react';
import { Decision, SuggestedAction, PRIORITY_COLORS, PRIORITY_LABELS } from '../types';

interface DecisionCardProps {
  decision: Decision;
  onApprove: (id: string, action?: SuggestedAction) => void;
  onReject: (id: string) => void;
  onSnooze: (id: string) => void;
  isExecuting?: boolean;
}

// Icon mapping
const getActionIcon = (icon?: string) => {
  const icons: Record<string, React.ReactNode> = {
    Phone: <Phone size={16} />,
    Mail: <Mail size={16} />,
    Calendar: <Calendar size={16} />,
    CalendarPlus: <Calendar size={16} />,
    MessageCircle: <MessageCircle size={16} />,
    CheckCircle: <CheckCircle size={16} />,
  };
  return icons[icon || ''] || <Target size={16} />;
};

const getPriorityStyles = (priority: string) => {
  const styles: Record<string, string> = {
    critical: 'border-l-red-500 bg-red-50/50 dark:bg-red-500/5',
    high: 'border-l-orange-500 bg-orange-50/50 dark:bg-orange-500/5',
    medium: 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-500/5',
    low: 'border-l-slate-400 bg-slate-50/50 dark:bg-slate-500/5',
  };
  return styles[priority] || styles.medium;
};

const getPriorityBadge = (priority: string) => {
  const badges: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
    low: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-400',
  };
  return badges[priority] || badges.medium;
};

/**
 * Componente React `DecisionCard`.
 *
 * @param {DecisionCardProps} {
  decision,
  onApprove,
  onReject,
  onSnooze,
  isExecuting = false,
} - Parâmetro `{
  decision,
  onApprove,
  onReject,
  onSnooze,
  isExecuting = false,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const DecisionCard: React.FC<DecisionCardProps> = ({
  decision,
  onApprove,
  onReject,
  onSnooze,
  isExecuting = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAction, setSelectedAction] = useState<SuggestedAction>(decision.suggestedAction);

  const handleApprove = () => {
    onApprove(decision.id, selectedAction);
  };

  return (
    <div
      className={`
        border-l-4 rounded-lg border border-slate-200 dark:border-white/10
        transition-all duration-200 overflow-hidden
        ${getPriorityStyles(decision.priority)}
        ${isExecuting ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Priority Badge */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getPriorityBadge(decision.priority)}`}>
                {PRIORITY_LABELS[decision.priority]}
              </span>
              {decision.category === 'opportunity' && (
                <TrendingUp size={14} className="text-green-500" />
              )}
              {decision.category === 'risk' && (
                <AlertTriangle size={14} className="text-red-500" />
              )}
            </div>

            {/* Title */}
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm leading-tight mb-1">
              {decision.title}
            </h3>

            {/* Description */}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {decision.description}
            </p>
          </div>
        </div>

        {/* Reasoning Toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 mt-3 text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
        >
          <Lightbulb size={14} />
          <span>Por que estou sugerindo isso?</span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Reasoning Content */}
        {isExpanded && (
          <div className="mt-3 p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-slate-200 dark:border-white/10">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {decision.reasoning}
            </p>
          </div>
        )}
      </div>

      {/* Suggested Action */}
      <div className="px-4 pb-3">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1">
          <Target size={12} />
          Ação sugerida:
        </div>

        <div className="p-3 rounded-lg bg-brand-50 dark:bg-brand-500/10 border border-brand-200 dark:border-brand-500/30">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-brand-100 dark:bg-brand-500/20 text-brand-600 dark:text-brand-400">
              {getActionIcon(selectedAction.icon)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-brand-700 dark:text-brand-300">
                {selectedAction.label}
              </div>
              {selectedAction.preview?.scheduledFor && (
                <div className="text-xs text-brand-600/70 dark:text-brand-400/70">
                  {new Date(selectedAction.preview.scheduledFor).toLocaleDateString('pt-BR', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Alternative Actions */}
        {decision.alternativeActions && decision.alternativeActions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="text-xs text-slate-400 mr-1">Ou:</span>
            {decision.alternativeActions.map((action) => (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action)}
                className={`
                  text-xs px-2 py-1 rounded-full border transition-colors
                  ${selectedAction.id === action.id
                    ? 'bg-brand-100 dark:bg-brand-500/20 border-brand-300 dark:border-brand-500/50 text-brand-700 dark:text-brand-300'
                    : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/10'
                  }
                `}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex items-center gap-2">
        <button
          onClick={handleApprove}
          disabled={isExecuting}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isExecuting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CheckCircle size={16} />
          )}
          Aprovar: {selectedAction.label}
        </button>

        <button
          onClick={() => onSnooze(decision.id)}
          disabled={isExecuting}
          className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg transition-colors"
          title="Adiar"
        >
          <Clock size={18} />
        </button>

        <button
          onClick={() => onReject(decision.id)}
          disabled={isExecuting}
          className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
          title="Ignorar"
        >
          <XCircle size={18} />
        </button>
      </div>
    </div>
  );
};

export default DecisionCard;
