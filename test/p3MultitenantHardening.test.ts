import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260803000000_p3_multitenant_hardening.sql',
);

describe('Pacote 3 — integridade multitenant e menor privilégio', () => {
  it('impõe vínculos same-org em todas as relações financeiras novas', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('FOREIGN KEY (organization_id, professional_id)');
    expect(sql).toContain('FOREIGN KEY (organization_id, specialty_id)');
    expect(sql).toContain('FOREIGN KEY (organization_id, product_id)');
    expect(sql.match(/FOREIGN KEY \(organization_id, professional_id\)/g)).toHaveLength(2);
    expect(sql.match(/FOREIGN KEY \(organization_id, product_id\)/g)).toHaveLength(2);
  });

  it('remove privilégios implícitos de anon e PUBLIC antes dos grants mínimos', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/REVOKE ALL[\s\S]+FROM PUBLIC, anon/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.professional_has_specialty[\s\S]+FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]+TO authenticated/i);
  });

  it('valida constraints depois de criá-las sem bloquear a adição inicial', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql.match(/NOT VALID/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql.match(/VALIDATE CONSTRAINT/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
