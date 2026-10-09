import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DialogoNovoAgente } from './DialogoNovoAgente';

/**
 * Bloco 2 (PLAN-bloco-2.md, Task 6): o diálogo "Novo agente". O fetch responde por endereço; cada caso confere o corpo
 * que a tela manda. Em modelo e cópia, a tela nunca manda texto: só ids, revisão e respostas.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const OUTRO = '33333333-3333-4333-8333-333333333333';
const MODELO = {
  id: '22222222-2222-4222-8222-222222222222',
  nome: 'Atendente de loja',
  descricao: 'Para lojas com WhatsApp',
  revisao: 4,
  lacunas: ['[Nome da empresa]', '[Horário]', '[Site]'],
  ambiguas: ['[Site]'],
  arquivado: false,
  atualizadoEm: '2026-10-09T10:00:00Z',
  atualizadoPor: 'Junior',
  agentesCriados: 0,
};
const PUBLICADO = {
  id: '44444444-4444-4444-8444-444444444444',
  nome: 'Aurora',
  publicada: { id: 'v3', versao: 3, origem: 'publish', restauradaDe: null, nota: null, publicadaEm: '2026-10-08T10:00:00Z', publicadaPor: 'Junior' },
  rascunhoPendente: false,
  numeros: [],
};
const SEM_VERSAO = { ...PUBLICADO, id: '55555555-5555-4555-8555-555555555555', nome: 'Rascunho', publicada: null };

function responder(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
}

function servidor(opcoes: { modelos?: unknown[]; criar?: () => Promise<Response> } = {}) {
  const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (url === '/api/platform/agency/agent-templates') return responder({ modelos: opcoes.modelos ?? [MODELO] });
    if (url === '/api/platform/tenants') return responder({ tenants: [{ id: OUTRO, name: 'Loja B' }] });
    if (url === `/api/platform/tenants/${OUTRO}/agents`) return responder({ cliente: { id: OUTRO, nome: 'Loja B' }, agentes: [PUBLICADO, SEM_VERSAO] });
    if (url === `/api/platform/tenants/${TENANT}/agents` && metodo === 'POST') {
      return opcoes.criar ? opcoes.criar() : responder({ agenteId: 'novo-id' }, 201);
    }
    return responder({ error: 'nao esperado' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  return pedidos;
}

afterEach(() => vi.unstubAllGlobals());

const criados = () => vi.fn();
const botaoCriar = () => screen.getByRole('button', { name: /Criar/ });

describe('DialogoNovoAgente', () => {
  it('modelo: preenche o nome, mostra uma lacuna por campo e manda só ids, revisão e as respostas preenchidas', async () => {
    const pedidos = servidor();
    const onCriado = criados();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={onCriado} />);
    const seletor = await screen.findByLabelText('Modelo');
    fireEvent.change(seletor, { target: { value: MODELO.id } });
    expect(screen.getByLabelText('Nome do agente')).toHaveValue('Atendente de loja');
    expect(screen.getByText('Para lojas com WhatsApp')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('[Nome da empresa]'), { target: { value: 'Loja Sol' } });
    expect(screen.getByLabelText('[Horário]')).toHaveValue('');
    expect(screen.getByLabelText('[Site]')).toBeDisabled();
    expect(screen.getByText(/também aparece como texto de um link/)).toBeInTheDocument();
    fireEvent.click(botaoCriar());
    await waitFor(() => expect(onCriado).toHaveBeenCalledWith('novo-id'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      nome: 'Atendente de loja',
      inicio: { tipo: 'modelo', modeloId: MODELO.id, revisaoDoModelo: 4, respostas: { '[Nome da empresa]': 'Loja Sol' } },
    });
  });

  it('resposta com chave ou colchete mostra o erro e trava o Criar antes de enviar', async () => {
    const pedidos = servidor();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={criados()} />);
    fireEvent.change(await screen.findByLabelText('Modelo'), { target: { value: MODELO.id } });
    fireEvent.change(screen.getByLabelText('[Horário]'), { target: { value: '{{contactName}}' } });
    expect(screen.getByText('A resposta não pode ter chaves nem colchetes.')).toBeInTheDocument();
    expect(botaoCriar()).toBeDisabled();
    fireEvent.click(botaoCriar());
    expect(pedidos.some((p) => p.metodo === 'POST')).toBe(false);
  });

  it('sem modelos: a opção fica desabilitada com o aviso, e o padrão em branco manda só o tipo', async () => {
    const pedidos = servidor({ modelos: [] });
    const onCriado = criados();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={onCriado} />);
    expect(await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.')).toBeInTheDocument();
    expect(screen.getByLabelText('Modelo da agência')).toBeDisabled();
    expect(screen.getByLabelText('Padrão em branco')).toBeChecked();
    expect(botaoCriar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: '  Atendente  ' } });
    fireEvent.click(botaoCriar());
    await waitFor(() => expect(onCriado).toHaveBeenCalled());
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({ nome: 'Atendente', inicio: { tipo: 'branco' } });
  });

  it('cópia: lista só agentes publicados do cliente de origem e diz de onde para onde', async () => {
    const pedidos = servidor();
    const onCriado = criados();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={onCriado} />);
    await screen.findByLabelText('Modelo');
    fireEvent.click(screen.getByLabelText('Copiar de outro agente'));
    fireEvent.change(await screen.findByLabelText('Cliente de origem'), { target: { value: OUTRO } });
    const agente = await screen.findByLabelText('Agente');
    await screen.findByRole('option', { name: 'Aurora' });
    expect(screen.queryByRole('option', { name: 'Rascunho' })).toBeNull();
    fireEvent.change(agente, { target: { value: PUBLICADO.id } });
    expect(screen.getByText('Copiar a versão 3 de Aurora, do cliente Loja B, para o cliente Loja A.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Aurora da A' } });
    fireEvent.click(botaoCriar());
    await waitFor(() => expect(onCriado).toHaveBeenCalled());
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      nome: 'Aurora da A',
      inicio: { tipo: 'copia', clienteDeOrigemId: OUTRO, agenteId: PUBLICADO.id, versaoEsperada: 3 },
    });
  });

  it('erro do servidor aparece; 409 do modelo recarrega a lista e limpa a escolha', async () => {
    const pedidos = servidor({ criar: () => responder({ error: 'O modelo foi alterado por outra pessoa.', code: 'MODELO_MUDOU' }, 409) });
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={criados()} />);
    fireEvent.change(await screen.findByLabelText('Modelo'), { target: { value: MODELO.id } });
    fireEvent.click(botaoCriar());
    expect(await screen.findByRole('alert')).toHaveTextContent('O modelo foi alterado por outra pessoa.');
    await waitFor(() => expect(pedidos.filter((p) => p.url === '/api/platform/agency/agent-templates')).toHaveLength(2));
    expect(screen.getByLabelText('Modelo')).toHaveValue('');
  });
});
