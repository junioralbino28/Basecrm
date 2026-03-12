import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
    },
  });
}

type EvolutionDefaults = {
  apiUrl: string;
  apiKey: string;
};

const AgencyEvolutionSchema = z
  .object({
    apiUrl: z.string().url().optional().or(z.literal('')),
    apiKey: z.string().max(300).optional().or(z.literal('')),
  })
  .strict();

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readDefaults(metadata: unknown): EvolutionDefaults {
  const map = (metadata || {}) as Record<string, unknown>;
  const nested = (map.evolutionDefaults || {}) as Record<string, unknown>;

  const apiUrl =
    normalizeText(nested.apiUrl) ||
    normalizeText(map.evolutionDefaultApiUrl) ||
    normalizeText(map.evolution_api_url);

  const apiKey =
    normalizeText(nested.apiKey) ||
    normalizeText(map.evolutionDefaultApiKey) ||
    normalizeText(map.evolution_api_key);

  return { apiUrl, apiKey };
}

function publicDefaults(defaults: EvolutionDefaults) {
  return {
    apiUrl: defaults.apiUrl,
    hasApiKey: Boolean(defaults.apiKey),
    apiKeyLast4: defaults.apiKey ? defaults.apiKey.slice(-4) : '',
  };
}

async function requireAgencyAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) {
    return { error: json({ error: 'Profile not found' }, 404) };
  }

  if (!isAgencyAdminRole(normalizeAppUserRole(profile.role))) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }

  return { profile };
}

export async function GET() {
  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const editionResult = await admin
    .from('organization_editions')
    .select('organization_id, metadata')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (editionResult.error) return json({ error: editionResult.error.message }, 500);

  const defaults = readDefaults(editionResult.data?.metadata);
  return json({ defaults: publicDefaults(defaults) });
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAgencyAdminProfile();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = AgencyEvolutionSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  if (parsed.data.apiUrl === undefined && parsed.data.apiKey === undefined) {
    return json({ error: 'Informe apiUrl, apiKey ou ambos.' }, 400);
  }

  const admin = createStaticAdminClient();
  const editionResult = await admin
    .from('organization_editions')
    .select('organization_id, edition_key, metadata')
    .eq('organization_id', auth.profile.organization_id)
    .maybeSingle();

  if (editionResult.error) return json({ error: editionResult.error.message }, 500);

  const currentMetadata = ((editionResult.data?.metadata || {}) as Record<string, unknown>) || {};
  const currentDefaults = readDefaults(currentMetadata);
  const now = new Date().toISOString();

  const nextDefaults = {
    apiUrl:
      parsed.data.apiUrl === undefined ? currentDefaults.apiUrl : normalizeText(parsed.data.apiUrl),
    apiKey:
      parsed.data.apiKey === undefined ? currentDefaults.apiKey : normalizeText(parsed.data.apiKey),
    updatedAt: now,
  };

  const nextMetadata: Record<string, unknown> = {
    ...currentMetadata,
    evolutionDefaults: nextDefaults,
  };

  if (editionResult.data) {
    const update = await admin
      .from('organization_editions')
      .update({
        metadata: nextMetadata,
        updated_at: now,
      })
      .eq('organization_id', auth.profile.organization_id);

    if (update.error) return json({ error: update.error.message }, 500);
  } else {
    const insert = await admin
      .from('organization_editions')
      .upsert(
        {
          organization_id: auth.profile.organization_id,
          edition_key: 'agency',
          metadata: nextMetadata,
          updated_at: now,
        },
        { onConflict: 'organization_id' }
      );

    if (insert.error) return json({ error: insert.error.message }, 500);
  }

  return json({ ok: true, defaults: publicDefaults(nextDefaults) });
}
