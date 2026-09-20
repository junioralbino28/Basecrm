import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reserva atomica da reuniao da Aurora', () => {
  it('serializa a agenda e restringe a funcao ao service role', () => {
    const baseSource = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260919050000_conversation_meeting_reservation.sql'),
      'utf8',
    );
    const hardeningSource = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260919062000_conversation_meeting_reservation_hardening.sql'),
      'utf8',
    );
    const source = `${baseSource}\n${hardeningSource}`;

    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain("a.date > p_date - interval '60 minutes'");
    expect(source).toContain("a.date < p_date + interval '60 minutes'");
    expect(hardeningSource).toContain('lock_conversation_calendar_block_owner_trigger');
    expect(hardeningSource).toContain('from public.conversation_calendar_blocks block');
    expect(hardeningSource).toContain('p_allow_update boolean default false');
    expect(hardeningSource).toContain('activity.id <> p_activity_id');
    expect(source).toContain('revoke all on function public.reserve_conversation_meeting');
    expect(source).toContain('grant execute on function public.reserve_conversation_meeting');
    expect(source).toContain('to service_role');
  });
});
