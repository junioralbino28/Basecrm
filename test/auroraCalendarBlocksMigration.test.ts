import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('bloqueios da agenda da Aurora', () => {
  it('cria tabela isolada por tenant, valida vínculo e aplica RLS com permissão', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260919060000_conversation_calendar_blocks.sql'),
      'utf8',
    );

    expect(source).toContain('create table public.conversation_calendar_blocks');
    expect(source).toContain('conversation_calendar_blocks_channel_tenant_fk');
    expect(source).toContain('validate_conversation_calendar_block_owner');
    expect(source).toContain('enable row level security');
    expect(source).toContain("public.has_permission('whatsapp.manage_connection')");
    expect(source).toContain('public.can_access_organization(organization_id)');

    const grants = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260919061000_conversation_calendar_blocks_grants.sql'),
      'utf8',
    );
    expect(grants).toContain('revoke all on table public.conversation_calendar_blocks from anon');
    expect(grants).toContain('to authenticated');
    expect(grants).toContain('to service_role');
  });
});
