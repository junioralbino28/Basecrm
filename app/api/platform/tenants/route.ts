import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { runProvisioning } from '@/lib/provisioning/runProvisioning';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const CreateTenantSchema = z.object({
  companyName: z.string().min(2).max(200),
  subdomain: z.string().min(2).max(48).optional().or(z.literal('')),
  specialty: z.string().min(2).max(120),
  primaryGoal: z.string().min(2).max(200),
  serviceModel: z.string().min(2).max(200),
  leadChannel: z.string().min(2).max(120),
  notes: z.string().max(1000).optional().or(z.literal('')),
}).strict();

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

export async function GET() {
  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('organizations')
    .select(`
      id,
      name,
      created_at,
      organization_editions(edition_key, branding_config, enabled_modules),
      provisioning_runs(id, status, created_at, result_payload)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return json({ error: error.message }, 500);

  const tenants = (data || []).map((row: any) => {
    const edition = Array.isArray(row.organization_editions) ? row.organization_editions[0] : row.organization_editions;
    const runs = Array.isArray(row.provisioning_runs) ? row.provisioning_runs : [];
    const lastRun = [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
    return {
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      edition_key: edition?.edition_key || null,
      branding_config: edition?.branding_config || {},
      enabled_modules: edition?.enabled_modules || [],
      last_run: lastRun,
    };
  });

  return json({ tenants });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = CreateTenantSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  try {
    const result = await runProvisioning({
      operatorUserId: auth.profile.id,
      operatorOrganizationId: auth.profile.organization_id,
      editionKey: 'clinic',
      input: {
        ...parsed.data,
        subdomain: parsed.data.subdomain || undefined,
        notes: parsed.data.notes || undefined,
      },
    });

    return json({ ok: true, tenant: result }, 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha no provisionamento.' }, 500);
  }
}
