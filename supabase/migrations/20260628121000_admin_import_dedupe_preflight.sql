-- Server-side dedupe preflight for admin website import.
--
-- This RPC is intentionally read-only. It checks parsed website import
-- candidates against existing review-queue items and already-created events in
-- the same community, then returns per-candidate dedupe state plus a transient
-- action for the Edge Function. Dedupe state still lives only in
-- raw_payload.importReview.dedupe for rows that are actually written.

create or replace function public.admin_preflight_import_dedupe(
  p_source_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_payload jsonb := coalesce(payload, '{}'::jsonb);
  v_candidates jsonb := coalesce(v_payload -> 'candidates', '[]'::jsonb);
  v_community_id uuid;
  v_checked_at timestamptz := now();
  v_results jsonb := '[]'::jsonb;
  v_candidate jsonb;
  v_ordinality bigint;
  v_index integer;
  v_external_id text;
  v_source_url text;
  v_canonical_source_url text;
  v_content_hash text;
  v_title text;
  v_title_key text;
  v_starts_at timestamptz;
  v_import_item_id uuid;
  v_import_matched_by text[];
  v_event_id uuid;
  v_event_manual_override boolean;
  v_event_matched_by text[];
  v_action text;
  v_status text;
  v_reason text;
  v_dedupe jsonb;
begin
  v_community_id := public.admin_assert_import_runner_access(p_source_id);

  if jsonb_typeof(v_candidates) <> 'array' then
    raise exception 'import_preflight_candidates_invalid' using errcode = '22023',
      detail = 'payload.candidates must be an array';
  end if;

  for v_candidate, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(v_candidates) with ordinality
  loop
    if jsonb_typeof(v_candidate) <> 'object' then
      raise exception 'import_preflight_candidates_invalid' using errcode = '22023',
        detail = 'every candidate must be a json object';
    end if;

    v_index := coalesce(
      nullif(btrim(v_candidate ->> 'index'), '')::integer,
      (v_ordinality - 1)::integer
    );
    v_external_id := nullif(btrim(coalesce(
      v_candidate ->> 'externalId',
      v_candidate ->> 'external_id',
      v_candidate ->> 'sourceExternalId',
      v_candidate ->> 'source_external_id'
    )), '');
    v_source_url := nullif(btrim(coalesce(
      v_candidate ->> 'sourceUrl',
      v_candidate ->> 'source_url'
    )), '');
    v_canonical_source_url := nullif(btrim(coalesce(
      v_candidate ->> 'canonicalSourceUrl',
      v_candidate ->> 'canonical_source_url',
      v_candidate #>> '{dedupe,canonicalSourceUrl}'
    )), '');
    v_content_hash := nullif(btrim(coalesce(
      v_candidate ->> 'contentHash',
      v_candidate ->> 'content_hash',
      v_candidate #>> '{dedupe,contentHash}'
    )), '');
    v_title := nullif(btrim(coalesce(
      v_candidate ->> 'parsedTitle',
      v_candidate ->> 'parsed_title',
      v_candidate ->> 'title'
    )), '');
    v_title_key := nullif(
      lower(regexp_replace(btrim(coalesce(v_title, '')), '[[:space:]]+', ' ', 'g')),
      ''
    );

    begin
      v_starts_at := nullif(btrim(coalesce(
        v_candidate ->> 'parsedStartsAt',
        v_candidate ->> 'parsed_starts_at',
        v_candidate ->> 'startsAt',
        v_candidate ->> 'starts_at'
      )), '')::timestamptz;
    exception when others then
      raise exception 'import_preflight_candidates_invalid' using errcode = '22023',
        detail = 'candidate parsedStartsAt must be a timestamptz';
    end;

    v_import_item_id := null;
    v_import_matched_by := null;
    v_event_id := null;
    v_event_manual_override := false;
    v_event_matched_by := null;

    select m.id, m.matched_by
    into v_import_item_id, v_import_matched_by
    from (
      select
        i.id,
        array_remove(array[
          case
            when v_external_id is not null
              and i.external_id = v_external_id
            then 'source_external_id'
          end,
          case
            when (
              (v_canonical_source_url is not null and (
                i.source_url = v_canonical_source_url
                or i.raw_payload #>> '{importReview,dedupe,canonicalSourceUrl}' = v_canonical_source_url
              ))
              or
              (v_source_url is not null and (
                i.source_url = v_source_url
                or i.raw_payload #>> '{importReview,dedupe,canonicalSourceUrl}' = v_source_url
              ))
            )
            then 'canonical_url'
          end,
          case
            when v_content_hash is not null
              and i.raw_payload #>> '{importReview,dedupe,contentHash}' = v_content_hash
            then 'content_hash'
          end,
          case
            when v_title_key is not null
              and v_starts_at is not null
              and nullif(
                lower(regexp_replace(btrim(coalesce(i.parsed_title, '')), '[[:space:]]+', ' ', 'g')),
                ''
              ) = v_title_key
              and i.parsed_starts_at = v_starts_at
            then 'title_starts_at'
          end
        ], null) as matched_by,
        least(
          case
            when v_external_id is not null
              and i.external_id = v_external_id
            then 1 else 99
          end,
          case
            when (
              (v_canonical_source_url is not null and (
                i.source_url = v_canonical_source_url
                or i.raw_payload #>> '{importReview,dedupe,canonicalSourceUrl}' = v_canonical_source_url
              ))
              or
              (v_source_url is not null and (
                i.source_url = v_source_url
                or i.raw_payload #>> '{importReview,dedupe,canonicalSourceUrl}' = v_source_url
              ))
            )
            then 2 else 99
          end,
          case
            when v_content_hash is not null
              and i.raw_payload #>> '{importReview,dedupe,contentHash}' = v_content_hash
            then 3 else 99
          end,
          case
            when v_title_key is not null
              and v_starts_at is not null
              and nullif(
                lower(regexp_replace(btrim(coalesce(i.parsed_title, '')), '[[:space:]]+', ' ', 'g')),
                ''
              ) = v_title_key
              and i.parsed_starts_at = v_starts_at
            then 4 else 99
          end
        ) as match_priority,
        i.created_at
      from public.event_import_items i
      where i.source_id = p_source_id
        and i.linked_event_id is null
        and i.status in ('new', 'error')
    ) m
    where coalesce(array_length(m.matched_by, 1), 0) > 0
    order by m.match_priority, m.created_at desc, m.id
    limit 1;

    if v_import_item_id is null then
      select m.id, m.manual_override, m.matched_by
      into v_event_id, v_event_manual_override, v_event_matched_by
      from (
        select
          e.id,
          e.manual_override,
          array_remove(array[
            case
              when v_external_id is not null
                and e.source_external_id = v_external_id
              then 'source_external_id'
            end,
            case
              when (
                (v_canonical_source_url is not null and e.source_url = v_canonical_source_url)
                or (v_source_url is not null and e.source_url = v_source_url)
              )
              then 'canonical_url'
            end,
            case
              when v_title_key is not null
                and v_starts_at is not null
                and nullif(
                  lower(regexp_replace(btrim(coalesce(e.title, '')), '[[:space:]]+', ' ', 'g')),
                  ''
                ) = v_title_key
                and e.starts_at = v_starts_at
              then 'title_starts_at'
            end
          ], null) as matched_by,
          least(
            case
              when v_external_id is not null
                and e.source_external_id = v_external_id
              then 1 else 99
            end,
            case
              when (
                (v_canonical_source_url is not null and e.source_url = v_canonical_source_url)
                or (v_source_url is not null and e.source_url = v_source_url)
              )
              then 2 else 99
            end,
            case
              when v_title_key is not null
                and v_starts_at is not null
                and nullif(
                  lower(regexp_replace(btrim(coalesce(e.title, '')), '[[:space:]]+', ' ', 'g')),
                  ''
                ) = v_title_key
                and e.starts_at = v_starts_at
              then 3 else 99
            end
          ) as match_priority,
          e.created_at
        from public.events e
        where e.community_id = v_community_id
          and e.source_type = 'website_scrape'
      ) m
      where coalesce(array_length(m.matched_by, 1), 0) > 0
      order by m.match_priority, m.created_at desc, m.id
      limit 1;
    end if;

    if v_import_item_id is not null then
      v_action := 'skip_existing_import_item';
      v_status := 'duplicate';
      v_reason := 'A matching website import item is already open in the review queue.';
    elsif v_event_id is not null then
      v_action := 'skip_existing_event';
      v_status := case
        when v_event_matched_by && array['source_external_id', 'canonical_url']
          then 'linked_existing'
        else 'possible_duplicate'
      end;
      v_reason := case
        when v_status = 'linked_existing'
          then 'A matching website event already exists in the main events table.'
        else 'A similar website event already exists in the main events table.'
      end;
    else
      v_action := 'write';
      v_status := 'new';
      v_reason := 'No matching open import item or existing website event was found.';
    end if;

    v_dedupe := jsonb_build_object(
      'version', 1,
      'status', v_status,
      'reason', v_reason,
      'matchedBy', coalesce(to_jsonb(v_import_matched_by), to_jsonb(v_event_matched_by), '[]'::jsonb),
      'matchedEventId', v_event_id,
      'matchedImportItemId', v_import_item_id,
      'manualOverride', coalesce(v_event_manual_override, false),
      'contentHash', v_content_hash,
      'canonicalSourceUrl', coalesce(v_canonical_source_url, v_source_url),
      'sourceExternalId', v_external_id,
      'checkedAt', v_checked_at
    );

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'index', v_index,
        'action', v_action,
        'dedupe', v_dedupe
      )
    );
  end loop;

  return jsonb_build_object(
    'sourceId', p_source_id,
    'communityId', v_community_id,
    'checkedAt', v_checked_at,
    'results', v_results
  );
end;
$func$;

revoke all on function public.admin_preflight_import_dedupe(uuid, jsonb) from public;
grant execute on function public.admin_preflight_import_dedupe(uuid, jsonb) to authenticated;
