// @vitest-environment node
//
// RLS-as-text de lead_sources (N1 — origens de lead editáveis).
//
// Tabela OPERACIONAL (espelha atendimentos): SELECT = can_access_organization
// (todo o tenant lê as origens pra preencher o select do form de contato),
// mutação = can_operate_organization (recepção/staff pode cadastrar origem).
// NUNCA can_configure aqui — origem não é dado financeiro sensível.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260617000000_lead_sources.sql'
);

describe('lead_sources RLS migration (N1 — origens editáveis)', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  it('cria a tabela lead_sources com RLS habilitada e FK cascade pra organização', () => {
    expect(sql).toContain('create table if not exists public.lead_sources');
    expect(sql).toContain('alter table public.lead_sources enable row level security');
    expect(sql).toContain('references public.organizations(id) on delete cascade');
  });

  it('SELECT usa can_access (tenant todo lê) e mutação usa can_operate (staff opera)', () => {
    expect(sql).toContain('"lead_sources_select_by_tenant"');
    expect(sql).toContain('"lead_sources_mutate_by_tenant_operator"');
    expect(sql).toContain('public.can_access_organization');
    expect(sql).toContain('public.can_operate_organization');
    // Origem NÃO é config financeira — can_configure aqui esconderia as origens da Vitória.
    expect(sql).not.toContain('public.can_configure_organization');
  });

  it('não deixa policies permissivas', () => {
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('aplica trigger updated_at e índice por organização', () => {
    expect(sql).toContain('create trigger update_lead_sources_updated_at');
    expect(sql).toContain('public.update_updated_at_column()');
    expect(sql).toContain('idx_lead_sources_org');
  });

  it('NÃO seeda origens padrão na migração (seed é via MCP no tenant piloto)', () => {
    expect(sql.toLowerCase()).not.toContain('insert into');
  });
});
