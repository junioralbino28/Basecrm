import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { APP_PERMISSIONS } from '@/lib/auth/permissions';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const AcceptInviteSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  // Mitigação CSRF: cria usuário (efeito colateral), só aceita same-origin.
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const raw = await req.json().catch(() => null);
  const parsed = AcceptInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const { token, email, password, name } = parsed.data;

  const admin = createStaticAdminClient();

  const { data: invite, error: inviteError } = await admin
    .from('organization_invites')
    // Performance: fetch only what we need (keeps payload small and avoids extra parsing).
    .select('id, token, email, role, cargo, permission_overrides, expires_at, used_at, organization_id')
    .eq('token', token)
    .is('used_at', null)
    .single();

  if (inviteError || !invite) {
    return json({ error: 'Convite inválido ou já foi utilizado' }, 400);
  }

  // Performance: avoid multiple Date allocations.
  const nowIso = new Date().toISOString();
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    return json({ error: 'Convite expirado' }, 400);
  }

  // O convite DEVE ter email travado. Convites legados sem email não são aceitáveis
  // (senão qualquer email poderia usá-los — brecha de takeover).
  if (!invite.email) {
    return json({ error: 'Convite inválido: sem email associado. Peça um novo convite.' }, 400);
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    return json({ error: 'Este convite não é válido para este email' }, 400);
  }

  const { data: authData, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name: name || email.split('@')[0],
      organization_id: invite.organization_id,
      role: invite.role,
    },
  });

  if (createError) return json({ error: createError.message }, 400);

  const userId = authData.user.id;

  const displayName = name || email.split('@')[0];

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        name: displayName,
        first_name: displayName,
        cargo: invite.cargo ?? null,
        organization_id: invite.organization_id,
        role: invite.role,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: profileError.message }, 400);
  }

  // Aplica as permissões escolhidas NO CONVITE (snapshot) -> profile_permissions.
  // Mesmo upsert de app/api/admin/users/[id]/permissions; whitelist por APP_PERMISSIONS;
  // usa a org DO CONVITE (não a do ator) para não vazar cross-tenant.
  const inviteOverrides = (invite.permission_overrides ?? {}) as Record<string, unknown>;
  for (const permissionKey of APP_PERMISSIONS) {
    const value = inviteOverrides[permissionKey];
    if (typeof value !== 'boolean') continue;

    const { error: permError } = await admin.from('profile_permissions').upsert(
      {
        user_id: userId,
        organization_id: invite.organization_id,
        permission_key: permissionKey,
        enabled: value,
        updated_at: nowIso,
      },
      { onConflict: 'user_id,permission_key' }
    );

    if (permError) {
      await admin.auth.admin.deleteUser(userId);
      return json({ error: permError.message }, 400);
    }
  }

  // Guard atômico: só marca como usado se ainda estava null (consistência do single-use).
  await admin
    .from('organization_invites')
    .update({ used_at: nowIso })
    .eq('id', invite.id)
    .is('used_at', null);

  return json({ ok: true, user: { id: userId, email } });
}
