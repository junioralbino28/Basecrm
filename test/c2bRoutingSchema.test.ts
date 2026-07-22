// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260722050000_c2b_cooling_routing.sql',
);

describe('C2B — contrato SQL do esfriamento e roteamento', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

  it('persiste relógio, evento, candidatos e porteiro com identidade tenant-safe', () => {
    for (const table of [
      'automation_conversation_clocks',
      'automation_routing_events',
      'automation_routing_event_candidates',
      'automation_routing_gates',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('entry_tag_id uuid');
    expect(sql).toContain('routing_event_id uuid');
    expect(sql).toContain('unique (organization_id, thread_id, source_message_id)');
    expect(sql).toMatch(/unique index[\s\S]*routing_event_id/);
  });

  it('reinicia cinco dias a partir de toda mensagem e cancela porteiro obsoleto', () => {
    expect(sql).toContain("new.created_at + interval '5 days'");
    expect(sql).toContain('create trigger record_automation_conversation_activity');
    expect(sql).toContain("set status = 'cancelled'");
    expect(sql).toContain('processed_generation');
  });

  it('processa vencidos concorrentes com lock, sem porteiro no caminho normal', () => {
    expect(sql).toContain('create or replace function public.process_due_automation_routing');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain("v_candidate_count = 1");
    expect(sql).toContain("v_candidate_count > 1");
    expect(sql).toContain('create or replace function public.resolve_automation_routing_gate');
  });

  it('mantém mutação interna fora do cliente', () => {
    expect(sql).toMatch(
      /revoke all on function public\.process_due_automation_routing\(integer, timestamptz\)[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.resolve_automation_routing_gate\(uuid, uuid\)\s+to authenticated, service_role/,
    );
  });
});
