import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULTS_VERSION = 5;
const EXPECTED_ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
];
const START_MARKER = '-- PAREAMENTO_ROLE_PERMISSION_DEFAULTS_V5:START';
const END_MARKER = '-- PAREAMENTO_ROLE_PERMISSION_DEFAULTS_V5:END';
const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260926000000_permission_defaults_v5_pareamento.sql',
);
/**
 * Mudança intencional da C2B (Junior, 17/09/2026): `ai.configure` deixa de nascer ligada para
 * o admin do cliente — provedor, chave, modelo e prompt são da agência. Como os snapshots
 * congelados guardam o valor antigo, o desvio precisa ser declarado em cada um deles.
 */
const DESVIO_C2B_GOVERNANCA_IA = 'clinic_admin:ai.configure';
/**
 * Mudanca intencional do PAREAMENTO (Junior, 26/09/2026): `whatsapp.manage_connection` deixa
 * de nascer ligada para o admin do cliente — conexoes, IA por numero e webhook sao da agencia;
 * o cliente fica com `whatsapp.pair_devices` (QR + Google Agenda), criada na mesma decisao.
 */
const DESVIO_PAREAMENTO = 'clinic_admin:whatsapp.manage_connection';
/**
 * Mudanca intencional das INTEGRACOES (Junior, 27/09/2026, "1 tambem"): `settings.integrations`
 * (aba API/MCP/webhooks) deixa de nascer ligada para o admin do cliente — chave de API e MCP
 * viram operacao da agencia (migration 20260927000000 alinha as guardas de api_keys no banco).
 */
const DESVIO_INTEGRACOES = 'clinic_admin:settings.integrations';
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
      DESVIO_C2B_GOVERNANCA_IA,
      DESVIO_PAREAMENTO,
      DESVIO_INTEGRACOES,
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
    allowedValueDrift: new Set([DESVIO_C2B_GOVERNANCA_IA, DESVIO_PAREAMENTO, DESVIO_INTEGRACOES]),
  },
  {
    version: 3,
    permissionCount: 41,
    startMarker: '-- C2A_ROLE_PERMISSION_DEFAULTS_V3:START',
    endMarker: '-- C2A_ROLE_PERMISSION_DEFAULTS_V3:END',
    path: resolve(
      process.cwd(),
      'supabase/migrations/20260722000000_c2a_permission_defaults_v3.sql',
    ),
    allowedValueDrift: new Set([DESVIO_C2B_GOVERNANCA_IA, DESVIO_PAREAMENTO, DESVIO_INTEGRACOES]),
  },
  {
    version: 4,
    permissionCount: 42,
    startMarker: '-- C2B_ROLE_PERMISSION_DEFAULTS_V4:START',
    endMarker: '-- C2B_ROLE_PERMISSION_DEFAULTS_V4:END',
    path: resolve(
      process.cwd(),
      'supabase/migrations/20260917000000_c2b_permission_defaults_v4_governanca_ia.sql',
    ),
    // A v4 ja carrega a C2B (ai.configure desligada); desvios dela: pareamento e integracoes.
    allowedValueDrift: new Set([DESVIO_PAREAMENTO, DESVIO_INTEGRACOES]),
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
    process.stdout.write(`Snapshots v1-v${DEFAULTS_VERSION - 1} congelados e v${DEFAULTS_VERSION} ativo validados.\n`);
    return;
  }

  writeFileSync(MIGRATION_PATH, expectedSql, 'utf8');
  process.stdout.write(`Snapshot v${DEFAULTS_VERSION} atualizado em ${MIGRATION_PATH}.\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
