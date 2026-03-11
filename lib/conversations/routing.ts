import { hasPermission } from '@/lib/auth/permissions';
import { loadPermissionOverrides } from '@/lib/auth/permissions.server';
import type { ConversationThreadStatus } from './types';

type AssigneeCandidate = {
  id: string;
  role?: string | null;
};

export function getConversationStatusAfterInbound(currentStatus: ConversationThreadStatus | null | undefined) {
  if (currentStatus === 'human_active' || currentStatus === 'human_queue') return currentStatus;
  if (currentStatus === 'closed') return 'closed' as const;
  return 'ai_active' as const;
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
