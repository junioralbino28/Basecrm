import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULTS_VERSION = 3;
const EXPECTED_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
];
const START_MARKER = '-- C2A_ROLE_PERMISSION_DEFAULTS_V3:START';
const END_MARKER = '-- C2A_ROLE_PERMISSION_DEFAULTS_V3:END';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260722000000_c2a_permission_defaults_v3.sql',
);
const FROZEN_SNAPSHOTS = [
  {
    version: 1,
    permissionCount: 37,
    startMarker: '-- E2_ROLE_PERMISSION_DEFAULTS:START',
    endMarker: '-- E2_ROLE_PERMISSION_DEFAULTS:END',
    path: resolve(
      process.cwd(),
      'supabase/migrations/20260718000000_funil_f1_authoring.sql',
    ),
    allowedValueDrift: new Set([
      'clinic_staff:automation.operate',
      'vendedor:automation.operate',
    ]),
  },
  {
    version: 2,
    permissionCount: 37,
    startMarker: '-- E3_ROLE_PERMISSION_DEFAULTS_V2:START',
    endMarker: '-- E3_ROLE_PERMISSION_DEFAULTS_V2:END',
    path: resolve(
      process.cwd(),
      'supabase/migrations/20260720020000_e3_role_defaults_v2.sql',
    ),
    allowedValueDrift: new Set(),
  },
];

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

function validateFrozenSnapshot({
  sql,
  appPermissions,
  rolePermissionDefaults,
  snapshot,
}) {
  const tuples = parseSnapshotTuples(
    snapshotBody(
      sql,
      snapshot.startMarker,
      snapshot.endMarker,
      snapshot.path,
    ),
    snapshot.version,
  );
  const expectedCount = EXPECTED_ROLES.length * snapshot.permissionCount;
  if (tuples.length !== expectedCount) {
    throw new Error(
      `Snapshot v${snapshot.version} congelado incompleto: ${tuples.length}/${expectedCount}`,
    );
  }

  const knownPermissions = new Set(appPermissions);
  const seen = new Set();
  const actualChanges = new Set();
  for (const tuple of tuples) {
    const key = `${tuple.role}:${tuple.permissionKey}`;
    if (seen.has(key)) throw new Error(`Tupla v1 duplicada: ${key}`);
    seen.add(key);

    if (!knownPermissions.has(tuple.permissionKey)) {
      throw new Error(`Permissão congelada não existe mais no catálogo: ${key}`);
    }
    const current = rolePermissionDefaults[tuple.role]?.[tuple.permissionKey];
    if (typeof current !== 'boolean') throw new Error(`Default atual ausente: ${key}`);
    if (current !== tuple.enabled) actualChanges.add(key);
  }

  if (
    actualChanges.size !== snapshot.allowedValueDrift.size
    || [...snapshot.allowedValueDrift].some((key) => !actualChanges.has(key))
  ) {
    throw new Error(
      `Drift inesperado no snapshot v${snapshot.version}: ${[...actualChanges].sort().join(', ')}`,
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
  for (const snapshot of FROZEN_SNAPSHOTS) {
    if (!existsSync(snapshot.path)) {
      throw new Error(`Migration v${snapshot.version} não encontrada: ${snapshot.path}`);
    }
  }

  const permissions = await loadPermissionsModule();
  const snapshot = renderSnapshot({
    appPermissions: permissions.APP_PERMISSIONS,
    rolePermissionDefaults: permissions.ROLE_PERMISSION_DEFAULTS,
    getDefaultPermissionMap: permissions.getDefaultPermissionMap,
  });
  for (const snapshot of FROZEN_SNAPSHOTS) {
    validateFrozenSnapshot({
      sql: readFileSync(snapshot.path, 'utf8'),
      appPermissions: permissions.APP_PERMISSIONS,
      rolePermissionDefaults: permissions.ROLE_PERMISSION_DEFAULTS,
      snapshot,
    });
  }
  const currentSql = readFileSync(MIGRATION_PATH, 'utf8');
  const expectedSql = replaceSnapshot(currentSql, snapshot);

  if (mode === '--check') {
    if (currentSql !== expectedSql) {
      throw new Error(
        'Snapshot SQL desatualizado. Rode npm run e2:permissions:snapshot:write e revise o diff.',
      );
    }
    process.stdout.write('Snapshots v1/v2 congelados e v3 ativo validados.\n');
    return;
  }

  writeFileSync(MIGRATION_PATH, expectedSql, 'utf8');
  process.stdout.write(`Snapshot C2A v3 atualizado em ${MIGRATION_PATH}.\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
