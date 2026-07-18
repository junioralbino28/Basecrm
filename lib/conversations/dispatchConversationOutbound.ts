import type { SupabaseClient } from '@supabase/supabase-js';

export type OutboundDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'unknown'
  | 'simulated';

export type OutboundDeliveryOutcome = {
  status: Exclude<OutboundDeliveryStatus, 'pending'>;
  providerMessageId: string | null;
  attemptLabel: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
};

export type PreparedOutbound = {
  messageId: string;
  isNew: boolean;
  status: OutboundDeliveryStatus;
  providerMessageId?: string | null;
};

export type CompletedOutbound = OutboundDeliveryOutcome & {
  messageId: string;
};

type DispatchMode = 'manual' | 'automation_simulation';

type DispatchDependencies = {
  prepare: () => Promise<PreparedOutbound>;
  resolveCredentials?: () => Promise<unknown>;
  deliver?: (credentials?: unknown) => Promise<OutboundDeliveryOutcome>;
  complete: (
    prepared: PreparedOutbound,
    outcome: OutboundDeliveryOutcome,
  ) => Promise<CompletedOutbound>;
};

function isUnknownDelivery(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'deliveryUnknown' in error
    && (error as { deliveryUnknown?: unknown }).deliveryUnknown === true
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha desconhecida no dispatch';
}

export async function dispatchConversationOutbound(
  input: {
    mode: DispatchMode;
    idempotencyKey: string;
  },
  dependencies: DispatchDependencies,
): Promise<CompletedOutbound & { duplicate?: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error('idempotencyKey é obrigatória');
  }

  const prepared = await dependencies.prepare();
  if (!prepared.isNew) {
    return {
      messageId: prepared.messageId,
      status: prepared.status === 'pending' ? 'unknown' : prepared.status,
      providerMessageId: prepared.providerMessageId ?? null,
      attemptLabel: null,
      error: prepared.status === 'pending'
        ? 'dispatch anterior permaneceu pending; revisão obrigatória'
        : null,
      metadata: {},
      duplicate: true,
    };
  }

  if (input.mode === 'automation_simulation') {
    return dependencies.complete(prepared, {
      status: 'simulated',
      providerMessageId: null,
      attemptLabel: 'simulation',
      error: null,
      metadata: {
        delivery_mode: 'simulation',
        external_effect: false,
      },
    });
  }

  let outcome: OutboundDeliveryOutcome;
  try {
    const credentials = dependencies.resolveCredentials
      ? await dependencies.resolveCredentials()
      : undefined;
    if (!dependencies.deliver) {
      throw new Error('adapter de entrega manual ausente');
    }
    outcome = await dependencies.deliver(credentials);
  } catch (error) {
    outcome = {
      status: isUnknownDelivery(error) ? 'unknown' : 'failed',
      providerMessageId: null,
      attemptLabel: null,
      error: errorMessage(error),
      metadata: {},
    };
  }

  return dependencies.complete(prepared, outcome);
}

type ManualOutboundRow = {
  threadId: string;
  organizationId: string;
  channelConnectionId: string | null;
  idempotencyKey: string;
  messageType: string;
  authorName: string | null;
  content: string;
  metadata: Record<string, unknown>;
  sentAt: string;
};

function mapStoredOutbound(row: Record<string, unknown>): PreparedOutbound {
  return {
    messageId: String(row.id),
    isNew: false,
    status: (row.delivery_status as OutboundDeliveryStatus | null) ?? 'unknown',
    providerMessageId:
      typeof row.provider_message_id === 'string' ? row.provider_message_id : null,
  };
}

