import 'server-only';

import { cookies } from 'next/headers';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAgencyAdminRole, isClinicAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';

const CURRENT_TENANT_COOKIE = 'basecrm_current_tenant_id';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function requireAdminTenantContext(options?: {
  tenantId?: string | null;
  scope?: 'agency' | 'clinic';
}) {
  const supabase = await createClient();
  const admin = createStaticAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: json({ error: 'Unauthorized' }, 401) };

  const { data: me, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (error || !me?.organization_id) return { error: json({ error: 'Profile not found' }, 404) };

  const role = normalizeAppUserRole(me.role);
  const isAgencyAdmin = isAgencyAdminRole(role);
  const isClinicAdmin = isClinicAdminRole(role);

  if (!isAgencyAdmin && !isClinicAdmin) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }

  const cookieStore = await cookies();
  const selectedTenantId = cookieStore.get(CURRENT_TENANT_COOKIE)?.value || null;

  let targetOrganizationId = me.organization_id;

  const requestedScope = options?.scope || null;
  const requestedTenantId = options?.tenantId ?? null;

  if (isAgencyAdmin && requestedScope === 'agency') {
    targetOrganizationId = me.organization_id;
  } else if (isAgencyAdmin && requestedTenantId) {
    const access = await requireTenantAccess(requestedTenantId, { adminOnly: true });
    if ('error' in access) return { error: access.error };

    const { data: tenant } = await admin.from('organizations').select('id').eq('id', requestedTenantId).maybeSingle();
    if (tenant?.id) {
      targetOrganizationId = tenant.id;
    }
  } else if (isAgencyAdmin && selectedTenantId) {
    const access = await requireTenantAccess(selectedTenantId, { adminOnly: true });
    if (!('error' in access)) {
      const { data: tenant } = await admin.from('organizations').select('id').eq('id', selectedTenantId).maybeSingle();
      if (tenant?.id) {
        targetOrganizationId = tenant.id;
      }
    }
  }

  return {
    me: {
      ...me,
      role,
    },
    targetOrganizationId,
    managingOwnOrganization: targetOrganizationId === me.organization_id,
    isAgencyAdmin,
    isClinicAdmin,
  };
}
