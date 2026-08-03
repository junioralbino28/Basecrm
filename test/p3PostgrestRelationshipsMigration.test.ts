import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const sql = fs.readFileSync(
  'supabase/migrations/20260803050000_p3_postgrest_relationship_disambiguation.sql',
  'utf8',
);

describe('P3 — relacionamentos PostgREST sem ambiguidade', () => {
  it.each([
    'professional_specialties_professional_id_fkey',
    'professional_specialties_specialty_id_fkey',
    'specialty_products_specialty_id_fkey',
    'specialty_products_product_id_fkey',
    'professional_product_overrides_professional_id_fkey',
    'professional_product_overrides_product_id_fkey',
  ])('remove a FK simples redundante %s', (constraint) => {
    expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${constraint}`);
  });

  it('mantém o cache de relacionamentos sincronizado', () => {
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
