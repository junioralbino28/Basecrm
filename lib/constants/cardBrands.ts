/**
 * @fileoverview Vocabulário ÚNICO de bandeiras de cartão (config × atendimento).
 *
 * A taxa de cartão só casa no relatório (get_net_result) quando a bandeira
 * gravada na config (payment_method_fees) e no atendimento batem. Antes, a
 * config era texto livre ('Visa', 'Master…') e o atendimento um select
 * lowercase ('visa') — divergência de vocabulário zerava a taxa em silêncio
 * (achado HIGH-2). Esta lista é a fonte de verdade dos DOIS selects; o valor
 * gravado é sempre `value` (lowercase), o `label` é só exibição.
 */

export interface CardBrandOption {
  /** Valor persistido (lowercase) — chave de casamento config × atendimento. */
  value: string;
  /** Rótulo de exibição. */
  label: string;
}

/** Bandeiras suportadas no cadastro de atendimento e na config de taxas. */
export const CARD_BRAND_OPTIONS: CardBrandOption[] = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'elo', label: 'Elo' },
  { value: 'amex', label: 'Amex' },
  { value: 'hipercard', label: 'Hipercard' },
  { value: 'outra', label: 'Outra' },
];
