import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Aurora conversation rate limit migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260919063000_conversation_ai_rate_limit.sql'),
    'utf8',
  );

  it('usa contador atomico protegido e acessivel apenas pelo service role', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all on function public.consume_conversation_ai_rate_limit');
    expect(sql).toContain('grant execute on function public.consume_conversation_ai_rate_limit');
    expect(sql).toContain('to service_role');
  });
});
