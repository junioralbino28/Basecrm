create table if not exists public.profile_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  permission_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, permission_key)
);

create index if not exists idx_profile_permissions_org_user
  on public.profile_permissions (organization_id, user_id);

alter table public.profile_permissions enable row level security;
