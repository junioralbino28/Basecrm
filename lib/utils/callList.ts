/**
 * @fileoverview Bucketização pura da Home "Hoje" / call-list (F6).
 *
 * NÃO cria tabela nova: deriva a lista de "quem ligar/seguir hoje" de dados
 * que já existem — activities (type 'CALL', !completed) + tasks do N2 — e
 * cruza com contacts (phone/preferência).
 *
 * Ajustes do adendo 2026-06-10 (mockup aprovado):
 * (a) tasks abertas vencendo hoje (inclui atrasadas) ENTRAM na lista;
 * (b) contatos contact_preference = 'whatsapp_only' SAEM ("não gosta de
 *     ligação" — a preferência salva tira a pessoa da lista de ligar);
 * (c) etiqueta de cadência F1-F9 com fallback HONESTO: só etiqueta quando o
 *     deal está num estágio cujo label começa com F1..F9 (board do N6);
 *     sem estágio de cadência → sem badge, nunca inventa dado.
 *
 * Guardrail do playbook: nada aqui move deal no funil — é leitura derivada.
 *
 * @module lib/utils/callList
 */

import type { Activity, Contact, Task } from '@/types';

/**
 * Uma linha da call-list: ligação pendente (activity CALL) OU task vencendo
 * hoje, com o contato resolvido (se houver) e a etiqueta de cadência F1-F9
 * (só para activities de deal em estágio de cadência — fallback honesto).
 */
export type CallListEntry =
  | { kind: 'activity'; activity: Activity; task?: undefined; contact?: Contact; cadenceStage?: string }
  | { kind: 'task'; task: Task; activity?: undefined; contact?: Contact; cadenceStage?: undefined };

/**
 * Resultado da bucketização: pendências atrasadas, de hoje e futuras.
 */
export interface CallListBuckets {
  overdue: CallListEntry[];
  today: CallListEntry[];
  upcoming: CallListEntry[];
}

/** Entrada da bucketização (todas as listas já filtradas por tenant na query). */
export interface BuildCallListInput {
  activities: Activity[];
  /** Tarefas do N2 — só as abertas vencendo hoje/atrasadas entram (adendo a). */
  tasks: Task[];
  contacts: Contact[];
  /** dealId → label do estágio atual (pra etiqueta de cadência F1-F9). */
  dealStageLabelById?: Map<string, string>;
}

/** Estágio de cadência do board F1-F9 (N6): label começa com F1..F9. */
const CADENCE_STAGE_REGEX = /^F[1-9]\b/;

/** Data local YYYY-MM-DD (espelha localTodayIso do N2 — due_date é date, sem fuso). */
function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Timestamp local da task (dueDate + dueTime opcional; sem hora = 00:00). */
function taskTimestamp(task: Task): number {
  const [y, m, d] = task.dueDate.split('-').map(Number);
  const [hh, mm] = (task.dueTime || '00:00').split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime();
}

/** Instante de ordenação de uma entrada (activity.date ou due da task). */
function entryTimestamp(entry: CallListEntry): number {
  return entry.kind === 'activity' ? Date.parse(entry.activity.date) : taskTimestamp(entry.task);
}

/**
 * Deriva, no client, a lista de "quem ligar/seguir hoje".
 *
 * Regras (espelham o filtro de data de useActivitiesController):
 * - Activities: apenas type 'CALL' e não concluídas (!completed);
 *   overdue = data < início de hoje · today = hoje · upcoming = amanhã+.
 * - Tasks: apenas status != 'done' com dueDate <= hoje (adendo a);
 *   dueDate < hoje → overdue · dueDate = hoje → today. Futuras NÃO entram
 *   na call-list (vivem na tela Tarefas).
 * - Contato whatsapp_only → entrada EXCLUÍDA da lista (adendo b).
 * - Cada bucket é ordenado por data/hora crescente (mais antigo primeiro).
 *
 * @param input Listas do tenant + mapa opcional dealId→label do estágio.
 * @param today "Agora" — injetado para testabilidade determinística.
 */
export function buildCallList(
  input: BuildCallListInput,
  today: Date = new Date()
): CallListBuckets {
  const { activities, tasks, contacts, dealStageLabelById } = input;

  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayTs = start.getTime();
  const tomorrowTs = tomorrow.getTime();
  const todayIso = localDateIso(today);

  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  const buckets: CallListBuckets = { overdue: [], today: [], upcoming: [] };

  const resolveContact = (contactId?: string): Contact | undefined =>
    contactId ? contactsById.get(contactId) : undefined;

  /** Adendo (b): preferência salva "só WhatsApp" tira a pessoa da lista de ligar. */
  const isWhatsappOnly = (contact?: Contact): boolean =>
    contact?.contactPreference === 'whatsapp_only';

  for (const activity of activities) {
    if (activity.type !== 'CALL') continue;
    if (activity.completed) continue;

    const ts = Date.parse(activity.date);
    if (Number.isNaN(ts)) continue;

    const contact = resolveContact(activity.contactId);
    if (isWhatsappOnly(contact)) continue;

    // Etiqueta de cadência: SÓ quando o label do estágio do deal é F1..F9.
    const stageLabel = activity.dealId ? dealStageLabelById?.get(activity.dealId) : undefined;
    const cadenceStage =
      stageLabel && CADENCE_STAGE_REGEX.test(stageLabel) ? stageLabel : undefined;

    const entry: CallListEntry = { kind: 'activity', activity, contact, cadenceStage };

    if (ts < todayTs) {
      buckets.overdue.push(entry);
    } else if (ts < tomorrowTs) {
      buckets.today.push(entry);
    } else {
      buckets.upcoming.push(entry);
    }
  }

  for (const task of tasks) {
    if (task.status === 'done') continue;
    if (task.dueDate > todayIso) continue; // futuras vivem na tela Tarefas

    const contact = resolveContact(task.contactId);
    if (isWhatsappOnly(contact)) continue;

    const entry: CallListEntry = { kind: 'task', task, contact };

    if (task.dueDate < todayIso) {
      buckets.overdue.push(entry);
    } else {
      buckets.today.push(entry);
    }
  }

  const byDateAsc = (a: CallListEntry, b: CallListEntry) =>
    entryTimestamp(a) - entryTimestamp(b);
  buckets.overdue.sort(byDateAsc);
  buckets.today.sort(byDateAsc);
  buckets.upcoming.sort(byDateAsc);

  return buckets;
}
