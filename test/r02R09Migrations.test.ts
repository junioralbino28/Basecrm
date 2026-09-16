// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = path.join(process.cwd(), 'supabase', 'migrations');
const ler = (arquivo: string) => readFileSync(path.join(raiz, arquivo), 'utf8');
const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .filter((linha) => !linha.trimStart().startsWith('--'))
    .join('\n');

describe('R-02 — regra legada de comissão respeita o produto', () => {
  const sql = semComentarios(ler('20260916000000_r02_regra_legada_respeita_produto.sql'));

  it('recria o resolvedor com o mesmo cabeçalho de segurança da versão vigente', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.resolve_commission_amount(');
    expect(sql).toContain('STABLE');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("public.professional_pay_type_at(");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_commission_amount[\s\S]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_commission_amount[\s\S]+TO service_role/);
  });

  it('o ramo legado passa a exigir que o procedimento pertença à especialidade', () => {
    const ramoLegado = sql.slice(sql.indexOf('c.specialty_id IS NULL\n        AND c.specialty IS NOT NULL'));
    expect(ramoLegado).toContain('public.professional_has_specialty(p_professional_id, c.specialty)');
    expect(ramoLegado).toContain('public.specialty_products sp');
    expect(ramoLegado).toContain('lower(btrim(s.name)) = lower(btrim(c.specialty))');
    expect(ramoLegado).toContain('sp.product_id = p_product_id');
  });

  it('mantém a precedência e o gate de remuneração fixa', () => {
    expect(sql).toContain("= 'fixed' THEN");
    expect(sql).toContain('(c.professional_id IS NOT NULL) DESC');
    expect(sql).toContain('(c.specialty_id IS NOT NULL) DESC');
  });

  it('não é destrutiva: sem DROP, TRUNCATE ou DELETE', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

describe('R-09 — anon e authenticated perdem o TRUNCATE', () => {
  const sql = semComentarios(ler('20260916010000_r09_tirar_truncate_de_anon_e_authenticated.sql'));

  it('revoga TRUNCATE de todas as tabelas de public para os dois papéis', () => {
    expect(sql).toContain("REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated");
    expect(sql).toContain("ns.nspname = 'public'");
    expect(sql).toContain("c.relkind IN ('r', 'p')");
  });

  it('fecha também a tabela que ainda vai nascer', () => {
    expect(sql).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated');
  });

  it('mexe só no TRUNCATE: não revoga escrita do app nem apaga nada', () => {
    expect(sql).not.toMatch(/REVOKE\s+(INSERT|UPDATE|DELETE|ALL)/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
