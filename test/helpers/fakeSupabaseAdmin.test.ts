// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeSupabaseAdmin } from './fakeSupabaseAdmin';

describe('banco falso: projeção do select (opcional)', () => {
  const linhas = { t: [{ id: '1', a: 'x', b: 'y' }] };

  it('com projetarSelect, devolve só as colunas pedidas', async () => {
    const { data } = await createFakeSupabaseAdmin(linhas, { projetarSelect: true }).from('t').select('id, a');
    expect(data).toEqual([{ id: '1', a: 'x' }]);
  });

  it('sem a opção, devolve a linha inteira, como sempre', async () => {
    const { data } = await createFakeSupabaseAdmin(linhas).from('t').select('id');
    expect(data).toEqual([{ id: '1', a: 'x', b: 'y' }]);
  });
});

describe('banco falso: .not com a semântica de NULL do SQL', () => {
  const semear = () => createFakeSupabaseAdmin({
    tags: [
      { id: 't1', category_id: 'c1' },
      { id: 't2', category_id: null },
      { id: 't3' },
      { id: 't4', category_id: 'c2' },
    ],
  });

  it("not('col', 'is', null) fica só com quem tem valor", async () => {
    const { data } = await semear().from('tags').select('id').not('category_id', 'is', null);
    expect(data.map((row) => row.id)).toEqual(['t1', 't4']);
  });

  it("not('col', 'eq', x) deixa de fora o igual e também o nulo, como no SQL", async () => {
    const { data } = await semear().from('tags').select('id').not('category_id', 'eq', 'c1');
    expect(data.map((row) => row.id)).toEqual(['t4']);
  });

  it('operador que o banco falso não conhece falha alto, em vez de filtrar errado', () => {
    expect(() => semear().from('tags').select('id').not('category_id', 'in', '(c1)')).toThrow('não suportado');
  });
});

describe('banco falso: limite de linhas e RPC por argumento', () => {
  it('maxLinhas corta a leitura como o limite de linhas do PostgREST', async () => {
    const linhas = { t: Array.from({ length: 5 }, (_, i) => ({ id: String(i) })) };
    const { data } = await createFakeSupabaseAdmin(linhas, { maxLinhas: 3 }).from('t').select('id');
    expect(data).toHaveLength(3);
  });

  it('rpcResults aceita uma função dos argumentos', async () => {
    const admin = createFakeSupabaseAdmin();
    admin.rpcResults.eco = (args: Record<string, unknown>) => [{ recebido: args.x }];
    expect((await admin.rpc('eco', { x: 7 })).data).toEqual([{ recebido: 7 }]);
  });
});
