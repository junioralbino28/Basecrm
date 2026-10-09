// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from '@/test/helpers/fakeSupabaseAdmin';
import { getPromptCatalogMap } from '@/lib/ai/prompts/catalog';
import {
  CHAVE_DO_PADRAO_EM_BRANCO,
  arquivarModelo,
  criarAgente,
  criarModeloDeAgente,
  lerModelo,
  listarModelos,
  salvarModelo,
} from './modelosAgentes';
import type { Clientes } from './editorAgentes';

/**
 * Bloco 2 (PLAN-bloco-2.md, Task 4): a camada de servidor dos modelos e da criação. A prova principal da rodada 1 do
 * Codex no PLAN (achado 4): em toda escrita, o cliente ADMIN é um Proxy que lança erro em qualquer acesso, e a RPC é
 * exigida no cliente do USUÁRIO.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const OUTRO = '33333333-3333-4333-8333-333333333333';
const MODELO = '22222222-2222-4222-8222-222222222222';
const AGENTE = '44444444-4444-4444-8444-444444444444';
const NOVO = '55555555-5555-4555-8555-555555555555';
const MOLDE = 'Oi [Nome da empresa], abrimos [Horário]. {{contactName}}';

const adminProibido = new Proxy({}, {
  get(_alvo, prop) {
    throw new Error(`cliente admin usado numa escrita (${String(prop)})`);
  },
}) as Clientes['admin'];

function cenario(modelo: Record<string, unknown> | null = { id: MODELO, prompt: MOLDE, revision: 3, archived_at: null }) {
  const usuario = createFakeSupabaseAdmin({ ai_agent_templates: modelo ? [modelo] : [] });
  return { usuario, clientes: { usuario: usuario as unknown as Clientes['usuario'], admin: adminProibido } };
}

describe('criarAgente: os três começos, só pelo cliente do usuário', () => {
  it('branco: manda o texto do catálogo para create_ai_agent_blank e devolve o id', async () => {
    const { usuario, clientes } = cenario();
    usuario.rpcResults.create_ai_agent_blank = NOVO;
    const r = await criarAgente(clientes, { tenantId: TENANT, nome: 'Atendente', inicio: { tipo: 'branco' } });
    expect(r).toEqual({ ok: true, dados: { agenteId: NOVO } });
    const texto = (getPromptCatalogMap() as Record<string, { defaultTemplate: string }>)[CHAVE_DO_PADRAO_EM_BRANCO].defaultTemplate;
    expect(texto.length).toBeGreaterThan(100);
    expect(usuario.rpcCalls).toEqual([{ name: 'create_ai_agent_blank', args: { p_organization_id: TENANT, p_name: 'Atendente', p_prompt: texto } }]);
  });

  it('modelo: a RPC recebe exatamente ids, revisão e respostas, sem texto', async () => {
    const { usuario, clientes } = cenario();
    usuario.rpcResults.create_ai_agent_from_template = NOVO;
    const respostas = { '[Nome da empresa]': 'Loja Sol' };
    const r = await criarAgente(clientes, {
      tenantId: TENANT, nome: 'Do modelo', inicio: { tipo: 'modelo', modeloId: MODELO, revisaoDoModelo: 3, respostas },
    });
    expect(r).toEqual({ ok: true, dados: { agenteId: NOVO } });
    expect(usuario.rpcCalls).toEqual([{
      name: 'create_ai_agent_from_template',
      args: { p_organization_id: TENANT, p_name: 'Do modelo', p_template_id: MODELO, p_expected_template_revision: 3, p_answers: respostas },
    }]);
  });

  it('modelo: revisão velha dá 409 ANTES de olhar as chaves, sem chamar a RPC (rodada 2 da SPEC, ponto 2)', async () => {
    const { usuario, clientes } = cenario();
    const r = await criarAgente(clientes, {
      tenantId: TENANT, nome: 'X', inicio: { tipo: 'modelo', modeloId: MODELO, revisaoDoModelo: 2, respostas: { '[Chave que sumiu]': 'a' } },
    });
    expect(r).toMatchObject({ ok: false, status: 409, codigo: 'MODELO_MUDOU' });
    expect(usuario.rpcCalls).toEqual([]);
  });

  it('modelo: chave que não é lacuna dá 400 sem chamar a RPC; arquivado e inexistente também param antes', async () => {
    const sobra = cenario();
    expect(await criarAgente(sobra.clientes, {
      tenantId: TENANT, nome: 'X', inicio: { tipo: 'modelo', modeloId: MODELO, revisaoDoModelo: 3, respostas: { '[Outra]': 'a' } },
    })).toMatchObject({ ok: false, status: 400, codigo: 'LACUNA_INEXISTENTE' });
    expect(sobra.usuario.rpcCalls).toEqual([]);

    const arquivado = cenario({ id: MODELO, prompt: MOLDE, revision: 3, archived_at: '2026-10-09T00:00:00Z' });
    expect(await criarAgente(arquivado.clientes, {
      tenantId: TENANT, nome: 'X', inicio: { tipo: 'modelo', modeloId: MODELO, revisaoDoModelo: 3, respostas: {} },
    })).toMatchObject({ ok: false, status: 409, codigo: 'MODELO_ARQUIVADO' });

    const sumiu = cenario(null);
    expect(await criarAgente(sumiu.clientes, {
      tenantId: TENANT, nome: 'X', inicio: { tipo: 'modelo', modeloId: MODELO, revisaoDoModelo: 3, respostas: {} },
    })).toMatchObject({ ok: false, status: 404, codigo: 'MODELO_INEXISTENTE' });
    expect(arquivado.usuario.rpcCalls).toEqual([]);
    expect(sumiu.usuario.rpcCalls).toEqual([]);
  });

  it('cópia: manda organização e agente de origem juntos, e a versão esperada', async () => {
    const { usuario, clientes } = cenario();
    usuario.rpcResults.create_ai_agent_from_copy = NOVO;
    const r = await criarAgente(clientes, {
      tenantId: TENANT, nome: 'Copia', inicio: { tipo: 'copia', clienteDeOrigemId: OUTRO, agenteId: AGENTE, versaoEsperada: 4 },
    });
    expect(r).toEqual({ ok: true, dados: { agenteId: NOVO } });
    expect(usuario.rpcCalls).toEqual([{
      name: 'create_ai_agent_from_copy',
      args: { p_organization_id: TENANT, p_name: 'Copia', p_source_organization_id: OUTRO, p_source_agent_id: AGENTE, p_expected_source_version: 4 },
    }]);
  });

  it('traduz os erros novos do banco', async () => {
    const casos: Array<[string, number, string]> = [
      ['cliente_inexistente', 404, 'CLIENTE_INEXISTENTE'],
      ['sem_versao_publicada', 422, 'SEM_VERSAO_PUBLICADA'],
      ['versao_publicada_mudou', 409, 'VERSAO_PUBLICADA_MUDOU'],
      ['lacuna_ambigua', 422, 'LACUNA_AMBIGUA'],
      ['lacuna_invalida', 422, 'LACUNA_INVALIDA'],
      ['respostas_invalidas', 422, 'RESPOSTAS_INVALIDAS'],
      ['nome_invalido', 400, 'NOME_INVALIDO'],
      ['sem_permissao', 403, 'SEM_PERMISSAO'],
    ];
    for (const [nome, status, codigo] of casos) {
      const { usuario, clientes } = cenario();
      usuario.rpcErrors.create_ai_agent_from_copy = nome;
      const r = await criarAgente(clientes, {
        tenantId: TENANT, nome: 'X', inicio: { tipo: 'copia', clienteDeOrigemId: OUTRO, agenteId: AGENTE, versaoEsperada: 1 },
      });
      expect(r, nome).toMatchObject({ ok: false, status, codigo });
    }
  });
});

describe('modelos: escritas só pelo cliente do usuário', () => {
  it('salvar cria (id nulo) e salva, devolvendo id e revisão', async () => {
    const { usuario, clientes } = cenario();
    usuario.rpcResults.save_ai_agent_template = [{ out_id: MODELO, out_revision: 4 }];
    const r = await salvarModelo(clientes, { id: MODELO, revisaoEsperada: 3, nome: 'M', descricao: null, prompt: 'Oi' });
    expect(r).toEqual({ ok: true, dados: { id: MODELO, revisao: 4 } });
    expect(usuario.rpcCalls).toEqual([{
      name: 'save_ai_agent_template',
      args: { p_template_id: MODELO, p_expected_revision: 3, p_name: 'M', p_description: null, p_prompt: 'Oi' },
    }]);
    usuario.rpcErrors.save_ai_agent_template = 'modelo_mudou';
    expect(await salvarModelo(clientes, { id: MODELO, revisaoEsperada: 3, nome: 'M', descricao: null, prompt: 'Oi' }))
      .toMatchObject({ ok: false, status: 409, codigo: 'MODELO_MUDOU' });
  });

  it('modelo a partir de agente e arquivar chamam a RPC certa', async () => {
    const { usuario, clientes } = cenario();
    usuario.rpcResults.create_ai_agent_template_from_agent = MODELO;
    usuario.rpcResults.set_ai_agent_template_archived = 5;
    expect(await criarModeloDeAgente(clientes, { tenantId: TENANT, agenteId: AGENTE, versaoEsperada: 2, nome: 'M', descricao: 'd' }))
      .toEqual({ ok: true, dados: { id: MODELO } });
    expect(await arquivarModelo(clientes, { id: MODELO, arquivar: true, revisaoEsperada: 4 })).toEqual({ ok: true, dados: { revisao: 5 } });
    expect(usuario.rpcCalls).toEqual([
      { name: 'create_ai_agent_template_from_agent', args: { p_organization_id: TENANT, p_agent_id: AGENTE, p_expected_version: 2, p_name: 'M', p_description: 'd' } },
      { name: 'set_ai_agent_template_archived', args: { p_template_id: MODELO, p_archived: true, p_expected_revision: 4 } },
    ]);
  });

  it('prova contrária do Proxy: usar o admin numa escrita estoura', async () => {
    expect(() => (adminProibido as unknown as { rpc: unknown }).rpc).toThrow(/cliente admin usado numa escrita/);
  });
});

describe('modelos: leitura', () => {
  it('lista com lacunas, ambíguas, quem atualizou e quantos agentes nasceram do modelo', async () => {
    const usuario = createFakeSupabaseAdmin({
      ai_agent_templates: [
        { id: MODELO, name: 'Loja', description: 'd', prompt: '[Nome] e [Nome](https://x) e [Horário]', revision: 2, archived_at: null, updated_at: '2026-10-09T10:00:00Z', updated_by: 'p1' },
        { id: 'arq', name: 'Velho', description: null, prompt: 'x', revision: 1, archived_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', updated_by: null },
      ],
      ai_agents: [
        { id: 'a1', origin: { kind: 'template', templateId: MODELO } },
        { id: 'a2', origin: { kind: 'template', templateId: MODELO } },
        { id: 'a3', origin: { kind: 'blank' } },
      ],
    });
    const admin = createFakeSupabaseAdmin({ profiles: [{ id: 'p1', nickname: 'Junior' }] });
    const c = { usuario: usuario as unknown as Clientes['usuario'], admin: admin as unknown as Clientes['admin'] };
    const r = await listarModelos(c, { arquivados: false });
    expect(r).toEqual({
      ok: true,
      dados: {
        modelos: [{
          id: MODELO, nome: 'Loja', descricao: 'd', revisao: 2, lacunas: ['[Nome]', '[Horário]'], ambiguas: ['[Nome]'],
          arquivado: false, atualizadoEm: '2026-10-09T10:00:00Z', atualizadoPor: 'Junior', agentesCriados: 2,
        }],
      },
    });
    const todos = await listarModelos(c, { arquivados: true });
    expect(todos.ok && todos.dados.modelos.map((m) => m.id)).toEqual([MODELO, 'arq']);
    const um = await lerModelo(c, MODELO);
    expect(um.ok && um.dados.prompt).toBe('[Nome] e [Nome](https://x) e [Horário]');
    expect(await lerModelo(c, 'nao-existe')).toMatchObject({ ok: false, status: 404, codigo: 'MODELO_INEXISTENTE' });
  });
});

describe('fonte: a camada não escreve direto nas tabelas nem usa o admin para RPC', () => {
  const fonte = readFileSync(resolve(process.cwd(), 'lib/agents/modelosAgentes.ts'), 'utf8');
  it('caso positivo: o detector acha as RPC do usuário', () => {
    expect(fonte.match(/usuario\.rpc\(/g)?.length).toBe(6);
  });
  it('sem insert, update, upsert, delete nem admin.rpc', () => {
    expect(fonte).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(fonte).not.toMatch(/admin\.rpc\(/);
  });
});
