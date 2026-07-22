-- A exclusão direta continua protegida, mas a cascata iniciada pela exclusão da
-- própria organização não pode ser bloqueada pelos guards dos filhos.

create or replace function public.guard_tag_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 and (
    exists (select 1 from public.deal_tag_assignments where tag_id = old.id)
    or exists (select 1 from public.automation_tag_dependencies where tag_id = old.id)
  ) then
    raise exception using
      errcode = '55000',
      message = 'Etiqueta com histórico ou dependências não pode ser apagada. Arquive a etiqueta.';
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
  if pg_trigger_depth() = 1
    and exists (select 1 from public.tags where category_id = old.id)
  then
    raise exception using
      errcode = '55000',
      message = 'A categoria possui etiquetas. Arquive ou mova as etiquetas antes de apagar a categoria.';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_tag_hard_delete() from public, anon, authenticated;
revoke all on function public.guard_tag_category_delete() from public, anon, authenticated;
