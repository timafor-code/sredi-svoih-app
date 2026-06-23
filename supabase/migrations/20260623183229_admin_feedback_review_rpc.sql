-- Admin-only beta feedback review RPCs.
--
-- Browser clients use the regular authenticated Supabase session and review
-- feedback only through these RPCs. Community scope is derived exclusively from
-- the caller's active admin membership.

create or replace function public.admin_list_feedback(payload jsonb default '{}'::jsonb)
returns table (
  id uuid,
  community_id uuid,
  user_id uuid,
  section text,
  entity_type text,
  entity_id uuid,
  severity text,
  message text,
  status text,
  url text,
  user_agent text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_community_id uuid;
  v_membership_count integer := 0;
  v_status text;
  v_severity text;
  v_section text;
  v_limit integer := 50;
  v_offset integer := 0;
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

  select count(*)::integer
  into v_membership_count
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role = 'admin';

  if v_membership_count = 0 then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if v_membership_count > 1 then
    raise exception 'Multiple admin communities are not supported by this feedback review RPC'
      using errcode = '22023';
  end if;

  select cm.community_id
  into v_community_id
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role = 'admin'
  limit 1;

  v_status := lower(nullif(btrim(coalesce(v_payload ->> 'status', 'all')), ''));
  if v_status = 'all' then
    v_status := null;
  end if;
  if v_status is not null and v_status not in ('open', 'reviewed', 'resolved', 'closed') then
    raise exception 'Invalid feedback status' using errcode = '22023';
  end if;

  v_severity := lower(nullif(btrim(coalesce(v_payload ->> 'severity', 'all')), ''));
  if v_severity = 'all' then
    v_severity := null;
  end if;
  if v_severity is not null and v_severity not in ('note', 'issue', 'blocker', 'idea') then
    raise exception 'Invalid feedback severity' using errcode = '22023';
  end if;

  v_section := nullif(btrim(coalesce(v_payload ->> 'section', '')), '');
  if v_section is not null and char_length(v_section) > 80 then
    raise exception 'section must be 80 characters or fewer' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(v_payload ->> 'limit', '')), '') is not null then
    begin
      v_limit := (v_payload ->> 'limit')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'limit must be an integer' using errcode = '22023';
    end;
  end if;
  v_limit := least(greatest(v_limit, 1), 100);

  if nullif(btrim(coalesce(v_payload ->> 'offset', '')), '') is not null then
    begin
      v_offset := (v_payload ->> 'offset')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'offset must be an integer' using errcode = '22023';
    end;
  end if;
  v_offset := greatest(v_offset, 0);

  return query
  select
    af.id,
    af.community_id,
    af.user_id,
    af.section,
    af.entity_type,
    af.entity_id,
    af.severity,
    af.message,
    af.status,
    af.url,
    af.user_agent,
    af.created_at,
    af.updated_at,
    af.resolved_at,
    af.resolved_by,
    count(*) over()::bigint as total_count
  from public.admin_feedback af
  where af.community_id = v_community_id
    and (v_status is null or af.status = v_status)
    and (v_severity is null or af.severity = v_severity)
    and (v_section is null or af.section = v_section)
  order by af.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.admin_update_feedback_status(payload jsonb)
returns table (
  id uuid,
  community_id uuid,
  user_id uuid,
  section text,
  entity_type text,
  entity_id uuid,
  severity text,
  message text,
  status text,
  url text,
  user_agent text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_community_id uuid;
  v_membership_count integer := 0;
  v_feedback_id uuid;
  v_status text;
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

  begin
    v_feedback_id := nullif(btrim(coalesce(v_payload ->> 'id', '')), '')::uuid;
  exception
    when invalid_text_representation then
      raise exception 'id must be a feedback UUID' using errcode = '22023';
  end;

  if v_feedback_id is null then
    raise exception 'id is required' using errcode = '22023';
  end if;

  v_status := lower(nullif(btrim(coalesce(v_payload ->> 'status', '')), ''));
  if v_status is null then
    raise exception 'status is required' using errcode = '22023';
  end if;
  if v_status not in ('open', 'reviewed', 'resolved', 'closed') then
    raise exception 'Invalid feedback status' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_membership_count
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role = 'admin';

  if v_membership_count = 0 then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  if v_membership_count > 1 then
    raise exception 'Multiple admin communities are not supported by this feedback review RPC'
      using errcode = '22023';
  end if;

  select cm.community_id
  into v_community_id
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role = 'admin'
  limit 1;

  update public.admin_feedback af
  set
    status = v_status,
    resolved_at = case
      when v_status in ('resolved', 'closed') then now()
      else null
    end,
    resolved_by = case
      when v_status in ('resolved', 'closed') then v_user_id
      else null
    end,
    updated_at = now()
  where af.id = v_feedback_id
    and af.community_id = v_community_id
  returning *
  into v_feedback;

  if not found then
    raise exception 'Feedback row not found for current admin community'
      using errcode = 'P0002';
  end if;

  return query
  select
    v_feedback.id,
    v_feedback.community_id,
    v_feedback.user_id,
    v_feedback.section,
    v_feedback.entity_type,
    v_feedback.entity_id,
    v_feedback.severity,
    v_feedback.message,
    v_feedback.status,
    v_feedback.url,
    v_feedback.user_agent,
    v_feedback.created_at,
    v_feedback.updated_at,
    v_feedback.resolved_at,
    v_feedback.resolved_by;
end;
$$;

revoke all on function public.admin_list_feedback(jsonb) from public;
revoke all on function public.admin_list_feedback(jsonb) from anon;
grant execute on function public.admin_list_feedback(jsonb) to authenticated;

revoke all on function public.admin_update_feedback_status(jsonb) from public;
revoke all on function public.admin_update_feedback_status(jsonb) from anon;
grant execute on function public.admin_update_feedback_status(jsonb) to authenticated;
