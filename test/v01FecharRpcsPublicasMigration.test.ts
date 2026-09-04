import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável: o cabeçalho explica o mecanismo do buraco e cita
// "GRANT ... anon" e "SECURITY DEFINER" em prosa, o que confundiria as asserções.
const migration = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260904000000_v01_fechar_rpcs_publicas.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

describe('V-01 — RPCs de negócio e de rate limit fechadas ao role público', () => {
  it('revoga PUBLIC e anon das três RPCs de negócio e concede só a authenticated/service_role', () => {
    const sql = migration();

    expect(sql).toContain('REVOKE ALL ON FUNCTION public.mark_deal_won(uuid) FROM PUBLIC, anon;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.mark_deal_lost(uuid, text) FROM PUBLIC, anon;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.reopen_deal(uuid) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mark_deal_won(uuid) TO authenticated, service_role;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.mark_deal_lost(uuid, text) TO authenticated, service_role;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.reopen_deal(uuid) TO authenticated, service_role;');
    // Nenhum grant pode voltar a alcançar o role público.
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/i);
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\bPUBLIC\b/i);
  });

  it('cada RPC de negócio exige o mesmo gate da policy de deals antes de escrever', () => {
    const sql = migration();
    const gate = /IF NOT coalesce\(public\.can_operate_deal\(deal_id\), false\) THEN\s+RAISE EXCEPTION USING ERRCODE = '42501'/g;

    // Uma ocorrência por função: mark_deal_won, mark_deal_lost, reopen_deal.
    expect(sql.match(gate)).toHaveLength(3);
    // O gate precisa vir ANTES do UPDATE em cada corpo.
    for (const name of ['mark_deal_won', 'mark_deal_lost', 'reopen_deal']) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${name}(`));
      expect(body.indexOf('can_operate_deal'), name).toBeGreaterThan(-1);
      expect(body.indexOf('can_operate_deal'), name).toBeLessThan(body.indexOf('UPDATE public.deals'));
    }
  });

  it('cleanup_rate_limits fica restrita ao service_role', () => {
    const sql = migration();

    expect(sql).toContain('REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(integer) TO service_role;');
  });

  it('as quatro funções mantêm SECURITY DEFINER e passam a usar search_path vazio', () => {
    const sql = migration();

    expect(sql.match(/SECURITY DEFINER/g)).toHaveLength(4);
    expect(sql.match(/SET search_path = ''/g)).toHaveLength(4);
    expect(sql).not.toMatch(/search_path\s*(=|TO)\s*'?public/i);
  });
});
