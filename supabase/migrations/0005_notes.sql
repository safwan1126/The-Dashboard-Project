-- Notes
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

create policy "Users can manage their own notes"
  on public.notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Image attachments (multiple per note)
create table if not exists public.note_images (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.note_images enable row level security;

create policy "Users can manage their own note images"
  on public.note_images
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Private storage bucket for note image attachments
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-images', 'note-images', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Objects are stored under `{user_id}/{note_id}/{filename}` so the policy
-- below can scope access by the first path segment.
create policy "Users can read their own note images"
  on storage.objects for select
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own note images"
  on storage.objects for insert
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own note images"
  on storage.objects for delete
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);
