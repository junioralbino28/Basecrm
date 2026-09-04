import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260904010000_r08_financeiro_caixa_e_equipe_competencia.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

const RPCS = ['get_commission_report', 'get_net_result'] as const;

/** Corpo do CREATE de uma RPC até o CREATE seguinte (ou o fim do arquivo). */
const bodyOf = (name: (typeof RPCS)[number]) => {
  const s = sql();
  const start = s.indexOf(`FUNCTION public.${name}(`);
  const next = RPCS
    .filter((other) => other !== name)
    .map((other) => s.indexOf(`FUNCTION public.${other}(`))
    .filter((index) => index > start);
  const end = next.length ? Math.min(...next) : s.length;
  return s.slice(start, end);
};

describe('R-01/R-08 — Financeiro por caixa, Profissionais por competência (decisão de 04/09)', () => {
  it('R-01: o bloco sem_profissional conta por performed_at, sem exigir recebimento', () => {
    const body = bodyOf('get_commission_report');
    const bloco = body.slice(body.indexOf("'sem_profissional'"));

    expect(bloco).toContain('sp.performed_at >= p_start AND sp.performed_at <= p_end');
    expect(bloco).not.toContain('sp.recebido');
    expect(bloco).not.toContain('sp.paid_at');
    // As linhas por colaborador continuam por competência.
    expect(body).toContain('AND a.performed_at >= p_start');
  });

  it('R-08: get_net_result é caixa puro — pago à equipe pela data do pagamento, sem comissão devida', () => {
    const body = bodyOf('get_net_result');

    expect(body).toContain("'regime', 'caixa'");
    expect(body).toContain("'remuneracao_paga', v_remuneracao_paga");
    expect(body).toContain('FROM public.commission_payments cp');
    expect(body).toContain('cp.paid_at >= p_start AND cp.paid_at <= p_end');
    expect(body).toContain("'liquido', v_faturamento - v_taxas - v_remuneracao_paga - v_contas");
    // Nada de competência dentro do caixa.
    expect(body).not.toContain('commission_amount');
    expect(body).not.toContain('fixed_compensation_for_period');
    expect(body).not.toContain("'comissoes'");
    expect(body).not.toContain("'salarios_fixos'");
    // Receita e taxas continuam pela data do pagamento.
    expect(body).toContain('a.recebido = true');
    expect(body).toContain('a.paid_at >= p_start AND a.paid_at <= p_end');
  });

  it('preserva os cabeçalhos de segurança das duas RPCs e não reabre o role público', () => {
    const permissions = {
      get_commission_report: 'reports.professionals',
      get_net_result: 'reports.finance',
    } as const;
    for (const name of RPCS) {
      const body = bodyOf(name);
      expect(body, name).toContain('SECURITY DEFINER');
      expect(body, name).toContain("SET search_path = ''");
      expect(body, name).toContain('STABLE');
      expect(body, name).toContain('public.can_access_organization(v_org)');
      expect(body, name).toContain(`public.has_permission('${permissions[name]}')`);
      expect(body, name).not.toContain('can_configure_organization');
      expect(body, name).toContain("ERRCODE = '42501'");
    }
    expect(sql()).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/i);
    expect(sql()).toContain('REVOKE ALL ON FUNCTION public.get_net_result(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;');
  });
});
