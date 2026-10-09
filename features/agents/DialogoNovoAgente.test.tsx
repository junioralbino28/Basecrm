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
    expect(screen.getByText('Copiar a versão 3 de Aurora, do cliente Loja B (id 33333333), para o cliente Loja A.')).toBeInTheDocument();
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

describe('DialogoNovoAgente: cópia alcança cliente além dos 100 mais recentes (revisão do Codex, código, rodada 1)', () => {
  it('a busca por nome traz o cliente antigo, e a cópia sai com ele como origem', async () => {
    const ANTIGO = '66666666-6666-4666-8666-666666666666';
    const recentes = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: `Cliente ${i}` }));
    const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/platform/agency/agent-templates') return responder({ modelos: [] });
      if (url === '/api/platform/tenants') return responder({ tenants: recentes });
      if (url === '/api/platform/tenants?busca=Antiga') return responder({ tenants: [{ id: ANTIGO, name: 'Loja Antiga' }] });
      if (url === `/api/platform/tenants/${ANTIGO}/agents`) return responder({ cliente: { id: ANTIGO, nome: 'Loja Antiga' }, agentes: [PUBLICADO] });
      if (url === `/api/platform/tenants/${TENANT}/agents` && metodo === 'POST') return responder({ agenteId: 'novo-id' }, 201);
      return responder({ error: 'nao esperado' }, 500);
    }));
    const onCriado = vi.fn();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={onCriado} />);
    await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.');
    fireEvent.click(screen.getByLabelText('Copiar de outro agente'));
    await screen.findByRole('option', { name: 'Cliente 99 (id id-99)' });
    expect(screen.queryByRole('option', { name: 'Loja Antiga (id 66666666)' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'Antiga' } });
    await screen.findByRole('option', { name: 'Loja Antiga (id 66666666)' }, { timeout: 2000 });
    fireEvent.change(screen.getByLabelText('Cliente de origem'), { target: { value: ANTIGO } });
    await screen.findByRole('option', { name: 'Aurora' });
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: PUBLICADO.id } });
    fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Copia da antiga' } });
    fireEvent.click(botaoCriar());
    await waitFor(() => expect(onCriado).toHaveBeenCalledWith('novo-id'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      nome: 'Copia da antiga',
      inicio: { tipo: 'copia', clienteDeOrigemId: ANTIGO, agenteId: PUBLICADO.id, versaoEsperada: 3 },
    });
  });
});

