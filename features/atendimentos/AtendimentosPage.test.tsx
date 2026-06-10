import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtendimentosPage } from './AtendimentosPage';

const handleNew = vi.fn();

vi.mock('./hooks/useAtendimentosController', () => ({
  useAtendimentosController: () => ({
    profile: { id: 'u1', role: 'clinic_staff' },
    searchTerm: '',
    setSearchTerm: vi.fn(),
    isModalOpen: false,
    setIsModalOpen: vi.fn(),
    editing: null,
    formData: {
      procedimento: '', productId: '', valor: '', desconto: '', professionalId: '',
      dealId: '', paymentMethod: 'pix', cardBrand: '', installments: '1', recebido: false,
    },
    setFormData: vi.fn(),
    filteredAtendimentos: [],
    deals: [],
    professionals: [],
    products: [],
    isLoading: false,
    handleNew,
    handleEdit: vi.fn(),
    handleDelete: vi.fn(),
    handleSubmit: vi.fn(),
  }),
}));

describe('AtendimentosPage', () => {
  it('renderiza o título e dispara novo atendimento', async () => {
    render(<AtendimentosPage />);
    expect(screen.getByText('Atendimentos')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /novo atendimento/i }));
    expect(handleNew).toHaveBeenCalledTimes(1);
  });
});
