-- =============================================================================
-- C2A — taxonomia de etiquetas e atribuições auditáveis
-- =============================================================================
-- public.tags já existe. Esta migration preserva id/name/color e acrescenta a
-- identidade operacional necessária. deals.tags permanece como ponte v2.
-- =============================================================================

create or replace function public.normalize_catalog_name(p_value text)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select lower(
    regexp_replace(
      public.unaccent(normalize(btrim(p_value), NFKC)),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

revoke all on function public.normalize_catalog_name(text) from public;
grant execute on function public.normalize_catalog_name(text) to authenticated, service_role;

create table public.tag_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  normalized_name text not null,
  cardinality text not null default 'multiple',
  code text,
  archived_at timestamptz,
  archived_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_categories_label_not_blank check (btrim(label) <> ''),
  constraint tag_categories_normalized_not_blank check (btrim(normalized_name) <> ''),
  constraint tag_categories_cardinality_known check (cardinality in ('single', 'multiple')),
  constraint tag_categories_code_not_blank check (code is null or btrim(code) <> ''),
  constraint tag_categories_archive_actor_consistent
    check ((archived_at is null and archived_by is null) or archived_at is not null),
  constraint tag_categories_org_id_unique unique (organization_id, id),
  constraint tag_categories_name_unique unique (organization_id, normalized_name),
  constraint tag_categories_code_unique unique (organization_id, code)
);

alter table public.tags
  add column category_id uuid,
  add column normalized_name text,
  add column code text,
  add column legacy_value text,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null,
  add column created_by uuid references public.profiles(id) on delete set null,
  add column updated_by uuid references public.profiles(id) on delete set null,
  add column updated_at timestamptz not null default now();

alter table public.tags
  add constraint tags_category_same_org_fk
    foreign key (organization_id, category_id)
    references public.tag_categories(organization_id, id)
    on delete restrict,
  add constraint tags_name_not_blank check (btrim(name) <> ''),
  add constraint tags_normalized_not_blank
    check (normalized_name is null or btrim(normalized_name) <> ''),
  add constraint tags_code_not_blank check (code is null or btrim(code) <> ''),
  add constraint tags_archive_actor_consistent
    check ((archived_at is null and archived_by is null) or archived_at is not null),
  add constraint tags_org_id_category_unique unique (organization_id, id, category_id),
  add constraint tags_normalized_name_unique
    unique (organization_id, category_id, normalized_name),
  add constraint tags_code_unique unique (organization_id, code);

create table public.deal_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null,
  category_id uuid not null,
  tag_id uuid not null,
  is_primary boolean not null default false,
  provenance text not null,
  applied_at timestamptz,
  applied_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  constraint deal_tag_assignments_provenance_known
    check (provenance in ('human', 'ai', 'automation', 'api', 'import', 'legacy_migration')),
  constraint deal_tag_assignments_legacy_unknown_history check (
    (provenance = 'legacy_migration' and applied_at is null and applied_by is null)
    or (provenance <> 'legacy_migration' and applied_at is not null)
  ),
  constraint deal_tag_assignments_removal_consistent check (
    (removed_at is null and removed_by is null)
    or removed_at is not null
  ),
  constraint deal_tag_assignments_deal_same_org_fk
    foreign key (organization_id, deal_id)
    references public.deals(organization_id, id)
    on delete cascade,
  constraint deal_tag_assignments_category_same_org_fk
    foreign key (organization_id, category_id)
    references public.tag_categories(organization_id, id)
    on delete restrict,
  constraint deal_tag_assignments_tag_same_org_category_fk
    foreign key (organization_id, tag_id, category_id)
    references public.tags(organization_id, id, category_id)
    on delete restrict,
  constraint deal_tag_assignments_org_id_unique unique (organization_id, id)
);

create unique index deal_tag_assignments_active_tag_unique
  on public.deal_tag_assignments(organization_id, deal_id, tag_id)
  where removed_at is null;
