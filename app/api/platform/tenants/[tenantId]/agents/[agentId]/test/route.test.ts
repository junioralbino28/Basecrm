// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENTE = '22222222-2222-4222-8222-222222222222';
const PERFIL = 'p1';

const mocks = vi.hoisted(() => ({
  requireTenantAccess: vi.fn(),
  isAllowedOrigin: vi.fn(),
  rpc: vi.fn(),
  generateAgentReplyPreview: vi.fn(),
  explicarRespostaDoTeste: vi.fn(),
}));

const USUARIO = { papel: 'usuario' };
const ADMIN = { papel: 'admin', rpc: mocks.rpc };
const CLIENTES = { usuario: USUARIO, admin: ADMIN };

vi.mock('@/lib/platform/tenantAccess', () => ({ requireTenantAccess: mocks.requireTenantAccess }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: mocks.isAllowedOrigin }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => USUARIO,
  createStaticAdminClient: () => ADMIN,
}));
vi.mock('@/lib/agents/testeDoAgente', () => ({
  generateAgentReplyPreview: mocks.generateAgentReplyPreview,
  explicarRespostaDoTeste: mocks.explicarRespostaDoTeste,
}));

import { POST as testar } from './route';
import { POST as explicar } from './explain/route';

const ASSINATURA = 'a'.repeat(64);
const CORPO_DO_TESTE = { revisao: 3, mensagens: [{ autor: 'lead', texto: '  oi, quanto custa?  ' }] };
const CORPO_DA_EXPLICACAO = {
  revisao: 3,
  retrato: { prompt: 'prompt renderizado', provedor: 'google', modelo: 'gemini-3-flash', expiraEm: 1_900_000_000_000, assinatura: ASSINATURA },
  resposta: { partes: ['Oi! Custa R$ 100.'], repasse: null },
};

function pedir(corpo: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/platform/tenants/x/agents/y/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}
const doAgente = (agentId = AGENTE) => ({ params: Promise.resolve({ tenantId: TENANT, agentId }) });

const rotas = () => [
  { nome: 'teste', chamar: (c: unknown = CORPO_DO_TESTE) => testar(pedir(c), doAgente()), motor: mocks.generateAgentReplyPreview, corpo: CORPO_DO_TESTE },
  { nome: 'explicacao', chamar: (c: unknown = CORPO_DA_EXPLICACAO) => explicar(pedir(c), doAgente()), motor: mocks.explicarRespostaDoTeste, corpo: CORPO_DA_EXPLICACAO },
];

const libera = () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
const recusaComEspera = (segundos: number) => ({ data: [{ allowed: false, retry_after_seconds: segundos }], error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAllowedOrigin.mockReturnValue(true);
  mocks.requireTenantAccess.mockResolvedValue({ profile: { id: PERFIL, role: 'agency_admin', organization_id: 'org-agencia' } });
  mocks.rpc.mockResolvedValue(libera());
  mocks.generateAgentReplyPreview.mockResolvedValue({ ok: true, dados: { partes: ['Oi!'] } });
  mocks.explicarRespostaDoTeste.mockResolvedValue({ ok: true, dados: { explicacao: 'Porque o prompt manda.' } });
});

