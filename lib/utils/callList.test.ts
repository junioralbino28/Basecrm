// Função pura da Home "Hoje" / call-list (F6 + ajustes do adendo 2026-06-10):
// - activities CALL pendentes bucketizadas em overdue/today/upcoming;
// - tasks (N2) vencendo hoje (inclui atrasadas) ENTRAM na lista;
// - contatos contact_preference = 'whatsapp_only' SAEM da lista de ligar;
// - etiqueta de cadência F1-F9 com fallback honesto (sem estágio F → sem badge).
import { describe, expect, it } from 'vitest';
import { buildCallList } from './callList';
import type { Activity, Contact, Task } from '@/types';

function makeActivity(over: Partial<Activity>): Activity {
  return {
    id: 'a-1',
    dealId: 'deal-1',
    contactId: 'contact-1',
    dealTitle: 'Negócio Teste',
    type: 'CALL',
    title: 'Ligar para o lead',
    description: '',
    date: new Date().toISOString(),
    user: { name: 'Eu', avatar: '' },
    completed: false,
    ...over,
  };
}

function makeContact(over: Partial<Contact>): Contact {
  return {
    id: 'contact-1',
    name: 'Fulano de Tal',
    email: 'fulano@example.com',
    phone: '+5511999999999',
    status: 'ACTIVE',
    stage: 'LEAD',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeTask(over: Partial<Task>): Task {
  return {
    id: 't-1',
    contactId: 'contact-1',
    type: 'reminder',
    title: 'Retorno do raio-X',
    dueDate: '2026-06-10',
    status: 'open',
    juliaFirst: false,
    ...over,
  };
}

describe('buildCallList', () => {
  // Quarta-feira fixa ao meio-dia para evitar flutuação de fuso/horário.
  const today = new Date('2026-06-10T12:00:00');

  it('separa ligações em overdue, today e upcoming pela data', () => {
    const ontem = makeActivity({ id: 'a-overdue', date: '2026-06-09T09:00:00' });
    const hoje = makeActivity({ id: 'a-today', date: '2026-06-10T15:00:00' });
    const amanha = makeActivity({ id: 'a-upcoming', date: '2026-06-11T09:00:00' });

    const result = buildCallList(
      { activities: [ontem, hoje, amanha], tasks: [], contacts: [makeContact({})] },
      today
    );

    expect(result.overdue.map((r) => r.activity?.id)).toEqual(['a-overdue']);
    expect(result.today.map((r) => r.activity?.id)).toEqual(['a-today']);
    expect(result.upcoming.map((r) => r.activity?.id)).toEqual(['a-upcoming']);
  });

  it('ignora activities que não são CALL ou que já estão completas', () => {
    const naoCall = makeActivity({ id: 'a-email', type: 'EMAIL', date: '2026-06-10T15:00:00' });
    const completa = makeActivity({ id: 'a-done', completed: true, date: '2026-06-10T15:00:00' });
    const valida = makeActivity({ id: 'a-ok', date: '2026-06-10T15:00:00' });

    const result = buildCallList(
      { activities: [naoCall, completa, valida], tasks: [], contacts: [makeContact({})] },
      today
    );

    const todosIds = [...result.overdue, ...result.today, ...result.upcoming].map(
      (r) => r.activity?.id
    );
    expect(todosIds).toEqual(['a-ok']);
  });

  it('anexa o contato (e telefone) resolvido por contactId', () => {
    const call = makeActivity({ id: 'a-1', contactId: 'contact-9', date: '2026-06-10T15:00:00' });
    const contato = makeContact({ id: 'contact-9', name: 'Beltrana', phone: '+5511888888888' });

    const result = buildCallList({ activities: [call], tasks: [], contacts: [contato] }, today);

    expect(result.today[0].contact?.name).toBe('Beltrana');
    expect(result.today[0].contact?.phone).toBe('+5511888888888');
  });

  it('deixa contact undefined quando não há contactId correspondente', () => {
    const call = makeActivity({ id: 'a-1', contactId: 'inexistente', date: '2026-06-10T15:00:00' });
    const result = buildCallList(
      { activities: [call], tasks: [], contacts: [makeContact({ id: 'contact-1' })] },
      today
    );
    expect(result.today[0].contact).toBeUndefined();
  });

  it('ordena cada bucket por data/hora crescente (mais antigo primeiro, tasks junto)', () => {
    const cedo = makeActivity({ id: 'a-cedo', date: '2026-06-10T08:00:00' });
    const tarde = makeActivity({ id: 'a-tarde', date: '2026-06-10T18:00:00' });
    const taskMeioDia = makeTask({ id: 't-meiodia', dueDate: '2026-06-10', dueTime: '12:00' });

    const result = buildCallList(
      { activities: [tarde, cedo], tasks: [taskMeioDia], contacts: [makeContact({})] },
      today
    );

    expect(result.today.map((r) => r.activity?.id ?? r.task?.id)).toEqual([
      'a-cedo',
      't-meiodia',
      'a-tarde',
    ]);
  });

  it('retorna buckets vazios quando não há pendências', () => {
    const result = buildCallList({ activities: [], tasks: [], contacts: [] }, today);
    expect(result).toEqual({ overdue: [], today: [], upcoming: [] });
  });

  // ===== Adendo (a): tasks vencendo hoje entram na lista =====

  it('tasks abertas vencendo hoje entram em today e atrasadas em overdue; futuras e concluídas ficam fora', () => {
    const hoje = makeTask({ id: 't-hoje', dueDate: '2026-06-10' });
    const atrasada = makeTask({ id: 't-atrasada', dueDate: '2026-06-08' });
    const futura = makeTask({ id: 't-futura', dueDate: '2026-06-22' });
    const concluida = makeTask({
      id: 't-done',
      dueDate: '2026-06-10',
      status: 'done',
      completedAt: '2026-06-10T09:00:00',
    });

    const result = buildCallList(
      { activities: [], tasks: [hoje, atrasada, futura, concluida], contacts: [makeContact({})] },
      today
    );

    expect(result.overdue.map((r) => r.task?.id)).toEqual(['t-atrasada']);
    expect(result.today.map((r) => r.task?.id)).toEqual(['t-hoje']);
    expect(result.upcoming).toEqual([]);
  });

  it('task sem contato entra na lista (tarefa geral da recepção)', () => {
    const semContato = makeTask({ id: 't-geral', contactId: undefined, dueDate: '2026-06-10' });
    const result = buildCallList(
      { activities: [], tasks: [semContato], contacts: [] },
      today
    );
    expect(result.today.map((r) => r.task?.id)).toEqual(['t-geral']);
    expect(result.today[0].contact).toBeUndefined();
  });

  // ===== Adendo (b): whatsapp_only sai da lista de ligar =====

  it('EXCLUI activities e tasks de contatos whatsapp_only (preferência salva)', () => {
    const soWhats = makeContact({ id: 'contact-wa', contactPreference: 'whatsapp_only' });
    const normal = makeContact({ id: 'contact-ok', contactPreference: 'any' });

    const callExcluida = makeActivity({
      id: 'a-wa',
      contactId: 'contact-wa',
      date: '2026-06-10T10:00:00',
    });
    const callOk = makeActivity({
      id: 'a-ok',
      contactId: 'contact-ok',
      date: '2026-06-10T10:00:00',
    });
    const taskExcluida = makeTask({ id: 't-wa', contactId: 'contact-wa', dueDate: '2026-06-10' });

    const result = buildCallList(
      { activities: [callExcluida, callOk], tasks: [taskExcluida], contacts: [soWhats, normal] },
      today
    );

    const ids = [...result.overdue, ...result.today, ...result.upcoming].map(
      (r) => r.activity?.id ?? r.task?.id
    );
    expect(ids).toEqual(['a-ok']);
  });

  // ===== Adendo (c): etiqueta de cadência F1-F9 com fallback honesto =====

  it('etiqueta cadenceStage quando o deal está num estágio F1-F9', () => {
    const call = makeActivity({ id: 'a-f4', dealId: 'deal-f4', date: '2026-06-10T10:00:00' });
    const dealStageLabelById = new Map([['deal-f4', 'F4 · dia 4']]);

    const result = buildCallList(
      { activities: [call], tasks: [], contacts: [makeContact({})], dealStageLabelById },
      today
    );

    expect(result.today[0].cadenceStage).toBe('F4 · dia 4');
  });

  it('NÃO inventa etiqueta: sem estágio de cadência (label não-F ou deal desconhecido) → sem badge', () => {
    const semBoard = makeActivity({ id: 'a-sem', dealId: 'deal-x', date: '2026-06-10T10:00:00' });
    const stageComum = makeActivity({ id: 'a-comum', dealId: 'deal-y', date: '2026-06-10T11:00:00' });
    const f10NaoExiste = makeActivity({ id: 'a-f10', dealId: 'deal-z', date: '2026-06-10T12:00:00' });
    const dealStageLabelById = new Map([
      ['deal-y', 'Orçamento'],
      ['deal-z', 'F10 inexistente'],
    ]);

    const result = buildCallList(
      {
        activities: [semBoard, stageComum, f10NaoExiste],
        tasks: [],
        contacts: [makeContact({})],
        dealStageLabelById,
      },
      today
    );

    expect(result.today.every((r) => r.cadenceStage === undefined)).toBe(true);
  });
});
