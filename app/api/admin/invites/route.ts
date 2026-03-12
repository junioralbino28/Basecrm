import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { APP_USER_ROLES, getAssignableRoles, normalizeAppUserRole, type AppUserRole } from '@/lib/auth/scope';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const CreateInviteSchema = z
  .object({
    role: z.enum(APP_USER_ROLES).default('clinic_staff'),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    email: z.string().email().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    scope: z.enum(['agency', 'clinic']).optional(),
  })
  .strict();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const scope = searchParams.get('scope') === 'agency' ? 'agency' : undefined;
  const supabase = await createClient();
  const auth = await requireAdminTenantContext({
    tenantId,
    scope,
  });
  if ('error' in auth) return auth.error;

  const { data: invites, error } = await supabase
    .from('organization_invites')
    .select('id, token, role, email, created_at, expires_at, used_at, created_by')
    .eq('organization_id', auth.targetOrganizationId)
    .is('used_at', null)
    .limit(200)
    .order('created_at', { ascending: false });

  if (error) return json({ error: error.message }, 500);

  return json({ invites: invites || [] });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const supabase = await createClient();
  const raw = await req.json().catch(() => null);
  const parsed = CreateInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const auth = await requireAdminTenantContext({
    tenantId: typeof raw?.tenantId === 'string' ? raw.tenantId : null,
    scope: raw?.scope === 'agency' ? 'agency' : undefined,
  });
  if ('error' in auth) return auth.error;

  const requestedRole = normalizeAppUserRole(parsed.data.role);
  const allowedRoles = getAssignableRoles({
    actorRole: auth.me.role,
    managingOwnOrganization: auth.managingOwnOrganization,
  });
  if (!allowedRoles.includes(requestedRole)) {
    return json({ error: 'Role not allowed for this context' }, 403);
  }

  const expiresAt = parsed.data.expiresAt ?? null;

  const { data: invite, error } = await supabase
    .from('organization_invites')
    .insert({
      organization_id: auth.targetOrganizationId,
      role: requestedRole as AppUserRole,
      email: parsed.data.email ?? null,
      expires_at: expiresAt,
      created_by: auth.me.id,
    })
    .select('id, token, role, email, created_at, expires_at, used_at, created_by')
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({ invite }, 201);
}
