-- Storage bucket for mirrored website-import event images.
--
-- Objects are written through the browser-triggered Edge flow with the caller's
-- authenticated session. No service-role key is required for uploads.

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do update set
  public = excluded.public;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 8388608 where id = ''event-images''';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'allowed_mime_types'
  ) then
    execute 'update storage.buckets set allowed_mime_types = array[''image/jpeg'', ''image/png'', ''image/webp'', ''image/gif'']::text[] where id = ''event-images''';
  end if;
end $$;

create or replace function public.event_import_image_path_community_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $func$
declare
  v_folders text[] := storage.foldername(p_name);
begin
  if v_folders[1] is distinct from 'community'
    or nullif(v_folders[2], '') is null
    or v_folders[3] is distinct from 'website-import'
    or nullif(v_folders[4], '') is null then
    return null;
  end if;

  begin
    return v_folders[2]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$func$;

drop policy if exists "event_images_public_read" on storage.objects;
drop policy if exists "event_images_insert_community_manager" on storage.objects;
drop policy if exists "event_images_update_community_manager" on storage.objects;
drop policy if exists "event_images_delete_community_manager" on storage.objects;

create policy "event_images_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'event-images');

create policy "event_images_insert_community_manager"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'event-images'
  and public.has_community_role(
    public.event_import_image_path_community_id(name),
    array['admin', 'event_manager']
  )
);

create policy "event_images_update_community_manager"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'event-images'
  and public.has_community_role(
    public.event_import_image_path_community_id(name),
    array['admin', 'event_manager']
  )
)
with check (
  bucket_id = 'event-images'
  and public.has_community_role(
    public.event_import_image_path_community_id(name),
    array['admin', 'event_manager']
  )
);

create policy "event_images_delete_community_manager"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'event-images'
  and public.has_community_role(
    public.event_import_image_path_community_id(name),
    array['admin', 'event_manager']
  )
);
