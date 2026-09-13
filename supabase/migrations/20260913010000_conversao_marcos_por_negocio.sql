-- =============================================================================
-- 3b — Marcos de conversão por negócio (agendou / compareceu / faltou / fechou)
-- =============================================================================
-- Requisito (10/09, projeto da Dra. Jéssica): "os dois dados que precisam viver na
-- mesma linha" são a etiqueta do clique (3a) e o MOMENTO do agendamento. E depois:
-- compareceu, fechou com valor. Cada um vira uma linha em deal_conversion_events,
-- append-only, com id único por evento (meta_event_id) para o envio à Meta (3c)
-- nunca contar duas vezes.
--
-- Quem preenche: NINGUÉM, à mão. A recepção continua marcando onde já marca:
--   • cria a consulta na agenda        → 'scheduled'  (a agenda passa a apontar o negócio)
--   • muda o status para 'compareceu'  → 'attended'   (na hora da consulta)
--   • muda o status para 'faltou'      → 'no_show'    (nunca vai para a Meta: meta_status = skipped)
--   • marca o negócio como ganho       → 'won' com o valor do negócio
-- O ganho é gravado por UPDATE direto em 9 lugares do app (tela, inbox, API pública,
-- ferramenta da IA) e não só pela RPC mark_deal_won: por isso o marco nasce de um
-- gatilho na própria tabela deals, que cobre todos os caminhos.
--
-- A agenda ganha deal_id. Se a recepção não escolher, o gatilho liga a consulta ao
-- negócio aberto mais recente do contato (a mesma regra que o webhook usa para a
-- conversa). O espelho do Clinicorp grava sem contato: não liga e não gera marco.
--
-- Arrependimento: se o status sai de 'compareceu' antes do envio, o marco 'attended'
-- pendente vira 'skipped'; se o negócio é reaberto, o 'won' pendente vira 'skipped'.
-- Fatos já enviados à Meta ficam como estão (a 3c decide se estorna).
--
-- Segurança: cliente autenticado só LÊ os marcos da própria organização. Escrita é
-- exclusiva dos gatilhos (SECURITY DEFINER, search_path vazio, EXECUTE revogado de
-- todo mundo) e do service_role (3c). Backfill: só o deal_id das consultas antigas
-- com contato; nenhum marco retroativo (a janela da Meta não os aceitaria).
-- =============================================================================

-- ---------------------------------------------------------------- agenda → negócio
alter table public.appointments
  add column deal_id uuid,
  add constraint appointments_deal_same_org_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete set null;

create index idx_appointments_org_deal
  on public.appointments(organization_id, deal_id)
  where deal_id is not null;

-- ---------------------------------------------------------------- marcos
create table public.deal_conversion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  contact_id uuid,
  appointment_id uuid,
  event_type text not null,
  occurred_at timestamptz not null,
  source text not null,
  value numeric(14, 2),
  idempotency_key text not null,
  meta_event_id uuid not null default gen_random_uuid(),
  meta_status text not null default 'pending',
  meta_attempts integer not null default 0,
  meta_last_error text,
  meta_sent_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint deal_conversion_events_type_known
    check (event_type in ('replied', 'scheduled', 'attended', 'no_show', 'won')),
  constraint deal_conversion_events_source_known
    check (source in ('reception', 'agenda', 'clinicorp', 'automation', 'api', 'system')),
  constraint deal_conversion_events_meta_status_known
    check (meta_status in ('pending', 'sent', 'error', 'skipped')),
  constraint deal_conversion_events_value_nonnegative
    check (value is null or value >= 0),
  constraint deal_conversion_events_idempotency_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint deal_conversion_events_idempotency_unique
    unique (organization_id, idempotency_key),
  constraint deal_conversion_events_meta_event_unique
    unique (organization_id, meta_event_id),
  constraint deal_conversion_events_org_id_unique
    unique (organization_id, id),
  constraint deal_conversion_events_deal_same_org_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint deal_conversion_events_contact_same_org_fk
    foreign key (organization_id, contact_id)
    references public.contacts(organization_id, id)
    on delete set null,
  constraint deal_conversion_events_appointment_fk
    foreign key (appointment_id)
    references public.appointments(id)
    on delete set null
);

create index idx_deal_conversion_events_deal
  on public.deal_conversion_events(organization_id, deal_id, occurred_at desc);
create index idx_deal_conversion_events_pending
  on public.deal_conversion_events(organization_id, occurred_at)
  where meta_status = 'pending';
create index idx_deal_conversion_events_type_period
  on public.deal_conversion_events(organization_id, event_type, occurred_at);

alter table public.deal_conversion_events enable row level security;

-- Os privilégios padrão do Supabase dão a anon/authenticated TRUNCATE, REFERENCES e
-- TRIGGER em toda tabela nova (achado R-09 da reverificação). TRUNCATE ignora RLS.
-- Zera e concede só o que cada papel precisa.
revoke all on table public.deal_conversion_events from public, anon, authenticated;
grant select on table public.deal_conversion_events to authenticated;
grant all on table public.deal_conversion_events to service_role;

