// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_PERMISSIONS } from '@/lib/auth/permissions';

/**
 * PAREAMENTO (Junior, 26/09/2026): "as conexoes, configuracao de IA, webhook, ficam APENAS na
 * agencia... mas isso de OAuth da agenda e conectar whatsapp com QR code pode deixar" com o
 * admin do cliente. A v5 materializa isso no banco: clinic_admin perde
 * `whatsapp.manage_connection` e ganha `whatsapp.pair_devices`.
 */

const ROLES = ['agency_admin', 'agency_staff', 'clinic_admin', 'clinic_staff', 'admin', 'vendedor'];
const V5_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260926000000_permission_defaults_v5_pareamento.sql',
);

function tupleCount(sql: string, version: number) {
  return [...sql.matchAll(new RegExp(`\(${version}, '[^']+', '[^']+', (?:true|false)\)`, 'g'))].length;
}

describe('PAREAMENTO — migration v5', () => {
  const sql = existsSync(V5_PATH) ? readFileSync(V5_PATH, 'utf8') : '';

  it('materializa a v5 completa e ativa atomicamente', () => {
    expect(existsSync(V5_PATH), 'migration v5').toBe(true);
    expect(tupleCount(sql, 5)).toBe(ROLES.length * APP_PERMISSIONS.length);
    expect(sql).toContain('set active_version = 5');
    expect(sql).toContain('v_active_version <> 4'); // exige a v4 ativa antes
    expect(sql).toContain('v_v5_rows <> 258');
    expect(sql).toContain('v_v5_permissions <> 43');
  });

  it('preserva os snapshots antigos', () => {
    expect(sql).toContain('v_v1_rows <> 222');
    expect(sql).toContain('v_v2_rows <> 222');
    expect(sql).toContain('v_v3_rows <> 246');
    expect(sql).toContain('v_v4_rows <> 252');
  });

  it('carrega a prova da decisao dentro da propria migration', () => {
    expect(sql).toContain("and permission_key = 'whatsapp.manage_connection'");
    expect(sql).toContain("and permission_key = 'whatsapp.pair_devices'");
    expect(sql).toContain('clinic_admin deveria continuar com whatsapp.manage_connection na v4');
    expect(sql).toContain('clinic_admin ficou sem whatsapp.pair_devices na v5');
    expect(sql).toContain('clinic_staff nao deveria parear na v5');
  });

  it('as tuplas da v5 carregam a decisao de verdade, nao so a prova declarativa', () => {
    expect(sql).toContain("(5, 'clinic_admin', 'whatsapp.manage_connection', false)");
    expect(sql).toContain("(5, 'clinic_admin', 'whatsapp.pair_devices', true)");
    expect(sql).toContain("(5, 'clinic_staff', 'whatsapp.pair_devices', false)");
    expect(sql).toContain("(5, 'agency_admin', 'whatsapp.pair_devices', true)");
  });

  it('nao e destrutiva', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
