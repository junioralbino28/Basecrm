import 'server-only';

import { cookies } from 'next/headers';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAgencyAdminRole, normalizeAppUserRole } from '@/lib/auth/scope';

const CURRENT_TENANT_COOKIE = 'basecrm_current_tenant_id';

export async function resolveActiveTenantContext() {
  const supabase = await createClient();
  const admin = createStaticAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Unauthorized' as const };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id, first_name, nickname')
    .eq('id', user.id)
    .single();

  if (error || !profile?.organization_id) return { error: 'Profile not found' as const };

  const role = normalizeAppUserRole(profile.role);
  let targetOrganizationId = profile.organization_id;

  if (isAgencyAdminRole(role)) {
    const cookieStore = await cookies();
    const selectedTenantId = cookieStore.get(CURRENT_TENANT_COOKIE)?.value || null;

    if (selectedTenantId) {
      const { data: tenant } = await admin.from('organizations').select('id').eq('id', selectedTenantId).maybeSingle();
      if (tenant?.id) {
        targetOrganizationId = tenant.id;
      }
    }
  }

  return {
    supabase,
    user,
    profile: {
      ...profile,
      role,
    },
    targetOrganizationId,
  };
}
