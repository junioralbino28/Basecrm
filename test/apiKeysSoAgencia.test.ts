// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * INTEGRACOES SO AGENCIA (Junior, 27/09/2026, "1 tambem"): chave de API e MCP sao
 * operacao da agencia. A migration troca o gate de api_keys (policies + RPCs) de
 * can_configure_organization (aceitava clinic_admin) para is_agency_admin_role().
 *
 * As provas leem os CORPOS $$...$$ das funcoes, nao o arquivo inteiro — o comentario
 * da migration conta a historia do N7 e cita o gate antigo; um toContain no arquivo
 * inteiro validaria a si mesmo (aprendizado de 25/09).
 */

const NOVA = resolve(
  process.cwd(),
  'supabase/migrations/20260927000000_api_keys_so_agencia.sql',
);
const N7 = resolve(
  process.cwd(),
  'supabase/migrations/20260631000000_n7_api_key_role_fix.sql',
);

function corposDasFuncoes(sql: string): string[] {
  return [...sql.matchAll(/as \$\$([\s\S]*?)\$\$;/g)].map((m) => m[1]);
}

describe('api_keys so agencia — migration 20260927000000', () => {
  const sql = existsSync(NOVA) ? readFileSync(NOVA, 'utf8') : '';
  const corpos = corposDasFuncoes(sql);

  it('o detector de corpo funciona (caso positivo: o N7 acusa o gate antigo)', () => {
    const sqlN7 = readFileSync(N7, 'utf8');
    const corposN7 = corposDasFuncoes(sqlN7);
    expect(corposN7.length).toBe(2);
    for (const corpo of corposN7) {
      expect(corpo).toContain('public.can_configure_organization(org_id)');
    }
  });

  it('recria as duas RPCs com o gate da agencia e sem o gate antigo', () => {
    expect(existsSync(NOVA), 'migration api_keys').toBe(true);
    expect(sql).toContain('create or replace function public.create_api_key(p_name text)');
    expect(sql).toContain('create or replace function public.revoke_api_key(p_api_key_id uuid)');
    expect(corpos.length).toBe(2);
    for (const corpo of corpos) {
      expect(corpo).toContain('public.is_agency_admin_role()');
      expect(corpo).not.toContain('can_configure_organization');
    }
  });

  it('preserva o cabecalho de seguranca do N7/M6 nas duas funcoes', () => {
    const cabecalhos = sql.match(/security definer\s*\nset search_path = public, extensions/g) ?? [];
    expect(cabecalhos.length).toBe(2);
    expect(sql).not.toMatch(/security invoker/i);
  });

  it('revoke mantem a checagem de org byte a byte (nada de revogacao cross-org nova)', () => {
    expect(sql).toContain('if key_org <> org_id then');
  });

  it('policies novas gateiam por is_agency_admin_role e derrubam as por tenant', () => {
    expect(sql).toContain('drop policy if exists "api_keys_select_by_tenant_admin" on public.api_keys;');
    expect(sql).toContain('drop policy if exists "api_keys_mutate_by_tenant_admin" on public.api_keys;');
    expect(sql).toContain('create policy "api_keys_select_agencia"');
    expect(sql).toContain('create policy "api_keys_mutate_agencia"');
    expect(sql).toContain('with check (public.is_agency_admin_role());');
  });

  it('nao e destrutiva', () => {
    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql).not.toMatch(/\bdrop\s+function\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/update\s+public\.api_keys\s+set\s+revoked_at\s*=\s*now\(\)\s*where\s+true/i);
  });
});
