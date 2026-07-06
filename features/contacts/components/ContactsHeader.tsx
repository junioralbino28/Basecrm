import React from 'react';
import { Search, Filter, Plus, Download } from 'lucide-react';

interface ContactsHeaderProps {
  viewMode: 'people' | 'companies';
  search: string;
  setSearch: (value: string) => void;
  statusFilter: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'CHURNED' | 'RISK';
  setStatusFilter: (value: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'CHURNED' | 'RISK') => void;
  isFilterOpen: boolean;
  setIsFilterOpen: (value: boolean) => void;
  openCreateModal: () => void;
  openImportExportModal?: () => void;
}

/**
 * Componente React `ContactsHeader`.
 *
 * @param {ContactsHeaderProps} {
  viewMode,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  isFilterOpen,
  setIsFilterOpen,
  openCreateModal,
} - Parâmetro `{
  viewMode,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  isFilterOpen,
  setIsFilterOpen,
  openCreateModal,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ContactsHeader: React.FC<ContactsHeaderProps> = ({
  viewMode,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  isFilterOpen,
  setIsFilterOpen,
  openCreateModal,
  openImportExportModal,
}) => {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
          {viewMode === 'people' ? 'Contatos (Pessoas)' : 'Empresas (Contas)'}
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {viewMode === 'people'
            ? 'Pessoas com quem você negocia.'
            : 'Organizações onde seus contatos trabalham.'}
        </p>
      </div>
      <div className="flex gap-3 w-full sm:w-auto">
        {viewMode === 'people' && (
          <select
            value={statusFilter}
            onChange={e =>
              setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE' | 'CHURNED' | 'RISK')
            }
            aria-label="Filtrar por status"
            className="pl-3 pr-8 py-2 rounded-lg border border-slate-200 dark:border-line bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white backdrop-blur-sm appearance-none cursor-pointer"
          >
            <option value="ALL">Todos os Status</option>
            <option value="ACTIVE">Ativos</option>
            <option value="INACTIVE">Inativos</option>
            <option value="CHURNED">Perdidos (Churn)</option>
            <option value="RISK">Em Risco (Alerta)</option>
          </select>
        )}
        <div className="relative flex-1 sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder={
              viewMode === 'people' ? 'Buscar nomes, emails...' : 'Buscar empresas, setor...'
            }
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-line bg-white/50 dark:bg-white/5 text-sm outline-none focus:ring-2 focus:ring-brand-500 dark:text-white backdrop-blur-sm"
          />
        </div>
        <button
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          aria-label={isFilterOpen ? 'Fechar filtros avançados' : 'Abrir filtros avançados'}
          aria-expanded={isFilterOpen}
          className={`p-2 border rounded-lg transition-colors ${isFilterOpen ? 'bg-brand-50 border-brand-200 text-brand-600' : 'bg-white dark:bg-white/5 border-slate-200 dark:border-line text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/10'}`}
        >
          <Filter size={20} aria-hidden="true" />
        </button>
        {viewMode === 'people' && (
          <button
            type="button"
            onClick={openImportExportModal}
            aria-label="Importar/Exportar contatos"
            className="p-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-line rounded-lg hover:bg-slate-50 dark:hover:bg-white/10 text-slate-600 dark:text-slate-400 transition-colors"
          >
            <Download size={20} aria-hidden="true" />
          </button>
        )}
        <button
          onClick={openCreateModal}
          className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-brand-600/20"
        >
          <Plus size={18} /> {viewMode === 'people' ? 'Novo Contato' : 'Nova Empresa'}
        </button>
      </div>
    </div>
  );
};