create unique index deal_tag_assignments_primary_category_unique
  on public.deal_tag_assignments(organization_id, deal_id, category_id)
  where removed_at is null and is_primary;
create index deal_tag_assignments_active_tag_usage
  on public.deal_tag_assignments(organization_id, tag_id, deal_id)
  where removed_at is null;
create index deal_tag_assignments_history
  on public.deal_tag_assignments(organization_id, recorded_at desc);

create or replace function public.prepare_tag_category_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.label := regexp_replace(btrim(new.label), '\s+', ' ', 'g');
  new.normalized_name := public.normalize_catalog_name(new.label);
  new.code := nullif(btrim(new.code), '');

  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
    new.updated_by := new.created_by;
  else
    if new.organization_id is distinct from old.organization_id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
    then
      raise exception using errcode = '23514', message = 'campos de identidade e auditoria da categoria são imutáveis';
    end if;
    if new.code is distinct from old.code and old.code is not null then
      raise exception using errcode = '23514', message = 'o código estável da categoria é imutável';
    end if;
    if new.cardinality is distinct from old.cardinality and exists (
      select 1 from public.deal_tag_assignments a
      where a.organization_id = old.organization_id and a.category_id = old.id
    ) then
      raise exception using
        errcode = '55000',
        message = 'Esta categoria já foi usada. Remova ou migre as atribuições antes de alterar a cardinalidade.';
    end if;
    if (select auth.uid()) is not null then
      new.updated_by := (select auth.uid());
      if new.archived_at is not null and old.archived_at is null then
        new.archived_by := (select auth.uid());
      elsif new.archived_at is null then
        new.archived_by := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_tag_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.normalized_name := public.normalize_catalog_name(new.name);
  new.code := nullif(btrim(new.code), '');

  if tg_op = 'INSERT' then
    new.legacy_value := coalesce(nullif(btrim(new.legacy_value), ''), new.name);
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
    new.updated_by := new.created_by;
  else
    if new.organization_id is distinct from old.organization_id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
    then
      raise exception using errcode = '23514', message = 'campos de identidade e auditoria da etiqueta são imutáveis';
    end if;
    if old.legacy_value is not null and new.legacy_value is distinct from old.legacy_value then
      raise exception using errcode = '23514', message = 'legacy_value é uma ponte imutável para automações v2';
    end if;
    if new.category_id is distinct from old.category_id and exists (
      select 1 from public.deal_tag_assignments a
      where a.organization_id = old.organization_id and a.tag_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'Etiqueta em uso não pode mudar de categoria.';
    end if;
    if new.code is distinct from old.code and old.code is not null then
      raise exception using errcode = '23514', message = 'o código estável da etiqueta é imutável';
    end if;
    if (select auth.uid()) is not null then
      new.updated_by := (select auth.uid());
      if new.archived_at is not null and old.archived_at is null then
        new.archived_by := (select auth.uid());
      elsif new.archived_at is null then
        new.archived_by := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_tag_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.deal_tag_assignments where tag_id = old.id) then
    raise exception using
      errcode = '55000',
      message = 'Etiqueta com histórico não pode ser apagada. Arquive a etiqueta.';
  end if;
  return old;
end;
$$;

create or replace function public.guard_tag_category_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.tags where category_id = old.id) then
    raise exception using
      errcode = '55000',
      message = 'A categoria possui etiquetas. Arquive ou mova as etiquetas antes de apagar a categoria.';
  end if;
  return old;
end;
$$;

revoke all on function public.prepare_tag_category_write() from public, anon, authenticated;
revoke all on function public.prepare_tag_write() from public, anon, authenticated;
revoke all on function public.guard_tag_hard_delete() from public, anon, authenticated;
revoke all on function public.guard_tag_category_delete() from public, anon, authenticated;

