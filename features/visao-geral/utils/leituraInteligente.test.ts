import { describe, it, expect } from 'vitest';
import {
  contarLeadsNovosDoMes,
  contarTarefasDeHoje,
  leadsPorDia,
  leadsPorOrigem,
  funilDoMes,
  dealsParados,
  paradosPorEtapa,
  notasDeAtencao,
} from './leituraInteligente';
import type { Contact, Task, LifecycleStage, DealView } from '@/types';

const NOW = new Date(2026, 5, 10, 12, 0, 0); // 2026-06-10 meio-dia

function contact(partial: Partial<Contact>): Contact {
  return {
    id: partial.id || `c-${Math.random()}`,
    name: partial.name || 'Paciente',
    email: '',
    phone: '',
    status: 'ACTIVE',
    stage: partial.stage || 'stage-lead',
    createdAt: partial.createdAt || new Date(2026, 5, 5).toISOString(),
    ...partial,
  } as Contact;
}

function deal(partial: Partial<DealView>): DealView {
  return {
    id: partial.id || `d-${Math.random()}`,
    title: partial.title || 'Negócio',
    contactId: partial.contactId || 'c-1',
    contactName: partial.contactName || 'Paciente',
    contactEmail: '',
    stageLabel: partial.stageLabel || 'Em conversa',
    boardId: 'b-1',
    value: partial.value ?? 0,
    items: [],
    status: partial.status || 'stage-uuid',
    isWon: partial.isWon ?? false,
    isLost: partial.isLost ?? false,
    createdAt: partial.createdAt || new Date(2026, 5, 1).toISOString(),
    updatedAt: new Date(2026, 5, 1).toISOString(),
    probability: 0,
    priority: 'medium',
    owner: { name: '', avatar: '' },
    tags: [],
    ...partial,
  } as DealView;
}

function task(partial: Partial<Task>): Task {
  return {
    id: partial.id || `t-${Math.random()}`,
    type: 'call',
    title: 'Ligar',
    dueDate: partial.dueDate || '2026-06-10',
    status: partial.status || 'open',
    juliaFirst: false,
    ...partial,
  } as Task;
}

describe('contarLeadsNovosDoMes', () => {
  it('conta só os contatos criados no mês corrente', () => {
    const contacts = [
      contact({ createdAt: new Date(2026, 5, 1).toISOString() }),
      contact({ createdAt: new Date(2026, 5, 9).toISOString() }),
      contact({ createdAt: new Date(2026, 4, 30).toISOString() }), // maio: fora
    ];
    expect(contarLeadsNovosDoMes(contacts, NOW)).toBe(2);
  });
});

describe('contarTarefasDeHoje', () => {
  it('conta tarefas abertas que vencem hoje (done/snoozed e outros dias ficam fora)', () => {
    const tasks = [
      task({ dueDate: '2026-06-10', status: 'open' }),
      task({ dueDate: '2026-06-10', status: 'done', completedAt: NOW.toISOString() }),
      task({ dueDate: '2026-06-11', status: 'open' }),
    ];
    expect(contarTarefasDeHoje(tasks, NOW)).toBe(1);
  });
});

describe('leadsPorDia', () => {
  it('zero-preenche os últimos N dias e conta criados por dia local', () => {
    const contacts = [
      contact({ createdAt: new Date(2026, 5, 10, 9, 0).toISOString() }),
      contact({ createdAt: new Date(2026, 5, 10, 22, 0).toISOString() }),
      contact({ createdAt: new Date(2026, 5, 8, 23, 30).toISOString() }),
      contact({ createdAt: new Date(2026, 4, 1).toISOString() }), // fora da janela
    ];
    const serie = leadsPorDia(contacts, 3, NOW);
    expect(serie).toEqual([
      { dia: '08/06', leads: 1 },
      { dia: '09/06', leads: 0 },
      { dia: '10/06', leads: 2 },
    ]);
  });
});

describe('leadsPorOrigem', () => {
  it('agrupa por source, inclui origens ativas zeradas e ordena por volume', () => {
    const contacts = [
      contact({ source: 'Instagram' }),
      contact({ source: 'Instagram' }),
      contact({ source: 'Anúncio Meta' }),
      contact({ source: undefined }),
    ];
    const origens = leadsPorOrigem(contacts, ['Anúncio Meta', 'Instagram', 'Indicação']);
    expect(origens[0]).toEqual({ origem: 'Instagram', leads: 2 });
    expect(origens).toContainEqual({ origem: 'Indicação', leads: 0 });
    expect(origens).toContainEqual({ origem: 'Sem origem', leads: 1 });
  });
});

