-- Habits
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  strk integer not null default 0,
  frequency integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.habits enable row level security;

create policy "Users can manage their own habits"
  on public.habits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-day habit completions
create table if not exists public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.habits(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  unique (habit_id, date)
);

alter table public.habit_completions enable row level security;

create policy "Users can manage their own habit completions"
  on public.habit_completions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
