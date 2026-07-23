-- Hotfix de segurança:
-- 1. remove RPCs legadas SECURITY DEFINER que agregavam dados de todos os tenants;
-- 2. recria somente a contagem de contatos com tenant obrigatório e RLS do invocador.

revoke execute on function public.get_contact_stage_counts() from public, anon, authenticated;
drop function public.get_contact_stage_counts();

revoke execute on function public.get_dashboard_stats() from public, anon, authenticated;
drop function public.get_dashboard_stats();

create function public.get_contact_stage_counts(p_organization_id uuid)
returns table (
  stage text,
  count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_organization_id is null
    or auth.uid() is null
    or not coalesce(public.can_access_organization(p_organization_id), false)
  then
    raise exception using
      errcode = '42501',
      message = 'Sem acesso à organização solicitada.';
  end if;

  return query
  select
    coalesce(c.stage, 'UNKNOWN')::text as stage,
    count(*)::bigint as count
  from public.contacts as c
  where c.organization_id = p_organization_id
    and c.deleted_at is null
  group by coalesce(c.stage, 'UNKNOWN');
end;
$$;

revoke execute on function public.get_contact_stage_counts(uuid) from public, anon;
grant execute on function public.get_contact_stage_counts(uuid) to authenticated;
