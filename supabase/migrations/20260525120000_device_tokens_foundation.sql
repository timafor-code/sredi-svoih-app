-- Push device token foundation for future server-side notifications.
-- This migration upgrades the legacy device_tokens shape if it already exists.

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'unknown',
  push_provider text not null default 'expo',
  expo_push_token text not null,
  device_id text null,
  app_version text null,
  build_version text null,
  environment text not null default 'development',
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.device_tokens
  add column if not exists platform text,
  add column if not exists push_provider text not null default 'expo',
  add column if not exists device_id text,
  add column if not exists app_version text,
  add column if not exists build_version text,
  add column if not exists environment text not null default 'development',
  add column if not exists last_seen_at timestamptz not null default now();

update public.device_tokens
set
  platform = 'unknown'
where platform is null
   or platform not in ('ios', 'android', 'web', 'unknown');

update public.device_tokens
set
  push_provider = 'expo'
where push_provider is null
   or push_provider <> 'expo';

update public.device_tokens
set
  environment = 'development'
where environment is null
   or environment not in ('development', 'preview', 'production', 'unknown');

update public.device_tokens
set
  last_seen_at = updated_at
where last_seen_at is null;

alter table public.device_tokens
  alter column platform set default 'unknown',
  alter column platform set not null,
  alter column push_provider set default 'expo',
  alter column push_provider set not null,
  alter column environment set default 'development',
  alter column environment set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

alter table public.device_tokens
  drop constraint if exists device_tokens_platform_check,
  add constraint device_tokens_platform_check
    check (platform in ('ios', 'android', 'web', 'unknown'));

alter table public.device_tokens
  drop constraint if exists device_tokens_push_provider_check,
  add constraint device_tokens_push_provider_check
    check (push_provider in ('expo'));

alter table public.device_tokens
  drop constraint if exists device_tokens_environment_check,
  add constraint device_tokens_environment_check
    check (environment in ('development', 'preview', 'production', 'unknown'));

create unique index if not exists device_tokens_user_expo_push_token_key
  on public.device_tokens(user_id, expo_push_token);

drop index if exists public.device_tokens_expo_push_token_key;

create index if not exists device_tokens_user_id_idx
  on public.device_tokens(user_id);

create index if not exists device_tokens_active_user_idx
  on public.device_tokens(user_id)
  where is_active = true;

drop trigger if exists set_device_tokens_updated_at
on public.device_tokens;

create trigger set_device_tokens_updated_at
before update on public.device_tokens
for each row execute function public.set_updated_at();

alter table public.device_tokens enable row level security;

drop policy if exists "device_tokens_select_own"
on public.device_tokens;

create policy "device_tokens_select_own"
on public.device_tokens
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "device_tokens_insert_own"
on public.device_tokens;

create policy "device_tokens_insert_own"
on public.device_tokens
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "device_tokens_update_own"
on public.device_tokens;

create policy "device_tokens_update_own"
on public.device_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.upsert_my_device_token(
  p_expo_push_token text,
  p_platform text default 'unknown',
  p_device_id text default null,
  p_app_version text default null,
  p_build_version text default null,
  p_environment text default 'development'
)
returns public.device_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_expo_push_token text := nullif(btrim(coalesce(p_expo_push_token, '')), '');
  v_platform text := coalesce(nullif(lower(btrim(coalesce(p_platform, ''))), ''), 'unknown');
  v_environment text := coalesce(nullif(lower(btrim(coalesce(p_environment, ''))), ''), 'development');
  v_device_token public.device_tokens;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_expo_push_token is null then
    raise exception 'expo_push_token is required' using errcode = '22023';
  end if;

  if v_platform not in ('ios', 'android', 'web', 'unknown') then
    raise exception 'Invalid platform' using errcode = '22023';
  end if;

  if v_environment not in ('development', 'preview', 'production', 'unknown') then
    raise exception 'Invalid environment' using errcode = '22023';
  end if;

  insert into public.device_tokens (
    user_id,
    platform,
    push_provider,
    expo_push_token,
    device_id,
    app_version,
    build_version,
    environment,
    is_active,
    last_seen_at,
    updated_at
  )
  values (
    v_user_id,
    v_platform,
    'expo',
    v_expo_push_token,
    nullif(btrim(p_device_id), ''),
    nullif(btrim(p_app_version), ''),
    nullif(btrim(p_build_version), ''),
    v_environment,
    true,
    now(),
    now()
  )
  on conflict (user_id, expo_push_token)
  do update set
    platform = excluded.platform,
    push_provider = 'expo',
    device_id = excluded.device_id,
    app_version = excluded.app_version,
    build_version = excluded.build_version,
    environment = excluded.environment,
    is_active = true,
    last_seen_at = now(),
    updated_at = now()
  returning * into v_device_token;

  return v_device_token;
end;
$$;

create or replace function public.deactivate_my_device_token(
  p_expo_push_token text
)
returns public.device_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_expo_push_token text := nullif(btrim(coalesce(p_expo_push_token, '')), '');
  v_device_token public.device_tokens;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if v_expo_push_token is null then
    raise exception 'expo_push_token is required' using errcode = '22023';
  end if;

  update public.device_tokens
  set
    is_active = false,
    updated_at = now()
  where user_id = v_user_id
    and expo_push_token = v_expo_push_token
  returning * into v_device_token;

  return v_device_token;
end;
$$;

revoke all on public.device_tokens from anon;
grant select, insert, update on public.device_tokens to authenticated;

revoke all on function public.upsert_my_device_token(text, text, text, text, text, text) from public;
revoke all on function public.deactivate_my_device_token(text) from public;
grant execute on function public.upsert_my_device_token(text, text, text, text, text, text) to authenticated;
grant execute on function public.deactivate_my_device_token(text) to authenticated;
