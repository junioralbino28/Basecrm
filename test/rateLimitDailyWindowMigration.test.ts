import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8').replace(/\r\n/g, '\n');

function functionBlock(sql: string) {
  const start = sql.indexOf('create or replace function public.consume_conversation_ai_rate_limit(');
  const end = sql.indexOf('$$;', start) + '$$;'.length;
  expect(start).toBeGreaterThanOrEqual(0);
  return { body: sql.slice(start, end), tail: sql.slice(end).trim() };
}

// Reescrever função `security definer` perde o cabeçalho em silêncio. Aqui a função nova é comparada
// com a original linha a linha: só o teto da janela pode ser diferente.
describe('limitador de taxa: janela diária sem tocar no cabeçalho de segurança', () => {
  const original = functionBlock(read('20260919063000_conversation_ai_rate_limit.sql'));
  const updated = functionBlock(read('20260921020000_conversation_rate_limit_daily_window.sql'));

  it('a única linha diferente da função é o teto da janela (3600 → 86400)', () => {
    const before = original.body.split('\n');
    const after = updated.body.split('\n');
    expect(after).toHaveLength(before.length);

    const changed = before.map((line, index) => [line, after[index]]).filter(([a, b]) => a !== b);
    expect(changed).toEqual([
      ['     or p_window_seconds not between 1 and 3600 then', '     or p_window_seconds not between 1 and 86400 then'],
    ]);
  });

  it('cabeçalho e privilégios iguais: security definer, search_path fixo, só service_role executa', () => {
    expect(updated.body).toContain('language plpgsql\nsecurity definer\nset search_path = public, pg_temp');
    expect(updated.body).toContain('pg_advisory_xact_lock');
    expect(updated.tail).toBe(original.tail);
    expect(updated.tail).toContain('revoke all on function public.consume_conversation_ai_rate_limit(text, integer, integer) from public, anon, authenticated;');
    expect(updated.tail).toContain('grant execute on function public.consume_conversation_ai_rate_limit(text, integer, integer) to service_role;');
  });
});
