/**
 * GET/POST /api/settings/automations-live — o "botão" do envio real das automações por
 * organização (2b) e o silêncio noturno (2c).
 *
 * GET devolve: a chave (ligada/desligada), a saúde do tick (é ela que decide se a chave PODE
 * ser ligada), o silêncio noturno com o fuso, e se o executor deste ambiente está ligado.
 * POST liga/desliga a chave por `set_automation_live_enabled` (o gate de saúde no banco recusa
 * com 55000 quando o tick não está de pé) e grava o silêncio noturno.
 *
 * SEGURANÇA (mesmo padrão de /api/settings/meta-capi): só admin (agência ou clínica) do tenant;
 * mesma origem no POST; a chave vai pela função de sistema (service_role) porque o gate mora
 * nela; o silêncio noturno vai pelo cliente do usuário, então o RLS can_configure decide.
 */
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireAdminTenantContext } from '@/lib/platform/adminTenantContext';
import { isAutomationExecutorEnabled } from '@/lib/automations/executor';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const UpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    quietHoursStart: z.string().regex(TIME_PATTERN).optional(),
    quietHoursEnd: z.string().regex(TIME_PATTERN).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function hhmm(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

async function readState(organizationId: string) {
  const admin = createStaticAdminClient();
  const [settings, health] = await Promise.all([
    admin
      .from('organization_settings')
      .select('automation_live_enabled, automation_timezone, automation_quiet_hours_start, automation_quiet_hours_end')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    admin.rpc('automation_scheduler_health').single(),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  if (health.error) throw new Error(health.error.message);
  const h = (health.data ?? {}) as Record<string, unknown>;
  return {
    liveEnabled: settings.data?.automation_live_enabled === true,
    executorEnabledInEnvironment: isAutomationExecutorEnabled(),
    quietHours: {
      start: hhmm(settings.data?.automation_quiet_hours_start) || '20:00',
      end: hhmm(settings.data?.automation_quiet_hours_end) || '08:00',
      timezone: (settings.data?.automation_timezone as string | null) ?? 'America/Sao_Paulo',
    },
    tick: {
      healthy: h.healthy === true,
      degraded: h.degraded === true,
      stage: (h.stage as string | null) ?? null,
      reason: (h.reason as string | null) ?? null,
      lastSucceededAt: (h.last_succeeded_at as string | null) ?? null,
      lastError: (h.last_error as string | null) ?? null,
      consecutiveFailures: typeof h.consecutive_failures === 'number' ? h.consecutive_failures : 0,
    },
  };
}

export async function GET() {
  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;
  try {
    return json(await readState(auth.targetOrganizationId));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao ler configuração.' }, 500);
  }
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireAdminTenantContext();
  if ('error' in auth) return auth.error;

  const parsed = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'Payload inválido', details: parsed.error.flatten() }, 400);
  }
  const updates = parsed.data;

  if (updates.timezone !== undefined && !isValidTimezone(updates.timezone)) {
    return json({ error: 'Fuso horário desconhecido. Use um nome como America/Sao_Paulo.' }, 400);
  }
  if (
    updates.quietHoursStart !== undefined
    && updates.quietHoursEnd !== undefined
    && updates.quietHoursStart === updates.quietHoursEnd
  ) {
    return json({ error: 'O silêncio noturno precisa de começo e fim diferentes.' }, 400);
  }

  // Ordem (parecer do Codex, I2): primeiro a chave, que pode ser recusada pelo gate de saúde;
  // se ela falhar, nada é gravado. O silêncio noturno vai depois; se ele falhar, a resposta
  // diz o que já foi aplicado.
  if (updates.enabled !== undefined) {
    const admin = createStaticAdminClient();
    const toggled = await admin.rpc('set_automation_live_enabled', {
      p_organization_id: auth.targetOrganizationId,
      p_enabled: updates.enabled,
    });
    if (toggled.error) {
      if (toggled.error.code === '55000') {
        // O gate de saúde do tick recusou: a mensagem já vem com o motivo.
        return json({ error: `Não dá para ligar o envio real agora: ${toggled.error.message}`, applied: {} }, 409);
      }
      return json({ error: toggled.error.message, applied: {} }, 500);
    }
  }

  const settingsUpdates: Record<string, unknown> = {};
  if (updates.timezone !== undefined) settingsUpdates.automation_timezone = updates.timezone;
  if (updates.quietHoursStart !== undefined) settingsUpdates.automation_quiet_hours_start = `${updates.quietHoursStart}:00`;
  if (updates.quietHoursEnd !== undefined) settingsUpdates.automation_quiet_hours_end = `${updates.quietHoursEnd}:00`;

  if (Object.keys(settingsUpdates).length > 0) {
    const supabase = await createClient();
    const { error } = await supabase
      .from('organization_settings')
      .upsert(
        {
          organization_id: auth.targetOrganizationId,
          updated_at: new Date().toISOString(),
          ...settingsUpdates,
        },
        { onConflict: 'organization_id' },
      );
    if (error) {
      const message = error.code === '23514'
        ? 'O silêncio noturno precisa de começo e fim diferentes.'
        : error.message;
      const applied = updates.enabled !== undefined ? { enabled: updates.enabled } : {};
      return json({ error: message, applied }, error.code === '23514' ? 400 : 500);
    }
  }

  try {
    return json({ ok: true, ...(await readState(auth.targetOrganizationId)) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao ler configuração.' }, 500);
  }
}
