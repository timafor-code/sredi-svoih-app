from __future__ import annotations

import base64
import binascii
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
)
from app.services.authorization import ACTIVE_STATUS

PUBLISHED_STATUS = "published"
PUBLIC_VISIBILITY = "public"
MEMBERS_ONLY_VISIBILITY = "members_only"
OCCURRENCE_VISIBLE_STATUS = "active"

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 100


class EventNotFoundError(HTTPException):
    def __init__(self, detail: str = "Event not found") -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class InvalidCursorError(HTTPException):
    def __init__(self, detail: str = "Invalid pagination cursor") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )


def encode_events_cursor(starts_at: datetime, event_id: UUID) -> str:
    raw = f"{starts_at.isoformat()}|{event_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")


def decode_events_cursor(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        starts_at_text, _, event_id_text = raw.partition("|")
        starts_at = datetime.fromisoformat(starts_at_text)
        event_id = UUID(event_id_text)
    except (ValueError, UnicodeError, binascii.Error) as exc:
        raise InvalidCursorError() from exc

    if starts_at.tzinfo is None:
        raise InvalidCursorError()

    return starts_at, event_id


async def resolve_member_community_ids(
    session: AsyncSession,
    current_user: AppUser | None,
) -> list[UUID]:
    if current_user is None:
        return []

    result = await session.scalars(
        select(CommunityMembership.community_id).where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
        ),
    )
    return list(result)


def _visibility_clause(member_community_ids: list[UUID]) -> ColumnElement[bool]:
    public_clause = and_(
        Event.status == PUBLISHED_STATUS,
        Event.visibility == PUBLIC_VISIBILITY,
    )
    if not member_community_ids:
        return public_clause

    members_clause = and_(
        Event.status == PUBLISHED_STATUS,
        Event.visibility == MEMBERS_ONLY_VISIBILITY,
        Event.community_id.in_(member_community_ids),
    )
    return or_(public_clause, members_clause)


async def list_visible_events(
    session: AsyncSession,
    member_community_ids: list[UUID],
    *,
    limit: int,
    cursor: str | None,
    category: str | None,
    starts_after: datetime | None,
    starts_before: datetime | None,
) -> tuple[list[Event], str | None, bool]:
    query = select(Event).where(_visibility_clause(member_community_ids))

    if category is not None:
        query = query.where(Event.category == category)
    if starts_after is not None:
        query = query.where(Event.starts_at >= starts_after)
    if starts_before is not None:
        query = query.where(Event.starts_at <= starts_before)

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


async def get_visible_event(
    session: AsyncSession,
    event_id: UUID,
    member_community_ids: list[UUID],
) -> Event:
    event = await session.scalar(
        select(Event).where(
            Event.id == event_id,
            _visibility_clause(member_community_ids),
        ),
    )
    if event is None:
        raise EventNotFoundError()

    return event


async def list_event_occurrences(
    session: AsyncSession,
    event: Event,
) -> list[EventOccurrence]:
    result = await session.scalars(
        select(EventOccurrence)
        .where(
            EventOccurrence.event_id == event.id,
            EventOccurrence.status == OCCURRENCE_VISIBLE_STATUS,
        )
        .order_by(EventOccurrence.starts_at, EventOccurrence.id),
    )
    return list(result)


async def list_event_participation_options(
    session: AsyncSession,
    event: Event,
) -> list[EventParticipationOption]:
    result = await session.scalars(
        select(EventParticipationOption)
        .where(
            EventParticipationOption.event_id == event.id,
            EventParticipationOption.is_active.is_(True),
        )
        .order_by(
            EventParticipationOption.sort_order,
            EventParticipationOption.created_at,
            EventParticipationOption.id,
        ),
    )
    return list(result)


async def list_event_capacity_units(
    session: AsyncSession,
    event: Event,
) -> list[EventCapacityUnit]:
    result = await session.scalars(
        select(EventCapacityUnit)
        .where(
            EventCapacityUnit.event_id == event.id,
            EventCapacityUnit.is_active.is_(True),
        )
        .order_by(
            EventCapacityUnit.sort_order,
            EventCapacityUnit.created_at,
            EventCapacityUnit.id,
        ),
    )
    return list(result)


async def list_active_event_categories(session: AsyncSession) -> list[EventCategory]:
    result = await session.scalars(
        select(EventCategory)
        .where(EventCategory.is_active.is_(True))
        .order_by(
            EventCategory.sort_order,
            EventCategory.created_at,
            EventCategory.id,
        ),
    )
    return list(result)
