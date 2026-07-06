import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { Activity } from '@/types';
import { InboxItem } from './InboxItem';

const MAX_ITEMS = 5;

interface InboxSectionProps {
  title: string;
  activities: Activity[];
  color: 'red' | 'green' | 'slate';
  defaultOpen?: boolean;
  onToggleComplete: (id: string) => void;
  onSnooze?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onSelect?: (id: string) => void;
  filterParam?: string; // e.g., 'overdue', 'today', 'upcoming'
}

/**
 * Componente React `InboxSection`.
 *
 * @param {InboxSectionProps} {
  title,
  activities,
  color,
  defaultOpen = true,
  onToggleComplete,
  onSnooze,
  onDiscard,
  onSelect,
  filterParam
} - Parâmetro `{
  title,
  activities,
  color,
  defaultOpen = true,
  onToggleComplete,
  onSnooze,
  onDiscard,
  onSelect,
  filterParam
}`.
 * @returns {Element | null} Retorna um valor do tipo `Element | null`.
 */
export const InboxSection: React.FC<InboxSectionProps> = ({
  title,
  activities,
  color,
  defaultOpen = true,
  onToggleComplete,
  onSnooze,
  onDiscard,
  onSelect,
  filterParam
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (activities.length === 0) return null;

  const colorStyles = {
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20',
    green: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 border-green-100 dark:border-green-500/20',
    slate: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-surface border-slate-100 dark:border-line'
  };

  const visibleActivities = activities.slice(0, MAX_ITEMS);
  const hasMore = activities.length > MAX_ITEMS;
  const remaining = activities.length - MAX_ITEMS;

  return (
    <div className="mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full mb-3 group"
      >
        <div className={`p-1 rounded-md transition-colors ${isOpen ? 'bg-slate-100 dark:bg-white/5' : ''}`}>
          {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-2">
          {title}
          <span className={`text-xs px-2 py-0.5 rounded-full border ${colorStyles[color]}`}>
            {activities.length}
          </span>
        </h2>
        <div className="flex-1 h-px bg-slate-100 dark:bg-white/5 ml-2 group-hover:bg-slate-200 dark:group-hover:bg-white/10 transition-colors"></div>
      </button>

      {isOpen && (
        <div className="space-y-3 pl-2">
          {visibleActivities.map(activity => (
            <InboxItem
              key={activity.id}
              activity={activity}
              onToggleComplete={onToggleComplete}
              onSnooze={onSnooze}
              onDiscard={onDiscard}
              onSelect={onSelect}
            />
          ))}

          {hasMore && (
            <Link
              href={filterParam ? `/activities?filter=${filterParam}` : '/activities'}
              className="flex items-center justify-center gap-2 py-3 px-4 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-lg transition-colors"
            >
              Ver todas as {activities.length} atividades
              <ArrowRight size={16} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
};
