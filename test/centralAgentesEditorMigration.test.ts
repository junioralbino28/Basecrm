// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Central de Agentes, fatia 2 (SPEC docs/features/central-de-agentes/SPEC.md, "Fatia 2"). As provas leem o
 * CABEÇALHO e o CORPO $$...$$ de cada função; o teste local (centralAgentesEditor.local.test.ts) prova o
 * comportamento com chamada de verdade.
 */
const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20261007120000_central_agentes_editor.sql');
const VOLTA = resolve(process.cwd(), 'docs/features/central-de-agentes/volta-fatia-2.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

const FUNCOES = {
  save_ai_agent_draft: '(uuid, uuid, integer, text)',
  publish_ai_agent_version: '(uuid, uuid, integer, integer, text)',
  restore_ai_agent_version: '(uuid, uuid, integer, integer, integer, text)',
} as const;
type NomeDaFuncao = keyof typeof FUNCOES;
const NOMES = Object.keys(FUNCOES) as NomeDaFuncao[];

function cabecalho(nome: NomeDaFuncao): string {
  return semComentarios.match(new RegExp(`create or replace function public\\.${nome}\\(([\\s\\S]*?)as \\$\\$`))?.[1] ?? '';
}
function corpo(nome: NomeDaFuncao): string {
  return semComentarios.match(new RegExp(`create or replace function public\\.${nome}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`))?.[1] ?? '';
}

describe('migration do editor da Central de Agentes (fatia 2)', () => {
  it('existe, e a volta também', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
    expect(existsSync(VOLTA)).toBe(true);
  });

  it('o detector acha as três funções (caso positivo)', () => {
    for (const nome of NOMES) expect(corpo(nome).length, nome).toBeGreaterThan(200);
  });

  it('cabeçalho de segurança: security definer e search_path vazio nas três', () => {
    for (const nome of NOMES) {
      expect(cabecalho(nome), nome).toMatch(/security definer/);
      expect(cabecalho(nome), nome).toMatch(/set search_path = ''/);
    }
  });

  it('o papel é conferido por dentro ANTES de qualquer leitura, e o autor vem de auth.uid(), nunca de parâmetro', () => {
    for (const nome of NOMES) {
      const b = corpo(nome);
      const papel = b.indexOf('if not public.is_agency_admin_role() then');
      const leitura = b.indexOf('from public.ai_agents');
      expect(papel, nome).toBeGreaterThan(-1);
      expect(leitura, nome).toBeGreaterThan(papel);
      expect(b, nome).toContain("raise exception 'sem_permissao' using errcode = '42501'");
      expect(b, nome).toMatch(/auth\.uid\(\)/);
      expect(cabecalho(nome), nome).not.toMatch(/p_(published_by|author|autor|user|usuario)/);
    }
  });

  it('as três travam a linha do agente DA ORGANIZAÇÃO informada e conferem a revisão do rascunho', () => {
    for (const nome of NOMES) {
      const b = corpo(nome);
      expect(b, nome).toMatch(/where a\.id = p_agent_id\s+and a\.organization_id = p_organization_id\s+for update;/);
      expect(b, nome).toContain("raise exception 'agente_inexistente' using errcode = 'P0002'");
      expect(b, nome).toContain("raise exception 'rascunho_mudou' using errcode = 'P0001'");
    }
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      expect(corpo(nome), nome).toContain("raise exception 'versao_publicada_mudou' using errcode = 'P0001'");
    }
  });

  it('publicar e restaurar criam versão nova e movem o ponteiro; ninguém altera versão existente', () => {
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      expect(corpo(nome), nome).toMatch(/insert into public\.ai_agent_versions/);
      expect(corpo(nome), nome).toMatch(/set published_version_id = v_nova_id/);
    }
    expect(corpo('publish_ai_agent_version')).toContain("'publish'");
    expect(corpo('restore_ai_agent_version')).toContain("'restore'");
    expect(corpo('restore_ai_agent_version')).toMatch(/restored_from/);
    for (const nome of NOMES) expect(corpo(nome), nome).not.toMatch(/update public\.ai_agent_versions/);
  });

  it('restaurar traz o texto restaurado para o rascunho e sobe a revisão', () => {
    const b = corpo('restore_ai_agent_version');
    expect(b).toMatch(/draft = jsonb_build_object\('prompt', v_prompt\)/);
    expect(b).toMatch(/draft_revision = v_revisao \+ 1/);
  });

  it('grant: revoga de public, anon, authenticated e service_role e só então dá execute a authenticated', () => {
    for (const [nome, assinatura] of Object.entries(FUNCOES)) {
      const revoke = `revoke all on function public.${nome}${assinatura} from public, anon, authenticated, service_role;`;
      const grant = `grant execute on function public.${nome}${assinatura} to authenticated;`;
      expect(semComentarios, nome).toContain(revoke);
      expect(semComentarios, nome).toContain(grant);
      expect(semComentarios.indexOf(revoke), nome).toBeLessThan(semComentarios.indexOf(grant));
    }
  });

  it('a regra das 12 variáveis vale no banco: função auxiliar sem execute para ninguém, chamada antes de gravar', () => {
    const auxiliar = semComentarios.match(
      /create or replace function public\.central_agentes_variavel_desconhecida\(p_prompt text\)([\s\S]*?)as \$\$([\s\S]*?)\$\$;/,
    );
    expect(auxiliar, 'função auxiliar').not.toBeNull();
    const [, cab, corpoAuxiliar] = auxiliar!;
    expect(cab).toMatch(/language sql/);
    expect(cab).toMatch(/immutable/);
    expect(cab).toMatch(/security invoker/);
    expect(cab).toMatch(/set search_path = ''/);
    expect(corpoAuxiliar).toContain("regexp_matches(coalesce(p_prompt, ''), '\\{\\{([^{}]*)\\}\\}', 'g')");
    // Só espaço, tab e quebra de linha ASCII nas pontas, como a tela (revisão do Codex, rodada 2).
    expect(corpoAuxiliar).toContain("regexp_replace(r.m[1], '^[ \\t\\r\\n]+|[ \\t\\r\\n]+$', '', 'g')");
    expect(semComentarios).toContain(
      'revoke all on function public.central_agentes_variavel_desconhecida(text) from public, anon, authenticated, service_role;',
    );
    expect(semComentarios).not.toMatch(/grant execute on function public\.central_agentes_variavel_desconhecida/);
    for (const nome of ['publish_ai_agent_version', 'restore_ai_agent_version'] as const) {
      const b = corpo(nome);
      const chamada = b.indexOf('public.central_agentes_variavel_desconhecida(v_prompt)');
      expect(chamada, nome).toBeGreaterThan(-1);
      expect(chamada, nome).toBeLessThan(b.indexOf('insert into public.ai_agent_versions'));
      expect(b, nome).toContain("raise exception 'variavel_desconhecida' using errcode = 'P0001', detail = v_desconhecida");
    }
  });

  it('não é destrutiva: nenhuma tabela, coluna ou dado muda', () => {
    expect(semComentarios).not.toMatch(/\bdrop\s+(table|column|function|trigger|policy|index|schema)\b/i);
    expect(semComentarios).not.toMatch(/\balter\s+table\b/i);
    expect(semComentarios).not.toMatch(/\bdelete\s+from\b/i);
    expect(semComentarios).not.toMatch(/\btruncate\b/i);
    expect(semComentarios).not.toMatch(/\bcreate\s+(table|policy|trigger)\b/i);
  });

  it('a volta derruba só as quatro funções e o registro da versão, numa transação', () => {
    const volta = existsSync(VOLTA) ? readFileSync(VOLTA, 'utf8').replace(/--.*$/gm, '') : '';
    const comandos = volta.split(';').map((c) => c.trim()).filter(Boolean);
    expect(comandos).toEqual([
      'begin',
      'drop function if exists public.restore_ai_agent_version(uuid, uuid, integer, integer, integer, text)',
      'drop function if exists public.publish_ai_agent_version(uuid, uuid, integer, integer, text)',
      'drop function if exists public.save_ai_agent_draft(uuid, uuid, integer, text)',
      'drop function if exists public.central_agentes_variavel_desconhecida(text)',
      "delete from supabase_migrations.schema_migrations where version = '20261007120000'",
      'commit',
    ]);
  });
});
