import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@/lib/a11y/test/a11y-utils';
import { AtendimentoFormModal } from './AtendimentoFormModal';
import type { Deal, Professional, Product } from '@/types';

const baseForm = {
  procedimento: '',
  productId: '',
  valor: '',
  desconto: '',
  professionalId: '',
  dealId: '',
  paymentMethod: 'pix',
  cardBrand: '',
  installments: '1',
  recebido: false,
};

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
  formData: baseForm,
  setFormData: vi.fn(),
  editing: null,
  deals: [{ id: 'd1', title: 'Plano Ortodôntico' }] as Deal[],
  professionals: [{ id: 'p1', name: 'Dra. Ana', active: true }] as Professional[],
  products: [{ id: 'prod1', name: 'Limpeza', price: 250 }] as Product[],
};

describe('AtendimentoFormModal', () => {
  it('renderiza o drawer com toggle "Pagamento recebido" e os campos do mockup', () => {
    render(<AtendimentoFormModal {...baseProps} />);
    expect(screen.getByRole('heading', { name: /registrar atendimento/i })).toBeTruthy();
    expect(screen.getByLabelText(/pagamento recebido/i)).toBeTruthy();
    expect(screen.getByLabelText(/procedimento/i)).toBeTruthy();
    expect(screen.getByLabelText(/dentista/i)).toBeTruthy();
    expect(screen.getByLabelText(/forma de pagamento/i)).toBeTruthy();
    expect(screen.getByLabelText(/desconto/i)).toBeTruthy();
  });

  it('marca recebido ao acionar o toggle', async () => {
    const setFormData = vi.fn();
    render(<AtendimentoFormModal {...baseProps} setFormData={setFormData} />);
    await userEvent.click(screen.getByLabelText(/pagamento recebido/i));
    expect(setFormData).toHaveBeenCalledWith(expect.objectContaining({ recebido: true }));
  });

  it('calcula o total a receber (valor − desconto) no drawer', () => {
    render(
      <AtendimentoFormModal
        {...baseProps}
        formData={{ ...baseForm, valor: '350', desconto: '30' }}
      />
    );
    expect(screen.getByText(/total a receber/i)).toBeTruthy();
    expect(screen.getByText(/320,00/)).toBeTruthy();
  });

  it('mostra a bandeira do cartão só para crédito/débito', () => {
    const { rerender } = render(<AtendimentoFormModal {...baseProps} />);
    expect(screen.queryByLabelText(/bandeira/i)).toBeNull();

    rerender(
      <AtendimentoFormModal
        {...baseProps}
        formData={{ ...baseForm, paymentMethod: 'credito' }}
      />
    );
    expect(screen.getByLabelText(/bandeira/i)).toBeTruthy();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(<AtendimentoFormModal {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
