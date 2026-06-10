import { describe, it, expect } from 'vitest';
import type { Contact, Task } from '@/types';

describe('Task type (N2 — tarefas & lembretes)', () => {
  it('aceita uma tarefa válida com campos camelCase', () => {
    const t: Task = {
      id: 'a3f1c2d4-1111-4111-8111-111111111111',
      organizationId: 'b3f1c2d4-2222-4222-8222-222222222222',
      contactId: 'c3f1c2d4-3333-4333-8333-333333333333',
      type: 'call',
      title: 'Carlos Mota — ligar depois das 15h',
      note: 'tava no trabalho, pediu pra ligar à tarde',
      dueDate: '2026-06-17',
      dueTime: '15:00',
      status: 'open',
      juliaFirst: true,
    };
    expect(t.type).toBe('call');
    expect(t.status).toBe('open');
    expect(t.juliaFirst).toBe(true);
    expect(t.completedAt).toBeUndefined();
  });

  it('aceita tarefa geral sem paciente (contactId opcional) e sem hora', () => {
    const t: Task = {
      id: 'a3f1c2d4-1111-4111-8111-111111111111',
      type: 'reminder',
      title: 'Conferir estoque de luvas',
      dueDate: '2026-06-20',
      status: 'open',
      juliaFirst: false,
    };
    expect(t.contactId).toBeUndefined();
    expect(t.dueTime).toBeUndefined();
  });

  it('Contact.contactPreference aceita any|whatsapp_only', () => {
    const c: Pick<Contact, 'contactPreference'> = { contactPreference: 'whatsapp_only' };
    expect(c.contactPreference).toBe('whatsapp_only');
  });
});
