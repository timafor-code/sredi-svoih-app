-- Admin beta feedback foundation.
--
-- This is a backend-only foundation for web-admin beta feedback. Browser
-- clients use the regular authenticated Supabase session and write feedback
-- only through admin_create_feedback(payload jsonb).

create table public.admin_feedback (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id),
  user_id uuid not null references public.profiles(id),
  section text not null,
  entity_type text,
  entity_id uuid,
  severity text not null default 'note',
  message text not null,
  status text not null default 'open',
  user_agent text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),

  constraint admin_feedback_severity_check
    check (severity in ('note', 'issue', 'blocker', 'idea')),
  constraint admin_feedback_status_check
    check (status in ('open', 'reviewed', 'resolved', 'closed')),
  constraint admin_feedback_section_not_blank_check
    check (btrim(section) <> ''),
  constraint admin_feedback_message_not_blank_check
    check (btrim(message) <> ''),
  constraint admin_feedback_section_length_check
    check (char_length(section) <= 80),
  constraint admin_feedback_entity_type_length_check
    check (entity_type is null or char_length(entity_type) <= 80),
  constraint admin_feedback_message_length_check
    check (char_length(message) <= 4000),
  constraint admin_feedback_user_agent_length_check
    check (user_agent is null or char_length(user_agent) <= 500),
  constraint admin_feedback_url_length_check
    check (url is null or char_length(url) <= 1000)
);

create index admin_feedback_community_created_idx
  on public.admin_feedback(community_id, created_at desc);

create index admin_feedback_status_created_idx
  on public.admin_feedback(status, created_at desc);

create index admin_feedback_user_created_idx
  on public.admin_feedback(user_id, created_at desc);

drop trigger if exists set_admin_feedback_updated_at on public.admin_feedback;
create trigger set_admin_feedback_updated_at
before update on public.admin_feedback
for each row execute function public.set_updated_at();

alter table public.admin_feedback enable row level security;

revoke all on table public.admin_feedback from anon;
revoke all on table public.admin_feedback from authenticated;
revoke all on table public.admin_feedback from public;

create or replace function public.admin_create_feedback(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_community_id uuid;
  v_membership_count integer := 0;
  v_section text;
  v_entity_type text;
  v_entity_id_text text;
  v_entity_id uuid;
  v_severity text := 'note';
  v_message text;
  v_user_agent text;
  v_url text;
  v_feedback public.admin_feedback;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  if v_payload ?| array['communityId', 'community_id', 'userId', 'user_id'] then
    raise exception 'communityId and userId are derived from auth context'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
  ) then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  select count(*)::integer
  into v_membership_count
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role in ('admin', 'event_manager');

  if v_membership_count = 0 then
    raise exception 'Admin or event manager role required' using errcode = '42501';
  end if;

  if v_membership_count > 1 then
    raise exception 'Multiple managed communities are not supported by this feedback RPC'
      using errcode = '22023';
  end if;

  select cm.community_id
  into v_community_id
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role in ('admin', 'event_manager')
  limit 1;

  v_section := nullif(btrim(coalesce(v_payload ->> 'section', '')), '');
  if v_section is null then
    raise exception 'section is required' using errcode = '22023';
  end if;
  if char_length(v_section) > 80 then
    raise exception 'section must be 80 characters or fewer' using errcode = '22023';
  end if;

  v_message := nullif(btrim(coalesce(v_payload ->> 'message', '')), '');
  if v_message is null then
    raise exception 'message is required' using errcode = '22023';
  end if;
  if char_length(v_message) > 4000 then
    raise exception 'message must be 4000 characters or fewer' using errcode = '22023';
  end if;

  v_severity := lower(nullif(btrim(coalesce(v_payload ->> 'severity', 'note')), ''));
  if v_severity is null then
    v_severity := 'note';
  end if;
  if v_severity not in ('note', 'issue', 'blocker', 'idea') then
    raise exception 'Invalid feedback severity' using errcode = '22023';
  end if;

  v_entity_type := nullif(btrim(coalesce(
    v_payload ->> 'entityType',
    v_payload ->> 'entity_type'
  )), '');
  if v_entity_type is not null and char_length(v_entity_type) > 80 then
    raise exception 'entityType must be 80 characters or fewer' using errcode = '22023';
  end if;

  v_entity_id_text := nullif(btrim(coalesce(
    v_payload ->> 'entityId',
    v_payload ->> 'entity_id'
  )), '');
  if v_entity_id_text is not null then
    begin
      v_entity_id := v_entity_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'entityId must be a UUID' using errcode = '22023';
    end;
  end if;

  v_user_agent := nullif(btrim(coalesce(
    v_payload ->> 'userAgent',
    v_payload ->> 'user_agent'
  )), '');
  if v_user_agent is not null and char_length(v_user_agent) > 500 then
    raise exception 'userAgent must be 500 characters or fewer' using errcode = '22023';
  end if;

  v_url := nullif(btrim(coalesce(v_payload ->> 'url', '')), '');
  if v_url is not null and char_length(v_url) > 1000 then
    raise exception 'url must be 1000 characters or fewer' using errcode = '22023';
  end if;

  insert into public.admin_feedback (
    community_id,
    user_id,
    section,
    entity_type,
    entity_id,
    severity,
    message,
    user_agent,
    url
  )
  values (
    v_community_id,
    v_user_id,
    v_section,
    v_entity_type,
    v_entity_id,
    v_severity,
    v_message,
    v_user_agent,
    v_url
  )
  returning *
  into v_feedback;

  return jsonb_build_object(
    'id', v_feedback.id,
    'status', v_feedback.status,
    'created_at', v_feedback.created_at
  );
end;
$$;

revoke all on function public.admin_create_feedback(jsonb) from public;
grant execute on function public.admin_create_feedback(jsonb) to authenticated;
