-- Pinned tasks ("Pinned to To-Do" on the dashboard).
--
-- Microsoft To Do has no "pinned" concept, so the flag can't round-trip through
-- the sync. It used to live in localStorage keyed by task name, which meant
-- pins didn't follow the user between browsers and a rename lost them.
--
-- `ms_task_id` is the stable To Do id and the preferred key. It is nullable
-- because a task pinned right after it is typed has not reached To Do yet; such
-- a row matches on `name` until the next fetch backfills the id.
create table if not exists public.task_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ms_task_id text,
  name text not null,
  created_at timestamptz not null default now()
);

-- One pin per task, under either key.
create unique index if not exists task_pins_user_ms_task_id_key
  on public.task_pins (user_id, ms_task_id)
  where ms_task_id is not null;
create unique index if not exists task_pins_user_name_key
  on public.task_pins (user_id, name);

alter table public.task_pins enable row level security;

create policy "Users can manage their own task pins"
  on public.task_pins
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
