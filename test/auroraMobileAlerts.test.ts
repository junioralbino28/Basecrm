import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Aurora mobile alerts', () => {
  it('consulta notificacoes persistentes em intervalo curto mesmo fora de foco', () => {
    const source = fs.readFileSync(path.join(root, 'hooks/useSystemNotifications.ts'), 'utf8');

    expect(source).toContain(".select('id,type,title,message,created_at,link,severity,read_at')");
    expect(source).toContain('refetchInterval: 15_000');
    expect(source).toContain('refetchIntervalInBackground: true');
  });

  it('dispara notificacao do navegador apenas para alerta novo', () => {
    const source = fs.readFileSync(
      path.join(root, 'components/notifications/NotificationPopover.tsx'),
      'utf8'
    );

    expect(source).toContain('getNewHighPrioritySystemAlerts');
    expect(source).toContain('if (!notificationsReady) return');
    expect(source).toContain('new Notification(notification.title');
    expect(source).toContain('basecrm-handoff-${notification.id}');
  });
});
