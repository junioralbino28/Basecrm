import { describe, expect, it } from 'vitest';
import { taskFormSchema } from '@/lib/validations/schemas';

describe('taskFormSchema (N2 — tarefas & lembretes)', () => {
  it('aceita tarefa válida com paciente, hora e julia_first', () => {
    const res = taskFormSchema.safeParse({
      contactId: 'c1',
      type: 'call',
      title: 'Carlos — ligar depois das 15h',
      note: 'pediu pra ligar à tarde',
      dueDate: '2026-06-17',
      dueTime: '15:00',
      juliaFirst: true,
    });
    expect(res.success).toBe(true);
  });

  it('aceita tarefa geral sem paciente e sem hora (campos opcionais do mockup)', () => {
    const res = taskFormSchema.safeParse({
      type: 'reminder',
      title: 'Conferir estoque de luvas',
      dueDate: '2026-06-20',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.contactId).toBe('');
      expect(res.data.dueTime).toBe('');
      expect(res.data.juliaFirst).toBe(false);
    }
  });

  it('rejeita motivo vazio', () => {
    expect(
      taskFormSchema.safeParse({ type: 'reminder', title: '', dueDate: '2026-06-20' }).success
    ).toBe(false);
  });

  it('rejeita data vazia (due_date é NOT NULL no banco)', () => {
    expect(
      taskFormSchema.safeParse({ type: 'reminder', title: 'Lembrete', dueDate: '' }).success
    ).toBe(false);
  });

  it('rejeita tipo fora do domínio call|reminder|message (espelha CHECK do banco)', () => {
    expect(
      taskFormSchema.safeParse({ type: 'email', title: 'X', dueDate: '2026-06-20' }).success
    ).toBe(false);
  });

  it('rejeita hora mal formada', () => {
    expect(
      taskFormSchema.safeParse({
        type: 'call',
        title: 'Ligar',
        dueDate: '2026-06-20',
        dueTime: '25h',
      }).success
    ).toBe(false);
  });
});
