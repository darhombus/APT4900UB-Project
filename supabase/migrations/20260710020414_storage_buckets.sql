-- ============================================================================
-- STORAGE BUCKETS
-- Two public buckets: listing-images (5 MB) and avatars (2 MB), both limited to
-- JPEG/PNG/WebP. Created as a migration so they exist in every environment.
-- Uploads are namespaced as <user_id>/<filename>; write access is restricted to
-- the owning user by matching the first path segment to their uid.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-images', 'listing-images', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase; we only add policies.

-- Public read for both buckets (the buckets are public anyway; this also allows
-- listing/metadata reads through the API).
create policy "Public read for listing-images and avatars"
  on storage.objects for select
  using (bucket_id in ('listing-images', 'avatars'));

-- Insert: a user may upload only into their own <uid>/ folder.
create policy "Users upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('listing-images', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update: a user may modify only files in their own <uid>/ folder.
create policy "Users update their own files"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('listing-images', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('listing-images', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: a user may delete only files in their own <uid>/ folder.
create policy "Users delete their own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('listing-images', 'avatars')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
