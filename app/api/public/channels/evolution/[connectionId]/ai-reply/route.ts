import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { executeConversationAIReply } from '@/lib/conversations/aiReply';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function getSecretFromRequest(req: Request) {
  const url = new URL(req.url);
  const querySecret = url.searchParams.get('secret')?.trim();
  if (querySecret) return querySecret;

  const headerSecret = req.headers.get('x-webhook-secret')?.trim();
  if (headerSecret) return headerSecret;

  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();

  return '';
}

const AIReplySchema = z.object({
  threadId: z.string().uuid(),
  replyText: z.string().min(1).max(4000),
  summary: z.string().max(2000).nullable().optional(),
  shouldHandoff: z.boolean().optional(),
  handoffReason: z.string().max(240).nullable().optional(),
  authorName: z.string().max(160).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const secret = getSecretFromRequest(req);
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

  if (connectionResult.error) return json({ error: connectionResult.error.message }, 500);
  if (!connectionResult.data) return json({ error: 'Conexao nao encontrada' }, 404);

  const expectedSecret = String((connectionResult.data.config as Record<string, unknown> | null)?.webhookSecret || '').trim();
  if (!expectedSecret || expectedSecret !== secret) return json({ error: 'Secret invalido' }, 401);

  try {
    const result = await executeConversationAIReply({
      admin,
      connection: {
        id: connectionResult.data.id,
        organization_id: connectionResult.data.organization_id,
        name: connectionResult.data.name,
        config: (connectionResult.data.config as Record<string, unknown> | null) || {},
      },
      payload: {
        threadId: parsed.data.threadId,
        replyText: parsed.data.replyText,
        summary: parsed.data.summary,
        shouldHandoff: parsed.data.shouldHandoff,
        handoffReason: parsed.data.handoffReason,
        authorName: parsed.data.authorName,
        metadata: parsed.data.metadata,
        automationSource: 'n8n',
      },
    });

    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Falha ao executar AI reply.' }, 500);
  }
}
