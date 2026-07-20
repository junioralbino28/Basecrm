#!/usr/bin/env node
/**
 * Sobe o Next apontando para o Supabase LOCAL, sem tocar no .env.local.
 *
 * Por que existe: o .env.local deste repo aponta para o Supabase de PRODUÇÃO
 * (banco real da clínica). `npm run dev` puro conecta lá. Este script força o
 * ambiente local e ABORTA se o Supabase local não estiver no ar — em vez de
 * subir com variáveis vazias, que o app interpreta como "Supabase não configurado".
 */
import { execFileSync, spawn } from 'node:child_process';
import { resolveNpxInvocation } from './npx-invocation.mjs';

function lerStatusDoSupabase() {
  try {
    const command = resolveNpxInvocation(['supabase', 'status', '-o', 'env']);
    return execFileSync(command.file, command.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function extrair(saida, chave) {
  const m = saida.match(new RegExp(`^${chave}="?([^"\\n]+)"?$`, 'm'));
  return m ? m[1].trim() : '';
}

const status = lerStatusDoSupabase();
const publishable = extrair(status, 'PUBLISHABLE_KEY');
const secret = extrair(status, 'SECRET_KEY');

if (publishable.length < 20 || secret.length < 20) {
  console.error('\n  Supabase local não está no ar.\n');
  console.error('  Provável causa: o Docker Desktop está fechado.');
  console.error('  Abra o Docker, espere ficar pronto e rode de novo:\n');
  console.error('      npm run dev:local\n');
  console.error('  (Se o Docker já estiver aberto, rode `npx supabase start`.)\n');
  process.exit(1);
}

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  SUPABASE_SECRET_KEY: secret,
};

console.log('\n  Banco: Supabase LOCAL (127.0.0.1:54321) — dados de teste.\n');

const command = resolveNpxInvocation(['next', 'dev']);
const filho = spawn(command.file, command.args, { env, stdio: 'inherit', shell: false });
filho.on('exit', (code) => process.exit(code ?? 0));
