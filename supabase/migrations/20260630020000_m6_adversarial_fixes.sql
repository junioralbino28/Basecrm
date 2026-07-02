-- =============================================================================
-- M6 (parte 3) — correções do REVIEW ADVERSARIAL 2-lentes (4 confirmados)
-- =============================================================================
-- O review adversarial provou AO VIVO 4 furos que o M6 (parte 1) deixou passar.
-- Cada um verificado com pg_policies + impersonação RLS real + arquivo:linha.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (1) HIGH — organization_settings.ai_*_key: clinic_staff (Vitória) lê a chave
-- BILLÁVEL do LLM (Google/OpenAI/Anthropic) crua pelo PostgREST. SELECT da tabela
-- era can_access_organization (qualquer membro) e RLS é row-level (não filtra coluna).
-- Fix: privilégio por COLUNA — revoga SELECT da tabela e concede só nas não-secret.
-- Leituras server-side dos secrets passam a usar service-role (aiReply.ts já usava;
-- settings/ai GET + tasks/server.ts migrados p/ admin no mesmo commit).
-- O nudge (organizationSettings.ts) lê só task_nudge_interval_minutes → segue ok.
-- -----------------------------------------------------------------------------
revoke select on public.organization_settings from anon;
revoke select on public.organization_settings from authenticated;
grant select (
  organization_id, ai_provider, ai_model, ai_enabled,
  task_nudge_interval_minutes, created_at, updated_at
) on public.organization_settings to authenticated;
-- INSERT/UPDATE (incl. das colunas-secret) seguem gated por RLS can_configure — não mexidos.

-- -----------------------------------------------------------------------------
-- (2) escalada de privilégio — organization_invites: "Members can view" deixava
-- QUALQUER membro (incl. clinic_staff) ler o token (bearer) de convites pendentes
-- → aceitar POST /invites/accept com senha própria → virar clinic_admin. As rotas
-- (accept/validate/admin) usam service-role, então trancar a leitura authenticated
-- p/ admins não quebra fluxo. Nenhum read no browser (só app/api/**).
-- -----------------------------------------------------------------------------
drop policy if exists "Members can view organization invites" on public.organization_invites;
create policy "organization_invites_select_by_tenant_admin"
  on public.organization_invites
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

-- -----------------------------------------------------------------------------
-- (3) HIGH estrutural — organization_editions.metadata.evolutionDefaults.apiKey:
-- o apiKey Evolution está DUPLICADO na metadata (JSONB) e "Members can view" era
-- role-agnóstica → agency_staff lê o apiKey-mestre da agência. Nenhum read no
-- browser (só app/api/** + lib via service-role) → tranca SELECT p/ admins.
-- -----------------------------------------------------------------------------
drop policy if exists "Members can view organization editions" on public.organization_editions;
create policy "organization_editions_select_by_tenant_admin"
  on public.organization_editions
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));

-- -----------------------------------------------------------------------------
-- (4) MEDIUM — audit_logs_insert_own: WITH CHECK só validava user_id=auth.uid();
-- organization_id ficava livre → forjar/injetar log de auditoria em QUALQUER org.
-- Fix: amarra org ao próprio tenant (ou NULL, p/ o log de consentimento user-scoped
-- de consents.ts que grava user_id=self sem org).
-- -----------------------------------------------------------------------------
drop policy if exists "audit_logs_insert_own" on public.audit_logs;
create policy "audit_logs_insert_own"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (organization_id is null or public.can_access_organization(organization_id))
  );
