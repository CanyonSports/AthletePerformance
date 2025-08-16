
-- Extension
create extension if not exists pgcrypto;

-- Table
create table if not exists public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport text not null check (sport in ('climbing','ski','mtb','running')),
  test_date date not null default current_date,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

-- RLS
alter table public.measurements enable row level security;

drop policy if exists "select own measurements" on public.measurements;
create policy "select own measurements"
  on public.measurements
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert own measurements" on public.measurements;
create policy "insert own measurements"
  on public.measurements
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own measurements" on public.measurements;
create policy "update own measurements"
  on public.measurements
  for update
  using (auth.uid() = user_id);

drop policy if exists "delete own measurements" on public.measurements;
create policy "delete own measurements"
  on public.measurements
  for delete
  using (auth.uid() = user_id);

-- Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.measurements;
  exception when duplicate_object then
    null;
  end;
end $$;
