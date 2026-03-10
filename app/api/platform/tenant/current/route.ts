import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { resolveTenantByHost } from '@/lib/tenancy/resolveTenant';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) return json({ error: 'Profile not found' }, 404);

  const tenant = await resolveTenantByHost({
    supabase: supabase as any,
    host,
    fallbackOrganizationId: profile.organization_id,
  });

  if (!tenant) return json({ error: 'Tenant not found' }, 404);

  return json({ tenant });
}
