import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTestSupabaseTarget } from './helpers/e2Supabase';
import { getSupabaseAdminClient } from './helpers/supabaseAdmin';

const PRODUCTION_URL = 'https://eqidsihasmwwamkaqfka.supabase.co';

describe('trava global do alvo Supabase nos testes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('recusa o projeto de produção', () => {
    expect(() =>
      assertTestSupabaseTarget(PRODUCTION_URL),
    ).toThrow(/RECUSADO.*produção/i);
  });

  it('aceita um Supabase em loopback', () => {
    expect(assertTestSupabaseTarget('http://127.0.0.1:54321')).toEqual({
      isLocal: true,
    });
  });

  it.each([
    {
      origem: 'NEXT_PUBLIC_SUPABASE_URL',
      publicUrl: PRODUCTION_URL,
      fallbackUrl: 'http://127.0.0.1:54321',
    },
    {
      origem: 'SUPABASE_URL',
      publicUrl: '',
      fallbackUrl: PRODUCTION_URL,
    },
  ])('helper admin recusa produção vinda de $origem', ({ publicUrl, fallbackUrl }) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', publicUrl);
    vi.stubEnv('SUPABASE_URL', fallbackUrl);
    vi.stubEnv('E2_ALLOW_REMOTE_BRANCH', '1');

    expect(() => getSupabaseAdminClient()).toThrow(/RECUSADO.*produção/i);
  });
});
