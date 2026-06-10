// @vitest-environment node
//
// Migração-as-text do nudge de tarefas (N3 — adendo 2026-06-10).
//
// `organization_settings.task_nudge_interval_minutes`: null = desligado;
// 15/30/60 = intervalo do pop-up. A tabela JÁ tem RLS certa no core
// (select = can_access, mutate = can_configure — só quem configura a org
// muda o intervalo); a migração só adiciona coluna + CHECK de domínio,
// SEM afrouxar policy nenhuma.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260619000000_task_nudge_interval.sql'
);

describe('task_nudge_interval migration (N3 — nudge pop-up de tarefas)', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('adiciona a coluna em organization_settings (nullable = desligado por padrão)', () => {
    expect(sql).toContain('alter table public.organization_settings');
    expect(sql).toContain('add column if not exists task_nudge_interval_minutes');
    expect(sql).not.toContain('not null');
  });

  it('trava o domínio do intervalo no banco: null ou 15/30/60', () => {
    expect(sql).toContain('task_nudge_interval_minutes is null');
    expect(sql).toContain('in (15, 30, 60)');
  });

  it('não cria nem afrouxa policies (RLS do core já cobre: select access, mutate configure)', () => {
    expect(sql).not.toContain('create policy');
    expect(sql).not.toContain('drop policy');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});
