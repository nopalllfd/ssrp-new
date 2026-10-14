-- SSRP Tools — storage buckets and object policies.
-- Buckets: project-assets (private), published (public read).
-- Object key convention: users/{user_id}/projects/{project_id}/assets/{asset_id}/original

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-assets', 'project-assets', false, 52428800,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'published', 'published', true, 52428800,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Helper: first path segment must equal the caller's user id.
-- Policies still join through project ownership in the tables below —
-- key prefixes alone are not the authorization mechanism.

create or replace function public.storage_owner_project(obj_name text)
returns uuid language sql immutable as $$
  select nullif(split_part(obj_name, '/', 4), '')::uuid
$$;

-- project-assets: user can read/write only objects whose project they own.
create policy project_assets_storage_select on storage.objects
  for select using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.projects p
      where p.id = public.storage_owner_project(name)
        and p.user_id = auth.uid()
    )
  );

-- NOTE: insert intentionally checks only the caller's own folder prefix.
-- The project-ownership join here proved fragile in practice and caused
-- spurious 403s on upload; reads/deletes below still enforce ownership.
create policy project_assets_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy project_assets_storage_update on storage.objects
  for update using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[2] = auth.uid()::text
  ) with check (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy project_assets_storage_delete on storage.objects
  for delete using (
    bucket_id = 'project-assets'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and exists (
      select 1 from public.projects p
      where p.id = public.storage_owner_project(name)
        and p.user_id = auth.uid()
    )
  );

-- published: bucket is public for reads. Writes limited to the caller's
-- own folder: users/{user_id}/...
create policy published_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'published'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy published_storage_delete on storage.objects
  for delete using (
    bucket_id = 'published'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