describe('funilDoMes', () => {
  it('conta o coorte do mês por etapa, na ordem do lifecycle', () => {
    const stages: LifecycleStage[] = [
      { id: 's-lead', name: 'Lead', color: '#999', order: 1 },
      { id: 's-conversa', name: 'Em conversa', color: '#999', order: 2 },
      { id: 's-fechou', name: 'Fechou', color: '#999', order: 3 },
    ];
    const contacts = [
      contact({ stage: 's-lead', createdAt: new Date(2026, 5, 2).toISOString() }),
      contact({ stage: 's-conversa', createdAt: new Date(2026, 5, 3).toISOString() }),
      contact({ stage: 's-conversa', createdAt: new Date(2026, 5, 4).toISOString() }),
      contact({ stage: 's-fechou', createdAt: new Date(2026, 4, 1).toISOString() }), // maio: fora do coorte
    ];
    expect(funilDoMes(contacts, stages, NOW)).toEqual([
      { etapa: 'Lead', count: 1 },
      { etapa: 'Em conversa', count: 2 },
      { etapa: 'Fechou', count: 0 },
    ]);
  });
});

describe('dealsParados / paradosPorEtapa', () => {
  it('considera parado o deal aberto sem mudança de etapa há N+ dias (ganho/perdido fora)', () => {
    const deals = [
      deal({ id: 'd-1', lastStageChangeDate: new Date(2026, 5, 5).toISOString() }), // 5 dias parado
      deal({ id: 'd-2', lastStageChangeDate: new Date(2026, 5, 9).toISOString() }), // 1 dia: ok
      deal({ id: 'd-3', isWon: true, lastStageChangeDate: new Date(2026, 4, 1).toISOString() }),
      deal({ id: 'd-4', createdAt: new Date(2026, 5, 1).toISOString(), lastStageChangeDate: undefined }), // fallback createdAt
    ];
    const parados = dealsParados(deals, NOW, 3);
    expect(parados.map((d) => d.id).sort()).toEqual(['d-1', 'd-4']);
  });

  it('agrupa os parados por etiqueta de etapa, pior etapa primeiro', () => {
    const parados = [
      deal({ stageLabel: 'Em conversa', lastStageChangeDate: new Date(2026, 5, 1).toISOString() }),
      deal({ stageLabel: 'Em conversa', lastStageChangeDate: new Date(2026, 5, 1).toISOString() }),
      deal({ stageLabel: 'Lead', lastStageChangeDate: new Date(2026, 5, 1).toISOString() }),
    ];
    expect(paradosPorEtapa(parados)).toEqual([
      { etapa: 'Em conversa', count: 2 },
      { etapa: 'Lead', count: 1 },
    ]);
  });
});

describe('notasDeAtencao (regras determinísticas v1)', () => {
  it('detecta leads sem resposta 48h+, orçamentos parados e tarefas vencidas', () => {
    const contacts = [
      // criado há 5 dias, sem interação nunca → sem resposta
      contact({ id: 'c-frio', name: 'Frio', createdAt: new Date(2026, 5, 5).toISOString() }),
      // interagiu hoje → ok
      contact({
        id: 'c-quente',
        name: 'Quente',
        createdAt: new Date(2026, 5, 5).toISOString(),
        lastInteraction: NOW.toISOString(),
      }),
      // criado há 1h → cedo demais pra cobrar
      contact({ id: 'c-novo', name: 'Novo', createdAt: new Date(2026, 5, 10, 11, 0).toISOString() }),
    ];
    const deals = [
      deal({
        id: 'd-orc',
        contactId: 'c-frio',
        contactName: 'Frio',
        value: 12400,
        lastStageChangeDate: new Date(2026, 5, 1).toISOString(),
      }),
    ];
    const tasks = [
      task({ dueDate: '2026-06-08', status: 'open' }), // vencida
      task({ dueDate: '2026-06-10', status: 'open' }), // hoje: não vencida
    ];

    const notas = notasDeAtencao({ contacts, deals, tasks, now: NOW });
    const keys = notas.map((n) => n.key);

    expect(keys).toContain('sem_resposta_48h');
    expect(keys).toContain('orcamentos_parados');
    expect(keys).toContain('tarefas_vencidas');

    const semResposta = notas.find((n) => n.key === 'sem_resposta_48h')!;
    expect(semResposta.alvos).toEqual([{ contactId: 'c-frio', nome: 'Frio' }]);

    const orcamentos = notas.find((n) => n.key === 'orcamentos_parados')!;
    // mockup: "R$ 12.400 em orçamentos sem resposta" — o valor vai no título
    expect(orcamentos.titulo).toContain('12.400');
  });

  it('sem sinal nenhum → sem notas (não inventa alerta)', () => {
    expect(notasDeAtencao({ contacts: [], deals: [], tasks: [], now: NOW })).toEqual([]);
  });
});
