import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import { getGoogleCalendarConnection } from '@/lib/googleCalendar/connectionStore';
import { clearGoogleFreeBusyCache } from '@/lib/googleCalendar/freeBusy';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Qual agenda a IA usa para ESCREVER, quais contam como OCUPADO e quais SO AVISAM (Fatia 5).
 *
 * Bloquear e avisar sao listas separadas de proposito: a agenda principal de uma equipe tem
 * compromissos de outras pessoas, e bloquear ali tiraria horario do closer sem motivo.
 *
 * O id da agenda vem do Google (`primary` ou `...@group.calendar.google.com`), entao e texto
 * livre — por isso o limite de tamanho, o teto de quantidade e a checagem de que a conexao
 * existe. Nao ha como validar aqui que a agenda existe sem gastar uma chamada; se o id estiver
 * errado, o passo do tick falha naquela reuniao e avisa no sino, sem quebrar mais nada.
 */
const CorpoSchema = z.object({
  writeCalendarId: z.string().trim().min(1).max(320),
  writeCalendarSummary: z.string().trim().max(200).nullable().optional(),
  busyCalendarIds: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
  watchCalendarIds: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
}).strict();

export async function PUT(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const parsed = CorpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Escolha de agenda inválida.' }, 400);

  const admin = createStaticAdminClient();
  const connection = await admin
    .from('channel_connections')
    .select('id, config')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();
  if (connection.error) return json({ error: connection.error.message }, 500);
  if (!connection.data) return json({ error: 'Channel not found' }, 404);

  const calendar = ConversationCalendarConfigSchema.safeParse(
    (connection.data.config as Record<string, unknown> | null)?.calendar,
  );
  const ownerId = calendar.success ? calendar.data.ownerId : null;
  if (!ownerId) return json({ error: 'Esta conexão ainda não tem responsável pelas reuniões.' }, 409);

  const googleConnection = await getGoogleCalendarConnection({ admin, organizationId: tenantId, ownerId });
  if (!googleConnection) return json({ error: 'Google Agenda não está conectado.' }, 409);

  // A agenda de escrita nunca precisa aparecer tambem na lista de ocupado (ela ja conta sempre).
  const busy = [...new Set((parsed.data.busyCalendarIds ?? [])
    .filter((id) => id !== parsed.data.writeCalendarId))];
  // Observar e bloquear sao exclusivos: quem bloqueia ja para o horario, avisar seria ruido.
  // A agenda de escrita tambem sai daqui (ela e a propria agenda da reuniao).
  const watch = [...new Set((parsed.data.watchCalendarIds ?? [])
    .filter((id) => id !== parsed.data.writeCalendarId && !busy.includes(id)))];

  const updated = await admin
    .from('google_calendar_connections')
    .update({
      google_calendar_id: parsed.data.writeCalendarId,
      google_calendar_summary: parsed.data.writeCalendarSummary ?? null,
      busy_calendar_ids: busy,
      watch_calendar_ids: watch,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', tenantId)
    .eq('owner_id', ownerId)
    .select('organization_id');
  if (updated.error) return json({ error: updated.error.message }, 500);

  // O ocupado fica em cache por alguns minutos: sem limpar, a troca de agenda so valeria depois.
  clearGoogleFreeBusyCache();

  return json({
    ok: true,
    writeCalendarId: parsed.data.writeCalendarId,
    writeCalendarSummary: parsed.data.writeCalendarSummary ?? null,
    busyCalendarIds: busy,
    watchCalendarIds: watch,
  });
}
