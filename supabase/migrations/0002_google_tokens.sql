-- Google Calendar refresh tokens
create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

create policy "Users can manage their own google tokens"
  on public.google_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
