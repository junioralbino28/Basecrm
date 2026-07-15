import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULTS_VERSION = 1;
const EXPECTED_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
];
const START_MARKER = '-- E2_ROLE_PERMISSION_DEFAULTS:START';
const END_MARKER = '-- E2_ROLE_PERMISSION_DEFAULTS:END';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260635000000_e2_server_permission_enforcement.sql',
);

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function renderSnapshot({
  appPermissions,
  rolePermissionDefaults,
  getDefaultPermissionMap,
}) {
  const actualRoles = Object.keys(rolePermissionDefaults).sort();
  const expectedRoles = [...EXPECTED_ROLES].sort();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)) {
    throw new Error(
      `Cargos inesperados em ROLE_PERMISSION_DEFAULTS: ${actualRoles.join(', ')}`,
    );
  }

  const tuples = [];
  for (const role of EXPECTED_ROLES) {
    const resolved = getDefaultPermissionMap(role);
    for (const permissionKey of appPermissions) {
      const sourceValue = rolePermissionDefaults[role]?.[permissionKey];
      if (typeof sourceValue !== 'boolean') {
        throw new Error(`Default ausente: ${role} × ${permissionKey}`);
      }
      if (resolved[permissionKey] !== sourceValue) {
        throw new Error(`ROLE_PERMISSION_DEFAULTS diverge de getDefaultPermissionMap: ${role} × ${permissionKey}`);
      }
      tuples.push(
        `  (${DEFAULTS_VERSION}, ${sqlString(role)}, ${sqlString(permissionKey)}, ${sourceValue})`,
      );
    }
  }

  return [
    START_MARKER,
    '-- Gerado por scripts/generate-e2-role-permission-defaults.mjs.',
    '-- Fonte: ROLE_PERMISSION_DEFAULTS + getDefaultPermissionMap em lib/auth/permissions.ts.',
    'insert into public.role_permission_defaults (defaults_version, role, permission_key, enabled)',
    'values',
    `${tuples.join(',\n')}`,
    'on conflict (role, permission_key) do update',
    'set defaults_version = excluded.defaults_version,',
    '    enabled = excluded.enabled;',
    END_MARKER,
  ].join('\n');
}

function replaceSnapshot(sql, snapshot) {
  const start = sql.indexOf(START_MARKER);
  const end = sql.indexOf(END_MARKER);
  if (start < 0 || end < start) {
    throw new Error(`Marcadores do snapshot não encontrados em ${MIGRATION_PATH}`);
  }
  return `${sql.slice(0, start)}${snapshot}${sql.slice(end + END_MARKER.length)}`;
}

async function loadPermissionsModule() {
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });

  try {
    // Importa diretamente os exports já existentes; não cria manifesto paralelo.
    return await vite.ssrLoadModule('/lib/auth/permissions.ts');
  } finally {
    await vite.close();
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('Uso: node scripts/generate-e2-role-permission-defaults.mjs --check|--write');
  }
  if (!existsSync(MIGRATION_PATH)) {
    throw new Error(`Migration não encontrada: ${MIGRATION_PATH}`);
  }

  const permissions = await loadPermissionsModule();
  const snapshot = renderSnapshot({
    appPermissions: permissions.APP_PERMISSIONS,
    rolePermissionDefaults: permissions.ROLE_PERMISSION_DEFAULTS,
    getDefaultPermissionMap: permissions.getDefaultPermissionMap,
  });
  const currentSql = readFileSync(MIGRATION_PATH, 'utf8');
  const expectedSql = replaceSnapshot(currentSql, snapshot);

  if (mode === '--check') {
    if (currentSql !== expectedSql) {
      throw new Error(
        'Snapshot SQL desatualizado. Rode npm run e2:permissions:snapshot:write e revise o diff.',
      );
    }
    process.stdout.write('Snapshot E2 v1 sincronizado com permissions.ts.\n');
    return;
  }

  writeFileSync(MIGRATION_PATH, expectedSql, 'utf8');
  process.stdout.write(`Snapshot E2 v1 atualizado em ${MIGRATION_PATH}.\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
