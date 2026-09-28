// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Resposta do lead não pausa a régua que começou no meio da própria conversa (28/09).
 *
 * Caso real: a Aurora aplicou "Sem verba agora", o downsell inscreveu, e o "Desculpa perder seu
 * tempo!" do lead 15 s depois pausou a régua antes de o card mover. O comportamento foi ensaiado no
 * banco de teste (transação desfeita): lead ativo + régua sem passo de conversa segue ativa; lead que
 * estava em silêncio pausa; régua que já mandou mensagem pausa. Aqui fica o contrato do SQL.
 */

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260928030000_pausa_resposta_conversa_ativa.sql',
);

describe('Pausa por resposta — isenção da régua iniciada com o lead ativo', () => {
  const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
  const unmatched = sql.indexOf("if v_wait.id is null or v_wait.status <> 'resolved' then");
  const ramoSemEspera = sql.slice(unmatched, sql.indexOf('else', unmatched));

  it('o ramo sem espera continua pausando com o mesmo motivo (caso positivo do detector)', () => {
    expect(unmatched).toBeGreaterThan(-1);
    expect(ramoSemEspera).toContain('update public.automation_enrollments enrollment');
    expect(ramoSemEspera).toContain("pause_reason = 'patient_inbound'");
    expect(ramoSemEspera).toContain("status = 'paused'");
    expect(ramoSemEspera).toContain("enrollment.status in ('active', 'waiting')");
  });

  it('só isenta a inscrição sem passo de conversa E com mensagem do lead nos 30 min antes da entrada', () => {
    expect(ramoSemEspera).toMatch(
      /exists \([\s\S]*?job\.job_type in \('send_message', 'wait_for_event', 'delay'\)[\s\S]*?\)\s*or not exists \(/,
    );
    expect(ramoSemEspera).toContain("previous.direction = 'inbound'");
    expect(ramoSemEspera).toContain('previous.id <> p_message_id');
    expect(ramoSemEspera).toContain('previous.created_at <= enrollment.entered_at');
    expect(ramoSemEspera).toContain("previous.created_at > enrollment.entered_at - interval '30 minutes'");
  });

  it('a pausa em bloco para a conversa inteira saiu deste caminho (os outros chamadores seguem com ela)', () => {
    expect(ramoSemEspera).not.toContain('perform public.pause_automation_enrollments_for_thread');
  });

  it('preserva cabeçalho de segurança, dedupe do inbox e grants', () => {
    expect(sql).toMatch(/language plpgsql\s+security definer\s+set search_path = ''/);
    expect(sql.indexOf('if v_event.id is null then')).toBeLessThan(unmatched);
    expect(sql).toContain('on conflict (channel_connection_id, provider_message_id) do nothing');
    expect(sql).toMatch(
      /revoke all on function public\.resolve_automation_wait_from_inbox\(\s*uuid, text, uuid, uuid, text, timestamptz\s*\)[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.resolve_automation_wait_from_inbox\(\s*uuid, text, uuid, uuid, text, timestamptz\s*\)\s+to service_role/,
    );
  });
});
