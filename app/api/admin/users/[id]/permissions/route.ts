import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { APP_PERMISSIONS, resolvePermissionMap } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const PermissionSchema = z.object(
  Object.fromEntries(APP_PERMISSIONS.map((permission) => [permission, z.boolean().optional()]))
).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = PermissionSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { id } = await ctx.params;
  const admin = createStaticAdminClient();

  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.organization_id !== auth.targetOrganizationId) return json({ error: 'Forbidden' }, 403);

  const existingOverrides = await loadPermissionOverrides(id);
  const nextOverrides = { ...existingOverrides, ...parsed.data };

  for (const permissionKey of APP_PERMISSIONS) {
    const nextValue = nextOverrides[permissionKey];
    if (typeof nextValue !== 'boolean') continue;

    const { error } = await admin.from('profile_permissions').upsert(
      {
        user_id: id,
        organization_id: auth.targetOrganizationId,
        permission_key: permissionKey,
        enabled: nextValue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,permission_key' }
    );

    if (error) return json({ error: error.message }, 500);
  }

  const permissionOverrides = await loadPermissionOverrides(id);

  return json({
    ok: true,
    permission_overrides: permissionOverrides,
    permissions: resolvePermissionMap(target.role, permissionOverrides),
  });
}
