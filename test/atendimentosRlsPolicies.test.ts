// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260614000000_atendimentos.sql'
);

describe('migração atendimentos RLS', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela com RLS habilitada de forma idempotente', () => {
    expect(sql).toContain('create table if not exists public.atendimentos');
    expect(sql).toContain('alter table public.atendimentos enable row level security');
    expect(sql).toContain('references public.organizations(id) on delete cascade');
  });

  it('inclui o campo desconto da planilha do Adel (adendo 2026-06-10)', () => {
    expect(sql).toContain('desconto numeric not null default 0');
  });

  it('aplica políticas tenant-aware (select access · mutate operate) sem USING (true)', () => {
    expect(sql).toContain('public.can_access_organization(organization_id)');
    expect(sql).toContain('public.can_operate_organization(organization_id)');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('mantém o trigger de updated_at e o índice por organização', () => {
    expect(sql).toContain('execute function public.update_updated_at_column()');
    expect(sql).toContain('idx_atendimentos_org on public.atendimentos(organization_id, created_at desc)');
  });
});
