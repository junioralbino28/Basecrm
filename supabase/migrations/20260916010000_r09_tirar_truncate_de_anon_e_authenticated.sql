-- R-09 (docs/REVIEW-CORRECOES-PACOTE-3.md): `anon` e `authenticated` têm TRUNCATE em toda tabela
-- do schema public, inclusive nas tabelas de dinheiro (`commission_rules`, `professionals`,
-- `atendimentos`, `products`, `specialties`, `commission_payments`). TRUNCATE **ignora RLS**: a
-- policy não protege contra ele. Hoje a única barreira é a API não expor o comando — barreira de
-- superfície, não de permissão. Confirmado no catálogo de produção em 16/09: 80 tabelas com
-- TRUNCATE para os dois papéis.
--
-- Nenhuma das 22 migrations pendentes corrige isso: a `20260803000000_p3_multitenant_hardening`
-- revoga apenas em 5 tabelas de catálogo (job_roles, specialties, professional_specialties,
-- specialty_products, professional_product_overrides).
--
-- Escopo desta migration, de propósito estreito: tira SÓ o TRUNCATE, de `anon` e `authenticated`,
-- em todas as tabelas de `public`. INSERT/UPDATE/DELETE continuam como estão, porque esses o RLS
-- barra de verdade e mexer neles pode quebrar fluxo legítimo do app. Idempotente: pode rodar de novo.

DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'R-09: TRUNCATE revogado de anon e authenticated em % tabelas', n;
END
$$;

-- Tabela nova criada daqui pra frente por `postgres` também já nasce sem TRUNCATE para esses papéis.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated;
