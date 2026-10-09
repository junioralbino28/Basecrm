// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20261009120000_central_agentes_modelos.sql');
const VOLTA = resolve(process.cwd(), 'docs/features/central-de-agentes/volta-bloco-2.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

const FUNCOES = {
  create_ai_agent_blank: '(uuid, text, text)',
  create_ai_agent_from_template: '(uuid, text, uuid, integer, jsonb)',
  create_ai_agent_from_copy: '(uuid, text, uuid, uuid, integer)',
  save_ai_agent_template: '(uuid, integer, text, text, text)',
  create_ai_agent_template_from_agent: '(uuid, uuid, integer, text, text)',
  set_ai_agent_template_archived: '(uuid, boolean, integer)',
} as const;
const AUXILIARES = { central_agentes_lacunas: '(text)', central_agentes_marcadores: '(text)' } as const;
type Nome = keyof typeof FUNCOES | keyof typeof AUXILIARES;
const NOMES = Object.keys(FUNCOES) as (keyof typeof FUNCOES)[];

const cabecalho = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\(([\\s\\S]*?)as \\$\\$`))?.[1] ?? '';
const corpo = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1] ?? '';

describe('migration dos modelos da Central de Agentes (bloco 2)', () => {
  it('existe, e a volta também; sem barra invertida (o escape não sobreviveria à escrita)', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(existsSync(VOLTA)).toBe(true);
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
  it('o detector acha as oito funções (caso positivo)', () => {
    for (const n of [...NOMES, ...(Object.keys(AUXILIARES) as Nome[])]) expect(corpo(n).length, n).toBeGreaterThan(40);
  });
  it('cabeçalho: security definer e search_path vazio nas seis; as auxiliares são invoker', () => {
    for (const n of NOMES) {
      expect(cabecalho(n), n).toMatch(/security definer/);
      expect(cabecalho(n), n).toMatch(/set search_path = ''/);
    }
    for (const n of Object.keys(AUXILIARES) as Nome[]) expect(cabecalho(n), n).toMatch(/security invoker/);
  });
  it('papel conferido antes de qualquer tabela; autor de auth.uid(); nenhum parâmetro de autor nem de origem', () => {
    for (const n of NOMES) {
      const b = corpo(n);
      const papel = b.indexOf('if not public.is_agency_admin_role() then');
      const tabela = b.search(/public\.(ai_agent|organizations)/);
      expect(papel, n).toBeGreaterThan(-1);
      expect(tabela, n).toBeGreaterThan(papel);
      expect(b, n).toMatch(/auth\.uid\(\)/);
      expect(cabecalho(n), n).not.toMatch(/p_(published_by|author|autor|user|usuario|origin|origem)\b/);
    }
  });
  it('modelo e cópia não recebem texto: o banco monta (achado 1 da rodada 1)', () => {
    expect(cabecalho('create_ai_agent_from_template')).not.toMatch(/p_prompt/);
    expect(cabecalho('create_ai_agent_from_copy')).not.toMatch(/p_prompt/);
  });
  it('ordem do modelo: revisão conferida antes das chaves (rodada 2, ponto 2)', () => {
    const b = corpo('create_ai_agent_from_template');
    expect(b.indexOf("'modelo_mudou'")).toBeGreaterThan(-1);
    expect(b.indexOf("'modelo_mudou'")).toBeLessThan(b.indexOf("'lacuna_inexistente'"));
    expect(b.indexOf("'lacuna_ambigua'")).toBeLessThan(b.indexOf('replace(v_texto'));
    expect(b).toMatch(/for share/);
  });
  it('os três começos travam o cliente de destino; as duas cópias revalidam as variáveis (rodada 1 do PLAN)', () => {
    for (const n of ['create_ai_agent_blank', 'create_ai_agent_from_template', 'create_ai_agent_from_copy'] as const) {
      expect(corpo(n), n).toMatch(/from public\.organizations o where o\.id = p_organization_id and o\.deleted_at is null for share;/);
    }
    for (const n of ['create_ai_agent_from_copy', 'create_ai_agent_template_from_agent'] as const) {
      expect(corpo(n), n).toContain('public.central_agentes_variavel_desconhecida(v_prompt)');
    }
  });
  it('as lacunas do banco são ocorrências com repetição: nada de distinct nem group by', () => {
    expect(corpo('central_agentes_lacunas')).not.toMatch(/group by|distinct/i);
  });
  it('grants: as seis só para authenticated; as auxiliares sem execute', () => {
    for (const [n, assinatura] of Object.entries(FUNCOES)) {
      expect(sql, n).toContain(`revoke all on function public.${n}${assinatura} from public, anon, authenticated, service_role;`);
      expect(sql, n).toContain(`grant execute on function public.${n}${assinatura} to authenticated;`);
    }
    for (const [n, assinatura] of Object.entries(AUXILIARES)) {
      expect(sql, n).toContain(`revoke all on function public.${n}${assinatura} from public, anon, authenticated, service_role;`);
      expect(sql, n).not.toContain(`grant execute on function public.${n}`);
    }
  });
  it('tabela: RLS, policy só de leitura da agência, grants explícitos', () => {
    expect(sql).toContain('alter table public.ai_agent_templates enable row level security;');
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql).toMatch(/for select\s+to authenticated\s+using \(public\.is_agency_admin_role\(\)\)/);
    expect(sql).toContain('revoke all on table public.ai_agent_templates from anon, authenticated;');
    expect(sql).toContain('grant select on table public.ai_agent_templates to authenticated;');
    expect(sql).toContain('grant all on table public.ai_agent_templates to service_role;');
    expect(sql).toMatch(/origin jsonb not null,/);
  });
  it('não destrutiva: nada de drop, delete, truncate, update ou alter em tabela que já existe', () => {
    expect(semComentarios).not.toMatch(/\bdrop\b|\btruncate\b|delete from/i);
    const alteracoes = semComentarios.match(/alter table [a-z_.]+/gi) ?? [];
    expect(alteracoes).toEqual(['alter table public.ai_agent_templates']);
    const updates = semComentarios.match(/update public\.[a-z_]+/gi) ?? [];
    expect(new Set(updates)).toEqual(new Set(['update public.ai_agent_templates']));
  });
  it('a volta: begin, drop das oito funções e da tabela, delete do histórico, commit', () => {
    const v = readFileSync(VOLTA, 'utf8').replace(/--.*$/gm, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    expect(v[0]).toBe('begin;');
    expect(v.at(-1)).toBe('commit;');
    expect(v.filter((l) => l.startsWith('drop function if exists public.'))).toHaveLength(8);
    expect(v).toContain('drop table if exists public.ai_agent_templates;');
    expect(v).toContain("delete from supabase_migrations.schema_migrations where version = '20261009120000';");
    expect(v).toHaveLength(12);
  });
});
