import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Google Agenda — conexoes, oauth states e vault (Fatia 1)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260922010000_google_calendar_connections.sql'),
    'utf8',
  );

  it('cria as duas tabelas com RLS ligada e sem policy para authenticated/anon', () => {
    expect(source).toContain('create table public.google_calendar_connections');
    expect(source).toContain('create table public.google_oauth_states');
    expect(source).toContain('alter table public.google_calendar_connections enable row level security');
    expect(source).toContain('alter table public.google_oauth_states enable row level security');
    // Deny-all: nenhuma "create policy" nesta migration.
    expect(source).not.toMatch(/create policy/i);
  });

  it('revoga de public/anon/authenticated e concede so a service_role nas duas tabelas', () => {
    expect(source).toContain(
      'revoke all on table public.google_calendar_connections from public, anon, authenticated',
    );
    expect(source).toContain('grant all on table public.google_calendar_connections to service_role');
    expect(source).toContain(
      'revoke all on table public.google_oauth_states from public, anon, authenticated',
    );
    expect(source).toContain('grant all on table public.google_oauth_states to service_role');
  });

  it('conexao e unica por (organization_id, owner_id) e nao guarda o token em coluna comum', () => {
    expect(source).toContain('constraint google_calendar_connections_owner_unique unique (organization_id, owner_id)');
    expect(source).not.toMatch(/^\s*refresh_token\s+text/im);
    expect(source).toContain('refresh_token_secret_id uuid');
  });

  it('state e uso unico: chave e o proprio state, expira em 10 minutos, amarrado ao tenant/conexao/responsavel', () => {
    expect(source).toContain('state uuid primary key default gen_random_uuid()');
    expect(source).toContain("expires_at timestamptz not null default (now() + interval '10 minutes')");
    expect(source).toContain('consumed_at timestamptz');
    expect(source).toContain('constraint google_oauth_states_channel_tenant_fk');
    expect(source).toContain(
      'foreign key (organization_id, channel_connection_id)\n    references public.channel_connections(organization_id, id)',
    );
  });

  it('so aceita os tres redirect_origin autorizados', () => {
    expect(source).toContain('https://crm.basea2.com');
    expect(source).toContain('https://teste.crm.basea2.com');
    expect(source).toContain('http://localhost:3000');
  });

  it('as tres funcoes do Vault sao security definer, search_path vazio e so service_role executa', () => {
    for (const fn of [
      'write_google_calendar_refresh_token',
      'read_google_calendar_refresh_token',
      'delete_google_calendar_refresh_token',
    ]) {
      const marker = `function public.${fn}(`;
      const start = source.indexOf(marker);
      expect(start, `${fn} nao encontrada`).toBeGreaterThan(-1);
      const body = source.slice(start, start + 800);
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
    }

    expect(source).toContain('grant execute on function public.write_google_calendar_refresh_token');
    expect(source).toContain('grant execute on function public.read_google_calendar_refresh_token');
    expect(source).toContain('grant execute on function public.delete_google_calendar_refresh_token');
    // Toda funcao nova revoga de public/anon/authenticated antes de conceder ao service_role.
    const revokeCount = (source.match(/from public, anon, authenticated/g) || []).length;
    expect(revokeCount).toBeGreaterThanOrEqual(5); // 2 tabelas + 3 funcoes de vault (triggers tem revoke proprio)
  });

  it('quem clica (requested_by) pode ser admin da agencia: o trigger so exige que o RESPONSAVEL seja do tenant', () => {
    expect(source).toContain("raise exception 'google oauth state owner must belong to organization'");
    expect(source).not.toContain('requested_by must belong to organization');
  });

  it('gravar token serializa conexoes simultaneas do mesmo responsavel (sem secret orfao no Vault)', () => {
    const write = source.slice(source.indexOf('function public.write_google_calendar_refresh_token'));
    const lock = write.indexOf('pg_advisory_xact_lock');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(write.indexOf('vault.create_secret'));
  });

  it('gravar token usa create_secret/update_secret; apagar remove de vault.secrets', () => {
    expect(source).toContain('vault.create_secret(');
    expect(source).toContain('vault.update_secret(');
    expect(source).toContain('delete from vault.secrets where id = v_secret_id');
    expect(source).toContain('from vault.decrypted_secrets');
  });

  it('nenhuma migration mexe em channel_connections, activities ou reserve_conversation_meeting (so cita em comentario)', () => {
    expect(source).not.toMatch(/alter table public\.channel_connections/i);
    expect(source).not.toMatch(/alter table public\.activities/i);
    expect(source).not.toMatch(/(?:create|drop|grant|revoke)[^\n]*reserve_conversation_meeting/i);
  });
});

