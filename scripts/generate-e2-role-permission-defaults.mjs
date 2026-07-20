import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULTS_VERSION = 2;
const EXPECTED_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
];
const START_MARKER = '-- E3_ROLE_PERMISSION_DEFAULTS_V2:START';
const END_MARKER = '-- E3_ROLE_PERMISSION_DEFAULTS_V2:END';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260720020000_e3_role_defaults_v2.sql',
);
const LEGACY_START_MARKER = '-- E2_ROLE_PERMISSION_DEFAULTS:START';
const LEGACY_END_MARKER = '-- E2_ROLE_PERMISSION_DEFAULTS:END';
const LEGACY_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260718000000_funil_f1_authoring.sql',
);
const EXPECTED_V2_CHANGES = new Set([
  'clinic_staff:automation.operate',
  'vendedor:automation.operate',
]);

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
    'on conflict (defaults_version, role, permission_key) do update',
    'set enabled = excluded.enabled;',
    END_MARKER,
  ].join('\n');
}

function snapshotBody(sql, startMarker, endMarker, path) {
  const start = sql.indexOf(startMarker);
  const end = sql.indexOf(endMarker);
  if (start < 0 || end < start) {
    throw new Error(`Marcadores do snapshot não encontrados em ${path}`);
  }
  return sql.slice(start + startMarker.length, end);
}

function parseSnapshotTuples(body, version) {
  return [...body.matchAll(
    new RegExp(`\\(${version}, '([^']+)', '([^']+)', (true|false)\\)`, 'g'),
  )].map((match) => ({
    role: match[1],
    permissionKey: match[2],
    enabled: match[3] === 'true',
  }));
}

function validateLegacySnapshot({
  sql,
  appPermissions,
  rolePermissionDefaults,
}) {
  const tuples = parseSnapshotTuples(
    snapshotBody(
      sql,
      LEGACY_START_MARKER,
      LEGACY_END_MARKER,
      LEGACY_MIGRATION_PATH,
    ),
    1,
  );
  const expectedCount = EXPECTED_ROLES.length * appPermissions.length;
  if (tuples.length !== expectedCount) {
    throw new Error(`Snapshot v1 congelado incompleto: ${tuples.length}/${expectedCount}`);
  }

  const seen = new Set();
  const actualChanges = new Set();
  for (const tuple of tuples) {
    const key = `${tuple.role}:${tuple.permissionKey}`;
    if (seen.has(key)) throw new Error(`Tupla v1 duplicada: ${key}`);
    seen.add(key);

    const current = rolePermissionDefaults[tuple.role]?.[tuple.permissionKey];
    if (typeof current !== 'boolean') throw new Error(`Default atual ausente: ${key}`);
    if (current !== tuple.enabled) actualChanges.add(key);
  }

  if (
    actualChanges.size !== EXPECTED_V2_CHANGES.size
    || [...EXPECTED_V2_CHANGES].some((key) => !actualChanges.has(key))
  ) {
    throw new Error(
      `Drift inesperado entre v1 congelado e v2: ${[...actualChanges].sort().join(', ')}`,
    );
  }
}

function replaceSnapshot(sql, snapshot) {
  const start = sql.indexOf(START_MARKER);
  const end = sql.indexOf(END_MARKER);
  if (start < 0 || end < start) {
    throw new Error(`Marcadores do snapshot não encontrados em ${MIGRATION_PATH}`);
  }
  const lineEnding = sql.includes('\r\n') ? '\r\n' : '\n';
  const snapshotWithMatchingLineEndings = snapshot.replace(/\n/g, lineEnding);
  return `${sql.slice(0, start)}${snapshotWithMatchingLineEndings}${sql.slice(end + END_MARKER.length)}`;
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
  if (!existsSync(LEGACY_MIGRATION_PATH)) {
    throw new Error(`Migration v1 não encontrada: ${LEGACY_MIGRATION_PATH}`);
  }

  const permissions = await loadPermissionsModule();
  const snapshot = renderSnapshot({
    appPermissions: permissions.APP_PERMISSIONS,
    rolePermissionDefaults: permissions.ROLE_PERMISSION_DEFAULTS,
    getDefaultPermissionMap: permissions.getDefaultPermissionMap,
  });
  const legacySql = readFileSync(LEGACY_MIGRATION_PATH, 'utf8');
  validateLegacySnapshot({
    sql: legacySql,
    appPermissions: permissions.APP_PERMISSIONS,
    rolePermissionDefaults: permissions.ROLE_PERMISSION_DEFAULTS,
  });
  const currentSql = readFileSync(MIGRATION_PATH, 'utf8');
  const expectedSql = replaceSnapshot(currentSql, snapshot);

  if (mode === '--check') {
    if (currentSql !== expectedSql) {
      throw new Error(
        'Snapshot SQL desatualizado. Rode npm run e2:permissions:snapshot:write e revise o diff.',
      );
    }
    process.stdout.write('Snapshots E2 v1 congelado e v2 ativo validados.\n');
    return;
  }

  writeFileSync(MIGRATION_PATH, expectedSql, 'utf8');
  process.stdout.write(`Snapshot E2 v2 atualizado em ${MIGRATION_PATH}.\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
