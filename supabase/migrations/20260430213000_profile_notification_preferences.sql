-- User-owned notification preference settings.

alter table public.profiles
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb;
