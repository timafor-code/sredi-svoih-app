from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, CommunityMembership, Event, EventCategory
from app.schemas.admin_events import AdminEventCreateRequest, AdminEventUpdateRequest
from app.services.authorization import ACTIVE_STATUS, EVENT_MANAGER_ROLES
from app.services.events import decode_events_cursor, encode_events_cursor

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100

MANUAL_SOURCE_TYPE = "manual"

_PATCH_REQUIRED_FIELDS = frozenset(
    {
        "event_kind",
        "title",
        "starts_at",
        "is_permanent",
        "timezone",
        "category",
        "visibility",
        "status",
        "registration_mode",
        "waitlist_enabled",
        "requires_approval",
    },
)


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


def _forbidden(message: str = "Admin event permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Event not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


async def resolve_manageable_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    result = await session.scalars(
        select(CommunityMembership.community_id)
        .where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role.in_(EVENT_MANAGER_ROLES),
        )
        .order_by(CommunityMembership.community_id),
    )
    return list(result)


def _require_manageable_communities(community_ids: Sequence[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _validate_manageable_community(
    community_id: UUID,
    manageable_community_ids: Sequence[UUID],
) -> UUID:
    if community_id not in set(manageable_community_ids):
        raise _forbidden()
    return community_id


def _resolve_create_community_id(
    payload: AdminEventCreateRequest,
    manageable_community_ids: Sequence[UUID],
) -> UUID:
    _require_manageable_communities(manageable_community_ids)

    if payload.community_id is not None:
        return _validate_manageable_community(
            payload.community_id,
            manageable_community_ids,
        )

    if len(manageable_community_ids) == 1:
        return manageable_community_ids[0]

    raise _validation_error("community_id is required")


async def _validate_event_category(
    session: AsyncSession,
    *,
    community_id: UUID,
    category: str,
) -> None:
    category_id = await session.scalar(
        select(EventCategory.id).where(
            EventCategory.community_id == community_id,
            EventCategory.slug == category,
        ),
    )
    if category_id is None:
        raise _validation_error("category does not exist in this community")


def _validate_event_state(
    *,
    starts_at: datetime,
    ends_at: datetime | None,
    registration_mode: str,
    registration_url: str | None,
    price_amount: int | None,
    price_currency: str | None,
) -> str | None:
    if starts_at.tzinfo is None or starts_at.utcoffset() is None:
        raise _validation_error("starts_at must be an ISO 8601 datetime with timezone")
    if ends_at is not None:
        if ends_at.tzinfo is None or ends_at.utcoffset() is None:
            raise _validation_error(
                "ends_at must be an ISO 8601 datetime with timezone",
            )
        if ends_at <= starts_at:
            raise _validation_error("ends_at must be greater than starts_at")

    if registration_mode == "external_link" and registration_url is None:
        raise _validation_error("registration_url is required for external_link")

    if price_amount is not None and price_currency is None:
        return "RUB"
    return price_currency


async def list_admin_events(
    session: AsyncSession,
    current_user: AppUser,
    *,
    limit: int,
    cursor: str | None,
) -> tuple[list[Event], str | None, bool]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    query = select(Event).where(Event.community_id.in_(manageable_community_ids))

    if cursor is not None:
        cursor_starts_at, cursor_event_id = decode_events_cursor(cursor)
        query = query.where(
            tuple_(Event.starts_at, Event.id) > (cursor_starts_at, cursor_event_id),
        )

    query = query.order_by(Event.starts_at, Event.id).limit(limit + 1)
    events = list(await session.scalars(query))

    has_more = len(events) > limit
    events = events[:limit]

    next_cursor: str | None = None
    if has_more and events:
        last_event = events[-1]
        next_cursor = encode_events_cursor(last_event.starts_at, last_event.id)

    return events, next_cursor, has_more


async def get_admin_event(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> Event:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    event = await session.scalar(
        select(Event).where(
            Event.id == event_id,
            Event.community_id.in_(manageable_community_ids),
        ),
    )
    if event is None:
        raise _not_found()

    return event


async def _lock_admin_event(
    session: AsyncSession,
    *,
    event_id: UUID,
    manageable_community_ids: Sequence[UUID],
) -> Event:
    event = await session.scalar(
        select(Event)
        .where(
            Event.id == event_id,
            Event.community_id.in_(manageable_community_ids),
        )
        .with_for_update(),
    )
    if event is None:
        raise _not_found()

    return event


async def create_admin_event(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminEventCreateRequest,
) -> Event:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    community_id = _resolve_create_community_id(payload, manageable_community_ids)

    price_currency = _validate_event_state(
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        registration_mode=payload.registration_mode,
        registration_url=payload.registration_url,
        price_amount=payload.price_amount,
        price_currency=payload.price_currency,
    )

    async with _transaction_scope(session):
        await _validate_event_category(
            session,
            community_id=community_id,
            category=payload.category,
        )

        now = _now()
        event = Event(
            community_id=community_id,
            event_kind=payload.event_kind,
            title=payload.title,
            subtitle=payload.subtitle,
            description=payload.description,
            short_description=payload.short_description,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            is_permanent=payload.is_permanent,
            timezone=payload.timezone,
            location_name=payload.location_name,
            address=payload.address,
            latitude=payload.latitude,
            longitude=payload.longitude,
            image_url=payload.image_url,
            category=payload.category,
            audience=payload.audience,
            visibility=payload.visibility,
            status=payload.status,
            source_type=MANUAL_SOURCE_TYPE,
            source_url=payload.source_url,
            source_external_id=None,
            manual_override=True,
            registration_mode=payload.registration_mode,
            registration_url=payload.registration_url,
            capacity=payload.capacity,
            waitlist_enabled=payload.waitlist_enabled,
            requires_approval=payload.requires_approval,
            price_amount=payload.price_amount,
            price_currency=price_currency,
            created_by=current_user.id,
            updated_by=current_user.id,
            published_at=now if payload.status == "published" else None,
        )
        session.add(event)
        await session.flush()
        await session.refresh(event)
        return event


def _reject_null_patch_values(
    payload: AdminEventUpdateRequest,
    updates: dict[str, object],
) -> None:
    for field_name in _PATCH_REQUIRED_FIELDS:
        if field_name in payload.model_fields_set and updates.get(field_name) is None:
            raise _validation_error(f"{field_name} must not be null")


def _combined_event_values(
    event: Event,
    updates: dict[str, object],
) -> dict[str, object]:
    return {
        "starts_at": updates.get("starts_at", event.starts_at),
        "ends_at": updates.get("ends_at", event.ends_at),
        "registration_mode": updates.get("registration_mode", event.registration_mode),
        "registration_url": updates.get("registration_url", event.registration_url),
        "price_amount": updates.get("price_amount", event.price_amount),
        "price_currency": updates.get("price_currency", event.price_currency),
    }


async def update_admin_event(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: AdminEventUpdateRequest,
) -> Event:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    updates = payload.model_dump(exclude_unset=True)
    _reject_null_patch_values(payload, updates)

    async with _transaction_scope(session):
        event = await _lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )

        combined = _combined_event_values(event, updates)
        price_currency = _validate_event_state(
            starts_at=combined["starts_at"],
            ends_at=combined["ends_at"],
            registration_mode=combined["registration_mode"],
            registration_url=combined["registration_url"],
            price_amount=combined["price_amount"],
            price_currency=combined["price_currency"],
        )
        if (
            "price_amount" in updates
            or "price_currency" in updates
            or price_currency != combined["price_currency"]
        ):
            updates["price_currency"] = price_currency

        if "category" in updates:
            await _validate_event_category(
                session,
                community_id=event.community_id,
                category=updates["category"],
            )

        now = _now()
        for field_name, value in updates.items():
            setattr(event, field_name, value)

        if updates.get("status") == "published" and event.published_at is None:
            event.published_at = now

        if updates:
            event.manual_override = True
            event.updated_by = current_user.id
            event.updated_at = now

        await session.flush()
        await session.refresh(event)
        return event


async def transition_admin_event_status(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    next_status: str,
) -> Event:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    async with _transaction_scope(session):
        event = await _lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )

        now = _now()
        event.status = next_status
        if next_status == "published" and event.published_at is None:
            event.published_at = now
        event.manual_override = True
        event.updated_by = current_user.id
        event.updated_at = now

        await session.flush()
        await session.refresh(event)
        return event
