import { describe, it, expect } from 'vitest';
import { tasksService, __transformTask, __taskToInsert, __taskToUpdate } from './tasks';

describe('tasksService (N2 — tarefas & lembretes)', () => {
  it('expõe os métodos CRUD esperados', () => {
    expect(typeof tasksService.getAll).toBe('function');
    expect(typeof tasksService.create).toBe('function');
    expect(typeof tasksService.update).toBe('function');
    expect(typeof tasksService.delete).toBe('function');
  });
});

describe('tasks transform', () => {
  it('transforma linha do DB (snake) para app (camel)', () => {
    const app = __transformTask({
      id: 't1',
      organization_id: 'org1',
      contact_id: 'c1',
      type: 'call',
      title: 'Carlos — ligar depois das 15h',
      note: 'pediu pra ligar à tarde',
      due_date: '2026-06-17',
      due_time: '15:00:00',
      status: 'open',
      julia_first: true,
      created_by: 'u1',
      completed_at: null,
      owner_id: 'u1',
      created_at: '2026-06-10T12:00:00.000Z',
      updated_at: '2026-06-10T12:00:00.000Z',
    });
    expect(app.organizationId).toBe('org1');
    expect(app.type).toBe('call');
    expect(app.dueDate).toBe('2026-06-17');
    expect(app.dueTime).toBe('15:00');
    expect(app.juliaFirst).toBe(true);
    expect(app.completedAt).toBeUndefined();
  });
});

describe('tasks insert', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

  it('carimba org/owner/created_by e nasce open sem completed_at', () => {
    const row = __taskToInsert(
      {
        type: 'reminder',
        title: 'Bruna — retorno do raio-X',
        dueDate: '2026-06-17',
        status: 'open',
        juliaFirst: true,
      },
      orgId,
      userId
    );
    expect(row.organization_id).toBe(orgId);
    expect(row.owner_id).toBe(userId);
    expect(row.created_by).toBe(userId);
    expect(row.status).toBe('open');
    expect(row.completed_at).toBeNull();
    expect(row.julia_first).toBe(true);
    expect(row.due_time).toBeNull();
  });

  it('status done no insert carimba completed_at (invariante do banco)', () => {
    const row = __taskToInsert(
      {
        type: 'call',
        title: 'Já liguei',
        dueDate: '2026-06-10',
        status: 'done',
        juliaFirst: false,
      },
      orgId,
      userId
    );
    expect(row.status).toBe('done');
    expect(typeof row.completed_at).toBe('string');
  });
});

describe('tasks update (lição F4 — nunca re-carimba campo não editado)', () => {
  it('update sem status NÃO toca completed_at nem outros campos', () => {
    const payload = __taskToUpdate({ note: 'nova anotação' });
    expect(payload.note).toBe('nova anotação');
    expect(payload).not.toHaveProperty('completed_at');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('due_date');
    expect(payload).not.toHaveProperty('julia_first');
  });

  it('marcar done carimba completed_at; reabrir limpa', () => {
    const done = __taskToUpdate({ status: 'done' });
    expect(done.status).toBe('done');
    expect(typeof done.completed_at).toBe('string');

    const reopened = __taskToUpdate({ status: 'open' });
    expect(reopened.status).toBe('open');
    expect(reopened.completed_at).toBeNull();

    const snoozed = __taskToUpdate({ status: 'snoozed' });
    expect(snoozed.status).toBe('snoozed');
    expect(snoozed.completed_at).toBeNull();
  });

  it('adiar (due_date) não mexe em status nem completed_at', () => {
    const payload = __taskToUpdate({ dueDate: '2026-06-18' });
    expect(payload.due_date).toBe('2026-06-18');
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('completed_at');
  });
});
