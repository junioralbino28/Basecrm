import 'server-only';

import { executeConversationAIReply } from '@/lib/conversations/aiReply';
import { recordConversationAIFailure } from '@/lib/conversations/conversationAIFailure';
import {
  IDLE_NUDGE_AUTOMATION_SOURCE,
  buildIdleNudgeClearedMetadata,
  resolveIdleNudgeConfig,
} from '@/lib/conversations/idleNudge';
import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

export type IdleNudgeRunSummary = {
  /** conversas com cutucada vencida encontradas neste tick */
  due: number;
  sent: number;
  skipped: {
    /** numero com a cutucada desligada */
    disabled: number;
    /** o lead respondeu antes de vencer */
    replied: number;
    /** conversa saiu de ai_active, sem conexao ou sem token valido */
    state: number;
    /** outro tick reivindicou primeiro (ou o estado mudou entre a leitura e a reivindicacao) */
    claimed: number;
    /** o envio foi ignorado pelos gates (IA desligada no meio do caminho) */
    ignored: number;
  };
  failed: number;
  errors: string[];
  /** o prazo do tick acabou com fila sobrando; o resto fica para o proximo */
  truncated: boolean;
};

type DueThreadRow = {
  id: string;
  organization_id: string;
  channel_connection_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ConnectionRow = {
  id: string;
  organization_id: string;
  name: string;
  config: Record<string, unknown> | null;
};

/**
 * Envia as cutucadas de inatividade vencidas. Roda no relogio do tick (a cada 5 min), mas e da
 * conversa, nao do funil: le `aiInactivityNudgeDueAt` que o webhook agendou, confere que o lead
 * continua em silencio e manda o texto configurado no numero pela mesma esteira da resposta da IA
 * (`executeConversationAIReply`, que reaplica os tres gates e grava a mensagem na conversa).
 *
 * Reivindicacao atomica: o UPDATE que limpa o token exige o token lido, `lastDirection=outbound`
 * e `status=ai_active`. Dois ticks concorrentes nunca mandam duas vezes, e um lead que respondeu
 * entre a leitura e a reivindicacao faz a reivindicacao falhar.
 */
export async function sendDueConversationNudges(input: {
  admin: AdminClient;
  now?: string;
  batchLimit?: number;
  deadlineMs?: number;
}): Promise<IdleNudgeRunSummary> {
  const { admin } = input;
  const now = input.now ?? new Date().toISOString();
  const batchLimit = input.batchLimit ?? 10;
  const deadlineMs = input.deadlineMs ?? 8_000;
  const startedAt = Date.now();
  const summary: IdleNudgeRunSummary = {
    due: 0,
    sent: 0,
    skipped: { disabled: 0, replied: 0, state: 0, claimed: 0, ignored: 0 },
    failed: 0,
    errors: [],
    truncated: false,
  };

  const dueResult = await admin
    .from('conversation_threads')
    .select('id, organization_id, channel_connection_id, contact_name, contact_phone, status, metadata')
    .eq('status', 'ai_active')
    .not('metadata->>aiInactivityNudgeToken', 'is', null)
    .lte('metadata->>aiInactivityNudgeDueAt', now)
    .order('metadata->>aiInactivityNudgeDueAt', { ascending: true })
    .limit(batchLimit);
  if (dueResult.error) throw new Error(dueResult.error.message);

  const dueThreads = (dueResult.data || []) as DueThreadRow[];
  summary.due = dueThreads.length;
  if (dueThreads.length === 0) return summary;

  const connectionIds = Array.from(
    new Set(dueThreads.map((thread) => thread.channel_connection_id).filter((id): id is string => Boolean(id))),
  );
  const connections = new Map<string, ConnectionRow>();
  if (connectionIds.length > 0) {
    const connectionsResult = await admin
      .from('channel_connections')
      .select('id, organization_id, name, config')
      .in('id', connectionIds);
    if (connectionsResult.error) throw new Error(connectionsResult.error.message);
    for (const row of (connectionsResult.data || []) as ConnectionRow[]) {
      connections.set(row.id, row);
    }
  }

  async function clearWithoutSending(thread: DueThreadRow, metadata: Record<string, unknown>, token: string) {
    // Casado pelo token: nunca apaga um agendamento novo feito depois da leitura.
    const cleared = await admin
      .from('conversation_threads')
      .update({
        updated_at: new Date().toISOString(),
        metadata: buildIdleNudgeClearedMetadata({ metadata }),
      })
      .eq('id', thread.id)
      .eq('organization_id', thread.organization_id)
      .eq('metadata->>aiInactivityNudgeToken', token);
    if (cleared.error) {
      console.warn('[idle nudge] Failed to clear stale nudge', { threadId: thread.id, error: cleared.error.message });
    }
  }

  for (const thread of dueThreads) {
    if (Date.now() - startedAt > deadlineMs) {
      summary.truncated = true;
      break;
    }

    const metadata = (thread.metadata || {}) as Record<string, unknown>;
    const token = typeof metadata.aiInactivityNudgeToken === 'string' ? metadata.aiInactivityNudgeToken : null;
    if (!token) {
      summary.skipped.state += 1;
      continue;
    }

    const connection = thread.channel_connection_id
      ? connections.get(thread.channel_connection_id) ?? null
      : null;
    if (!connection || connection.organization_id !== thread.organization_id || thread.status !== 'ai_active') {
      summary.skipped.state += 1;
      await clearWithoutSending(thread, metadata, token);
      continue;
    }
    if (metadata.lastDirection === 'inbound') {
      summary.skipped.replied += 1;
      await clearWithoutSending(thread, metadata, token);
      continue;
    }

    const nudge = resolveIdleNudgeConfig(connection.config);
    if (!nudge.enabled) {
      summary.skipped.disabled += 1;
      await clearWithoutSending(thread, metadata, token);
      continue;
    }

    const claimedAt = new Date().toISOString();
    const claim = await admin
      .from('conversation_threads')
      .update({
        updated_at: claimedAt,
        metadata: buildIdleNudgeClearedMetadata({ metadata }),
      })
      .eq('id', thread.id)
      .eq('organization_id', thread.organization_id)
      .eq('metadata->>aiInactivityNudgeToken', token)
      .eq('metadata->>lastDirection', 'outbound')
      .eq('status', 'ai_active')
      .select('id');
    if (claim.error) {
      summary.failed += 1;
      summary.errors.push(`${thread.id}: ${claim.error.message}`);
      continue;
    }
    if (!claim.data || claim.data.length === 0) {
      summary.skipped.claimed += 1;
      continue;
    }

    try {
      const result = await executeConversationAIReply({
        admin,
        connection: {
          id: connection.id,
          organization_id: connection.organization_id,
          name: connection.name,
          config: connection.config,
        },
        payload: {
          threadId: thread.id,
          replyText: nudge.text,
          metadata: {
            idle_nudge: true,
            idle_nudge_delay_minutes: nudge.delayMinutes,
            idle_nudge_token: token,
          },
          automationSource: IDLE_NUDGE_AUTOMATION_SOURCE,
        },
      });

      if ('ignored' in result && result.ignored) {
        summary.skipped.ignored += 1;
        continue;
      }
      if (result.warning) {
        // A entrega falhou: executeConversationAIReply ja gravou a falha e moveu a conversa para
        // a fila humana. Aqui so se contabiliza.
        summary.failed += 1;
        summary.errors.push(`${thread.id}: ${result.warning}`);
        continue;
      }

      // Registra o envio lendo a metadata fresca: a resposta acabou de reescrever lastDirection,
      // preview e afins, e nao podem ser sobrescritos pelo que foi lido antes do envio.
      const sentAt = new Date().toISOString();
      const fresh = await admin
        .from('conversation_threads')
        .select('metadata')
        .eq('id', thread.id)
        .eq('organization_id', thread.organization_id)
        .maybeSingle();
      const freshMetadata = (fresh.data?.metadata as Record<string, unknown> | null) || {};
      const marked = await admin
        .from('conversation_threads')
        .update({
          updated_at: sentAt,
          metadata: buildIdleNudgeClearedMetadata({ metadata: freshMetadata, sentAt }),
        })
        .eq('id', thread.id)
        .eq('organization_id', thread.organization_id);
      if (marked.error) {
        console.warn('[idle nudge] Failed to mark nudge as sent', { threadId: thread.id, error: marked.error.message });
      }
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      summary.errors.push(`${thread.id}: ${message}`);
      console.warn('[idle nudge] Failed to send inactivity nudge', { threadId: thread.id, error: message });
      await recordConversationAIFailure({
        admin,
        organizationId: thread.organization_id,
        threadId: thread.id,
        eventId: token,
        contactLabel: thread.contact_name || thread.contact_phone || 'Lead',
        stage: 'delivery',
        metadata,
        errorMessage: message,
      });
    }
  }

  return summary;
}
