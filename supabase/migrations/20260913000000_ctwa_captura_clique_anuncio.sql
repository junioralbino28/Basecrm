-- =============================================================================
-- 3a — Captura automática do clique de anúncio (Click-to-WhatsApp) — 2026-09-13
-- =============================================================================
-- Decisão do Junior (13/09): "toda a parte de mapeamento de lead e rastreamento de
-- conversão para voltar para a API da Meta". O requisito escrito em 10/09 (projeto
-- da Dra. Jéssica) diz que dois dados precisam viver na mesma linha: a ETIQUETA DO
-- CLIQUE (ctwa_clid), que chega com a primeira mensagem de quem veio de anúncio, e
-- o MOMENTO DO AGENDAMENTO, que a recepção marca. Esta migration cuida da primeira
-- ponta: guardar a etiqueta e o anúncio no histórico de origem que já existe
-- (lead_source_attributions, C2A), com primeiro/último toque no negócio.
--
-- Fonte do dado, conferida em 384 mensagens reais: a Evolution entrega
-- `contextInfo.externalAdReply` no evento messages.upsert, com ctwaClid, title,
-- sourceId (id do anúncio), sourceUrl, sourceApp ('instagram'/'facebook'),
-- sourceType ('ad') e mediaUrl. Nada disso é dado clínico. Não guardamos
-- thumbnail, corpo do anúncio nem a saudação automática.
--
-- Quem grava: só o servidor (o webhook da Evolution roda como service_role). Por
-- isso a função é SECURITY INVOKER e executável apenas pelo service_role, o mesmo
-- padrão de commercial_report_data. Cliente nenhum (anon/authenticated) chama isto;
-- a atribuição humana continua pela RPC record_lead_source_attribution.
--
-- `campaign` recebe o TÍTULO do anúncio: é o que o relatório comercial já agrupa
-- em "por campanha" (coalesce(utm_campaign, campaign)), então "qual anúncio fechou"
-- passa a aparecer lá sem mudar o relatório.
-- =============================================================================

alter table public.lead_source_attributions
  add column ctwa_clid text,
  add column ad_source_id text,
  add column ad_source_url text,
  add column ad_source_app text,
  add column ad_title text,
  add column ad_media_url text,
  add constraint lead_source_attributions_ctwa_not_blank
    check (ctwa_clid is null or btrim(ctwa_clid) <> ''),
  add constraint lead_source_attributions_ad_source_id_not_blank
    check (ad_source_id is null or btrim(ad_source_id) <> '');

create index lead_source_attributions_ctwa_clid
  on public.lead_source_attributions(organization_id, ctwa_clid)
  where ctwa_clid is not null;

create index lead_source_attributions_ad_source
  on public.lead_source_attributions(organization_id, ad_source_id, observed_at desc)
  where ad_source_id is not null;

create or replace function public.record_whatsapp_ad_attribution(
  p_organization_id uuid,
  p_channel_connection_id uuid,
  p_provider_message_id text,
  p_observed_at timestamptz,
  p_deal_id uuid default null,
  p_contact_id uuid default null,
  p_ctwa_clid text default null,
  p_ad_title text default null,
  p_ad_source_id text default null,
  p_ad_source_url text default null,
  p_ad_source_app text default null,
  p_ad_media_url text default null
)
returns public.lead_source_attributions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_name constant text := 'Anúncio Meta (WhatsApp)';
  v_source_code constant text := 'meta_whatsapp_ad';
  v_source public.lead_sources;
  v_attribution public.lead_source_attributions;
  v_ctwa text := nullif(btrim(coalesce(p_ctwa_clid, '')), '');
  v_ad_source_id text := nullif(btrim(coalesce(p_ad_source_id, '')), '');
  v_ad_title text := nullif(btrim(coalesce(p_ad_title, '')), '');
  v_message_id text := nullif(btrim(coalesce(p_provider_message_id, '')), '');
  v_idempotency text;
