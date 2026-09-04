-- V-01 (docs/REVIEW-CORRECOES-PACOTE-3.md, seção "LEIA PRIMEIRO"): quatro funções
-- SECURITY DEFINER eram executáveis pelo role `anon` — o role da chave pública que
-- fica embutida no front-end — e nenhuma delas conferia organização, permissão ou
-- sessão. Provado ao vivo no Supabase local: sem sessão, a leitura do negócio é
-- barrada pelo RLS, mas `mark_deal_won` devolvia 204 e marcava o negócio como ganho.
--
-- Mecanismo: o `GRANT EXECUTE ... TO authenticated` do schema_init nunca foi
-- precedido de `REVOKE ... FROM PUBLIC`. O Postgres materializa a ACL preservando o
-- EXECUTE padrão de PUBLIC (`=X/postgres`), e o default privilege do supabase_admin
-- concede EXECUTE a `anon` em toda função nova. `cleanup_rate_limits` nunca recebeu
-- grant algum e ficou com a ACL padrão, que também alcança PUBLIC.
--
-- Nenhum caminho do código chama estas funções hoje (varredura no repositório).
-- Elas são mantidas, e não removidas, para não quebrar integração externa que use
-- JWT autenticado; passam a exigir o MESMO gate da policy de escrita de `deals`
-- (`deals_mutate_by_tenant_operator` -> `can_operate_organization`), via
-- `can_operate_deal`. Negócio inexistente e negócio de outra organização recebem o
-- mesmo 42501, para não permitir sondagem de existência.
--
-- Diff de cabeçalho, declarado de propósito: as três funções de negócio saem de
-- `search_path = public, extensions` e `cleanup_rate_limits` sai de
-- `search_path = public`, todas para `search_path = ''` com nomes qualificados —
-- o padrão do restante do motor. Assinaturas, RETURNS, corpo do UPDATE e
-- SECURITY DEFINER são preservados.

CREATE OR REPLACE FUNCTION public.mark_deal_won(deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(public.can_operate_deal(deal_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;

  UPDATE public.deals
  SET
    is_won = TRUE,
    is_lost = FALSE,
    closed_at = now(),
    updated_at = now()
  WHERE id = deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_deal_lost(deal_id uuid, reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(public.can_operate_deal(deal_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;

  UPDATE public.deals
  SET
    is_lost = TRUE,
    is_won = FALSE,
    loss_reason = coalesce(reason, loss_reason),
    closed_at = now(),
    updated_at = now()
  WHERE id = deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_deal(deal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT coalesce(public.can_operate_deal(deal_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'acesso negado';
  END IF;

  UPDATE public.deals
  SET
    is_won = FALSE,
    is_lost = FALSE,
    closed_at = NULL,
    updated_at = now()
  WHERE id = deal_id;
END;
$$;

-- RPCs de negócio: quem opera a organização (o mesmo conjunto da policy de deals).
REVOKE ALL ON FUNCTION public.mark_deal_won(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_deal_lost(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_deal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_deal_won(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_deal_lost(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_deal(uuid) TO authenticated, service_role;

-- Manutenção interna: só o service_role. Nem anon nem authenticated podem
-- desarmar o controle de taxa. O corpo é o original; muda apenas o cabeçalho.
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits(older_than_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.rate_limits
  WHERE created_at < now() - (older_than_minutes || ' minutes')::interval;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(integer) TO service_role;
