// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bloco 2 (PLAN-bloco-2.md, Task 5): as rotas da biblioteca de modelos. A porta (`abrirRotaDaAgencia`) é a de verdade;
 * só a sessão, o perfil e a camada de servidor são falsos. Toda rota que escreve recusa origem de fora ANTES de abrir
 * sessão (rodada 1 do Codex na SPEC, achado 2).
 */
const MODELO = '22222222-2222-4222-8222-222222222222';
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '44444444-4444-4444-8444-444444444444';
const ADMIN = { papel: 'admin' };

const mocks = vi.hoisted(() => ({
  isAllowedOrigin: vi.fn(),
  getUser: vi.fn(),
  perfil: vi.fn(),
  listarModelos: vi.fn(),
  lerModelo: vi.fn(),
  salvarModelo: vi.fn(),
  criarModeloDeAgente: vi.fn(),
  arquivarModelo: vi.fn(),
}));

const USUARIO = {
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.perfil }) }) }),
};

vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: mocks.isAllowedOrigin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => USUARIO,
  createStaticAdminClient: () => ADMIN,
}));
vi.mock('@/lib/agents/modelosAgentes', () => ({
  listarModelos: mocks.listarModelos,
  lerModelo: mocks.lerModelo,
  salvarModelo: mocks.salvarModelo,
  criarModeloDeAgente: mocks.criarModeloDeAgente,
  arquivarModelo: mocks.arquivarModelo,
}));

import { GET as listar, POST as criar } from './route';
import { GET as ler, PUT as salvar } from './[templateId]/route';
import { POST as arquivar } from './[templateId]/archive/route';

const CLIENTES = { usuario: USUARIO, admin: ADMIN };

function pedir(metodo: string, corpo?: unknown, url = 'http://localhost/api/platform/agency/agent-templates') {
  return new Request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    ...(corpo === undefined ? {} : { body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }),
  });
}
const doModelo = (templateId = MODELO) => ({ params: Promise.resolve({ templateId }) });

const escritas = () => [
  { nome: 'criar', chamar: () => criar(pedir('POST', { nome: 'M', prompt: 'Oi' })), lib: mocks.salvarModelo },
  { nome: 'salvar', chamar: () => salvar(pedir('PUT', { nome: 'M', prompt: 'Oi', revisaoEsperada: 1 }), doModelo()), lib: mocks.salvarModelo },
  { nome: 'arquivar', chamar: () => arquivar(pedir('POST', { arquivar: true, revisaoEsperada: 1 }), doModelo()), lib: mocks.arquivarModelo },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAllowedOrigin.mockReturnValue(true);
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'p1' } } });
  mocks.perfil.mockResolvedValue({ data: { id: 'p1', role: 'agency_admin' } });
  for (const fn of [mocks.listarModelos, mocks.lerModelo, mocks.salvarModelo, mocks.criarModeloDeAgente, mocks.arquivarModelo]) {
    fn.mockResolvedValue({ ok: true, dados: { feito: true } });
  }
});

