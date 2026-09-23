-- Reconectar o Google NAO pode mais apagar a agenda escolhida.
--
-- Defeito medido em producao (22/09): o callback do OAuth sempre chama a RPC com
-- `p_google_calendar_id = 'primary'`, e o `on conflict do update` gravava esse valor por cima.
-- Resultado: toda reconexao devolvia a IA para a agenda PRINCIPAL da conta, em silencio —
-- a tela continuava mostrando o nome da agenda antiga (`google_calendar_summary` nao era
-- tocado), entao ninguem via o estrago ate os eventos comecarem a nascer no lugar errado.
-- Vale para todo cliente, nao so para a CENNO HUB.
--
-- Regra nova: a escolha (agenda de escrita + nome + agendas que contam como ocupado) e
-- PRESERVADA na reconexao, EXCETO quando a conta Google mudou — ids de agenda de outra conta
-- nao existem para a nova, e manter levaria a 404 em toda tentativa de criar evento.
--
-- Cabecalho de seguranca identico ao da 20260922010000 (definer, search_path vazio, grant so
-- para service_role); o corpo so muda no bloco `do update`.

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
    -- PRESERVA a escolha do usuario; so volta para `primary` se a CONTA Google mudou.
    google_calendar_id = case
      when public.google_calendar_connections.google_account_email
             is distinct from excluded.google_account_email
        then 'primary'
      else public.google_calendar_connections.google_calendar_id
    end,
    google_calendar_summary = case
      when public.google_calendar_connections.google_account_email
             is distinct from excluded.google_account_email
        then null
      else public.google_calendar_connections.google_calendar_summary
    end,
    busy_calendar_ids = case
      when public.google_calendar_connections.google_account_email
             is distinct from excluded.google_account_email
        then '{}'::text[]
      else public.google_calendar_connections.busy_calendar_ids
    end,
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
