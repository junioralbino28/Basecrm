// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const USUARIO = { papel: 'usuario' };
const ADMIN = { papel: 'admin' };
const CLIENTES = { usuario: USUARIO, admin: ADMIN };

const mocks = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(),
  isAllowedOrigin: vi.fn(),
  listarAgentes: vi.fn(),
  lerAgente: vi.fn(),
  listarVersoes: vi.fn(),
  lerVersao: vi.fn(),
  salvarRascunho: vi.fn(),
  publicarComVerificacao: vi.fn(),
  restaurarVersao: vi.fn(),
}));

vi.mock('@/lib/platform/tenantAccess', () => ({ requireTenantAccess: mocks.requireTenantAccess }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: mocks.isAllowedOrigin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => USUARIO,
  createStaticAdminClient: () => ADMIN,
}));
vi.mock('@/lib/agents/editorAgentes', () => ({
  listarAgentes: mocks.listarAgentes,
  lerAgente: mocks.lerAgente,
  listarVersoes: mocks.listarVersoes,
  lerVersao: mocks.lerVersao,
  salvarRascunho: mocks.salvarRascunho,
  publicarComVerificacao: mocks.publicarComVerificacao,
  restaurarVersao: mocks.restaurarVersao,
}));

import { GET as listar } from './route';
import { GET as ler } from './[agentId]/route';
import { PUT as salvar } from './[agentId]/draft/route';
import { POST as publicar } from './[agentId]/publish/route';
import { POST as restaurar } from './[agentId]/restore/route';
import { GET as versoes } from './[agentId]/versions/route';
import { GET as versao } from './[agentId]/versions/[version]/route';

function pedir(metodo: string, corpo?: unknown) {
  return new Request('http://localhost/api/platform/tenants/x/agents', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    ...(corpo === undefined ? {} : { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }),
  });
}
const doCliente = (tenantId = TENANT) => ({ params: Promise.resolve({ tenantId }) });
const doAgente = (agentId = AGENTE) => ({ params: Promise.resolve({ tenantId: TENANT, agentId }) });
const daVersao = (version: string) => ({ params: Promise.resolve({ tenantId: TENANT, agentId: AGENTE, version }) });

const todas = () => [
  { nome: 'listar', chamar: () => listar(pedir('GET'), doCliente()), lib: mocks.listarAgentes },
  { nome: 'ler', chamar: () => ler(pedir('GET'), doAgente()), lib: mocks.lerAgente },
  { nome: 'salvar', chamar: () => salvar(pedir('PUT', { prompt: 'x', revisao: 0 }), doAgente()), lib: mocks.salvarRascunho },
  { nome: 'publicar', chamar: () => publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente()), lib: mocks.publicarComVerificacao },
  { nome: 'restaurar', chamar: () => restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1 }), doAgente()), lib: mocks.restaurarVersao },
  { nome: 'versoes', chamar: () => versoes(pedir('GET'), doAgente()), lib: mocks.listarVersoes },
  { nome: 'versao', chamar: () => versao(pedir('GET'), daVersao('1')), lib: mocks.lerVersao },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAllowedOrigin.mockReturnValue(true);
  mocks.requireTenantAccess.mockResolvedValue({ profile: { id: 'p1', role: 'agency_admin', organization_id: 'org-agencia' } });
  for (const fn of [mocks.listarAgentes, mocks.lerAgente, mocks.listarVersoes, mocks.lerVersao, mocks.salvarRascunho, mocks.publicarComVerificacao, mocks.restaurarVersao]) {
    fn.mockResolvedValue({ ok: true, dados: { lido: true } });
  }
});