create trigger prepare_tag_category_write
  before insert or update on public.tag_categories
  for each row execute function public.prepare_tag_category_write();
create trigger update_tag_categories_updated_at
  before update on public.tag_categories
  for each row execute function public.update_updated_at_column();
create trigger guard_tag_category_delete
  before delete on public.tag_categories
  for each row execute function public.guard_tag_category_delete();

create trigger prepare_tag_write
  before insert or update on public.tags
  for each row execute function public.prepare_tag_write();
create trigger update_tags_updated_at
  before update on public.tags
  for each row execute function public.update_updated_at_column();
create trigger guard_tag_hard_delete
  before delete on public.tags
  for each row execute function public.guard_tag_hard_delete();

alter table public.tag_categories enable row level security;
alter table public.deal_tag_assignments enable row level security;

grant select, insert, update, delete on table public.tag_categories to authenticated;
grant select on table public.deal_tag_assignments to authenticated;
grant all on table public.tag_categories, public.deal_tag_assignments to service_role;

drop policy if exists "tags_mutate_by_tenant_operator" on public.tags;

create policy "tag_categories_select_by_tenant"
  on public.tag_categories for select to authenticated
  using (public.can_access_organization(organization_id));
create policy "tag_categories_insert_by_manager"
  on public.tag_categories for insert to authenticated
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );
create policy "tag_categories_update_by_manager"
  on public.tag_categories for update to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );
create policy "tag_categories_delete_by_manager"
  on public.tag_categories for delete to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );

create policy "tags_insert_by_manager"
  on public.tags for insert to authenticated
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );
create policy "tags_update_by_manager"
  on public.tags for update to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  )
  with check (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );
create policy "tags_delete_by_manager"
  on public.tags for delete to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.manage')
  );

create policy "deal_tag_assignments_select_by_tenant"
  on public.deal_tag_assignments for select to authenticated
  using (
    public.can_access_organization(organization_id)
    and public.has_permission('tags.assign')
  );

create or replace function public.get_or_create_tag_category(
  p_organization_id uuid,
  p_label text,
  p_cardinality text default 'multiple'
)
returns public.tag_categories
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category public.tag_categories;
  v_label text := regexp_replace(btrim(p_label), '\s+', ' ', 'g');
  v_normalized text := public.normalize_catalog_name(p_label);
begin
  if not public.can_access_organization(p_organization_id)
    or not public.has_permission('tags.manage')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar categorias de etiquetas.';
  end if;
  if v_normalized = '' then
    raise exception using errcode = '22023', message = 'Informe o nome da categoria.';
  end if;
  if p_cardinality not in ('single', 'multiple') then
    raise exception using errcode = '22023', message = 'Cardinalidade deve ser single ou multiple.';
  end if;

  insert into public.tag_categories (organization_id, label, normalized_name, cardinality)
  values (p_organization_id, v_label, v_normalized, p_cardinality)
  on conflict (organization_id, normalized_name) do nothing
  returning * into v_category;

  if v_category.id is null then
    select * into strict v_category
    from public.tag_categories
    where organization_id = p_organization_id and normalized_name = v_normalized;
  end if;
  return v_category;
end;
$$;

create or replace function public.get_or_create_tag(
  p_organization_id uuid,
  p_category_id uuid,
  p_name text,
  p_color text default 'bg-gray-500',
  p_code text default null
)
returns public.tags
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tag public.tags;
  v_name text := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  v_normalized text := public.normalize_catalog_name(p_name);
