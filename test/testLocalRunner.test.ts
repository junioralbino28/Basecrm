// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildLocalTestEnv,
  readLocalSupabaseStatus,
  runLocalTests,
} from '../scripts/test-local.mjs';

const STATUS_LEGACY = [
  'API_URL="http://127.0.0.1:54321"',
  'ANON_KEY="anon-local-12345678901234567890"',
  'SERVICE_ROLE_KEY="service-local-12345678901234567890"',
].join('\n');

const STATUS_CURRENT = [
  'API_URL="http://127.0.0.1:54321"',
  'PUBLISHABLE_KEY="publishable-local-12345678901234567890"',
  'SECRET_KEY="secret-local-12345678901234567890"',
].join('\n');

describe('runner da suíte local', () => {
  it.each([
    [STATUS_LEGACY, 'anon-local-12345678901234567890', 'service-local-12345678901234567890'],
    [STATUS_CURRENT, 'publishable-local-12345678901234567890', 'secret-local-12345678901234567890'],
  ])('aceita os dois formatos de chaves emitidos pelo Supabase CLI', (status, anonKey, serviceRoleKey) => {
    expect(buildLocalTestEnv(status, { PATH: 'mantido' })).toMatchObject({
      PATH: 'mantido',
      SUPABASE_TEST_TARGET: 'local',
      E2_SUPABASE_URL: 'http://127.0.0.1:54321',
      E2_SUPABASE_ANON_KEY: anonKey,
      E2_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      REQUIRE_E2_MIGRATION: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_URL: 'http://127.0.0.1:54321',
    });
  });

  it.each([
    'https://eqidsihasmwwamkaqfka.supabase.co',
    'http://localhost:54321',
    'http://127.0.0.1:6543',
    'not-a-url',
  ])('recusa qualquer alvo diferente do Supabase local exato: %s', (url) => {
    const status = STATUS_LEGACY.replace('http://127.0.0.1:54321', url);
    expect(() => buildLocalTestEnv(status, {})).toThrow(/RECUSADO.*Supabase local/i);
  });

  it('não expõe stdout nem stderr do status quando o CLI falha', () => {
    const secret = 'service-role-nao-pode-vazar';
    const execFile = vi.fn(() => {
      const error = new Error(`falhou: ${secret}`) as Error & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = `SERVICE_ROLE_KEY=${secret}`;
      error.stderr = `detalhe ${secret}`;
      throw error;
    });

    let thrown: unknown;
    try {
      readLocalSupabaseStatus(execFile);
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).not.toContain(secret);
    expect(String(thrown)).toMatch(/Supabase local não está disponível/i);
    expect(execFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('recusa status sem chaves completas sem reproduzir seu conteúdo', () => {
    const secret = 'parcial-nao-pode-vazar';
    let thrown: unknown;
    try {
      buildLocalTestEnv(
        `API_URL="http://127.0.0.1:54321"\nSERVICE_ROLE_KEY="${secret}"`,
        {},
      );
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toMatch(/credenciais locais completas/i);
    expect(String(thrown)).not.toContain(secret);
  });

  it('encaminha um filtro opcional ao Vitest sem alterar a trava local', () => {
    const run = vi.fn(() => ({ status: 0 }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(runLocalTests({
      readStatus: () => STATUS_LEGACY,
      run,
      parentEnv: {},
      vitestArgs: ['test/funilAuthoringIsolation.local.test.ts'],
    })).toBe(0);

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'vitest',
        'run',
        'test/funilAuthoringIsolation.local.test.ts',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({ SUPABASE_TEST_TARGET: 'local' }),
      }),
    );
    log.mockRestore();
  });
});