describe('rotas da Central de Agentes', () => {
  it('todas pedem agência (adminOnly): o admin do cliente recebe 403 e nada é lido nem escrito', async () => {
    mocks.requireTenantAccess.mockResolvedValue({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    for (const c of todas()) {
      const r = await c.chamar();
      expect(r.status, c.nome).toBe(403);
      expect(c.lib, c.nome).not.toHaveBeenCalled();
    }
    expect(mocks.requireTenantAccess).toHaveBeenCalledTimes(7);
    for (const chamada of mocks.requireTenantAccess.mock.calls) expect(chamada).toEqual([TENANT, { adminOnly: true }]);
  });

  it('id inválido no endereço: 400 antes de qualquer acesso', async () => {
    expect((await listar(pedir('GET'), doCliente('abc'))).status).toBe(400);
    expect((await ler(pedir('GET'), doAgente('abc'))).status).toBe(400);
    expect((await salvar(pedir('PUT', { prompt: 'x', revisao: 0 }), doAgente('../x'))).status).toBe(400);
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
  });

  it('escrita de outra origem: 403; leitura não depende da origem', async () => {
    mocks.isAllowedOrigin.mockReturnValue(false);
    for (const c of todas().filter((t) => ['salvar', 'publicar', 'restaurar'].includes(t.nome))) {
      expect((await c.chamar()).status, c.nome).toBe(403);
      expect(c.lib, c.nome).not.toHaveBeenCalled();
    }
    expect((await listar(pedir('GET'), doCliente())).status).toBe(200);
  });

  it('campo fora da lista, tipo errado ou corpo ilegível: 400, e nada é escrito', async () => {
    const casos: Array<[string, Promise<Response>]> = [
      ['salvar com autor', salvar(pedir('PUT', { prompt: 'x', revisao: 0, autor: 'eu' }), doAgente())],
      ['salvar vazio', salvar(pedir('PUT', { prompt: '', revisao: 0 }), doAgente())],
      ['salvar revisao negativa', salvar(pedir('PUT', { prompt: 'x', revisao: -1 }), doAgente())],
      ['salvar sem json', salvar(pedir('PUT', 'nao e json'), doAgente())],
      ['salvar acima do teto', salvar(pedir('PUT', { prompt: 'x'.repeat(50_001), revisao: 0 }), doAgente())],
      ['publicar com publishedBy', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, publishedBy: 'x' }), doAgente())],
      // G5/G19: nesta fatia o publicar não recebe ajustes nem modelo (a versão nova copia os da publicada);
      // a fatia 4 abre esses campos com lista fechada de chaves. Até lá, mandar qualquer um é 400.
      ['publicar com settings', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, settings: { temperatura: 2 } }), doAgente())],
      ['publicar com model', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, model: 'outro-modelo' }), doAgente())],
      ['publicar nota longa', publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, nota: 'n'.repeat(201) }), doAgente())],
      ['restaurar com extra', restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1, extra: true }), doAgente())],
      ['restaurar versao 0', restaurar(pedir('POST', { versao: 0, versaoEsperada: 2, revisao: 1 }), doAgente())],
    ];
    for (const [nome, resposta] of casos) expect((await resposta).status, nome).toBe(400);
    expect(mocks.salvarRascunho).not.toHaveBeenCalled();
    expect(mocks.publicarComVerificacao).not.toHaveBeenCalled();
    expect(mocks.restaurarVersao).not.toHaveBeenCalled();
  });

  it('salvar usa o cliente do usuário e devolve a revisão; o 409 do banco passa com código e mensagem', async () => {
    mocks.salvarRascunho.mockResolvedValueOnce({ ok: true, dados: { revisao: 1 } });
    const ok = await salvar(pedir('PUT', { prompt: 'texto', revisao: 0 }), doAgente());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ revisao: 1 });
    expect(mocks.salvarRascunho).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, revisao: 0, prompt: 'texto' });

    mocks.salvarRascunho.mockResolvedValueOnce({ ok: false, status: 409, codigo: 'RASCUNHO_MUDOU', erro: 'O rascunho foi alterado.' });
    const conflito = await salvar(pedir('PUT', { prompt: 'texto', revisao: 0 }), doAgente());
    expect(conflito.status).toBe(409);
    expect(await conflito.json()).toEqual({ error: 'O rascunho foi alterado.', code: 'RASCUNHO_MUDOU' });
  });

  it('publicar repassa nota aparada e avisos confirmados; o 422 devolve a verificação para a tela', async () => {
    await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1, nota: '  abertura nova  ', confirmarAvisos: ['tamanho'] }), doAgente());
    expect(mocks.publicarComVerificacao).toHaveBeenLastCalledWith(CLIENTES, {
      tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: 'abertura nova', confirmarAvisos: ['tamanho'],
    });
    await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(mocks.publicarComVerificacao).toHaveBeenLastCalledWith(CLIENTES, {
      tenantId: TENANT, agentId: AGENTE, versaoEsperada: 1, revisao: 1, nota: null, confirmarAvisos: [],
    });

    const verificacao = { erros: [], avisos: [{ codigo: 'tamanho', nivel: 'aviso', mensagem: 'grande' }], informacoes: [] };
    mocks.publicarComVerificacao.mockResolvedValueOnce({ ok: false, status: 422, codigo: 'AVISOS_NAO_CONFIRMADOS', erro: 'Confirme.', verificacao });
    const r = await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ error: 'Confirme.', code: 'AVISOS_NAO_CONFIRMADOS', verificacao });

    // O 409 ao PUBLICAR (outra versão saiu no meio) passa com código e mensagem, como o do salvar.
    mocks.publicarComVerificacao.mockResolvedValueOnce({
      ok: false, status: 409, codigo: 'VERSAO_PUBLICADA_MUDOU', erro: 'Outra versão foi publicada enquanto você editava.',
    });
    const conflito = await publicar(pedir('POST', { versaoEsperada: 1, revisao: 1 }), doAgente());
    expect(conflito.status).toBe(409);
    expect(await conflito.json()).toEqual({ error: 'Outra versão foi publicada enquanto você editava.', code: 'VERSAO_PUBLICADA_MUDOU' });
  });

  it('restaurar repassa versão, versão esperada e revisão', async () => {
    mocks.restaurarVersao.mockResolvedValueOnce({ ok: true, dados: { versao: 3, versaoId: 'v3', revisao: 2 } });
    const r = await restaurar(pedir('POST', { versao: 1, versaoEsperada: 2, revisao: 1, nota: 'voltar' }), doAgente());
    expect(await r.json()).toEqual({ versao: 3, versaoId: 'v3', revisao: 2 });
    expect(mocks.restaurarVersao).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, versao: 1, versaoEsperada: 2, revisao: 1, nota: 'voltar' });
  });

  it('leituras devolvem o que a camada leu, no formato da tela; número de versão inválido é 400', async () => {
    expect(await (await listar(pedir('GET'), doCliente())).json()).toEqual({ lido: true });
    expect(await (await ler(pedir('GET'), doAgente())).json()).toEqual({ agente: { lido: true } });
    expect(await (await versoes(pedir('GET'), doAgente())).json()).toEqual({ lido: true });
    expect(mocks.listarVersoes).toHaveBeenLastCalledWith(CLIENTES, TENANT, AGENTE, { antesDe: undefined });
    const paginaSeguinte = new Request('http://localhost/api/platform/tenants/x/agents/y/versions?antesDe=6');
    expect((await versoes(paginaSeguinte, doAgente())).status).toBe(200);
    expect(mocks.listarVersoes).toHaveBeenLastCalledWith(CLIENTES, TENANT, AGENTE, { antesDe: 6 });
    for (const consulta of ['antesDe=abc', 'antesDe=0', 'limite=500']) {
      const r = await versoes(new Request(`http://localhost/api/platform/tenants/x/agents/y/versions?${consulta}`), doAgente());
      expect(r.status, consulta).toBe(400);
    }
    expect(await (await versao(pedir('GET'), daVersao('2'))).json()).toEqual({ versao: { lido: true } });
    expect(mocks.lerVersao).toHaveBeenCalledWith(CLIENTES, TENANT, AGENTE, 2);

    expect((await versao(pedir('GET'), daVersao('abc'))).status).toBe(400);
    expect((await versao(pedir('GET'), daVersao('1.5'))).status).toBe(400);
    expect(mocks.lerVersao).toHaveBeenCalledTimes(1);
  });
});
