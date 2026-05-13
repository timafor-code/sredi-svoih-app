create or replace function public.admin_delete_event(event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.events;
  v_event public.events;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  select *
  into v_existing
  from public.events
  where id = $1
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(v_existing.community_id, array['admin', 'event_manager']) then
    raise exception 'Admin event permission required' using errcode = '42501';
  end if;

  begin
    delete from public.events
    where id = v_existing.id
    returning * into v_event;
  exception
    when foreign_key_violation then
      raise exception 'Event cannot be deleted because related records still reference it'
        using errcode = '23503';
  end;

  return v_event;
end;
$$;

revoke all on function public.admin_delete_event(uuid) from public;

grant execute on function public.admin_delete_event(uuid) to authenticated;
