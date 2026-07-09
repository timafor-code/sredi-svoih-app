from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    Event,
    EventCapacityUnit,
    EventOccurrence,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
    Profile,
)
from app.schemas.admin_registrations import (
    AdminEventRegistrationResponse,
    AdminRegistrationCapacityAnalyticsResponse,
    AdminRegistrationCapacityBucketAggregateResponse,
    AdminRegistrationCapacityBucketOptionBreakdownResponse,
    AdminRegistrationCapacityBucketResponse,
    AdminRegistrationCapacityOptionStatResponse,
    AdminRegistrationCapacityStatusCountsResponse,
    AdminRegistrationCapacityTotalsResponse,
    AdminRegistrationSelectedOptionResponse,
)
from app.services.admin_events import resolve_manageable_community_ids

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200

REGISTRATION_STATUSES = frozenset(
    {
        "pending",
        "confirmed",
        "waitlisted",
        "cancelled",
        "rejected",
        "attended",
        "no_show",
    },
)
CAPACITY_REGISTRATION_STATUSES = frozenset(
    {"confirmed", "pending", "attended", "no_show"},
)
STATUS_ACTIONS = frozenset({"confirmed", "rejected", "waitlisted"})
ATTENDANCE_ACTIONS = frozenset({"attended", "no_show"})


@dataclass(frozen=True)
class _CombinedCapacityReservation:
    registration_id: UUID
    capacity_unit_id: UUID
    option_id: UUID | None
    option_title: str
    quantity: int
    seats_count: int


@dataclass
class _OptionStatAccumulator:
    option_id: UUID | None
    title: str
    option_type: str
    is_donation: bool
    counts_toward_capacity: bool
    registration_ids: set[UUID]
    quantity: int = 0
    seats_count: int = 0


@dataclass
class _BucketOptionAccumulator:
    option_id: UUID | None
    title: str
    registration_ids: set[UUID]
    quantity: int = 0
    seats_count: int = 0


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


