import React from 'react';

interface ContactsFiltersProps {
    dateRange: { start: string; end: string };
    setDateRange: (range: { start: string; end: string }) => void;
}

/**
 * Componente React `ContactsFilters`.
 *
 * @param {ContactsFiltersProps} { dateRange, setDateRange } - Parâmetro `{ dateRange, setDateRange }`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsFilters: React.FC<ContactsFiltersProps> = ({ dateRange, setDateRange }) => {
    return (
        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-4 animate-in slide-in-from-top-2">
            <div className="flex flex-wrap gap-4 items-end">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data de Criação (Início)</label>
                    <input
                        type="date"
                        className="bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white"
                        value={dateRange.start}
                        onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data de Criação (Fim)</label>
                    <input
                        type="date"
                        className="bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white"
                        value={dateRange.end}
                        onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                    />
                </div>
                {(dateRange.start || dateRange.end) && (
                    <button
                        onClick={() => setDateRange({ start: '', end: '' })}
                        className="text-sm text-red-500 hover:text-red-600 font-medium px-2 py-2"
                    >
                        Limpar Filtros
                    </button>
                )}
            </div>
        </div>
    );
};
