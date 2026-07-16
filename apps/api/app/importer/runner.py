from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import Event
from app.db.models.imports import EventImportItem, EventImportRun, EventImportSource
from app.importer import dedupe
from app.importer.parser import (
    ParserOptions,
    ParsedImportItem,
    ParsedWebsiteResult,
    parse_website_events,
    safe_error_message,
)

WEBSITE_SOURCE_TYPE = "website_scrape"
RUN_MODE = "apply_review_only"
RUN_STATUS_STARTED = "started"
RUN_STATUS_SUCCESS = "success"
RUN_STATUS_FAILED = "failed"
ITEM_STATUS_NEW = "new"
ITEM_STATUS_ERROR = "error"
SKIP_EXISTING_IMPORT_ITEM = "skip_existing_import_item"
SKIP_EXISTING_EVENT = "skip_existing_event"
WRITE_IMPORT_ITEM = "write_import_item"


@dataclass(frozen=True, slots=True)
class DedupeDecision:
    action: str
    outcome: dict[str, object]


@asynccontextmanager
async def _transaction_scope(session: AsyncSession) -> AsyncIterator[None]:
    if session.in_transaction():
        try:
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        return

    async with session.begin():
        yield


def _json_object(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _item_base_dedupe(item: ParsedImportItem) -> dict[str, object] | None:
    review = _json_object(item.import_review)
    base = review.get("dedupe")
    return base if isinstance(base, dict) else None


def _raw_payload_with_dedupe(
    item: ParsedImportItem,
    next_dedupe: dict[str, object],
    *,
    import_status: str,
    import_status_reason: str | None = None,
) -> dict[str, object]:
    raw_payload = deepcopy(item.raw_payload)
    if not isinstance(raw_payload, dict):
        raw_payload = {}

    review = raw_payload.get("importReview")
    if not isinstance(review, dict):
        review = {}
    review["dedupe"] = next_dedupe
    raw_payload["importReview"] = review
    raw_payload["import_status"] = import_status
    raw_payload["import_status_reason"] = import_status_reason
    return raw_payload


async def _matching_open_import_item_id(
    session: AsyncSession,
    *,
    source_id: UUID,
    external_id: str | None,
    canonical_source_url: str | None,
) -> tuple[UUID, str] | None:
    if not external_id and not canonical_source_url:
        return None

    query = select(EventImportItem).where(
        EventImportItem.source_id == source_id,
        EventImportItem.linked_event_id.is_(None),
        EventImportItem.status.in_([ITEM_STATUS_NEW, ITEM_STATUS_ERROR]),
    )
    candidates = list(
        await session.scalars(
            query.order_by(EventImportItem.created_at, EventImportItem.id),
        )
    )
    for candidate in candidates:
        if external_id and candidate.external_id == external_id:
            return candidate.id, "source_external_id"
        if (
            canonical_source_url
            and dedupe.canonicalize_source_url(candidate.source_url) == canonical_source_url
        ):
            return candidate.id, "canonical_source_url"
    return None


async def _matching_existing_event(
    session: AsyncSession,
    *,
    community_id: UUID,
    external_id: str | None,
    canonical_source_url: str | None,
) -> tuple[Event, str] | None:
    if not external_id and not canonical_source_url:
        return None

    candidates = list(
        await session.scalars(
            select(Event)
            .where(
                Event.community_id == community_id,
                Event.source_type == WEBSITE_SOURCE_TYPE,
            )
            .order_by(Event.created_at, Event.id)
        )
    )
    for candidate in candidates:
        if external_id and candidate.source_external_id == external_id:
            return candidate, "source_external_id"
        if (
            canonical_source_url
            and dedupe.canonicalize_source_url(candidate.source_url) == canonical_source_url
        ):
            return candidate, "canonical_source_url"
    return None


async def _matching_event_by_title_and_time(
    session: AsyncSession,
    *,
    community_id: UUID,
    item: ParsedImportItem,
) -> Event | None:
    if not item.title or item.starts_at is None:
        return None

    return await session.scalar(
        select(Event)
        .where(
            Event.community_id == community_id,
            func.lower(Event.title) == item.title.lower(),
            Event.starts_at == item.starts_at,
        )
        .order_by(Event.created_at, Event.id)
        .limit(1),
    )


async def _dedupe_for_item(
    session: AsyncSession,
    *,
    source: EventImportSource,
    item: ParsedImportItem,
    item_error: str | None,
) -> DedupeDecision:
    base_dedupe = _item_base_dedupe(item)

    if item_error:
        return DedupeDecision(
            action=WRITE_IMPORT_ITEM,
            outcome=dedupe.finalize_dedupe(
                base_dedupe,
                {
                    "status": "error",
                    "reason": item_error,
                    "matchedBy": [],
                    "matchedEventId": None,
                    "matchedImportItemId": None,
                    "manualOverride": False,
                },
            ),
        )

    canonical_source_url = (
        str(base_dedupe.get("canonicalSourceUrl"))
        if base_dedupe and base_dedupe.get("canonicalSourceUrl")
        else dedupe.canonicalize_source_url(item.source_url)
    )
    existing_item = await _matching_open_import_item_id(
        session,
        source_id=source.id,
        external_id=item.external_id,
        canonical_source_url=canonical_source_url,
    )
    if existing_item is not None:
        existing_item_id, matched_by = existing_item
        return DedupeDecision(
            action=SKIP_EXISTING_IMPORT_ITEM,
            outcome=dedupe.finalize_dedupe(
                base_dedupe,
                dedupe.duplicate_import_item_outcome(
                    existing_item_id,
                    matched_by=matched_by,
                ),
            ),
        )

    existing_event_match = await _matching_existing_event(
        session,
        community_id=source.community_id,
        external_id=item.external_id,
        canonical_source_url=canonical_source_url,
    )
    if existing_event_match is not None:
        existing_event, matched_by = existing_event_match
        return DedupeDecision(
            action=SKIP_EXISTING_EVENT,
            outcome=dedupe.finalize_dedupe(
                base_dedupe,
                dedupe.linked_event_outcome(
                    event_id=existing_event.id,
                    manual_override=existing_event.manual_override,
                    matched_by=matched_by,
                ),
            ),
        )

    possible_duplicate = await _matching_event_by_title_and_time(
        session,
        community_id=source.community_id,
        item=item,
    )
    if possible_duplicate is not None:
        return DedupeDecision(
            action=WRITE_IMPORT_ITEM,
            outcome=dedupe.finalize_dedupe(
                base_dedupe,
                dedupe.possible_duplicate_event_outcome(possible_duplicate.id),
            ),
        )

    return DedupeDecision(
        action=WRITE_IMPORT_ITEM,
        outcome=dedupe.finalize_dedupe(base_dedupe, dedupe.no_match_outcome()),
    )


def _summary_payload(
    *,
    result: ParsedWebsiteResult,
    parsed_count: int,
    error_count: int,
    written_count: int,
    skipped_existing_import_item_count: int,
    skipped_existing_event_count: int,
    possible_duplicate_count: int,
    date_confidence_counts: Counter[str],
    dedupe_counts: Counter[str],
) -> dict[str, object]:
    return {
        "foundOnList": result.found_on_list,
        "itemsWritten": written_count,
        "written": written_count,
        "skipped": skipped_existing_import_item_count + skipped_existing_event_count,
        "skippedExistingImportItem": skipped_existing_import_item_count,
        "skippedExistingEvent": skipped_existing_event_count,
        "possibleDuplicate": possible_duplicate_count,
        "itemErrors": error_count,
        "parsedCount": parsed_count,
        "errorCount": error_count,
        "dateConfidenceCounts": dict(date_confidence_counts),
        "dedupeStatusCounts": dict(dedupe_counts),
        "autoPublish": False,
    }


async def _finish_failed_run(
    session: AsyncSession,
    *,
    run_id: UUID,
    message: str,
) -> EventImportRun:
    async with _transaction_scope(session):
        run = await session.scalar(
            select(EventImportRun)
            .where(EventImportRun.id == run_id)
            .with_for_update(),
        )
        if run is None:
            raise RuntimeError("Import run disappeared before failure could be stored")

        run.status = RUN_STATUS_FAILED
        run.finished_at = func.now()
        run.error = message
        run.summary = {"error": message, "autoPublish": False}
        await session.flush()
        await session.refresh(run)
        return run


async def execute_review_import(
    session: AsyncSession,
    *,
    run_id: UUID,
    source_id: UUID,
    source_url: str,
    limit: int | None,
    assume_year: int | None,
) -> EventImportRun:
    try:
        result = await asyncio.to_thread(
            parse_website_events,
            ParserOptions(
                source_url=source_url,
                limit=limit,
                assume_year=assume_year,
            ),
        )
    except Exception as exc:
        return await _finish_failed_run(
            session,
            run_id=run_id,
            message=safe_error_message(exc),
        )

    try:
        async with _transaction_scope(session):
            run = await session.scalar(
                select(EventImportRun)
                .where(EventImportRun.id == run_id)
                .with_for_update(),
            )
            source = await session.scalar(
                select(EventImportSource)
                .where(EventImportSource.id == source_id)
                .with_for_update(),
            )
            if run is None or source is None:
                raise RuntimeError("Import run or source disappeared during import")

            parsed_count = 0
            error_count = 0
            written_count = 0
            skipped_existing_import_item_count = 0
            skipped_existing_event_count = 0
            possible_duplicate_count = 0
            date_confidence_counts: Counter[str] = Counter()
            dedupe_counts: Counter[str] = Counter()

            for parsed_result in result.items:
                item = parsed_result.item
                item_error = parsed_result.error
                if item_error:
                    error_count += 1
                else:
                    parsed_count += 1
                date_confidence_counts[item.date_confidence] += 1

                decision = await _dedupe_for_item(
                    session,
                    source=source,
                    item=item,
                    item_error=item_error,
                )
                dedupe_status = decision.outcome.get("status")
                if isinstance(dedupe_status, str):
                    dedupe_counts[dedupe_status] += 1

                if dedupe_status == "possible_duplicate":
                    possible_duplicate_count += 1
                if decision.action == SKIP_EXISTING_IMPORT_ITEM:
                    skipped_existing_import_item_count += 1
                    continue
                if decision.action == SKIP_EXISTING_EVENT:
                    skipped_existing_event_count += 1
                    continue

                item_status = ITEM_STATUS_ERROR if item_error else ITEM_STATUS_NEW
                raw_payload = _raw_payload_with_dedupe(
                    item,
                    decision.outcome,
                    import_status=item_status,
                    import_status_reason=item_error,
                )
                session.add(
                    EventImportItem(
                        run_id=run.id,
                        source_id=source.id,
                        external_id=item.external_id,
                        source_url=item.source_url,
                        raw_payload=raw_payload,
                        parsed_title=item.title,
                        parsed_starts_at=item.starts_at,
                        parsed_location=item.parsed_location,
                        linked_event_id=None,
                        status=item_status,
                        error=item_error,
                    ),
                )
                written_count += 1

            run.status = RUN_STATUS_SUCCESS
            run.finished_at = func.now()
            run.found_count = result.found_on_list
            run.parsed_count = parsed_count
            run.created_count = 0
            run.updated_count = 0
            run.error = (
                f"Completed with {error_count} item error(s)."
                if error_count > 0
                else None
            )
            run.summary = _summary_payload(
                result=result,
                parsed_count=parsed_count,
                error_count=error_count,
                written_count=written_count,
                skipped_existing_import_item_count=skipped_existing_import_item_count,
                skipped_existing_event_count=skipped_existing_event_count,
                possible_duplicate_count=possible_duplicate_count,
                date_confidence_counts=date_confidence_counts,
                dedupe_counts=dedupe_counts,
            )
            run.parser_metadata = {
                "parserName": "sredi_svoih_events",
                "parserVersion": "1.2.0-api",
                "sourceUrl": source.source_url,
                "limit": limit,
                "assumeYear": assume_year,
            }
            run.debug_metadata = {"autoPublish": False}
            await session.flush()
            await session.refresh(run)
            return run
    except Exception as exc:
        return await _finish_failed_run(
            session,
            run_id=run_id,
            message=safe_error_message(exc),
        )
