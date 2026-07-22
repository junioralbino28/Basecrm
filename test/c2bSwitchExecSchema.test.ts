// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260722060000_c2b_switch_exec_v3.sql',
);

describe('C2B — contrato SQL do switch por UUID', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

  it('avalia etiquetas v3 pelas atribuições ativas do tenant', () => {
    expect(sql).toContain("v_field = 'deal.tag_ids'");
    expect(sql).toContain('public.deal_tag_assignments');
    expect(sql).toContain('assignment.removed_at is null');
    expect(sql).toContain('tag.archived_at is null');
    expect(sql).toContain('assignment.organization_id = enrollment.organization_id');
  });

  it('mantém deal.tags apenas para snapshots v1/v2', () => {
    expect(sql).toContain("v_field = 'deal.tags' and v_schema_version >= 3");
    expect(sql).toContain("v_field = 'deal.tag_ids' and v_schema_version < 3");
    expect(sql).toContain("coalesce(v_context.deal_tags, '{}'::text[])");
  });

  it('mantém a função interna e fora dos clientes', () => {
    expect(sql).toMatch(
      /revoke all on function public\.evaluate_automation_switch\(uuid, uuid\)[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.evaluate_automation_switch\(uuid, uuid\)\s+to service_role/,
    );
  });
});
