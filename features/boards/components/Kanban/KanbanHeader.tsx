import React from 'react';
import { Plus, Search, LayoutGrid, Table as TableIcon, User, Settings, Lightbulb, Download, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Board } from '@/types';
import { BoardSelector } from '../BoardSelector';

/**
 * Dropdown de filtro não-nativo (tokens do tema).
 * Substitui o <select> nativo, cujo popup do browser renderizava branco-sobre-branco
 * (ilegível) no modo escuro. Mesma linguagem visual do switch de clínica.
 */
function FilterSelect<T extends string>({
    value,
    onChange,
    options,
    ariaLabel,
    leading,
}: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
    ariaLabel: string;
    leading?: React.ReactNode;
}) {
    const [open, setOpen] = React.useState(false);
    const current = options.find((option) => option.value === value);

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none transition hover:border-brand-400 focus:ring-2 focus:ring-brand-500"
            >
                {leading}
                <span className="whitespace-nowrap">{current?.label}</span>
                <ChevronDown size={14} className="text-faint" aria-hidden="true" />
            </button>
            {open ? (
                <>
                    <button
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div
                        role="listbox"
                        className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-soft"
                    >
                        {options.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={option.value === value}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                                    option.value === value
                                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                                        : 'text-ink hover:bg-surface'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
}

interface KanbanHeaderProps {
    clinicSwitcher?: React.ReactNode;
    // Boards
    boards: Board[];
    activeBoard: Board;
    onSelectBoard: (id: string) => void;
    onCreateBoard: () => void;
    onEditBoard?: (board: Board) => void;
    onDeleteBoard?: (id: string) => void;
    onExportTemplates?: () => void;
    // View
    viewMode: 'kanban' | 'list';
    setViewMode: (mode: 'kanban' | 'list') => void;
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    ownerFilter: 'all' | 'mine';
    setOwnerFilter: (filter: 'all' | 'mine') => void;
    statusFilter: 'open' | 'won' | 'lost' | 'all';
    setStatusFilter: (filter: 'open' | 'won' | 'lost' | 'all') => void;
    onNewDeal: () => void;
}

/**
 * Componente React `KanbanHeader`.
 *
 * @param {KanbanHeaderProps} {
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    onNewDeal
} - Parâmetro `{
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    onNewDeal
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const KanbanHeader: React.FC<KanbanHeaderProps> = ({
    clinicSwitcher,
    boards,
    activeBoard,
    onSelectBoard,
    onCreateBoard,
    onEditBoard,
    onDeleteBoard,
    onExportTemplates,
    viewMode, setViewMode,
    searchTerm, setSearchTerm,
    ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter,
    onNewDeal
}) => {
    return (
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
            <div className="flex items-center gap-4 w-full sm:w-auto flex-wrap">
                {clinicSwitcher}

                {/* Board Selector */}
                <BoardSelector
                    boards={boards}
                    activeBoard={activeBoard}
                    onSelectBoard={onSelectBoard}
                    onCreateBoard={onCreateBoard}
                    onEditBoard={onEditBoard}
                    onDeleteBoard={onDeleteBoard}
                />

                {/* Edit Board Button */}
                {onEditBoard && (
                    <button
                        onClick={() => onEditBoard(activeBoard)}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        title="Configurações do Board"
                    >
                        <Settings size={20} />
                    </button>
                )}

                {/* Export Template Button */}
                {onExportTemplates && (
                    <button
                        onClick={onExportTemplates}
                        className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                        title="Exportar template (comunidade)"
                    >
                        <Download size={20} />
                    </button>
                )}

                {/* Automation Guide Button */}
                {activeBoard.automationSuggestions && activeBoard.automationSuggestions.length > 0 && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button
                                className="p-2 text-yellow-600 hover:text-yellow-700 dark:text-yellow-400 dark:hover:text-yellow-300 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 rounded-lg transition-colors relative group"
                                title="Automações Sugeridas"
                            >
                                <Lightbulb size={20} className="fill-current" />
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                            <div className="p-4 border-b border-slate-100 dark:border-white/10 bg-slate-50 dark:bg-card/50">
                                <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                    <Lightbulb size={16} className="text-yellow-500" />
                                    Automações Sugeridas
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Dicas da IA para otimizar este processo.
                                </p>
                            </div>
                            <div className="p-2">
                                <ul className="space-y-1">
                                    {activeBoard.automationSuggestions.map((suggestion, idx) => (
                                        <li key={idx} className="text-sm text-slate-700 dark:text-slate-300 p-2 hover:bg-slate-50 dark:hover:bg-white/5 rounded-md flex gap-2 items-start">
                                            <span className="text-slate-400 mt-0.5">•</span>
                                            <span>{suggestion}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </PopoverContent>
                    </Popover>
                )}

                {/* VIEW TOGGLE */}
                <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-lg border border-slate-200 dark:border-white/10">
                    <button
                        onClick={() => setViewMode('kanban')}
                        aria-label="Visualização em quadro Kanban"
                        aria-pressed={viewMode === 'kanban'}
                        className={`p-1.5 rounded-md transition-all ${viewMode === 'kanban' ? 'bg-white dark:bg-surface shadow-sm text-brand-600 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <LayoutGrid size={16} aria-hidden="true" />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        aria-label="Visualização em lista"
                        aria-pressed={viewMode === 'list'}
                        className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-surface shadow-sm text-brand-600 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                        <TableIcon size={16} aria-hidden="true" />
                    </button>
                </div>

                <div className="h-8 w-px bg-slate-200 dark:bg-white/10 mx-2 hidden sm:block"></div>
                <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                        type="text"
                        placeholder="Filtrar pacientes ou empresas..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-line bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white backdrop-blur-sm"
                    />
                </div>
                <FilterSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    ariaLabel="Filtrar por status"
                    leading={
                        <span
                            className={`h-2 w-2 rounded-full ${statusFilter === 'open' ? 'bg-blue-500' :
                                statusFilter === 'won' ? 'bg-green-500' :
                                    statusFilter === 'lost' ? 'bg-red-500' : 'bg-slate-400'
                                }`}
                        />
                    }
                    options={[
                        { value: 'open', label: 'Em Aberto' },
                        { value: 'won', label: 'Ganhos' },
                        { value: 'lost', label: 'Perdidos' },
                        { value: 'all', label: 'Todos' },
                    ]}
                />

                <FilterSelect
                    value={ownerFilter}
                    onChange={setOwnerFilter}
                    ariaLabel="Filtrar pacientes por proprietário"
                    leading={<User size={14} className="text-faint" aria-hidden="true" />}
                    options={[
                        { value: 'all', label: 'Todos os Donos' },
                        { value: 'mine', label: 'Meus Pacientes' },
                    ]}
                />
            </div>

            <div className="flex gap-3">
                <button
                    onClick={onNewDeal}
                    className="bg-brand-700 hover:bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-brand-700/20"
                >
                    <Plus size={18} aria-hidden="true" /> Novo Paciente
                </button>
            </div>
        </div>
    );
};
