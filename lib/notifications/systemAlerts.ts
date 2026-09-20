export type SystemAlertCandidate = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  readAt?: string | null;
  title: string;
  message: string;
  actionLink?: string;
};

export function getNewHighPrioritySystemAlerts<T extends SystemAlertCandidate>(
  previousIds: ReadonlySet<string> | null,
  notifications: T[]
) {
  if (!previousIds) return [];
  return notifications.filter(
    notification =>
      notification.severity === 'high'
      && !notification.readAt
      && !previousIds.has(notification.id)
  );
}
