import { hasPermission } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
import { buildConversationScopedEventId } from './handoffEventId';
import type { ConversationThreadStatus } from './types';

type AssigneeCandidate = {
  id: string;
  role?: string | null;
};

export function getConversationStatusAfterInbound(
  currentStatus: ConversationThreadStatus | null | undefined,
  aiEnabled?: boolean,
) {
  if (currentStatus === 'human_active' || currentStatus === 'human_queue') return currentStatus;
  if (currentStatus === 'closed') return 'closed' as const;
  if (aiEnabled === false) return 'human_queue' as const;
  return 'ai_active' as const;
}

/**
 * Resposta pelo aparelho pausa a IA (decisão do Junior, 21/09/2026), ligada por conexão em
 * `config.manualReplyPausesAI`. O que a IA e o CRM enviam pela API não volta pelo webhook (medido no
 * preview: 72 respostas da IA, zero ecos); então a mensagem de saída que chega pelo webhook foi mandada
 * pelo celular (ou WhatsApp Web) por uma pessoa, e a conversa passa para ela. Desligada: nada muda.
 */
export function resolveManualReplyPausesAI(config: Record<string, unknown> | null | undefined) {
  return config?.manualReplyPausesAI === true;
}

/**
 * Aviso no sino quando a conversa passou para o humano pelo aparelho mas as réguas NÃO pausaram:
 * sem ele a falha fica só no log do servidor e a régua segue mandando mensagem numa conversa humana.
 * Um aviso por conversa (id fixo): reentregas do webhook não empilham.
 */
export function buildManualReplyPauseFailedNotification(input: {
  organizationId: string;
  threadId: string;
  contactLabel: string;
  createdAt: string;
}) {
  return {
    id: buildConversationScopedEventId({
      organizationId: input.organizationId,
      threadId: input.threadId,
      eventId: 'manual-reply-pause-failed',
    }),
    organization_id: input.organizationId,
    type: 'SYSTEM_ALERT',
    title: 'Régua não pausou',
    message: `${input.contactLabel}: a conversa passou para você pelo celular, mas as mensagens automáticas da régua não pausaram. Pause pela tela da conversa.`.slice(0, 600),
    link: `/platform/tenants/${input.organizationId}/conversations?thread=${encodeURIComponent(input.threadId)}`,
    severity: 'high' as const,
    read_at: null,
    created_at: input.createdAt,
  };
}

export async function pickNextHumanAssignee(
  admin: {
    from: (table: 'profiles') => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => Promise<{
            data: AssigneeCandidate[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  },
  tenantId: string,
  currentAssignedUserId?: string | null
) {
  const result = await admin
    .from('profiles')
    .select('id, role')
    .eq('organization_id', tenantId)
    .order('first_name', { ascending: true });

  if (result.error) throw new Error(result.error.message);

  const allowed: AssigneeCandidate[] = [];
  for (const profile of result.data ?? []) {
    const overrides = await loadPermissionOverrides(profile.id);
    if (hasPermission(profile.role ?? null, 'conversations.reply', overrides)) {
      allowed.push(profile);
    }
  }

  if (allowed.length === 0) return null;

  if (!currentAssignedUserId) return allowed[0]?.id ?? null;

  const currentIndex = allowed.findIndex((profile) => profile.id === currentAssignedUserId);
  if (currentIndex < 0) return allowed[0]?.id ?? null;

  return allowed[(currentIndex + 1) % allowed.length]?.id ?? null;
}
