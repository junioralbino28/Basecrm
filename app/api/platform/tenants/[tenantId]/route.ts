import { createClient, createStaticAdminClient } from '@/lib/supabase/server';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireAdminProfile() {
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

  if (error || !profile?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };
  if (profile.role !== 'admin') return { error: json({ error: 'Forbidden' }, 403) };

  return { profile };
}

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data, error } = await admin
    .from('organizations')
    .select(`
      id,
      name,
      created_at,
      organization_editions(edition_key, branding_config, enabled_modules, metadata),
      organization_domains(id, host, is_primary, status, created_at),
      channel_connections(id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at),
      provisioning_runs(id, status, input_payload, result_payload, created_at)
    `)
    .eq('id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Tenant not found' }, 404);

  const edition = Array.isArray((data as any).organization_editions)
    ? (data as any).organization_editions[0]
    : (data as any).organization_editions;

  return json({
    tenant: {
      id: data.id,
      name: data.name,
      created_at: data.created_at,
      edition_key: edition?.edition_key || null,
      branding_config: edition?.branding_config || {},
      enabled_modules: edition?.enabled_modules || [],
      metadata: edition?.metadata || {},
      domains: (data as any).organization_domains || [],
      channel_connections: (data as any).channel_connections || [],
      provisioning_runs: (data as any).provisioning_runs || [],
    },
  });
}
