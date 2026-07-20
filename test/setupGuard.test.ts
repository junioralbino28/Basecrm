import { describe, expect, it } from 'vitest';
import { assertTestSupabaseTarget } from './helpers/e2Supabase';

describe('trava global do alvo Supabase nos testes', () => {
  it('recusa o projeto de produção', () => {
    expect(() =>
      assertTestSupabaseTarget('https://eqidsihasmwwamkaqfka.supabase.co'),
    ).toThrow(/RECUSADO.*produção/i);
  });

  it('aceita um Supabase em loopback', () => {
    expect(assertTestSupabaseTarget('http://127.0.0.1:54321')).toEqual({
      isLocal: true,
    });
  });
});
