// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260718000000_funil_f1_authoring.sql'
);

describe('F1 — schema authoring multi-tenant', () => {
  const sql = readFileSync(migrationPath, 'utf-8').toLowerCase();

  it('cria draft, passos, arestas e templates com organization_id obrigatório', () => {
    for (const table of [
      'automations',
      'automation_steps',
      'automation_step_edges',
      'message_templates',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toMatch(
        new RegExp(`create table public\\.${table}[\\s\\S]*?organization_id uuid not null`)
      );
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('trava os domínios v1 e mantém o modo simulation como default seguro', () => {
    expect(sql).toContain("delivery_mode text not null default 'simulation'");
    expect(sql).toContain("check (delivery_mode in ('simulation', 'test', 'live'))");
    expect(sql).toContain("check (lifecycle_status in ('draft', 'published', 'paused', 'archived'))");
    expect(sql).toContain(
      "check (step_type in ('send_message', 'delay', 'wait_for_event', 'create_task', 'move_stage', 'move_pipeline', 'condition'))"
    );
    expect(sql).toContain(
      "check (outcome in ('success', 'answered', 'timeout', 'failed', 'true', 'false', 'otherwise'))"
    );
  });

  it('impede referências cruzadas entre tenants por chaves compostas', () => {
    expect(sql).toMatch(
      /foreign key \(automation_id, organization_id\)\s+references public\.automations\(id, organization_id\)/
    );
    expect(sql).toMatch(
      /foreign key \(from_step_id, automation_id, organization_id\)\s+references public\.automation_steps\(id, automation_id, organization_id\)/
    );
    expect(sql).toMatch(
      /foreign key \(to_step_id, automation_id, organization_id\)\s+references public\.automation_steps\(id, automation_id, organization_id\)/
    );
  });

  it('autoriza leitura operacional sem permitir edição do grafo', () => {
    expect(sql).toContain("public.has_permission('automation.operate')");
    expect(sql).toContain("public.has_permission('automation.edit')");
    expect(sql).toContain('"automations_insert_by_tenant_editor"');
    expect(sql).toContain('"automation_steps_mutate_by_tenant_editor"');
    expect(sql).toContain('"automation_step_edges_mutate_by_tenant_editor"');
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });

  it('instala snapshot completo dos defaults depois das duas novas permissões', () => {
    expect(sql).toContain('-- e2_role_permission_defaults:start');
    expect(sql).toContain("-- e2_role_permission_defaults:end");
    expect(sql).toContain("(1, 'clinic_staff', 'automation.edit', false)");
    expect(sql).toContain("(1, 'clinic_staff', 'automation.operate', true)");
    expect(sql).toContain('if v_rows <> 222');
    expect(sql).toContain('or v_permissions <> 37');
  });

  it('mantém índices nas FKs e updated_at automático', () => {
    expect(sql).toContain('idx_automations_organization_id');
    expect(sql).toContain('idx_automation_steps_automation_id');
    expect(sql).toContain('idx_automation_step_edges_automation_id');
    expect(sql).toContain('idx_message_templates_organization_id');
    expect(sql).toContain('public.update_updated_at_column()');
  });
});