describe('DialogoNovoAgente: "Mostrar mais clientes" (revisão do Codex, código, rodada 2, achado 3)', () => {
  const ALVO = '77777777-7777-4777-8777-777777777777';
  const CURSOR = { antesDe: '2026-01-01T00:00:00.000001+00:00', antesDeId: 'id-99' };
  const paginaSeguinte = `/api/platform/tenants?${new URLSearchParams({ antesDe: CURSOR.antesDe, antesDeId: CURSOR.antesDeId }).toString()}`;
  // 100 clientes com o MESMO nome do alvo: a busca por nome não o separa, só a página seguinte o alcança.
  const iguais = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: 'Loja', created_at: '2026-01-02T12:00:00Z' }));
  const opcoesLoja = () => screen.getAllByRole('option').filter((o) => (o.textContent ?? '').startsWith('Loja ('));

  it('traz a página seguinte, junta à lista, e a cópia sai com o cliente que estava nela', async () => {
    const pedidos: Array<{ url: string; metodo: string; corpo: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === '/api/platform/agency/agent-templates') return responder({ modelos: [] });
      if (url === '/api/platform/tenants') return responder({ tenants: iguais, proxima: CURSOR });
      if (url === paginaSeguinte) return responder({ tenants: [{ id: ALVO, name: 'Loja', created_at: '2025-01-02T12:00:00Z' }], proxima: null });
      if (url === `/api/platform/tenants/${ALVO}/agents`) return responder({ cliente: { id: ALVO, nome: 'Loja' }, agentes: [PUBLICADO] });
      if (url === `/api/platform/tenants/${TENANT}/agents` && metodo === 'POST') return responder({ agenteId: 'novo-id' }, 201);
      return responder({ error: 'nao esperado' }, 500);
    }));
    const onCriado = vi.fn();
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={onCriado} />);
    await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.');
    fireEvent.click(screen.getByLabelText('Copiar de outro agente'));
    await waitFor(() => expect(opcoesLoja()).toHaveLength(100));
    expect(screen.getByLabelText('Cliente de origem').querySelector(`option[value="${ALVO}"]`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar mais clientes' }));
    await waitFor(() => expect(opcoesLoja()).toHaveLength(101));
    // Homônimos se distinguem na tela: cada rótulo é único e o do alvo traz a data (Brasília) e o começo do id.
    expect(new Set(opcoesLoja().map((o) => o.textContent)).size).toBe(101);
    expect(screen.getByRole('option', { name: 'Loja (criado em 02/01/2025 às 09:00, id 77777777)' })).toHaveValue(ALVO);
    expect(pedidos.some((p) => p.url === paginaSeguinte)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mostrar mais clientes' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Cliente de origem'), { target: { value: ALVO } });
    await screen.findByRole('option', { name: 'Aurora' });
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: PUBLICADO.id } });
    expect(
      screen.getByText('Copiar a versão 3 de Aurora, do cliente Loja (criado em 02/01/2025 às 09:00, id 77777777), para o cliente Loja A.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome do agente'), { target: { value: 'Copia da pagina 2' } });
    fireEvent.click(botaoCriar());
    await waitFor(() => expect(onCriado).toHaveBeenCalledWith('novo-id'));
    expect(pedidos.find((p) => p.metodo === 'POST')?.corpo).toEqual({
      nome: 'Copia da pagina 2',
      inicio: { tipo: 'copia', clienteDeOrigemId: ALVO, agenteId: PUBLICADO.id, versaoEsperada: 3 },
    });
  });

  it('uma busca nova descarta a página seguinte que chegar atrasada', async () => {
    let soltarPagina: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/platform/agency/agent-templates') return responder({ modelos: [] });
      if (url === '/api/platform/tenants') return responder({ tenants: iguais, proxima: CURSOR });
      if (url === paginaSeguinte) return new Promise<Response>((resolve) => { soltarPagina = resolve; });
      if (url === '/api/platform/tenants?busca=Sol') return responder({ tenants: [{ id: 'sol', name: 'Loja Sol' }], proxima: null });
      return responder({ error: 'nao esperado' }, 500);
    }));
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={vi.fn()} />);
    await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.');
    fireEvent.click(screen.getByLabelText('Copiar de outro agente'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mostrar mais clientes' }));
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'Sol' } });
    await screen.findByRole('option', { name: 'Loja Sol (id sol)' }, { timeout: 2000 });
    soltarPagina(new Response(JSON.stringify({ tenants: [{ id: ALVO, name: 'Loja Atrasada' }], proxima: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('option', { name: /Loja Atrasada/ })).toBeNull();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Escolha o cliente', 'Loja Sol (id sol)']);
  });

  it('busca nova com página antiga ainda pendente: o "Mostrar mais" da busca nova não fica travado (rodada 3, achado 1)', async () => {
    const CURSOR_SOL = { antesDe: '2025-06-01T00:00:00+00:00', antesDeId: 's0000099' };
    const solMais = `/api/platform/tenants?${new URLSearchParams({ busca: 'Sol', antesDe: CURSOR_SOL.antesDe, antesDeId: CURSOR_SOL.antesDeId }).toString()}`;
    const sois = Array.from({ length: 100 }, (_, i) => ({ id: `s${String(i).padStart(7, '0')}`, name: 'Loja Sol' }));
    const pedidos: string[] = [];
    let soltarAntiga: (r: Response) => void = () => undefined;
    let soltarNova: (r: Response) => void = () => undefined;
    const corpo = (dados: unknown) => new Response(JSON.stringify(dados), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      pedidos.push(url);
      if (url === '/api/platform/agency/agent-templates') return responder({ modelos: [] });
      if (url === '/api/platform/tenants') return responder({ tenants: iguais, proxima: CURSOR });
      if (url === paginaSeguinte) return new Promise<Response>((resolve) => { soltarAntiga = resolve; });
      if (url === '/api/platform/tenants?busca=Sol') return responder({ tenants: sois, proxima: CURSOR_SOL });
      if (url === solMais) return new Promise<Response>((resolve) => { soltarNova = resolve; });
      return responder({ error: 'nao esperado' }, 500);
    }));
    render(<DialogoNovoAgente tenantId={TENANT} clienteNome="Loja A" onFechar={() => undefined} onCriado={vi.fn()} />);
    await screen.findByText('Nenhum modelo ainda. Crie em Modelos de agente.');
    fireEvent.click(screen.getByLabelText('Copiar de outro agente'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mostrar mais clientes' }));
    expect(await screen.findByRole('button', { name: 'Carregando mais clientes...' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'Sol' } });
    await screen.findByRole('option', { name: 'Loja Sol (id s0000099)' }, { timeout: 2000 });
    const mais = await screen.findByRole('button', { name: 'Mostrar mais clientes' });
    expect(mais).toBeEnabled();
    fireEvent.click(mais);
    expect(await screen.findByRole('button', { name: 'Carregando mais clientes...' })).toBeDisabled();
    expect(pedidos).toContain(solMais);
    // A página da busca ANTIGA chega agora: não pode reabrir o botão enquanto a da busca nova ainda carrega.
    soltarAntiga(corpo({ tenants: [{ id: 'velha', name: 'Loja Velha' }], proxima: null }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: 'Carregando mais clientes...' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: /Loja Velha/ })).toBeNull();
    soltarNova(corpo({ tenants: [{ id: 'sol-alvo', name: 'Loja Sol' }], proxima: null }));
    await screen.findByRole('option', { name: 'Loja Sol (id sol-alvo)' });
    expect(screen.queryByRole('button', { name: /Mostrar mais clientes|Carregando mais clientes/ })).toBeNull();
  });
});
