import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase/migrations/20260803040000_p3_atomic_team_writes.sql'), 'utf8');

describe('P3 — escritas transacionais da equipe', () => {
  it('sincroniza especialidades em uma única RPC protegida', () => {
    expect(sql).toContain('sync_professional_specialties');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('can_configure_organization');
    expect(sql).toContain('specialty_ids_invalidos');
  });

  it('impede referência cruzada entre organizações', () => {
    expect(sql).toContain('s.organization_id = p_organization_id');
    expect(sql).toContain('p.organization_id = p_organization_id');
  });

  it('oferece operações em massa atômicas', () => {
    expect(sql).toContain('set_specialty_products_batch');
    expect(sql).toContain('set_professional_product_overrides_batch');
  });
});
