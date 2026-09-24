import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaCapiSettings } from './MetaCapiSettings';

/**
 * Tela de conversões para a Meta (Junior, 23/09/2026: "vamos construir essa tela e colocar no
 * menu conexões").
 *
 * O que estes testes protegem não é o leiaute, é o que falha em SILÊNCIO:
 *  - campo de token em branco NÃO pode apagar o token guardado (o valor nunca volta do servidor);
 *  - `test_event_code` preenchido faz nenhuma conversão contar — o aviso tem que aparecer;
 *  - DDD mal digitado faz o marco nascer `skipped` e a Meta nunca receber.
 */

const RESPOSTA = {
  enabled: true,
  datasetId: '1111045858153415',
  whatsappBusinessAccountId: '2620648758307353',
  hasToken: true,
  tokenLast4: '5U04',
  testEventCode: '',
  sendValue: false,
  eventMap: { replied: 'LeadSubmitted', scheduled: 'QualifiedLead', attended: null, won: 'Purchase' },
  regionDdds: [] as string[],
  supportedEventNames: ['LeadSubmitted', 'QualifiedLead', 'InitiateCheckout', 'Purchase'],
  eventNameLabels: {
    LeadSubmitted: 'Lead enviado (usamos para: respondeu)',
    QualifiedLead: 'Lead qualificado (usamos para: agendou)',
    InitiateCheckout: 'Começou a finalizar a compra',
    Purchase: 'Compra (usamos para: fechou)',
  },
  eventTypeLabels: {
    replied: 'Respondeu (o lead voltou a falar depois do primeiro contato)',
    scheduled: 'Agendou (reunião ou consulta marcada)',
    attended: 'Compareceu (participou do que foi marcado)',
    won: 'Fechou (negócio ganho)',
  },
};

const fetchMock = vi.fn();

function respostaOk(corpo: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => respostaOk(RESPOSTA));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function abrir() {
  render(<MetaCapiSettings disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Conversões para a Meta/ }));
  await waitFor(() => expect(screen.getByLabelText(/Conjunto de dados/)).toBeInTheDocument());
}

function corpoDoPost() {
  const chamada = fetchMock.mock.calls.find(c => c[1]?.method === 'POST');
  return JSON.parse(String(chamada?.[1]?.body ?? '{}'));
}

describe('tela de conversões para a Meta', () => {
  it('não busca nada antes de abrir — nada de rede sem o usuário pedir', () => {
    render(<MetaCapiSettings disabled={false} />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra o token como configurado e os últimos 4, sem nunca exibir o valor', async () => {
    await abrir();

    expect(screen.getByText(/••••5U04/)).toBeInTheDocument();
    const campo = screen.getByLabelText(/Token de acesso/) as HTMLInputElement;
    expect(campo.type).toBe('password');
    expect(campo.value).toBe('');
  });

  it('campo de token EM BRANCO não apaga o token guardado', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(corpoDoPost()).not.toHaveProperty('accessToken'));
  });

  it('token digitado vai no corpo, para substituir o atual', async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText(/Token de acesso/), { target: { value: '  EAA-novo  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(corpoDoPost().accessToken).toBe('EAA-novo'));
  });

  it('AVISA em vermelho quando há código de teste: nada conta como conversão', async () => {
    fetchMock.mockImplementation(() => respostaOk({ ...RESPOSTA, testEventCode: 'TESTE_123' }));
    await abrir();

    expect(screen.getByText(/nenhuma conversão conta/i)).toBeInTheDocument();
    // E o resumo do cabeçalho precisa gritar isso também, com o painel fechado.
    expect(screen.getByText(/MODO DE TESTE/)).toBeInTheDocument();
  });

  it('sem código de teste, o aviso não aparece', async () => {
    await abrir();

    expect(screen.queryByText(/nenhuma conversão conta/i)).not.toBeInTheDocument();
  });

  it('normaliza os DDDs: só pares de dígitos, sem repetir', async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText(/DDDs da sua região/), {
      target: { value: '21, 11 / 021  21  5 999' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(corpoDoPost().regionDdds).toEqual(['21', '11']));
  });

  it('DDD vazio vira lista vazia — que significa Brasil inteiro, não "nenhum"', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(corpoDoPost().regionDdds).toEqual([]));
  });

  it('etapa marcada como "não enviar" vai como null, não como string vazia', async () => {
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    // `attended` chega null do servidor e precisa continuar null no envio.
    await waitFor(() => expect(corpoDoPost().eventMap).toEqual({
      replied: 'LeadSubmitted',
      scheduled: 'QualifiedLead',
      attended: null,
      won: 'Purchase',
    }));
  });

  it('trocar a etapa manda o nome novo', async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText(/Compareceu/), { target: { value: 'InitiateCheckout' } });
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(corpoDoPost().eventMap.attended).toBe('InitiateCheckout'));
  });

  it('erro do servidor aparece na tela em vez de sumir', async () => {
    await abrir();
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'deu ruim' }) } as Response));
    fireEvent.click(screen.getByRole('button', { name: /Salvar conversões/ }));

    await waitFor(() => expect(screen.getByText('deu ruim')).toBeInTheDocument());
  });

  it('avisa que o dataset precisa ser o da conta de WhatsApp, nao o pixel do site', async () => {
    const { container } = render(<MetaCapiSettings disabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Conversões para a Meta/ }));
    await waitFor(() => expect(screen.getByLabelText(/Conjunto de dados/)).toBeInTheDocument());

    // O texto tem <strong> no meio, entao o aviso vive em varios nos: le o conjunto.
    const texto = (container.textContent ?? '').replace(/\s+/g, ' ');
    expect(texto).toContain('da conta de WhatsApp, não o pixel do site');
    expect(texto).toContain('a conversão some sem aviso');
  });
});