begin
  if not public.can_access_organization(p_organization_id)
    or not public.has_permission('tags.manage')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar etiquetas.';
  end if;
  if v_normalized = '' then
    raise exception using errcode = '22023', message = 'Informe o nome da etiqueta.';
  end if;
  if not exists (
    select 1 from public.tag_categories
    where organization_id = p_organization_id and id = p_category_id and archived_at is null
  ) then
    raise exception using errcode = '23503', message = 'Categoria não encontrada ou arquivada.';
  end if;

  insert into public.tags (
    organization_id, category_id, name, normalized_name, color, code, legacy_value
  ) values (
    p_organization_id, p_category_id, v_name, v_normalized,
    coalesce(nullif(btrim(p_color), ''), 'bg-gray-500'), nullif(btrim(p_code), ''), v_name
  )
  on conflict (organization_id, category_id, normalized_name) do nothing
  returning * into v_tag;

  if v_tag.id is null then
    select * into strict v_tag
    from public.tags
    where organization_id = p_organization_id
      and category_id = p_category_id
      and normalized_name = v_normalized;
  end if;
  return v_tag;
end;
$$;

create or replace function public.assign_deal_tag(
  p_organization_id uuid,
  p_deal_id uuid,
  p_tag_id uuid,
  p_is_primary boolean default false
)
returns public.deal_tag_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tag public.tags;
  v_category public.tag_categories;
  v_assignment public.deal_tag_assignments;
  v_make_primary boolean;
  v_removed_legacy text;
begin
  if (select auth.uid()) is null
    or not public.can_access_organization(p_organization_id)
    or not public.has_permission('tags.assign')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para aplicar etiquetas.';
  end if;

  perform 1 from public.deals
  where organization_id = p_organization_id and id = p_deal_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
  end if;

  select t.* into strict v_tag
  from public.tags t
  where t.organization_id = p_organization_id
    and t.id = p_tag_id
    and t.category_id is not null
    and t.archived_at is null;
  select c.* into strict v_category
  from public.tag_categories c
  where c.organization_id = p_organization_id
    and c.id = v_tag.category_id
    and c.archived_at is null;

  select * into v_assignment
  from public.deal_tag_assignments
  where organization_id = p_organization_id
    and deal_id = p_deal_id
    and tag_id = p_tag_id
    and removed_at is null
  for update;

  if v_assignment.id is not null then
    if p_is_primary and not v_assignment.is_primary then
      update public.deal_tag_assignments
      set is_primary = false
      where organization_id = p_organization_id
        and deal_id = p_deal_id
        and category_id = v_tag.category_id
        and removed_at is null;
      update public.deal_tag_assignments
      set is_primary = true
      where id = v_assignment.id
      returning * into v_assignment;
    end if;
    return v_assignment;
  end if;

  if v_category.cardinality = 'single' then
    for v_removed_legacy in
      update public.deal_tag_assignments a
      set removed_at = now(), removed_by = (select auth.uid()), is_primary = false
      from public.tags old_tag
      where a.organization_id = p_organization_id
        and a.deal_id = p_deal_id
        and a.category_id = v_tag.category_id
        and a.removed_at is null
        and old_tag.id = a.tag_id
      returning old_tag.legacy_value
    loop
      update public.deals
      set tags = array_remove(coalesce(tags, '{}'::text[]), v_removed_legacy)
      where organization_id = p_organization_id and id = p_deal_id;
    end loop;
  end if;

  v_make_primary := p_is_primary or not exists (
    select 1 from public.deal_tag_assignments
    where organization_id = p_organization_id
      and deal_id = p_deal_id
      and category_id = v_tag.category_id
      and removed_at is null
  );
  if v_make_primary then
    update public.deal_tag_assignments
    set is_primary = false
    where organization_id = p_organization_id
      and deal_id = p_deal_id
      and category_id = v_tag.category_id
      and removed_at is null;
  end if;

  insert into public.deal_tag_assignments (
    organization_id, deal_id, category_id, tag_id, is_primary,
    provenance, applied_at, applied_by, recorded_at
  ) values (
    p_organization_id, p_deal_id, v_tag.category_id, p_tag_id, v_make_primary,
    'human', now(), (select auth.uid()), now()
  ) returning * into v_assignment;

  update public.deals
  set tags = case
    when array_position(coalesce(tags, '{}'::text[]), v_tag.legacy_value) is null
      then array_append(coalesce(tags, '{}'::text[]), v_tag.legacy_value)
    else tags
  end
  where organization_id = p_organization_id and id = p_deal_id;

  return v_assignment;
