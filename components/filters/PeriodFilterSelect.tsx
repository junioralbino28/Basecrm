import React from 'react';
import { PeriodFilter, PERIOD_LABELS } from '@/features/dashboard/hooks/useDashboardMetrics';

interface PeriodFilterSelectProps {
    value: PeriodFilter;
    onChange: (period: PeriodFilter) => void;
    className?: string;
    'aria-label'?: string;
}

/**
 * Componente de seleção de período compartilhado.
 * Usado em Dashboard, Reports e outras páginas que precisam filtrar por período.
 */
export const PeriodFilterSelect: React.FC<PeriodFilterSelectProps> = ({
    value,
    onChange,
    className = '',
    'aria-label': ariaLabel = 'Selecionar Período',
}) => {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as PeriodFilter)}
            aria-label={ariaLabel}
            className={`px-3 py-2 bg-white dark:bg-surface border border-slate-200 dark:border-line rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 ${className}`}
        >
            {Object.entries(PERIOD_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                    {label}
                </option>
            ))}
        </select>
    );
};

export default PeriodFilterSelect;
