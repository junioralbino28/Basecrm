-- =============================================================================
-- 3c — Envio dos marcos à Meta (Conversions API for Business Messaging)
-- =============================================================================
-- Requisito (10/09): o CRM dispara o evento no momento em que o status muda, nunca em
-- lote no fim do mês; reenvio leva o mesmo id (a Meta não deduplica eventos de
-- mensageria — está na doc); nunca sai procedimento nem dado clínico.
--
-- Doc da Meta lida na fonte (13/09): POST /{DATASET_ID}/events com
-- action_source = 'business_messaging', messaging_channel = 'whatsapp' e
-- user_data.ctwa_clid (sem hash); event_time até 7 dias antes do envio; eventos
-- suportados para mensageria: Purchase, LeadSubmitted, InitiateCheckout, AddToCart,
-- ViewContent, OrderCreated, OrderShipped, OrderDelivered, OrderCanceled,
-- OrderReturned, CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided.
--
-- Esta migration guarda a configuração por cliente e dá ao despachante (Next.js,
-- service_role) duas funções: reservar marcos pendentes com lease (dois despachantes
-- não pegam o mesmo) e concluir cada um (sent / error / skipped / pending com retry).
--
-- Segurança: o token de acesso segue o padrão do M6 para as chaves de IA — a tabela
-- não tem SELECT para authenticated; concede-se SELECT por coluna só nas colunas que
-- não são segredo. Escrita da configuração continua pelo RLS can_configure. As duas
-- funções são executáveis só pelo service_role.
-- =============================================================================

alter table public.organization_settings
  add column meta_capi_enabled boolean not null default false,
  add column meta_capi_dataset_id text,
  add column meta_capi_access_token text,
  add column meta_capi_test_event_code text,
  add column meta_capi_send_value boolean not null default false,
  add column meta_capi_event_map jsonb not null
    default '{"replied": "LeadSubmitted", "scheduled": "QualifiedLead", "attended": null, "won": "Purchase"}'::jsonb,
  add column conversion_region_ddds text[] not null default '{}',
  add constraint organization_settings_meta_capi_event_map_object
    check (jsonb_typeof(meta_capi_event_map) = 'object'),
  add constraint organization_settings_meta_capi_dataset_not_blank
    check (meta_capi_dataset_id is null or btrim(meta_capi_dataset_id) <> '');

-- O token NÃO entra aqui: sem SELECT para o navegador, como ai_google_key (M6).
grant select (
  meta_capi_enabled, meta_capi_dataset_id, meta_capi_test_event_code,
  meta_capi_send_value, meta_capi_event_map, conversion_region_ddds
) on public.organization_settings to authenticated;

alter table public.deal_conversion_events
  add column meta_lease_until timestamptz,
  add column meta_skip_reason text;

-- ---------------------------------------------------------------- reservar pendentes
create or replace function public.claim_conversion_events(
  p_batch_limit integer default 50,
  p_lease_seconds integer default 120
)
returns setof public.deal_conversion_events
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  with candidatos as (
    select e.id
    from public.deal_conversion_events e
    join public.organization_settings s on s.organization_id = e.organization_id
    where e.meta_status = 'pending'
      and (e.meta_lease_until is null or e.meta_lease_until < now())
      and s.meta_capi_enabled = true
      and nullif(btrim(coalesce(s.meta_capi_dataset_id, '')), '') is not null
      and nullif(btrim(coalesce(s.meta_capi_access_token, '')), '') is not null
    order by e.occurred_at
    limit greatest(1, least(coalesce(p_batch_limit, 50), 200))
    for update of e skip locked
  )
  update public.deal_conversion_events e
  set meta_lease_until = now() + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 120))),
      meta_attempts = e.meta_attempts + 1
  from candidatos c
  where e.id = c.id
  returning e.*;
end;
$$;

-- ---------------------------------------------------------------- concluir um marco
create or replace function public.complete_conversion_event(
  p_organization_id uuid,
  p_event_id uuid,
  p_status text,
  p_error text default null,
  p_skip_reason text default null,
  p_retry_in_seconds integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_status not in ('sent', 'error', 'skipped', 'pending') then
    raise exception using errcode = '22023', message = 'Status de envio desconhecido.';
  end if;

  update public.deal_conversion_events
  set meta_status = p_status,
      meta_sent_at = case when p_status = 'sent' then now() else meta_sent_at end,
      meta_last_error = case when p_status in ('error', 'pending') then nullif(btrim(coalesce(p_error, '')), '') else null end,
      meta_skip_reason = case when p_status = 'skipped' then nullif(btrim(coalesce(p_skip_reason, '')), '') else null end,
      meta_lease_until = case
        when p_status = 'pending' and p_retry_in_seconds is not null
          then now() + make_interval(secs => greatest(30, p_retry_in_seconds))
        else null
      end
  where organization_id = p_organization_id
    and id = p_event_id;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.claim_conversion_events(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_conversion_events(integer, integer)
  to service_role;
revoke all on function public.complete_conversion_event(uuid, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.complete_conversion_event(uuid, uuid, text, text, text, integer)
  to service_role;
