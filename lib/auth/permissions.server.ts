import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';
import { APP_PERMISSIONS, type AppPermission, type PermissionOverrideMap } from '@/lib/auth/permissions';

export async function loadPermissionOverrides(userId: string): Promise<PermissionOverrideMap> {
  const admin = createStaticAdminClient();
  const { data, error } = await admin
    .from('profile_permissions')
    .select('permission_key, enabled')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  return (data ?? []).reduce<PermissionOverrideMap>((acc, row) => {
    const key = row.permission_key as AppPermission;
    if (APP_PERMISSIONS.includes(key)) {
      acc[key] = row.enabled;
    }
    return acc;
  }, {});
}
