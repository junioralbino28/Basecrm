import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export type PublicApiAuthResult =
  | { ok: true; organizationId: string; organizationName: string; apiKeyId: string; apiKeyPrefix: string }
  | { ok: false; status: number; body: { error: string; code?: string } };

function getAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer new publishable key format, fallback to legacy anon key
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createSupabaseClient(url, anon);
}

type ValidateApiKeyRow = {
  api_key_id: string;
  api_key_prefix: string;
  organization_id: string;
  organization_name: string;
};

/**
 * Núcleo compartilhado: valida um token contra a RPC `validate_api_key` (hash sha256,
 * revoked_at null). Usado tanto pela auth por HEADER (x-api-key) quanto por QUERY (?token=,
 * necessária pro =IMPORTDATA do Google Sheets, que faz GET sem headers).
 */
async function validateToken(token: string): Promise<PublicApiAuthResult> {
  if (!token.trim()) {
    return { ok: false, status: 401, body: { error: 'Missing API token', code: 'AUTH_MISSING' } };
  }

  const sb = getAnonSupabase();
  if (!sb) {
    return { ok: false, status: 500, body: { error: 'Supabase not configured', code: 'SERVER_NOT_CONFIGURED' } };
  }

  // Supabase RPC return types are not strongly typed here (no generated Database types),
  // so we validate the shape defensively.
  const { data, error } = await sb.rpc('validate_api_key', { p_token: token }).maybeSingle();
  const row = (data ?? null) as ValidateApiKeyRow | null;
  if (
    error ||
    !row ||
    typeof row.organization_id !== 'string' ||
    !row.organization_id.trim() ||
    typeof row.organization_name !== 'string' ||
    typeof row.api_key_id !== 'string' ||
    typeof row.api_key_prefix !== 'string'
  ) {
    return { ok: false, status: 401, body: { error: 'Invalid API key', code: 'AUTH_INVALID' } };
  }

  return {
    ok: true,
    apiKeyId: row.api_key_id,
    apiKeyPrefix: row.api_key_prefix,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

/** Auth da API pública por header `x-api-key` (integrações que controlam os headers). */
export async function authPublicApi(request: Request): Promise<PublicApiAuthResult> {
  return validateToken(request.headers.get('x-api-key') || '');
}

/**
 * Auth da API pública por token na QUERY (`?token=`). Necessária pro Google Sheets
 * `=IMPORTDATA(url)` e Excel "Dados → Da Web", que fazem GET sem poder mandar header.
 * Só deve ser usada em endpoints READ-ONLY e SEM PII (ex.: totais agregados).
 */
export async function authPublicApiFromQuery(request: Request): Promise<PublicApiAuthResult> {
  const token = new URL(request.url).searchParams.get('token') || '';
  return validateToken(token);
}
