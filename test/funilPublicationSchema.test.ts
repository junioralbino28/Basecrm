// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260718010000_funil_f2_publication.sql'
);

describe('F2 — publicação imutável e inscrições versionadas', () => {
  const sql = readFileSync(migrationPath, 'utf-8').toLowerCase();

  it('cria versões e inscrições com FKs tenant-safe', () => {
    expect(sql).toContain('create table public.automation_versions');
    expect(sql).toContain('create table public.automation_enrollments');
    expect(sql).toMatch(
      /foreign key \(automation_version_id, automation_id, organization_id\)\s+references public\.automation_versions\(id, automation_id, organization_id\)/
    );
    expect(sql).toMatch(
      /foreign key \(organization_id, deal_id\)\s+references public\.deals\(organization_id, id\)/
    );
    expect(sql).toMatch(
      /foreign key \(organization_id, contact_id\)\s+references public\.contacts\(organization_id, id\)/
    );
  });

  it('torna versões append-only até para service_role', () => {
    expect(sql).toContain('create trigger prevent_automation_version_mutation');
    expect(sql).toContain("tg_op in ('update', 'delete')");
    expect(sql).toContain('versões publicadas são imutáveis');
  });

  it('publica em transação, incrementa versão e fixa o published_version_id', () => {
    expect(sql).toContain('create or replace function public.publish_automation_version');
    expect(sql).toContain('for update');
    expect(sql).toContain('draft_revision');
    expect(sql).toMatch(/max\(public\.automation_versions\.version\)/);
    expect(sql).toContain('published_version_id = v_version_id');
    expect(sql).toContain("lifecycle_status = 'published'");
  });

  it('inscreve derivando tenant e versão publicada da automação', () => {
    expect(sql).toContain('create or replace function public.create_automation_enrollment');
    expect(sql).toContain('v_automation.published_version_id');
    expect(sql).toContain("v_automation.lifecycle_status <> 'published'");
    expect(sql).toContain("v_definition->>'entrystepkey'");
  });

  it('mantém RPCs internos fora de anon/authenticated', () => {
    for (const signature of [
      'public.publish_automation_version(uuid, bigint, text, text, uuid)',
      'public.create_automation_enrollment(uuid, uuid, uuid, uuid, uuid)',
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from anon`);
      expect(sql).toContain(`revoke all on function ${signature} from authenticated`);
      expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    }
  });

  it('persiste timezone, quiet hours e semântica de D+1 local', () => {
    expect(sql).toContain("automation_timezone text not null default 'america/sao_paulo'");
    expect(sql).toContain("automation_day_delay_semantics text not null default 'next_local_day'");
    expect(sql).toContain('automation_quiet_hours_start time not null');
    expect(sql).toContain('automation_quiet_hours_end time not null');
  });

  it('RLS permite leitura por operação, mas não escrita direta', () => {
    expect(sql).toContain('"automation_versions_select_by_tenant_operator"');
    expect(sql).toContain('"automation_enrollments_select_by_tenant_operator"');
    expect(sql).toContain("public.has_permission('automation.operate')");
    expect(sql).not.toContain('using (true)');
    expect(sql).not.toContain('with check (true)');
  });
});
