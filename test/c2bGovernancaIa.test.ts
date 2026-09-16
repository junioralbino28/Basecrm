// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_PERMISSIONS, getDefaultPermissionMap } from '@/lib/auth/permissions';

/**
 * C2B — governança do motor de IA (decisão do Junior, 17/09/2026).
 *
 * O que estava errado: `clinic_admin` nascia com `ai.configure`, a aba "Central de I.A"
 * aparecia para o cliente e a rota aceitava a escrita dele — três pessoas da clínica podiam
 * trocar o provedor, colar chave de API, escolher o modelo e editar o prompt da atendente.
 * A chave é da agência e o custo corre por ela; o prompt é o comportamento que ela vende.
 *
 * O que passa a valer: configurar é da agência; o cliente pode PAUSAR (`ai.pause`).
 */

const V4_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260917000000_c2b_permission_defaults_v4_governanca_ia.sql',
);
const ROTA_AI = resolve(process.cwd(), 'app/api/settings/ai/route.ts');
const ROTA_PROMPTS = resolve(process.cwd(), 'app/api/settings/ai-prompts/route.ts');
const ROTA_PROMPT_CHAVE = resolve(process.cwd(), 'app/api/settings/ai-prompts/[key]/route.ts');
const TELA_CENTRAL = resolve(process.cwd(), 'features/settings/AICenterSettings.tsx');
const TELA_CONFIG = resolve(process.cwd(), 'features/settings/components/AIConfigSection.tsx');

const ROLES = [
  'agency_admin',
  'agency_staff',
  'clinic_admin',
  'clinic_staff',
  'admin',
  'vendedor',
] as const;

function tupleCount(sql: string, version: number): number {
  return [...sql.matchAll(
    new RegExp(`\\(${version}, '[^']+', '[^']+', (?:true|false)\\)`, 'g'),
  )].length;
}

describe('C2B — quem configura o motor de IA', () => {
  it('o catálogo ganha `ai.pause` ao lado de `ai.configure`', () => {
    expect(APP_PERMISSIONS).toEqual(expect.arrayContaining(['ai.configure', 'ai.pause']));
  });

  it('o admin do cliente NÃO configura, mas PODE pausar', () => {
    const cliente = getDefaultPermissionMap('clinic_admin');
    expect(cliente['ai.configure']).toBe(false);
    expect(cliente['ai.pause']).toBe(true);
    // O resto do dia a dia dele continua intacto.
    expect(cliente['ai.use']).toBe(true);
    expect(cliente['settings.general']).toBe(true);
  });

  it('a agência continua configurando', () => {
    for (const role of ['agency_admin', 'agency_staff', 'admin']) {
      const agencia = getDefaultPermissionMap(role);
      expect(agencia['ai.configure']).toBe(true);
      expect(agencia['ai.pause']).toBe(true);
    }
  });

  it('a operação da clínica não configura nem pausa', () => {
    for (const role of ['clinic_staff', 'vendedor']) {
      const operacao = getDefaultPermissionMap(role);
      expect(operacao['ai.configure']).toBe(false);
      expect(operacao['ai.pause']).toBe(false);
      expect(operacao['ai.use']).toBe(true);
    }
  });
});

describe('C2B — migration v4', () => {
  const sql = existsSync(V4_PATH) ? readFileSync(V4_PATH, 'utf8') : '';

  it('materializa a v4 completa e ativa atomicamente', () => {
    expect(existsSync(V4_PATH), 'migration v4').toBe(true);
    expect(tupleCount(sql, 4)).toBe(ROLES.length * APP_PERMISSIONS.length);
    expect(sql).toContain('set active_version = 4');
    expect(sql).toContain('v_active_version <> 3'); // exige a v3 ativa antes
    expect(sql).toContain('v_v4_rows <> 252');
    expect(sql).toContain('v_v4_permissions <> 42');
  });

  it('preserva os snapshots antigos', () => {
    expect(sql).toContain('v_v1_rows <> 222');
    expect(sql).toContain('v_v2_rows <> 222');
    expect(sql).toContain('v_v3_rows <> 246');
  });

  it('carrega a prova da decisão dentro da própria migration', () => {
    expect(sql).toContain("and permission_key = 'ai.configure'");
    expect(sql).toContain("and permission_key = 'ai.pause'");
    expect(sql).toContain('clinic_admin continua com ai.configure na v4');
    expect(sql).toContain('clinic_admin ficou sem ai.pause na v4');
  });

  it('não é destrutiva', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

describe('C2B — travas no servidor e na tela', () => {
  it('a rota de configuração recusa quem não é da agência', () => {
    const sql = readFileSync(ROTA_AI, 'utf8');
    expect(sql).toContain('mexeNaConfiguracaoDoMotor');
    expect(sql).toMatch(/if \(mexeNaConfiguracaoDoMotor && !auth\.isAgencyAdmin\)/);
    expect(sql).toContain('const canManageSecrets = auth.isAgencyAdmin;');
  });

  it('as rotas de prompt recusam quem não é da agência', () => {
    for (const caminho of [ROTA_PROMPTS, ROTA_PROMPT_CHAVE]) {
      const conteudo = readFileSync(caminho, 'utf8');
      expect(conteudo).toMatch(/if \(!auth\.isAgencyAdmin\)/);
    }
  });

  it('a tela esconde provedor, chave e prompt do cliente', () => {
    const central = readFileSync(TELA_CENTRAL, 'utf8');
    expect(central).toContain('podeConfigurarMotor');
    expect(central).toContain('{podeConfigurarMotor && <AIConfigSection />}');
    expect(central).toContain('podeEditarPrompt={podeConfigurarMotor}');
  });
});

describe('Validação da chave Anthropic pelo navegador', () => {
  it('manda o cabeçalho sem o qual a Anthropic recusa por CORS', () => {
    const tela = readFileSync(TELA_CONFIG, 'utf8');
    // Medido em 17/09/2026: sem ele o preflight devolve 400 "Disallowed CORS origin" e a
    // tela acusa "chave inválida" numa chave boa; com ele, 200.
    expect(tela).toContain("'anthropic-dangerous-direct-browser-access': 'true'");
  });

  it('oferece a geração atual do Claude', () => {
    const tela = readFileSync(TELA_CONFIG, 'utf8');
    expect(tela).toContain("id: 'claude-sonnet-5'");
    expect(tela).toContain("id: 'claude-opus-5'");
  });
});
