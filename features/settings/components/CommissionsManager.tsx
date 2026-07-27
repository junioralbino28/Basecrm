import React, { useMemo, useState } from 'react';
import { Percent, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { CommissionAmountType, CommissionRule } from '@/types';
import { formatBRL } from '@/lib/utils';
import {
  useCommissionRules,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
} from '@/lib/query/hooks/useCommissionRulesQuery';
import { useProfessionals } from '@/lib/query/hooks/useProfessionalsQuery';
import { useProducts } from '@/lib/query/hooks/useProductsQuery';
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
  // A comissão é POR PROCEDIMENTO (Junior, 24/07) — a lista vem do catálogo em
  // Configurações → Produtos/Serviços, nunca digitada à mão (evita erro de grafia
  // que faria a regra nunca casar com o atendimento).
  const { data: productsData } = useProducts();
  const createMutation = useCreateCommissionRule();
  const updateMutation = useUpdateCommissionRule();
  const deleteMutation = useDeleteCommissionRule();
  const { showToast } = useToast();

  const rules = useMemo(() => data ?? [], [data]);
  const professionals = useMemo(() => professionalsData ?? [], [professionalsData]);
  const products = useMemo(() => productsData ?? [], [productsData]);

  const [professionalId, setProfessionalId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [percent, setPercent] = useState<string>('0');
  const [procedimento, setProcedimento] = useState('');
  const [amountType, setAmountType] = useState<CommissionAmountType>('percent');

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
  }, [rules, professionals]);

  const create = async () => {
    if (!canCreate) return;

    // Valida (e coage percent) com o schema ANTES de montar o payload.
    const parsed = commissionRuleFormSchema.safeParse({
      professionalId,
      specialty: specialty.trim(),
      // O schema valida 0–100; em valor fixo o teto não se aplica, então
      // validamos só o formato aqui e o valor vai direto.
      percent: amountType === 'percent' ? percent : '0',
    });
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Dados da comissão inválidos', 'error');
      return;
    }

    try {
      await createMutation.mutateAsync({
        professionalId: parsed.data.professionalId,
        specialty: parsed.data.specialty || undefined,
        procedimento: procedimento.trim() || undefined,
        amountType,
        amount: Number(percent.replace(',', '.')) || 0,
      });
      setProfessionalId('');
      setSpecialty('');
      setPercent('0');
      setProcedimento('');
      setAmountType('percent');
    } catch (e) {
      showToast(`Erro ao criar regra de comissão: ${(e as Error).message}`, 'error');
    }
  };

  const startEdit = (r: CommissionRule) => {
    setEditingId(r.id);
    setEditPercent(String(r.amount ?? r.percent ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPercent('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const base = rules.find((r) => r.id === editingId);
    if (!base) return;
    const novoValor = Number(editPercent.replace(',', '.'));
    if (!Number.isFinite(novoValor) || novoValor < 0) {
      showToast('Valor inválido.', 'error');
      return;
    }
    if (base.amountType === 'percent' && novoValor > 100) {
      showToast('Percentual não pode passar de 100.', 'error');
      return;
    }
    try {
      // ⚠️ NÃO edita a regra anterior — CRIA outra com a data de HOJE.
      // É isso que faz o passado continuar valendo o que já foi pago
      // (decisão do Junior, 24/07). Sem data de fim: vale até a próxima.
      await createMutation.mutateAsync({
        professionalId: base.professionalId,
        specialty: base.specialty || undefined,
        procedimento: base.procedimento || undefined,
        amountType: base.amountType,
        amount: novoValor,
      });
      showToast('Novo valor vale de hoje em diante. O que já passou não muda.', 'success');
      cancelEdit();
    } catch (e) {
      showToast(`Erro ao alterar comissão: ${(e as Error).message}`, 'error');
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
              Quanto cada pessoa ganha por atendimento — em porcentagem ou em valor fixo.
              Ao alterar, o novo valor passa a valer <strong>de hoje em diante</strong>;
              o que já passou continua como foi pago.
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
          <div className="lg:col-span-5">
            <label className="block text-xs font-semibold text-muted mb-1">
              Só para um procedimento (opcional)
            </label>
            <select
              aria-label="Procedimento da comissão"
              value={procedimento}
              onChange={(e) => setProcedimento(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="">Vale para todos os procedimentos</option>
              {products.map((prod) => (
                <option key={prod.id} value={prod.name}>{prod.name}</option>
              ))}
            </select>
            {products.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Nenhum procedimento cadastrado ainda — cadastre em Produtos/Serviços.
              </p>
            )}
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
            <select
              aria-label="Tipo da comissão"
              value={amountType}
              onChange={(e) => setAmountType(e.target.value as CommissionAmountType)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="percent">Porcentagem (%)</option>
              <option value="fixed">Valor fixo (R$)</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">
              {amountType === 'fixed' ? 'Valor (R$)' : 'Comissão (%)'}
            </label>
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
                        {r.procedimento ? `${r.procedimento} • ` : ''}
                        {r.specialty ? `${r.specialty} • ` : ''}
                        {isEditing ? '' : (
                          <span className="font-semibold text-ink">
                            {r.amountType === 'fixed'
                              ? `${formatBRL(r.amount)} por atendimento`
                              : `${r.amount}%`}
                          </span>
                        )}
                        {!isEditing && r.validFrom && r.validFrom > '1900-01-01' && (
                          <span className="ml-2">
                            vale desde {new Date(`${r.validFrom}T12:00:00`).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editPercent}
                            onChange={(e) => setEditPercent(e.target.value)}
                            inputMode="decimal"
                            aria-label="Novo valor da comissão"
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
