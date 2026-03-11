import { cookies, headers } from 'next/headers';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { resolveTenantByHost, resolveTenantByOrganizationId } from '@/lib/tenancy/resolveTenant';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

const CURRENT_TENANT_COOKIE = 'basecrm_current_tenant_id';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) return json({ error: 'Profile not found' }, 404);

  const selectedTenantId = cookieStore.get(CURRENT_TENANT_COOKIE)?.value || null;
  const role = normalizeAppUserRole(profile.role);
  const isAgencyAdmin = isAgencyAdminRole(role);

  if (selectedTenantId && isAgencyAdmin) {
    const access = await requireTenantAccess(selectedTenantId);
    if (!('error' in access)) {
      const selectedTenant = await resolveTenantByOrganizationId({
        supabase: createStaticAdminClient() as any,
        organizationId: selectedTenantId,
        host,
        source: 'selected',
      });

      if (selectedTenant) return json({ tenant: selectedTenant });
    }
  }

  const hostTenant = await resolveTenantByHost({
    supabase: supabase as any,
    host,
    fallbackOrganizationId: null,
  });

  if (hostTenant) return json({ tenant: hostTenant });

  if (isAgencyAdmin) return json({ tenant: null });

  const tenant = await resolveTenantByHost({
    supabase: supabase as any,
    host,
    fallbackOrganizationId: profile.organization_id,
  });

  if (!tenant) return json({ error: 'Tenant not found' }, 404);

  return json({ tenant });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : null;

  if (!tenantId) {
    const cookieStore = await cookies();
    cookieStore.delete(CURRENT_TENANT_COOKIE);
    return json({ ok: true, tenant: null });
  }

  const access = await requireTenantAccess(tenantId);
  if ('error' in access) return access.error;

  const cookieStore = await cookies();
  cookieStore.set(CURRENT_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  const tenant = await resolveTenantByOrganizationId({
    supabase: createStaticAdminClient() as any,
    organizationId: tenantId,
    source: 'selected',
  });

  return json({ ok: true, tenant });
}
