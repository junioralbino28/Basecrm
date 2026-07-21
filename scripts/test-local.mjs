#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveNpxInvocation } from './npx-invocation.mjs';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

function extractStatusValue(status, key) {
  const match = status.match(new RegExp(`^${key}=["']?([^"'\\r\\n]+)["']?$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

export function readLocalSupabaseStatus(execute = execFileSync) {
  const command = resolveNpxInvocation(['supabase', 'status', '-o', 'env']);

  try {
    return execute(command.file, command.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'Supabase local não está disponível. Abra o Docker e rode `npx supabase start`.',
    );
  }
}

export function buildLocalTestEnv(status, parentEnv = process.env) {
  const url = extractStatusValue(status, 'API_URL');
  const anonKey =
    extractStatusValue(status, 'ANON_KEY') ||
    extractStatusValue(status, 'PUBLISHABLE_KEY');
  const serviceRoleKey =
    extractStatusValue(status, 'SERVICE_ROLE_KEY') ||
    extractStatusValue(status, 'SECRET_KEY');

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('RECUSADO: o runner aceita somente o Supabase local em 127.0.0.1:54321.');
  }

  if (parsedUrl.origin !== LOCAL_SUPABASE_URL || parsedUrl.pathname !== '/') {
    throw new Error('RECUSADO: o runner aceita somente o Supabase local em 127.0.0.1:54321.');
  }

  if (anonKey.length < 20 || serviceRoleKey.length < 20) {
    throw new Error('O Supabase local não forneceu credenciais locais completas.');
  }

  return {
    ...parentEnv,
    SUPABASE_TEST_TARGET: 'local',
    REQUIRE_E2_MIGRATION: '1',
    E2_SUPABASE_URL: LOCAL_SUPABASE_URL,
    E2_SUPABASE_ANON_KEY: anonKey,
    E2_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_URL: LOCAL_SUPABASE_URL,
    SUPABASE_SECRET_KEY: serviceRoleKey,
  };
}

export function runLocalTests({
  readStatus = readLocalSupabaseStatus,
  run = spawnSync,
  parentEnv = process.env,
  vitestArgs = process.argv.slice(2),
} = {}) {
  let env;
  try {
    env = buildLocalTestEnv(readStatus(), parentEnv);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao validar o Supabase local.';
    console.error(`\n  ${message}\n`);
    return 1;
  }

  console.log('\n  Testes: Supabase LOCAL (127.0.0.1:54321) — dados de teste.\n');
  const command = resolveNpxInvocation(['vitest', 'run', ...vitestArgs]);
  const result = run(command.file, command.args, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error('\n  Não foi possível iniciar a suíte local.\n');
    return 1;
  }
  return result.status ?? 1;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  process.exitCode = runLocalTests();
}
