-- Admin seating schema, RLS and read RPC (block B, PR 7).
--
-- Database layer only: tables + row level security + read-only RPC. There are
-- no mutations here; the seating write RPC ships in PR 8 and auto-seating in a
-- later PR. The browser admin client uses the normal authenticated Supabase
-- session; no service role or Admin API is involved.
--
-- Two distinct concepts (see docs/admin-seating.md):
--   * Templates  -- reusable geometry, community scoped, no guests and no slot.
--   * Layouts    -- a concrete seating instance bound to one capacity slot
--                   (event + occurrence + capacity unit), with its tables,
--                   table connections and guest/reserve assignments.
--
-- Field shapes mirror the v15 prototype localStorage payload
-- (docs/prototype/registrations-improved-seating-v15.html):
--   table       = { id, cx, cy, w, h, angle, sideSeats, isRabbiTable }
--   connection  = { aTableId, aEnd, bTableId, bEnd, x, y }
--   assignment  = occByKey entry { type: 'guest' | 'reserve', name, initials }
--                 placed onto a chair (client_table_id + seat index).

-- ---------------------------------------------------------------------------
-- Templates: reusable geometry, community scoped.
-- ---------------------------------------------------------------------------
create table if not exists public.event_seating_layout_templates (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,

  title text not null,
  -- snapshot = { version, canvas: { width, height }, tables: [...], connections: [...] }
  -- where tables/connections follow the prototype shapes documented above.
  snapshot jsonb not null default '{}'::jsonb,

  is_builtin boolean not null default false,
  is_active boolean not null default true,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint event_seating_layout_templates_title_not_empty
    check (btrim(title) <> ''),

  constraint event_seating_layout_templates_snapshot_is_object
    check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists event_seating_layout_templates_community_active_idx
  on public.event_seating_layout_templates(community_id, is_active, title);

drop trigger if exists set_event_seating_layout_templates_updated_at
  on public.event_seating_layout_templates;

create trigger set_event_seating_layout_templates_updated_at
before update on public.event_seating_layout_templates
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Layouts: a concrete seating instance for one capacity slot.
-- ---------------------------------------------------------------------------
create table if not exists public.event_seating_layouts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  occurrence_id uuid references public.event_occurrences(id) on delete cascade,
  capacity_unit_id uuid not null,

  -- nullable mirrors the prototype activeTemplateId (a builtin/grid/blank value
  -- has no saved-template row, so the instance keeps its own geometry).
  template_id uuid references public.event_seating_layout_templates(id) on delete set null,

  -- null = no capacity limit (matches event_capacity_units.capacity semantics).
  capacity_limit_snapshot integer,

  seating_done boolean not null default false,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FK guarantees the capacity unit belongs to the same event,
  -- mirroring event_participation_option_capacity_units.
  constraint event_seating_layouts_unit_event_fkey
    foreign key (capacity_unit_id, event_id)
    references public.event_capacity_units(id, event_id)
    on delete cascade,

  -- One seating instance per capacity slot. occurrence_id may be null (legacy
  -- single-occurrence registrations); Postgres treats nulls as distinct, which
  -- is the desired behaviour for the null-occurrence slot.
  constraint event_seating_layouts_slot_unique
    unique (event_id, occurrence_id, capacity_unit_id),

  constraint event_seating_layouts_capacity_limit_snapshot_check
    check (capacity_limit_snapshot is null or capacity_limit_snapshot > 0)
);

create index if not exists event_seating_layouts_community_idx
  on public.event_seating_layouts(community_id);

create index if not exists event_seating_layouts_event_occurrence_idx
  on public.event_seating_layouts(event_id, occurrence_id);

create index if not exists event_seating_layouts_capacity_unit_idx
  on public.event_seating_layouts(capacity_unit_id);

create index if not exists event_seating_layouts_template_idx
  on public.event_seating_layouts(template_id);

drop trigger if exists set_event_seating_layouts_updated_at
  on public.event_seating_layouts;

create trigger set_event_seating_layouts_updated_at
before update on public.event_seating_layouts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tables: per-layout table geometry (prototype customTables[]).
-- ---------------------------------------------------------------------------
create table if not exists public.event_seating_tables (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.event_seating_layouts(id) on delete cascade,

  -- prototype table "id"; stable within a layout for connection/assignment refs.
  client_table_id text not null,

  cx numeric not null,
  cy numeric not null,
  w numeric not null,
  h numeric not null,

  angle integer not null default 0,
  -- prototype sideSeats (seats along each long side).
  long_side_seats integer not null default 3,
  is_rabbi_table boolean not null default false,

  created_at timestamptz not null default now(),

  constraint event_seating_tables_client_table_id_not_empty
    check (btrim(client_table_id) <> ''),

  constraint event_seating_tables_angle_check
    check (angle in (0, 90, 180, 270)),

  constraint event_seating_tables_long_side_seats_check
    check (long_side_seats in (2, 3)),

  constraint event_seating_tables_layout_client_id_unique
    unique (layout_id, client_table_id)
);

