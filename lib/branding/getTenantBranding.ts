import 'server-only';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { resolveTenantByHost } from '@/lib/tenancy/resolveTenant';

export async function getTenantBranding() {
  const supabase = await createClient();
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let fallbackOrganizationId: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    fallbackOrganizationId = (profile?.organization_id as string | null) ?? null;
  }

  const tenant = await resolveTenantByHost({
    supabase: supabase as any,
    host,
    fallbackOrganizationId,
  });

  return tenant?.brandingConfig || {};
}