create policy "deal_conversion_events_select_by_tenant"
  on public.deal_conversion_events for select to authenticated
  using (public.can_access_organization(organization_id));

-- ---------------------------------------------------------------- gatilho: agenda aponta o negócio
create or replace function public.appointments_link_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deal_id is null and new.contact_id is not null then
    select d.id into new.deal_id
    from public.deals d
    where d.organization_id = new.organization_id
      and d.contact_id = new.contact_id
      and d.is_won = false
      and d.is_lost = false
    order by d.updated_at desc, d.created_at desc
    limit 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- gatilho: marcos da agenda
create or replace function public.appointments_conversion_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := case when new.source = 'clinicorp_api' then 'clinicorp' else 'agenda' end;
  v_actor uuid := (select auth.uid());
begin
  if new.deal_id is null then
    return new;
  end if;

  -- 'scheduled': ao nascer ligada a um negócio, ou ao ser ligada depois.
  if tg_op = 'INSERT' or old.deal_id is distinct from new.deal_id then
    insert into public.deal_conversion_events (
      organization_id, deal_id, contact_id, appointment_id, event_type, occurred_at,
      source, idempotency_key, created_by
    ) values (
      new.organization_id, new.deal_id, new.contact_id, new.id, 'scheduled', now(),
      v_source, 'scheduled:' || new.id::text, v_actor
    )
    on conflict (organization_id, idempotency_key) do nothing;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'compareceu' then
      insert into public.deal_conversion_events (
        organization_id, deal_id, contact_id, appointment_id, event_type, occurred_at,
        source, idempotency_key, created_by
      ) values (
        new.organization_id, new.deal_id, new.contact_id, new.id, 'attended', new.starts_at,
        v_source, 'attended:' || new.id::text, v_actor
      )
      on conflict (organization_id, idempotency_key) do nothing;
    elsif old.status = 'compareceu' then
      -- Arrependimento antes do envio: o marco pendente deixa de valer.
      update public.deal_conversion_events
      set meta_status = 'skipped'
      where organization_id = new.organization_id
        and idempotency_key = 'attended:' || new.id::text
        and meta_status = 'pending';
    end if;

    if new.status = 'faltou' then
      insert into public.deal_conversion_events (
        organization_id, deal_id, contact_id, appointment_id, event_type, occurred_at,
        source, idempotency_key, meta_status, created_by
      ) values (
        new.organization_id, new.deal_id, new.contact_id, new.id, 'no_show', new.starts_at,
        v_source, 'no_show:' || new.id::text, 'skipped', v_actor
      )
      on conflict (organization_id, idempotency_key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------- gatilho: marco do ganho
create or replace function public.deals_conversion_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_closed timestamptz := coalesce(new.closed_at, now());
begin
  if new.is_won and (tg_op = 'INSERT' or not coalesce(old.is_won, false)) then
    insert into public.deal_conversion_events (
      organization_id, deal_id, contact_id, event_type, occurred_at, source, value,
      idempotency_key, created_by
    ) values (
      new.organization_id, new.id, new.contact_id, 'won', v_closed,
      case when v_actor is null then 'system' else 'reception' end,
      coalesce(new.value, 0),
      'won:' || new.id::text || ':' || to_char(v_closed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
      v_actor
    )
    on conflict (organization_id, idempotency_key) do nothing;
  elsif tg_op = 'UPDATE' and coalesce(old.is_won, false) and not new.is_won then
    -- Reaberto antes do envio: o ganho pendente deixa de valer.
    update public.deal_conversion_events
    set meta_status = 'skipped'
    where organization_id = new.organization_id
      and deal_id = new.id
      and event_type = 'won'
      and meta_status = 'pending';
  end if;
  return new;
end;
$$;

revoke all on function public.appointments_link_deal() from public, anon, authenticated;
revoke all on function public.appointments_conversion_events() from public, anon, authenticated;
revoke all on function public.deals_conversion_events() from public, anon, authenticated;

-- ---------------------------------------------------------------- backfill (só o vínculo, nenhum marco retroativo)
-- Roda ANTES de ligar os gatilhos: consultas antigas ganham deal_id para os relatórios,
-- mas não geram 'scheduled' (a janela da Meta não os aceitaria e seriam lixo pendente).
update public.appointments a
set deal_id = (
  select d.id
  from public.deals d
  where d.organization_id = a.organization_id
    and d.contact_id = a.contact_id
    and d.is_won = false
    and d.is_lost = false
  order by d.updated_at desc, d.created_at desc
  limit 1
)
where a.deal_id is null
  and a.contact_id is not null;

create trigger appointments_link_deal
  before insert or update of contact_id, deal_id on public.appointments
  for each row execute function public.appointments_link_deal();

create trigger appointments_conversion_events
  after insert or update of status, deal_id on public.appointments
  for each row execute function public.appointments_conversion_events();

create trigger deals_conversion_events
  after insert or update of is_won on public.deals
  for each row execute function public.deals_conversion_events();
