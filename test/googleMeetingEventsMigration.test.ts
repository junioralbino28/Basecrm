import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260922020000_conversation_meeting_google_events.sql'),
  'utf8',
);

describe('espelho da reuniao no Google Agenda (Fatias 3 e 4)', () => {
  it('cria a tabela com a activity como chave e cascata a partir dela', () => {
    expect(source).toContain('create table public.conversation_meeting_google_events');
    expect(source).toContain('activity_id uuid primary key references public.activities(id) on delete cascade');
    expect(source).toContain('organization_id uuid not null references public.organizations(id) on delete cascade');
    expect(source).toContain('thread_id uuid not null references public.conversation_threads(id) on delete cascade');
    expect(source).toContain('owner_id uuid not null references public.profiles(id) on delete cascade');
  });

  it('guarda o estado do evento, as tentativas e os carimbos do lembrete', () => {
    for (const column of [
      'channel_connection_id', 'contact_id', 'invitee_email', 'invited_at', 'scheduled_at',
      'google_calendar_id', 'google_event_id', 'meet_link', 'status', 'attempts',
      'last_error', 'next_retry_at', 'reminder_sent_at', 'reminder_escalated_at',
    ]) {
      expect(source).toContain(column);
    }
    expect(source).toContain(
      "check (status in ('pending', 'created', 'update_pending', 'cancel_pending', 'cancelled', 'failed'))",
    );
  });

  it('RLS ligada, sem policy, privilegios so para service_role', () => {
    expect(source).toContain('alter table public.conversation_meeting_google_events enable row level security;');
    expect(source).toContain(
      'revoke all on table public.conversation_meeting_google_events from public, anon, authenticated;',
    );
    expect(source).toContain('grant all on table public.conversation_meeting_google_events to service_role;');
    // Deny-all de verdade: nenhuma policy para authenticated/anon nesta tabela.
    expect(source).not.toContain('create policy');
  });

  it('a funcao de validacao e security definer com search_path vazio e sem EXECUTE para o navegador', () => {
    expect(source).toContain('create or replace function public.validate_conversation_meeting_google_event()');
    expect(source).toContain('security definer');
    expect(source).toContain("set search_path = ''");
    expect(source).toContain(
      'revoke all on function public.validate_conversation_meeting_google_event() from public, anon, authenticated;',
    );
    expect(source).toContain('create trigger validate_conversation_meeting_google_event_trigger');
  });

  it('a validacao prende responsavel, contato, conexao e activity a MESMA organizacao', () => {
    expect(source).toContain('google meeting event owner must belong to organization');
    expect(source).toContain('google meeting event contact must belong to organization');
    expect(source).toContain('google meeting event connection must belong to organization');
    expect(source).toContain('google meeting event activity must belong to organization');
  });

  it('nao altera nenhuma tabela existente (migration aditiva)', () => {
    expect(source).not.toContain('alter table public.activities');
    expect(source).not.toContain('alter table public.channel_connections');
    expect(source).not.toContain('drop table');
    // A RPC da reserva so e citada em comentario; nenhuma linha executavel a redefine.
    expect(source).not.toContain('create or replace function public.reserve_conversation_meeting');
  });

  it('tem indice para a fila do tick e para a janela do lembrete', () => {
    expect(source).toContain('conversation_meeting_google_events_queue_idx');
    expect(source).toContain('conversation_meeting_google_events_reminder_idx');
    expect(source).toContain('conversation_meeting_google_events_owner_invited_idx');
  });
});

/**
 * Consertos das duas revisoes adversariais de 22/09. Guarda de regressao do CABECALHO DE
 * SEGURANCA: o que o banco faz de verdade (FKs, cascade, trigger, grants) e provado contra o
 * Postgres do preview por `prod/preview_migration_meeting_events.py` antes de qualquer publicacao
 * — este arquivo existe para um `create or replace` futuro nao perder `security definer`,
 * `search_path = ''` ou o `revoke` em silencio.
 */
describe('consertos das fatias 3 e 4 (migration 20260922030000)', () => {
  const fixes = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260922030000_google_meeting_event_fixes.sql'),
    'utf8',
  );

  it('e aditiva: nenhuma tabela existente muda de forma alem de ganhar coluna', () => {
    const alteracoes = fixes.match(/alter table [^\n;]+/g) ?? [];
    expect(alteracoes).toHaveLength(2);
    expect(fixes).toContain('add column if not exists invited_email text');
    // O outro `alter table` e so o RLS da tabela nova.
    expect(fixes).toContain('alter table public.google_calendar_orphan_events enable row level security');
    expect(fixes).not.toMatch(/drop (table|column)/i);
  });

  it('a fila de orfaos e fechada: RLS ligada, sem policy, so service_role', () => {
    expect(fixes).toContain('revoke all on table public.google_calendar_orphan_events from public, anon, authenticated');
    expect(fixes).toContain('grant all on table public.google_calendar_orphan_events to service_role');
    expect(fixes).not.toContain('create policy');
  });

  it('as duas funcoes mantem o cabecalho de seguranca inteiro', () => {
    for (const nome of [
      'public.capture_orphan_google_calendar_event()',
      'public.validate_conversation_meeting_google_event()',
    ]) {
      const corpo = fixes.slice(fixes.indexOf(`create or replace function ${nome}`));
      expect(corpo).toContain('security definer');
      expect(corpo).toContain("set search_path = ''");
      expect(fixes).toContain(`revoke all on function ${nome} from public, anon, authenticated`);
    }
  });

  it('o gatilho de orfao roda ANTES do delete (depois a linha ja nao existe)', () => {
    expect(fixes).toContain('before delete on public.conversation_meeting_google_events');
    expect(fixes).toContain('on conflict (organization_id, google_calendar_id, google_event_id) do nothing');
  });

  it('a validacao passou a exigir que a conversa seja do mesmo tenant', () => {
    expect(fixes).toContain('google meeting event thread must belong to organization');
    // E as quatro checagens que ja existiam continuam la (reescrever a funcao pelo corpo perde).
    for (const regra of ['owner must belong', 'contact must belong', 'connection must belong', 'activity must belong']) {
      expect(fixes).toContain(regra);
    }
  });
});
