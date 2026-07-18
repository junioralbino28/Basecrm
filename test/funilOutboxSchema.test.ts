// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260718020000_funil_f3_outbox.sql'
);

describe('F3 — outbox, attempts e simulação', () => {
  const sql = readFileSync(migrationPath, 'utf-8').toLowerCase();

  it('cria jobs com idempotência global, lease e estados explícitos', () => {
    expect(sql).toContain('create table public.automation_jobs');
    expect(sql).toContain('idempotency_key text not null unique');
    expect(sql).toContain(
      "check (status in ('pending', 'leased', 'sent', 'failed', 'unknown', 'dead_letter', 'simulated'))"
    );
    expect(sql).toContain('lease_owner text');
    expect(sql).toContain('lease_until timestamptz');
    expect(sql).toContain('attempt_count integer not null default 0');
  });

  it('cria attempts auditáveis com conteúdo renderizado e provider ID', () => {
    expect(sql).toContain('create table public.automation_step_attempts');
    expect(sql).toContain('rendered_content text');
    expect(sql).toContain('provider_message_id text');
    expect(sql).toContain('scheduled_for timestamptz');
    expect(sql).toContain('executed_at timestamptz');
    expect(sql).toContain('duration_ms integer');
  });

  it('liga mensagem pending ao job antes da simulação', () => {
    expect(sql).toContain('automation_job_id uuid');
    expect(sql).toContain('delivery_status text');
    expect(sql).toContain('idempotency_key text');
    expect(sql).toContain('create or replace function public.prepare_automation_outbound');
    expect(sql).toMatch(/'automation',\s+'pending',\s+v_now/);
    expect(sql).toContain('create or replace function public.complete_automation_simulation');
  });

  it('impõe dedupe por provider no banco, sem corrida SELECT→INSERT', () => {
    expect(sql).toContain('create unique index uq_conversation_messages_provider_id');
    expect(sql).toContain('(channel_connection_id, provider_message_id)');
    expect(sql).toContain('where provider_message_id is not null');
  });

  it('safe mode organizacional nasce false e simulation não fabrica provider ID', () => {
    expect(sql).toContain(
      'automation_live_enabled boolean not null default false'
    );
    expect(sql).toContain('provider_message_id = null');
    expect(sql).toContain("delivery_status = 'simulated'");
  });

  it('RPCs internos derivam tenant do enrollment/job e não são públicas', () => {
    for (const functionName of [
      'enqueue_automation_job',
      'prepare_automation_outbound',
      'complete_automation_simulation',
    ]) {
      expect(sql).toContain(`create or replace function public.${functionName}`);
      expect(sql).toContain(`revoke all on function public.${functionName}`);
      expect(sql).toContain(`to service_role`);
    }
    expect(sql).toContain('v_enrollment.organization_id');
  });

  it('RLS é somente leitura para editor/operador', () => {
    expect(sql).toContain('"automation_jobs_select_by_tenant_operator"');
    expect(sql).toContain('"automation_step_attempts_select_by_tenant_operator"');
    expect(sql).toContain("public.has_permission('automation.operate')");
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});
