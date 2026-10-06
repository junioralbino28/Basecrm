// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_AI_PROMPT_KEY } from '@/lib/conversations/aiAgentConfig';

/**
 * Central de Agentes, fatia 1 (SPEC docs/features/central-de-agentes/SPEC.md). As provas leem os
 * CORPOS $$...$$ das funções quando o assunto é a lógica, e o arquivo quando é DDL. O comentário
 * do topo cita palavras como "drop" e "delete"; por isso as travas de destrutividade miram comandos.
 */
const ARQUIVO = resolve(process.cwd(), 'supabase/migrations/20260930000000_central_agentes_fundacao.sql');
const sql = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
const semComentarios = sql.replace(/--.*$/gm, '');

function corposDasFuncoes(texto: string): string[] {
  return [...texto.matchAll(/as \$\$([\s\S]*?)\$\$;/g)].map((m) => m[1]);
}

describe('migration da fundação da Central de Agentes', () => {
  it('existe', () => {
    expect(existsSync(ARQUIVO)).toBe(true);
  });

  it('o detector de corpo acha as cinco funções (caso positivo)', () => {
    expect(corposDasFuncoes(sql)).toHaveLength(5);
  });

  it('cria as duas tabelas com a FK composta por organização e a revisão do rascunho', () => {
    expect(semComentarios).toContain('create table if not exists public.ai_agents (');
    expect(semComentarios).toContain('create table if not exists public.ai_agent_versions (');
    expect(semComentarios).toContain('constraint ai_agents_org_id_unique unique (organization_id, id)');
    expect(semComentarios).toMatch(/foreign key \(organization_id, agent_id\)\s+references public\.ai_agents \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toContain('draft_revision integer not null default 0');
  });

  it('a versão publicada tem que ser do próprio agente', () => {
    expect(semComentarios).toMatch(/foreign key \(organization_id, id, published_version_id\)\s+references public\.ai_agent_versions \(organization_id, agent_id, id\)/);
  });

  it('liga o número por FK composta e não deixa apagar agente ligado', () => {
    expect(semComentarios).toContain('add column if not exists ai_agent_id uuid null');
    expect(semComentarios).toMatch(/foreign key \(organization_id, ai_agent_id\)\s+references public\.ai_agents \(organization_id, id\)\s+on delete no action/);
    expect(semComentarios).not.toMatch(/set null \(ai_agent_id\)/);
  });

  it('o evento de prova é da mesma organização do número e da conversa, com formatos checados', () => {
    expect(semComentarios).toContain('create table if not exists public.ai_reply_events (');
    expect(semComentarios).toMatch(/foreign key \(organization_id, channel_connection_id\)\s+references public\.channel_connections \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toMatch(/foreign key \(organization_id, thread_id\)\s+references public\.conversation_threads \(organization_id, id\) on delete cascade/);
    expect(semComentarios).toContain("check (prompt_sha256 ~ '^[0-9a-f]{64}$')");
    expect(semComentarios).toContain("release_commit is null or release_commit ~ '^[0-9a-f]{40}$'");
    expect(semComentarios).toContain("release_deployment is null or release_deployment ~ '^dpl_[A-Za-z0-9]{1,64}$'");
    expect(semComentarios).toContain('delivered_at timestamptz not null');
  });

  it('RLS ligada nas três tabelas; leitura só da agência nas do agente; nenhuma policy no evento', () => {
    expect(semComentarios).toContain('alter table public.ai_agents enable row level security;');
    expect(semComentarios).toContain('alter table public.ai_agent_versions enable row level security;');
    expect(semComentarios).toContain('alter table public.ai_reply_events enable row level security;');
    const policies = [...semComentarios.matchAll(/create policy "[^"]+"\s+on public\.(\w+) for (\w+)/g)];
    expect(policies.map((p) => `${p[1]}:${p[2]}`).sort()).toEqual(['ai_agent_versions:select', 'ai_agents:select']);
    expect(semComentarios.match(/using \(public\.is_agency_admin_role\(\)\)/g)).toHaveLength(2);
  });

  it('GRANT explícito: authenticated só lê as tabelas do agente; o evento é só da chave de serviço', () => {
    for (const tabela of ['ai_agents', 'ai_agent_versions', 'ai_reply_events']) {
      expect(semComentarios).toContain(`revoke all on table public.${tabela} from anon, authenticated;`);
      expect(semComentarios).toContain(`grant all on table public.${tabela} to service_role;`);
    }
    expect(semComentarios).toContain('grant select on table public.ai_agents to authenticated;');
    expect(semComentarios).toContain('grant select on table public.ai_agent_versions to authenticated;');
    // Caso positivo do detector abaixo: ele casa o grant que existe.
    expect(semComentarios).toMatch(/grant [a-z, ]+ on table public\.ai_reply_events to service_role/);
    expect(semComentarios).not.toMatch(/grant [a-z, ]+ on table public\.ai_reply_events to (anon|authenticated)/);
    expect(semComentarios).toContain('revoke all on sequence public.ai_reply_events_id_seq from anon, authenticated;');
  });

  it('as funções que leem ou escrevem têm cabeçalho de segurança; nenhuma fica aberta a public', () => {
    expect(semComentarios.match(/security definer\s*\nset search_path = ''/g)).toHaveLength(4);
    for (const assinatura of [
      'enforce_channel_connection_ai_agent_published()',
      'prevent_ai_agent_version_update()',
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
    }
    for (const assinatura of [
      'create_ai_agent_from_legacy_prompt(uuid, text, text, jsonb)',
      'central_agentes_ultima_resposta_nativa(uuid)',
      'central_agentes_ligar_conexao(uuid, uuid, text, text, text, text, text, text)',
    ]) {
      expect(semComentarios).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
  });

  it('a migração confere o sha256 do prompt e é idempotente na função, no banco e sob concorrência', () => {
    const [, , criar] = corposDasFuncoes(sql);
    expect(criar).toContain("extensions.digest(p_prompt, 'sha256')");
    expect(criar).toContain("raise exception 'origin_sha256_mismatch'");
    expect(criar).toContain("a.origin ->> 'sha256' = v_sha");
    // Duas chamadas simultâneas com o mesmo (organização, sha): a segunda espera a primeira e devolve o
    // agente dela, em vez de receber o 23505 do índice único (2ª rodada do Codex, achado 8).
    expect(criar).toContain("perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || v_sha, 0));");
    expect(criar.indexOf('pg_advisory_xact_lock')).toBeLessThan(criar.indexOf('from public.ai_agents a'));
    expect(semComentarios).toContain('create unique index if not exists ai_agents_migration_origin_unique');
  });

  it('o gatilho da conexão só cuida de agente sem versão; a organização fica com a FK composta (23503)', () => {
    const [gatilho] = corposDasFuncoes(sql);
    expect(gatilho).toContain('a.published_version_id is not null');
    expect(gatilho).not.toContain('a.organization_id');
    expect(semComentarios).toContain('before insert or update of ai_agent_id on public.channel_connections');
  });

  it('versão é imutável: o gatilho recusa update, exceto zerar o autor, e não recusa delete (senão travaria a cascata)', () => {
    const [, versoes] = corposDasFuncoes(sql);
    expect(versoes).toContain("raise exception 'ai_agent_version_immutable'");
    // Apagar o usuário que publicou faz o Postgres rodar `update ... set published_by = null` (FK on delete
    // set null). Sem esta exceção, o gatilho travaria a exclusão do usuário.
    expect(versoes).toContain("(to_jsonb(new) - 'published_by') = (to_jsonb(old) - 'published_by')");
    expect(semComentarios).toContain('before update on public.ai_agent_versions');
    expect(semComentarios).not.toMatch(/before (update or delete|delete) on public\.ai_agent_versions/);
  });

  it('a prova lê só o evento: o último do caminho de hoje, pela hora da entrega', () => {
    const [, , , ultima] = corposDasFuncoes(sql);
    expect(ultima).toContain('from public.ai_reply_events e');
    expect(ultima).toContain('e.channel_connection_id = p_connection_id');
    expect(ultima).toContain('e.agent_id is null');
    expect(ultima).toContain('order by e.delivered_at desc, e.id desc');
    // Devolve também a ORIGEM do texto (padrão ou override): a ligação exige a testemunha do mesmo caso.
    expect(ultima).toContain('e.prompt_source');
    // E o deployment que respondeu: um redeploy do mesmo commit é outra publicação (4ª rodada, achado 12).
    expect(ultima).toContain('e.release_deployment');
    // Mensagem manual ou do n8n não entra na prova, com o metadata que tiver (2ª rodada, achado 1).
    expect(ultima).not.toContain('conversation_messages');
    expect(ultima).not.toContain('metadata');
  });

  it('ligar confere tudo de novo numa transação só, com a tabela de prompts, o número e o agente travados', () => {
    const [, , , , ligar] = corposDasFuncoes(sql);
    const trava = ligar.indexOf('lock table public.ai_prompt_templates in share row exclusive mode;');
    expect(trava).toBeGreaterThan(-1);
    // A trava vem antes de qualquer leitura de override: a AUSÊNCIA de linha também fica protegida.
    expect(trava).toBeLessThan(ligar.indexOf('from public.ai_prompt_templates t'));
    expect(ligar).toMatch(/from public\.channel_connections c\s+where c\.id = p_connection_id\s+for update;/);
    expect(ligar).toMatch(/from public\.ai_agents a\s+where a\.id = p_agent_id\s+and a\.organization_id = v_org\s+for share;/);
    // A chave efetiva segue a regra do runtime, com a MESMA chave padrão do código (trava contra divergir).
    expect(ligar).toContain(`coalesce(nullif(btrim(v_chave_bruta), ''), '${DEFAULT_CONVERSATION_AI_PROMPT_KEY}')`);
    for (const motivo of [
      'sha_invalido',
      'publicacao_invalida',
      'conexao_inexistente',
      'ja_ligada',
      'chave_mudou',
      'chave_efetiva_diverge',
      'override_mudou',
      'origem_invalida',
      'versao_publicada_diverge',
      'prova_nao_confere',
      'publicacao_diverge',
      'ligado',
    ]) {
      expect(ligar).toContain(`return '${motivo}'`);
    }
    expect(ligar).toContain('public.central_agentes_ultima_resposta_nativa(p_connection_id)');
    // A testemunha tem que ser do mesmo caso: mesma chave, mesma origem (padrão ou override) e mesmo sha
    // (3ª rodada do Codex, achado 5).
    expect(ligar).toContain('v_prova_origem is distinct from p_prompt_source');
    expect(ligar).toContain('v_prova_deployment is distinct from p_deployment');
  });

  it('não é destrutiva, e o único update em conexão é o do ai_agent_id, dentro da função de ligar', () => {
    expect(semComentarios).not.toMatch(/\bdrop\s+table\b/i);
    expect(semComentarios).not.toMatch(/\bdrop\s+function\b/i);
    expect(semComentarios).not.toMatch(/\btruncate\b/i);
    expect(semComentarios).not.toMatch(/\bdelete\s+from\b/i);
    const updatesDeConexao = [...semComentarios.matchAll(/update\s+public\.channel_connections\s+set\s+(\w+)/gi)].map((m) => m[1]);
    expect(updatesDeConexao).toEqual(['ai_agent_id']);
  });
});
