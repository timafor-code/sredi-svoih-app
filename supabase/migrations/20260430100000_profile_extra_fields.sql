-- Extra user profile fields for profile edit screen.

alter table public.profiles
  add column if not exists tribe_status text,
  add column if not exists marital_status text,
  add column if not exists about text,
  add column if not exists profile_visibility text default 'members',
  add column if not exists birthday_visibility text default 'members',
  add column if not exists phone_visibility text default 'rabbi_only';

update public.profiles
set profile_visibility = 'members'
where profile_visibility is null;

update public.profiles
set birthday_visibility = 'members'
where birthday_visibility is null;

update public.profiles
set phone_visibility = 'rabbi_only'
where phone_visibility is null;

alter table public.profiles
  alter column profile_visibility set default 'members',
  alter column profile_visibility set not null,
  alter column birthday_visibility set default 'members',
  alter column birthday_visibility set not null,
  alter column phone_visibility set default 'rabbi_only',
  alter column phone_visibility set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_tribe_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_tribe_status_check
      check (tribe_status is null or tribe_status in ('kohen', 'levi', 'israel'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_marital_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_marital_status_check
      check (marital_status is null or marital_status in ('single', 'married', 'divorced', 'widowed', 'other'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_about_length_check'
  ) then
    alter table public.profiles
      add constraint profiles_about_length_check
      check (about is null or char_length(about) <= 200);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_profile_visibility_check'
  ) then
    alter table public.profiles
      add constraint profiles_profile_visibility_check
      check (profile_visibility in ('rabbi_only', 'members', 'public'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_birthday_visibility_check'
  ) then
    alter table public.profiles
      add constraint profiles_birthday_visibility_check
      check (birthday_visibility in ('rabbi_only', 'members', 'public'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_phone_visibility_check'
  ) then
    alter table public.profiles
      add constraint profiles_phone_visibility_check
      check (phone_visibility in ('rabbi_only', 'members', 'public'));
  end if;
end $$;
