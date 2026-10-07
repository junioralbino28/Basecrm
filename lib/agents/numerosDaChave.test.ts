// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resumirNumerosDaChave } from './numerosDaChave';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA = '99999999-9999-4999-8999-999999999999';
const PADRAO = 'task_conversations_whatsapp_auto_reply';
const AURORA = 'task_conversations_whatsapp_cenno_aurora';

type Linha = Record<string, unknown>;
const comparar = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** select, eq, gt, in, order, limit e await: o pedaço do supabase-js que a contagem e o leitor paginado usam. */
function fakeAdmin(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const consulta = {
        select: () => consulta,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return consulta;
        },
        gt: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => comparar(l[coluna], valor) > 0);
          return consulta;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return consulta;
        },
        order: (coluna: string) => {
          linhas.sort((a, b) => comparar(a[coluna], b[coluna]));
          return consulta;
        },
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return consulta;
        },
        // O PostgREST corta toda resposta em 1000 linhas, sem erro. Sem o mesmo corte aqui, o teste de mais de mil
        // números passaria até com leitura única e não provaria a paginação (achado na rodada 2 do Codex, 07/10).
        then: (ok: (r: unknown) => unknown, falhou?: (e: unknown) => unknown) =>
          Promise.resolve({ data: linhas.slice(0, 1000), error: null }).then(ok, falhou),
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
}

const admin = fakeAdmin({
  channel_connections: [
    { id: 'c1', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N1', config: {}, ai_agent_id: 'a1' },
    { id: 'c2', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N2', config: { aiPromptKey: PADRAO }, ai_agent_id: null },
    { id: 'c3', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N3', config: { aiPromptKey: AURORA }, ai_agent_id: 'a2' },
    { id: 'c4', organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp', name: 'N4', config: { aiPromptKey: 'task_nao_existe' }, ai_agent_id: null },
    { id: 'c5', organization_id: OUTRA, provider: 'evolution', channel_type: 'whatsapp', name: 'N5', config: {}, ai_agent_id: 'a9' },
    { id: 'c6', organization_id: ORG, provider: 'outro', channel_type: 'whatsapp', name: 'N6', config: {}, ai_agent_id: null },
  ],
  ai_agents: [
    { id: 'a1', organization_id: ORG, name: 'Julia' },
    { id: 'a2', organization_id: ORG, name: 'Aurora' },
    { id: 'a9', organization_id: OUTRA, name: 'De outro cliente' },
  ],
});

describe('resumirNumerosDaChave', () => {
  it('chave padrão: conta o número sem chave e o com a chave explícita; só um tem agente', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, PADRAO)).toEqual({
      organizationId: ORG,
      numerosDaChave: 2,
      numerosComAgente: 1,
      agentes: [{ id: 'a1', nome: 'Julia' }],
    });
  });

  it('chave da Aurora: o único número tem agente', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, AURORA)).toEqual({
      organizationId: ORG,
      numerosDaChave: 1,
      numerosComAgente: 1,
      agentes: [{ id: 'a2', nome: 'Aurora' }],
    });
  });

  it('chave que não é de conversa (assistente do CRM) não tem números: null', async () => {
    expect(await resumirNumerosDaChave(admin, ORG, 'agent_crm_base_instructions')).toBeNull();
  });

  it('com mais de mil números, a leitura vem em páginas e nenhum fica de fora da conta', async () => {
    const muitas = Array.from({ length: 1203 }, (_, i) => ({
      id: `n${String(i).padStart(5, '0')}`, organization_id: ORG, provider: 'evolution', channel_type: 'whatsapp',
      name: `N${i}`, config: {}, ai_agent_id: i % 2 === 0 ? 'a1' : null,
    }));
    const grande = fakeAdmin({ channel_connections: muitas, ai_agents: [{ id: 'a1', organization_id: ORG, name: 'Julia' }] });
    expect(await resumirNumerosDaChave(grande, ORG, PADRAO)).toEqual({
      organizationId: ORG,
      numerosDaChave: 1203,
      numerosComAgente: 602,
      agentes: [{ id: 'a1', nome: 'Julia' }],
    });
  });
});
