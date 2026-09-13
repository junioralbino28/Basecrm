-- =============================================================================
-- 3d — Marco "lead respondeu e é da região" (evento intermediário para otimização)
-- =============================================================================
-- Requisito (10/09): "A Meta precisa de perto de 50 eventos por semana em cada
-- conjunto para conseguir otimizar por um evento. Agendamento não tem esse volume.
-- Por isso 'Agendou' entra como MEDIÇÃO, e quem carrega a otimização é o evento
-- intermediário, mais raso e mais frequente: lead respondeu e é da região."
--
-- Critério de região (decisão assumida em 13/09, o Junior pode virar): a lista de
-- DDDs do cliente (organization_settings.conversion_region_ddds, criada na 3c). Lista
-- vazia = qualquer região conta. Número sem 55 na frente não é do Brasil e, com lista
-- configurada, não é da região.
--
-- O marco nasce SEMPRE (fato do funil: "respondeu"); quando está fora da região ele já
-- nasce 'skipped' com motivo 'fora_da_regiao', então nunca vai à Meta mas conta no
-- relatório. Um por negócio (idempotência 'replied:<negócio>').
--
-- Quem chama: só o servidor (webhook da Evolution, service_role), quando chega uma
-- mensagem do lead numa conversa em que a clínica já tinha falado antes.
-- =============================================================================

create or replace function public.record_lead_replied_event(
  p_organization_id uuid,
  p_deal_id uuid,
  p_contact_id uuid,
  p_occurred_at timestamptz,
  p_phone text
)
returns public.deal_conversion_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ddds text[];
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_ddd text;
  v_na_regiao boolean;
  v_row public.deal_conversion_events;
begin
  if p_organization_id is null or p_deal_id is null then
    raise exception using errcode = '22023', message = 'Informe a organização e o negócio.';
  end if;
  if not exists (
    select 1 from public.deals where organization_id = p_organization_id and id = p_deal_id
  ) then
    raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
  end if;

  select coalesce(conversion_region_ddds, '{}') into v_ddds
  from public.organization_settings
  where organization_id = p_organization_id;
  v_ddds := coalesce(v_ddds, '{}');

  -- Brasil: 55 + DDD (2 dígitos) + número (8 ou 9 dígitos).
  v_ddd := case
    when v_digits like '55%' and length(v_digits) between 12 and 13 then substr(v_digits, 3, 2)
    else null
  end;
  v_na_regiao := coalesce(array_length(v_ddds, 1), 0) = 0 or (v_ddd is not null and v_ddd = any(v_ddds));

  insert into public.deal_conversion_events (
    organization_id, deal_id, contact_id, event_type, occurred_at, source,
    idempotency_key, meta_status, meta_skip_reason
  ) values (
    p_organization_id, p_deal_id, p_contact_id, 'replied', coalesce(p_occurred_at, now()), 'system',
    'replied:' || p_deal_id::text,
    case when v_na_regiao then 'pending' else 'skipped' end,
    case when v_na_regiao then null else 'fora_da_regiao' end
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning * into v_row;

  -- Já existia: devolve o que está lá (nada muda).
  if v_row.id is null then
    select * into v_row
    from public.deal_conversion_events
    where organization_id = p_organization_id
      and idempotency_key = 'replied:' || p_deal_id::text;
  end if;
  return v_row;
end;
$$;

revoke all on function public.record_lead_replied_event(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_lead_replied_event(uuid, uuid, uuid, timestamptz, text)
  to service_role;
