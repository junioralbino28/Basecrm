import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import {
  ConversationCalendarBlockInputSchema,
  mapConversationCalendarBlockRow,
  toConversationCalendarBlockRow,
} from '@/lib/conversations/calendarBlocks';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

type RouteContext = { params: Promise<{ tenantId: string; connectionId: string }> };

async function authorize(ctx: RouteContext) {
  const params = await ctx.params;
  const auth = await requireTenantAccess(params.tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  return { params, auth };
}

async function loadConnectionCalendar(
  admin: ReturnType<typeof createStaticAdminClient>,
  params: { tenantId: string; connectionId: string },
) {
  const connection = await admin
    .from('channel_connections')
    .select('id, config')
    .eq('id', params.connectionId)
    .eq('organization_id', params.tenantId)
    .maybeSingle();
  if (connection.error) return { error: json({ error: connection.error.message }, 500) };
  if (!connection.data) return { error: json({ error: 'Channel not found' }, 404) };
  const calendar = ConversationCalendarConfigSchema.safeParse(
    (connection.data.config as Record<string, unknown> | null)?.calendar,
  );
  if (!calendar.success || !calendar.data.ownerId) {
    return { error: json({ error: 'Configure o responsável da agenda antes de gerenciar bloqueios.' }, 400) };
  }
  return { calendar: calendar.data };
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { params, auth } = await authorize(ctx);
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const loaded = await loadConnectionCalendar(admin, params);
  if ('error' in loaded) return loaded.error;
  const result = await admin
    .from('conversation_calendar_blocks')
    .select('id, title, kind, recurrence, block_date, weekdays, start_time, end_time, all_day')
    .eq('organization_id', params.tenantId)
    .eq('channel_connection_id', params.connectionId)
    .eq('owner_id', loaded.calendar.ownerId)
    .order('created_at', { ascending: true });
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ blocks: (result.data || []).map(mapConversationCalendarBlockRow) });
}

export async function POST(req: Request, ctx: RouteContext) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const { params, auth } = await authorize(ctx);
  if ('error' in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = ConversationCalendarBlockInputSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  const loaded = await loadConnectionCalendar(admin, params);
  if ('error' in loaded) return loaded.error;

  const inserted = await admin
    .from('conversation_calendar_blocks')
    .insert({
      organization_id: params.tenantId,
      channel_connection_id: params.connectionId,
      owner_id: loaded.calendar.ownerId,
      created_by: auth.profile.id,
      ...toConversationCalendarBlockRow(parsed.data),
    })
    .select('id, title, kind, recurrence, block_date, weekdays, start_time, end_time, all_day')
    .single();
  if (inserted.error) return json({ error: inserted.error.message }, 500);
  return json({ block: mapConversationCalendarBlockRow(inserted.data) }, 201);
}
