-- =============================================================================
-- INTEGRACOES SO AGENCIA — api_keys (chave de API + MCP) sai do admin do cliente
-- =============================================================================
-- Decisao do Junior (27/09/2026, "1 tambem"): a aba Integracoes INTEIRA — API,
-- MCP e webhooks — e operacao da agencia; o cliente nao tem essas telas. O codigo
-- ja nega `settings.integrations` ao clinic_admin (permission defaults v5), mas
-- esconder tela nao fecha porta (G19): as policies de api_keys e as RPCs
-- create_api_key/revoke_api_key aceitavam clinic_admin via
-- public.can_configure_organization(org). Esta migration troca SO esse gate por
-- public.is_agency_admin_role() (agency_admin/admin — o MESMO alcance que a
-- agencia ja tinha; agency_staff continua fora, como antes).
--
-- Historia: o N7 (20260631000000) LIBEROU o clinic_admin de proposito, para o
-- dono da clinica gerar o link da planilha. A decisao de 27/09 reverte isso:
-- gerar/revogar chave (planilha, MCP) vira tarefa da agencia. Chaves ja emitidas
-- NAO sao revogadas — o /api/mcp autentica pelo hash, nada muda para quem usa.
--
-- Cuidados herdados do N7/M6 (nao perder no create or replace):
--   - security definer + set search_path = public, extensions (pgcrypto vive em
--     extensions; sem isso _api_key_sha256_hex quebra e o advisor reabre);
--   - grants preservados pelo create or replace (assinaturas identicas — mudar
--     assinatura criaria overload ambiguo no PostgREST);
--   - revoke_api_key mantem a checagem key_org <> org_id byte a byte (a agencia
--     ja era barrada de revogar chave de outra org pela RPC; nada muda ai).
-- =============================================================================

-- 1) Policies: clinic_admin sai; agencia mantem o alcance que ja tinha.
drop policy if exists "api_keys_select_by_tenant_admin" on public.api_keys;
drop policy if exists "api_keys_mutate_by_tenant_admin" on public.api_keys;

create policy "api_keys_select_agencia"
  on public.api_keys
  for select
  to authenticated
  using (public.is_agency_admin_role());

create policy "api_keys_mutate_agencia"
  on public.api_keys
  for all
  to authenticated
  using (public.is_agency_admin_role())
  with check (public.is_agency_admin_role());

-- 2) RPCs: mesmo cabecalho e mesmo corpo do N7; muda SO o gate.
create or replace function public.create_api_key(p_name text)
returns table (
  api_key_id uuid,
  token text,
  key_prefix text,
  organization_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  org_id uuid;
  t text;
  prefix text;
  h text;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select p.organization_id into org_id
  from public.profiles p
  where p.id = uid;

  if org_id is null then
    raise exception 'Organization not found for user';
  end if;

  if not public.is_agency_admin_role() then
    raise exception 'Forbidden';
  end if;

  t := public._api_key_make_token();
  prefix := left(t, 12);
  h := public._api_key_sha256_hex(t);

  insert into public.api_keys (organization_id, name, key_prefix, key_hash, created_by, updated_at)
  values (org_id, coalesce(nullif(btrim(p_name), ''), 'Integração'), prefix, h, uid, now())
  returning id into api_key_id;

  token := t;
  key_prefix := prefix;
  organization_id := org_id;
  return next;
end;
$$;

create or replace function public.revoke_api_key(p_api_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  org_id uuid;
  key_org uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select p.organization_id into org_id
  from public.profiles p
  where p.id = uid;

  if org_id is null then
    raise exception 'Organization not found for user';
  end if;

  if not public.is_agency_admin_role() then
    raise exception 'Forbidden';
  end if;

  select k.organization_id into key_org
  from public.api_keys k
  where k.id = p_api_key_id;

  if key_org is null then
    raise exception 'API key not found';
  end if;

  if key_org <> org_id then
    raise exception 'Forbidden';
  end if;

  update public.api_keys
    set revoked_at = now(),
        updated_at = now()
  where id = p_api_key_id;
end;
$$;
