/**
 * @fileoverview Leitura inteligente da Visão Geral (N5) — funções PURAS.
 *
 * Regras determinísticas v1 (sem IA): leads novos/por dia/por origem, funil do
 * mês (coorte), leads parados por etapa (last_stage_change_date) e notas de
 * atenção com alvos pra ação concreta ("resolver" cria tasks em lote).
 * `now` é injetável — testes determinísticos.
 */
import type { Contact, Task, LifecycleStage, DealView } from '@/types';

const DIA_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' local de uma data (formato de tasks.due_date). */
export function isoDateLocal(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function mesmoMesLocal(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

/** Contatos criados no mês corrente (coorte do mês, hora local). */
export function contarLeadsNovosDoMes(contacts: Contact[], now: Date = new Date()): number {
  return contacts.filter((c) => mesmoMesLocal(c.createdAt, now)).length;
}

/** Tarefas abertas que vencem hoje (due_date local). */
export function contarTarefasDeHoje(tasks: Task[], now: Date = new Date()): number {
  const hoje = isoDateLocal(now);
  return tasks.filter((t) => t.status === 'open' && t.dueDate === hoje).length;
}

/** Série "Leads por dia" dos últimos `dias` dias (zero-preenchida, label DD/MM). */
export function leadsPorDia(
  contacts: Contact[],
  dias: number,
  now: Date = new Date()
): Array<{ dia: string; leads: number }> {
  const hoje = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets = new Map<string, number>();
  const ordem: string[] = [];

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje.getTime() - i * DIA_MS);
    const key = isoDateLocal(d);
    buckets.set(key, 0);
    ordem.push(key);
  }

  for (const contato of contacts) {
    if (!contato.createdAt) continue;
    const key = isoDateLocal(new Date(contato.createdAt));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return ordem.map((key) => {
    const [, mes, dia] = key.split('-');
    return { dia: `${dia}/${mes}`, leads: buckets.get(key) || 0 };
  });
}

/**
 * "De onde vem o lead": agrupa contatos por origem (source, alimentado por
 * lead_sources/N1), inclui origens ativas zeradas e ordena por volume.
 */
export function leadsPorOrigem(
  contacts: Contact[],
  origensAtivas: string[] = []
): Array<{ origem: string; leads: number }> {
  const counts = new Map<string, number>();
  for (const origem of origensAtivas) counts.set(origem, 0);

  for (const contato of contacts) {
    const origem = contato.source?.trim() || 'Sem origem';
    counts.set(origem, (counts.get(origem) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([origem, leads]) => ({ origem, leads }))
    .sort((a, b) => b.leads - a.leads);
}

/** Funil do mês: coorte criado no mês corrente, por etapa do lifecycle (ordenado). */
export function funilDoMes(
  contacts: Contact[],
  stages: LifecycleStage[],
  now: Date = new Date()
): Array<{ etapa: string; count: number }> {
  const coorte = contacts.filter((c) => mesmoMesLocal(c.createdAt, now));
  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      etapa: stage.name,
      count: coorte.filter((c) => c.stage === stage.id).length,
    }));
}

/**
 * Deals parados: abertos (nem ganho nem perdido) sem mudança de etapa há
 * `diasParado`+ dias (lastStageChangeDate, fallback createdAt).
 */
export function dealsParados(
  deals: DealView[],
  now: Date = new Date(),
  diasParado: number = 3
): DealView[] {
  const limite = now.getTime() - diasParado * DIA_MS;
  return deals.filter((d) => {
    if (d.isWon || d.isLost) return false;
    const referencia = d.lastStageChangeDate || d.createdAt;
    if (!referencia) return false;
    return new Date(referencia).getTime() <= limite;
  });
}

/** Agrupa os parados por etiqueta de etapa (pior etapa primeiro). */
export function paradosPorEtapa(
  parados: DealView[]
): Array<{ etapa: string; count: number }> {
  const counts = new Map<string, number>();
  for (const d of parados) {
    const etapa = d.stageLabel || 'Sem etapa';
    counts.set(etapa, (counts.get(etapa) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([etapa, count]) => ({ etapa, count }))
    .sort((a, b) => b.count - a.count);
}

/** Nota de atenção determinística com alvos pra ação concreta. */
export interface NotaAtencao {
  key: 'sem_resposta_48h' | 'orcamentos_parados' | 'tarefas_vencidas';
  titulo: string;
  detalhe: string;
  /** Rótulo do botão de ação. */
  acao: string;
  /** Contatos-alvo da ação resolver (criação de tasks em lote). */
  alvos: Array<{ contactId?: string; nome: string }>;
}

const formatBRL = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Notas de atenção (regras determinísticas v1):
 * 1. Leads ativos sem interação há 48h+ (criados há mais de 48h);
 * 2. Orçamentos (deals abertos com valor) parados há 3+ dias = dinheiro na mesa;
 * 3. Tarefas abertas vencidas (due_date < hoje).
 *
 * Regras de agenda (faltas sem remarcação, horários livres) entram com a F7.
 */
export function notasDeAtencao(params: {
  contacts: Contact[];
  deals: DealView[];
  tasks: Task[];
  now?: Date;
}): NotaAtencao[] {
  const now = params.now ?? new Date();
  const notas: NotaAtencao[] = [];
  const limite48h = now.getTime() - 48 * 60 * 60 * 1000;

  // 1. sem resposta 48h+
  const semResposta = params.contacts.filter((c) => {
    if (c.status !== 'ACTIVE') return false;
    if (!c.createdAt || new Date(c.createdAt).getTime() > limite48h) return false;
    if (!c.lastInteraction) return true;
    return new Date(c.lastInteraction).getTime() <= limite48h;
  });
  if (semResposta.length > 0) {
    notas.push({
      key: 'sem_resposta_48h',
      titulo: `${semResposta.length} lead${semResposta.length > 1 ? 's' : ''} sem resposta há 48h+`,
      detalhe: 'sem nenhuma interação recente — entra na fila de ligação',
      acao: 'resolver',
      alvos: semResposta.map((c) => ({ contactId: c.id, nome: c.name })),
    });
  }

  // 2. orçamentos parados (deals abertos com valor, 3+ dias sem mudança)
  const orcamentos = dealsParados(params.deals, now, 3).filter((d) => (d.value || 0) > 0);
  if (orcamentos.length > 0) {
    const total = orcamentos.reduce((acc, d) => acc + (d.value || 0), 0);
    notas.push({
      key: 'orcamentos_parados',
      titulo: `${formatBRL(total)} em orçamentos sem resposta`,
      detalhe: `${orcamentos.length} negócio${orcamentos.length > 1 ? 's' : ''} parado${orcamentos.length > 1 ? 's' : ''} há 3+ dias · dinheiro parado na mesa`,
      acao: 'resolver',
      alvos: orcamentos.map((d) => ({ contactId: d.contactId, nome: d.contactName || d.title })),
    });
  }

  // 3. tarefas vencidas
  const hoje = isoDateLocal(now);
  const vencidas = params.tasks.filter((t) => t.status === 'open' && t.dueDate < hoje);
  if (vencidas.length > 0) {
    notas.push({
      key: 'tarefas_vencidas',
      titulo: `${vencidas.length} tarefa${vencidas.length > 1 ? 's' : ''} vencida${vencidas.length > 1 ? 's' : ''}`,
      detalhe: 'abertas com vencimento no passado — revisar na tela de Tarefas',
      acao: 'abrir tarefas',
      alvos: [],
    });
  }

  return notas;
}
