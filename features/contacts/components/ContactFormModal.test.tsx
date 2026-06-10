import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactFormModal } from './ContactFormModal';
import type { LeadSource } from '@/types';

const baseForm = {
  name: '',
  email: '',
  phone: '',
  role: '',
  companyName: '',
  source: '',
};

const leadSources: LeadSource[] = [
  { id: 'ls1', name: 'Anúncio Meta', active: true },
  { id: 'ls2', name: 'Indicação', active: true },
  { id: 'ls3', name: 'Origem desativada', active: false },
];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSubmit: vi.fn((e: React.FormEvent) => e.preventDefault()),
  formData: baseForm,
  setFormData: vi.fn(),
  editingContact: null,
  leadSources,
};

describe('ContactFormModal — select de origem (N1)', () => {
  it('renderiza o select de origem alimentado por lead_sources ativas', () => {
    render(<ContactFormModal {...baseProps} />);
    const select = screen.getByLabelText(/origem/i);
    expect(select).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Anúncio Meta' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Indicação' })).toBeTruthy();
    // Origem inativa não aparece no select.
    expect(screen.queryByRole('option', { name: 'Origem desativada' })).toBeNull();
  });

  it('seleciona uma origem e propaga pro formData', async () => {
    const setFormData = vi.fn();
    render(<ContactFormModal {...baseProps} setFormData={setFormData} />);
    await userEvent.selectOptions(screen.getByLabelText(/origem/i), 'Anúncio Meta');
    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'Anúncio Meta' })
    );
  });

  it('fallback: mantém origem legada do contato como opção mesmo fora de lead_sources', () => {
    render(
      <ContactFormModal
        {...baseProps}
        formData={{ ...baseForm, source: 'WEBSITE' }}
      />
    );
    // Valor legado (texto livre/enum antigo) continua selecionável — não some na edição.
    expect(screen.getByRole('option', { name: 'WEBSITE' })).toBeTruthy();
  });

  it('fallback: sem lead_sources cadastradas, vira campo de texto livre', () => {
    render(<ContactFormModal {...baseProps} leadSources={[]} />);
    const input = screen.getByLabelText(/origem/i);
    expect((input as HTMLInputElement).tagName).toBe('INPUT');
  });
});
