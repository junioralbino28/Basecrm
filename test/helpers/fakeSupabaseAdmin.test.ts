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
