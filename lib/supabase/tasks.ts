/**
 * @fileoverview Serviço Supabase para tarefas & lembretes (N2).
 *
 * ## Insight travado
 * "Nada de paciente esquecido": tarefa nasce open; concluir carimba
 * `completed_at` (CHECK no banco garante done ⇔ completed_at nos 2 sentidos);
 * reabrir limpa o carimbo. Update NUNCA re-carimba campos não editados
 * (lição F4 dos atendimentos).
 *
 * ## julia_first
 * Só persiste a intenção do toggle "Julia avisa primeiro no WhatsApp".
 * A automação (Evolution + cron 24h) é fase posterior atrás de flag.
 *
 * ## Segurança Multi-Tenant
 * `organization_id`, `owner_id` e `created_by` são carimbados no insert; a RLS
 * (can_operate_organization) é o gate real. Nunca confiar no orgId do client.
 *
 * @module lib/supabase/tasks
 */

import { supabase } from './client';
import { Task, TaskStatus, TaskType } from '@/types';
import { sanitizeUUID } from './utils';

const SELECT_COLUMNS =
  'id, organization_id, contact_id, type, title, note, due_date, due_time, status, julia_first, created_by, completed_at, owner_id, created_at, updated_at';

export interface DbTask {
  id: string;
  organization_id: string | null;
  contact_id: string | null;
  type: string;
  title: string;
  note: string | null;
  due_date: string;
  due_time: string | null;
  status: string;
  julia_first: boolean | null;
  created_by: string | null;
  completed_at: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

function transformTask(db: DbTask): Task {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    contactId: db.contact_id || undefined,
    type: db.type as TaskType,
    title: db.title,
    note: db.note || undefined,
    dueDate: db.due_date,
    // Postgres devolve time como HH:MM:SS — a UI usa HH:MM.
    dueTime: db.due_time ? db.due_time.slice(0, 5) : undefined,
    status: db.status as TaskStatus,
    juliaFirst: db.julia_first ?? false,
    createdBy: db.created_by || undefined,
    completedAt: db.completed_at || undefined,
    ownerId: db.owner_id || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

/**
 * Monta o payload de insert carimbando org + owner/created_by e derivando
 * completed_at de status (invariante done ⇔ completed_at do banco).
 */
function taskToInsert(
  input: Omit<Task, 'id'>,
  organizationId: string | null,
  userId: string | null
): Record<string, unknown> {
  const status: TaskStatus = input.status ?? 'open';
  return {
    organization_id: sanitizeUUID(organizationId),
    owner_id: sanitizeUUID(userId),
    created_by: sanitizeUUID(userId),
    contact_id: sanitizeUUID(input.contactId),
    type: input.type,
    title: input.title,
    note: input.note || null,
    due_date: input.dueDate,
    due_time: input.dueTime || null,
    status,
    julia_first: input.juliaFirst ?? false,
    completed_at: status === 'done' ? (input.completedAt || new Date().toISOString()) : null,
  };
}

/**
 * Monta o payload de update SOMENTE com os campos editados (lição F4).
 * Mudança de status é o ÚNICO gatilho que toca completed_at:
 * done → carimba agora; open/snoozed → limpa.
 */
function taskToUpdate(updates: Partial<Task>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (updates.contactId !== undefined) payload.contact_id = sanitizeUUID(updates.contactId);
  if (updates.type !== undefined) payload.type = updates.type;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.note !== undefined) payload.note = updates.note || null;
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;
  if (updates.dueTime !== undefined) payload.due_time = updates.dueTime || null;
  if (updates.juliaFirst !== undefined) payload.julia_first = updates.juliaFirst;
  if (updates.status !== undefined) {
    payload.status = updates.status;
    payload.completed_at =
      updates.status === 'done' ? (updates.completedAt || new Date().toISOString()) : null;
  }
  return payload;
}

export const tasksService = {
  /**
   * Busca todas as tarefas do tenant ordenadas por vencimento (mais perto primeiro).
   */
  async getAll(organizationId?: string | null): Promise<{ data: Task[] | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      let query = sb.from('tasks').select(SELECT_COLUMNS);

      const normalizedOrganizationId = sanitizeUUID(organizationId);
      if (normalizedOrganizationId) {
        query = query.eq('organization_id', normalizedOrganizationId);
      }

      const { data, error } = await query
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true, nullsFirst: false });

      if (error) return { data: null, error };
      return { data: (data || []).map(t => transformTask(t as unknown as DbTask)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria uma tarefa. org+owner+created_by carimbados aqui; RLS valida via WITH CHECK.
   */
  async create(
    task: Omit<Task, 'id'>,
    organizationId?: string | null
  ): Promise<{ data: Task | null; error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await sb.auth.getUser();
      const insertData = taskToInsert(task, organizationId ?? null, user?.id ?? null);

      const { data, error } = await sb
        .from('tasks')
        .insert(insertData)
        .select(SELECT_COLUMNS)
        .single();

      if (error) return { data: null, error };
      return { data: transformTask(data as unknown as DbTask), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Atualiza uma tarefa. Só envia campos editados; status done/reaberto
   * ajusta completed_at coerentemente (espelha o CHECK do banco).
   */
  async update(id: string, updates: Partial<Task>): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const payload = taskToUpdate(updates);
      const { error } = await sb.from('tasks').update(payload).eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  /**
   * Exclui uma tarefa.
   */
  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      const sb = supabase;
      if (!sb) return { error: new Error('Supabase não configurado') };

      const { error } = await sb.from('tasks').delete().eq('id', sanitizeUUID(id));
      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

// Exports internos só para teste de transform (não usar na app).
export const __transformTask = transformTask;
export const __taskToInsert = taskToInsert;
export const __taskToUpdate = taskToUpdate;
