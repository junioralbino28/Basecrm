import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { APP_USER_ROLES, getAssignableRoles, normalizeAppUserRole, type AppUserRole } from '@/lib/auth/scope';
import { APP_PERMISSIONS, resolvePermissionMap } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Mesmo shape do PermissionSchema de users/[id]/permissions: .strict() rejeita chave inválida.
const PermissionOverridesSchema = z
  .object(Object.fromEntries(APP_PERMISSIONS.map((permission) => [permission, z.boolean().optional()])))
  .strict();

const CreateInviteSchema = z
  .object({
    role: z.enum(APP_USER_ROLES).default('clinic_staff'),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    // Email OBRIGATÓRIO: garante que o lock do aceite (accept/route.ts) sempre trava.
    email: z.string().email(),
    cargo: z.string().trim().max(120).optional(),
    permissionOverrides: PermissionOverridesSchema.optional(),
    tenantId: z.string().uuid().nullable().optional(),
    scope: z.enum(['agency', 'clinic']).optional(),
  })
  .strict();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const scope = searchParams.get('scope') === 'agency' ? 'agency' : undefined;
  const supabase = await createClient();
  const admin = createStaticAdminClient();
  const auth = await requireAdminTenantContext({
    tenantId,
    scope,
  });
  if ('error' in auth) return auth.error;

  const { data: invites, error } = await admin
    .from('organization_invites')
    .select('id, token, role, email, cargo, permission_overrides, created_at, expires_at, used_at, created_by')
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
  const admin = createStaticAdminClient();
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

  // Defesa em profundidade: o convite NÃO pode conceder permissão que o próprio ator não tem.
  // Só "true" é limitado ao poder do ator; "false" é sempre permitido (restringir é ok).
  const actorOverrides = await loadPermissionOverrides(auth.me.id);
  const actorPermissions = resolvePermissionMap(auth.me.role, actorOverrides);
  const requestedOverrides = parsed.data.permissionOverrides ?? {};
  const clampedOverrides: Record<string, boolean> = {};
  for (const permissionKey of APP_PERMISSIONS) {
    const requested = requestedOverrides[permissionKey];
    if (typeof requested !== 'boolean') continue;
    clampedOverrides[permissionKey] = requested && actorPermissions[permissionKey] === true;
  }

  const { data: invite, error } = await admin
    .from('organization_invites')
    .insert({
      organization_id: auth.targetOrganizationId,
      role: requestedRole as AppUserRole,
      email: parsed.data.email,
      cargo: parsed.data.cargo ?? null,
      permission_overrides: clampedOverrides,
      expires_at: expiresAt,
      created_by: auth.me.id,
    })
    .select('id, token, role, email, cargo, permission_overrides, created_at, expires_at, used_at, created_by')
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({ invite }, 201);
}
