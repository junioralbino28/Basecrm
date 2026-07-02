-- =============================================================================
-- M6 — Auditoria de segurança FINAL (pré-deploy). Guardião do "sem vazar dados".
-- =============================================================================
-- Fecha o que sobrou depois de rls_hardening_clinic_pii (20260612) + rls_ai_own_rows (20260622):
--  (A) 8 tabelas ainda em USING(true) → leitura/escrita cross-tenant.
--  (B) Secrets legíveis pelo BROWSER via PostgREST:
--        - clinicorp_config.api_token  (hoje: clinic_admin lê)
--        - channel_connections.config.apiKey / webhookSecret (hoje: QUALQUER membro da org,
--          incl. clinic_staff/Vitória, lê "Members can view channel connections")
--      Ambos só são consumidos SERVER-SIDE (resolvers + rotas usam createStaticAdminClient =
--      service_role, que BYPASSA RLS). Logo dá pra trancar p/ authenticated sem quebrar o app.
--  (C) storage bucket 'avatars': UPDATE/DELETE sem checagem de dono → qualquer autenticado
--      sobrescreve/apaga avatar alheio (integridade). Fecha p/ owner.
--
-- NÃO tocar (verificado nesta auditoria):
--  - user_settings: policy user_settings_isolate já é own-row (user_id = auth.uid()).
--    As chaves de IA são do PRÓPRIO usuário, lidas no browser por design → trancar quebraria.
--  - search_path / leaked-password: get_advisors(security) = 0 lints (já resolvidos nas
--    migrações da sessão) → só re-verificar com get_advisors após aplicar.
--  - Reference tables globais (lifecycle_stages): leitura continua livre (não é PII);
--    só a MUTAÇÃO (que afeta todos os tenants) passa a exigir agency_admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (A1) lifecycle_stages — reference GLOBAL (sem organization_id). Era FOR ALL USING(true):
-- qualquer authenticated mutava reference compartilhada de TODOS os tenants.
-- Funil por-tenant usa board_stages; lifecycle_stages é o lifecycle global do CRM.
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.lifecycle_stages;

create policy "lifecycle_stages_select_authenticated"
  on public.lifecycle_stages
  for select
  to authenticated
  using (true);

create policy "lifecycle_stages_mutate_by_agency_admin"
  on public.lifecycle_stages
  for all
  to authenticated
  using (public.is_agency_admin_role())
  with check (public.is_agency_admin_role());

-- -----------------------------------------------------------------------------
-- (A2) ai_decisions — user_id (dono). Era FOR ALL USING(true). Vazia/sem consumidor client.
-- Espelha ai_conversations/ai_audio_notes (rls_ai_own_rows): dono lê/escreve as próprias.
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.ai_decisions;

create policy "ai_decisions_own_rows"
  on public.ai_decisions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- (A3) ai_suggestion_interactions — user_id (dono). Era FOR ALL USING(true).
-- Consumido no browser (lib/supabase/aiSuggestions.ts) como own-rows → own-row preserva.
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.ai_suggestion_interactions;

create policy "ai_suggestion_interactions_own_rows"
  on public.ai_suggestion_interactions
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- (A4) system_notifications — organization_id. Era FOR ALL USING(true) (cross-tenant).
-- Hook useSystemNotifications: SELECT (sem filtro, confia na RLS) + UPDATE read_at. Sem delete.
-- Insert é server-side (service_role). Leitura/atualização escopadas ao tenant.
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.system_notifications;

create policy "system_notifications_select_by_tenant"
  on public.system_notifications
  for select
  to authenticated
  using (public.can_access_organization(organization_id));

create policy "system_notifications_update_by_tenant"
  on public.system_notifications
  for update
  to authenticated
  using (public.can_access_organization(organization_id))
  with check (public.can_access_organization(organization_id));

create policy "system_notifications_insert_by_tenant_admin"
  on public.system_notifications
  for insert
  to authenticated
  with check (public.can_configure_organization(organization_id));
-- delete: sem policy p/ authenticated (append/scoped) → service_role gerencia.

