import React from 'react';
import { Plus } from 'lucide-react';
import { useAtendimentosController } from './hooks/useAtendimentosController';
import { AtendimentosList } from './components/AtendimentosList';
import { AtendimentoFormModal } from './components/AtendimentoFormModal';

/**
 * Página de Atendimentos: registra procedimentos realizados e o recebimento.
 * Faturamento conta SÓ quando recebido = true (toggle do drawer).
 */
export const AtendimentosPage: React.FC = () => {
  const {
    searchTerm,
    setSearchTerm,
    isModalOpen,
    setIsModalOpen,
    editing,
    formData,
    setFormData,
    filteredAtendimentos,
    deals,
    professionals,
    products,
    isLoading,
    handleNew,
    handleEdit,
    handleDelete,
    handleSubmit,
  } = useAtendimentosController();

  return (
    <div className="p-8 max-w-400 mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink font-display">
          Atendimentos
        </h1>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-brand-600/20 transition-all"
        >
          <Plus size={18} />
          Novo Atendimento
        </button>
      </div>

      <div className="mb-4">
        <input
          type="search"
          aria-label="Buscar por procedimento"
          placeholder="Buscar por procedimento..."
          className="w-full max-w-sm h-11 px-3 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <AtendimentosList
        atendimentos={filteredAtendimentos}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <AtendimentoFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        editing={editing}
        deals={deals}
        professionals={professionals}
        products={products}
      />
    </div>
  );
};
