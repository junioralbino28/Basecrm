import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import {
  buildConversationThreadMetadataUpdate,
  getCanonicalConversationPhone,
  readConversationThreadMetadata,
} from '@/lib/conversations/threadMetadata';
import {
  ConversationMeetingActionSchema,
  resolveConversationMeetingAction,
} from '@/lib/conversations/meetingHandoffAction';
import { buildConversationMeetingActivity } from '@/lib/conversations/meetingRequest';
import { resolveConversationCalendarConfig } from '@/lib/conversations/meetingAvailability';
import {
  enqueueGoogleCalendarMeetingEvent,
  markGoogleCalendarMeetingCancelPending,
} from '@/lib/googleCalendar/meetingEventQueue';
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
  handoff_action: ConversationMeetingActionSchema.optional(),
}).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ tenantId: string; threadId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => null);
  const parsed = ThreadPatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const { tenantId, threadId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: parsed.data.handoff_action
      ? ['conversations.reply']
      : ['conversations.access'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();

  const existingThread = await admin
    .from('conversation_threads')
    .select('id, assigned_user_id, channel_connection_id, contact_id, contact_name, deal_id, metadata, status')
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

  if (parsed.data.handoff_action) {
    const currentMetadata = readConversationThreadMetadata(existingThread.data.metadata);
    if (!currentMetadata.lastHandoff) {
      return json({ error: 'Esta conversa nao possui um handoff ativo.' }, 409);
    }

    let resolvedMeeting;
    try {
      resolvedMeeting = resolveConversationMeetingAction({
        organizationId: tenantId,
        threadId,
        handoff: currentMetadata.lastHandoff,
        action: parsed.data.handoff_action,
        performedAt: updates.updated_at as string,
        performedBy: auth.profile.id,
        // Remarcar/cancelar recai sobre a reuniao que ja estava confirmada nesta conversa, nao
        // sobre um evento novo — e o que impede o evento antigo de ficar orfao no Google.
        previousActivityId: currentMetadata.confirmedMeetingActivityId ?? null,
      });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : 'Acao de reuniao invalida.',
      }, 422);
    }

    // Cancelar: a reuniao sai da agenda do CRM e o evento espelho sai do Google. Sem reserva
    // nenhuma a refazer — e o vinculo com a reuniao confirmada e apagado da conversa.
    if (resolvedMeeting.cancelled) {
      const cancelledAt = updates.updated_at as string;
      const cancelledActivity = await admin
        .from('activities')
        .update({ completed: true, deleted_at: cancelledAt })
        .eq('id', resolvedMeeting.activityId)
        .eq('organization_id', tenantId)
        .eq('type', 'MEETING');
      if (cancelledActivity.error) return json({ error: cancelledActivity.error.message }, 500);

      // Sem rede aqui: so marca `cancel_pending`; o `events.delete` acontece no tick.
      await markGoogleCalendarMeetingCancelPending({
        admin,
        organizationId: tenantId,
        activityId: resolvedMeeting.activityId,
        now: cancelledAt,
      });

      updates.metadata = buildConversationThreadMetadataUpdate(existingThread.data.metadata, {
        handoff: resolvedMeeting.handoff,
        confirmedMeetingActivityId: null,
      });
    } else {
      let meetingOwnerId = existingThread.data.assigned_user_id ?? auth.profile.id;
      let meetingTimezone = 'America/Sao_Paulo';
      if (existingThread.data.channel_connection_id) {
        const connectionResult = await admin
          .from('channel_connections')
          .select('config')
          .eq('id', existingThread.data.channel_connection_id)
          .eq('organization_id', tenantId)
          .maybeSingle();
        if (connectionResult.error) return json({ error: connectionResult.error.message }, 500);
        const calendar = resolveConversationCalendarConfig(
          connectionResult.data?.config as Record<string, unknown> | null,
        );
        if (calendar) {
          meetingOwnerId = calendar.ownerId ?? meetingOwnerId;
          meetingTimezone = calendar.timezone;
        }
      }

      const meetingActivity = buildConversationMeetingActivity({
        organizationId: tenantId,
        eventId: resolvedMeeting.activityId,
        contactId: existingThread.data.contact_id,
        dealId: existingThread.data.deal_id,
        ownerId: meetingOwnerId,
        agentName: 'Atendimento humano',
        handoff: resolvedMeeting.handoff,
      });
      if (!meetingActivity) {
        return json({ error: 'Nao foi possivel montar a atividade da reuniao.' }, 422);
      }

      const currentActivity = await admin
        .from('activities')
        .select('id, contact_id, deal_id')
        .eq('id', resolvedMeeting.activityId)
        .eq('organization_id', tenantId)
        .maybeSingle();
      if (currentActivity.error) return json({ error: currentActivity.error.message }, 500);
      if (
        currentActivity.data
        && (
          currentActivity.data.contact_id !== meetingActivity.contact_id
          || currentActivity.data.deal_id !== meetingActivity.deal_id
        )
      ) {
        return json({ error: 'A atividade da reuniao pertence a outro contexto.' }, 409);
      }

      const reservation = await admin.rpc('reserve_conversation_meeting', {
        p_activity_id: meetingActivity.id,
        p_organization_id: tenantId,
        p_channel_connection_id: existingThread.data.channel_connection_id,
        p_owner_id: meetingActivity.owner_id,
        p_contact_id: meetingActivity.contact_id,
        p_deal_id: meetingActivity.deal_id,
        p_title: meetingActivity.title,
        p_description: meetingActivity.description,
        p_date: meetingActivity.date,
        p_created_at: meetingActivity.created_at,
        p_timezone: meetingTimezone,
        p_allow_update: true,
      });
      if (reservation.error) return json({ error: reservation.error.message }, 500);
      if (reservation.data !== true) {
        return json({ error: 'Este horario nao esta mais disponivel para o responsavel.' }, 409);
      }

      updates.metadata = buildConversationThreadMetadataUpdate(existingThread.data.metadata, {
        handoff: resolvedMeeting.handoff,
        confirmedMeetingActivityId: resolvedMeeting.activityId,
      });

      // Google Agenda (Fatia 3): so a linha `pending`/`update_pending`, e so se o responsavel
      // tiver conexao `connected`. ZERO rede aqui — o evento sai no relogio de 5 min.
      await enqueueGoogleCalendarMeetingEvent({
        admin,
        organizationId: tenantId,
        threadId,
        activityId: meetingActivity.id,
        channelConnectionId: existingThread.data.channel_connection_id,
        ownerId: meetingActivity.owner_id,
        contactId: existingThread.data.contact_id,
        contactName: existingThread.data.contact_name,
        scheduledAt: meetingActivity.date,
        timezone: meetingTimezone,
        now: updates.updated_at as string,
      });
    }
  }

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

  const nextStatus = parsed.data.status ?? existingThread.data.status;
  if (parsed.data.status !== undefined || parsed.data.assign_next_human || parsed.data.handoff_reason !== undefined) {
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

  if (nextStatus === 'human_queue' || nextStatus === 'human_active') {
    const paused = await admin.rpc('pause_automation_enrollments_for_thread', {
      p_thread_id: threadId,
      p_actor_id: auth.profile.id,
      p_reason: parsed.data.handoff_reason?.trim() || nextStatus,
    });
    if (paused.error) {
      return json({ error: 'Falha ao pausar automações da conversa.' }, 500);
    }
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
