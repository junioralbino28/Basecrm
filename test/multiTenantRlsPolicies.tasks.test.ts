// @vitest-environment node
//
// RLS-as-text de tasks + contacts.contact_preference (N2 — tarefas & lembretes).
//
// Tabela OPERACIONAL (espelha atendimentos): SELECT = can_access_organization,
// mutação = can_operate_organization (a Vitória cria/conclui tarefa).
//
// Invariantes de domínio NO BANCO (lição F4 — defense-in-depth):
//   type em call|reminder|message · status em open|done|snoozed
//   · done ⇔ completed_at preenchido (nos 2 sentidos)
//   · contact_preference em any|whatsapp_only.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260618000000_tasks.sql'
);

describe('tasks RLS migration (N2 — tarefas & lembretes)', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela tasks com RLS habilitada e FK cascade pra organização', () => {
    expect(sql).toContain('create table if not exists public.tasks');
    expect(sql).toContain('alter table public.tasks enable row level security');
    expect(sql).toContain('references public.organizations(id) on delete cascade');
    expect(sql).toContain('references public.contacts(id)');
    expect(sql).toContain('references public.profiles(id)');
  });

  it('SELECT usa can_access e mutação usa can_operate (Vitória opera tarefas)', () => {
    expect(sql).toContain('"tasks_select_by_tenant"');
    expect(sql).toContain('"tasks_mutate_by_tenant_operator"');
    expect(sql).toContain('public.can_access_organization');
    expect(sql).toContain('public.can_operate_organization');
    expect(sql).not.toContain('public.can_configure_organization');
  });

  it('trava os domínios de type e status no banco', () => {
    expect(sql).toContain("'call'");
    expect(sql).toContain("'reminder'");
    expect(sql).toContain("'message'");
    expect(sql).toContain("'open'");
    expect(sql).toContain("'done'");
    expect(sql).toContain("'snoozed'");
  });

  it('invariante done ⇔ completed_at no banco (lição F4)', () => {
    expect(sql).toContain("(status = 'done') = (completed_at is not null)");
  });

  it('índice de listagem por (organization_id, due_date, status)', () => {
    expect(sql).toContain('idx_tasks_org_due_status');
    expect(sql).toContain('(organization_id, due_date, status)');
  });

  it('adiciona contacts.contact_preference com default any e CHECK de domínio', () => {
    expect(sql).toContain('alter table public.contacts');
    expect(sql).toContain('contact_preference');
    expect(sql).toContain("default 'any'");
    expect(sql).toContain("'whatsapp_only'");
  });

  it('não deixa policies permissivas e aplica trigger updated_at', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
    expect(sql).toContain('create trigger update_tasks_updated_at');
    expect(sql).toContain('public.update_updated_at_column()');
  });
});
