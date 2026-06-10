// @vitest-environment node
//
// SSOT da migração de RPCs de relatórios financeiros (F8).
//
// Mirror de lib/query/__tests__/cache-integrity.test.ts (fs + regex sobre o
// SQL): trava por texto que a migração existe, cria os 3 RPCs e que CADA um
// carrega as blindagens que o advisor do Supabase cobrou nas funções legadas:
//   (a) `set search_path = ''` (referências schema-qualificadas);
//   (b) validação INTERNA de acesso à org (can_configure_organization —
//       agregado financeiro é dado do Adel, clinic_staff não obtém);
//   (c) revoke de anon/public + grant só para authenticated.
//
// GOTCHA CRÍTICO: SECURITY DEFINER fura RLS. Cada RPC DEVE filtrar
// organization_id resolvido via current_profile_organization_id() (ou org
// explícita validada por can_configure_organization), senão vaza
// faturamento/comissão entre clínicas.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260621000000_finance_reports_rpcs.sql'
);

describe('migração de RPCs de relatórios financeiros', () => {
  const sql = readFileSync(migrationPath, 'utf-8');

  const RPCS = [
    'get_revenue_report',
    'get_commission_report',
    'get_net_result',
  ] as const;

  /** Corpo SQL de um RPC (do CREATE dele até o CREATE do próximo). */
  function bodyOf(rpc: (typeof RPCS)[number]): string {
    const start = sql.indexOf(`create or replace function public.${rpc}(`);
    expect(start, `${rpc} deve existir na migração`).toBeGreaterThanOrEqual(0);
    const next = RPCS.map((r) => sql.indexOf(`create or replace function public.${r}(`))
      .filter((idx) => idx > start)
      .sort((a, b) => a - b)[0];
    return sql.slice(start, next === undefined ? sql.length : next);
  }

  it('cria os três RPCs de relatório', () => {
    for (const rpc of RPCS) {
      expect(sql).toContain(`create or replace function public.${rpc}(`);
    }
  });

  it('cada RPC é security definer stable', () => {
    expect((sql.match(/security definer/gi) || []).length).toBeGreaterThanOrEqual(3);
    expect((sql.match(/\bstable\b/gi) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('BLINDAGEM (a): cada RPC fixa search_path vazio (referências schema-qualificadas)', () => {
    for (const rpc of RPCS) {
      expect(
        /set\s+search_path\s*=\s*''/i.test(bodyOf(rpc)),
        `${rpc} deve declarar set search_path = ''`
      ).toBe(true);
    }
  });

  it('BLINDAGEM (b): cada RPC valida can_configure_organization DENTRO da função (agregado financeiro = só admin)', () => {
    for (const rpc of RPCS) {
      expect(
        bodyOf(rpc).includes('public.can_configure_organization('),
        `${rpc} deve validar can_configure_organization no corpo`
      ).toBe(true);
    }
  });

  it('BLINDAGEM (c): revoga execução de public/anon e concede só a authenticated', () => {
    for (const rpc of RPCS) {
      expect(sql).toContain(`grant execute on function public.${rpc}(`);
    }
    const revokesAnon = (sql.match(/revoke[^;]+from\s+anon/gi) || []).length;
    const revokesPublic = (sql.match(/revoke[^;]+from\s+public/gi) || []).length;
    expect(revokesAnon, 'cada RPC deve ter revoke ... from anon').toBeGreaterThanOrEqual(3);
    expect(revokesPublic, 'cada RPC deve ter revoke ... from public').toBeGreaterThanOrEqual(3);
  });

  it('GOTCHA: cada RPC filtra organization_id por current_profile_organization_id (não vaza entre clínicas)', () => {
    const occurrences = (sql.match(/public\.current_profile_organization_id\(\)/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(RPCS.length);

    for (const rpc of RPCS) {
      expect(
        bodyOf(rpc).includes('current_profile_organization_id()'),
        `${rpc} deve resolver a org via public.current_profile_organization_id()`
      ).toBe(true);
    }
  });

  it('faturamento conta apenas atendimentos recebidos (recebido = true) e desconta o desconto', () => {
    expect(sql).toContain('recebido');
    // total real recebido = valor − desconto (o líquido NÃO é persistido — lição F4)
    expect(sql).toContain('a.valor - a.desconto');
  });

  it('fronteira de dia/mês no fuso da clínica: agregações convertem paid_at para America/Sao_Paulo', () => {
    // um pagamento 23h de terça NÃO pode cair na quarta (consideração do review F4)
    expect(sql).toContain("at time zone 'America/Sao_Paulo'");
  });
});
