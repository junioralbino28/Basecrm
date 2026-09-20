import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { requireTenantAccess } from '@/lib/platform/tenantAccess';
import { isAgencyAdminRole } from '@/lib/auth/scope';
import {
  ensureTenantAgencyBinding,
  resolveEvolutionCredentials,
} from '@/lib/channels/evolutionCredentials';
import { logoutEvolutionInstance } from '@/lib/channels/evolution';
import { validateEvolutionPairForWrite } from '@/lib/channels/evolutionUrlGuard';
import { isConversationAIPromptKey } from '@/lib/conversations/aiAgentConfig';
import { toPublicChannelConnection } from '@/lib/channels/publicChannel';
import { ConversationCalendarConfigSchema } from '@/lib/conversations/meetingAvailability';
import { IdleNudgeConfigSchema, resolveIdleNudgeConfig } from '@/lib/conversations/idleNudge';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const ChannelUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  status: z.enum(['pending', 'connected', 'disconnected', 'error']).optional(),
  config: z.object({
    apiUrl: z.string().url().optional().or(z.literal('')),
    instanceName: z.string().max(120).optional(),
    webhookUrl: z.string().url().optional().or(z.literal('')),
    webhookSecret: z.string().max(120).optional(),
    apiKey: z.string().max(300).optional(),
    sendMode: z.enum(['auto', 'number_text', 'number_textMessage', 'number_message', 'number_body']).optional(),
    aiEnabled: z.boolean().optional(),
    aiAgentName: z.string().trim().regex(/^[\p{L}\p{N} .'-]{1,80}$/u).optional(),
    aiPromptKey: z.string().trim().refine(isConversationAIPromptKey).optional(),
    calendar: ConversationCalendarConfigSchema.optional(),
    // Cutucada de inatividade por numero (parcial: o que faltar herda o valor atual ou o padrao).
    aiIdleNudge: IdleNudgeConfigSchema.partial().optional(),
    // Quem conduz as reunioes que a IA marca; vazio limpa e volta ao nome do responsavel da agenda.
    meetingHostName: z.string().trim().regex(/^(?:[\p{L}\p{N} .'-]{1,80})?$/u).optional(),
  }).optional(),
  metadata: z.object({
    phoneNumber: z.string().max(40).optional(),
    apiKeyLast4: z.string().max(12).optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
  last_healthcheck_at: z.string().datetime().nullable().optional(),
}).strict();

export async function PATCH(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = ChannelUpdateSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);

  const admin = createStaticAdminClient();
  if (
    isAgencyAdminRole(auth.profile.role) &&
    auth.profile.organization_id &&
    auth.profile.organization_id !== tenantId
  ) {
    try {
      await ensureTenantAgencyBinding({
        admin,
        tenantId,
        agencyOrganizationId: auth.profile.organization_id,
      });
    } catch (bindingError) {
      return json(
        {
          error:
            bindingError instanceof Error
              ? bindingError.message
              : 'Falha ao vincular clinica a agencia para credencial global.',
        },
        500
      );
    }
  }

  const current = await admin
      .from('channel_connections')
    .select('id, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (current.error) return json({ error: current.error.message }, 500);
  if (!current.data) return json({ error: 'Channel not found' }, 404);

  if (parsed.data.config?.calendar?.enabled) {
    const owner = await admin
      .from('profiles')
      .select('id')
      .eq('id', parsed.data.config.calendar.ownerId)
      .eq('organization_id', tenantId)
      .maybeSingle();
    if (owner.error) return json({ error: owner.error.message }, 500);
    if (!owner.data) return json({ error: 'Responsavel da agenda nao pertence a esta organizacao.' }, 400);
  }

  const nextConfig = parsed.data.config
    ? (() => {
        const incoming = parsed.data.config;
        const merged: Record<string, unknown> = { ...(current.data.config || {}) };

        if (incoming.apiUrl !== undefined) merged.apiUrl = incoming.apiUrl.trim() || undefined;
        if (incoming.instanceName !== undefined) merged.instanceName = incoming.instanceName.trim() || undefined;
        if (incoming.webhookUrl !== undefined) merged.webhookUrl = incoming.webhookUrl.trim() || undefined;
        if (incoming.sendMode !== undefined) merged.sendMode = incoming.sendMode;
        if (incoming.aiEnabled !== undefined) merged.aiEnabled = incoming.aiEnabled;
        if (incoming.aiAgentName !== undefined) merged.aiAgentName = incoming.aiAgentName;
        if (incoming.aiPromptKey !== undefined) merged.aiPromptKey = incoming.aiPromptKey;
        if (incoming.calendar !== undefined) merged.calendar = incoming.calendar;
        if (incoming.aiIdleNudge !== undefined) {
          const currentNudge = resolveIdleNudgeConfig(merged);
          merged.aiIdleNudge = {
            enabled: incoming.aiIdleNudge.enabled ?? currentNudge.enabled,
            delayMinutes: incoming.aiIdleNudge.delayMinutes ?? currentNudge.delayMinutes,
            text: incoming.aiIdleNudge.text ?? currentNudge.text,
          };
        }
        if (incoming.meetingHostName !== undefined) merged.meetingHostName = incoming.meetingHostName || undefined;
        if (incoming.webhookSecret !== undefined) {
          merged.webhookSecret =
            incoming.webhookSecret.trim() ||
            merged.webhookSecret ||
            crypto.randomUUID().replace(/-/g, '');
        } else if (!merged.webhookSecret) {
          merged.webhookSecret = crypto.randomUUID().replace(/-/g, '');
        }
        if (incoming.apiKey !== undefined) {
          merged.apiKey = incoming.apiKey.trim() || merged.apiKey || undefined;
        }
        if (!merged.sendMode) merged.sendMode = 'auto';

        return merged;
      })()
    : current.data.config;

  // Parecer do Codex, B7: endereço próprio da Evolution só com a chave própria (nunca a URL do
  // cliente com a chave da agência) e nunca apontando para a rede interna. Só quando o pedido
  // mexe no par; trocar só a IA ou o modo de envio não reabre a validação.
  if (parsed.data.config && (parsed.data.config.apiUrl !== undefined || parsed.data.config.apiKey !== undefined)) {
    const pairError = await validateEvolutionPairForWrite(nextConfig as { apiUrl?: unknown; apiKey?: unknown });
    if (pairError) return json({ error: pairError }, 400);
  }

  const nextMetadata = parsed.data.metadata
    ? {
        ...(current.data.metadata || {}),
        phoneNumber: parsed.data.metadata.phoneNumber?.trim() || undefined,
        apiKeyLast4:
          (parsed.data.config?.apiKey?.trim() || '').slice(-4) ||
          parsed.data.metadata.apiKeyLast4?.trim() ||
          (current.data.metadata as any)?.apiKeyLast4 ||
          undefined,
        notes: parsed.data.metadata.notes?.trim() || undefined,
      }
    : current.data.metadata;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.last_healthcheck_at !== undefined) updates.last_healthcheck_at = parsed.data.last_healthcheck_at;
  if (parsed.data.config !== undefined) updates.config = nextConfig;
  if (parsed.data.metadata !== undefined) updates.metadata = nextMetadata;

  const { data, error } = await admin
    .from('channel_connections')
    .update(updates)
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .select('id, provider, channel_type, name, status, config, metadata, last_healthcheck_at, created_at, updated_at')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({
    ok: true,
    channel: toPublicChannelConnection(data, { canManageChannelConfig: auth.canManageChannelConfig }),
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ tenantId: string; connectionId: string }> }) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const { tenantId, connectionId } = await ctx.params;
  const auth = await requireTenantAccess(tenantId, {
    requiredPermissions: ['whatsapp.manage_connection'],
  });
  if ('error' in auth) return auth.error;

  const admin = createStaticAdminClient();
  const current = await admin
    .from('channel_connections')
    .select('id, provider, config, metadata')
    .eq('id', connectionId)
    .eq('organization_id', tenantId)
    .maybeSingle();

  if (current.error) return json({ error: current.error.message }, 500);
  if (!current.data) return json({ error: 'Channel not found' }, 404);

  let warning: string | null = null;
  if (current.data.provider === 'evolution') {
    try {
      const instanceName = String((current.data.config as Record<string, unknown> | null)?.instanceName || '').trim();
      const resolved = await resolveEvolutionCredentials({
        admin,
        tenantId,
        connectionConfig: (current.data.config as Record<string, unknown> | null) || {},
        profileRole: auth.profile.role,
        requesterOrganizationId: auth.profile.organization_id,
      });

      if (!instanceName || !resolved?.apiUrl || !resolved.apiKey) {
        throw new Error('Credenciais ou instanceName ausentes para desconectar na Evolution.');
      }

      await logoutEvolutionInstance({
        apiUrl: resolved.apiUrl,
        instanceName,
        apiKey: resolved.apiKey,
      });
    } catch (error) {
      warning = error instanceof Error ? error.message : 'Falha ao desconectar instancia Evolution.';
      console.warn('[Channel DELETE] Evolution logout failed; removing local connection', {
        tenantId,
        connectionId,
        error: warning,
      });
    }
  }

  const deleted = await admin
    .from('channel_connections')
    .delete()
    .eq('id', connectionId)
    .eq('organization_id', tenantId);

  if (deleted.error) return json({ error: deleted.error.message }, 500);

  return json({
    ok: true,
    deleted: { id: connectionId },
    warning,
  });
}
