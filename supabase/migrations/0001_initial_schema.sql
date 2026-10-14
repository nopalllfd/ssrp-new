-- SSRP Tools — initial schema
-- Run in the Supabase SQL editor or via `supabase db push`.
-- Covers: tables, constraints, indexes, updated_at triggers, RLS policies.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  thumbnail_key text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  original_name text,
  mime_type text,
  file_size bigint,
  width int,
  height int,
  object_key text unique,
  upload_status text not null default 'pending'
    check (upload_status in ('pending', 'uploading', 'ready', 'error')),
  checksum text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_states (
  project_id uuid primary key references public.projects (id) on delete cascade,
  document jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_number bigint not null,
  name text null,
  kind text not null check (kind in ('automatic', 'manual')),
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  config jsonb not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  project_id uuid null references public.projects (id) on delete set null,
  action text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Indexes for the hot paths: project listing, assets per project,
-- version history, activity history.
create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc)
  where deleted_at is null;
create index if not exists projects_user_name_idx
  on public.projects (user_id, name);
create index if not exists project_assets_project_idx
  on public.project_assets (project_id, created_at);
create index if not exists project_versions_project_idx
  on public.project_versions (project_id, version_number desc);
create index if not exists activity_logs_user_idx
  on public.activity_logs (user_id, created_at desc);
create index if not exists templates_public_idx
  on public.templates (is_public, updated_at desc)
  where is_public;

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create or replace trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();
create or replace trigger project_assets_updated_at
  before update on public.project_assets
  for each row execute function public.set_updated_at();
create or replace trigger project_states_updated_at
  before update on public.project_states
  for each row execute function public.set_updated_at();
create or replace trigger templates_updated_at
  before update on public.templates
  for each row execute function public.set_updated_at();

-- Auto-create a profile on signup, copying Google metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_assets enable row level security;
alter table public.project_states enable row level security;
alter table public.project_versions enable row level security;
alter table public.templates enable row level security;
alter table public.activity_logs enable row level security;

-- profiles: owner only
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- projects: owner only.
-- NOTE: user_id is never writable by the client beyond insert, and an update
-- cannot re-assign ownership (with check blocks changing user_id away).
create policy projects_select_own on public.projects
  for select using (auth.uid() = user_id);
create policy projects_insert_own on public.projects
  for insert with check (auth.uid() = user_id);
create policy projects_update_own on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy projects_delete_own on public.projects
  for delete using (auth.uid() = user_id);

-- project_assets: ownership resolved through the parent project,
-- not by merely trusting the foreign key.
create policy project_assets_select_own on public.project_assets
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );
create policy project_assets_insert_own on public.project_assets
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );
create policy project_assets_update_own on public.project_assets
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );
create policy project_assets_delete_own on public.project_assets
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_assets.project_id and p.user_id = auth.uid()
    )
  );

-- project_states: ownership through the parent project
create policy project_states_select_own on public.project_states
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_states.project_id and p.user_id = auth.uid()
    )
  );
create policy project_states_insert_own on public.project_states
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_states.project_id and p.user_id = auth.uid()
    )
  );
create policy project_states_update_own on public.project_states
  for update using (
    exists (
      select 1 from public.projects p
      where p.id = project_states.project_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.projects p
      where p.id = project_states.project_id and p.user_id = auth.uid()
    )
  );
create policy project_states_delete_own on public.project_states
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_states.project_id and p.user_id = auth.uid()
    )
  );

-- project_versions: read/create through parent project; no updates/deletes
-- (versions are immutable — retention handled by explicit app deletes).
create policy project_versions_select_own on public.project_versions
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.user_id = auth.uid()
    )
  );
create policy project_versions_insert_own on public.project_versions
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.user_id = auth.uid()
    )
  );
create policy project_versions_delete_own on public.project_versions
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.user_id = auth.uid()
    )
  );

-- templates: public templates readable by any authenticated user;
-- private templates and writes restricted to the owner.
create policy templates_select on public.templates
  for select using (is_public or auth.uid() = user_id);
create policy templates_insert_own on public.templates
  for insert with check (auth.uid() = user_id);
create policy templates_update_own on public.templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy templates_delete_own on public.templates
  for delete using (auth.uid() = user_id);

-- activity_logs: users can append their own rows and read their own rows.
-- No update/delete — logs are append-only.
create policy activity_logs_insert_own on public.activity_logs
  for insert with check (auth.uid() = user_id);
create policy activity_logs_select_own on public.activity_logs
  for select using (auth.uid() = user_id);
