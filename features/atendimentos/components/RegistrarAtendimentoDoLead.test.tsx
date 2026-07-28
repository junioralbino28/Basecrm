import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A porta do atendimento no card do lead (Junior, 28/07, item 6): registrar
 * sem sair pro menu. Regras travadas aqui:
 * 1. abrir a porta pré-seleciona o LEAD DO CARD no form (zerado no resto);
 * 2. o drawer recebe SÓ a oportunidade do card (lead travado, sem trocar);
 * 3. salvar com sucesso (controller fecha) avisa o card pra fechar a porta.
 */
const setFormData = vi.fn();
const setIsModalOpen = vi.fn();
const controllerState = {
  isModalOpen: false,
  deals: [
    { id: 'deal-do-card', title: 'Lente A' },
    { id: 'outro-deal', title: 'Outro' },
  ],
  professionals: [] as unknown[],
  products: [] as unknown[],
  formData: {},
  handleSubmit: vi.fn(),
};

vi.mock('../hooks/useAtendimentosController', () => ({
  formVazioDeAtendimento: {
    procedimento: '', productId: '', valor: '', desconto: '', professionalId: '',
    dealId: '', paymentMethod: 'pix', cardBrand: '', installments: '1', recebido: false,
  },
  useAtendimentosController: () => ({
    ...controllerState,
    setFormData,
    setIsModalOpen,
    setFormDataSpy: setFormData,
  }),
}));

const modalProps = vi.fn();
vi.mock('./AtendimentoFormModal', () => ({
  AtendimentoFormModal: (props: Record<string, unknown>) => {
    modalProps(props);
    return null;
  },
}));

import { RegistrarAtendimentoDoLead } from './RegistrarAtendimentoDoLead';

beforeEach(() => {
  vi.clearAllMocks();
  controllerState.isModalOpen = false;
});

describe('RegistrarAtendimentoDoLead — porta do card', () => {
  it('ao montar, zera o form com o lead do card já escolhido e abre o drawer', () => {
    render(<RegistrarAtendimentoDoLead dealId="deal-do-card" onClose={vi.fn()} />);

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'deal-do-card', procedimento: '', recebido: false }),
    );
    expect(setIsModalOpen).toHaveBeenCalledWith(true);
  });

  it('o drawer recebe SÓ a oportunidade do card — lead travado', () => {
    render(<RegistrarAtendimentoDoLead dealId="deal-do-card" onClose={vi.fn()} />);

    const props = modalProps.mock.calls.at(-1)?.[0] as { deals: Array<{ id: string }> };
    expect(props.deals.map((d) => d.id)).toEqual(['deal-do-card']);
  });

  it('salvar com sucesso (controller fecha) avisa o card — e só DEPOIS de ter aberto', () => {
    const onClose = vi.fn();
    const { rerender } = render(<RegistrarAtendimentoDoLead dealId="deal-do-card" onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled(); // primeiro render: ainda não abriu

    controllerState.isModalOpen = true; // o drawer abriu
    rerender(<RegistrarAtendimentoDoLead dealId="deal-do-card" onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();

    controllerState.isModalOpen = false; // o handleSubmit fechou no sucesso
    rerender(<RegistrarAtendimentoDoLead dealId="deal-do-card" onClose={onClose} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
