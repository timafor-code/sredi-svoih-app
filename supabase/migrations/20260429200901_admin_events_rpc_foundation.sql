-- Admin Events Center RPC foundation.
-- Client code calls these functions with the normal authenticated Supabase
-- session. Permission checks stay tied to community roles.

create or replace function public.admin_list_import_items_needing_review(
  limit_count integer default 50
)
returns table (
  id uuid,
  source_id uuid,
  run_id uuid,
  external_id text,
  source_url text,
  raw_payload jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid,
  status text,
  created_at timestamptz,
  source_name text,
  community_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(limit_count, 50), 1), 100);
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  return query
  select
    i.id,
    i.source_id,
    i.run_id,
    i.external_id,
    i.source_url,
    i.raw_payload,
    i.parsed_title,
    i.parsed_starts_at,
    i.parsed_location,
    i.linked_event_id,
    i.status,
    i.created_at,
    s.name as source_name,
    s.community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where public.has_community_role(s.community_id, array['admin', 'event_manager'])
    and i.linked_event_id is null
    and (
      i.status in ('new', 'error')
      or i.status is null
      or (
        i.status = 'ignored'
        and i.raw_payload #>> '{adminReview,ignoredAt}' is null
        and (
          lower(coalesce(i.raw_payload #>> '{importReview,dateStatus}', '')) in (
            'needs_review',
            'needs-review',
            'review'
          )
          or lower(coalesce(i.raw_payload #>> '{importReview,dateConfidence}', '')) not in (
            '',
            'confident'
          )
          or lower(coalesce(
            i.raw_payload #>> '{importReview,reviewNeeded}',
            i.raw_payload #>> '{importReview,needsReview}',
            ''
          )) in ('true', '1', 'yes')
        )
      )
    )
    and (
      i.status = 'error'
      or i.raw_payload -> 'importReview' is null
      or lower(coalesce(i.raw_payload #>> '{importReview,dateStatus}', '')) not in (
        'ready',
        'confident',
        'published',
        'linked'
      )
      or lower(coalesce(i.raw_payload #>> '{importReview,dateConfidence}', '')) not in (
        'confident'
      )
      or lower(coalesce(
        i.raw_payload #>> '{importReview,reviewNeeded}',
        i.raw_payload #>> '{importReview,needsReview}',
        ''
      )) in ('true', '1', 'yes')
    )
  order by i.created_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_get_import_item(import_item_id uuid)
returns table (
  id uuid,
  source_id uuid,
  run_id uuid,
  external_id text,
  source_url text,
  raw_payload jsonb,
  parsed_title text,
  parsed_starts_at timestamptz,
  parsed_location text,
  linked_event_id uuid,
  status text,
  created_at timestamptz,
  source_name text,
  community_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_community_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select s.community_id
  into v_community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id;

  if not found then
    raise exception 'Import item not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.source_id,
    i.run_id,
    i.external_id,
    i.source_url,
    i.raw_payload,
    i.parsed_title,
    i.parsed_starts_at,
    i.parsed_location,
    i.linked_event_id,
    i.status,
    i.created_at,
    s.name as source_name,
    s.community_id
  from public.event_import_items i
  join public.event_import_sources s on s.id = i.source_id
  where i.id = import_item_id;
end;
$$;

revoke all on function public.admin_list_import_items_needing_review(integer) from public;
revoke all on function public.admin_get_import_item(uuid) from public;

grant execute on function public.admin_list_import_items_needing_review(integer) to authenticated;
grant execute on function public.admin_get_import_item(uuid) to authenticated;
