import React from 'react';
import { BadgeCheck, Check, ClipboardPlus, X } from 'lucide-react';
import { Atendimento, Deal, Professional, Product } from '@/types';
import type { AtendimentoFormState } from '../hooks/useAtendimentosController';
import { CARD_BRAND_OPTIONS } from '@/lib/constants/cardBrands';

interface AtendimentoFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: AtendimentoFormState;
  setFormData: (data: AtendimentoFormState) => void;
  editing: Atendimento | null;
  deals: Deal[];
  professionals: Professional[];
  products: Product[];
}

const formatBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);


/**
 * Drawer "1 toque" para registrar atendimento (mirror do mockup drawer-at).
 * Procedimento (catálogo) · valor · desconto · dentista · forma de pgto ·
 * bandeira (cartão) · parcelas · TOTAL A RECEBER calculado · toggle
 * "Pagamento recebido" (= paid_at; entra no faturamento de hoje).
 */
export const AtendimentoFormModal: React.FC<AtendimentoFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  editing,
  deals,
  professionals,
  products,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // passive: true porque não usamos preventDefault() - permite scroll mais fluido
    document.addEventListener('keydown', handleEscape, { passive: true });
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    setFormData({
      ...formData,
      productId,
      procedimento: product?.name || formData.procedimento,
      valor: product ? String(product.price) : formData.valor,
    });
  };

  const showCardBrand = formData.paymentMethod === 'credito' || formData.paymentMethod === 'debito';
  // Desconto > valor bloqueia o submit (não só clampa a exibição do total).
  const descontoMaiorQueValor =
    (Number(formData.desconto) || 0) > (Number(formData.valor) || 0);
  const totalAReceber = Math.max((Number(formData.valor) || 0) - (Number(formData.desconto) || 0), 0);

  const inputClass =
    'w-full h-11 px-3 rounded-xl border border-line bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40';
  const labelClass = 'block text-xs font-medium text-muted mb-1.5';

  return (
    <div
      className="fixed inset-0 md:left-[var(--app-sidebar-width,0px)] z-[9999] bg-slate-900/60 backdrop-blur-sm"
      onClick={(e) => {
        // Fecha só ao clicar no backdrop (fora do painel).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="absolute top-0 right-0 h-full w-full sm:w-[440px] bg-card border-l border-line shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 h-16 border-b border-line shrink-0">
          <span className="grid place-items-center w-9 h-9 rounded-lg bg-gold-50 text-gold-600">
            <ClipboardPlus size={20} aria-hidden="true" />
          </span>
          <h2 className="flex-1 font-display font-semibold text-base text-ink">
            {editing ? 'Editar atendimento' : 'Registrar atendimento'}
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="grid place-items-center w-9 h-9 rounded-lg text-faint hover:bg-surface transition"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 pb-[calc(1.25rem+var(--app-safe-area-bottom,0px))]">
          <div>
            <label htmlFor="atd-dentista" className={labelClass}>Dentista</label>
            <select
              id="atd-dentista"
              required
              className={inputClass}
              value={formData.professionalId}
              onChange={e => setFormData({ ...formData, professionalId: e.target.value })}
            >
              <option value="">Selecione...</option>
              {professionals.map(prof => (
                <option key={prof.id} value={prof.id}>
                  {prof.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="atd-procedimento" className={labelClass}>Procedimento</label>
            <select
              id="atd-procedimento"
              required
              className={inputClass}
              value={formData.productId}
              onChange={e => handleProductChange(e.target.value)}
            >
              <option value="">Selecione...</option>
              {products.map(product => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="atd-deal" className={labelClass}>Paciente (Negócio)</label>
            <select
              id="atd-deal"
              className={inputClass}
              value={formData.dealId}
              onChange={e => setFormData({ ...formData, dealId: e.target.value })}
            >
              <option value="">Selecione...</option>
              {deals.map(deal => (
                <option key={deal.id} value={deal.id}>
                  {deal.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="text-[11px] uppercase tracking-wide text-faint font-semibold">Pagamento</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="atd-valor" className={labelClass}>Valor</label>
              <input
                id="atd-valor"
                required
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="0,00"
                value={formData.valor}
                onChange={e => setFormData({ ...formData, valor: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="atd-desconto" className={labelClass}>Desconto</label>
              <input
                id="atd-desconto"
                type="number"
                min="0"
                step="0.01"
                className={inputClass}
                placeholder="0,00"
                value={formData.desconto}
                aria-invalid={descontoMaiorQueValor || undefined}
                aria-describedby={descontoMaiorQueValor ? 'atd-desconto-erro' : undefined}
                onChange={e => setFormData({ ...formData, desconto: e.target.value })}
              />
              {descontoMaiorQueValor && (
                <p id="atd-desconto-erro" role="alert" className="mt-1.5 text-xs text-red-500">
                  Desconto não pode ser maior que o valor do atendimento
                </p>
              )}
            </div>
          </div>

          <div className={`grid gap-3 ${showCardBrand ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div>
              <label htmlFor="atd-pgto" className={labelClass}>Forma de pagamento</label>
              <select
                id="atd-pgto"
                required
                className={inputClass}
                value={formData.paymentMethod}
                onChange={e => {
                  const paymentMethod = e.target.value;
                  const isCard = paymentMethod === 'credito' || paymentMethod === 'debito';
                  // Fora de cartão, bandeira/parcelas não fazem sentido — zera pra não ficarem órfãs.
                  setFormData(
                    isCard
                      ? { ...formData, paymentMethod }
                      : { ...formData, paymentMethod, cardBrand: '', installments: '1' }
                  );
                }}
              >
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </div>
            {showCardBrand && (
              <div>
                <label htmlFor="atd-bandeira" className={labelClass}>Bandeira</label>
                <select
                  id="atd-bandeira"
                  className={inputClass}
                  value={formData.cardBrand}
                  onChange={e => setFormData({ ...formData, cardBrand: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {CARD_BRAND_OPTIONS.map(brand => (
                    <option key={brand.value} value={brand.value}>
                      {brand.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="atd-parcelas" className={labelClass}>Parcelas</label>
              <input
                id="atd-parcelas"
                type="number"
                min="1"
                max="48"
                className={inputClass}
                value={formData.installments}
                onChange={e => setFormData({ ...formData, installments: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-surface px-3.5 py-3">
            <span className="text-[13px] text-muted">Total a receber</span>
            <span className="font-display font-semibold text-[17px] text-ink">
              {formatBRL(totalAReceber)}
            </span>
          </div>

          <label
            htmlFor="atd-recebido"
            className={`flex items-center gap-3 rounded-xl border px-3.5 py-3.5 cursor-pointer select-none transition ${
              formData.recebido
                ? 'border-brand-200 bg-brand-50'
                : 'border-line bg-card hover:border-brand-200'
            }`}
          >
            <input
              id="atd-recebido"
              type="checkbox"
              className="sr-only"
              checked={formData.recebido}
              onChange={e => setFormData({ ...formData, recebido: e.target.checked })}
            />
            <span
              aria-hidden="true"
              className={`relative inline-flex w-10 h-6 rounded-full transition shrink-0 ${
                formData.recebido ? 'bg-brand-600' : 'bg-line'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  formData.recebido ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </span>
            <span className="flex-1">
              <span
                className={`block text-sm font-semibold ${
                  formData.recebido ? 'text-brand-700' : 'text-ink'
                }`}
              >
                Pagamento recebido
              </span>
              <span className="block text-[11px] text-muted">entra no faturamento de hoje</span>
            </span>
            {formData.recebido && (
              <BadgeCheck size={20} className="text-brand-600" aria-hidden="true" />
            )}
          </label>

          <button
            type="submit"
            disabled={descontoMaiorQueValor}
            className="w-full h-12 rounded-xl bg-gold-600 hover:bg-gold-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-[15px] inline-flex items-center justify-center gap-2 active:scale-[.99] transition shadow-lg shadow-gold-600/20"
          >
            <Check size={20} aria-hidden="true" />
            {editing ? 'Salvar alterações' : 'Registrar atendimento'}
          </button>
        </form>
      </aside>
    </div>
  );
};
