-- Admin import write RPC (Phase 2, Admin import v2, PR 14).
--
-- This is the security-critical write boundary for the future admin-triggered
-- import flow:
--
--   web-admin button -> Supabase Edge Function -> parser/fetch -> write RPC
--     -> event_import_runs -> event_import_items -> review queue
--
-- Everything in this file is reachable only through SECURITY DEFINER RPC. The
-- browser admin client uses a normal authenticated Supabase session (anon /
-- publishable key, no service-role, no Admin API, no DATABASE_URL). It must go
-- through these validated functions to write import runs/items; the validation
-- layer (auth.uid(), admin/event_manager role, source belongs to the user's
-- active community membership, run lifecycle) is the only write path.
--
-- Scope of THIS PR: writes ONLY event_import_runs and event_import_items. It
-- does NOT create/update/publish events, does NOT touch registrations/seating/
-- mobile, does NOT touch auth.users, and does NOT implement the Edge Function,
-- the parser, the importer, or any UI.
--
-- Community is ALWAYS derived server-side from the import source (which is
-- community-scoped) cross-checked against the caller's active membership. A
-- community_id in the payload is never trusted or read.
--
-- Status constraints are intentionally NOT expanded. The existing CHECK
-- constraints stay as-is:
--   event_import_runs.status  : started | success | failed
--   event_import_items.status : new | linked | ignored | error
-- Dedupe / review state lives only in raw_payload.importReview.dedupe (see
-- docs/admin-import-dedupe-contract.md) and is stored verbatim inside the item
-- raw_payload jsonb; it is never promoted into a table status column.

