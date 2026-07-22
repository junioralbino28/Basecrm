// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_PERMISSIONS,
  getDefaultPermissionMap,
} from '@/lib/auth/permissions';

const V1_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260718000000_funil_f1_authoring.sql',
);
const V2_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260720020000_e3_role_defaults_v2.sql',
);
const V3_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260722000000_c2a_permission_defaults_v3.sql',
);
const ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
] as const;
const NEW_PERMISSIONS = [
  'tags.assign',
  'tags.manage',
  'lead_sources.assign',
  'lead_sources.manage',
] as const;

function tupleCount(sql: string, version: number): number {
  return [...sql.matchAll(
    new RegExp(`\\(${version}, '[^']+', '[^']+', (?:true|false)\\)`, 'g'),
  )].length;
}

describe('C2A — defaults de permissões v3', () => {
  it('adiciona as quatro permissões próprias ao catálogo', () => {
    expect(APP_PERMISSIONS).toHaveLength(41);
    expect(APP_PERMISSIONS).toEqual(expect.arrayContaining(NEW_PERMISSIONS));
  });

  it('agência e admins gerenciam; operação apenas atribui', () => {
    for (const role of ['agency_admin', 'agency_staff', 'clinic_admin', 'admin']) {
      const permissions = getDefaultPermissionMap(role);
      for (const key of NEW_PERMISSIONS) expect(permissions[key]).toBe(true);
    }

    for (const role of ['clinic_staff', 'vendedor']) {
      const permissions = getDefaultPermissionMap(role);
      expect(permissions['tags.assign']).toBe(true);
      expect(permissions['lead_sources.assign']).toBe(true);
      expect(permissions['tags.manage']).toBe(false);
      expect(permissions['lead_sources.manage']).toBe(false);
    }
  });

  it('preserva v1/v2 com 222 linhas e materializa v3 completa com 246', () => {
    expect(existsSync(V3_PATH), 'migration v3').toBe(true);
    const v1 = readFileSync(V1_PATH, 'utf8');
    const v2 = readFileSync(V2_PATH, 'utf8');
    const v3 = readFileSync(V3_PATH, 'utf8');

    expect(tupleCount(v1, 1)).toBe(222);
    expect(tupleCount(v2, 2)).toBe(222);
    expect(tupleCount(v3, 3)).toBe(ROLES.length * APP_PERMISSIONS.length);
    for (const key of NEW_PERMISSIONS) {
      expect(v1).not.toContain(`'${key}'`);
      expect(v2).not.toContain(`'${key}'`);
      expect(v3).toContain(`'${key}'`);
    }
  });

  it('ativa a v3 atomicamente e valida os três snapshots', () => {
    const sql = readFileSync(V3_PATH, 'utf8');
    expect(sql).toContain('set active_version = 3');
    expect(sql).toContain('v_v1_rows <> 222');
    expect(sql).toContain('v_v2_rows <> 222');
    expect(sql).toContain('v_v3_rows <> 246');
    expect(sql).toContain('v_active_version <> 3');
  });
});
