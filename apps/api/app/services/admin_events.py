from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventCapacityUnit,
    EventCategory,
    EventOccurrence,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationCapacityReservation,
)
from app.schemas.admin_events import (
    AdminEventCapacityUnitResponse,
    AdminEventCapacityUnitsReplaceRequest,
    AdminEventCategoryCreateRequest,
    AdminEventCategoryUpdateRequest,
    AdminEventCreateRequest,
    AdminEventOccurrenceResponse,
    AdminEventOccurrencesReplaceRequest,
    AdminEventParticipationOptionUpsertRequest,
    AdminEventParticipationOptionResponse,
    AdminEventParticipationOptionsReplaceRequest,
    AdminOptionCapacityUnitMappingResponse,
    AdminEventUpdateRequest,
)
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
_CATEGORY_PATCH_REQUIRED_FIELDS = frozenset(
    {"slug", "title", "color", "icon", "sort_order", "is_active"},
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


def _conflict(message: str) -> HTTPException:
    return _error(http_status.HTTP_409_CONFLICT, "conflict", message)


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


def _reject_null_fields(updates: dict[str, object], field_names: set[str]) -> None:
    for field_name in field_names:
        if field_name in updates and updates[field_name] is None:
            raise _validation_error(f"{field_name} must not be null")


async def list_admin_event_categories(
    session: AsyncSession,
    current_user: AppUser,
) -> list[EventCategory]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    result = await session.scalars(
        select(EventCategory)
        .where(EventCategory.community_id.in_(manageable_community_ids))
        .order_by(
            EventCategory.community_id,
            EventCategory.sort_order,
            EventCategory.created_at,
            EventCategory.id,
        ),
    )
    return list(result)


async def _category_slug_exists(
    session: AsyncSession,
    *,
    community_id: UUID,
    slug: str,
    excluding_category_id: UUID | None = None,
) -> bool:
    query = select(EventCategory.id).where(
        EventCategory.community_id == community_id,
        EventCategory.slug == slug,
    )
    if excluding_category_id is not None:
        query = query.where(EventCategory.id != excluding_category_id)

    category_id = await session.scalar(query.limit(1))
    return category_id is not None


async def create_admin_event_category(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminEventCategoryCreateRequest,
) -> EventCategory:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    community_id = _resolve_create_community_id(payload, manageable_community_ids)

    async with _transaction_scope(session):
        if await _category_slug_exists(
            session,
            community_id=community_id,
            slug=payload.slug,
        ):
            raise _conflict("category slug already exists in this community")

        now = _now()
        category = EventCategory(
            community_id=community_id,
            slug=payload.slug,
            title=payload.title,
            description=payload.description,
            color=payload.color,
            icon=payload.icon,
            sort_order=payload.sort_order,
            is_active=payload.is_active,
            created_by=current_user.id,
            updated_by=current_user.id,
            updated_at=now,
        )
        session.add(category)
        await session.flush()
        await session.refresh(category)
        return category


async def update_admin_event_category(
    session: AsyncSession,
    current_user: AppUser,
    category_id: UUID,
    payload: AdminEventCategoryUpdateRequest,
) -> EventCategory:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    updates = payload.model_dump(exclude_unset=True)
    _reject_null_fields(updates, _CATEGORY_PATCH_REQUIRED_FIELDS)

    async with _transaction_scope(session):
        category = await session.scalar(
            select(EventCategory)
            .where(
                EventCategory.id == category_id,
                EventCategory.community_id.in_(manageable_community_ids),
            )
            .with_for_update(),
        )
        if category is None:
            raise _not_found("Category not found")

        if "slug" in updates and updates["slug"] != category.slug:
            if await _category_slug_exists(
                session,
                community_id=category.community_id,
                slug=updates["slug"],
                excluding_category_id=category.id,
            ):
                raise _conflict("category slug already exists in this community")

        now = _now()
        for field_name, value in updates.items():
            setattr(category, field_name, value)

        if updates:
            category.updated_by = current_user.id
            category.updated_at = now

        await session.flush()
        await session.refresh(category)
        return category


def _occurrence_registration_state(
    occurrence: EventOccurrence,
    server_now: datetime,
) -> tuple[bool, str, str | None]:
    if occurrence.status != "active":
        return False, "unavailable", "status_not_active"

    if (
        occurrence.registration_opens_at is None
        and occurrence.registration_closes_at is None
    ):
        return True, "open", None

    if (
        occurrence.registration_opens_at is not None
        and server_now < occurrence.registration_opens_at
    ):
        return False, "not_yet_open", "registration_opens_at_future"

    if (
        occurrence.registration_closes_at is not None
        and server_now > occurrence.registration_closes_at
    ):
        return False, "closed", "registration_closes_at_past"

    return False, "open", None


def _to_occurrence_response(
    occurrence: EventOccurrence,
    server_now: datetime,
) -> AdminEventOccurrenceResponse:
    is_always_open, registration_state, reason = _occurrence_registration_state(
        occurrence,
        server_now,
    )
    return AdminEventOccurrenceResponse.model_validate(occurrence).model_copy(
        update={
            "server_now": server_now,
            "is_registration_always_open": is_always_open,
            "registration_state": registration_state,
            "registration_state_reason": reason,
        },
    )


async def _list_admin_event_occurrences_for_event(
    session: AsyncSession,
    event_id: UUID,
) -> list[AdminEventOccurrenceResponse]:
    server_now = _now()
    occurrences = list(
        await session.scalars(
            select(EventOccurrence)
            .where(EventOccurrence.event_id == event_id)
            .order_by(
                EventOccurrence.starts_at,
                EventOccurrence.sort_order,
                EventOccurrence.id,
            ),
        ),
    )
    return [
        _to_occurrence_response(occurrence, server_now)
        for occurrence in occurrences
    ]


async def list_admin_event_occurrences(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> list[AdminEventOccurrenceResponse]:
    await get_admin_event(session, current_user, event_id)
    return await _list_admin_event_occurrences_for_event(session, event_id)


def _validate_unique_payload_ids(
    ids: Sequence[UUID],
    *,
    message: str,
) -> None:
    if len(set(ids)) != len(ids):
        raise _validation_error(message)


async def replace_admin_event_occurrences(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: AdminEventOccurrencesReplaceRequest,
) -> list[AdminEventOccurrenceResponse]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    payload_ids = [
        occurrence.id for occurrence in payload.occurrences if occurrence.id is not None
    ]
    _validate_unique_payload_ids(
        payload_ids,
        message="duplicate occurrence id in payload",
    )

    async with _transaction_scope(session):
        event = await _lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )

        existing_occurrences = list(
            await session.scalars(
                select(EventOccurrence)
                .where(EventOccurrence.event_id == event.id)
                .with_for_update(),
            ),
        )
        existing_by_id = {
            occurrence.id: occurrence for occurrence in existing_occurrences
        }

        now = _now()
        seen_ids: set[UUID] = set()
        for index, occurrence_payload in enumerate(payload.occurrences):
            sort_order = (
                occurrence_payload.sort_order
                if occurrence_payload.sort_order is not None
                else index
            )
            if occurrence_payload.id is None:
                occurrence = EventOccurrence(
                    event_id=event.id,
                    title=occurrence_payload.title,
                    starts_at=occurrence_payload.starts_at,
                    ends_at=occurrence_payload.ends_at,
                    timezone=occurrence_payload.timezone,
                    registration_opens_at=occurrence_payload.registration_opens_at,
                    registration_closes_at=occurrence_payload.registration_closes_at,
                    capacity=occurrence_payload.capacity,
                    waitlist_enabled=occurrence_payload.waitlist_enabled,
                    requires_approval=occurrence_payload.requires_approval,
                    status=occurrence_payload.status,
                    sort_order=sort_order,
                )
                session.add(occurrence)
                await session.flush()
                seen_ids.add(occurrence.id)
                continue

            occurrence = existing_by_id.get(occurrence_payload.id)
            if occurrence is None:
                raise _validation_error("occurrence id does not belong to event")

            occurrence.title = occurrence_payload.title
            occurrence.starts_at = occurrence_payload.starts_at
            occurrence.ends_at = occurrence_payload.ends_at
            occurrence.timezone = occurrence_payload.timezone
            occurrence.registration_opens_at = (
                occurrence_payload.registration_opens_at
            )
            occurrence.registration_closes_at = (
                occurrence_payload.registration_closes_at
            )
            occurrence.capacity = occurrence_payload.capacity
            occurrence.waitlist_enabled = occurrence_payload.waitlist_enabled
            occurrence.requires_approval = occurrence_payload.requires_approval
            occurrence.status = occurrence_payload.status
            occurrence.sort_order = sort_order
            occurrence.updated_at = now
            seen_ids.add(occurrence.id)

        delete_ids = set(existing_by_id) - seen_ids
        if delete_ids:
            registration_count = await session.scalar(
                select(func.count(EventRegistration.id)).where(
                    EventRegistration.occurrence_id.in_(list(delete_ids)),
                ),
            )
            if registration_count:
                raise _conflict("cannot delete occurrence with registrations")

            await session.execute(
                delete(EventOccurrence).where(EventOccurrence.id.in_(list(delete_ids))),
            )

        await session.flush()
        return await _list_admin_event_occurrences_for_event(session, event.id)


async def _list_option_capacity_mappings(
    session: AsyncSession,
    event_id: UUID,
) -> dict[UUID, list[EventParticipationOptionCapacityUnit]]:
    mappings = list(
        await session.scalars(
            select(EventParticipationOptionCapacityUnit)
            .where(EventParticipationOptionCapacityUnit.event_id == event_id)
            .order_by(
                EventParticipationOptionCapacityUnit.created_at,
                EventParticipationOptionCapacityUnit.id,
            ),
        ),
    )
    mappings_by_option: dict[UUID, list[EventParticipationOptionCapacityUnit]] = {}
    for mapping in mappings:
        mappings_by_option.setdefault(mapping.option_id, []).append(mapping)
    return mappings_by_option


async def _list_admin_event_participation_options_for_event(
    session: AsyncSession,
    event_id: UUID,
) -> list[AdminEventParticipationOptionResponse]:
    options = list(
        await session.scalars(
            select(EventParticipationOption)
            .where(EventParticipationOption.event_id == event_id)
            .order_by(
                EventParticipationOption.sort_order,
                EventParticipationOption.created_at,
                EventParticipationOption.id,
            ),
        ),
    )
    mappings_by_option = await _list_option_capacity_mappings(session, event_id)
    responses: list[AdminEventParticipationOptionResponse] = []
    for option in options:
        responses.append(
            AdminEventParticipationOptionResponse.model_validate(option).model_copy(
                update={
                    "capacity_units": [
                        AdminOptionCapacityUnitMappingResponse.model_validate(mapping)
                        for mapping in mappings_by_option.get(option.id, [])
                    ],
                },
            ),
        )
    return responses


async def list_admin_event_participation_options(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> list[AdminEventParticipationOptionResponse]:
    await get_admin_event(session, current_user, event_id)
    return await _list_admin_event_participation_options_for_event(session, event_id)


async def replace_admin_event_participation_options(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: AdminEventParticipationOptionsReplaceRequest,
) -> list[AdminEventParticipationOptionResponse]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    payload_ids = [
        option.id
        for option in payload.participation_options
        if option.id is not None
    ]
    _validate_unique_payload_ids(
        payload_ids,
        message="duplicate participation option id in payload",
    )

    async with _transaction_scope(session):
        event = await _lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )
        existing_options = list(
            await session.scalars(
                select(EventParticipationOption)
                .where(EventParticipationOption.event_id == event.id)
                .with_for_update(),
            ),
        )
        existing_by_id = {option.id: option for option in existing_options}
        capacity_unit_ids = set(
            await session.scalars(
                select(EventCapacityUnit.id).where(
                    EventCapacityUnit.event_id == event.id,
                ),
            ),
        )

        list(
            await session.scalars(
                select(EventParticipationOptionCapacityUnit.id)
                .where(EventParticipationOptionCapacityUnit.event_id == event.id)
                .with_for_update(),
            ),
        )
        await session.execute(
            delete(EventParticipationOptionCapacityUnit).where(
                EventParticipationOptionCapacityUnit.event_id == event.id,
            ),
        )

        now = _now()
        seen_ids: set[UUID] = set()
        option_payload_pairs: list[
            tuple[
                EventParticipationOption,
                AdminEventParticipationOptionUpsertRequest,
            ]
        ] = []

        for index, option_payload in enumerate(payload.participation_options):
            sort_order = (
                option_payload.sort_order
                if option_payload.sort_order is not None
                else index
            )
            if option_payload.id is None:
                option = EventParticipationOption(event_id=event.id)
                session.add(option)
            else:
                option = existing_by_id.get(option_payload.id)
                if option is None:
                    raise _validation_error(
                        "participation option id does not belong to event",
                    )

            option.title = option_payload.title
            option.description = option_payload.description
            option.price_amount = option_payload.price_amount
            option.price_currency = option_payload.price_currency
            option.option_type = option_payload.option_type
            option.seat_limit = option_payload.seat_limit
            option.allow_quantity = option_payload.allow_quantity
            option.min_quantity = option_payload.min_quantity
            option.max_quantity = option_payload.max_quantity
            option.is_donation = option_payload.is_donation
            option.counts_toward_capacity = option_payload.counts_toward_capacity
            option.group_key = option_payload.group_key
            option.conflicts_with = option_payload.conflicts_with
            option.sort_order = sort_order
            option.is_active = option_payload.is_active
            if option_payload.id is not None:
                option.updated_at = now

            await session.flush()
            seen_ids.add(option.id)
            option_payload_pairs.append((option, option_payload))

        delete_ids = set(existing_by_id) - seen_ids
        if delete_ids:
            await session.execute(
                delete(EventParticipationOption).where(
                    EventParticipationOption.id.in_(list(delete_ids)),
                ),
            )

        for option, option_payload in option_payload_pairs:
            seen_mapping_unit_ids: set[UUID] = set()
            for mapping_payload in option_payload.capacity_units:
                if mapping_payload.capacity_unit_id in seen_mapping_unit_ids:
                    raise _validation_error(
                        "duplicate capacity unit mapping in participation option",
                    )
                if mapping_payload.capacity_unit_id not in capacity_unit_ids:
                    raise _validation_error("capacity unit does not belong to event")
                session.add(
                    EventParticipationOptionCapacityUnit(
                        event_id=event.id,
                        option_id=option.id,
                        capacity_unit_id=mapping_payload.capacity_unit_id,
                        seats_per_quantity=mapping_payload.seats_per_quantity,
                    ),
                )
                seen_mapping_unit_ids.add(mapping_payload.capacity_unit_id)

        await session.flush()
        return await _list_admin_event_participation_options_for_event(
            session,
            event.id,
        )


async def list_admin_event_capacity_units(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> list[EventCapacityUnit]:
    await get_admin_event(session, current_user, event_id)
    result = await session.scalars(
        select(EventCapacityUnit)
        .where(EventCapacityUnit.event_id == event_id)
        .order_by(
            EventCapacityUnit.sort_order,
            EventCapacityUnit.created_at,
            EventCapacityUnit.id,
        ),
    )
    return list(result)


async def replace_admin_event_capacity_units(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: AdminEventCapacityUnitsReplaceRequest,
) -> list[EventCapacityUnit]:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    payload_ids = [unit.id for unit in payload.capacity_units if unit.id is not None]
    _validate_unique_payload_ids(
        payload_ids,
        message="duplicate capacity unit id in payload",
    )
    payload_keys = [unit.key for unit in payload.capacity_units]
    if len(set(payload_keys)) != len(payload_keys):
        raise _validation_error("duplicate capacity unit key in payload")

    async with _transaction_scope(session):
        event = await _lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )
        existing_units = list(
            await session.scalars(
                select(EventCapacityUnit)
                .where(EventCapacityUnit.event_id == event.id)
                .with_for_update(),
            ),
        )
        existing_by_id = {unit.id: unit for unit in existing_units}

        now = _now()
        seen_ids: set[UUID] = set()
        for index, unit_payload in enumerate(payload.capacity_units):
            sort_order = (
                unit_payload.sort_order
                if unit_payload.sort_order is not None
                else index
            )
            if unit_payload.id is None:
                unit = EventCapacityUnit(event_id=event.id)
                session.add(unit)
            else:
                unit = existing_by_id.get(unit_payload.id)
                if unit is None:
                    raise _validation_error("capacity unit id does not belong to event")

            unit.key = unit_payload.key
            unit.title = unit_payload.title
            unit.description = unit_payload.description
            unit.capacity = unit_payload.capacity
            unit.sort_order = sort_order
            unit.is_active = unit_payload.is_active
            if unit_payload.id is not None:
                unit.updated_at = now

            await session.flush()
            seen_ids.add(unit.id)

        delete_ids = set(existing_by_id) - seen_ids
        if delete_ids:
            reservation_count = await session.scalar(
                select(func.count(EventRegistrationCapacityReservation.id)).where(
                    EventRegistrationCapacityReservation.capacity_unit_id.in_(
                        list(delete_ids),
                    ),
                ),
            )
            if reservation_count:
                raise _conflict("cannot delete capacity unit with reservations")

            await session.execute(
                delete(EventCapacityUnit).where(
                    EventCapacityUnit.id.in_(list(delete_ids)),
                ),
            )

        await session.flush()
        return await list_admin_event_capacity_units(session, current_user, event.id)