describe('Google Agenda — reconectar nao apaga a agenda escolhida (correcao 20260922060000)', () => {
  const fix = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260922060000_preserve_calendar_choice_on_reconnect.sql'),
    'utf8',
  );
  const doUpdate = fix.slice(fix.indexOf('on conflict (organization_id, owner_id) do update set'));

  it('a versao corrigida NAO grava mais `excluded.google_calendar_id` por cima da escolha', () => {
    // Era isto que devolvia a IA para a agenda principal a cada reconexao.
    expect(doUpdate).not.toContain('google_calendar_id = excluded.google_calendar_id');
  });

  it('preserva agenda de escrita, nome e agendas ocupadas quando a conta Google e a MESMA', () => {
    for (const coluna of ['google_calendar_id', 'google_calendar_summary', 'busy_calendar_ids']) {
      expect(doUpdate).toContain(`else public.google_calendar_connections.${coluna}`);
    }
  });

  it('zera a escolha quando a conta Google MUDOU (ids de outra conta dariam 404)', () => {
    const comparacoes = doUpdate.match(
      /public\.google_calendar_connections\.google_account_email\s*\n?\s*is distinct from excluded\.google_account_email/g,
    );
    expect(comparacoes).toHaveLength(3);
    expect(doUpdate).toContain("then 'primary'");
    expect(doUpdate).toContain("then '{}'::text[]");
  });

  it('mantem o cabecalho de seguranca da versao original (definer, search_path vazio, so service_role)', () => {
    expect(fix).toContain('security definer');
    expect(fix).toContain("set search_path = ''");
    expect(fix).toContain(') from public, anon, authenticated;');
    expect(fix).toContain(') to service_role;');
    // O resto do corpo nao muda: trava, Vault e checagem de responsavel continuam.
    expect(fix).toContain('pg_advisory_xact_lock');
    expect(fix).toContain('vault.update_secret(');
    expect(fix).toContain('vault.create_secret(');
    expect(fix).toContain("raise exception 'Responsavel nao pertence a organizacao.'");
  });
});

describe('Google Agenda — agenda de observacao (20260922070000): avisa, nao bloqueia', () => {
  const watch = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260922070000_google_calendar_watch_only.sql'),
    'utf8',
  );

  it('e aditivo puro e o padrao reproduz o comportamento de hoje (ninguem avisa)', () => {
    expect(watch).toContain("add column if not exists watch_calendar_ids text[] not null default '{}'::text[]");
    expect(watch).toContain('add column if not exists overlap_warning text');
    // Nada de apagar, renomear ou mexer em dado existente.
    expect(watch).not.toMatch(/drop\s+(table|column|constraint)/i);
    expect(watch).not.toMatch(/^\s*update\s+public\./im);
    expect(watch).not.toMatch(/^\s*delete\s+from/im);
  });

  it('a lista de observacao e uma coluna SEPARADA da de bloqueio', () => {
    expect(watch).toContain('watch_calendar_ids');
    // Nao mexe na coluna que bloqueia: as duas convivem com sentidos diferentes.
    expect(watch).not.toMatch(/alter table[^;]*drop column[^;]*busy_calendar_ids/i);
  });
});
