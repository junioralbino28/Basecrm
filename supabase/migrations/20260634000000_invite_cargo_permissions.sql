-- =============================================================================
-- organization_invites.cargo + permission_overrides · profiles.cargo
-- =============================================================================
-- Permite escolher CARGO/FUNÇÃO (texto livre) e as PERMISSÕES granulares JÁ NO
-- momento do convite (antes de enviar), em vez de só depois que a pessoa entra.
--
-- - organization_invites.cargo (text)                → rótulo livre digitado por quem convida.
-- - organization_invites.permission_overrides (jsonb)→ SNAPSHOT do mapa de toggles escolhido.
--   Espelha o tipo TS PermissionOverrideMap (lib/auth/permissions.ts):
--   objeto { "settings.finance": false, "atendimentos.manage": true, ... }.
--   É aplicado UMA vez no aceite (accept/route.ts) → vira linhas em profile_permissions,
--   que passa a ser a fonte da verdade. Editar o convite depois NÃO re-aplica.
-- - profiles.cargo (text)                            → cargo copiado do convite no aceite; aparece na tela de Equipe.
--
-- Aditiva e backward-compatible: colunas novas nullable / com default '{}'::jsonb.
-- Sem policy nova: as rotas de convite/aceite usam service_role (bypassa RLS); o
-- trigger prevent_profile_privilege_escalation congela só role/organization_id (cargo passa).
-- Validação das chaves é app-side (APP_PERMISSIONS.includes), como já é hoje.
-- =============================================================================

alter table public.organization_invites
  add column if not exists cargo text,
  add column if not exists permission_overrides jsonb not null default '{}'::jsonb;

alter table public.profiles
  add column if not exists cargo text;
