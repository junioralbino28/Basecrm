// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { termoDeBusca } from '@/lib/platform/termoDeBusca';

/**
 * Central de Agentes, bloco 2 (revisão do Codex no código, rodada 1, achado 2): a lista de clientes ganha uma busca por
 * nome OPCIONAL, para a cópia de agente alcançar clientes além dos 100 mais recentes. Sem o parâmetro, a consulta é a de
 * sempre (nenhum filtro de nome).
 */
const chamadas = vi.hoisted(() => [] as Array<[string, unknown[]]>);
const linhas = vi.hoisted(() => ({ atual: [] as Array<{ id: string; name: string; created_at: string }> }));

function construtor() {
  const b: Record<string, unknown> = {};
  for (const nome of ['from', 'select', 'is', 'ilike', 'or', 'order', 'limit']) {
    b[nome] = (...args: unknown[]) => {
      chamadas.push([nome, args]);
      return nome === 'limit' ? Promise.resolve({ data: linhas.atual, error: null }) : b;
    };
  }
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'p1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'p1', role: 'agency_admin', organization_id: 'org' }, error: null }) }) }) }),
  }),
  createStaticAdminClient: () => construtor(),
}));
vi.mock('@/lib/provisioning/runProvisioning', () => ({ runProvisioning: vi.fn() }));
vi.mock('@/lib/security/sameOrigin', () => ({ isAllowedOrigin: () => true }));

import { GET } from './route';

beforeEach(() => {
  chamadas.length = 0;
  linhas.atual = [];
});

const INSTANTE = '2026-03-04T05:06:07.123456+00:00';
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const comCursor = (antesDe: string | null, antesDeId: string | null) => {
  const q = new URLSearchParams();
  if (antesDe !== null) q.set('antesDe', antesDe);
  if (antesDeId !== null) q.set('antesDeId', antesDeId);
  return new Request(`http://localhost/api/platform/tenants?${q.toString()}`);
};

describe('GET /api/platform/tenants: busca opcional por nome', () => {
  it('sem busca: a consulta de sempre, sem filtro de nome, até 100, com o id desempatando a data', async () => {
    const r = await GET(new Request('http://localhost/api/platform/tenants'));
    expect(r.status).toBe(200);
    expect(chamadas.map(([n]) => n)).toEqual(['from', 'select', 'is', 'order', 'order', 'limit']);
    expect(chamadas.filter(([n]) => n === 'order').map(([, a]) => a)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(chamadas.find(([n]) => n === 'limit')?.[1]).toEqual([100]);
    expect((await r.json()).proxima).toBeNull();
  });

  it('com busca: filtra o nome por ILIKE, com os curingas do usuário removidos', async () => {
    await GET(new Request('http://localhost/api/platform/tenants?busca=%20Lo%25ja_%2A%20'));
    expect(chamadas.find(([n]) => n === 'ilike')?.[1]).toEqual(['name', '%Loja%']);
  });

  it('página cheia devolve o cursor do último cliente; página incompleta devolve null', async () => {
    linhas.atual = Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, name: 'Loja', created_at: `t-${i}` }));
    const cheia = await (await GET(new Request('http://localhost/api/platform/tenants'))).json();
    expect(cheia.tenants).toHaveLength(100);
    expect(cheia.proxima).toEqual({ antesDe: 't-99', antesDeId: 'id-99' });
    linhas.atual = linhas.atual.slice(0, 99);
    expect((await (await GET(new Request('http://localhost/api/platform/tenants'))).json()).proxima).toBeNull();
  });

  it('com cursor: filtra pelo par (created_at, id), com o instante entre aspas', async () => {
    const r = await GET(comCursor(INSTANTE, ID));
    expect(r.status).toBe(200);
    expect(chamadas.find(([n]) => n === 'or')?.[1]).toEqual([
      `created_at.lt."${INSTANTE}",and(created_at.eq."${INSTANTE}",id.lt.${ID})`,
    ]);
  });

  it('cursor fora do formato ou pela metade: 400, sem nenhuma consulta', async () => {
    const ruins: Array<[string | null, string | null]> = [
      [INSTANTE, null],
      [null, ID],
      [`${INSTANTE}",id.gt.00000000-0000-4000-8000-000000000000`, ID],
      ['ontem', ID],
      [INSTANTE, `${ID})`],
      [INSTANTE, 'id-1'],
    ];
    for (const [antesDe, antesDeId] of ruins) {
      const r = await GET(comCursor(antesDe, antesDeId));
      expect(r.status, `${antesDe} | ${antesDeId}`).toBe(400);
    }
    expect(chamadas).toEqual([]);
  });

  it('termoDeBusca tira %, _, * e a barra invertida, apara e corta em 80', () => {
    const barra = String.fromCharCode(92);
    expect(termoDeBusca(`  a%b_c*d${barra}e  `)).toBe('abcde');
    expect(termoDeBusca(null)).toBe('');
    expect(termoDeBusca('x'.repeat(100))).toHaveLength(80);
  });
});
