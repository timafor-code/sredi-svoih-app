-- Server-side push notification outbox foundation.
-- This migration only queues jobs and per-device deliveries. It does not send
-- remote push notifications and does not add an Edge Function or worker.

create table if not exists public.push_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  community_id uuid null references public.communities(id) on delete cascade,
  created_by uuid null references auth.users(id) on delete set null,
  notification_kind text not null,
  audience text not null,
  event_id uuid null references public.events(id) on delete cascade,
  occurrence_id uuid null,
  registration_id uuid null references public.event_registrations(id) on delete cascade,
  target_user_id uuid null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  queued_at timestamptz not null default now(),
  processed_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_notification_jobs
  add column if not exists community_id uuid null references public.communities(id) on delete cascade,
  add column if not exists created_by uuid null references auth.users(id) on delete set null,
  add column if not exists notification_kind text not null default 'manual',
  add column if not exists audience text not null default 'manual_tokens',
  add column if not exists event_id uuid null references public.events(id) on delete cascade,
  add column if not exists occurrence_id uuid null,
  add column if not exists registration_id uuid null references public.event_registrations(id) on delete cascade,
  add column if not exists target_user_id uuid null references auth.users(id) on delete cascade,
  add column if not exists title text not null default '',
  add column if not exists body text not null default '',
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'queued',
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz null,
  add column if not exists error_message text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.push_notification_jobs
  drop constraint if exists push_notification_jobs_notification_kind_check,
  add constraint push_notification_jobs_notification_kind_check
    check (
      notification_kind in (
        'event_created',
        'event_updated',
        'event_cancelled',
        'registration_confirmed',
        'registration_rejected',
        'waitlist_available',
        'news',
        'manual'
      )
    );

alter table public.push_notification_jobs
  drop constraint if exists push_notification_jobs_audience_check,
  add constraint push_notification_jobs_audience_check
    check (
      audience in (
        'event_registrants',
        'community_members',
        'single_user',
        'manual_tokens'
      )
    );

alter table public.push_notification_jobs
  drop constraint if exists push_notification_jobs_status_check,
  add constraint push_notification_jobs_status_check
    check (
      status in (
        'queued',
        'processing',
        'sent',
        'partially_sent',
        'failed',
        'cancelled'
      )
    );

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.push_notification_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid null references public.device_tokens(id) on delete set null,
  expo_push_token text not null,
  status text not null default 'queued',
  expo_ticket_id text null,
  expo_receipt_id text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_notification_deliveries
  add column if not exists job_id uuid not null references public.push_notification_jobs(id) on delete cascade,
  add column if not exists user_id uuid not null references auth.users(id) on delete cascade,
  add column if not exists device_token_id uuid null references public.device_tokens(id) on delete set null,
  add column if not exists expo_push_token text not null default '',
  add column if not exists status text not null default 'queued',
  add column if not exists expo_ticket_id text null,
  add column if not exists expo_receipt_id text null,
  add column if not exists error_message text null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.push_notification_deliveries
  drop constraint if exists push_notification_deliveries_status_check,
  add constraint push_notification_deliveries_status_check
    check (
      status in (
        'queued',
        'sent',
        'failed',
        'skipped',
        'receipt_checked'
      )
    );

create index if not exists push_notification_jobs_community_created_at_idx
  on public.push_notification_jobs(community_id, created_at desc);

create index if not exists push_notification_jobs_event_id_idx
  on public.push_notification_jobs(event_id);

create index if not exists push_notification_jobs_status_queued_at_idx
  on public.push_notification_jobs(status, queued_at);

create index if not exists push_notification_jobs_created_by_idx
  on public.push_notification_jobs(created_by);

create index if not exists push_notification_deliveries_job_id_idx
  on public.push_notification_deliveries(job_id);

create index if not exists push_notification_deliveries_status_created_at_idx
  on public.push_notification_deliveries(status, created_at);

create index if not exists push_notification_deliveries_user_id_idx
  on public.push_notification_deliveries(user_id);

create index if not exists push_notification_deliveries_device_token_id_idx
  on public.push_notification_deliveries(device_token_id)
  where device_token_id is not null;

create unique index if not exists push_notification_deliveries_job_device_token_key
  on public.push_notification_deliveries(job_id, device_token_id)
  where device_token_id is not null;

drop trigger if exists set_push_notification_jobs_updated_at
on public.push_notification_jobs;

