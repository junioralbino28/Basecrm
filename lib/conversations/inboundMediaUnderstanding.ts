import 'server-only';

import { downloadEvolutionMedia } from '@/lib/channels/evolutionMedia';
import { resolveEvolutionCredentials } from '@/lib/channels/evolutionCredentials';
import { consumeConversationRateLimit } from '@/lib/conversations/conversationRateLimit';
import type { EvolutionMediaEnvelope } from '@/lib/conversations/evolutionWebhook';
import {
  INBOUND_MEDIA_LABEL,
  readInboundMediaMetadata,
  type InboundMediaInfo,
  type InboundMediaStatus,
} from '@/lib/conversations/inboundMedia';
import { buildInboundMediaNotification, type InboundMediaProblem } from '@/lib/conversations/inboundMediaNotification';
import { resolveMediaUnderstandingRoute, type MediaUnderstandingRoute } from '@/lib/conversations/mediaProviders';
import { understandMediaBytes, type MediaUnderstandingOutcome } from '@/lib/conversations/mediaUnderstanding';
import { createStaticAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createStaticAdminClient>;

/**
 * Entender uma mídia recebida (SPEC-midia-recebida v2, Passo 2). Roda num `after()` próprio da rota do
 * webhook, independente do direito de responder: o humano também recebe a transcrição.
 *
 * Agnóstico de agente. Nunca tira a conversa da IA: falha vira selo no balão + aviso no sino.
 */

// Cotas aprovadas pelo Junior em 21/09 (G18). Contadas no banco, pelo limitador que já existe.
export const MEDIA_QUOTAS = {
  thread: { limit: 10, windowSeconds: 600 },
  connection: { limit: 120, windowSeconds: 3600 },
  organization: { limit: 500, windowSeconds: 86400 },
} as const;

// Disjuntor: 5 falhas SEGUIDAS do provedor pausam o entendimento daquela conexão por 10 minutos.
const BREAKER_FAILURES = 5;
const BREAKER_WINDOW_SECONDS = 600;
const PREVIEW_MAX_CHARS = 160;

type Outcome = {
  status: InboundMediaStatus;
  text: string | null;
  provider: string | null;
  model: string | null;
  ms: number | null;
  error: string | null;
  signals?: { noSpeechProb: number | null; avgLogprob: number | null; wordsPerSecond: number | null } | null;
};

export type InboundMediaUnderstandingDeps = {
  consumeQuota: typeof consumeConversationRateLimit;
  resolveCredentials: (input: { admin: AdminClient; organizationId: string; connectionConfig: Record<string, unknown> }) => Promise<{ apiUrl: string; apiKey: string } | null>;
  download: typeof downloadEvolutionMedia;
  understand: typeof understandMediaBytes;
};

const defaultDeps: InboundMediaUnderstandingDeps = {
  consumeQuota: consumeConversationRateLimit,
  async resolveCredentials({ admin, organizationId, connectionConfig }) {
    const credentials = await resolveEvolutionCredentials({ admin, tenantId: organizationId, connectionConfig });
    return credentials?.apiUrl && credentials?.apiKey ? { apiUrl: credentials.apiUrl, apiKey: credentials.apiKey } : null;
  },
  download: downloadEvolutionMedia,
  understand: understandMediaBytes,
};

const breakerScope = (connectionId: string, provider: string) => `media-fail:${connectionId}:${provider}`;

async function isBreakerOpen(admin: AdminClient, connectionId: string, provider: string) {
  const row = await admin
    .from('conversation_ai_rate_limits')
    .select('request_count, window_started_at')
    .eq('scope_key', breakerScope(connectionId, provider))
    .maybeSingle();
  if (row.error || !row.data) return false;
  const startedAt = new Date(String(row.data.window_started_at)).getTime();
  return Number(row.data.request_count) >= BREAKER_FAILURES && startedAt + BREAKER_WINDOW_SECONDS * 1000 > Date.now();
}

export async function understandInboundMedia(input: {
  admin: AdminClient;
  organizationId: string;
  connectionId: string;
  connectionConfig: Record<string, unknown>;
  threadId: string;
  messageId: string;
  dealId: string | null;
  contactLabel: string;
  media: InboundMediaInfo;
  envelope: EvolutionMediaEnvelope;
  deps?: Partial<InboundMediaUnderstandingDeps>;
}): Promise<{ status: InboundMediaStatus }> {
  const { admin, organizationId, connectionId, threadId, messageId, media } = input;
  const deps = { ...defaultDeps, ...input.deps };
  const route = resolveMediaUnderstandingRoute(media);
  if (!route) return { status: 'recorded' };

  let outcome: Outcome;
  try {
    outcome = await run(route);
  } catch (error) {
    // Nada aqui pode derrubar o `after()`: a mensagem ficaria em "entendendo…" para sempre.
    console.warn('[Inbound media] Unexpected failure', { connectionId, threadId, error: error instanceof Error ? error.message : String(error) });
    outcome = { status: 'failed', text: null, provider: route.provider, model: route.model, ms: null, error: 'falha interna ao entender a mídia' };
  }

  const applied = await persist(outcome);
  if (applied && outcome.status !== 'done') await notify(outcome.status);
  return { status: applied ? outcome.status : 'timeout' };

  async function run(route: MediaUnderstandingRoute): Promise<Outcome> {
    const blank = { text: null, provider: route.provider, model: route.model, ms: null };

    // Pré-filtro pelo tamanho DECLARADO. O teto de verdade vale sobre os bytes baixados.
    if (media.fileLength !== null && media.fileLength > route.maxBytes) {
      return { ...blank, status: 'failed', error: 'arquivo acima do tamanho máximo' };
    }

    // A chave é SEMPRE da organização dona da conexão. Sem ela, só o selo: nunca outra chave.
    const settings = await admin.from('organization_settings').select(route.keyColumn).eq('organization_id', organizationId).maybeSingle();
    const apiKey = String((settings.data as Record<string, unknown> | null)?.[route.keyColumn] ?? '').trim();
    if (settings.error || !apiKey) return { ...blank, status: 'skipped_no_key', error: null };

    if (await isBreakerOpen(admin, connectionId, route.provider)) {
      return { ...blank, status: 'failed', error: 'entendimento pausado por falhas seguidas do provedor' };
    }

    for (const [scope, quota] of [
      [`media:thread:${threadId}`, MEDIA_QUOTAS.thread],
      [`media:connection:${connectionId}`, MEDIA_QUOTAS.connection],
      [`media:org:${organizationId}`, MEDIA_QUOTAS.organization],
    ] as const) {
      const consumed = await deps.consumeQuota({ admin, scopeKey: scope, limit: quota.limit, windowSeconds: quota.windowSeconds });
      if (!consumed.allowed) return { ...blank, status: 'limit', error: null };
    }

    const credentials = await deps.resolveCredentials({ admin, organizationId, connectionConfig: input.connectionConfig });
    const instanceName = String(input.connectionConfig.instanceName || '').trim();
    if (!credentials || !instanceName) return { ...blank, status: 'failed', error: 'conexão sem credencial da Evolution' };

    const downloaded = await deps.download({ ...credentials, instanceName, envelope: input.envelope, maxBytes: route.maxBytes });
    if (!downloaded.ok) return { ...blank, status: downloaded.reason === 'timeout' ? 'timeout' : 'failed', error: `download: ${downloaded.reason}` };

    const understood: MediaUnderstandingOutcome = await deps.understand({ route, apiKey, bytes: downloaded.bytes, mimetype: downloaded.mimetype ?? media.mimetype });

    // Disjuntor conta só falha do PROVEDOR; qualquer resposta dele (com ou sem fala) zera a sequência.
    if (understood.status === 'failed' || understood.status === 'timeout') {
      await deps.consumeQuota({ admin, scopeKey: breakerScope(connectionId, route.provider), limit: 10_000, windowSeconds: BREAKER_WINDOW_SECONDS });
    } else {
      await admin.from('conversation_ai_rate_limits').delete().eq('scope_key', breakerScope(connectionId, route.provider));
    }
    return understood;
  }

  /** Grava o resultado. Devolve `false` se a mensagem já não estava mais em `pending` (resultado atrasado é descartado). */
  async function persist(result: Outcome) {
    const current = await admin
      .from('conversation_messages')
      .select('content, metadata, sent_at')
      .eq('id', messageId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    const stored = readInboundMediaMetadata(current.data?.metadata);
    // Quem esperava desistiu (marcou `timeout`) e a IA já respondeu sem este texto: não aparece depois
    // na tela um texto que a IA não leu.
    if (current.error || !current.data || !stored || stored.status !== 'pending') return false;

    const understoodText = result.status === 'done' ? result.text : null;
    const replacesContent = Boolean(understoodText) && stored.placeholder;
    const update = await admin
      .from('conversation_messages')
      .update({
        ...(replacesContent ? { content: understoodText } : {}),
        metadata: {
          ...(current.data.metadata as Record<string, unknown>),
          media: {
            ...stored,
            status: result.status,
            placeholder: replacesContent ? false : stored.placeholder,
            // Foto COM legenda: a legenda do lead fica crua no `content`; a descrição vai à parte.
            description: understoodText && !replacesContent ? understoodText : null,
            provider: result.provider,
            model: result.model,
            ms: result.ms,
            error: result.error,
            // Números do provedor (sem texto): servem para calibrar o filtro de "sem fala" com áudio real.
            signals: result.signals ?? null,
          },
        },
      })
      .eq('id', messageId)
      .eq('organization_id', organizationId);
    if (update.error) {
      console.warn('[Inbound media] Failed to persist result', { connectionId, threadId, error: update.error.message });
      return false;
    }

    if (replacesContent && understoodText) await refreshPreviews(understoodText, String(current.data.sent_at ?? ''));
    return true;
  }

  /** A lista de conversas e o card do negócio mostravam o marcador ("Áudio"); passam a mostrar o texto. */
  async function refreshPreviews(text: string, sentAt: string) {
    const marker = INBOUND_MEDIA_LABEL[media.kind];
    const preview = text.slice(0, PREVIEW_MAX_CHARS);

    const thread = await admin.from('conversation_threads').select('metadata').eq('id', threadId).eq('organization_id', organizationId).maybeSingle();
    const threadMetadata = (thread.data?.metadata as Record<string, unknown> | null) ?? null;
    // Leitura fresca, e só se esta ainda for a última mensagem da conversa.
    if (threadMetadata && threadMetadata.lastMessagePreview === marker && threadMetadata.lastMessageSentAt === sentAt) {
      await admin
        .from('conversation_threads')
        .update({ metadata: { ...threadMetadata, lastMessagePreview: preview } })
        .eq('id', threadId)
        .eq('organization_id', organizationId);
    }

    if (!input.dealId) return;
    const deal = await admin.from('deals').select('custom_fields').eq('id', input.dealId).eq('organization_id', organizationId).maybeSingle();
    const customFields = (deal.data?.custom_fields as Record<string, unknown> | null) ?? null;
    if (customFields && customFields.first_inbound_preview === marker) {
      await admin
        .from('deals')
        .update({ custom_fields: { ...customFields, first_inbound_preview: preview } })
        .eq('id', input.dealId)
        .eq('organization_id', organizationId);
    }
  }

  async function notify(status: InboundMediaStatus) {
    const problem: InboundMediaProblem = status === 'limit' ? 'limit' : status === 'skipped_no_key' ? 'no_key' : status === 'empty' ? 'empty' : 'failed';
    const result = await admin.from('system_notifications').upsert(
      buildInboundMediaNotification({ organizationId, threadId, contactLabel: input.contactLabel, kind: media.kind, createdAt: new Date().toISOString(), problem }),
      { onConflict: 'id' },
    );
    if (result.error) console.warn('[Inbound media] Failed to notify', { connectionId, threadId, error: result.error.message });
  }
}
