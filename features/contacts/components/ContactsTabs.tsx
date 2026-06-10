import React from 'react';
import { User, Building2 } from 'lucide-react';

interface ContactsTabsProps {
    viewMode: 'people' | 'companies';
    setViewMode: (mode: 'people' | 'companies') => void;
    contactsCount: number;
    companiesCount: number;
}

/**
 * Componente React `ContactsTabs`.
 *
 * @param {ContactsTabsProps} {
    viewMode,
    setViewMode,
    contactsCount,
    companiesCount
} - Parâmetro `{
    viewMode,
    setViewMode,
    contactsCount,
    companiesCount
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsTabs: React.FC<ContactsTabsProps> = ({
    viewMode,
    setViewMode,
    contactsCount,
    companiesCount
}) => {
    return (
        <div className="border-b border-slate-200 dark:border-white/10">
            <div className="flex gap-6">
                <button
                    onClick={() => setViewMode('people')}
                    className={`flex items-center gap-2 pb-3 text-sm font-bold border-b-2 transition-colors ${viewMode === 'people'
                        ? 'border-brand-500 text-brand-600 dark:text-white'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                >
                    <User size={16} /> Pessoas
                    <span className="ml-1 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-xs">
                        {contactsCount}
                    </span>
                </button>
                <button
                    onClick={() => setViewMode('companies')}
                    className={`flex items-center gap-2 pb-3 text-sm font-bold border-b-2 transition-colors ${viewMode === 'companies'
                        ? 'border-brand-500 text-brand-600 dark:text-white'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                >
                    <Building2 size={16} /> Empresas
                    <span className="ml-1 bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-xs">
                        {companiesCount}
                    </span>
                </button>
            </div>
        </div>
    );
};
