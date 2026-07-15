import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PRODUCTION_PROJECT_REF = 'eqidsihasmwwamkaqfka';

export type E2SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  isLocal: boolean;
};

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function assertSafeE2SupabaseTarget(rawUrl: string): { isLocal: boolean } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('E2_SUPABASE_URL inválida');
  }

  if (url.hostname.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('RECUSADO: testes E2 nunca podem usar o projeto Supabase de produção');
  }

  if (isLoopback(url.hostname)) {
    return { isLocal: true };
  }

  if (process.env.E2_ALLOW_REMOTE_BRANCH !== '1') {
    throw new Error(
      'RECUSADO: alvo E2 remoto exige E2_ALLOW_REMOTE_BRANCH=1 e deve ser uma branch não produtiva',
    );
  }

  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('RECUSADO: branch remota E2 deve usar HTTPS em *.supabase.co');
  }

  return { isLocal: false };
}

export function loadE2SupabaseConfig(): E2SupabaseConfig | null {
  const url = process.env.E2_SUPABASE_URL?.trim() ?? '';
  const anonKey = process.env.E2_SUPABASE_ANON_KEY?.trim() ?? '';
  const serviceRoleKey = process.env.E2_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const required = process.env.REQUIRE_E2_MIGRATION === '1';

  if (!url || !anonKey || !serviceRoleKey) {
    if (required) {
      throw new Error(
        'REQUIRE_E2_MIGRATION=1 exige E2_SUPABASE_URL, E2_SUPABASE_ANON_KEY e E2_SUPABASE_SERVICE_ROLE_KEY',
      );
    }
    return null;
  }

  const { isLocal } = assertSafeE2SupabaseTarget(url);
  return { url, anonKey, serviceRoleKey, isLocal };
}

export function createE2AdminClient(config: E2SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createE2UserClient(config: E2SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
