// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { termoDeBusca } from '@/lib/platform/termoDeBusca';

/**
 * Central de Agentes, bloco 2 (revisão do Codex no código, rodada 1, achado 2): a lista de clientes ganha uma busca por
 * nome OPCIONAL, para a cópia de agente alcançar clientes além dos 100 mais recentes. Sem o parâmetro, a consulta é a de
 * sempre (nenhum filtro de nome).
 */
const chamadas = vi.hoisted(() => [] as Array<[string, unknown[]]>);

function construtor() {
  const b: Record<string, unknown> = {};
  for (const nome of ['from', 'select', 'is', 'ilike', 'order', 'limit']) {
    b[nome] = (...args: unknown[]) => {
      chamadas.push([nome, args]);
      return nome === 'limit' ? Promise.resolve({ data: [], error: null }) : b;
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
});

describe('GET /api/platform/tenants: busca opcional por nome', () => {
  it('sem busca: a consulta de sempre, sem filtro de nome, até 100', async () => {
    const r = await GET(new Request('http://localhost/api/platform/tenants'));
    expect(r.status).toBe(200);
    expect(chamadas.map(([n]) => n)).toEqual(['from', 'select', 'is', 'order', 'limit']);
    expect(chamadas.find(([n]) => n === 'limit')?.[1]).toEqual([100]);
  });

  it('com busca: filtra o nome por ILIKE, com os curingas do usuário removidos', async () => {
    await GET(new Request('http://localhost/api/platform/tenants?busca=%20Lo%25ja_%2A%20'));
    expect(chamadas.find(([n]) => n === 'ilike')?.[1]).toEqual(['name', '%Loja%']);
  });

  it('termoDeBusca tira %, _, * e a barra invertida, apara e corta em 80', () => {
    const barra = String.fromCharCode(92);
    expect(termoDeBusca(`  a%b_c*d${barra}e  `)).toBe('abcde');
    expect(termoDeBusca(null)).toBe('');
    expect(termoDeBusca('x'.repeat(100))).toHaveLength(80);
  });
});
