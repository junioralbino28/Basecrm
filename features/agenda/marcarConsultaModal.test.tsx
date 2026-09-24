import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MarcarConsultaModal } from './components/MarcarConsultaModal';
import type { Contact } from '@/types';

/**
 * Marcar para quem NÃO está em Contatos (pedido do Junior, 24/09/2026):
 * "eu como dono da agenda preciso poder marcar hora mesmo que o lead não esteja ali em contatos"
 * — indicação que chamou no WhatsApp pessoal, lead prospectado por ele.
 *
 * E o defeito que o travou: o botão "Marcar" só acendia com um contato escolhido no segundo
 * campo, e a tela não dizia nada. Ele digitou o nome no campo de cima (que é só filtro), o botão
 * ficou apagado e mudo, e ele concluiu que havia uma trava de horário — que não existe.
 */

const CONTATOS: Contact[] = [
  { id: 'c-1', name: 'Púlpitos Gênesis', email: '', phone: '+5521970484359', status: 'ACTIVE', stage: 'LEAD', createdAt: '' } as Contact,
  { id: 'c-2', name: 'Adel Barros', email: '', phone: '+5524981828644', status: 'ACTIVE', stage: 'LEAD', createdAt: '' } as Contact,
];

function montar(onConfirmar = vi.fn(async () => {})) {
  render(
    <MarcarConsultaModal
      professionalId="pro-a"
      professionalName="Cenno Hub"
      hora="13:00"
      contacts={CONTATOS}
      salvando={false}
      onConfirmar={onConfirmar}
      onFechar={vi.fn()}
    />,
  );
  return { onConfirmar, botao: () => screen.getByRole('button', { name: /^marcar$/i }) };
}

describe('MarcarConsultaModal — o botão não fica mudo', () => {
  it('sem contato escolhido, o botão está apagado E a tela diz o que falta', () => {
    const { botao } = montar();

    expect(botao()).toBeDisabled();
    // O ponto: antes disto, o botão apagado era a única informação na tela.
    expect(screen.getByRole('status')).toHaveTextContent(/escolha o contato na lista/i);
  });

  it('digitar na busca sem escolher na lista NÃO habilita — e a tela explica isso', async () => {
    const usuario = userEvent.setup();
    const { botao } = montar();

    await usuario.type(screen.getByPlaceholderText(/buscar pelo nome/i), 'Púlpitos');

    expect(botao()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/só digitar o nome na busca não basta/i);
  });

  it('escolher o contato na lista habilita o botão e some o aviso', async () => {
    const usuario = userEvent.setup();
    const { botao } = montar();

    await usuario.selectOptions(screen.getByLabelText(/contato da consulta/i), 'c-1');

    expect(botao()).toBeEnabled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('MarcarConsultaModal — busca por nome ignora acento', () => {
  it('quem digita "Pulpitos" acha "Púlpitos Gênesis"', async () => {
    const usuario = userEvent.setup();
    montar();

    // Foi assim que um contato que EXISTIA pareceu não existir.
    await usuario.type(screen.getByPlaceholderText(/buscar pelo nome/i), 'Pulpitos');

    const lista = screen.getByLabelText(/contato da consulta/i);
    expect(lista).toHaveTextContent('Púlpitos Gênesis');
    expect(lista).not.toHaveTextContent('Adel Barros');
  });
});

describe('MarcarConsultaModal — marcar para quem não está em Contatos', () => {
  it('quando a busca não acha ninguém, a tela aponta a saída em vez de travar', async () => {
    const usuario = userEvent.setup();
    montar();

    await usuario.type(screen.getByPlaceholderText(/buscar pelo nome/i), 'Indicação do Marcos');

    expect(screen.getByRole('status')).toHaveTextContent(/de fora da lista/i);
  });

  it('marca para alguém novo e devolve o nome para virar contato', async () => {
    const usuario = userEvent.setup();
    const { onConfirmar, botao } = montar();

    await usuario.click(screen.getByRole('button', { name: /de fora da lista/i }));
    await usuario.type(screen.getByLabelText(/quem vai ser atendido/i), 'Marcos da Indicação');
    await usuario.type(screen.getByLabelText(/telefone/i), '21999998888');

    expect(botao()).toBeEnabled();
    await usuario.click(botao());

    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar.mock.calls[0][0]).toMatchObject({
      contactId: '',
      novoContato: { name: 'Marcos da Indicação', phone: '21999998888' },
      hora: '13:00',
    });
  });

  it('o nome já digitado na busca é aproveitado ao trocar de modo', async () => {
    const usuario = userEvent.setup();
    montar();

    await usuario.type(screen.getByPlaceholderText(/buscar pelo nome/i), 'Marcos da Indicação');
    await usuario.click(screen.getByRole('button', { name: /de fora da lista/i }));

    expect(screen.getByLabelText(/quem vai ser atendido/i)).toHaveValue('Marcos da Indicação');
  });

  it('no modo novo, sem nome o botão continua apagado e explicado', async () => {
    const usuario = userEvent.setup();
    const { botao } = montar();

    await usuario.click(screen.getByRole('button', { name: /de fora da lista/i }));

    expect(botao()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/escreva o nome/i);
  });
});
