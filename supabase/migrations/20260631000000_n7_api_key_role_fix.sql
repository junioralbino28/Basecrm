-- =============================================================================
-- N7 — fix do papel em create_api_key / revoke_api_key
-- =============================================================================
-- As funções do schema_init exigiam profiles.role = 'admin' LITERAL. O dono da
-- clínica (Adel) é 'clinic_admin' → levava "Forbidden" ao gerar/revogar o link da
-- planilha. Troca a checagem por public.can_configure_organization(org) (mesmo gate
-- do resto: clinic_admin/agency_admin sim, clinic_staff não). Mantém search_path
-- pinado (public, extensions) — o M6 fixou; recriar sem isso reabriria o advisor e
-- quebraria _api_key_sha256_hex (pgcrypto vive em extensions). Grants preservados
-- pelo create or replace.
-- =============================================================================

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

  if not public.can_configure_organization(org_id) then
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

  if not public.can_configure_organization(org_id) then
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
