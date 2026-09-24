import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Escolher a empresa de um negócio (Junior, 24/09/2026: "não tem a opção de colocar a empresa do
 * lead no card dele no funil, ele aparece 'sem empresa' e não tem como alterar").
 *
 * O campo de empresa só existia no modal de CRIAR negócio à mão — e negócio que nasce de uma
 * conversa de WhatsApp nunca passa por lá.
 */

const addCompany = vi.fn();
let empresas: { id: string; name: string }[] = [];

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => ({ companies: empresas, addCompany }),
}));

import { DealCompanySelector } from './DealCompanySelector';

beforeEach(() => {
  addCompany.mockReset();
  empresas = [
    { id: 'emp-1', name: 'Alfa Relógios' },
    { id: 'emp-2', name: 'Beta Odontologia' },
  ];
});

describe('DealCompanySelector', () => {
  it('mostra "Sem empresa" e um jeito de escolher', async () => {
    render(<DealCompanySelector onChange={vi.fn()} />);

    expect(screen.getByText('Sem empresa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /escolher/i })).toBeEnabled();
  });

  it('escolhe uma empresa da lista e devolve o id', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    render(<DealCompanySelector onChange={onChange} />);

    await usuario.click(screen.getByRole('button', { name: /escolher/i }));
    await usuario.click(screen.getByRole('button', { name: /Alfa Relógios/i }));

    expect(onChange).toHaveBeenCalledWith('emp-1');
  });

  it('busca ignora acento: "relogios" acha "Alfa Relógios"', async () => {
    const usuario = userEvent.setup();
    render(<DealCompanySelector onChange={vi.fn()} />);

    await usuario.click(screen.getByRole('button', { name: /escolher/i }));
    await usuario.type(screen.getByLabelText(/empresa do negócio/i), 'relogios');

    expect(screen.getByRole('button', { name: /Alfa Relógios/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Beta Odontologia/i })).toBeNull();
  });

  it('cria empresa nova quando o nome digitado não existe', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    addCompany.mockResolvedValue({ id: 'emp-9', name: 'Gama Vistos' });
    render(<DealCompanySelector onChange={onChange} />);

    await usuario.click(screen.getByRole('button', { name: /escolher/i }));
    await usuario.type(screen.getByLabelText(/empresa do negócio/i), 'Gama Vistos');
    await usuario.click(screen.getByRole('button', { name: /criar/i }));

    expect(addCompany).toHaveBeenCalledWith({ name: 'Gama Vistos' });
    expect(onChange).toHaveBeenCalledWith('emp-9');
  });

  it('não oferece criar quando o nome já existe, mesmo escrito sem acento', async () => {
    const usuario = userEvent.setup();
    render(<DealCompanySelector onChange={vi.fn()} />);

    await usuario.click(screen.getByRole('button', { name: /escolher/i }));
    await usuario.type(screen.getByLabelText(/empresa do negócio/i), 'alfa relogios');

    expect(screen.queryByRole('button', { name: /^criar/i })).toBeNull();
  });

  it('deixa tirar a empresa de um negócio que já tem', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    render(<DealCompanySelector clientCompanyId="emp-1" onChange={onChange} />);

    expect(screen.getByText('Alfa Relógios')).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /trocar/i }));
    await usuario.click(screen.getByRole('button', { name: /tirar a empresa/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('DealCompanySelector — sugestão do que o lead falou na conversa', () => {
  it('oferece a empresa que a Aurora anotou, criando na hora quando ainda não existe', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    addCompany.mockResolvedValue({ id: 'emp-9', name: 'Gama Vistos' });
    render(<DealCompanySelector sugestao="Gama Vistos" onChange={onChange} />);

    await usuario.click(screen.getByRole('button', { name: /na conversa ele falou/i }));

    expect(addCompany).toHaveBeenCalledWith({ name: 'Gama Vistos' });
    expect(onChange).toHaveBeenCalledWith('emp-9');
  });

  it('a sugestão vira um clique direto quando a empresa JÁ está cadastrada', async () => {
    const usuario = userEvent.setup();
    const onChange = vi.fn();
    render(<DealCompanySelector sugestao="alfa relogios" onChange={onChange} />);

    await usuario.click(screen.getByRole('button', { name: /na conversa ele falou/i }));

    // Nada de empresa duplicada: usa a que existe.
    expect(addCompany).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('emp-1');
  });

  it('não sugere nada quando o negócio já tem empresa escolhida', () => {
    render(<DealCompanySelector clientCompanyId="emp-1" sugestao="Gama Vistos" onChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /na conversa ele falou/i })).toBeNull();
  });
});
