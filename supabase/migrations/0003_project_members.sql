-- SSRP Tools — project members (kolaborasi).
-- Menambah orang ke sebuah project: owner bisa mengundang user lain
-- (dikenal lewat e-mail) dan anggota bisa ikut membuka/mengubah project.
-- Idempoten: aman dijalankan berulang (drop policy bila sudah ada).

create table if not exists public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'collaborator' check (role in ('owner', 'collaborator')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx
  on public.project_members (user_id, created_at desc);

-- Helper: apakah pengguna pemilik project ATAU anggota terdaftar.
create or replace function public.can_access_project(proj uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = proj and p.user_id = auth.uid()
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = proj and m.user_id = auth.uid()
  )
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.project_members enable row level security;

-- Anggota: owner project bisa mengelola; anggota bisa melihat daftar.
drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- Hanya owner project yang boleh menambah/menghapus anggota.
drop policy if exists project_members_insert on public.project_members;
create policy project_members_insert on public.project_members
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );
drop policy if exists project_members_delete on public.project_members;
create policy project_members_delete on public.project_members
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = auth.uid()
    )
  );

-- projects: anggota juga boleh membaca & mengubah (owner tetap penuh).
-- Insert tetap owner-only; delete tetap owner-only.
drop policy if exists projects_select_member on public.projects;
create policy projects_select_member on public.projects
  for select using (public.can_access_project(id));
drop policy if exists projects_update_member on public.projects;
create policy projects_update_member on public.projects
  for update using (public.can_access_project(id))
  with check (auth.uid() = user_id or public.can_access_project(id));

-- Child tables: buka akses untuk anggota juga.
drop policy if exists project_assets_select_member on public.project_assets;
create policy project_assets_select_member on public.project_assets
  for select using (public.can_access_project(project_id));
drop policy if exists project_assets_insert_member on public.project_assets;
create policy project_assets_insert_member on public.project_assets
  for insert with check (public.can_access_project(project_id));
drop policy if exists project_assets_update_member on public.project_assets;
create policy project_assets_update_member on public.project_assets
  for update using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));
drop policy if exists project_assets_delete_member on public.project_assets;
create policy project_assets_delete_member on public.project_assets
  for delete using (public.can_access_project(project_id));

drop policy if exists project_states_select_member on public.project_states;
create policy project_states_select_member on public.project_states
  for select using (public.can_access_project(project_id));
drop policy if exists project_states_insert_member on public.project_states;
create policy project_states_insert_member on public.project_states
  for insert with check (public.can_access_project(project_id));
drop policy if exists project_states_update_member on public.project_states;
create policy project_states_update_member on public.project_states
  for update using (public.can_access_project(project_id))
  with check (public.can_access_project(project_id));
drop policy if exists project_states_delete_member on public.project_states;
create policy project_states_delete_member on public.project_states
  for delete using (public.can_access_project(project_id));

-- profiles: user terautentikasi boleh melihat nama/avatar user lain
-- (dipakai untuk pencarian saat mengundang anggota).
drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_visible on public.profiles
  for select using (auth.uid() is not null);

-- storage: anggota project boleh membaca objek aset project bersama
-- (objek bisa berada di folder owner), dan menghapus/memperbarui aset
-- di project yang mereka akses.
drop policy if exists project_assets_storage_select_member on storage.objects;
create policy project_assets_storage_select_member on storage.objects
  for select using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and public.can_access_project(public.storage_owner_project(name))
  );
drop policy if exists project_assets_storage_update_member on storage.objects;
create policy project_assets_storage_update_member on storage.objects
  for update using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and public.can_access_project(public.storage_owner_project(name))
  ) with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and public.can_access_project(public.storage_owner_project(name))
  );
drop policy if exists project_assets_storage_delete_member on storage.objects;
create policy project_assets_storage_delete_member on storage.objects
  for delete using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and public.can_access_project(public.storage_owner_project(name))
  );

drop policy if exists project_versions_select_member on public.project_versions;
create policy project_versions_select_member on public.project_versions
  for select using (public.can_access_project(project_id));
drop policy if exists project_versions_insert_member on public.project_versions;
create policy project_versions_insert_member on public.project_versions
  for insert with check (public.can_access_project(project_id));
drop policy if exists project_versions_delete_member on public.project_versions;
create policy project_versions_delete_member on public.project_versions
  for delete using (public.can_access_project(project_id));
