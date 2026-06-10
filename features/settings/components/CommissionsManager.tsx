import React, { useMemo, useState } from 'react';
import { Percent, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { CommissionRule } from '@/types';
import {
  useCommissionRules,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
} from '@/lib/query/hooks/useCommissionRulesQuery';
import { useProfessionals } from '@/lib/query/hooks/useProfessionalsQuery';
import { commissionRuleFormSchema, percentSchema } from '@/lib/validations/schemas';
import { useToast } from '@/context/ToastContext';

/**
 * Componente React `CommissionsManager`.
 * Regras de comissão por dentista × especialidade (config financeira). Só
 * clinic_admin/agency_admin enxerga (gate canManageSettings); a RLS
 * can_configure bloqueia SELECT e mutação de clinic_staff.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CommissionsManager: React.FC = () => {
  const { data, isLoading, error } = useCommissionRules();
  const { data: professionalsData, isLoading: professionalsLoading } = useProfessionals();
  const createMutation = useCreateCommissionRule();
  const updateMutation = useUpdateCommissionRule();
  const deleteMutation = useDeleteCommissionRule();
  const { showToast } = useToast();

  const rules = useMemo(() => data ?? [], [data]);
  const professionals = useMemo(() => professionalsData ?? [], [professionalsData]);

  const [professionalId, setProfessionalId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [percent, setPercent] = useState<string>('0');

  const canCreate = professionalId.trim().length > 0;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPercent, setEditPercent] = useState<string>('0');

  const professionalName = (id?: string) =>
    professionals.find((p) => p.id === id)?.name ?? 'Profissional';

  const sorted = useMemo(() => {
    const list = [...rules];
    list.sort((a, b) =>
      professionalName(a.professionalId).localeCompare(professionalName(b.professionalId))
    );
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, professionals]);

  const create = async () => {
    if (!canCreate) return;

    // Valida (e coage percent) com o schema ANTES de montar o payload.
    const parsed = commissionRuleFormSchema.safeParse({
      professionalId,
      specialty: specialty.trim(),
      percent,
    });
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Dados da comissão inválidos', 'error');
      return;
    }

    try {
      await createMutation.mutateAsync({
        professionalId: parsed.data.professionalId,
        specialty: parsed.data.specialty || undefined,
        percent: parsed.data.percent,
      });
      setProfessionalId('');
      setSpecialty('');
      setPercent('0');
    } catch (e) {
      showToast(`Erro ao criar regra de comissão: ${(e as Error).message}`, 'error');
    }
  };

  const startEdit = (r: CommissionRule) => {
    setEditingId(r.id);
    setEditPercent(String(r.percent ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPercent('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const parsed = percentSchema.safeParse(editPercent);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Percentual inválido', 'error');
      return;
    }
    try {
      // Edição parcial: SÓ percent — profissional/especialidade ficam intocados.
      await updateMutation.mutateAsync({ id: editingId, updates: { percent: parsed.data } });
      cancelEdit();
    } catch (e) {
      showToast(`Erro ao atualizar comissão: ${(e as Error).message}`, 'error');
    }
  };

  const remove = async (r: CommissionRule) => {
    const ok = window.confirm(`Excluir a regra de comissão de "${professionalName(r.professionalId)}"?`);
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(r.id);
    } catch (e) {
      showToast(`Erro ao excluir regra de comissão: ${(e as Error).message}`, 'error');
    }
  };

  const busy =
    isLoading ||
    professionalsLoading ||
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;
  const loadError = error ? (error as Error).message : null;

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
              <Percent className="h-5 w-5" /> Comissões
            </h3>
            <p className="text-sm text-muted">
              Percentual de comissão por profissional e especialidade. Usado no relatório de comissões.
            </p>
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
            {loadError}
          </div>
        )}

        {/* Create */}
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5">
            <label className="block text-xs font-semibold text-muted mb-1">Profissional</label>
            <select
              aria-label="Profissional"
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="">Selecione…</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
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
            <label className="block text-xs font-semibold text-muted mb-1">Comissão (%)</label>
            <input
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              inputMode="decimal"
              aria-label="Comissão (%)"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar regra"
            >
              <Plus className="h-4 w-4" />
              Criar
            </button>
          </div>
        </div>

        {/* List */}
        <div className="mt-6 border-t border-line pt-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-muted py-6">
              Nenhuma regra de comissão cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink truncate">
                        {professionalName(r.professionalId)}
                      </div>
                      <div className="text-xs text-muted mt-0.5 truncate">
                        {r.specialty ? `${r.specialty} • ` : ''}{isEditing ? '' : `${r.percent}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editPercent}
                            onChange={(e) => setEditPercent(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar comissão (%)"
                            className="w-20 px-2 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Salvar"
                            aria-label="Salvar comissão"
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
                          onClick={() => startEdit(r)}
                          className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                          title="Editar"
                          aria-label="Editar comissão"
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 text-muted" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir comissão"
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