-- -----------------------------------------------------------------------------
-- (A5) rate_limits — infra de edge functions (sem org, sem user). Era FOR ALL USING(true).
-- Nenhum consumidor no browser → tranca p/ service_role (bypassa RLS).
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.rate_limits;
-- sem policy p/ authenticated = deny-all p/ authenticated; edge functions usam service_role.

-- -----------------------------------------------------------------------------
-- (A6) user_consents — user_id (dono), LGPD. Era FOR ALL USING(true).
-- Consumido no browser (lib/consent/*, lib/supabase/consent*.ts) sempre como own-rows.
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.user_consents;

create policy "user_consents_own_rows"
  on public.user_consents
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- (A7) audit_logs — user_id + organization_id. Era FOR ALL USING(true) → qualquer
-- authenticated lia os logs (IP, ação) de TODOS os tenants.
-- Browser: insert em consents.ts grava { user_id = auth.uid(), sem org }; leitura no
-- AuditLogDashboard (admin). Append-only p/ authenticated (sem update/delete).
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.audit_logs;

create policy "audit_logs_select_own_or_org_admin"
  on public.audit_logs
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_configure_organization(organization_id)
  );

create policy "audit_logs_insert_own"
  on public.audit_logs
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));
-- update/delete: sem policy p/ authenticated → append-only (service_role gerencia).

-- -----------------------------------------------------------------------------
-- (A8) security_alerts — organization_id. Era FOR ALL USING(true). Sem consumidor client.
-- Leitura só admin do tenant; escrita server-side (service_role).
-- -----------------------------------------------------------------------------
drop policy if exists "Enable all access for authenticated users" on public.security_alerts;

create policy "security_alerts_select_by_tenant_admin"
  on public.security_alerts
  for select
  to authenticated
  using (public.can_configure_organization(organization_id));
-- insert/update/delete: sem policy p/ authenticated → service_role gerencia.

-- -----------------------------------------------------------------------------
-- (B1) clinicorp_config — api_token é SECRET. Consumido só por resolveClinicorpCredentials
-- (server-side, admin). Nenhum read/write no browser (nenhuma UI grava o token; foi semeado
-- via SQL). Tranca p/ service_role → token NUNCA chega ao browser (nem do clinic_admin).
-- -----------------------------------------------------------------------------
drop policy if exists "clinicorp_config_select_by_tenant_admin" on public.clinicorp_config;
drop policy if exists "clinicorp_config_mutate_by_tenant_admin" on public.clinicorp_config;
-- sem policy p/ authenticated = deny-all; resolver usa service_role (bypassa RLS).

-- -----------------------------------------------------------------------------
-- (B2) channel_connections — config.apiKey / config.webhookSecret são SECRET.
-- Hoje "Members can view" deixa QUALQUER membro (incl. clinic_staff = Vitória) ler o config.
-- Todo acesso do app é server-side (rotas app/api/** via createStaticAdminClient = service_role).
-- Tranca p/ service_role → apiKey/webhookSecret fora do browser.
-- -----------------------------------------------------------------------------
drop policy if exists "Members can view channel connections" on public.channel_connections;
drop policy if exists "Admins can manage channel connections" on public.channel_connections;
-- sem policy p/ authenticated = deny-all; rotas usam service_role (bypassa RLS).

-- -----------------------------------------------------------------------------
-- (C) storage 'avatars' — bucket público (fotos de perfil, não-PII → SELECT público mantido).
-- Furo: UPDATE/DELETE só checavam bucket_id → qualquer autenticado sobrescrevia/apagava
-- avatar alheio. Fecha p/ dono (owner é setado pelo Storage no upload).
-- -----------------------------------------------------------------------------
drop policy if exists "avatar_update" on storage.objects;
create policy "avatar_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and owner = (select auth.uid()))
  with check (bucket_id = 'avatars' and owner = (select auth.uid()));

drop policy if exists "avatar_delete" on storage.objects;
create policy "avatar_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and owner = (select auth.uid()));
-- avatar_upload (INSERT) e avatar_select (SELECT público) mantidos como estão.
