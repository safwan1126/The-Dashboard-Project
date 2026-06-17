create table if not exists public.pomo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_name text,
  completed_at timestamptz not null,
  duration integer not null,
  created_at timestamptz not null default now()
);

alter table public.pomo_sessions enable row level security;

create policy "Users can manage their own pomo sessions"
  on public.pomo_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