begin
  if p_organization_id is null or p_channel_connection_id is null then
    raise exception using errcode = '22023', message = 'Informe a organização e a conexão.';
  end if;
  if p_deal_id is null and p_contact_id is null then
    raise exception using errcode = '22023', message = 'Informe o negócio ou contato da atribuição.';
  end if;
  if v_message_id is null then
    raise exception using errcode = '22023', message = 'Informe o id da mensagem no provedor.';
  end if;
  if v_ctwa is null and v_ad_source_id is null then
    raise exception using errcode = '22023', message = 'Sem etiqueta do clique nem id do anúncio: nada a atribuir.';
  end if;
  if p_deal_id is not null and not exists (
    select 1 from public.deals where organization_id = p_organization_id and id = p_deal_id
  ) then
    raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.contacts where organization_id = p_organization_id and id = p_contact_id
  ) then
    raise exception using errcode = '23503', message = 'Contato não encontrado nesta organização.';
  end if;

  -- Origem canônica do clique em anúncio: uma por organização. Procura pelo código
  -- estável ou pelo nome normalizado; se não existe, cria. `on conflict do nothing`
  -- sem alvo cobre a corrida entre dois webhooks simultâneos em qualquer índice único.
  select * into v_source
  from public.lead_sources
  where organization_id = p_organization_id
    and (code = v_source_code
      or normalized_name = public.normalize_catalog_name(v_source_name))
  order by (code = v_source_code) desc, created_at
  limit 1;

  if v_source.id is null then
    insert into public.lead_sources (organization_id, name, code, active)
    values (p_organization_id, v_source_name, v_source_code, true)
    on conflict do nothing
    returning * into v_source;
  end if;
  if v_source.id is null then
    select * into strict v_source
    from public.lead_sources
    where organization_id = p_organization_id
      and (code = v_source_code
        or normalized_name = public.normalize_catalog_name(v_source_name))
    order by (code = v_source_code) desc, created_at
    limit 1;
  end if;

  -- Origem arquivada por alguém não pode engolir o dado: reativa. A atribuição
  -- humana recusa origem arquivada; a automática prefere não perder o clique.
  if not v_source.active or v_source.archived_at is not null then
    update public.lead_sources
    set active = true, archived_at = null, archived_by = null
    where id = v_source.id
    returning * into v_source;
  end if;

  v_idempotency := 'ctwa:' || p_channel_connection_id::text || ':' || v_message_id;

  insert into public.lead_source_attributions (
    organization_id, deal_id, contact_id, source_id, attribution_state,
    observed_at, channel, campaign, provenance, external_event_id, idempotency_key,
    ctwa_clid, ad_source_id, ad_source_url, ad_source_app, ad_title, ad_media_url,
    raw_data, recorded_at
  ) values (
    p_organization_id, p_deal_id, p_contact_id, v_source.id, 'known',
    coalesce(p_observed_at, now()), 'whatsapp', v_ad_title, 'automatic',
    v_idempotency, v_idempotency,
    v_ctwa, v_ad_source_id,
    nullif(btrim(coalesce(p_ad_source_url, '')), ''),
    lower(nullif(btrim(coalesce(p_ad_source_app, '')), '')),
    v_ad_title,
    nullif(btrim(coalesce(p_ad_media_url, '')), ''),
    jsonb_build_object(
      'source', 'evolution_external_ad_reply',
      'provider_message_id', v_message_id,
      'source_type', 'ad'
    ),
    now()
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into v_attribution;

  if v_attribution.id is null then
    -- Replay do mesmo evento (a Evolution reenvia): devolve o que já existe e não
    -- mexe nos ponteiros de novo.
    select * into strict v_attribution
    from public.lead_source_attributions
    where organization_id = p_organization_id
      and idempotency_key = v_idempotency;
    return v_attribution;
  end if;

  if p_deal_id is not null then
    update public.deals
    set first_lead_source_id = coalesce(first_lead_source_id, v_source.id),
        last_lead_source_id = v_source.id
    where organization_id = p_organization_id and id = p_deal_id;
  end if;

  -- Ponte da dívida 7c: a Visão Geral ainda agrupa "de onde vem o lead" por
  -- contacts.source (texto). Preenche só quando está vazio; a escolha humana feita
  -- no card nunca é sobrescrita pelo automático.
  if p_contact_id is not null then
    update public.contacts
    set source = v_source.name
    where organization_id = p_organization_id
      and id = p_contact_id
      and nullif(btrim(coalesce(source, '')), '') is null;
  end if;

  return v_attribution;
end;
$$;

revoke all on function public.record_whatsapp_ad_attribution(
  uuid, uuid, text, timestamptz, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_whatsapp_ad_attribution(
  uuid, uuid, text, timestamptz, uuid, uuid, text, text, text, text, text, text
) to service_role;
