import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// Map Tailwind bg-color classes to hex values for Tailwind v4 compatibility
const colorToHex: Record<string, string> = {
    'bg-blue-500': '#3b82f6',
    'bg-purple-500': '#a855f7',
    'bg-emerald-500': '#10b981',
    'bg-orange-500': '#f97316',
    'bg-green-500': '#22c55e',
    'bg-red-500': '#ef4444',
    'bg-yellow-500': '#eab308',
    'bg-cyan-500': '#06b6d4',
    'bg-pink-500': '#ec4899',
    'bg-indigo-500': '#6366f1',
    'bg-teal-500': '#14b8a6',
    'bg-amber-500': '#f59e0b',
};

interface StatCardProps {
    title: string;
    value: string;
    subtext: string;
    subtextPositive?: boolean;
    icon: React.ElementType;
    color: string;
    onClick?: () => void;
    comparisonLabel?: string;
}

/**
 * Componente React `StatCard`.
 *
 * @param {StatCardProps} {
    title,
    value,
    subtext,
    subtextPositive = true,
    icon: Icon,
    color,
    onClick,
    comparisonLabel = 'vs período anterior'
} - Parâmetro `{
    title,
    value,
    subtext,
    subtextPositive = true,
    icon: Icon,
    color,
    onClick,
    comparisonLabel = 'vs período anterior'
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    subtext,
    subtextPositive = true,
    icon: Icon,
    color,
    onClick,
    comparisonLabel = 'vs período anterior'
}) => {
    const TrendIcon = subtextPositive ? TrendingUp : TrendingDown;
    const trendColorClass = subtextPositive
        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
        : 'bg-red-500/10 text-red-600 dark:text-red-400';

    // Get hex color for inline styles (Tailwind v4 doesn't support bg-opacity-* or dynamic classes)
    const hexColor = colorToHex[color] || '#3b82f6';

    // Background: 10% opacity (hex alpha = 1A), Dark mode: 20% (hex alpha = 33)
    const bgColorLight = `${hexColor}1A`;
    const bgColorDark = `${hexColor}33`;

    return (
        <div
            onClick={onClick}
            className={`glass p-6 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm relative overflow-hidden group ${onClick ? 'cursor-pointer hover:border-brand-500/50 transition-colors' : ''}`}
        >
            <div className={`absolute top-0 right-0 p-20 rounded-full blur-3xl opacity-10 -mr-10 -mt-10 transition-opacity group-hover:opacity-20 ${color}`}></div>

            <div className="flex justify-between items-start relative z-10">
                <div>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 font-display">{title}</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">{value}</p>
                </div>
                <div
                    className="p-3 rounded-xl ring-1 ring-inset ring-white/10"
                    style={{
                        backgroundColor: bgColorLight,
                    }}
                >
                    <Icon
                        size={20}
                        color={hexColor}
                        strokeWidth={2}
                    />
                </div>
            </div>
            <p className="text-xs text-slate-500 mt-3 flex items-center gap-1 relative z-10">
                <span className={`${trendColorClass} px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-1`}>
                    <TrendIcon size={10} strokeWidth={2} /> {subtext}
                </span>
                <span className="ml-1 dark:text-slate-500">{comparisonLabel}</span>
            </p>
        </div>
    );
};
