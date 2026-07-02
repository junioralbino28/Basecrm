// @vitest-environment node
// Teste FILE-BASED (não precisa de DB): valida que a migração M6 fecha cada furo
// conhecido corretamente. O isolamento AO VIVO (RLS de verdade) fica em
// m6SecurityHardening.live.test.ts (real authenticated user, sem WHERE, RLS isola).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260630000000_m6_security_hardening.sql'
);
const sql = readFileSync(migrationPath, 'utf-8').toLowerCase();

// as 8 tabelas que ainda estavam em "Enable all access for authenticated users" USING(true)
const usingTrueTables = [
  'public.lifecycle_stages',
  'public.ai_decisions',
  'public.ai_suggestion_interactions',
  'public.system_notifications',
  'public.rate_limits',
  'public.user_consents',
  'public.audit_logs',
  'public.security_alerts',
];

describe('M6 — auditoria de segurança final (file-based)', () => {
  it('derruba a policy permissiva "Enable all access for authenticated users" das 8 tabelas', () => {
    for (const t of usingTrueTables) {
      expect(
        sql.includes(`drop policy if exists "enable all access for authenticated users" on ${t}`)
      ).toBe(true);
    }
  });

  it('tabelas por-dono viram own-row (user_id = auth.uid()), nunca USING(true)', () => {
    for (const t of ['ai_decisions', 'ai_suggestion_interactions', 'user_consents']) {
      expect(sql).toContain(`${t}_own_rows`);
    }
    // own-row usa auth.uid(); o único using(true) legítimo é o SELECT global de lifecycle_stages
    expect(sql).toContain('user_id = (select auth.uid())');
  });

  it('lifecycle_stages: leitura global permitida, MUTAÇÃO só agency_admin', () => {
    expect(sql).toContain('lifecycle_stages_select_authenticated');
    expect(sql).toContain('lifecycle_stages_mutate_by_agency_admin');
    expect(sql).toContain('public.is_agency_admin_role()');
  });

  it('system_notifications: read/update escopado ao tenant', () => {
    expect(sql).toContain('system_notifications_select_by_tenant');
    expect(sql).toContain('system_notifications_update_by_tenant');
    expect(sql).toContain('public.can_access_organization(organization_id)');
  });

  it('audit_logs: SELECT own-ou-admin, INSERT own, append-only', () => {
    expect(sql).toContain('audit_logs_select_own_or_org_admin');
    expect(sql).toContain('audit_logs_insert_own');
    // sem update/delete p/ authenticated
    expect(sql).not.toContain('audit_logs_update');
    expect(sql).not.toContain('audit_logs_delete');
  });

  it('security_alerts: SELECT só admin do tenant', () => {
    expect(sql).toContain('security_alerts_select_by_tenant_admin');
    expect(sql).toContain('public.can_configure_organization(organization_id)');
  });

  it('rate_limits: service-role only (drop sem create p/ authenticated)', () => {
    expect(sql).toContain('drop policy if exists "enable all access for authenticated users" on public.rate_limits');
    expect(sql).not.toContain('create policy "rate_limits');
  });

  it('SECRET clinicorp_config: derruba TODA policy authenticated (token fora do browser)', () => {
    expect(sql).toContain('drop policy if exists "clinicorp_config_select_by_tenant_admin" on public.clinicorp_config');
    expect(sql).toContain('drop policy if exists "clinicorp_config_mutate_by_tenant_admin" on public.clinicorp_config');
    expect(sql).not.toContain('create policy "clinicorp_config');
  });

  it('SECRET channel_connections: derruba view/manage authenticated (apiKey fora do browser)', () => {
    expect(sql).toContain('drop policy if exists "members can view channel connections" on public.channel_connections');
    expect(sql).toContain('drop policy if exists "admins can manage channel connections" on public.channel_connections');
    expect(sql).not.toContain('create policy "channel_connections');
    expect(sql).not.toContain('create policy "members can view');
  });

  it('storage avatars: UPDATE/DELETE só do dono (owner = auth.uid())', () => {
    expect(sql).toContain('"avatar_update" on storage.objects');
    expect(sql).toContain('"avatar_delete" on storage.objects');
    expect(sql).toContain("owner = (select auth.uid())");
  });

  it('NÃO cria/altera policy em user_settings (own-row de chaves de IA lidas no browser por design)', () => {
    // pode MENCIONAR user_settings em comentário (documentando que não toca),
    // mas não pode ter statement de policy mirando a tabela
    expect(sql).not.toContain('on public.user_settings');
  });
});
