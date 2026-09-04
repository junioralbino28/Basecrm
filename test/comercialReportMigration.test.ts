import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Só o SQL executável (o cabeçalho explica a decisão em prosa).
const sql = () => readFileSync(join(
  process.cwd(), 'supabase', 'migrations',
  '20260904020000_comercial_por_mes_de_fechamento.sql',
), 'utf8')
  .split('\n')
  .filter((linha) => !linha.trimStart().startsWith('--'))
  .join('\n');

const bodyOf = (name: 'commercial_report_data' | 'get_commercial_report') => {
  const s = sql();
  const start = s.indexOf(`FUNCTION public.${name}(`);
  const other = name === 'commercial_report_data' ? 'get_commercial_report' : 'commercial_report_data';
  const next = s.indexOf(`FUNCTION public.${other}(`, start + 1);
  const end = next > start ? next : s.length;
  return s.slice(start, end);
};

describe('Comercial por mês de fechamento (decisão de 04/09)', () => {
  it('a conta enquadra pelo closed_at, não pela criação — e a entrada é um bloco separado', () => {
    const body = bodyOf('commercial_report_data');

    expect(body).toContain("'regime', 'fechamento'");
    expect(body).toContain('d.closed_at >= p_start AND d.closed_at <= p_end');
    expect(body).toContain("'entrada', json_build_object(");
    expect(body).toContain('d.created_at >= p_start AND d.created_at <= p_end');
    expect(body).toContain("'taxa_fechamento'");
    expect(body).toContain("'ticket_medio'");
    expect(body).toContain("'ciclo_medio_dias'");
  });

  it('origem = primeiro toque; campanha = último toque por observed_at', () => {
    const body = bodyOf('commercial_report_data');

    expect(body).toContain('ls.id = f.first_lead_source_id');
    expect(body).not.toContain('last_lead_source_id');
    expect(body).toContain('DISTINCT ON (a.deal_id)');
    expect(body).toContain('ORDER BY a.deal_id, a.observed_at DESC, a.recorded_at DESC');
    expect(body).toContain("coalesce(ls.name, 'Sem origem')");
    expect(body).toContain("coalesce(cu.campanha, 'Sem campanha')");
  });

  it('helper interno fechado ao cliente; RPC gateada com reports.view e cabeçalho de segurança', () => {
    const helper = bodyOf('commercial_report_data');
    expect(helper).toContain('SECURITY INVOKER');
    expect(helper).toContain("SET search_path = ''");

    const rpc = bodyOf('get_commercial_report');
    expect(rpc).toContain('SECURITY DEFINER');
    expect(rpc).toContain("SET search_path = ''");
    expect(rpc).toContain('STABLE');
    expect(rpc).toContain('public.can_access_organization(v_org)');
    expect(rpc).toContain("public.has_permission('reports.view')");
    expect(rpc).not.toContain('can_configure_organization');
    expect(rpc).toContain("ERRCODE = '42501'");
    expect(rpc).toContain('RETURN public.commercial_report_data(v_org, p_start, p_end)');

    const s = sql();
    expect(s).toContain('REVOKE ALL ON FUNCTION public.commercial_report_data(uuid, timestamptz, timestamptz)\n  FROM PUBLIC, anon, authenticated;');
    expect(s).toContain('GRANT EXECUTE ON FUNCTION public.commercial_report_data(uuid, timestamptz, timestamptz)\n  TO service_role;');
    expect(s).toContain('REVOKE ALL ON FUNCTION public.get_commercial_report(timestamptz, timestamptz, uuid)\n  FROM PUBLIC, anon;');
    expect(s).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/i);
  });
});
