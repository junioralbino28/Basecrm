// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Renomear e excluir agente (SPEC-renomear-excluir.md): as duas rotas novas, com a camada simulada. */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const VERSAO = '33333333-3333-4333-8333-333333333333';
const USUARIO = { papel: 'usuario' };
const ADMIN = { papel: 'admin' };
const CLIENTES = { usuario: USUARIO, admin: ADMIN };

const mocks = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(),
  isAllowedOrigin: vi.fn(),
  renomearAgente: vi.fn(),
  excluirAgente: vi.fn(),
}));

vi.mock('@/lib/platform/tenantAccess', () => ({ requireTenantAccess: mocks.requireTenantAccess }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: mocks.isAllowedOrigin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => USUARIO,
  createStaticAdminClient: () => ADMIN,
}));
vi.mock('@/lib/agents/editorAgentes', () => ({ renomearAgente: mocks.renomearAgente, excluirAgente: mocks.excluirAgente }));

import { POST as renomear } from './[agentId]/rename/route';
import { POST as excluir } from './[agentId]/delete/route';

function pedir(corpo?: unknown) {
  return new Request('http://localhost/api/platform/tenants/x/agents/y', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(corpo === undefined ? {} : { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }),
  });
}
const doAgente = (agentId = AGENTE) => ({ params: Promise.resolve({ tenantId: TENANT, agentId }) });
const ESPERADO = { nomeEsperado: 'Aurora', revisaoEsperada: 3, versaoPublicadaEsperada: VERSAO };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAllowedOrigin.mockReturnValue(true);
  mocks.requireTenantAccess.mockResolvedValue({ profile: { id: 'p1', role: 'agency_admin', organization_id: 'org-agencia' } });
  mocks.renomearAgente.mockResolvedValue({ ok: true, dados: { nome: 'Nome novo' } });
  mocks.excluirAgente.mockResolvedValue({ ok: true, dados: { versoesExcluidas: 2 } });
});

describe('POST rename e POST delete do agente', () => {
  it('outra origem: 403 e nada é chamado', async () => {
    mocks.isAllowedOrigin.mockReturnValue(false);
    expect((await renomear(pedir({ nome: 'X' }), doAgente())).status).toBe(403);
    expect((await excluir(pedir(ESPERADO), doAgente())).status).toBe(403);
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
    expect(mocks.renomearAgente).not.toHaveBeenCalled();
    expect(mocks.excluirAgente).not.toHaveBeenCalled();
  });

  it('agente fora do formato: 400, também com a origem recusada (a ordem real: endereço, origem, acesso, corpo)', async () => {
    for (const origemOk of [true, false]) {
      mocks.isAllowedOrigin.mockReturnValue(origemOk);
      expect((await renomear(pedir({ nome: 'X' }), doAgente('abc'))).status).toBe(400);
      expect((await excluir(pedir(ESPERADO), doAgente('../x'))).status).toBe(400);
    }
    expect(mocks.isAllowedOrigin).not.toHaveBeenCalled();
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
  });

  it('quem não é agência: 403 com adminOnly, e nada é chamado', async () => {
    mocks.requireTenantAccess.mockResolvedValue({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await renomear(pedir({ nome: 'X' }), doAgente())).status).toBe(403);
    expect((await excluir(pedir(ESPERADO), doAgente())).status).toBe(403);
    for (const chamada of mocks.requireTenantAccess.mock.calls) expect(chamada).toEqual([TENANT, { adminOnly: true }]);
    expect(mocks.renomearAgente).not.toHaveBeenCalled();
    expect(mocks.excluirAgente).not.toHaveBeenCalled();
  });

  it('corpo estrito: campo a mais, tipo errado, versão publicada que não é uuid nem null e corpo ilegível são 400', async () => {
    const casos: Array<[string, Promise<Response>]> = [
      ['renomear sem nome', renomear(pedir({}), doAgente())],
      ['renomear com extra', renomear(pedir({ nome: 'X', organizacao: TENANT }), doAgente())],
      ['renomear nome numero', renomear(pedir({ nome: 3 }), doAgente())],
      ['renomear nome longo', renomear(pedir({ nome: 'x'.repeat(201) }), doAgente())],
      ['renomear sem json', renomear(pedir('nao e json'), doAgente())],
      ['excluir sem corpo', excluir(pedir(), doAgente())],
      ['excluir sem esperado', excluir(pedir({ nomeEsperado: 'A' }), doAgente())],
      ['excluir revisao texto', excluir(pedir({ ...ESPERADO, revisaoEsperada: '3' }), doAgente())],
      ['excluir revisao negativa', excluir(pedir({ ...ESPERADO, revisaoEsperada: -1 }), doAgente())],
      ['excluir versao nao uuid', excluir(pedir({ ...ESPERADO, versaoPublicadaEsperada: 'v1' }), doAgente())],
      ['excluir com extra', excluir(pedir({ ...ESPERADO, forcar: true }), doAgente())],
    ];
    for (const [nome, resposta] of casos) expect((await resposta).status, nome).toBe(400);
    expect(mocks.renomearAgente).not.toHaveBeenCalled();
    expect(mocks.excluirAgente).not.toHaveBeenCalled();
  });

  it('caminho feliz: repassa o pedido com o cliente do usuário; versão publicada nula é aceita', async () => {
    const r = await renomear(pedir({ nome: '  Nome novo ' }), doAgente());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ nome: 'Nome novo' });
    expect(mocks.renomearAgente).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, nome: '  Nome novo ' });

    const e = await excluir(pedir({ ...ESPERADO, versaoPublicadaEsperada: null }), doAgente());
    expect(e.status).toBe(200);
    expect(await e.json()).toEqual({ excluido: true, versoesExcluidas: 2 });
    expect(mocks.excluirAgente).toHaveBeenCalledWith(CLIENTES, {
      tenantId: TENANT, agentId: AGENTE, nomeEsperado: 'Aurora', revisaoEsperada: 3, versaoPublicadaEsperada: null,
    });
  });

  it('corpo acima de 4 KB: 413, lido em fluxo antes do JSON, e nada é chamado (rodada 1 do código, achado 2)', async () => {
    const grande = 'x'.repeat(5 * 1024);
    expect((await renomear(pedir({ nome: grande }), doAgente())).status).toBe(413);
    expect((await excluir(pedir({ ...ESPERADO, nomeEsperado: grande }), doAgente())).status).toBe(413);
    expect(mocks.renomearAgente).not.toHaveBeenCalled();
    expect(mocks.excluirAgente).not.toHaveBeenCalled();
  });

  it('o 409 da camada passa com código e mensagem', async () => {
    mocks.excluirAgente.mockResolvedValueOnce({ ok: false, status: 409, codigo: 'AGENTE_MUDOU', erro: 'O agente mudou.' });
    const r = await excluir(pedir(ESPERADO), doAgente());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'O agente mudou.', code: 'AGENTE_MUDOU' });
  });
});