-- ---------------------------------------------------------------------------
-- admin_assert_import_runner_access(p_source_id uuid)
--
-- Centralized role / source / community validation for every import write RPC.
-- Returns the source's community_id (safe minimal data) after confirming the
-- caller is authenticated and is an admin / event_manager with an ACTIVE
-- membership in the community that owns the source.
--
-- Not granted to clients: only the SECURITY DEFINER RPCs below call it, where
-- it runs with the definer's privileges. Never trusts community_id from any
-- payload -- the community is derived from the source row.
-- ---------------------------------------------------------------------------
create or replace function public.admin_assert_import_runner_access(p_source_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v_user_id uuid := auth.uid();
  v_community_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_source_id is null then
    raise exception 'import_source_not_found' using errcode = 'P0002',
      detail = 'source id is required';
  end if;

  select s.community_id
  into v_community_id
  from public.event_import_sources s
  where s.id = p_source_id;

  if not found then
    raise exception 'import_source_not_found' using errcode = 'P0002',
      detail = 'no import source with that id';
  end if;

  -- Role + active membership in the SOURCE's community. This is what ties the
  -- source to the caller's active community membership; a source in another
  -- community fails here as import_source_forbidden.
  if not public.has_community_role(v_community_id, array['admin', 'event_manager']) then
    raise exception 'import_source_forbidden' using errcode = '42501',
      detail = 'admin or event_manager active membership required for this source community';
  end if;

  return v_community_id;
end;
$func$;

revoke all on function public.admin_assert_import_runner_access(uuid) from public;

-- ---------------------------------------------------------------------------
-- admin_begin_import_run(payload jsonb)
--
-- Opens a new import run (status 'started') for a source. Payload shape:
--   { "sourceId": "<uuid>", "mode": "apply_review_only" }
-- (source_id / snake_case is also accepted defensively.)
--
-- Already-running guard, using server-side now() and the existing started_at
-- column (no new columns):
--   * an active 'started' run for the same source started within the stale
--     threshold -> reject with 'import_already_running';
--   * an active 'started' run older than the threshold -> marked 'failed' with
--     error 'stale_import_run_timed_out', then a fresh run is opened.
-- Stale threshold: 30 minutes.
--
-- Default (and only supported) mode is apply_review_only: this RPC never
-- auto-publishes and never writes events.
-- ---------------------------------------------------------------------------
create or replace function public.admin_begin_import_run(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_source_id uuid;
  v_community_id uuid;
  v_mode text;
  v_stale_threshold interval := interval '30 minutes';
  v_active record;
  v_run public.event_import_runs;
begin
  -- Routing: source id only. community_id is NEVER read from the payload.
  begin
    v_source_id := nullif(btrim(coalesce(v_payload ->> 'sourceId', v_payload ->> 'source_id')), '')::uuid;
  exception when others then
    raise exception 'import_source_not_found' using errcode = 'P0002',
      detail = 'sourceId must be a uuid';
  end;

  v_community_id := public.admin_assert_import_runner_access(v_source_id);

  -- Mode: only apply_review_only is supported in this PR (no auto-publish).
  v_mode := lower(coalesce(nullif(btrim(v_payload ->> 'mode'), ''), 'apply_review_only'));
  if v_mode <> 'apply_review_only' then
    raise exception 'import_mode_unsupported' using errcode = '22023',
      detail = 'only apply_review_only is supported in this PR';
  end if;

  -- Already-running guard. Look at the most recent 'started' run for the source.
  select id, started_at
  into v_active
  from public.event_import_runs
  where source_id = v_source_id
    and status = 'started'
  order by started_at desc
  limit 1;

  if found then
    if v_active.started_at > now() - v_stale_threshold then
      raise exception 'import_already_running' using errcode = '55006',
        detail = 'an import run for this source is already in progress';
    end if;

    -- Stale: time the old run out so a new one can start cleanly.
    update public.event_import_runs
    set status = 'failed',
        finished_at = now(),
        error = 'stale_import_run_timed_out'
    where id = v_active.id
      and status = 'started';
  end if;

  insert into public.event_import_runs (source_id, status, started_at)
  values (v_source_id, 'started', now())
  returning * into v_run;

  return jsonb_build_object(
    'runId', v_run.id,
    'sourceId', v_run.source_id,
    'communityId', v_community_id,
    'status', v_run.status,
    'mode', v_mode,
    'startedAt', v_run.started_at
  );
end;
$func$;

revoke all on function public.admin_begin_import_run(jsonb) from public;
grant execute on function public.admin_begin_import_run(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_upsert_import_item(p_run_id uuid, payload jsonb)
--
-- Writes a single review-queue item into event_import_items for an open run.
-- Payload shape (camelCase preferred, snake_case accepted defensively):
--   { externalId, sourceUrl, rawPayload, parsedTitle, parsedStartsAt,
--     parsedLocation, linkedEventId, status }
--
-- status must be one of the existing table statuses: new | linked | ignored |
-- error (default 'new'). Dedupe/review state is carried inside
-- rawPayload.importReview.dedupe and stored verbatim; it is never promoted to
-- the status column.
--
-- Upsert key: (run_id, external_id) when external_id is present, so retries of
-- the same source card within a run are idempotent. There is no UNIQUE
-- constraint on (source_id, external_id) in the schema (only a partial index),
-- and this PR does not add one; items without an external_id are always
-- inserted. Cross-run dedupe is the review queue's concern, not this writer's.
--
-- This RPC writes ONLY event_import_items. It never creates or updates events;
-- linkedEventId is accepted only as a reference and is validated to belong to
-- the same community (read-only check).
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_import_item(p_run_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_run public.event_import_runs;
  v_community_id uuid;
  v_external_id text;
  v_source_url text;
  v_raw_payload jsonb;
  v_parsed_title text;
  v_parsed_starts_at timestamptz;
  v_parsed_location text;
  v_linked_event_id uuid;
  v_status text;
  v_item_id uuid;
  v_action text;
begin
  if p_run_id is null then
    raise exception 'import_run_not_found' using errcode = 'P0002',
      detail = 'run id is required';
  end if;

  select *
  into v_run
  from public.event_import_runs
  where id = p_run_id;

  if not found then
    raise exception 'import_run_not_found' using errcode = 'P0002';
  end if;

  -- Auth / role / community are validated through the run's source.
  v_community_id := public.admin_assert_import_runner_access(v_run.source_id);

  if v_run.status <> 'started' then
    raise exception 'import_run_not_open' using errcode = '55000',
      detail = 'items can only be written while the run is started';
  end if;

  -- Item status from the allowed table statuses only.
  v_status := lower(coalesce(nullif(btrim(v_payload ->> 'status'), ''), 'new'));
  if v_status not in ('new', 'linked', 'ignored', 'error') then
    raise exception 'import_item_status_invalid' using errcode = '22023',
      detail = 'status must be one of new | linked | ignored | error';
  end if;

  v_external_id := nullif(btrim(v_payload ->> 'externalId'), '');
  if v_external_id is null then
    v_external_id := nullif(btrim(v_payload ->> 'external_id'), '');
  end if;

  v_source_url := nullif(btrim(coalesce(v_payload ->> 'sourceUrl', v_payload ->> 'source_url')), '');
  v_parsed_title := nullif(btrim(coalesce(v_payload ->> 'parsedTitle', v_payload ->> 'parsed_title')), '');
  v_parsed_location := nullif(btrim(coalesce(v_payload ->> 'parsedLocation', v_payload ->> 'parsed_location')), '');

  -- raw_payload jsonb (carries importReview.dedupe verbatim). Must be an object.
  v_raw_payload := coalesce(v_payload -> 'rawPayload', v_payload -> 'raw_payload', '{}'::jsonb);
  if jsonb_typeof(v_raw_payload) <> 'object' then
    raise exception 'import_item_raw_payload_invalid' using errcode = '22023',
      detail = 'rawPayload must be a json object';
  end if;

  begin
    v_parsed_starts_at := nullif(btrim(coalesce(v_payload ->> 'parsedStartsAt', v_payload ->> 'parsed_starts_at')), '')::timestamptz;
  exception when others then
    raise exception 'import_item_parsed_starts_at_invalid' using errcode = '22023',
      detail = 'parsedStartsAt must be a timestamptz';
  end;

  -- linkedEventId is only a reference; this RPC never creates/updates events.
  -- When present it must point at an event in the SAME (derived) community.
  begin
    v_linked_event_id := nullif(btrim(coalesce(v_payload ->> 'linkedEventId', v_payload ->> 'linked_event_id')), '')::uuid;
  exception when others then
    raise exception 'import_item_linked_event_invalid' using errcode = '22023',
      detail = 'linkedEventId must be a uuid';
  end;
  if v_linked_event_id is not null
     and not exists (
       select 1
       from public.events e
       where e.id = v_linked_event_id
         and e.community_id = v_community_id
     ) then
    raise exception 'import_item_linked_event_forbidden' using errcode = '42501',
      detail = 'linkedEventId must reference an event in this community';
  end if;

  -- Idempotent upsert within the run, keyed on (run_id, external_id) when an
  -- external_id is provided. No table UNIQUE constraint is relied on or added.
  if v_external_id is not null then
    update public.event_import_items
    set source_url = v_source_url,
        raw_payload = v_raw_payload,
        parsed_title = v_parsed_title,
        parsed_starts_at = v_parsed_starts_at,
        parsed_location = v_parsed_location,
        linked_event_id = v_linked_event_id,
        status = v_status
    where run_id = p_run_id
      and external_id = v_external_id
    returning id into v_item_id;

    if found then
      v_action := 'updated';
    end if;
  end if;

  if v_item_id is null then
    insert into public.event_import_items (
      source_id,
      run_id,
      external_id,
      source_url,
      raw_payload,
      parsed_title,
      parsed_starts_at,
      parsed_location,
      linked_event_id,
      status
    )
    values (
      v_run.source_id,
      p_run_id,
      v_external_id,
      v_source_url,
      v_raw_payload,
      v_parsed_title,
      v_parsed_starts_at,
      v_parsed_location,
      v_linked_event_id,
      v_status
    )
    returning id into v_item_id;

    v_action := 'inserted';
  end if;

  return jsonb_build_object(
    'itemId', v_item_id,
    'runId', p_run_id,
    'sourceId', v_run.source_id,
    'communityId', v_community_id,
    'externalId', v_external_id,
    'status', v_status,
    'action', v_action
  );
end;
$func$;

revoke all on function public.admin_upsert_import_item(uuid, jsonb) from public;
grant execute on function public.admin_upsert_import_item(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_finalize_import_run(p_run_id uuid, payload jsonb)
--
-- Closes an open run. Payload shape:
--   { status: "success" | "failed", foundCount, createdCount, updatedCount,
--     error }
--
-- Allowed final statuses are only 'success' or 'failed' (the existing table
-- statuses). Summary/error columns already exist on event_import_runs and are
-- the only thing updated here; absent counts keep their current value. This RPC
-- never publishes events and never mutates event_import_items.
-- ---------------------------------------------------------------------------
create or replace function public.admin_finalize_import_run(p_run_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_run public.event_import_runs;
  v_community_id uuid;
  v_status text;
  v_error text;
  v_found_count integer;
  v_created_count integer;
  v_updated_count integer;
begin
  if p_run_id is null then
    raise exception 'import_run_not_found' using errcode = 'P0002',
      detail = 'run id is required';
  end if;

  select *
  into v_run
  from public.event_import_runs
  where id = p_run_id;

  if not found then
    raise exception 'import_run_not_found' using errcode = 'P0002';
  end if;

  v_community_id := public.admin_assert_import_runner_access(v_run.source_id);

  if v_run.status <> 'started' then
    raise exception 'import_run_not_open' using errcode = '55000',
      detail = 'only a started run can be finalized';
  end if;

  v_status := lower(coalesce(nullif(btrim(v_payload ->> 'status'), ''), ''));
  if v_status not in ('success', 'failed') then
    raise exception 'import_final_status_invalid' using errcode = '22023',
      detail = 'final status must be success or failed';
  end if;

  v_error := nullif(btrim(v_payload ->> 'error'), '');

  begin
    v_found_count := nullif(btrim(coalesce(v_payload ->> 'foundCount', v_payload ->> 'found_count')), '')::integer;
    v_created_count := nullif(btrim(coalesce(v_payload ->> 'createdCount', v_payload ->> 'created_count')), '')::integer;
    v_updated_count := nullif(btrim(coalesce(v_payload ->> 'updatedCount', v_payload ->> 'updated_count')), '')::integer;
  exception when others then
    raise exception 'import_summary_invalid' using errcode = '22023',
      detail = 'count fields must be integers';
  end;

  update public.event_import_runs
  set status = v_status,
      finished_at = now(),
      error = v_error,
      found_count = coalesce(v_found_count, found_count),
      created_count = coalesce(v_created_count, created_count),
      updated_count = coalesce(v_updated_count, updated_count)
  where id = p_run_id
  returning * into v_run;

  return jsonb_build_object(
    'runId', v_run.id,
    'sourceId', v_run.source_id,
    'communityId', v_community_id,
    'status', v_run.status,
    'startedAt', v_run.started_at,
    'finishedAt', v_run.finished_at,
    'foundCount', v_run.found_count,
    'createdCount', v_run.created_count,
    'updatedCount', v_run.updated_count,
    'error', v_run.error
  );
end;
$func$;

revoke all on function public.admin_finalize_import_run(uuid, jsonb) from public;
grant execute on function public.admin_finalize_import_run(uuid, jsonb) to authenticated;
