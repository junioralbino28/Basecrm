import React, { useMemo, useState } from 'react';
import { CreditCard, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { PaymentMethodFee, PaymentType } from '@/types';
import {
  usePaymentMethodFees,
  useCreatePaymentMethodFee,
  useUpdatePaymentMethodFee,
  useDeletePaymentMethodFee,
} from '@/lib/query/hooks/usePaymentMethodFeesQuery';
import { paymentMethodFeeFormSchema, percentSchema } from '@/lib/validations/schemas';
import { CARD_BRAND_OPTIONS } from '@/lib/constants/cardBrands';
import { useToast } from '@/context/ToastContext';

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'pix', label: 'Pix' },
  { value: 'dinheiro', label: 'Dinheiro' },
];

function paymentTypeLabel(t: PaymentType) {
  return PAYMENT_TYPES.find((p) => p.value === t)?.label ?? t;
}

function isCardPayment(t: PaymentType) {
  return t === 'credito' || t === 'debito';
}

/**
 * Componente React `CardFeesManager`.
 * Taxas por meio de pagamento (config financeira). Só clinic_admin/agency_admin
 * enxerga esta tela (gate canManageSettings no SettingsPage); a RLS can_configure
 * bloqueia SELECT e mutação de clinic_staff — Vitória não lê margem.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CardFeesManager: React.FC = () => {
  const { data, isLoading, error } = usePaymentMethodFees();
  const createMutation = useCreatePaymentMethodFee();
  const updateMutation = useUpdatePaymentMethodFee();
  const deleteMutation = useDeletePaymentMethodFee();
  const { showToast } = useToast();

  const fees = useMemo(() => data ?? [], [data]);

  const [label, setLabel] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('credito');
  const [cardBrand, setCardBrand] = useState('');
  const [installments, setInstallments] = useState<string>('1');
  const [feePercent, setFeePercent] = useState<string>('0');

  const canCreate = label.trim().length > 1;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFeePercent, setEditFeePercent] = useState<string>('0');

  const sorted = useMemo(() => {
    const list = [...fees];
    list.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    return list;
  }, [fees]);

  const handlePaymentTypeChange = (next: PaymentType) => {
    setPaymentType(next);
    // Bandeira/parcelas só fazem sentido em cartão (lição F4: zera no onChange).
    if (!isCardPayment(next)) {
      setCardBrand('');
      setInstallments('1');
    }
  };

  const create = async () => {
    if (!canCreate) return;

    // Valida (e coage parcelas/taxa) com o schema ANTES de montar o payload.
    const parsed = paymentMethodFeeFormSchema.safeParse({
      label: label.trim(),
      paymentType,
      cardBrand: cardBrand.trim(),
      installments,
      feePercent,
    });
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Dados da taxa inválidos', 'error');
      return;
    }

    const card = isCardPayment(parsed.data.paymentType);
    try {
      await createMutation.mutateAsync({
        label: parsed.data.label,
        paymentType: parsed.data.paymentType,
        cardBrand: card ? parsed.data.cardBrand || undefined : undefined,
        installments: card ? parsed.data.installments : 1,
        feePercent: parsed.data.feePercent,
      });
      setLabel('');
      setPaymentType('credito');
      setCardBrand('');
      setInstallments('1');
      setFeePercent('0');
    } catch (e) {
      showToast(`Erro ao criar taxa: ${(e as Error).message}`, 'error');
    }
  };

  const startEdit = (f: PaymentMethodFee) => {
    setEditingId(f.id);
    setEditFeePercent(String(f.feePercent ?? 0));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditFeePercent('0');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const parsed = percentSchema.safeParse(editFeePercent);
    if (!parsed.success) {
      showToast(parsed.error.issues[0]?.message || 'Taxa inválida', 'error');
      return;
    }
    try {
      // Edição parcial: SÓ feePercent — demais campos da taxa ficam intocados.
      await updateMutation.mutateAsync({ id: editingId, updates: { feePercent: parsed.data } });
      cancelEdit();
    } catch (e) {
      showToast(`Erro ao atualizar taxa: ${(e as Error).message}`, 'error');
    }
  };

  const remove = async (f: PaymentMethodFee) => {
    const ok = window.confirm(`Excluir a taxa "${f.label}"?`);
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(f.id);
    } catch (e) {
      showToast(`Erro ao excluir taxa: ${(e as Error).message}`, 'error');
    }
  };

  const busy = isLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const loadError = error ? (error as Error).message : null;
  const showCardFields = isCardPayment(paymentType);

  return (
    <div className="mb-12">
      <div className="bg-card border border-line rounded-2xl p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink mb-1 flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Taxas de Pagamento
            </h3>
            <p className="text-sm text-muted">
              Percentual descontado por meio de pagamento. Usado no cálculo do resultado líquido.
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
          <div className="lg:col-span-3">
            <label className="block text-xs font-semibold text-muted mb-1">Descrição</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex.: Crédito 3x Visa"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">Tipo</label>
            <select
              aria-label="Tipo de pagamento"
              value={paymentType}
              onChange={(e) => handlePaymentTypeChange(e.target.value as PaymentType)}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              {PAYMENT_TYPES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">Bandeira</label>
            {/* HIGH-2: MESMO conjunto de opções do atendimento (select, value
                lowercase) — antes era texto livre e divergia do atendimento,
                zerando a taxa no relatório. */}
            <select
              aria-label="Bandeira do cartão"
              value={cardBrand}
              onChange={(e) => setCardBrand(e.target.value)}
              disabled={!showCardFields}
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50"
            >
              <option value="">Selecione…</option>
              {CARD_BRAND_OPTIONS.map((brand) => (
                <option key={brand.value} value={brand.value}>
                  {brand.label}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">Parcelas</label>
            <input
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
              inputMode="numeric"
              disabled={!showCardFields}
              aria-label="Parcelas"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-50"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-semibold text-muted mb-1">Taxa (%)</label>
            <input
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
              inputMode="decimal"
              aria-label="Taxa (%)"
              className="w-full px-3 py-2 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-1">
            <button
              type="button"
              onClick={create}
              disabled={busy || !canCreate}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-bold hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Criar taxa"
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
              Nenhuma taxa cadastrada ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((f) => {
                const isEditing = editingId === f.id;
                return (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-ink truncate">{f.label}</div>
                      <div className="text-xs text-muted mt-0.5 truncate">
                        {paymentTypeLabel(f.paymentType)}
                        {f.cardBrand ? ` • ${f.cardBrand}` : ''} • {f.installments}x
                        {isEditing ? '' : ` • ${f.feePercent}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isEditing ? (
                        <>
                          <input
                            value={editFeePercent}
                            onChange={(e) => setEditFeePercent(e.target.value)}
                            inputMode="decimal"
                            aria-label="Editar taxa (%)"
                            className="w-20 px-2 py-2 rounded-lg border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                          />
                          <button
                            type="button"
                            onClick={saveEdit}
                            className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                            title="Salvar"
                            aria-label="Salvar taxa"
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
                          onClick={() => startEdit(f)}
                          className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-surface"
                          title="Editar"
                          aria-label="Editar taxa"
                          disabled={busy}
                        >
                          <Pencil className="h-4 w-4 text-muted" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        className="px-2 py-2 rounded-lg border border-line bg-card hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Excluir"
                        aria-label="Excluir taxa"
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