create index if not exists event_seating_tables_layout_idx
  on public.event_seating_tables(layout_id);

-- ---------------------------------------------------------------------------
-- Connections: table-to-table seams (prototype tableConnections[]).
-- connection = { aTableId, aEnd, bTableId, bEnd, x, y }
-- ---------------------------------------------------------------------------
create table if not exists public.event_seating_table_connections (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.event_seating_layouts(id) on delete cascade,

  from_client_table_id text not null,
  from_end text,
  to_client_table_id text not null,
  to_end text,

  anchor_x numeric,
  anchor_y numeric,

  created_at timestamptz not null default now(),

  constraint event_seating_table_connections_from_not_empty
    check (btrim(from_client_table_id) <> ''),

  constraint event_seating_table_connections_to_not_empty
    check (btrim(to_client_table_id) <> '')
);

create index if not exists event_seating_table_connections_layout_idx
  on public.event_seating_table_connections(layout_id);

-- ---------------------------------------------------------------------------
-- Assignments: guests / reserves placed on chairs (prototype occByKey + chairs).
-- ---------------------------------------------------------------------------
create table if not exists public.event_seating_assignments (
  id uuid primary key default gen_random_uuid(),
  layout_id uuid not null references public.event_seating_layouts(id) on delete cascade,

  -- nullable: reserves have no registration_id ("Резерв N").
  registration_id uuid references public.event_registrations(id) on delete cascade,

  -- client_table_id + seat index. null = unplaced (in the prototype pool[]).
  seat_key text,

  -- render snapshot from occByKey (name / initials).
  guest_label text,
  guest_initials text,

  assignment_type text not null,

  created_at timestamptz not null default now(),

  constraint event_seating_assignments_type_check
    check (assignment_type in ('guest', 'reserve')),

  -- a seat can hold at most one assignment within a layout.
  constraint event_seating_assignments_layout_seat_unique
    unique (layout_id, seat_key)
);

create index if not exists event_seating_assignments_layout_idx
  on public.event_seating_assignments(layout_id);

create index if not exists event_seating_assignments_registration_idx
  on public.event_seating_assignments(registration_id);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- Read-only PR: SELECT policies plus SELECT grants. Manage policies, write
-- grants and the write RPC arrive in PR 8.
--
-- Templates and layouts are scoped directly by community_id membership
-- (admin / event_manager), reusing public.has_community_role exactly as the
-- capacity tables do. Tables, connections and assignments have no community_id
-- of their own: each is reached through its parent layout_id, so its policy
-- joins event_seating_layouts and checks that layout's community_id. Every one
-- of the five tables therefore carries an explicit membership check.
-- ---------------------------------------------------------------------------
alter table public.event_seating_layout_templates enable row level security;
alter table public.event_seating_layouts enable row level security;
alter table public.event_seating_tables enable row level security;
alter table public.event_seating_table_connections enable row level security;
alter table public.event_seating_assignments enable row level security;

drop policy if exists "event_seating_layout_templates_select_by_manager"
  on public.event_seating_layout_templates;

create policy "event_seating_layout_templates_select_by_manager"
on public.event_seating_layout_templates
for select
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

drop policy if exists "event_seating_layouts_select_by_manager"
  on public.event_seating_layouts;

create policy "event_seating_layouts_select_by_manager"
on public.event_seating_layouts
for select
to authenticated
using (
  public.has_community_role(community_id, array['admin', 'event_manager'])
);

drop policy if exists "event_seating_tables_select_by_manager"
  on public.event_seating_tables;

