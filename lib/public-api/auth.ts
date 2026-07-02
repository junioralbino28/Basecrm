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

/** Auth da API pública por header `x-api-key` (integrações full-access: n8n, MCP, etc.). */
export async function authPublicApi(request: Request): Promise<PublicApiAuthResult> {
  return validateToken(request.headers.get('x-api-key') || '');
}

export type ReportTokenAuthResult =
  | { ok: true; organizationId: string }
  | { ok: false; status: number; body: { error: string; code?: string } };

/**
 * Auth do LINK DE PLANILHA por token na QUERY (`?token=`), pro Google Sheets `=IMPORTDATA`
 * e Excel "Dados → Da Web" (GET sem header).
 *
 * ⚠️ CRÍTICO (fix do review adversarial): valida contra `validate_report_token` (tabela
 * `report_tokens`), um espaço de credencial ISOLADO de `api_keys`. Um report_token NÃO
 * autentica em /api/public/v1/contacts, /api/mcp nem endpoints de escrita — ele só existe
 * pra rota de totais agregados (sem PII). NUNCA reusar `validateToken`/api_keys aqui.
 */
export async function authReportTokenFromQuery(request: Request): Promise<ReportTokenAuthResult> {
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!token.trim()) {
    return { ok: false, status: 401, body: { error: 'Missing report token', code: 'AUTH_MISSING' } };
  }

  const sb = getAnonSupabase();
  if (!sb) {
    return { ok: false, status: 500, body: { error: 'Supabase not configured', code: 'SERVER_NOT_CONFIGURED' } };
  }

  const { data, error } = await sb.rpc('validate_report_token', { p_token: token }).maybeSingle();
  const row = (data ?? null) as { organization_id?: unknown } | null;
  if (error || !row || typeof row.organization_id !== 'string' || !row.organization_id.trim()) {
    return { ok: false, status: 401, body: { error: 'Invalid report token', code: 'AUTH_INVALID' } };
  }

  return { ok: true, organizationId: row.organization_id };
}
