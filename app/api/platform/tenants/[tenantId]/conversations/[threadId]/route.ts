import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { buildConversationThreadMetadataUpdate, getCanonicalConversationPhone } from '@/lib/conversations/threadMetadata';
import { loadConversationThreadInboxItem } from '@/lib/conversations/server';
import { pickNextHumanAssignee } from '@/lib/conversations/routing';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { canManageClinicSettings } from '@/lib/auth/scope';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ThreadPatchSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  contact_name: z.string().max(160).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  status: z.enum(['ai_active', 'human_queue', 'human_active', 'resolved', 'closed']).optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
  assign_next_human: z.boolean().optional(),
  handoff_reason: z.string().max(240).nullable().optional(),
  mark_as_read: z.boolean().optional(),
}).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => null);
  const parsed = ThreadPatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { tenantId, threadId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();

  const existingThread = await admin
    .from('conversation_threads')
    .select('id, assigned_user_id, metadata, status')
    .eq('id', threadId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (existingThread.error) return json({ error: existingThread.error.message }, 500);
  if (!existingThread.data) return json({ error: 'Thread not found' }, 404);

  let nextAssignedUserId = parsed.data.assigned_user_id;

  if (parsed.data.assign_next_human) {
    nextAssignedUserId = await pickNextHumanAssignee(admin as never, tenantId, existingThread.data.assigned_user_id);
  }

  if (nextAssignedUserId) {
    const assignee = await admin
      .from('profiles')
      .select('id')
      .eq('id', nextAssignedUserId)
      .eq('organization_id', tenantId)
      .maybeSingle();

    if (assignee.error) return json({ error: assignee.error.message }, 500);
    if (!assignee.data) return json({ error: 'Assigned user not found' }, 404);
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
  if (parsed.data.contact_name !== undefined) updates.contact_name = parsed.data.contact_name?.trim() || null;
  if (parsed.data.contact_phone !== undefined) {
    updates.contact_phone = getCanonicalConversationPhone(parsed.data.contact_phone) || null;
  }
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.assigned_user_id !== undefined || parsed.data.assign_next_human) {
    updates.assigned_user_id = nextAssignedUserId ?? null;
  }
  if (parsed.data.mark_as_read) {
    updates.metadata = buildConversationThreadMetadataUpdate((updates.metadata as Record<string, unknown> | undefined) ?? existingThread.data.metadata, {
      unreadCount: 0,
    });
  }

  if (parsed.data.status !== undefined || parsed.data.assign_next_human || parsed.data.handoff_reason !== undefined) {
    const nextStatus = parsed.data.status ?? existingThread.data.status;
    updates.metadata = buildConversationThreadMetadataUpdate((updates.metadata as Record<string, unknown> | undefined) ?? existingThread.data.metadata, {
      routingMode: nextStatus === 'ai_active' || nextStatus === 'resolved' ? 'ai' : 'human',
      humanLocked: nextStatus === 'human_queue' || nextStatus === 'human_active',
      aiLockedReason:
        nextStatus === 'human_queue' || nextStatus === 'human_active'
          ? parsed.data.handoff_reason?.trim() || 'human_handoff'
          : null,
      handoffRequestedAt:
        nextStatus === 'human_queue' || nextStatus === 'human_active'
          ? new Date().toISOString()
          : null,
      handoffReason:
        nextStatus === 'human_queue' || nextStatus === 'human_active'
          ? parsed.data.handoff_reason?.trim() || 'human_handoff'
          : null,
      resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null,
      resolvedBy: nextStatus === 'resolved' ? auth.profile.id : null,
      queueAssignedUserId:
        nextStatus === 'human_queue' || nextStatus === 'human_active'
          ? nextAssignedUserId ?? existingThread.data.assigned_user_id ?? null
          : null,
      unreadCount:
        nextStatus === 'resolved' || nextStatus === 'ai_active'
          ? 0
          : undefined,
    });
  }

  const updateResult = await admin
    .from('conversation_threads')
    .update(updates)
    .eq('id', threadId)
    .eq('organization_id', tenantId);

  if (updateResult.error) return json({ error: updateResult.error.message }, 500);

  try {
    const thread = await loadConversationThreadInboxItem(admin, tenantId, threadId);
    return json({ ok: true, thread });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao carregar conversa atualizada.' }, 500);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, threadId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  if (!canManageClinicSettings(auth.profile.role)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createStaticAdminClient();

  const existingThread = await admin
    .from('conversation_threads')
    .select('id, contact_id, deal_id')
    .eq('id', threadId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (existingThread.error) return json({ error: existingThread.error.message }, 500);
  if (!existingThread.data) return json({ error: 'Thread not found' }, 404);

  const { contact_id: contactId, deal_id: dealId } = existingThread.data;

  if (dealId) {
    const deleteDeal = await admin
      .from('deals')
      .delete()
      .eq('id', dealId)
      .eq('organization_id', tenantId);

    if (deleteDeal.error) return json({ error: deleteDeal.error.message }, 500);
  }

  if (contactId) {
    const deleteActivities = await admin
      .from('activities')
      .delete()
      .eq('organization_id', tenantId)
      .eq('contact_id', contactId);

    if (deleteActivities.error) return json({ error: deleteActivities.error.message }, 500);

    const deleteContact = await admin
      .from('contacts')
      .delete()
      .eq('id', contactId)
      .eq('organization_id', tenantId);

    if (deleteContact.error) return json({ error: deleteContact.error.message }, 500);
  }

  const deleteThread = await admin
    .from('conversation_threads')
    .delete()
    .eq('id', threadId)
    .eq('organization_id', tenantId);

  if (deleteThread.error) return json({ error: deleteThread.error.message }, 500);

  return json({
    ok: true,
    deleted: {
      threadId,
      dealId: dealId ?? null,
      contactId: contactId ?? null,
    },
  });
}
