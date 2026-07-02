-- =============================================================================
-- N7 (fix do CRÍTICO do review adversarial) — token DEDICADO de planilha (report_tokens)
-- =============================================================================
-- Achado crítico: o link de planilha reusava um api_key ORG-SCOPED genérico. A MESMA
-- credencial (no ?token= da rota de totais) também autentica /api/public/v1/contacts
-- (PII), /api/mcp e endpoints de escrita via x-api-key. "Se o link vazar, só vaza número"
-- era FALSO — vazava a lista de pacientes inteira.
--
-- Fix: espaço de credencial SEPARADO e ISOLADO. report_tokens é uma tabela distinta de
-- api_keys, com validate_report_token PRÓPRIA. A rota de totais valida SÓ contra ela.
-- Um report_token NÃO existe em api_keys → validate_api_key nunca o aceita → ele é
-- FISICAMENTE incapaz de autenticar em /contacts, /mcp ou escrita. (Provado em teste.)
-- =============================================================================

create table if not exists public.report_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text,
  key_prefix text not null,
  key_hash text not null,
  created_by uuid references public.profiles(id),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.report_tokens enable row level security;

create index if not exists idx_report_tokens_org on public.report_tokens(organization_id) where revoked_at is null;
create unique index if not exists uniq_report_tokens_hash on public.report_tokens(key_hash);

-- Admin do tenant lista/gerencia os próprios tokens (o hash não é o segredo; o token só
-- aparece uma vez, no create). SECURITY DEFINER nas RPCs faz o insert/update.
drop policy if exists "report_tokens_select_by_tenant_admin" on public.report_tokens;
create policy "report_tokens_select_by_tenant_admin"
  on public.report_tokens for select to authenticated
  using (public.can_configure_organization(organization_id));

drop policy if exists "report_tokens_mutate_by_tenant_admin" on public.report_tokens;
create policy "report_tokens_mutate_by_tenant_admin"
  on public.report_tokens for all to authenticated
  using (public.can_configure_organization(organization_id))
  with check (public.can_configure_organization(organization_id));

-- create_report_token — gera o token (retorna UMA vez). Gate can_configure (clinic_admin+).
create or replace function public.create_report_token(p_name text)
returns table (report_token_id uuid, token text, key_prefix text, organization_id uuid)
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
  if uid is null then raise exception 'Not authenticated'; end if;

  select p.organization_id into org_id from public.profiles p where p.id = uid;
  if org_id is null then raise exception 'Organization not found for user'; end if;

  if not public.can_configure_organization(org_id) then raise exception 'Forbidden'; end if;

  -- prefixo distinto (rpt_) pra nunca confundir com api_key no suporte/debug
  t := 'rpt_' || public._api_key_make_token();
  prefix := left(t, 16);
  h := public._api_key_sha256_hex(t);

  insert into public.report_tokens (organization_id, name, key_prefix, key_hash, created_by, updated_at)
  values (org_id, coalesce(nullif(btrim(p_name), ''), 'Planilha'), prefix, h, uid, now())
  returning id into report_token_id;

  token := t;
  key_prefix := prefix;
  organization_id := org_id;
  return next;
end;
$$;

-- revoke_report_token — só admin do MESMO tenant.
create or replace function public.revoke_report_token(p_report_token_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid;
  org_id uuid;
  tok_org uuid;
begin
  uid := auth.uid();
  if uid is null then raise exception 'Not authenticated'; end if;

  select p.organization_id into org_id from public.profiles p where p.id = uid;
  if org_id is null then raise exception 'Organization not found for user'; end if;
  if not public.can_configure_organization(org_id) then raise exception 'Forbidden'; end if;

  select rt.organization_id into tok_org from public.report_tokens rt where rt.id = p_report_token_id;
  if tok_org is null then raise exception 'Report token not found'; end if;
  if tok_org <> org_id then raise exception 'Forbidden'; end if;

  update public.report_tokens set revoked_at = now(), updated_at = now() where id = p_report_token_id;
end;
$$;

-- validate_report_token — auth da rota PÚBLICA de totais (anon). Retorna SÓ a org do token.
-- Espaço isolado: só olha report_tokens (nunca api_keys).
create or replace function public.validate_report_token(p_token text)
returns table (report_token_id uuid, organization_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
begin
  if p_token is null or btrim(p_token) = '' then return; end if;

  h := public._api_key_sha256_hex(p_token);

  return query
  select rt.id, rt.organization_id
  from public.report_tokens rt
  where rt.key_hash = h and rt.revoked_at is null
  limit 1;

  update public.report_tokens
    set last_used_at = now(), updated_at = now()
  where key_hash = h and revoked_at is null;
end;
$$;

revoke all on function public.create_report_token(text) from public;
revoke all on function public.revoke_report_token(uuid) from public;
revoke all on function public.validate_report_token(text) from public;
grant execute on function public.create_report_token(text) to authenticated;
grant execute on function public.revoke_report_token(uuid) to authenticated;
grant execute on function public.validate_report_token(text) to anon, authenticated;
