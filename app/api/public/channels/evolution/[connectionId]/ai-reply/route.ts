import { z } from 'zod';
import { readWebhookSecretFromRequest } from '@/lib/conversations/webhookAuth';
import { timingSafeEqualString } from '@/lib/security/timingSafeEqual';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { executeConversationAIReply } from '@/lib/conversations/aiReply';
import { ConversationHandoffTypeSchema } from '@/lib/conversations/handoff';
import { consumeConversationRateLimit } from '@/lib/conversations/conversationRateLimit';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const AIReplySchema = z.object({
  threadId: z.string().uuid(),
  replyText: z.string().min(1).max(4000),
  summary: z.string().max(2000).nullable().optional(),
  shouldHandoff: z.boolean().optional(),
  handoffType: ConversationHandoffTypeSchema.nullable().optional(),
  handoffReason: z.string().max(240).nullable().optional(),
  requestedScheduleAt: z.string().datetime({ offset: true }).nullable().optional(),
  requestedScheduleText: z.string().max(160).nullable().optional(),
  notificationEventId: z.string().uuid().optional(),
  authorName: z.string().max(160).optional(),
  metadata: z.record(z.string().max(80), z.unknown()).superRefine((value, ctx) => {
    if (Object.keys(value).length > 20 || JSON.stringify(value).length > 4000) {
      ctx.addIssue({ code: 'custom', message: 'Metadados excedem o limite permitido.' });
    }
  }).optional(),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const secret = readWebhookSecretFromRequest(req);
  if (!secret) return json({ error: 'Secret ausente' }, 401);

  const body = await req.json().catch(() => null);
  const parsed = AIReplySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Payload invalido', details: parsed.error.flatten() }, 400);
  }

  const admin = createStaticAdminClient();
  const connectionResult = await admin
    .from('channel_connections')
    .select('id, organization_id, name, config')
    .eq('id', connectionId)
    .eq('provider', 'evolution')
    .eq('channel_type', 'whatsapp')
    .maybeSingle();

  if (connectionResult.error) {
    console.error('[Evolution AI reply] Failed to load connection', { connectionId, error: connectionResult.error.message });
    return json({ error: 'Falha interna ao carregar a conexao.' }, 500);
  }
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);

  const expectedSecret = String((connectionResult.data.config as Record<string, unknown> | null)?.webhookSecret || '').trim();
  if (!expectedSecret || !timingSafeEqualString(secret, expectedSecret)) return json({ error: 'Secret invalido' }, 401);

  const rateLimit = await consumeConversationRateLimit({
    admin,
    scopeKey: `ai-reply:${connectionId}`,
    limit: 30,
    windowSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Muitas requisicoes. Tente novamente em instantes.' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(rateLimit.retryAfterSeconds),
      },
    });
  }

  const connectionConfig = (connectionResult.data.config as Record<string, unknown> | null) || {};
  if (connectionConfig.aiEnabled !== true) {
    return json({ error: 'Atendimento automatizado desativado para esta conexao.' }, 409);
  }

  try {
    const result = await executeConversationAIReply({
      admin,
      connection: {
        id: connectionResult.data.id,
        organization_id: connectionResult.data.organization_id,
        name: connectionResult.data.name,
        config: connectionConfig,
      },
      payload: {
        threadId: parsed.data.threadId,
        replyText: parsed.data.replyText,
        summary: parsed.data.summary,
        shouldHandoff: parsed.data.shouldHandoff,
        handoffType: parsed.data.handoffType,
        handoffReason: parsed.data.handoffReason,
        requestedScheduleAt: parsed.data.requestedScheduleAt,
        requestedScheduleText: parsed.data.requestedScheduleText,
        notificationEventId: parsed.data.notificationEventId,
        authorName: parsed.data.authorName,
        metadata: parsed.data.metadata,
        automationSource: 'n8n',
      },
    });

    return json(result.warning ? { ...result, warning: 'A resposta automatica precisa de revisao humana.' } : result);
  } catch (error) {
    console.error('[Evolution AI reply] Failed to execute reply', {
      connectionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Falha interna ao executar a resposta automatica.' }, 500);
  }
}