create trigger set_push_notification_jobs_updated_at
before update on public.push_notification_jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_push_notification_deliveries_updated_at
on public.push_notification_deliveries;

create trigger set_push_notification_deliveries_updated_at
before update on public.push_notification_deliveries
for each row execute function public.set_updated_at();

alter table public.push_notification_jobs enable row level security;
alter table public.push_notification_deliveries enable row level security;

revoke all on public.push_notification_jobs from anon;
revoke all on public.push_notification_jobs from authenticated;
revoke all on public.push_notification_deliveries from anon;
revoke all on public.push_notification_deliveries from authenticated;

create or replace function public.admin_enqueue_event_push_notification(
  p_event_id uuid,
  p_occurrence_id uuid default null,
  p_notification_kind text default null,
  p_title text default null,
  p_body text default null,
  p_data jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  delivery_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_notification_kind text := lower(btrim(coalesce(p_notification_kind, '')));
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_job_id uuid;
  v_delivery_count integer := 0;
  v_job_status text := 'queued';
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_event_id is null then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  if v_notification_kind not in ('event_created', 'event_updated', 'event_cancelled') then
    raise exception 'Unsupported event push notification kind' using errcode = '22023';
  end if;

  if v_title is null then
    raise exception 'title is required' using errcode = '22023';
  end if;

  if v_body is null then
    raise exception 'body is required' using errcode = '22023';
  end if;

  if jsonb_typeof(v_data) <> 'object' then
    raise exception 'data must be a JSON object' using errcode = '22023';
  end if;

  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_event.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if p_occurrence_id is not null then
    if not exists (
      select 1
      from public.event_occurrences eo
      where eo.id = p_occurrence_id
        and eo.event_id = p_event_id
    ) then
      raise exception 'Occurrence not found for this event' using errcode = 'P0002';
    end if;
  end if;

  insert into public.push_notification_jobs (
    community_id,
    created_by,
    notification_kind,
    audience,
    event_id,
    occurrence_id,
    title,
    body,
    data,
    status
  )
  values (
    v_event.community_id,
    v_user_id,
    v_notification_kind,
    'event_registrants',
    p_event_id,
    p_occurrence_id,
    v_title,
    v_body,
    v_data,
    v_job_status
  )
  returning id into v_job_id;

  insert into public.push_notification_deliveries (
    job_id,
    user_id,
    device_token_id,
    expo_push_token,
    status
  )
  select
    v_job_id,
    recipients.user_id,
    dt.id,
    dt.expo_push_token,
    'queued'
  from (
    select distinct r.user_id
    from public.event_registrations r
    where r.event_id = p_event_id
      and (p_occurrence_id is null or r.occurrence_id = p_occurrence_id)
      and r.status in ('pending', 'confirmed', 'waitlisted')
  ) recipients
  join public.device_tokens dt
    on dt.user_id = recipients.user_id
   and dt.is_active = true
   and dt.push_provider = 'expo'
   and nullif(btrim(dt.expo_push_token), '') is not null
  on conflict do nothing;

  get diagnostics v_delivery_count = row_count;

  return query
  select
    v_job_id,
    v_delivery_count,
    v_job_status;
end;
$$;

create or replace function public.admin_list_push_notification_jobs(
  p_community_id uuid default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  community_id uuid,
  created_by uuid,
  notification_kind text,
  audience text,
  event_id uuid,
  occurrence_id uuid,
  registration_id uuid,
  target_user_id uuid,
  title text,
  body text,
  data jsonb,
  status text,
  queued_at timestamptz,
  processed_at timestamptz,
  error_message text,
  delivery_count integer,
  queued_delivery_count integer,
  sent_delivery_count integer,
  failed_delivery_count integer,
  skipped_delivery_count integer,
  receipt_checked_delivery_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_community_id is not null
     and not public.has_community_role(p_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return query
  select
    j.id,
    j.community_id,
    j.created_by,
    j.notification_kind,
    j.audience,
    j.event_id,
    j.occurrence_id,
    j.registration_id,
    j.target_user_id,
    j.title,
    j.body,
    j.data,
    j.status,
    j.queued_at,
    j.processed_at,
    j.error_message,
    count(d.id)::integer as delivery_count,
    count(d.id) filter (where d.status = 'queued')::integer as queued_delivery_count,
    count(d.id) filter (where d.status = 'sent')::integer as sent_delivery_count,
    count(d.id) filter (where d.status = 'failed')::integer as failed_delivery_count,
    count(d.id) filter (where d.status = 'skipped')::integer as skipped_delivery_count,
    count(d.id) filter (where d.status = 'receipt_checked')::integer as receipt_checked_delivery_count,
    j.created_at,
    j.updated_at
  from public.push_notification_jobs j
  left join public.push_notification_deliveries d
    on d.job_id = j.id
  where j.community_id is not null
    and (p_community_id is null or j.community_id = p_community_id)
    and public.has_community_role(j.community_id, array['admin', 'event_manager'])
  group by j.id
  order by j.queued_at desc, j.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_get_push_notification_job(
  p_job_id uuid
)
returns table (
  id uuid,
  community_id uuid,
  created_by uuid,
  notification_kind text,
  audience text,
  event_id uuid,
  occurrence_id uuid,
  registration_id uuid,
  target_user_id uuid,
  title text,
  body text,
  data jsonb,
  status text,
  queued_at timestamptz,
  processed_at timestamptz,
  error_message text,
  delivery_count integer,
  queued_delivery_count integer,
  sent_delivery_count integer,
  failed_delivery_count integer,
  skipped_delivery_count integer,
  receipt_checked_delivery_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.push_notification_jobs;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_job_id is null then
    raise exception 'job_id is required' using errcode = '22023';
  end if;

  select *
  into v_job
  from public.push_notification_jobs j
  where j.id = p_job_id;

  if not found then
    raise exception 'Push notification job not found' using errcode = 'P0002';
  end if;

  if v_job.community_id is null
     or not public.has_community_role(v_job.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return query
  select
    j.id,
    j.community_id,
    j.created_by,
    j.notification_kind,
    j.audience,
    j.event_id,
    j.occurrence_id,
    j.registration_id,
    j.target_user_id,
    j.title,
    j.body,
    j.data,
    j.status,
    j.queued_at,
    j.processed_at,
    j.error_message,
    count(d.id)::integer as delivery_count,
    count(d.id) filter (where d.status = 'queued')::integer as queued_delivery_count,
    count(d.id) filter (where d.status = 'sent')::integer as sent_delivery_count,
    count(d.id) filter (where d.status = 'failed')::integer as failed_delivery_count,
    count(d.id) filter (where d.status = 'skipped')::integer as skipped_delivery_count,
    count(d.id) filter (where d.status = 'receipt_checked')::integer as receipt_checked_delivery_count,
    j.created_at,
    j.updated_at
  from public.push_notification_jobs j
  left join public.push_notification_deliveries d
    on d.job_id = j.id
  where j.id = p_job_id
  group by j.id;
end;
$$;

create or replace function public.admin_cancel_push_notification_job(
  p_job_id uuid
)
returns table (
  job_id uuid,
  delivery_count integer,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.push_notification_jobs;
  v_delivery_count integer := 0;
  v_job_status text := 'cancelled';
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_job_id is null then
    raise exception 'job_id is required' using errcode = '22023';
  end if;

  select *
  into v_job
  from public.push_notification_jobs j
  where j.id = p_job_id
  for update;

  if not found then
    raise exception 'Push notification job not found' using errcode = 'P0002';
  end if;

  if v_job.community_id is null
     or not public.has_community_role(v_job.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if v_job.status <> 'queued' then
    raise exception 'Only queued push notification jobs can be cancelled' using errcode = '22023';
  end if;

  update public.push_notification_deliveries d
  set
    status = 'skipped',
    error_message = coalesce(d.error_message, 'Job cancelled'),
    updated_at = now()
  where d.job_id = p_job_id
    and d.status = 'queued';

  update public.push_notification_jobs j
  set
    status = v_job_status,
    processed_at = now(),
    updated_at = now()
  where j.id = p_job_id;

  select count(*)::integer
  into v_delivery_count
  from public.push_notification_deliveries d
  where d.job_id = p_job_id;

  return query
  select
    p_job_id,
    v_delivery_count,
    v_job_status;
end;
$$;

revoke all on function public.admin_enqueue_event_push_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public;
revoke all on function public.admin_list_push_notification_jobs(uuid, integer) from public;
revoke all on function public.admin_get_push_notification_job(uuid) from public;
revoke all on function public.admin_cancel_push_notification_job(uuid) from public;

grant execute on function public.admin_enqueue_event_push_notification(
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function public.admin_list_push_notification_jobs(uuid, integer) to authenticated;
grant execute on function public.admin_get_push_notification_job(uuid) to authenticated;
grant execute on function public.admin_cancel_push_notification_job(uuid) to authenticated;
