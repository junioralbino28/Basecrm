// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260722070000_c2b_inbound_pause.sql',
);

describe('C2B — contrato SQL da pausa por resposta do paciente', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

  it('pausa a conversa somente quando nenhuma espera venceu a correlação', () => {
    const unmatched = sql.indexOf("v_wait.id is null or v_wait.status <> 'resolved'");
    const pause = sql.indexOf('pause_automation_enrollments_for_thread', unmatched);
    const advance = sql.indexOf('advance_automation_enrollment', unmatched);
    expect(unmatched).toBeGreaterThan(-1);
    expect(pause).toBeGreaterThan(unmatched);
    expect(advance).toBeGreaterThan(pause);
    expect(sql).toContain("'patient_inbound'");
  });

  it('preserva o dedupe do inbox antes de qualquer nova mutação', () => {
    expect(sql.indexOf('if v_event.id is null then')).toBeLessThan(
      sql.indexOf('pause_automation_enrollments_for_thread'),
    );
    expect(sql).toContain('on conflict (channel_connection_id, provider_message_id) do nothing');
  });

  it('mantém a resolução restrita ao serviço interno', () => {
    expect(sql).toMatch(
      /revoke all on function public\.resolve_automation_wait_from_inbox\(\s*uuid, text, uuid, uuid, text, timestamptz\s*\)[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.resolve_automation_wait_from_inbox\(\s*uuid, text, uuid, uuid, text, timestamptz\s*\)\s+to service_role/,
    );
  });
});