describe('rotas do teste sem enviar e da explicação', () => {
  it('pedem agência (adminOnly): agency_staff e o admin do cliente recebem 403, e nem limite nem modelo rodam', async () => {
    mocks.requireTenantAccess.mockResolvedValue({ error: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    for (const r of rotas()) {
      expect((await r.chamar()).status, r.nome).toBe(403);
      expect(r.motor, r.nome).not.toHaveBeenCalled();
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const chamada of mocks.requireTenantAccess.mock.calls) expect(chamada).toEqual([TENANT, { adminOnly: true }]);
  });

  it('origem estranha: 403 antes de qualquer acesso; id inválido no endereço: 400', async () => {
    mocks.isAllowedOrigin.mockReturnValue(false);
    for (const r of rotas()) expect((await r.chamar()).status, r.nome).toBe(403);
    mocks.isAllowedOrigin.mockReturnValue(true);
    expect((await testar(pedir(CORPO_DO_TESTE), doAgente('../x'))).status).toBe(400);
    expect((await explicar(pedir(CORPO_DA_EXPLICACAO), doAgente('abc'))).status).toBe(400);
    expect(mocks.requireTenantAccess).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('perfil sem id (defesa): 403 e nenhum limite consumido', async () => {
    mocks.requireTenantAccess.mockResolvedValue({ profile: undefined });
    for (const r of rotas()) expect((await r.chamar()).status, r.nome).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('corpo do teste fora do contrato: 400, e o limite NÃO é consumido', async () => {
    const lead = (texto: string) => ({ autor: 'lead', texto });
    const casos: Array<[string, unknown]> = [
      ['campo fora da lista', { ...CORPO_DO_TESTE, prompt: 'outro prompt' }],
      ['autor fora da lista', { revisao: 3, mensagens: [{ autor: 'sistema', texto: 'x' }] }],
      ['lead com 2.001 caracteres', { revisao: 3, mensagens: [lead('x'.repeat(2_001))] }],
      ['31 mensagens', { revisao: 3, mensagens: Array.from({ length: 31 }, () => lead('oi')) }],
      ['última do agente', { revisao: 3, mensagens: [lead('oi'), { autor: 'agente', texto: 'olá' }] }],
      ['sem mensagens', { revisao: 3, mensagens: [] }],
      ['mensagem só de espaços', { revisao: 3, mensagens: [lead('   ')] }],
      ['número que não é uuid', { ...CORPO_DO_TESTE, numeroId: 'abc' }],
      ['corpo que não é JSON', 'nao e json'],
    ];
    for (const [nome, corpo] of casos) expect((await testar(pedir(corpo), doAgente())).status, nome).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.generateAgentReplyPreview).not.toHaveBeenCalled();
  });

  it('content-length acima do teto: 413 sem ler o corpo', async () => {
    // highWaterMark 0: o fluxo só chama `pull` quando alguém lê; sem isso ele se adianta ao nascer e o detector mente.
    const pedirComCorpoVigiado = (contentLength: number) => {
      const vigia = { lido: false };
      const corpo = new ReadableStream<Uint8Array>(
        {
          pull(c) {
            vigia.lido = true;
            c.enqueue(new TextEncoder().encode(JSON.stringify(CORPO_DO_TESTE)));
            c.close();
          },
        },
        { highWaterMark: 0 },
      );
      const req = new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(contentLength) },
        body: corpo,
        duplex: 'half',
      } as RequestInit);
      return { req, vigia };
    };

    // Caso positivo: com o tamanho declarado dentro do teto, a rota lê e o detector enxerga a leitura.
    const dentro = pedirComCorpoVigiado(JSON.stringify(CORPO_DO_TESTE).length);
    expect((await testar(dentro.req, doAgente())).status).toBe(200);
    expect(dentro.vigia.lido).toBe(true);
    mocks.rpc.mockClear();

    const acima = pedirComCorpoVigiado(512 * 1024 + 1);
    const r = await testar(acima.req, doAgente());
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: 'Pedido grande demais.', code: 'CORPO_GRANDE' });
    expect(acima.vigia.lido).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('corpo SEM content-length que passa do teto: 413, e a leitura é interrompida', async () => {
    const pedaco = new Uint8Array(100 * 1024).fill(0x20);
    let entregues = 0;
    let cancelado = false;
    const corpo = new ReadableStream<Uint8Array>({
      pull(c) {
        entregues += 1;
        if (entregues > 50) c.close();
        else c.enqueue(pedaco);
      },
      cancel() {
        cancelado = true;
      },
    });
    const req = new Request('http://localhost/x', { method: 'POST', body: corpo, duplex: 'half' } as RequestInit);
    expect(req.headers.get('content-length')).toBeNull();
    const r = await testar(req, doAgente());
    expect(r.status).toBe(413);
    expect(cancelado).toBe(true);
    expect(entregues).toBeLessThan(10);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('a explicação aceita até 1 MB e recusa acima disso', async () => {
    const grande = { ...CORPO_DA_EXPLICACAO, retrato: { ...CORPO_DA_EXPLICACAO.retrato, prompt: 'p'.repeat(190_000) } };
    expect((await explicar(pedir(grande), doAgente())).status).toBe(200);
    const req = pedir(CORPO_DA_EXPLICACAO, { 'content-length': String(1024 * 1024 + 1) });
    expect((await explicar(req, doAgente())).status).toBe(413);
  });

  it('consome os três baldes na ordem, com as chaves e os números do D6', async () => {
    for (const r of rotas()) {
      mocks.rpc.mockClear();
      expect((await r.chamar()).status, r.nome).toBe(200);
      expect(mocks.rpc.mock.calls, r.nome).toEqual([
        ['consume_conversation_ai_rate_limit', { p_scope_key: `central-agentes:teste:pessoa:${PERFIL}`, p_limit: 20, p_window_seconds: 600 }],
        ['consume_conversation_ai_rate_limit', { p_scope_key: `central-agentes:teste:rajada:${PERFIL}`, p_limit: 3, p_window_seconds: 30 }],
        ['consume_conversation_ai_rate_limit', { p_scope_key: `central-agentes:teste:cliente:${TENANT}`, p_limit: 60, p_window_seconds: 600 }],
      ]);
    }
  });

  it('cada balde recusando: 429 com retry-after e a mensagem dele; o modelo não roda e os baldes seguintes não são tocados', async () => {
    const casos = [
      { recusa: 0, mensagem: 'Limite de 20 testes a cada 10 minutos por pessoa.' },
      { recusa: 1, mensagem: 'Muitos testes ao mesmo tempo. Espere a resposta anterior.' },
      { recusa: 2, mensagem: 'Limite de 60 testes a cada 10 minutos neste cliente.' },
    ];
    for (const r of rotas()) {
      for (const caso of casos) {
        mocks.rpc.mockReset();
        for (let i = 0; i < caso.recusa; i += 1) mocks.rpc.mockResolvedValueOnce(libera());
        mocks.rpc.mockResolvedValueOnce(recusaComEspera(17));
        const resposta = await r.chamar();
        const rotulo = `${r.nome}, balde ${caso.recusa}`;
        expect(resposta.status, rotulo).toBe(429);
        expect(resposta.headers.get('retry-after'), rotulo).toBe('17');
        expect(await resposta.json(), rotulo).toEqual({ error: `${caso.mensagem} Tente de novo em 17 s.`, code: 'LIMITE_DE_TESTES' });
        expect(mocks.rpc, rotulo).toHaveBeenCalledTimes(caso.recusa + 1);
      }
      expect(r.motor, r.nome).not.toHaveBeenCalled();
    }
  });

  it('falha fechada: o banco devolvendo erro ou a chamada rejeitando viram 429, nunca 500 nem passagem livre', async () => {
    for (const r of rotas()) {
      mocks.rpc.mockReset();
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
      const comErro = await r.chamar();
      expect(comErro.status, r.nome).toBe(429);
      expect(comErro.headers.get('retry-after'), r.nome).toBe('600');

      mocks.rpc.mockReset();
      mocks.rpc.mockResolvedValueOnce(libera());
      mocks.rpc.mockRejectedValueOnce(new Error('rede caiu'));
      const rejeitada = await r.chamar();
      expect(rejeitada.status, r.nome).toBe(429);
      expect(rejeitada.headers.get('retry-after'), r.nome).toBe('30');
      expect(r.motor, r.nome).not.toHaveBeenCalled();
    }
  });

  it('caminho feliz do teste: 200 com o corpo do motor, chamado com os dois clientes e o corpo validado', async () => {
    mocks.generateAgentReplyPreview.mockResolvedValueOnce({ ok: true, dados: { partes: ['Custa R$ 100.'], retrato: null } });
    const r = await testar(pedir({ ...CORPO_DO_TESTE, numeroId: null, nomeDoLead: '  Ana  ' }), doAgente());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ partes: ['Custa R$ 100.'], retrato: null });
    expect(mocks.generateAgentReplyPreview).toHaveBeenCalledWith(CLIENTES, {
      tenantId: TENANT,
      agentId: AGENTE,
      revisao: 3,
      mensagens: [{ autor: 'lead', texto: 'oi, quanto custa?' }],
      numeroId: null,
      nomeDoLead: 'Ana',
    });
  });

  it('as falhas do motor passam com status e código', async () => {
    const casos: Array<[number, string]> = [[409, 'RASCUNHO_MUDOU'], [422, 'SEM_CHAVE_DE_IA'], [504, 'MODELO_DEMOROU'], [502, 'FALHA_DO_MODELO']];
    for (const [status, codigo] of casos) {
      mocks.generateAgentReplyPreview.mockResolvedValueOnce({ ok: false, status, codigo, erro: `erro ${codigo}` });
      const r = await testar(pedir(CORPO_DO_TESTE), doAgente());
      expect(r.status, codigo).toBe(status);
      expect(await r.json(), codigo).toEqual({ error: `erro ${codigo}`, code: codigo });
    }
  });

  it('explicação: retrato sem provedor, com provedor fora da lista ou assinatura fora do formato é 400 sem consumir limite', async () => {
    const { provedor: _semProvedor, ...semProvedor } = CORPO_DA_EXPLICACAO.retrato;
    const casos: Array<[string, unknown]> = [
      ['sem provedor', { ...CORPO_DA_EXPLICACAO, retrato: semProvedor }],
      ['provedor fora da lista', { ...CORPO_DA_EXPLICACAO, retrato: { ...CORPO_DA_EXPLICACAO.retrato, provedor: 'mistral' } }],
      ['assinatura curta', { ...CORPO_DA_EXPLICACAO, retrato: { ...CORPO_DA_EXPLICACAO.retrato, assinatura: 'abc' } }],
      ['campo a mais no retrato', { ...CORPO_DA_EXPLICACAO, retrato: { ...CORPO_DA_EXPLICACAO.retrato, sha: 'x' } }],
      ['quatro partes', { ...CORPO_DA_EXPLICACAO, resposta: { partes: ['a', 'b', 'c', 'd'], repasse: null } }],
    ];
    for (const [nome, corpo] of casos) expect((await explicar(pedir(corpo), doAgente())).status, nome).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.explicarRespostaDoTeste).not.toHaveBeenCalled();
  });

  it('explicação: caminho feliz e as recusas do retrato passam com status e código', async () => {
    const ok = await explicar(pedir(CORPO_DA_EXPLICACAO), doAgente());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ explicacao: 'Porque o prompt manda.' });
    expect(mocks.explicarRespostaDoTeste).toHaveBeenCalledWith(CLIENTES, { tenantId: TENANT, agentId: AGENTE, ...CORPO_DA_EXPLICACAO });

    const casos: Array<[number, string]> = [[400, 'RETRATO_INVALIDO'], [409, 'RETRATO_VENCIDO'], [409, 'PROVEDOR_MUDOU'], [500, 'RETRATO_SEM_CHAVE']];
    for (const [status, codigo] of casos) {
      mocks.explicarRespostaDoTeste.mockResolvedValueOnce({ ok: false, status, codigo, erro: `erro ${codigo}` });
      const r = await explicar(pedir(CORPO_DA_EXPLICACAO), doAgente());
      expect(r.status, codigo).toBe(status);
      expect(await r.json(), codigo).toEqual({ error: `erro ${codigo}`, code: codigo });
    }
  });
});