export async function dispatchManualConversationOutbound(params: {
  db: SupabaseClient;
  message: ManualOutboundRow;
  deliver: () => Promise<OutboundDeliveryOutcome>;
}): Promise<CompletedOutbound & { duplicate?: boolean }> {
  let initialMetadata: Record<string, unknown> = {
    ...params.message.metadata,
    delivery_status: 'pending',
  };

  return dispatchConversationOutbound(
    {
      mode: 'manual',
      idempotencyKey: params.message.idempotencyKey,
    },
    {
      prepare: async () => {
        const inserted = await params.db
          .from('conversation_messages')
          .insert({
            thread_id: params.message.threadId,
            organization_id: params.message.organizationId,
            channel_connection_id: params.message.channelConnectionId,
            direction: 'outbound',
            message_type: params.message.messageType,
            author_name: params.message.authorName,
            content: params.message.content,
            metadata: initialMetadata,
            idempotency_key: params.message.idempotencyKey,
            delivery_source: 'manual',
            delivery_status: 'pending',
            sent_at: params.message.sentAt,
            created_at: params.message.sentAt,
          })
          .select(
            'id, delivery_status, provider_message_id, metadata'
          )
          .single();

        if (!inserted.error && inserted.data) {
          initialMetadata =
            (inserted.data.metadata as Record<string, unknown> | null)
            ?? initialMetadata;
          return {
            messageId: inserted.data.id,
            isNew: true,
            status: 'pending',
            providerMessageId: null,
          };
        }
        if (inserted.error?.code !== '23505') {
          throw new Error(inserted.error?.message ?? 'falha ao persistir mensagem pending');
        }

        const existing = await params.db
          .from('conversation_messages')
          .select('id, delivery_status, provider_message_id, metadata')
          .eq('organization_id', params.message.organizationId)
          .eq('idempotency_key', params.message.idempotencyKey)
          .single();
        if (existing.error || !existing.data) {
          throw new Error(existing.error?.message ?? 'mensagem idempotente não encontrada');
        }
        initialMetadata =
          (existing.data.metadata as Record<string, unknown> | null)
          ?? initialMetadata;
        return mapStoredOutbound(existing.data);
      },
      deliver: params.deliver,
      complete: async (prepared, outcome) => {
        const metadata = {
          ...initialMetadata,
          ...outcome.metadata,
          provider_message_id: outcome.providerMessageId,
          delivery_status: outcome.status,
          delivery_attempt: outcome.attemptLabel,
          delivery_error: outcome.error,
        };
        const updated = await params.db
          .from('conversation_messages')
          .update({
            provider_message_id: outcome.providerMessageId,
            delivery_status: outcome.status,
            delivery_error: outcome.error,
            delivery_attempt: outcome.attemptLabel,
            metadata,
          })
          .eq('id', prepared.messageId)
          .eq('organization_id', params.message.organizationId)
          .eq('delivery_status', 'pending')
          .select('id')
          .single();
        if (updated.error) throw new Error(updated.error.message);
        return {
          messageId: prepared.messageId,
          ...outcome,
        };
      },
    },
  );
}

export async function dispatchAutomationSimulation(params: {
  db: SupabaseClient;
  jobId: string;
}): Promise<CompletedOutbound & { duplicate?: boolean }> {
  let preparedJobId = params.jobId;
  return dispatchConversationOutbound(
    {
      mode: 'automation_simulation',
      idempotencyKey: params.jobId,
    },
    {
      prepare: async () => {
        const prepared = await params.db
          .rpc('prepare_automation_outbound', { p_job_id: params.jobId })
          .single();
        if (prepared.error || !prepared.data) {
          throw new Error(prepared.error?.message ?? 'job não pôde ser preparado');
        }
        const row = prepared.data as {
          job_id: string;
          message_id: string;
          is_new: boolean;
          delivery_status: OutboundDeliveryStatus;
          provider_message_id: string | null;
        };
        preparedJobId = row.job_id;
        return {
          messageId: row.message_id,
          isNew: row.is_new,
          status: row.delivery_status,
          providerMessageId: row.provider_message_id,
        };
      },
      complete: async (prepared, outcome) => {
        const completed = await params.db
          .rpc('complete_automation_simulation', {
            p_job_id: preparedJobId,
            p_message_id: prepared.messageId,
          })
          .single();
        if (completed.error || !completed.data) {
          throw new Error(completed.error?.message ?? 'simulação não pôde ser finalizada');
        }
        const row = completed.data as { message_id: string };
        return {
          messageId: row.message_id,
          status: 'simulated',
          providerMessageId: null,
          attemptLabel: outcome.attemptLabel,
          error: null,
          metadata: outcome.metadata,
        };
      },
    },
  );
}
