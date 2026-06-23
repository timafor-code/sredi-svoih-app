-- Admin import run history read RPC.
--
-- Browser admin clients use the regular authenticated Supabase session. This
-- RPC is read-only: it only derives the caller's active managed community from
-- community_memberships, then reads event_import_runs plus event_import_sources
-- for a safe source name. It never reads auth.users, never writes import tables,
-- and never creates, updates, or publishes events.

create or replace function public.admin_list_import_runs(payload jsonb)
returns table (
  id uuid,
  source_id uuid,
  source_name text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  found_count integer,
  created_count integer,
  updated_count integer,
  error text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_user_id uuid := auth.uid();
  v_community_id uuid;
  v_limit integer := 10;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  if v_payload ?| array['communityId', 'community_id'] then
    raise exception 'community_id is derived from active membership'
      using errcode = '22023';
  end if;

  begin
    v_limit := nullif(btrim(coalesce(
      v_payload ->> 'limit',
      v_payload ->> 'limitCount',
      v_payload ->> 'limit_count'
    )), '')::integer;
  exception when others then
    raise exception 'limit must be an integer' using errcode = '22023';
  end;

  v_limit := least(greatest(coalesce(v_limit, 10), 1), 50);

  -- Match web-admin's current active membership selection without trusting any
  -- client-supplied community id.
  select cm.community_id
  into v_community_id
  from public.community_memberships cm
  where cm.user_id = v_user_id
    and cm.status = 'active'
    and cm.role in ('admin', 'event_manager')
  order by cm.joined_at desc nulls last, cm.created_at desc, cm.id desc
  limit 1;

  if v_community_id is null then
    raise exception 'admin_or_event_manager_required' using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.source_id,
    s.name as source_name,
    r.status,
    r.started_at,
    r.finished_at,
    r.found_count,
    r.created_count,
    r.updated_count,
    r.error,
    r.started_at as created_at
  from public.event_import_runs r
  join public.event_import_sources s on s.id = r.source_id
  where s.community_id = v_community_id
  order by r.started_at desc, r.id desc
  limit v_limit;
end;
$func$;

revoke all on function public.admin_list_import_runs(jsonb) from public;
grant execute on function public.admin_list_import_runs(jsonb) to authenticated;
