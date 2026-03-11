create or replace function public.current_profile_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.is_same_organization(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_organization_id() = org_id
$$;

create or replace function public.is_same_organization_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_profile_organization_id() = org_id
    and public.current_profile_role() in ('admin', 'clinic_admin')
$$;
