-- Среди Своих initial schema
create extension if not exists pgcrypto;

create table if not exists communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key,
  community_id uuid references communities(id) on delete set null,
  full_name text not null,
  hebrew_name text,
  city text,
  created_at timestamptz not null default now()
);

create table if not exists community_contacts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  full_name text not null,
  hebrew_name text,
  role text,
  city text,
  created_at timestamptz default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  seats_total int,
  created_at timestamptz default now()
);

create table if not exists event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'registered',
  created_at timestamptz default now(),
  unique(event_id, user_id)
);

create table if not exists user_settings (
  user_id uuid primary key,
  city text,
  nusach text,
  zmanim_source text default 'manual',
  updated_at timestamptz default now()
);

create table if not exists synced_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text,
  phone_hash text,
  email_hash text,
  birthday date,
  consented_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists calendar_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  cache_key text not null,
  payload jsonb not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table user_settings enable row level security;
alter table synced_contacts enable row level security;
alter table event_registrations enable row level security;
alter table calendar_cache enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own settings" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own synced_contacts" on synced_contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own registrations" on event_registrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own calendar cache" on calendar_cache for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
