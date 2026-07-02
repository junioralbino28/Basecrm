-- =============================================================================
-- M6 (parte 2) — fixa search_path das funções legadas (advisor: function_search_path_mutable)
-- =============================================================================
-- SECURITY DEFINER com search_path MUTÁVEL = vetor de hijack (o caller controla o
-- search_path). As funções da sessão (can_*, current_profile_*, is_agency_*) já tinham
-- search_path fixo; sobraram as legadas do schema_init (handle_new_user, mark_deal_won,
-- get_dashboard_stats, triggers, api_key helpers, etc.).
--
-- Pina `search_path = public, extensions` (NÃO-mutável → satisfaz o advisor) — inclui
-- `extensions` porque funções crypto (_api_key_sha256_hex usa digest() do pgcrypto, que
-- mora em `extensions`) quebram com `public` sozinho. Nenhum dos dois schemas é gravável
-- por role comum → sem risco de hijack. Exclui funções de extensão (não somos donos) e
-- as que já têm search_path='' (finance RPCs, intencionalmente estritas + fully-qualified).
-- =============================================================================
do $$
declare
  r record;
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- só as que NÃO têm nenhum search_path fixado (não mexe nas search_path='' estritas)
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%'
      )
      -- exclui funções pertencentes a extensões (ex.: unaccent) — não somos donos
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('alter function public.%I(%s) set search_path = public, extensions', r.proname, r.args);
  end loop;
end $$;
