import 'server-only';

import { readInboundMediaMetadata } from '@/lib/conversations/inboundMedia';
import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * Mídia em `pending` = ainda sendo entendida (SPEC-midia-recebida v2, Passo 2).
 *
 * A resposta da IA ESPERA o que está pendente na conversa (texto + áudio na mesma rajada, três
 * áudios seguidos), por no máximo 40 s. O que sobrar vira `timeout`: o balão mostra "não transcrito"
 * e a IA lê "audio nao ouvido". Como o orquestrador só grava resultado de mensagem ainda em
 * `pending`, um entendimento que termine depois disso é descartado: nunca aparece na tela um
 * texto que a IA não leu.
 */

const WAIT_TIMEOUT_MS = 40_000;
const WAIT_POLL_MS = 1_500;
const RECENT_MESSAGES = 12;
const STALE_AFTER_MS = 3 * 60_000;
const SWEEP_BATCH = 50;

type MessageRow = { id: string; direction?: string | null; metadata?: unknown };

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function markTimedOut(admin: AdminClient, organizationId: string, row: MessageRow, reason: string) {
  const media = readInboundMediaMetadata(row.metadata);
  if (!media) return false;
  const result = await admin
    .from('conversation_messages')
    .update({ metadata: { ...(row.metadata as Record<string, unknown>), media: { ...media, status: 'timeout', error: reason } } })
    .eq('id', row.id)
    .eq('organization_id', organizationId);
  return !result.error;
}

export async function waitForPendingInboundMedia(input: {
  admin: AdminClient;
  organizationId: string;
  threadId: string;
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ waitedMs: number; timedOut: number }> {
  const { admin, organizationId, threadId } = input;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? sleepMs;
  const timeoutMs = input.timeoutMs ?? WAIT_TIMEOUT_MS;
  const started = now();

  for (;;) {
    const recent = await admin
      .from('conversation_messages')
      .select('id, direction, metadata')
      .eq('organization_id', organizationId)
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: false })
      .limit(RECENT_MESSAGES);
    // Falha de leitura não segura a resposta da IA: ela segue com o que o histórico tiver.
    if (recent.error) return { waitedMs: now() - started, timedOut: 0 };

    const pending = ((recent.data as MessageRow[] | null) ?? []).filter(
      (row) => row.direction === 'inbound' && readInboundMediaMetadata(row.metadata)?.status === 'pending',
    );
    if (!pending.length) return { waitedMs: now() - started, timedOut: 0 };

    if (now() - started >= timeoutMs) {
      let timedOut = 0;
      for (const row of pending) {
        if (await markTimedOut(admin, organizationId, row, 'espera esgotada antes da resposta')) timedOut += 1;
      }
      return { waitedMs: now() - started, timedOut };
    }
    await sleep(input.pollMs ?? WAIT_POLL_MS);
  }
}

/**
 * Varredura do tick: `pending` com mais de 3 minutos é função que morreu no meio (conversa com humano
 * não tem ninguém esperando). Sem isto o balão ficaria em "entendendo…" para sempre.
 *
 * Começa pelas conexões com a chave em `understand` (tabela pequena) e só olha as mensagens DELAS, pelo
 * índice de `channel_connection_id`. `conversation_messages` não tem índice por data nem por
 * `metadata`: uma varredura global leria a tabela inteira a cada tick, para todos os clientes. Sem
 * nenhuma conexão com a chave ligada, o custo é uma consulta que volta vazia.
 */
export async function expireStalePendingInboundMedia(input: { admin: AdminClient; now?: () => number }) {
  const connections = await input.admin.from('channel_connections').select('id').eq('config->media->>mode', 'understand');
  if (connections.error) throw new Error(connections.error.message);

  const cutoff = new Date((input.now ?? Date.now)() - STALE_AFTER_MS).toISOString();
  let expired = 0;
  for (const connection of (connections.data as Array<{ id: string }> | null) ?? []) {
    const stale = await input.admin
      .from('conversation_messages')
      .select('id, organization_id, metadata')
      .eq('channel_connection_id', connection.id)
      .eq('metadata->media->>status', 'pending')
      .lt('created_at', cutoff)
      .limit(SWEEP_BATCH);
    if (stale.error) throw new Error(stale.error.message);

    for (const row of (stale.data as Array<MessageRow & { organization_id: string }> | null) ?? []) {
      if (await markTimedOut(input.admin, row.organization_id, row, 'entendimento não terminou')) expired += 1;
    }
  }
  return { expired };
}