end;
$$;

create or replace function public.remove_deal_tag(
  p_organization_id uuid,
  p_deal_id uuid,
  p_tag_id uuid
)
returns public.deal_tag_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.deal_tag_assignments;
  v_legacy_value text;
begin
  if (select auth.uid()) is null
    or not public.can_access_organization(p_organization_id)
    or not public.has_permission('tags.assign')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para remover etiquetas.';
  end if;
  perform 1 from public.deals
  where organization_id = p_organization_id and id = p_deal_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
  end if;

  update public.deal_tag_assignments
  set removed_at = now(), removed_by = (select auth.uid()), is_primary = false
  where organization_id = p_organization_id
    and deal_id = p_deal_id
    and tag_id = p_tag_id
    and removed_at is null
  returning * into v_assignment;
  if v_assignment.id is null then
    raise exception using errcode = 'P0002', message = 'A etiqueta não está aplicada neste negócio.';
  end if;

  select legacy_value into v_legacy_value from public.tags where id = p_tag_id;
  update public.deals
  set tags = array_remove(coalesce(tags, '{}'::text[]), v_legacy_value)
  where organization_id = p_organization_id and id = p_deal_id;

  update public.deal_tag_assignments
  set is_primary = true
  where id = (
    select id from public.deal_tag_assignments
    where organization_id = p_organization_id
      and deal_id = p_deal_id
      and category_id = v_assignment.category_id
      and removed_at is null
    order by recorded_at, id
    limit 1
  )
  and not exists (
    select 1 from public.deal_tag_assignments
    where organization_id = p_organization_id
      and deal_id = p_deal_id
      and category_id = v_assignment.category_id
      and removed_at is null
      and is_primary
  );
  return v_assignment;
end;
$$;

create or replace function public.set_primary_deal_tag(
  p_organization_id uuid,
  p_deal_id uuid,
  p_tag_id uuid
)
returns public.deal_tag_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.deal_tag_assignments;
begin
  if (select auth.uid()) is null
    or not public.can_access_organization(p_organization_id)
    or not public.has_permission('tags.assign')
  then
    raise exception using errcode = '42501', message = 'Sem permissão para definir a etiqueta principal.';
  end if;
  perform 1 from public.deals
  where organization_id = p_organization_id and id = p_deal_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Negócio não encontrado nesta organização.';
  end if;
  select * into v_assignment from public.deal_tag_assignments
  where organization_id = p_organization_id
    and deal_id = p_deal_id
    and tag_id = p_tag_id
    and removed_at is null;
  if v_assignment.id is null then
    raise exception using errcode = 'P0002', message = 'A etiqueta não está aplicada neste negócio.';
  end if;
  update public.deal_tag_assignments
  set is_primary = (tag_id = p_tag_id)
  where organization_id = p_organization_id
    and deal_id = p_deal_id
    and category_id = v_assignment.category_id
    and removed_at is null;
  select * into strict v_assignment from public.deal_tag_assignments where id = v_assignment.id;
  return v_assignment;
end;
$$;

revoke all on function public.get_or_create_tag_category(uuid, text, text) from public, anon;
revoke all on function public.get_or_create_tag(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.assign_deal_tag(uuid, uuid, uuid, boolean) from public, anon;
revoke all on function public.remove_deal_tag(uuid, uuid, uuid) from public, anon;
revoke all on function public.set_primary_deal_tag(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_or_create_tag_category(uuid, text, text) to authenticated;
grant execute on function public.get_or_create_tag(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.assign_deal_tag(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.remove_deal_tag(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_primary_deal_tag(uuid, uuid, uuid) to authenticated;
