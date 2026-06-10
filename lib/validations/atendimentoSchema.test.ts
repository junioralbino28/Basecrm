import { describe, it, expect } from 'vitest';
import { atendimentoFormSchema } from './schemas';

describe('atendimentoFormSchema', () => {
  it('aceita um atendimento válido (coage valor/desconto string -> number)', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      desconto: '30',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.valor).toBe(250); // currencySchema coage string -> number
      expect(r.data.desconto).toBe(30);
      expect(r.data.recebido).toBe(true);
      expect(r.data.installments).toBe(1); // default
    }
  });

  it('desconto é opcional e cai em 0', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: false,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.desconto).toBe(0);
  });

  it('rejeita quando forma de pagamento não é selecionada', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: 'p1',
      paymentMethod: '',
      recebido: false,
    });
    expect(r.success).toBe(false);
  });

  it('rejeita desconto maior que o valor (mensagem PT-BR clara)', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      desconto: '300',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'Desconto não pode ser maior que o valor do atendimento'
      );
    }
  });

  it('aceita desconto igual ao valor (cortesia 100%)', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      desconto: '250',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejeita valor negativo, desconto negativo e parcelas < 1', () => {
    const base = {
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      desconto: '0',
      professionalId: 'p1',
      paymentMethod: 'pix',
      recebido: false,
    };
    expect(atendimentoFormSchema.safeParse({ ...base, valor: '-10' }).success).toBe(false);
    expect(atendimentoFormSchema.safeParse({ ...base, desconto: '-5' }).success).toBe(false);
    expect(atendimentoFormSchema.safeParse({ ...base, installments: '0' }).success).toBe(false);
  });

  it('rejeita quando o profissional não é selecionado', () => {
    const r = atendimentoFormSchema.safeParse({
      procedimento: 'Limpeza',
      productId: 'prod1',
      valor: '250',
      professionalId: '',
      paymentMethod: 'pix',
      recebido: false,
    });
    expect(r.success).toBe(false);
  });
});
