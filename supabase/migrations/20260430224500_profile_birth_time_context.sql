-- Birth time context for Hebrew birth date calculation.

alter table public.profiles
  add column if not exists birth_time_context text;

update public.profiles
set birth_time_context = 'unknown'
where birth_time_context is null
  or birth_time_context not in ('before_sunset', 'after_sunset', 'unknown');

alter table public.profiles
  alter column birth_time_context set default 'unknown',
  alter column birth_time_context set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_birth_time_context_check'
  ) then
    alter table public.profiles
      add constraint profiles_birth_time_context_check
      check (birth_time_context in ('before_sunset', 'after_sunset', 'unknown'));
  end if;
end $$;
