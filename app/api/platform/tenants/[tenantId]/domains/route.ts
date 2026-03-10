import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const DomainSchema = z.object({
  host: z.string().min(3).max(255),
  is_primary: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
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

export async function GET(_req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('organization_domains')
    .select('id, host, is_primary, status, created_at')
    .eq('organization_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ domains: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ tenantId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminProfile();
  if ('error' in auth) return auth.error;

  const { tenantId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = DomainSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const normalizedHost = parsed.data.host.trim().toLowerCase();

  if (parsed.data.is_primary) {
    await admin
      .from('organization_domains')
      .update({ is_primary: false })
      .eq('organization_id', tenantId);
  }

  const { data, error } = await admin
    .from('organization_domains')
    .insert({
      organization_id: tenantId,
      host: normalizedHost,
      is_primary: parsed.data.is_primary ?? true,
      status: parsed.data.status ?? 'active',
      created_at: new Date().toISOString(),
    })
    .select('id, host, is_primary, status, created_at')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, domain: data }, 201);
}
