import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260720030000_funil_c1a_tick_health.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

function functionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return '';
  const end = sql.indexOf('\n$$;', start);
  return sql.slice(start, end < 0 ? sql.length : end + 4);
}

describe('C1A — contrato SQL da saúde do tick', () => {
  it('mantém estado agregado singleton com todos os marcos', () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(sql).toContain('create table public.automation_tick_health');
    for (const column of [
      'last_requested_at',
      'last_request_id',
      'last_received_at',
      'last_succeeded_at',
      'last_http_status',
      'consecutive_failures',
      'last_error',
      'updated_at',
    ]) {
      expect(sql, column).toContain(column);
    }
    expect(sql).toContain('constraint automation_tick_health_singleton check (singleton)');
  });

  it('persiste segredo ausente e exceção do pg_net em vez de engolir', () => {
    const request = functionBody('request_automation_tick');
    expect(request).toContain('begin_automation_tick_request');
    expect(request).toContain('segredo ou URL do tick ausente');
    expect(request).toContain('exception when others then');
    expect(request).toContain('fail_automation_tick_request');
    expect(request).not.toMatch(/exception when others then\s+return null/);
  });

  it('deriva degradação em dois intervalos e expõe os quatro estágios', () => {
    const health = functionBody('automation_scheduler_health_at');
    expect(health).toContain("interval '10 minutes'");
    for (const stage of [
      'scheduled',
      'request_emitted',
      'endpoint_received',
      'tick_succeeded',
    ]) {
      expect(health).toContain(`'${stage}'`);
    }
  });

  it('protege false → true no banco sem bloquear a fila existente', () => {
    const guard = functionBody('guard_automation_live_enable');
    expect(guard).toContain('automation_scheduler_health_at');
    expect(guard).toContain('envio real bloqueado');
    expect(sql).toContain('create trigger guard_automation_live_enable');
    expect(sql).toContain('set_automation_live_enabled');
    expect(sql).not.toContain('create or replace function public.claim_automation_jobs');
    expect(sql).not.toContain('create or replace function public.complete_automation_job');
  });
});
