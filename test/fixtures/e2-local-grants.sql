-- E2 S1 — bootstrap EXCLUSIVO do Supabase local.
--
-- NÃO é migration e NÃO deve ser aplicado em produção. O baseline consolidado
-- deste repositório cria tabelas como `postgres`, cujo default ACL local não
-- inclui DML para os papéis PostgREST. O ambiente hospedado já precisa desses
-- privilégios para o CRM atual funcionar; aqui espelhamos o ACL padrão do
-- Supabase para que as suítes alcancem as policies em vez de pararem antes em
-- table privilege.

grant all privileges on all tables in schema public
  to anon, authenticated, service_role;

grant all privileges on all sequences in schema public
  to anon, authenticated, service_role;

-- Reaplica o hardening de coluna de 20260630020000, pois o grant de tabela
-- acima ocorre depois das migrations neste bootstrap de teste.
revoke select on table public.organization_settings from anon;
revoke select on table public.organization_settings from authenticated;
grant select (
  organization_id,
  ai_provider,
  ai_model,
  ai_enabled,
  task_nudge_interval_minutes,
  created_at,
  updated_at
) on table public.organization_settings to authenticated;

-- A matriz E2 continua encapsulada por has_permission mesmo no harness local.
revoke all on table public.role_permission_defaults from anon;
revoke all on table public.role_permission_defaults from authenticated;
revoke all on table public.role_permission_defaults from service_role;
grant select on table public.role_permission_defaults to service_role;