create policy "event_seating_tables_select_by_manager"
on public.event_seating_tables
for select
to authenticated
using (
  exists (
    select 1
    from public.event_seating_layouts l
    where l.id = event_seating_tables.layout_id
      and public.has_community_role(l.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_seating_table_connections_select_by_manager"
  on public.event_seating_table_connections;

create policy "event_seating_table_connections_select_by_manager"
on public.event_seating_table_connections
for select
to authenticated
using (
  exists (
    select 1
    from public.event_seating_layouts l
    where l.id = event_seating_table_connections.layout_id
      and public.has_community_role(l.community_id, array['admin', 'event_manager'])
  )
);

drop policy if exists "event_seating_assignments_select_by_manager"
  on public.event_seating_assignments;

create policy "event_seating_assignments_select_by_manager"
on public.event_seating_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.event_seating_layouts l
    where l.id = event_seating_assignments.layout_id
      and public.has_community_role(l.community_id, array['admin', 'event_manager'])
  )
);

grant select on public.event_seating_layout_templates to authenticated;
grant select on public.event_seating_layouts to authenticated;
grant select on public.event_seating_tables to authenticated;
grant select on public.event_seating_table_connections to authenticated;
grant select on public.event_seating_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- Read RPC.
--
-- security definer + auth.uid() + has_community_role gate, matching the
-- existing admin read RPCs (e.g. admin_list_community_locations,
-- admin_get_registration_capacity_analytics).
-- ---------------------------------------------------------------------------

-- Active seating templates across the caller's admin/event_manager communities.
create or replace function public.admin_list_seating_templates()
returns setof public.event_seating_layout_templates
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  return query
  select t.*
  from public.event_seating_layout_templates t
  where t.is_active = true
    and public.has_community_role(t.community_id, array['admin', 'event_manager'])
  order by
    t.community_id,
    t.is_builtin desc,
    lower(t.title) asc,
    t.created_at asc;
end;
$$;

revoke all on function public.admin_list_seating_templates() from public;
grant execute on function public.admin_list_seating_templates() to authenticated;

-- A single seating template by id.
create or replace function public.admin_get_seating_template(p_template_id uuid)
returns public.event_seating_layout_templates
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template public.event_seating_layout_templates;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_template_id is null then
    raise exception 'template_id is required' using errcode = '22023';
  end if;

  select *
  into v_template
  from public.event_seating_layout_templates t
  where t.id = p_template_id;

  if not found then
    raise exception 'Seating template not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_template.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  return v_template;
end;
$$;

revoke all on function public.admin_get_seating_template(uuid) from public;
grant execute on function public.admin_get_seating_template(uuid) to authenticated;

-- The seating instance for one capacity slot, with its tables, connections and
-- assignments folded into a single jsonb payload.
create or replace function public.admin_get_seating_layout(
  p_event_id uuid,
  p_occurrence_id uuid,
  p_capacity_unit_id uuid
)
returns table (
  layout jsonb,
  tables jsonb,
  connections jsonb,
  assignments jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event public.events;
  v_layout public.event_seating_layouts;
begin
  if v_user_id is null then
    raise exception 'Auth required' using errcode = '28000';
  end if;

  if p_event_id is null then
    raise exception 'event_id is required' using errcode = '22023';
  end if;

  if p_capacity_unit_id is null then
    raise exception 'capacity_unit_id is required' using errcode = '22023';
  end if;

  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if not public.has_community_role(
    v_event.community_id,
    array['admin', 'event_manager']
  ) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select *
  into v_layout
  from public.event_seating_layouts l
  where l.event_id = p_event_id
    and l.capacity_unit_id = p_capacity_unit_id
    and (
      (p_occurrence_id is null and l.occurrence_id is null)
      or (p_occurrence_id is not null and l.occurrence_id = p_occurrence_id)
    );

  -- No instance yet for this slot: return a single empty row so the caller can
  -- distinguish "no layout" from a permission error.
  if not found then
    return query
    select
      null::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb;
    return;
  end if;

  return query
  with layout_json as (
    select to_jsonb(l.*) as payload
    from public.event_seating_layouts l
    where l.id = v_layout.id
  ),
  tables_json as (
    select coalesce(
      jsonb_agg(to_jsonb(st.*) order by st.created_at asc, st.client_table_id asc),
      '[]'::jsonb
    ) as payload
    from public.event_seating_tables st
    where st.layout_id = v_layout.id
  ),
  connections_json as (
    select coalesce(
      jsonb_agg(to_jsonb(c.*) order by c.created_at asc, c.id asc),
      '[]'::jsonb
    ) as payload
    from public.event_seating_table_connections c
    where c.layout_id = v_layout.id
  ),
  assignments_json as (
    select coalesce(
      jsonb_agg(to_jsonb(a.*) order by a.created_at asc, a.id asc),
      '[]'::jsonb
    ) as payload
    from public.event_seating_assignments a
    where a.layout_id = v_layout.id
  )
  select
    lj.payload,
    tj.payload,
    cj.payload,
    aj.payload
  from layout_json lj
  cross join tables_json tj
  cross join connections_json cj
  cross join assignments_json aj;
end;
$$;

revoke all on function public.admin_get_seating_layout(uuid, uuid, uuid) from public;
grant execute on function public.admin_get_seating_layout(uuid, uuid, uuid) to authenticated;
