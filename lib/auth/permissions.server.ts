import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';
import { APP_PERMISSIONS, type AppPermission, type PermissionOverrideMap } from '@/lib/auth/permissions';

export async function loadPermissionOverrides(userId: string): Promise<PermissionOverrideMap> {
  const admin = createStaticAdminClient();
  try {
    const { data, error } = await admin
      .from('profile_permissions')
      .select('permission_key, enabled')
      .eq('user_id', userId);

    if (error) {
      const message = String(error.message || '');
      const code = String((error as { code?: string } | null)?.code || '');
      const shouldFallback =
        code === '42P01' ||
        message.toLowerCase().includes('profile_permissions') ||
        message.toLowerCase().includes('does not exist') ||
        message.toLowerCase().includes('permission denied');

      if (shouldFallback) {
        return {};
      }

      throw new Error(error.message);
    }

    return (data ?? []).reduce<PermissionOverrideMap>((acc, row) => {
      const key = row.permission_key as AppPermission;
      if (APP_PERMISSIONS.includes(key)) {
        acc[key] = row.enabled;
      }
      return acc;
    }, {});
  } catch {
    // Permissions overrides are optional. Fallback to role defaults instead of
    // breaking tenant-scoped pages when the overrides table is unavailable.
    return {};
  }
}
