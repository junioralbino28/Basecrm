// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Renomear e excluir agente (SPEC-renomear-excluir.md, v2.1): o contrato do arquivo da migration, lido como texto.
 * O comportamento é provado no teste local; aqui fica o que não pode mudar sem a SPEC mudar junto.
 */
const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20261009180000_central_agentes_renomear_excluir.sql');
const VOLTA = resolve(process.cwd(), 'docs/features/central-de-agentes/volta-renomear-excluir.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const volta = existsSync(VOLTA) ? readFileSync(VOLTA, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

const FUNCOES = {
  rename_ai_agent: '(uuid, uuid, text)',
  delete_ai_agent: '(uuid, uuid, text, integer, uuid)',
} as const;
type Nome = keyof typeof FUNCOES;
const NOMES = Object.keys(FUNCOES) as Nome[];

const cabecalho = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\(([\\s\\S]*?)as \\$\\$`))?.[1] ?? '';
const corpo = (n: Nome) =>
  semComentarios.match(new RegExp(`create or replace function public\\.${n}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1] ?? '';

describe('migration de renomear e excluir agente', () => {
  it('existe, e a volta também; sem barra invertida nos dois (o escape não sobreviveria à escrita)', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(existsSync(VOLTA)).toBe(true);
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
    expect(volta.includes(String.fromCharCode(92))).toBe(false);
  });

  it('o detector acha as duas funções (caso positivo)', () => {
    for (const n of NOMES) expect(corpo(n).length, n).toBeGreaterThan(40);
  });

  it('cabeçalho: security definer e search_path vazio; papel conferido antes de qualquer tabela', () => {
    for (const n of NOMES) {
      expect(cabecalho(n), n).toMatch(/security definer/);
      expect(cabecalho(n), n).toMatch(/set search_path = ''/);
      const b = corpo(n);
      const papel = b.indexOf('if not public.is_agency_admin_role() then');
      const tabela = b.search(/public\.(ai_agent|organizations|channel_connections)/);
      expect(papel, n).toBeGreaterThan(-1);
      expect(tabela, n).toBeGreaterThan(papel);
      expect(cabecalho(n), n).not.toMatch(/p_(deleted_by|author|autor|user|usuario)\b/);
    }
  });

  it('execução só para authenticated, nas assinaturas exatas', () => {
    for (const n of NOMES) {
      expect(semComentarios, n).toContain(`revoke all on function public.${n}${FUNCOES[n]} from public, anon, authenticated, service_role;`);
      expect(semComentarios, n).toContain(`grant execute on function public.${n}${FUNCOES[n]} to authenticated;`);
    }
  });

  it('registro das exclusões: RLS ligada, nenhuma policy, nenhum grant para anon nem authenticated', () => {
    expect(semComentarios).toMatch(/create table if not exists public\.ai_agent_deletions \(/);
    expect(semComentarios).toContain('alter table public.ai_agent_deletions enable row level security;');
    expect(semComentarios).toContain('revoke all on table public.ai_agent_deletions from anon, authenticated;');
    expect(semComentarios).not.toMatch(/create policy/);
    expect(semComentarios).not.toMatch(/grant [a-z, ]+ on table public\.ai_agent_deletions to (anon|authenticated)/);
    // deleted_by e agent_id sem FK: o registro sobrevive à remoção da pessoa e do agente.
    const tabela = semComentarios.match(/create table if not exists public\.ai_agent_deletions \(([\s\S]*?)\);/)?.[1] ?? '';
    expect(tabela).toMatch(/deleted_by uuid null,/);
    expect(tabela).toMatch(/agent_id uuid not null,/);
    expect(tabela).not.toMatch(/(deleted_by|agent_id)[^,]*references/);
  });

  it('excluir: trava o agente, compara os três esperados, conta os números, apaga e registra, nessa ordem', () => {
    const b = corpo('delete_ai_agent');
    const posicoes = [
      b.search(/from public\.ai_agents a[\s\S]*?for update;/),
      b.indexOf('v_nome is distinct from p_expected_name'),
      b.indexOf('v_revisao is distinct from p_expected_draft_revision'),
      b.indexOf('v_publicada is distinct from p_expected_published_version_id'),
      b.indexOf("raise exception 'agente_mudou'"),
      b.search(/from public\.channel_connections c/),
      b.indexOf("raise exception 'agente_com_numero' using errcode = 'P0001', detail"),
      b.search(/delete from public\.ai_agents a/),
      b.indexOf('insert into public.ai_agent_deletions'),
    ];
    for (const [i, p] of posicoes.entries()) expect(p, `passo ${i}`).toBeGreaterThan(-1);
    expect([...posicoes].sort((x, y) => x - y)).toEqual(posicoes);
    expect(b).toMatch(/auth\.uid\(\)\);/);
  });

  it('excluir: o exception só converte a FK do número; o resto sobe como veio', () => {
    const b = corpo('delete_ai_agent');
    const bloco = b.match(/exception when foreign_key_violation then([\s\S]*?)end;/)?.[1] ?? '';
    expect(bloco).toContain('get stacked diagnostics v_restricao = constraint_name;');
    expect(bloco).toContain("if v_restricao = 'channel_connections_ai_agent_fk' then");
    expect(bloco).toMatch(/end if;\s*raise;/);
    expect(b.match(/exception when/g)).toHaveLength(1);
  });

  it('aditiva: nenhum alter nem drop de tabela existente, nenhum delete ou update fora das funções', () => {
    const foraDasFuncoes = semComentarios.replace(/create or replace function[\s\S]*?\$\$;/g, '');
    expect(foraDasFuncoes).not.toMatch(/\bdrop\b/);
    // A única cláusula com "delete" fora das funções é a FK do registro com o cliente (prazo de vida, rodada 2, nota 2).
    expect(foraDasFuncoes.match(/on delete cascade/g) ?? []).toEqual(['on delete cascade']);
    expect(foraDasFuncoes.replace('on delete cascade', '')).not.toMatch(/\bdelete\b/);
    expect(foraDasFuncoes).not.toMatch(/\bupdate\b/);
    expect(foraDasFuncoes.match(/alter table/g) ?? []).toEqual(['alter table']);
    expect(foraDasFuncoes).toContain('alter table public.ai_agent_deletions enable row level security;');
  });

  it('volta: recusa com registro, derruba as duas funções e a tabela, e tira a versão do histórico', () => {
    expect(volta).toMatch(/if exists \(select 1 from public\.ai_agent_deletions\) then\s*raise exception/);
    for (const n of NOMES) expect(volta, n).toContain(`drop function public.${n}${FUNCOES[n]};`);
    expect(volta).toContain('drop table public.ai_agent_deletions;');
    expect(volta).toContain("delete from supabase_migrations.schema_migrations where version = '20261009180000';");
    expect(volta.indexOf('raise exception')).toBeLessThan(volta.indexOf('drop function'));
  });
});