def _forbidden(message: str = "Admin registration permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Registration not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


def _require_manageable_communities(community_ids: Sequence[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _first_text(*values: object | None) -> str | None:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _json_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def _percent(used: int, capacity: int | None) -> int | None:
    if capacity is None or capacity <= 0:
        return None

    ratio = (Decimal(used) / Decimal(capacity)) * Decimal(100)
    return min(100, int(ratio.quantize(Decimal("1"), rounding=ROUND_HALF_UP)))


def _remaining(capacity: int | None, occupied: int) -> int | None:
    if capacity is None:
        return None
    return max(0, capacity - occupied)


def _normalize_status_filter(status: str | None) -> str | None:
    normalized = _first_text(status)
    if normalized is None:
        return None

    normalized = normalized.lower()
    if normalized == "all":
        return None
    if normalized not in REGISTRATION_STATUSES:
        raise _validation_error("Invalid registration status")
    return normalized


async def _resolve_manageable_event(
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
        raise _not_found("Event not found")

    return event


async def _validate_occurrence(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
) -> EventOccurrence | None:
    if occurrence_id is None:
        return None

    occurrence = await session.scalar(
        select(EventOccurrence).where(
            EventOccurrence.id == occurrence_id,
            EventOccurrence.event_id == event_id,
        ),
    )
    if occurrence is None:
        raise _not_found("Occurrence not found")

    return occurrence


def _selected_option_response(
    selection: EventRegistrationOptionSelection,
) -> AdminRegistrationSelectedOptionResponse:
    return AdminRegistrationSelectedOptionResponse(
        id=selection.id,
        option_id=selection.option_id,
        title=selection.title_snapshot,
        description=selection.description_snapshot,
        option_type=selection.option_type_snapshot,
        quantity=selection.quantity,
        unit_price_amount=selection.unit_price_amount,
        total_amount=selection.total_amount,
        currency=selection.currency,
        counts_toward_capacity=selection.counts_toward_capacity,
        seats_count=selection.seats_count,
        is_donation=selection.is_donation,
        created_at=selection.created_at,
    )


def _registration_response(
    registration: EventRegistration,
    profile: Profile | None,
    user: AppUser | None,
    occurrence: EventOccurrence | None,
    selected_options: Sequence[EventRegistrationOptionSelection],
) -> AdminEventRegistrationResponse:
    display_name = _first_text(
        profile.display_name if profile is not None else None,
        profile.full_name if profile is not None else None,
        " ".join(
            value
            for value in [
                profile.first_name if profile is not None else None,
                profile.last_name if profile is not None else None,
            ]
            if value
        ),
        profile.email if profile is not None else None,
        user.email if user is not None else None,
        registration.user_id,
    )
    total_amount = (
        sum(selection.total_amount for selection in selected_options)
        if selected_options
        else None
    )

    return AdminEventRegistrationResponse(
        id=registration.id,
        event_id=registration.event_id,
        occurrence_id=registration.occurrence_id,
        user_id=registration.user_id,
        participant_display_name=display_name or str(registration.user_id),
        email=_first_text(
            profile.email if profile is not None else None,
            user.email if user is not None else None,
        ),
        phone=_first_text(
            profile.phone if profile is not None else None,
            user.phone if user is not None else None,
        ),
        status=registration.status,
        seats_count=registration.seats_count,
        guest_names=_json_list(registration.guest_names),
        comment=registration.comment,
        payment_status=registration.payment_status,
        payment_id=registration.payment_id,
        registered_at=registration.registered_at,
        confirmed_at=registration.confirmed_at,
        cancelled_at=registration.cancelled_at,
        occurrence_starts_at=occurrence.starts_at if occurrence is not None else None,
        occurrence_ends_at=occurrence.ends_at if occurrence is not None else None,
        occurrence_title=occurrence.title if occurrence is not None else None,
        selected_options=[
            _selected_option_response(selection) for selection in selected_options
        ],
        total_amount=total_amount,
        created_at=registration.created_at,
        updated_at=registration.updated_at,
    )


async def _registration_rows_to_responses(
    session: AsyncSession,
    rows: Sequence[tuple[EventRegistration, Profile | None, AppUser | None, EventOccurrence | None]],
) -> list[AdminEventRegistrationResponse]:
    if not rows:
        return []

    registration_ids = [registration.id for registration, _, _, _ in rows]
    selections = list(
        await session.scalars(
            select(EventRegistrationOptionSelection)
            .where(EventRegistrationOptionSelection.registration_id.in_(registration_ids))
            .order_by(
                EventRegistrationOptionSelection.created_at,
                EventRegistrationOptionSelection.id,
            ),
        ),
    )

    selections_by_registration: dict[
        UUID,
        list[EventRegistrationOptionSelection],
    ] = defaultdict(list)
    for selection in selections:
        selections_by_registration[selection.registration_id].append(selection)

    return [
        _registration_response(
            registration,
            profile,
            user,
            occurrence,
            selections_by_registration[registration.id],
        )
        for registration, profile, user, occurrence in rows
    ]


def _registration_row_query():
    return (
        select(EventRegistration, Profile, AppUser, EventOccurrence)
        .join(AppUser, AppUser.id == EventRegistration.user_id)
        .outerjoin(Profile, Profile.user_id == EventRegistration.user_id)
        .outerjoin(EventOccurrence, EventOccurrence.id == EventRegistration.occurrence_id)
    )


async def _fetch_admin_registration_response(
    session: AsyncSession,
    registration_id: UUID,
) -> AdminEventRegistrationResponse:
    row = (
        await session.execute(
            _registration_row_query().where(EventRegistration.id == registration_id),
        )
    ).one_or_none()
    if row is None:
        raise _not_found()

    return (
        await _registration_rows_to_responses(
            session,
            [(row[0], row[1], row[2], row[3])],
        )
    )[0]


async def list_admin_event_registrations(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    *,
    occurrence_id: UUID | None,
    status: str | None,
    search: str | None,
    limit: int,
    offset: int,
) -> list[AdminEventRegistrationResponse]:
    event = await _resolve_manageable_event(session, current_user, event_id)
    await _validate_occurrence(
        session,
        event_id=event.id,
        occurrence_id=occurrence_id,
    )
    status_filter = _normalize_status_filter(status)

    query = _registration_row_query().where(EventRegistration.event_id == event.id)
    if occurrence_id is not None:
        query = query.where(EventRegistration.occurrence_id == occurrence_id)
    if status_filter is not None:
        query = query.where(EventRegistration.status == status_filter)

    normalized_search = _first_text(search)
    if normalized_search is not None:
        pattern = f"%{normalized_search}%"
        query = query.where(
            or_(
                func.coalesce(Profile.display_name, "").ilike(pattern),
                func.coalesce(Profile.full_name, "").ilike(pattern),
                func.concat_ws(" ", Profile.first_name, Profile.last_name).ilike(pattern),
                func.coalesce(Profile.email, "").ilike(pattern),
                func.coalesce(Profile.phone, "").ilike(pattern),
                func.coalesce(AppUser.email, "").ilike(pattern),
                func.coalesce(AppUser.phone, "").ilike(pattern),
                func.coalesce(EventRegistration.comment, "").ilike(pattern),
                cast(EventRegistration.guest_names, Text).ilike(pattern),
            ),
        )

    rows = (
        (
            await session.execute(
                query.order_by(
                    EventRegistration.registered_at.desc(),
                    EventRegistration.created_at.desc(),
                    EventRegistration.id.desc(),
                )
                .limit(limit)
                .offset(offset),
            )
        )
        .tuples()
        .all()
    )
    return await _registration_rows_to_responses(session, rows)


async def _lock_manageable_registration(
    session: AsyncSession,
    current_user: AppUser,
    registration_id: UUID,
) -> EventRegistration:
    manageable_community_ids = await resolve_manageable_community_ids(
        session,
        current_user,
    )
    _require_manageable_communities(manageable_community_ids)

    registration = await session.scalar(
        select(EventRegistration)
        .join(Event, Event.id == EventRegistration.event_id)
        .where(
            EventRegistration.id == registration_id,
            Event.community_id.in_(manageable_community_ids),
        )
        .with_for_update(),
    )
    if registration is None:
        raise _not_found()

    return registration


async def transition_admin_registration_status(
    session: AsyncSession,
    current_user: AppUser,
    registration_id: UUID,
    next_status: str,
) -> AdminEventRegistrationResponse:
    if next_status not in STATUS_ACTIONS:
        raise _validation_error("Invalid registration status")

    async with _transaction_scope(session):
        registration = await _lock_manageable_registration(
            session,
            current_user,
            registration_id,
        )

        now = _now()
        previous_status = registration.status
        registration.status = next_status
        if next_status == "confirmed" and registration.confirmed_at is None:
            registration.confirmed_at = now
        if previous_status == "confirmed" and next_status in {"pending", "waitlisted"}:
            registration.confirmed_at = None
        if next_status in {"cancelled", "rejected"} and registration.cancelled_at is None:
            registration.cancelled_at = now
        if next_status in {"pending", "confirmed", "waitlisted"}:
            registration.cancelled_at = None
        registration.updated_at = now
        await session.flush()

        return await _fetch_admin_registration_response(session, registration.id)


async def mark_admin_registration_attendance(
    session: AsyncSession,
    current_user: AppUser,
    registration_id: UUID,
    attendance_status: str,
) -> AdminEventRegistrationResponse:
    if attendance_status not in ATTENDANCE_ACTIONS:
        raise _validation_error("Invalid attendance status")

    async with _transaction_scope(session):
        registration = await _lock_manageable_registration(
            session,
            current_user,
            registration_id,
        )

        now = _now()
        registration.status = attendance_status
        registration.cancelled_at = None
        registration.updated_at = now
        await session.flush()

        return await _fetch_admin_registration_response(session, registration.id)


def _scope_capacity(registration_event: Event, occurrence: EventOccurrence | None) -> int | None:
    if occurrence is not None and occurrence.capacity is not None:
        return occurrence.capacity
    return registration_event.capacity


async def _list_scoped_registrations(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
) -> list[EventRegistration]:
    query = select(EventRegistration).where(EventRegistration.event_id == event_id)
    if occurrence_id is None:
        query = query.where(EventRegistration.occurrence_id.is_(None))
    else:
        query = query.where(EventRegistration.occurrence_id == occurrence_id)

    return list(await session.scalars(query))


async def _list_registration_options(
    session: AsyncSession,
    registration_ids: Sequence[UUID],
) -> list[EventRegistrationOptionSelection]:
    if not registration_ids:
        return []

    return list(
        await session.scalars(
            select(EventRegistrationOptionSelection)
            .where(EventRegistrationOptionSelection.registration_id.in_(registration_ids))
            .order_by(
                EventRegistrationOptionSelection.created_at,
                EventRegistrationOptionSelection.id,
            ),
        ),
    )


async def _list_capacity_reservations(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
    registration_ids: Sequence[UUID],
) -> list[EventRegistrationCapacityReservation]:
    if not registration_ids:
        return []

    query = select(EventRegistrationCapacityReservation).where(
        EventRegistrationCapacityReservation.event_id == event_id,
        EventRegistrationCapacityReservation.registration_id.in_(registration_ids),
    )
    if occurrence_id is None:
        query = query.where(EventRegistrationCapacityReservation.occurrence_id.is_(None))
    else:
        query = query.where(
            EventRegistrationCapacityReservation.occurrence_id == occurrence_id,
        )

    return list(
        await session.scalars(
            query.order_by(
                EventRegistrationCapacityReservation.created_at,
                EventRegistrationCapacityReservation.id,
            ),
        ),
    )


async def _list_capacity_units(
    session: AsyncSession,
    event_id: UUID,
) -> list[EventCapacityUnit]:
    return list(
        await session.scalars(
            select(EventCapacityUnit)
            .where(EventCapacityUnit.event_id == event_id)
            .order_by(
                EventCapacityUnit.sort_order,
                EventCapacityUnit.created_at,
                EventCapacityUnit.id,
            ),
        ),
    )


async def _list_option_capacity_mappings(
    session: AsyncSession,
    event_id: UUID,
) -> dict[UUID, list[EventParticipationOptionCapacityUnit]]:
    mappings = list(
        await session.scalars(
            select(EventParticipationOptionCapacityUnit)
            .where(EventParticipationOptionCapacityUnit.event_id == event_id)
            .order_by(
                EventParticipationOptionCapacityUnit.option_id,
                EventParticipationOptionCapacityUnit.created_at,
                EventParticipationOptionCapacityUnit.id,
            ),
        ),
    )
    by_option: dict[UUID, list[EventParticipationOptionCapacityUnit]] = defaultdict(list)
    for mapping in mappings:
        by_option[mapping.option_id].append(mapping)
    return by_option


def _build_combined_reservations(
    real_reservations: Sequence[EventRegistrationCapacityReservation],
    selected_options: Sequence[EventRegistrationOptionSelection],
    mappings_by_option: dict[UUID, list[EventParticipationOptionCapacityUnit]],
) -> list[_CombinedCapacityReservation]:
    combined: list[_CombinedCapacityReservation] = []
    real_keys: set[tuple[UUID, UUID | None, UUID]] = set()

    for reservation in real_reservations:
        real_keys.add(
            (
                reservation.registration_id,
                reservation.option_id,
                reservation.capacity_unit_id,
            ),
        )
        combined.append(
            _CombinedCapacityReservation(
                registration_id=reservation.registration_id,
                capacity_unit_id=reservation.capacity_unit_id,
                option_id=reservation.option_id,
                option_title=_first_text(reservation.option_title_snapshot, "Option")
                or "Option",
                quantity=reservation.quantity,
                seats_count=reservation.seats_count,
            ),
        )

    fallback_options: dict[tuple[UUID, UUID], tuple[str, int]] = {}
    for selection in selected_options:
        if (
            selection.option_id is None
            or selection.is_donation
            or not selection.counts_toward_capacity
        ):
            continue

        key = (selection.registration_id, selection.option_id)
        current_title, current_quantity = fallback_options.get(
            key,
            (selection.title_snapshot, 0),
        )
        fallback_options[key] = (
            current_title or selection.title_snapshot,
            current_quantity + selection.quantity,
        )

    for (registration_id, option_id), (option_title, quantity) in fallback_options.items():
        if quantity <= 0:
            continue

        for mapping in mappings_by_option.get(option_id, []):
            if (registration_id, option_id, mapping.capacity_unit_id) in real_keys:
                continue

            combined.append(
                _CombinedCapacityReservation(
                    registration_id=registration_id,
                    capacity_unit_id=mapping.capacity_unit_id,
                    option_id=option_id,
                    option_title=_first_text(option_title, "Option") or "Option",
                    quantity=quantity,
                    seats_count=quantity * mapping.seats_per_quantity,
                ),
            )

    return combined


def _build_option_stats(
    selected_options: Sequence[EventRegistrationOptionSelection],
) -> tuple[
    list[AdminRegistrationCapacityOptionStatResponse],
    list[AdminRegistrationCapacityOptionStatResponse],
]:
    accumulators: dict[
        tuple[UUID | None, str, str, bool, bool],
        _OptionStatAccumulator,
    ] = {}
    for selection in selected_options:
        title = _first_text(selection.title_snapshot, "Option") or "Option"
        key = (
            selection.option_id,
            title,
            selection.option_type_snapshot,
            selection.is_donation,
            selection.counts_toward_capacity,
        )
        accumulator = accumulators.setdefault(
            key,
            _OptionStatAccumulator(
                option_id=selection.option_id,
                title=title,
                option_type=selection.option_type_snapshot,
                is_donation=selection.is_donation,
                counts_toward_capacity=selection.counts_toward_capacity,
                registration_ids=set(),
            ),
        )
        accumulator.registration_ids.add(selection.registration_id)
        accumulator.quantity += selection.quantity
        accumulator.seats_count += selection.seats_count

    option_stats = [
        AdminRegistrationCapacityOptionStatResponse(
            option_id=accumulator.option_id,
            title=accumulator.title,
            option_type=accumulator.option_type,
            registrations_count=len(accumulator.registration_ids),
            quantity=accumulator.quantity,
            seats_count=accumulator.seats_count,
            is_donation=accumulator.is_donation,
            counts_toward_capacity=accumulator.counts_toward_capacity,
        )
        for accumulator in accumulators.values()
    ]
    option_stats.sort(key=lambda item: (item.is_donation, item.title.lower()))

    donation_options = [
        item
        for item in option_stats
        if item.is_donation or not item.counts_toward_capacity
    ]
    donation_options.sort(key=lambda item: (not item.is_donation, item.title.lower()))
    return option_stats, donation_options


def _build_capacity_buckets(
    *,
    capacity_units: Sequence[EventCapacityUnit],
    combined_reservations: Sequence[_CombinedCapacityReservation],
    scope_capacity: int | None,
) -> tuple[
    list[AdminRegistrationCapacityBucketResponse],
    AdminRegistrationCapacityBucketAggregateResponse,
]:
    reservations_by_unit: dict[UUID, list[_CombinedCapacityReservation]] = defaultdict(list)
    for reservation in combined_reservations:
        reservations_by_unit[reservation.capacity_unit_id].append(reservation)

    buckets: list[AdminRegistrationCapacityBucketResponse] = []
    for capacity_unit in capacity_units:
        unit_reservations = reservations_by_unit.get(capacity_unit.id, [])
        occupied_seats = sum(reservation.seats_count for reservation in unit_reservations)
        breakdown_by_option: dict[
            tuple[UUID | None, str],
            _BucketOptionAccumulator,
        ] = {}
        for reservation in unit_reservations:
            key = (reservation.option_id, reservation.option_title)
            accumulator = breakdown_by_option.setdefault(
                key,
                _BucketOptionAccumulator(
                    option_id=reservation.option_id,
                    title=reservation.option_title,
                    registration_ids=set(),
                ),
            )
            accumulator.registration_ids.add(reservation.registration_id)
            accumulator.quantity += reservation.quantity
            accumulator.seats_count += reservation.seats_count

        option_breakdown = [
            AdminRegistrationCapacityBucketOptionBreakdownResponse(
                option_id=accumulator.option_id,
                title=accumulator.title,
                registrations_count=len(accumulator.registration_ids),
                quantity=accumulator.quantity,
                seats_count=accumulator.seats_count,
                is_donation=False,
                counts_toward_capacity=True,
            )
            for accumulator in breakdown_by_option.values()
        ]
        option_breakdown.sort(key=lambda item: item.title.lower())
        option_titles = [item.title for item in option_breakdown]

        effective_capacity = capacity_unit.capacity
        if effective_capacity is None:
            effective_capacity = scope_capacity
        effective_fill_percent = _percent(occupied_seats, effective_capacity)

        buckets.append(
            AdminRegistrationCapacityBucketResponse(
                capacity_unit_id=capacity_unit.id,
                key=capacity_unit.key,
                code=capacity_unit.key,
                title=capacity_unit.title,
                capacity=capacity_unit.capacity,
                effective_capacity=effective_capacity,
                occupied_seats=occupied_seats,
                remaining_seats=_remaining(capacity_unit.capacity, occupied_seats),
                free_seats=_remaining(effective_capacity, occupied_seats),
                effective_remaining_seats=_remaining(
                    effective_capacity,
                    occupied_seats,
                ),
                fill_percent=_percent(occupied_seats, capacity_unit.capacity),
                effective_fill_percent=effective_fill_percent,
                effective_free_percent=(
                    None if effective_fill_percent is None else max(0, 100 - effective_fill_percent)
                ),
                reservations_count=len(unit_reservations),
                option_titles=option_titles,
                option_breakdown=option_breakdown,
                is_unlimited=capacity_unit.capacity is None,
                uses_fallback_capacity=(
                    capacity_unit.capacity is None and effective_capacity is not None
                ),
            ),
        )

    known_capacity = sum(
        bucket.effective_capacity or 0
        for bucket in buckets
        if bucket.effective_capacity is not None
    )
    limited_occupied = sum(
        bucket.occupied_seats
        for bucket in buckets
        if bucket.effective_capacity is not None
    )
    remaining_seats = sum(
        bucket.effective_remaining_seats or 0
        for bucket in buckets
        if bucket.effective_capacity is not None
    )
    aggregate_fill_percent = _percent(limited_occupied, known_capacity)
    aggregate = AdminRegistrationCapacityBucketAggregateResponse(
        occupied_seats=sum(bucket.occupied_seats for bucket in buckets),
        known_capacity=known_capacity,
        remaining_seats=remaining_seats,
        fill_percent=aggregate_fill_percent,
        free_percent=(
            None if aggregate_fill_percent is None else max(0, 100 - aggregate_fill_percent)
        ),
        limited_bucket_count=sum(
            1 for bucket in buckets if bucket.effective_capacity is not None
        ),
        has_unlimited_buckets=any(bucket.effective_capacity is None for bucket in buckets),
    )
    return buckets, aggregate


def _build_status_counts(
    registrations: Sequence[EventRegistration],
) -> AdminRegistrationCapacityStatusCountsResponse:
    counts = {status: 0 for status in REGISTRATION_STATUSES}
    for registration in registrations:
        if registration.status in counts:
            counts[registration.status] += 1

    return AdminRegistrationCapacityStatusCountsResponse(
        confirmed=counts["confirmed"],
        pending=counts["pending"],
        waitlisted=counts["waitlisted"],
        cancelled=counts["cancelled"],
        rejected=counts["rejected"],
        attended=counts["attended"],
        no_show=counts["no_show"],
    )


def _build_totals(
    *,
    registrations: Sequence[EventRegistration],
    active_registrations: Sequence[EventRegistration],
    selected_options: Sequence[EventRegistrationOptionSelection],
    combined_reservations: Sequence[_CombinedCapacityReservation],
    scope_capacity: int | None,
) -> AdminRegistrationCapacityTotalsResponse:
    status_counts = _build_status_counts(registrations)
    active_seats_count = sum(registration.seats_count for registration in active_registrations)
    active_user_ids = {registration.user_id for registration in active_registrations}
    active_guest_keys = {
        guest_name.strip().lower()
        for registration in active_registrations
        for guest_name in _json_list(registration.guest_names)
        if isinstance(guest_name, str) and guest_name.strip()
    }
    donation_selections = [
        selection for selection in selected_options if selection.is_donation
    ]
    donation_registration_ids = {
        selection.registration_id for selection in donation_selections
    }
    capacity_units_by_registration: dict[UUID, set[UUID]] = defaultdict(set)
    for reservation in combined_reservations:
        capacity_units_by_registration[reservation.registration_id].add(
            reservation.capacity_unit_id,
        )
    multi_meal_guests_count = sum(
        1 for capacity_unit_ids in capacity_units_by_registration.values()
        if len(capacity_unit_ids) > 1
    )
    fill_percent = _percent(active_seats_count, scope_capacity)

    return AdminRegistrationCapacityTotalsResponse(
        total_registrations=len(registrations),
        total_registrations_count=len(registrations),
        status_counts=status_counts,
        confirmed_count=status_counts.confirmed,
        pending_count=status_counts.pending,
        waitlisted_count=status_counts.waitlisted,
        cancelled_count=status_counts.cancelled,
        rejected_count=status_counts.rejected,
        attended_count=status_counts.attended,
        no_show_count=status_counts.no_show,
        active_registrations_count=len(active_registrations),
        active_seats_count=active_seats_count,
        unique_registered_users_count=len(active_user_ids),
        unique_guests_count=len(active_guest_keys),
        unique_people_count=len(active_user_ids) + len(active_guest_keys),
        multi_meal_guests_count=multi_meal_guests_count,
        sponsors_donations_count=len(donation_selections),
        donations_count=len(donation_selections),
        donation_quantity=sum(selection.quantity for selection in donation_selections),
        donation_registrations_count=len(donation_registration_ids),
        capacity=scope_capacity,
        remaining_seats=_remaining(scope_capacity, active_seats_count),
        free_seats=_remaining(scope_capacity, active_seats_count),
        fill_percent=fill_percent,
        free_percent=None if fill_percent is None else max(0, 100 - fill_percent),
    )


async def get_admin_registration_capacity(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    *,
    occurrence_id: UUID | None,
) -> AdminRegistrationCapacityAnalyticsResponse:
    event = await _resolve_manageable_event(session, current_user, event_id)
    occurrence = await _validate_occurrence(
        session,
        event_id=event.id,
        occurrence_id=occurrence_id,
    )
    scoped_registrations = await _list_scoped_registrations(
        session,
        event_id=event.id,
        occurrence_id=occurrence_id,
    )
    active_registrations = [
        registration
        for registration in scoped_registrations
        if registration.status in CAPACITY_REGISTRATION_STATUSES
    ]
    active_registration_ids = [registration.id for registration in active_registrations]
    selected_options = await _list_registration_options(
        session,
        active_registration_ids,
    )
    real_reservations = await _list_capacity_reservations(
        session,
        event_id=event.id,
        occurrence_id=occurrence_id,
        registration_ids=active_registration_ids,
    )
    capacity_units = await _list_capacity_units(session, event.id)
    mappings_by_option = await _list_option_capacity_mappings(session, event.id)
    combined_reservations = _build_combined_reservations(
        real_reservations,
        selected_options,
        mappings_by_option,
    )
    scope_capacity = _scope_capacity(event, occurrence)
    buckets, bucket_aggregate = _build_capacity_buckets(
        capacity_units=capacity_units,
        combined_reservations=combined_reservations,
        scope_capacity=scope_capacity,
    )
    option_stats, donation_options = _build_option_stats(selected_options)

    return AdminRegistrationCapacityAnalyticsResponse(
        event_id=event.id,
        occurrence_id=occurrence_id,
        totals=_build_totals(
            registrations=scoped_registrations,
            active_registrations=active_registrations,
            selected_options=selected_options,
            combined_reservations=combined_reservations,
            scope_capacity=scope_capacity,
        ),
        bucket_aggregate=bucket_aggregate,
        buckets=buckets,
        option_stats=option_stats,
        donation_options=donation_options,
    )
