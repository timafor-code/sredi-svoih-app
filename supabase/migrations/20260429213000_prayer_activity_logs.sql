-- Prayer Tracker activity logs.
-- Personal MVP data: only the authenticated owner can read or write rows.

create table if not exists public.prayer_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null,
  activity_date date not null,
  started_at timestamptz,
  completed_at timestamptz,
  timezone text not null default 'Europe/Moscow',
  city text,
  hebrew_date jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint prayer_activity_logs_activity_type_check
    check (
      activity_type in (
        'shacharit',
        'mincha',
        'maariv',
        'shema_morning',
        'shema_evening',
        'omer_count'
      )
    ),

  constraint prayer_activity_logs_has_activity_timestamp_check
    check (
      started_at is not null
      or completed_at is not null
    )
);

create unique index if not exists prayer_activity_logs_user_date_type_key
  on public.prayer_activity_logs(user_id, activity_date, activity_type);

create index if not exists prayer_activity_logs_user_activity_date_idx
  on public.prayer_activity_logs(user_id, activity_date desc);

create index if not exists prayer_activity_logs_activity_type_idx
  on public.prayer_activity_logs(activity_type);

drop trigger if exists set_prayer_activity_logs_updated_at on public.prayer_activity_logs;
create trigger set_prayer_activity_logs_updated_at
before update on public.prayer_activity_logs
for each row execute function public.set_updated_at();

alter table public.prayer_activity_logs enable row level security;

drop policy if exists "prayer_activity_logs_select_own" on public.prayer_activity_logs;
create policy "prayer_activity_logs_select_own"
on public.prayer_activity_logs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "prayer_activity_logs_insert_own" on public.prayer_activity_logs;
create policy "prayer_activity_logs_insert_own"
on public.prayer_activity_logs
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "prayer_activity_logs_update_own" on public.prayer_activity_logs;
create policy "prayer_activity_logs_update_own"
on public.prayer_activity_logs
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on public.prayer_activity_logs from anon, authenticated;
grant select, insert, update on public.prayer_activity_logs to authenticated;
