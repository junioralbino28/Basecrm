import React, { useMemo, useState } from 'react';
import { Stethoscope, Pencil, Plus, Save, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react';
import type { Professional } from '@/types';
import {
  useProfessionals,
  useCreateProfessional,
  useUpdateProfessional,
  useDeleteProfessional,
} from '@/lib/query/hooks/useProfessionalsQuery';

/**
 * Componente React `ProfessionalsManager`.
 * Gestão de profissionais (dentistas). Só clinic_admin/agency_admin enxerga esta tela
 * (gate canManageSettings no SettingsPage); a RLS bloqueia mutação de clinic_staff.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const ProfessionalsManager: React.FC = () => {
  const { data, isLoading, error } = useProfessionals();
  const createMutation = useCreateProfessional();
  const updateMutation = useUpdateProfessional();
  const deleteMutation = useDeleteProfessional();

  const professionals = useMemo(() => data ?? [], [data]);

  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');

  const canCreate = name.trim().length > 1;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpecialty, setEditSpecialty] = useState('');

  const sorted = useMemo(() => {
    const list = [...professionals];
    list.sort((a, b) => {
      const aActive = a.active !== false;
      const bActive = b.active !== false;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return list;
  }, [professionals]);

  const create = async () => {
    if (!canCreate) return;
    setFormError(null);
    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        specialty: specialty.trim() || undefined,
        active: true,
      });
      setName('');
      setSpecialty('');
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const toggleActive = async (p: Professional, next: boolean) => {
    setFormError(null);
    try {
      await updateMutation.mutateAsync({ id: p.id, updates: { active: next } });
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const startEdit = (p: Professional) => {
    setEditingId(p.id);
    setEditName(p.name || '');
    setEditSpecialty(p.specialty || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditSpecialty('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const nextName = editName.trim();
    if (nextName.length < 2) {
      setFormError('Nome inválido.');
      return;
    }
    setFormError(null);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        updates: { name: nextName, specialty: editSpecialty.trim() || undefined },
      });
      cancelEdit();
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const remove = async (p: Professional) => {
    const ok = window.confirm(`Excluir "${p.name}"? Atendimentos históricos não são removidos.`);
    if (!ok) return;
    setFormError(null);
    try {
      await deleteMutation.mutateAsync(p.id);
    } catch (e) {
      setFormError((e as Error).message);
    }
  };

  const busy = isLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const displayError = formError || (error ? (error as Error).message : null);

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
              <Stethoscope className="h-5 w-5" /> Profissionais
            </h3>
            <p className="text-sm text-muted">
              Cadastre os profissionais (dentistas) da clínica. O catálogo de procedimentos é gerenciado na aba Produtos/Serviços.
            </p>
          </div>
        </div>

        {displayError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {displayError}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold text-muted mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Dra. Jéssica"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-4">
            <label className="block text-xs font-semibold text-muted mb-1">Especialidade (opcional)</label>
            <input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Ex.: Ortodontia"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Adicionar profissional"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-line pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-muted py-6">
              Nenhum profissional cadastrado ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((p) => {
                const isActive = p.active !== false;
                const isEditing = editingId === p.id;
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      {isEditing ? (
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                          <div className="sm:col-span-6">
                            <label className="block text-[11px] font-semibold text-muted mb-1">Nome</label>
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                          </div>
                          <div className="sm:col-span-6">
                            <label className="block text-[11px] font-semibold text-muted mb-1">Especialidade</label>
                            <input
                              value={editSpecialty}
                              onChange={(e) => setEditSpecialty(e.target.value)}
                              className="w-full px-3 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-ink truncate">{p.name}</div>
                            {!isActive && (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface text-muted">
                                Inativo
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted mt-0.5 truncate">
                            {p.specialty ? p.specialty : 'Sem especialidade'}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Salvar"
                            aria-label="Salvar alterações"
                            disabled={busy}
                          >
                            <Save className="h-4 w-4 text-brand-600" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Cancelar"
                            aria-label="Cancelar edição"
                            disabled={busy}
                          >
                            <X className="h-4 w-4 text-muted" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(p)}
                          className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                          title="Editar"
                          aria-label="Editar profissional"
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 text-muted" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(p, !isActive)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                        title={isActive ? 'Desativar' : 'Ativar'}
                        aria-label={isActive ? 'Desativar profissional' : 'Ativar profissional'}
                        disabled={busy}
                      >
                        {isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-red-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir profissional"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
