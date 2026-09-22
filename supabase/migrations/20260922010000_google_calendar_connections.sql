-- =============================================================================
-- Google Agenda na Aurora — Fatia 1 (Conectar)
-- SPEC: docs/features/aurora-cenno/SPEC-google-agenda.md
-- Desenho: 06-References/basecrm-producao-aurora-2026-09-21/DESENHO-GOOGLE-AGENDA-2026-09-22.md
--
-- Duas tabelas novas, aditivas (nenhuma migration altera channel_connections,
-- activities ou reserve_conversation_meeting):
--   google_calendar_connections — 1 linha por (organization_id, owner_id) responsavel
--     da agenda; guarda so metadado publico (e-mail, calendarId, status) + a
--     REFERENCIA ao segredo no Supabase Vault. O refresh token em si nunca fica
--     em coluna comum: vai para o Vault (vault.create_secret/update_secret), na
--     mesma extensao ja usada neste projeto para automation_tick_secret.
--   google_oauth_states — correlacao de CSRF do fluxo OAuth (G27), state aleatorio,
--     uso unico (consumed_at marcado ANTES de trocar o code), expira em 10 min.
--
-- Ambas: RLS ligada, SEM policy para authenticated/anon (deny-all), privilegios de
-- tabela revogados de public/anon/authenticated e concedidos so a service_role.
-- Todo acesso do app passa por app/api/** (createStaticAdminClient) ou pelas
-- funcoes SECURITY DEFINER abaixo (search_path vazio, EXECUTE so para service_role),
-- no mesmo esqueleto de supabase/migrations/20260919062000_conversation_meeting_reservation_hardening.sql.
--
-- Nada muda para quem nao conecta: as tabelas nascem vazias e nenhum codigo hoje as le.
-- =============================================================================

-- ---------------------------------------------------------------- conexoes
create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  google_account_email text not null,
  google_calendar_id text not null default 'primary',
  -- Referencia ao segredo no Vault (vault.secrets.id). Nulo quando desconectado
  -- (delete_google_calendar_refresh_token apaga o segredo e limpa esta coluna).
  refresh_token_secret_id uuid,
  scope text not null default '',
  status text not null default 'connected',
  last_error text,
  last_read_error_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_owner_unique unique (organization_id, owner_id),
  constraint google_calendar_connections_status_check
    check (status in ('connected', 'reconnect_required', 'revoked')),
  constraint google_calendar_connections_email_not_blank
    check (btrim(google_account_email) <> '')
);

create index google_calendar_connections_owner_idx
  on public.google_calendar_connections(organization_id, owner_id);

comment on table public.google_calendar_connections is
  'Google Agenda por responsavel (Aurora). refresh_token_secret_id aponta para o Supabase Vault; o token nunca fica em texto plano aqui. Segredo: sem SELECT/INSERT/UPDATE/DELETE para authenticated/anon; leitura e escrita so por service_role ou pelas funcoes SECURITY DEFINER desta migration.';

alter table public.google_calendar_connections enable row level security;

-- Privilegios padrao do Supabase dao a anon/authenticated TRUNCATE/REFERENCES/TRIGGER
-- em toda tabela nova (achado R-09). Zera tudo e concede so ao service_role; sem
-- policy nenhuma para authenticated/anon = deny-all mesmo que algum grant escape.
revoke all on table public.google_calendar_connections from public, anon, authenticated;
grant all on table public.google_calendar_connections to service_role;

create or replace function public.validate_google_calendar_connection_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.owner_id
      and profile.organization_id = new.organization_id
  ) then
    raise exception 'google calendar connection owner must belong to organization';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_google_calendar_connection_owner() from public, anon, authenticated;

drop trigger if exists validate_google_calendar_connection_owner_trigger
  on public.google_calendar_connections;

create trigger validate_google_calendar_connection_owner_trigger
before insert or update on public.google_calendar_connections
for each row execute function public.validate_google_calendar_connection_owner();

-- ---------------------------------------------------------------- oauth states
create table public.google_oauth_states (
  state uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_connection_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  redirect_origin text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  constraint google_oauth_states_channel_tenant_fk
    foreign key (organization_id, channel_connection_id)
    references public.channel_connections(organization_id, id) on delete cascade,
  constraint google_oauth_states_redirect_origin_known
    check (redirect_origin in (
      'https://crm.basea2.com',
      'https://teste.crm.basea2.com',
      'http://localhost:3000'
    ))
);

create index google_oauth_states_lookup_idx
  on public.google_oauth_states(state, consumed_at, expires_at);

comment on table public.google_oauth_states is
  'Correlacao de CSRF do fluxo OAuth do Google Agenda (G27). Uso unico: consumed_at e marcado ANTES de trocar o code, por UPDATE condicional (consumed_at is null and expires_at > now()). Expira em 10 minutos. Segredo/uso interno: sem SELECT/INSERT/UPDATE/DELETE para authenticated/anon.';

alter table public.google_oauth_states enable row level security;

revoke all on table public.google_oauth_states from public, anon, authenticated;
grant all on table public.google_oauth_states to service_role;

create or replace function public.validate_google_oauth_state_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = new.owner_id
      and profile.organization_id = new.organization_id
  ) then
    raise exception 'google oauth state owner must belong to organization';
  end if;
  -- requested_by e so auditoria de quem clicou: pode ser um admin da agencia, cujo perfil
  -- mora na organizacao da agencia, nao na do cliente. A permissao ja foi checada na rota
  -- (requireTenantAccess com whatsapp.manage_connection).
  return new;
end;
$$;

revoke all on function public.validate_google_oauth_state_owner() from public, anon, authenticated;

drop trigger if exists validate_google_oauth_state_owner_trigger
  on public.google_oauth_states;

create trigger validate_google_oauth_state_owner_trigger
before insert or update on public.google_oauth_states
for each row execute function public.validate_google_oauth_state_owner();

-- ---------------------------------------------------------------- vault (refresh token)
-- As tres funcoes abaixo sao o UNICO caminho para gravar/ler/apagar o refresh token do
-- Google no Supabase Vault. SECURITY DEFINER + search_path vazio (mesmo padrao de
-- reserve_conversation_meeting); EXECUTE revogado de public/anon/authenticated e
-- concedido so a service_role. O app nunca faz SELECT em vault.secrets/decrypted_secrets
-- diretamente — sempre por aqui.

create or replace function public.write_google_calendar_refresh_token(
  p_organization_id uuid,
  p_owner_id uuid,
  p_google_account_email text,
  p_google_calendar_id text,
  p_refresh_token text,
  p_scope text
)
returns public.google_calendar_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_row public.google_calendar_connections%rowtype;
begin
  if p_organization_id is null
    or p_owner_id is null
    or nullif(btrim(coalesce(p_google_account_email, '')), '') is null
    or nullif(btrim(coalesce(p_refresh_token, '')), '') is null
  then
    raise exception 'Parametros obrigatorios ausentes para conectar o Google Agenda.';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = p_owner_id and profile.organization_id = p_organization_id
  ) then
    raise exception 'Responsavel nao pertence a organizacao.';
  end if;

  -- Serializa conexoes simultaneas do mesmo responsavel (duplo clique na 1a conexao): sem
  -- isso as duas criariam um secret no Vault e um ficaria orfao.
  perform pg_advisory_xact_lock(hashtextextended(
    'google_calendar_refresh_token:' || p_organization_id::text || ':' || p_owner_id::text, 0));

  select refresh_token_secret_id into v_secret_id
  from public.google_calendar_connections
  where organization_id = p_organization_id and owner_id = p_owner_id
  for update;

  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_refresh_token);
  else
    v_secret_id := vault.create_secret(
      p_refresh_token,
      'google_calendar_refresh_token:' || p_organization_id::text || ':' || p_owner_id::text,
      'Refresh token do Google Agenda (Aurora).'
    );
  end if;

  insert into public.google_calendar_connections (
    organization_id, owner_id, google_account_email, google_calendar_id,
    refresh_token_secret_id, scope, status, last_error, last_read_error_at,
    connected_at, updated_at
  ) values (
    p_organization_id, p_owner_id, btrim(p_google_account_email),
    coalesce(nullif(btrim(p_google_calendar_id), ''), 'primary'),
    v_secret_id, coalesce(p_scope, ''), 'connected', null, null, now(), now()
  )
  on conflict (organization_id, owner_id) do update set
    google_account_email = excluded.google_account_email,
    google_calendar_id = excluded.google_calendar_id,
    refresh_token_secret_id = excluded.refresh_token_secret_id,
    scope = excluded.scope,
    status = 'connected',
    last_error = null,
    last_read_error_at = null,
    connected_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.write_google_calendar_refresh_token(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.write_google_calendar_refresh_token(
  uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.read_google_calendar_refresh_token(
  p_organization_id uuid,
  p_owner_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_token text;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_calendar_connections
  where organization_id = p_organization_id
    and owner_id = p_owner_id
    and status = 'connected';

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_token;
end;
$$;

revoke all on function public.read_google_calendar_refresh_token(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.read_google_calendar_refresh_token(uuid, uuid)
  to service_role;

create or replace function public.delete_google_calendar_refresh_token(
  p_organization_id uuid,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select refresh_token_secret_id into v_secret_id
  from public.google_calendar_connections
  where organization_id = p_organization_id and owner_id = p_owner_id;

  if not found then
    return false;
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.google_calendar_connections
  set status = 'revoked',
      refresh_token_secret_id = null,
      updated_at = now()
  where organization_id = p_organization_id and owner_id = p_owner_id;

  return true;
end;
$$;

revoke all on function public.delete_google_calendar_refresh_token(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.delete_google_calendar_refresh_token(uuid, uuid)
  to service_role;
