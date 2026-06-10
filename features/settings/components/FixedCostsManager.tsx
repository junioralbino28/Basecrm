import React, { useMemo, useState } from 'react';
import { Wallet, Pencil, Plus, Save, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import type { FixedCost } from '@/types';
import {
  useFixedCosts,
  useCreateFixedCost,
  useUpdateFixedCost,
  useDeleteFixedCost,
} from '@/lib/query/hooks/useFixedCostsQuery';
import { fixedCostFormSchema, currencySchema } from '@/lib/validations/schemas';
import { useToast } from '@/context/ToastContext';

function formatBRL(v: number) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  } catch {
    return `R$ ${v.toFixed(2)}`;
  }
}

/**
 * Componente React `FixedCostsManager`.
 * Contas fixas mensais (config financeira). Só clinic_admin/agency_admin
 * enxerga (gate canManageSettings); a RLS can_configure bloqueia SELECT e
 * mutação de clinic_staff.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const FixedCostsManager: React.FC = () => {
  const { data, isLoading, error } = useFixedCosts();
  const createMutation = useCreateFixedCost();
  const updateMutation = useUpdateFixedCost();
  const deleteMutation = useDeleteFixedCost();
  const { showToast } = useToast();

  const costs = useMemo(() => data ?? [], [data]);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState<string>('0');
  const [dueDay, setDueDay] = useState<string>('');

  const canCreate = name.trim().length > 1;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('0');

  const sorted = useMemo(() => {
    const list = [...costs];
    list.sort((a, b) => {
      const aActive = a.active !== false;
      const bActive = b.active !== false;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
    return list;
  }, [costs]);

  const create = async () => {
    if (!canCreate) return;

    // Valida (e coage valor/dia) com o schema ANTES de montar o payload.
    const parsed = fixedCostFormSchema.safeParse({
      name: name.trim(),
      amount,
      dueDay: dueDay.trim() ? dueDay : undefined,
    });
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Dados da conta inválidos', 'error');
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: parsed.data.name,
        amount: parsed.data.amount,
        dueDay: parsed.data.dueDay,
      });
      setName('');
      setAmount('0');
      setDueDay('');
    } catch (e) {
      showToast(`Erro ao criar conta fixa: ${(e as Error).message}`, 'error');
    }
  };

  const toggleActive = async (c: FixedCost, next: boolean) => {
    try {
      // Edição parcial: SÓ active — nome/valor/vencimento ficam intocados.
      await updateMutation.mutateAsync({ id: c.id, updates: { active: next } });
    } catch (e) {
      showToast(`Erro ao ${next ? 'ativar' : 'desativar'} conta: ${(e as Error).message}`, 'error');
    }
  };

  const startEdit = (c: FixedCost) => {
    setEditingId(c.id);
    setEditAmount(String(c.amount ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const parsed = currencySchema.safeParse(editAmount);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Valor inválido', 'error');
      return;
    }
    try {
      // Edição parcial: SÓ amount — demais campos da conta ficam intocados.
      await updateMutation.mutateAsync({ id: editingId, updates: { amount: parsed.data } });
      cancelEdit();
    } catch (e) {
      showToast(`Erro ao atualizar conta: ${(e as Error).message}`, 'error');
    }
  };

  const remove = async (c: FixedCost) => {
    const ok = window.confirm(`Excluir a conta "${c.name}"?`);
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(c.id);
    } catch (e) {
      showToast(`Erro ao excluir conta: ${(e as Error).message}`, 'error');
    }
  };

  const busy = isLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const loadError = error ? (error as Error).message : null;

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Contas Fixas
            </h3>
            <p className="text-sm text-muted">
              Custos fixos mensais. Subtraídos do resultado líquido do período.
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
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold text-muted mb-1">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Aluguel, Folha, Software…"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold text-muted mb-1">Valor (R$)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Valor (R$)"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">Dia venc. (opcional)</label>
            <input
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              inputMode="numeric"
              placeholder="10"
              aria-label="Dia de vencimento"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar conta"
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
              Nenhuma conta fixa cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((c) => {
                const isActive = c.active !== false;
                const isEditing = editingId === c.id;
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-ink truncate">{c.name}</div>
                        {!isActive && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface text-muted">
                            Inativa
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted mt-0.5 truncate">
                        {isEditing ? '' : formatBRL(c.amount)}{c.dueDay ? ` • vence dia ${c.dueDay}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar valor (R$)"
                            className="w-24 px-2 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Salvar"
                            aria-label="Salvar conta"
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
                          onClick={() => startEdit(c)}
                          className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                          title="Editar"
                          aria-label="Editar conta"
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 text-muted" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(c, !isActive)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                        title={isActive ? 'Desativar' : 'Ativar'}
                        aria-label={isActive ? 'Desativar conta' : 'Ativar conta'}
                        disabled={busy}
                      >
                        {isActive ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-red-500" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir conta"
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
