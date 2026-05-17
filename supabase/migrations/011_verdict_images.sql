-- =====================================================================
-- FF Council — Phase 11: Verdict image attachments
--
-- Optional screenshot on a verdict scenario. Image lives in Supabase
-- Storage (public bucket); only the public URL is stored on the row.
-- =====================================================================

alter table public.verdict_scenarios
  add column if not exists image_url text;

-- Storage bucket (public, 5MB cap, image MIME types only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verdict-images',
  'verdict-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone (anon or authed) can upload to this bucket; mime/size enforced
-- on the bucket itself.
create policy "verdict-images: open insert"
  on storage.objects for insert
  with check (bucket_id = 'verdict-images');

-- Public read so the rendered <img> works without an auth header.
create policy "verdict-images: public read"
  on storage.objects for select
  using (bucket_id = 'verdict-images');
