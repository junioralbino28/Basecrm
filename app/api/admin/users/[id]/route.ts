import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { APP_USER_ROLES, getAssignableRoles, normalizeAppUserRole } from '@/lib/auth/scope';
import { z } from 'zod';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const UpdateUserSchema = z
  .object({
    role: z.enum(APP_USER_ROLES),
  })
  .strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { id } = await ctx.params;
  const supabase = await createClient();
  const admin = createStaticAdminClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  if (id === auth.me.id) return json({ error: 'Voce nao pode alterar o seu proprio cargo por aqui' }, 400);

  const body = await req.json().catch(() => null);
  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.organization_id !== auth.targetOrganizationId) return json({ error: 'Forbidden' }, 403);

  const nextRole = normalizeAppUserRole(parsed.data.role);
  const allowedRoles = getAssignableRoles({
    actorRole: auth.me.role,
    managingOwnOrganization: auth.managingOwnOrganization,
  });
  if (!allowedRoles.includes(nextRole)) {
    return json({ error: 'Role not allowed for this context' }, 403);
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ role: nextRole, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) return json({ error: updateError.message }, 500);

  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const nextMetadata = {
    ...(authUser.user?.user_metadata || {}),
    role: nextRole,
    organization_id: target.organization_id,
  };
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(id, {
    user_metadata: nextMetadata,
  });
  if (authUpdateError) return json({ error: authUpdateError.message }, 500);

  return json({ ok: true, role: nextRole });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { id } = await ctx.params;
  const supabase = await createClient();
  const admin = createStaticAdminClient();
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  if (id === auth.me.id) return json({ error: 'Voce nao pode remover a si mesmo' }, 400);

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, email, organization_id')
    .eq('id', id)
    .maybeSingle();

  if (targetError) return json({ error: targetError.message }, 500);
  if (!target) return json({ error: 'User not found' }, 404);
  if (target.organization_id !== auth.targetOrganizationId) return json({ error: 'Forbidden' }, 403);

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
  if (authDeleteError) return json({ error: authDeleteError.message }, 500);

  await supabase.from('profiles').delete().eq('id', id);

  return json({ ok: true });
}
