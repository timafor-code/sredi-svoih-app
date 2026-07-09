from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, Event, EventCategory
from app.db.models.imports import EventImportItem, EventImportRun, EventImportSource
from app.importer import dedupe
from app.importer.parser import (
    DEFAULT_SOURCE_TITLE,
    DEFAULT_SOURCE_URL,
    PARSER_NAME,
    PARSER_VERSION,
    TIMEZONE,
    validate_import_detail_url,
    validate_import_source_url,
)
from app.importer.runner import WEBSITE_SOURCE_TYPE, execute_review_import
from app.schemas.admin_events import AdminEventResponse
from app.schemas.admin_import import (
    AdminImportIgnoreRequest,
    AdminImportItemPublishRequest,
    AdminImportItemResponse,
    AdminImportPublishResponse,
    AdminImportRunCreateRequest,
    AdminImportRunResponse,
)
from app.services.admin_events import resolve_manageable_community_ids

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100
IMPORT_RUN_MODE = "apply_review_only"
IMPORT_RUN_STATUS_STARTED = "started"
IMPORT_RUN_STATUS_SUCCESS = "success"
IMPORT_ITEM_STATUSES = frozenset({"new", "linked", "ignored", "error"})


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


def _now() -> datetime:
    return datetime.now(UTC)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _forbidden(message: str = "Admin import permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Import item not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


def _conflict(message: str) -> HTTPException:
    return _error(http_status.HTTP_409_CONFLICT, "conflict", message)


def _json_object(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_text(*values: object | None) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _validated_source_url(value: str | None) -> str:
    try:
        return validate_import_source_url(value or DEFAULT_SOURCE_URL)
    except ValueError as exc:
        raise _validation_error("Import source URL is not allowed") from exc


def _validated_event_source_url(value: object | None) -> str | None:
    text = _first_text(value)
    if text is None:
        return None
    try:
        return validate_import_detail_url(text)
    except ValueError as exc:
        raise _validation_error("Event source_url must be an allowed website event URL") from exc


def _require_manageable_communities(community_ids: Sequence[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _require_manageable_community(
    community_id: UUID,
    manageable_community_ids: Sequence[UUID],
) -> None:
    _require_manageable_communities(manageable_community_ids)
    if community_id not in set(manageable_community_ids):
        raise _forbidden()


def _resolve_payload_community_id(
    payload: AdminImportRunCreateRequest,
    manageable_community_ids: Sequence[UUID],
) -> UUID:
    _require_manageable_communities(manageable_community_ids)
    if payload.community_id is not None:
        _require_manageable_community(payload.community_id, manageable_community_ids)
        return payload.community_id
    if len(manageable_community_ids) == 1:
        return manageable_community_ids[0]
    raise _validation_error("community_id is required when source_id is not provided")


def _source_settings(source: EventImportSource) -> dict[str, Any]:
    settings = dict(source.settings or {})
    settings.update(
        {
            "parserName": PARSER_NAME,
            "parserVersion": PARSER_VERSION,
            "autoPublish": False,
        },
    )
    return settings


def _run_response(
    run: EventImportRun,
    source: EventImportSource,
) -> AdminImportRunResponse:
    return AdminImportRunResponse(
        id=run.id,
        source_id=run.source_id,
        community_id=run.community_id,
        source_key=source.key,
        source_title=source.title,
        source_url=source.source_url,
        mode=run.mode,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        found_count=run.found_count,
        parsed_count=run.parsed_count,
        created_count=run.created_count,
        updated_count=run.updated_count,
        error=run.error,
        summary=dict(run.summary or {}),
        parser_metadata=dict(run.parser_metadata or {}),
        debug_metadata=dict(run.debug_metadata or {}),
        created_by=run.created_by,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def _item_response(
    item: EventImportItem,
    source: EventImportSource,
) -> AdminImportItemResponse:
    return AdminImportItemResponse(
        id=item.id,
        run_id=item.run_id,
        source_id=item.source_id,
        community_id=source.community_id,
        source_key=source.key,
        source_title=source.title,
        external_id=item.external_id,
        source_url=item.source_url,
        raw_payload=dict(item.raw_payload or {}),
        parsed_title=item.parsed_title,
        parsed_starts_at=item.parsed_starts_at,
        parsed_location=item.parsed_location,
        linked_event_id=item.linked_event_id,
        status=item.status,
        error=item.error,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _get_import_run_response(
    session: AsyncSession,
    *,
    run_id: UUID,
    manageable_community_ids: Sequence[UUID],
) -> AdminImportRunResponse:
    row = (
        await session.execute(
            select(EventImportRun, EventImportSource)
            .join(EventImportSource, EventImportSource.id == EventImportRun.source_id)
            .where(
                EventImportRun.id == run_id,
                EventImportRun.community_id.in_(manageable_community_ids),
            ),
        )
    ).one_or_none()
    if row is None:
        raise _not_found("Import run not found")
    return _run_response(row[0], row[1])


async def _resolve_or_create_source(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminImportRunCreateRequest,
    manageable_community_ids: Sequence[UUID],
) -> EventImportSource:
    if payload.source_id is not None:
        source = await session.scalar(
            select(EventImportSource)
            .where(
                EventImportSource.id == payload.source_id,
                EventImportSource.community_id.in_(manageable_community_ids),
                EventImportSource.is_active.is_(True),
            )
            .with_for_update(),
        )
        if source is None:
            raise _not_found("Import source not found")
        source.source_url = _validated_source_url(source.source_url)
        source.settings = _source_settings(source)
        await session.flush()
        await session.refresh(source)
        return source

    community_id = _resolve_payload_community_id(payload, manageable_community_ids)
    source_url = _validated_source_url(payload.source_url)
    source_title = payload.source_title or DEFAULT_SOURCE_TITLE

    source = await session.scalar(
        select(EventImportSource)
        .where(
            EventImportSource.community_id == community_id,
            EventImportSource.key == payload.source_key,
        )
        .with_for_update(),
    )
    if source is None:
        source = EventImportSource(
            community_id=community_id,
            key=payload.source_key,
            title=source_title,
            source_type=WEBSITE_SOURCE_TYPE,
            source_url=source_url,
            settings={},
            is_active=True,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        session.add(source)
        await session.flush()
    else:
        source.title = source_title
        source.source_type = WEBSITE_SOURCE_TYPE
        source.source_url = source_url
        source.is_active = True
        source.updated_by = current_user.id
        source.updated_at = _now()

    source.settings = _source_settings(source)
    await session.flush()
    await session.refresh(source)
    return source


async def create_admin_import_run(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminImportRunCreateRequest,
) -> AdminImportRunResponse:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    try:
        async with _transaction_scope(session):
            source = await _resolve_or_create_source(
                session,
                current_user,
                payload,
                manageable_community_ids,
            )
            running_run_id = await session.scalar(
                select(EventImportRun.id)
                .where(
                    EventImportRun.source_id == source.id,
                    EventImportRun.status == IMPORT_RUN_STATUS_STARTED,
                )
                .limit(1),
            )
            if running_run_id is not None:
                raise _conflict("An import run is already running for this source")

            run = EventImportRun(
                source_id=source.id,
                community_id=source.community_id,
                mode=IMPORT_RUN_MODE,
                status=IMPORT_RUN_STATUS_STARTED,
                found_count=0,
                parsed_count=None,
                created_count=0,
                updated_count=0,
                summary={"autoPublish": False},
                parser_metadata={
                    "parserName": PARSER_NAME,
                    "parserVersion": PARSER_VERSION,
                    "sourceUrl": source.source_url,
                },
                debug_metadata={"autoPublish": False},
                created_by=current_user.id,
            )
            session.add(run)
            await session.flush()
            await session.refresh(run)
            run_id = run.id
            source_id = source.id
            source_url = source.source_url
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict("An import run is already running for this source") from exc

    await execute_review_import(
        session,
        run_id=run_id,
        source_id=source_id,
        source_url=source_url,
        limit=payload.limit,
        assume_year=payload.assume_year,
    )
    return await _get_import_run_response(
        session,
        run_id=run_id,
        manageable_community_ids=manageable_community_ids,
    )


async def list_admin_import_runs(
    session: AsyncSession,
    current_user: AppUser,
    *,
    limit: int,
    offset: int,
) -> list[AdminImportRunResponse]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    rows = (
        (
            await session.execute(
                select(EventImportRun, EventImportSource)
                .join(EventImportSource, EventImportSource.id == EventImportRun.source_id)
                .where(EventImportRun.community_id.in_(manageable_community_ids))
                .order_by(
                    EventImportRun.started_at.desc(),
                    EventImportRun.id.desc(),
                )
                .limit(limit)
                .offset(offset),
            )
        )
        .tuples()
        .all()
    )
    return [_run_response(run, source) for run, source in rows]


def _normalize_status_filter(status: str | None) -> str | None:
    normalized = _first_text(status)
    if normalized is None or normalized == "all":
        return None
    normalized = normalized.lower()
    if normalized not in IMPORT_ITEM_STATUSES:
        raise _validation_error("Invalid import item status")
    return normalized


async def list_admin_import_items(
    session: AsyncSession,
    current_user: AppUser,
    *,
    status: str | None,
    source_id: UUID | None,
    run_id: UUID | None,
    limit: int,
    offset: int,
) -> list[AdminImportItemResponse]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)
    status_filter = _normalize_status_filter(status)

    query = (
        select(EventImportItem, EventImportSource)
        .join(EventImportSource, EventImportSource.id == EventImportItem.source_id)
        .where(EventImportSource.community_id.in_(manageable_community_ids))
    )
    if status_filter is not None:
        query = query.where(EventImportItem.status == status_filter)
    if source_id is not None:
        query = query.where(EventImportItem.source_id == source_id)
    if run_id is not None:
        query = query.where(EventImportItem.run_id == run_id)

    rows = (
        (
            await session.execute(
                query.order_by(
                    EventImportItem.created_at.desc(),
                    EventImportItem.id.desc(),
                )
                .limit(limit)
                .offset(offset),
            )
        )
        .tuples()
        .all()
    )
    return [_item_response(item, source) for item, source in rows]


async def get_admin_import_item(
    session: AsyncSession,
    current_user: AppUser,
    item_id: UUID,
) -> AdminImportItemResponse:
    item, source = await _get_scoped_import_item_with_source(
        session,
        current_user,
        item_id,
        lock=False,
    )
    return _item_response(item, source)


async def _get_scoped_import_item_with_source(
    session: AsyncSession,
    current_user: AppUser,
    item_id: UUID,
    *,
    lock: bool,
) -> tuple[EventImportItem, EventImportSource]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    query = (
        select(EventImportItem, EventImportSource)
        .join(EventImportSource, EventImportSource.id == EventImportItem.source_id)
        .where(
            EventImportItem.id == item_id,
            EventImportSource.community_id.in_(manageable_community_ids),
        )
    )
    if lock:
        query = query.with_for_update(of=EventImportItem)

    row = (await session.execute(query)).one_or_none()
    if row is None:
        raise _not_found()
    return row[0], row[1]


async def ignore_admin_import_item(
    session: AsyncSession,
    current_user: AppUser,
    item_id: UUID,
    payload: AdminImportIgnoreRequest,
) -> AdminImportItemResponse:
    async with _transaction_scope(session):
        item, source = await _get_scoped_import_item_with_source(
            session,
            current_user,
            item_id,
            lock=True,
        )
        raw_payload = deepcopy(dict(item.raw_payload or {}))
        raw_payload["adminReview"] = {
            **_json_object(raw_payload.get("adminReview")),
            "ignoredAt": _now().isoformat().replace("+00:00", "Z"),
            "ignoredBy": str(current_user.id),
            "ignoreReason": payload.reason,
        }
        raw_payload["import_status"] = "ignored"
        raw_payload["import_status_reason"] = payload.reason

        item.status = "ignored"
        item.raw_payload = raw_payload
        item.updated_at = _now()
        await session.flush()
        await session.refresh(item)
        return _item_response(item, source)


def _parse_datetime(value: object | None) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _payload_has(
    payload: AdminImportItemPublishRequest,
    field_name: str,
) -> bool:
    return field_name in payload.model_fields_set


def _payload_value(
    payload: AdminImportItemPublishRequest,
    field_name: str,
    fallback: Any,
    *,
    allow_none: bool = True,
) -> Any:
    if _payload_has(payload, field_name):
        value = getattr(payload, field_name)
        if value is None and not allow_none:
            return fallback
        return value
    return fallback


async def _category_exists(
    session: AsyncSession,
    *,
    community_id: UUID,
    category: str,
) -> bool:
    category_id = await session.scalar(
        select(EventCategory.id).where(
            EventCategory.community_id == community_id,
            EventCategory.slug == category,
        ),
    )
    return category_id is not None


async def _resolve_event_category(
    session: AsyncSession,
    *,
    community_id: UUID,
    category: str | None,
    explicit: bool,
) -> str:
    desired = _first_text(category) or "community"
    if await _category_exists(session, community_id=community_id, category=desired):
        return desired
    if explicit:
        raise _validation_error("category does not exist in this community")
    if desired != "community" and await _category_exists(
        session,
        community_id=community_id,
        category="community",
    ):
        return "community"
    raise _validation_error("category does not exist in this community")


def _validate_event_state(
    *,
    starts_at: datetime | None,
    ends_at: datetime | None,
    status: str,
    visibility: str,
    registration_mode: str,
    registration_url: str | None,
    price_amount: int | None,
    price_currency: str | None,
) -> str | None:
    if status == "published" and visibility == "hidden":
        raise _validation_error("published import events cannot be hidden")
    if starts_at is None:
        if status == "published":
            raise _validation_error("starts_at is required for published import events")
        raise _validation_error("starts_at could not be resolved for the draft event")
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        raise _validation_error("starts_at must be an ISO 8601 datetime with timezone")
    if ends_at is not None:
        if ends_at.tzinfo is None or ends_at.utcoffset() is None:
            raise _validation_error("ends_at must be an ISO 8601 datetime with timezone")
        if ends_at <= starts_at:
            raise _validation_error("ends_at must be greater than starts_at")
    if registration_mode == "external_link" and registration_url is None:
        raise _validation_error("registration_url is required for external_link")
    if price_amount is not None and price_currency is None:
        return "RUB"
    return price_currency


async def _resolve_publish_event(
    session: AsyncSession,
    *,
    item: EventImportItem,
    source: EventImportSource,
    payload: AdminImportItemPublishRequest,
) -> Event | None:
    if payload.event_id is not None:
        event = await session.scalar(
            select(Event)
            .where(
                Event.id == payload.event_id,
                Event.community_id == source.community_id,
            )
            .with_for_update(),
        )
        if event is None:
            raise _not_found("Event not found")
        return event

    if item.linked_event_id is not None:
        event = await session.scalar(
            select(Event)
            .where(
                Event.id == item.linked_event_id,
                Event.community_id == source.community_id,
            )
            .with_for_update(),
        )
        if event is not None:
            return event

    if item.external_id:
        return await session.scalar(
            select(Event)
            .where(
                Event.community_id == source.community_id,
                Event.source_type == WEBSITE_SOURCE_TYPE,
                Event.source_external_id == item.external_id,
            )
            .order_by(Event.created_at, Event.id)
            .limit(1)
            .with_for_update(),
        )

    return None


def _raw_paths(item: EventImportItem) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    raw_payload = _json_object(item.raw_payload)
    parsed = _json_object(raw_payload.get("parsed"))
    detail = _json_object(raw_payload.get("detail"))
    return raw_payload, parsed, detail


def _raw_starts_at(item: EventImportItem, raw_payload: dict[str, Any], parsed: dict[str, Any]) -> datetime | None:
    if item.parsed_starts_at is not None:
        return item.parsed_starts_at
    review = _json_object(raw_payload.get("importReview"))
    return _parse_datetime(parsed.get("starts_at")) or _parse_datetime(
        review.get("suggestedStartsAt"),
    )


def _resolved_starts_at(
    *,
    item: EventImportItem,
    existing_event: Event | None,
    requested_starts_at: datetime | None,
    status: str,
) -> datetime | None:
    if requested_starts_at is not None:
        return requested_starts_at
    if status == "published":
        return None
    if existing_event is not None:
        return existing_event.starts_at
    starts_at = item.created_at
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        return starts_at.replace(tzinfo=UTC)
    return starts_at


async def _build_event_values(
    session: AsyncSession,
    *,
    item: EventImportItem,
    source: EventImportSource,
    payload: AdminImportItemPublishRequest,
    existing_event: Event | None,
) -> dict[str, Any]:
    raw_payload, parsed, detail = _raw_paths(item)
    creating = existing_event is None

    title = _payload_value(
        payload,
        "title",
        _first_text(item.parsed_title, parsed.get("title"), detail.get("title")),
    )
    requested_starts_at = _payload_value(
        payload,
        "starts_at",
        _raw_starts_at(item, raw_payload, parsed),
    )
    ends_at = _payload_value(
        payload,
        "ends_at",
        existing_event.ends_at if existing_event is not None else None,
    )
    category = await _resolve_event_category(
        session,
        community_id=source.community_id,
        category=_payload_value(
            payload,
            "category",
            _first_text(parsed.get("category"), existing_event.category if existing_event else None, "community"),
        ),
        explicit=_payload_has(payload, "category"),
    )
    status = _payload_value(
        payload,
        "status",
        "draft" if creating else existing_event.status,
        allow_none=False,
    )
    visibility = _payload_value(
        payload,
        "visibility",
        "hidden" if creating else existing_event.visibility,
        allow_none=False,
    )
    starts_at = _resolved_starts_at(
        item=item,
        existing_event=existing_event,
        requested_starts_at=requested_starts_at,
        status=status,
    )
    registration_mode = _payload_value(
        payload,
        "registration_mode",
        _first_text(
            parsed.get("registration_mode"),
            existing_event.registration_mode if existing_event else None,
            "none",
        ),
        allow_none=False,
    )
    registration_url = _payload_value(
        payload,
        "registration_url",
        _first_text(
            parsed.get("registration_url"),
            existing_event.registration_url if existing_event else None,
        ),
    )
    price_amount = _payload_value(
        payload,
        "price_amount",
        existing_event.price_amount if existing_event is not None else None,
    )
    price_currency = _validate_event_state(
        starts_at=starts_at,
        ends_at=ends_at,
        status=status,
        visibility=visibility,
        registration_mode=registration_mode,
        registration_url=registration_url,
        price_amount=price_amount,
        price_currency=_payload_value(
            payload,
            "price_currency",
            existing_event.price_currency if existing_event is not None else "RUB",
        ),
    )

    if not title:
        raise _validation_error("title is required to publish an import item")

    source_url = _validated_event_source_url(
        item.source_url or _payload_value(payload, "source_url", None),
    )
    return {
        "community_id": source.community_id,
        "event_kind": _payload_value(
            payload,
            "event_kind",
            existing_event.event_kind if existing_event is not None else "single",
            allow_none=False,
        ),
        "title": title,
        "subtitle": _payload_value(
            payload,
            "subtitle",
            existing_event.subtitle if existing_event is not None else None,
        ),
        "description": _payload_value(
            payload,
            "description",
            _first_text(
                parsed.get("description"),
                detail.get("description"),
                existing_event.description if existing_event else None,
            ),
        ),
        "short_description": _payload_value(
            payload,
            "short_description",
            existing_event.short_description if existing_event is not None else None,
        ),
        "starts_at": starts_at,
        "ends_at": ends_at,
        "is_permanent": _payload_value(
            payload,
            "is_permanent",
            existing_event.is_permanent if existing_event is not None else False,
            allow_none=False,
        ),
        "timezone": _payload_value(
            payload,
            "timezone",
            existing_event.timezone if existing_event is not None else TIMEZONE,
            allow_none=False,
        ),
        "location_name": _payload_value(
            payload,
            "location_name",
            _first_text(
                parsed.get("location_name"),
                existing_event.location_name if existing_event else None,
            ),
        ),
        "address": _payload_value(
            payload,
            "address",
            _first_text(parsed.get("address"), existing_event.address if existing_event else None),
        ),
        "latitude": _payload_value(
            payload,
            "latitude",
            existing_event.latitude if existing_event is not None else None,
        ),
        "longitude": _payload_value(
            payload,
            "longitude",
            existing_event.longitude if existing_event is not None else None,
        ),
        "image_url": _payload_value(
            payload,
            "image_url",
            _first_text(
                parsed.get("image_url"),
                detail.get("image_url"),
                existing_event.image_url if existing_event else None,
            ),
        ),
        "category": category,
        "audience": _payload_value(
            payload,
            "audience",
            _first_text(parsed.get("audience"), existing_event.audience if existing_event else "all"),
        ),
        "visibility": visibility,
        "status": status,
        "source_type": WEBSITE_SOURCE_TYPE,
        "source_url": source_url,
        "source_external_id": item.external_id,
        "manual_override": True,
        "registration_mode": registration_mode,
        "registration_url": registration_url,
        "capacity": _payload_value(
            payload,
            "capacity",
            existing_event.capacity if existing_event is not None else None,
        ),
        "waitlist_enabled": _payload_value(
            payload,
            "waitlist_enabled",
            existing_event.waitlist_enabled if existing_event is not None else False,
            allow_none=False,
        ),
        "requires_approval": _payload_value(
            payload,
            "requires_approval",
            existing_event.requires_approval if existing_event is not None else False,
            allow_none=False,
        ),
        "price_amount": price_amount,
        "price_currency": price_currency,
    }


def _set_event_values(
    event: Event,
    values: dict[str, Any],
    *,
    current_user: AppUser,
    created: bool,
) -> None:
    for field_name, value in values.items():
        setattr(event, field_name, value)
    now = _now()
    if created:
        event.created_by = current_user.id
    event.updated_by = current_user.id
    event.updated_at = now
    event.manual_override = True
    if event.status == "published" and event.published_at is None:
        event.published_at = now


def _update_item_after_publish(
    item: EventImportItem,
    *,
    event: Event,
    created: bool,
) -> None:
    raw_payload = deepcopy(dict(item.raw_payload or {}))
    review = _json_object(raw_payload.get("importReview"))
    base_dedupe = review.get("dedupe") if isinstance(review.get("dedupe"), dict) else None
    review["dedupe"] = dedupe.finalize_dedupe(
        base_dedupe,
        dedupe.publish_outcome(event_id=event.id, created=created),
    )
    raw_payload["importReview"] = review
    raw_payload["linked_event_id"] = str(event.id)
    raw_payload["event_action"] = "created" if created else "updated"
    raw_payload["import_status"] = "linked"
    raw_payload["import_status_reason"] = "Explicit publish action linked this event."

    item.linked_event_id = event.id
    item.status = "linked"
    item.raw_payload = raw_payload
    item.error = None
    item.updated_at = _now()


async def publish_admin_import_item(
    session: AsyncSession,
    current_user: AppUser,
    item_id: UUID,
    payload: AdminImportItemPublishRequest,
) -> AdminImportPublishResponse:
    async with _transaction_scope(session):
        item, source = await _get_scoped_import_item_with_source(
            session,
            current_user,
            item_id,
            lock=True,
        )
        event = await _resolve_publish_event(
            session,
            item=item,
            source=source,
            payload=payload,
        )
        created = event is None
        values = await _build_event_values(
            session,
            item=item,
            source=source,
            payload=payload,
            existing_event=event,
        )
        if event is None:
            event = Event()
            session.add(event)

        _set_event_values(
            event,
            values,
            current_user=current_user,
            created=created,
        )
        await session.flush()
        await session.refresh(event)

        _update_item_after_publish(item, event=event, created=created)
        await session.flush()
        await session.refresh(item)

        return AdminImportPublishResponse(
            event=AdminEventResponse.model_validate(event),
            import_item=_item_response(item, source),
            linked_event_id=event.id,
            created=created,
        )