describe('rotas dos modelos da agência', () => {
  it('origem de fora: 403 em CADA escrita, antes de abrir sessão, e nada é escrito', async () => {
    mocks.isAllowedOrigin.mockReturnValue(false);
    for (const e of escritas()) {
      const r = await e.chamar();
      expect(r.status, e.nome).toBe(403);
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.salvarModelo).not.toHaveBeenCalled();
    expect(mocks.arquivarModelo).not.toHaveBeenCalled();
    // Leitura não depende da origem.
    expect((await listar(pedir('GET'))).status).toBe(200);
  });

  it('sem sessão: 401; papel de cliente ou da equipe: 403; nas leituras e nas escritas', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await listar(pedir('GET'))).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'p1' } } });
    for (const papel of ['clinic_admin', 'agency_staff', 'vendedor']) {
      mocks.perfil.mockResolvedValue({ data: { id: 'p1', role: papel } });
      expect((await listar(pedir('GET'))).status, papel).toBe(403);
      expect((await ler(pedir('GET'), doModelo())).status, papel).toBe(403);
      for (const e of escritas()) expect((await e.chamar()).status, `${papel} ${e.nome}`).toBe(403);
    }
    expect(mocks.listarModelos).not.toHaveBeenCalled();
    expect(mocks.salvarModelo).not.toHaveBeenCalled();
  });

  it('lista: só arquivados=0|1; outro parâmetro é 400', async () => {
    await listar(pedir('GET', undefined, 'http://localhost/api/platform/agency/agent-templates?arquivados=1'));
    expect(mocks.listarModelos).toHaveBeenLastCalledWith(CLIENTES, { arquivados: true });
    await listar(pedir('GET'));
    expect(mocks.listarModelos).toHaveBeenLastCalledWith(CLIENTES, { arquivados: false });
    expect((await listar(pedir('GET', undefined, 'http://localhost/api/platform/agency/agent-templates?todos=1'))).status).toBe(400);
  });

  it('criar: com texto (salvar com id nulo) ou a partir de agente; os dois juntos ou campo a mais é 400', async () => {
    const r = await criar(pedir('POST', { nome: ' Loja ', descricao: '  ', prompt: 'Oi [Nome]' }));
    expect(r.status).toBe(201);
    expect(mocks.salvarModelo).toHaveBeenCalledWith(CLIENTES, { id: null, revisaoEsperada: null, nome: 'Loja', descricao: '', prompt: 'Oi [Nome]' });
    const deAgente = { tenantId: TENANT, agenteId: AGENTE, versaoEsperada: 3 };
    expect((await criar(pedir('POST', { nome: 'M', deAgente }))).status).toBe(201);
    expect(mocks.criarModeloDeAgente).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agenteId: AGENTE, versaoEsperada: 3, nome: 'M', descricao: null });
    vi.clearAllMocks();
    mocks.isAllowedOrigin.mockReturnValue(true);
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'p1' } } });
    mocks.perfil.mockResolvedValue({ data: { id: 'p1', role: 'agency_admin' } });
    for (const corpo of [
      { nome: 'M', prompt: 'Oi', deAgente },
      { nome: 'M', prompt: 'Oi', origin: { kind: 'blank' } },
      { nome: 'M', prompt: 'Oi', autor: 'eu' },
      { nome: 'M', prompt: '' },
      { nome: 'M', descricao: 'd'.repeat(281), prompt: 'Oi' },
    ]) {
      expect((await criar(pedir('POST', corpo))).status, JSON.stringify(corpo).slice(0, 60)).toBe(400);
    }
    expect(mocks.salvarModelo).not.toHaveBeenCalled();
    expect(mocks.criarModeloDeAgente).not.toHaveBeenCalled();
  });

  it('ler e salvar: id inválido é 400; salvar repassa a revisão e o 409 passa como está', async () => {
    expect((await ler(pedir('GET'), doModelo('abc'))).status).toBe(400);
    expect((await salvar(pedir('PUT', { nome: 'M', prompt: 'Oi', revisaoEsperada: 1 }), doModelo('../x'))).status).toBe(400);
    expect((await salvar(pedir('PUT', { nome: 'M', prompt: 'Oi' }), doModelo())).status).toBe(400);
    expect(mocks.salvarModelo).not.toHaveBeenCalled();
    mocks.salvarModelo.mockResolvedValueOnce({ ok: false, status: 409, codigo: 'MODELO_MUDOU', erro: 'Mudou.' });
    const conflito = await salvar(pedir('PUT', { nome: 'M', prompt: 'Oi', revisaoEsperada: 4 }), doModelo());
    expect(conflito.status).toBe(409);
    expect(await conflito.json()).toEqual({ error: 'Mudou.', code: 'MODELO_MUDOU' });
    expect(mocks.salvarModelo).toHaveBeenCalledWith(CLIENTES, { id: MODELO, revisaoEsperada: 4, nome: 'M', descricao: null, prompt: 'Oi' });
  });

  it('arquivar: corpo estrito e a revisão esperada repassada', async () => {
    expect((await arquivar(pedir('POST', { arquivar: 'sim', revisaoEsperada: 1 }), doModelo())).status).toBe(400);
    expect((await arquivar(pedir('POST', { arquivar: true }), doModelo())).status).toBe(400);
    expect((await arquivar(pedir('POST', { arquivar: false, revisaoEsperada: 5 }), doModelo())).status).toBe(200);
    expect(mocks.arquivarModelo).toHaveBeenCalledWith(CLIENTES, { id: MODELO, arquivar: false, revisaoEsperada: 5 });
  });

  it('corpo acima de 256 KB: 413', async () => {
    expect((await criar(pedir('POST', { nome: 'M', prompt: 'x'.repeat(300 * 1024) }))).status).toBe(413);
  });
});

describe('fonte das rotas do bloco 2: nenhuma escreve direto nem fala de origem', () => {
  const arquivos = [
    'app/api/platform/agency/agent-templates/route.ts',
    'app/api/platform/agency/agent-templates/[templateId]/route.ts',
    'app/api/platform/agency/agent-templates/[templateId]/archive/route.ts',
    'app/api/platform/tenants/[tenantId]/agents/route.ts',
    'lib/agents/rotaDaAgencia.ts',
  ];
  const fontes = arquivos.map((a) => [a, readFileSync(resolve(process.cwd(), a), 'utf8')] as const);

  it('caso positivo: o detector acha a porta de entrada em todas', () => {
    for (const [a, f] of fontes.slice(0, 4)) expect(f, a).toMatch(/abrirRota(DaAgencia|DoCliente)\(req, (\{ escreve|await ctx\.params)/);
  });
  it('sem insert, update, upsert, delete, rpc nem a palavra origin', () => {
    for (const [a, f] of fontes) {
      expect(f, a).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(f, a).not.toMatch(/\borigin\b/);
    }
  });
});
