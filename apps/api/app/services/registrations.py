from __future__ import annotations

from collections import defaultdict
from collections.abc import AsyncIterator, Iterable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    Event,
    EventCapacityUnit,
    EventOccurrence,
    EventParticipationOption,
    EventParticipationOptionCapacityUnit,
    EventRegistration,
    EventRegistrationCapacityReservation,
    EventRegistrationOptionSelection,
)
from app.schemas.events import EventOccurrenceResponse, EventResponse
from app.schemas.registrations import (
    EventRegistrationResponse,
    RegisterEventRequest,
    RegistrationCapacityReservationResponse,
    RegistrationSelectedOptionResponse,
)
from app.services import events as events_service
from app.services.events import (
    MEMBERS_ONLY_VISIBILITY,
    OCCURRENCE_VISIBLE_STATUS,
    PUBLISHED_STATUS,
    PUBLIC_VISIBILITY,
)

ACTIVE_REGISTRATION_STATUSES = ("pending", "confirmed", "waitlisted")
CAPACITY_REGISTRATION_STATUSES = ("confirmed", "pending", "attended", "no_show")
LEGACY_CAPACITY_STATUSES = ("confirmed", "pending", "waitlisted")
CANCELLABLE_REGISTRATION_STATUSES = ("pending", "confirmed", "waitlisted")
INTERNAL_REGISTRATION_MODES = ("internal_free", "internal_paid")
PAID_REGISTRATION_MODE = "internal_paid"
FREE_REGISTRATION_MODE = "internal_free"


@dataclass(frozen=True)
class _PreparedSelection:
    option: EventParticipationOption
    quantity: int
    seats_count: int


@dataclass(frozen=True)
class _CapacityReservationDraft:
    capacity_unit: EventCapacityUnit
    option: EventParticipationOption
    quantity: int
    seats_per_quantity: int
    seats_count: int


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


def _not_found(message: str = "Registration not found") -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


def _state_conflict(message: str) -> HTTPException:
    return _error(status.HTTP_409_CONFLICT, "state_conflict", message)


def _capacity_unavailable(message: str) -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "capacity_unavailable",
        message,
    )


def _visible_event_filter(member_community_ids: Sequence[UUID]):
    public_clause = and_(
        Event.status == PUBLISHED_STATUS,
        Event.visibility == PUBLIC_VISIBILITY,
    )
    if not member_community_ids:
        return public_clause

    return or_(
        public_clause,
        and_(
            Event.status == PUBLISHED_STATUS,
            Event.visibility == MEMBERS_ONLY_VISIBILITY,
            Event.community_id.in_(member_community_ids),
        ),
    )


def _occurrence_match(column, occurrence_id: UUID | None):
    if occurrence_id is None:
        return column.is_(None)
    return column == occurrence_id


async def _lock_visible_event(
    session: AsyncSession,
    event_id: UUID,
    member_community_ids: Sequence[UUID],
) -> Event:
    event = await session.scalar(
        select(Event)
        .where(
            Event.id == event_id,
            _visible_event_filter(member_community_ids),
        )
        .with_for_update(),
    )
    if event is None:
        raise _not_found("Event not found")

    return event


async def _event_has_occurrences(session: AsyncSession, event_id: UUID) -> bool:
    occurrence_id = await session.scalar(
        select(EventOccurrence.id)
        .where(EventOccurrence.event_id == event_id)
        .limit(1),
    )
    return occurrence_id is not None


def _requires_occurrence(
    event: Event,
    payload: RegisterEventRequest,
    *,
    has_occurrences: bool,
) -> bool:
    if not has_occurrences or payload.occurrence_id is not None:
        return False
    if payload.option_selections or event.registration_mode == PAID_REGISTRATION_MODE:
        return True
    return event.event_kind != "single"


async def _lock_occurrence(
    session: AsyncSession,
    event: Event,
    occurrence_id: UUID | None,
) -> EventOccurrence | None:
    if occurrence_id is None:
        return None

    occurrence = await session.scalar(
        select(EventOccurrence)
        .where(
            EventOccurrence.id == occurrence_id,
            EventOccurrence.event_id == event.id,
        )
        .with_for_update(),
    )
    if occurrence is None or occurrence.status != OCCURRENCE_VISIBLE_STATUS:
        raise _not_found("Occurrence not found")

    now = _now()
    if (
        occurrence.registration_opens_at is not None
        and now < occurrence.registration_opens_at
    ):
        raise _state_conflict("Registration is not open yet")
    if (
        occurrence.registration_closes_at is not None
        and now > occurrence.registration_closes_at
    ):
        raise _state_conflict("Registration is closed")

    return occurrence


async def _lock_existing_active_registration(
    session: AsyncSession,
    *,
    event_id: UUID,
    user_id: UUID,
    occurrence_id: UUID | None,
) -> EventRegistration | None:
    conditions = [
        EventRegistration.event_id == event_id,
        EventRegistration.user_id == user_id,
        EventRegistration.status.in_(ACTIVE_REGISTRATION_STATUSES),
    ]
    if occurrence_id is not None:
        conditions.append(EventRegistration.occurrence_id == occurrence_id)

    return await session.scalar(
        select(EventRegistration)
        .where(*conditions)
        .order_by(
            EventRegistration.registered_at.desc(),
            EventRegistration.created_at.desc(),
            EventRegistration.id.desc(),
        )
        .limit(1)
        .with_for_update(),
    )


async def _load_option_capacity_mappings(
    session: AsyncSession,
    event_id: UUID,
    option_ids: Iterable[UUID],
) -> dict[UUID, list[tuple[EventCapacityUnit, int]]]:
    option_id_list = list(option_ids)
    if not option_id_list:
        return {}

    rows = await session.execute(
        select(EventParticipationOptionCapacityUnit, EventCapacityUnit)
        .join(
            EventCapacityUnit,
            and_(
                EventCapacityUnit.id
                == EventParticipationOptionCapacityUnit.capacity_unit_id,
                EventCapacityUnit.event_id
                == EventParticipationOptionCapacityUnit.event_id,
            ),
        )
        .where(
            EventParticipationOptionCapacityUnit.event_id == event_id,
            EventParticipationOptionCapacityUnit.option_id.in_(option_id_list),
        )
        .order_by(
            EventParticipationOptionCapacityUnit.option_id,
            EventCapacityUnit.id,
        )
        .with_for_update(),
    )

    mappings: dict[UUID, list[tuple[EventCapacityUnit, int]]] = defaultdict(list)
    for mapping, capacity_unit in rows.all():
        mappings[mapping.option_id].append(
            (capacity_unit, mapping.seats_per_quantity),
        )
    return mappings


async def _prepare_options(
    session: AsyncSession,
    event: Event,
    payload: RegisterEventRequest,
) -> tuple[list[_PreparedSelection], list[_CapacityReservationDraft], int, int]:
    requested = payload.option_selections
    if event.registration_mode == PAID_REGISTRATION_MODE and not requested:
        raise _validation_error("Select at least one participation option")
    if not requested:
        return [], [], payload.seats_count, payload.seats_count

    option_ids = [selection.option_id for selection in requested]
    if len(set(option_ids)) != len(option_ids):
        raise _validation_error("Duplicate participation option selection")

    option_rows = list(
        await session.scalars(
            select(EventParticipationOption)
            .where(EventParticipationOption.id.in_(option_ids))
            .order_by(EventParticipationOption.id)
            .with_for_update(),
        ),
    )
    options_by_id = {option.id: option for option in option_rows}

    prepared: list[_PreparedSelection] = []
    capacity_option_ids: list[UUID] = []
    registration_seats_count = 0
    has_non_donation_selection = False

    for selection in requested:
        option = options_by_id.get(selection.option_id)
        if option is None or option.event_id != event.id:
            raise _validation_error("Participation option not found")
        if not option.is_active:
            raise _validation_error("Participation option is inactive")
        if not option.allow_quantity and selection.quantity != 1:
            raise _validation_error(
                "Quantity is not allowed for this participation option",
            )
        if (
            selection.quantity < option.min_quantity
            or selection.quantity > option.max_quantity
        ):
            raise _validation_error(
                "Quantity is outside the allowed range for this option",
            )
        if (
            event.registration_mode == FREE_REGISTRATION_MODE
            and not option.is_donation
            and option.price_amount > 0
        ):
            raise _validation_error(
                "Paid participation options require paid registration",
            )

        seats_count = (
            selection.quantity
            if option.counts_toward_capacity and not option.is_donation
            else 0
        )
        if option.seat_limit is not None and seats_count > option.seat_limit:
            raise _capacity_unavailable("Participation option seat limit exceeded")
        if not option.is_donation:
            has_non_donation_selection = True
        if seats_count > 0:
            capacity_option_ids.append(option.id)

        registration_seats_count += seats_count
        prepared.append(
            _PreparedSelection(
                option=option,
                quantity=selection.quantity,
                seats_count=seats_count,
            ),
        )

    if event.registration_mode == PAID_REGISTRATION_MODE:
        if not has_non_donation_selection:
            raise _validation_error(
                "Select at least one non-donation participation option",
            )
        if registration_seats_count <= 0:
            raise _validation_error("Select at least one option that reserves a seat")
    elif registration_seats_count <= 0:
        registration_seats_count = payload.seats_count

    mappings = await _load_option_capacity_mappings(
        session,
        event.id,
        capacity_option_ids,
    )
    reservation_drafts: list[_CapacityReservationDraft] = []
    legacy_seats_count = 0
    for selection in prepared:
        if selection.seats_count <= 0:
            continue

        option_mappings = mappings.get(selection.option.id, [])
        if not option_mappings:
            legacy_seats_count += selection.seats_count
            continue

        for capacity_unit, seats_per_quantity in option_mappings:
            reservation_drafts.append(
                _CapacityReservationDraft(
                    capacity_unit=capacity_unit,
                    option=selection.option,
                    quantity=selection.quantity,
                    seats_per_quantity=seats_per_quantity,
                    seats_count=selection.quantity * seats_per_quantity,
                ),
            )

    if not reservation_drafts and legacy_seats_count == 0:
        legacy_seats_count = payload.seats_count

    return (
        prepared,
        reservation_drafts,
        registration_seats_count,
        legacy_seats_count,
    )


def _effective_capacity(
    event: Event,
    occurrence: EventOccurrence | None,
    capacity_unit: EventCapacityUnit | None = None,
) -> int | None:
    if capacity_unit is not None and capacity_unit.capacity is not None:
        return capacity_unit.capacity
    if occurrence is not None and occurrence.capacity is not None:
        return occurrence.capacity
    return event.capacity


async def _taken_capacity_unit_seats(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
    capacity_unit_id: UUID,
) -> int:
    taken = await session.scalar(
        select(
            func.coalesce(
                func.sum(EventRegistrationCapacityReservation.seats_count),
                0,
            ),
        )
        .join(
            EventRegistration,
            EventRegistration.id
            == EventRegistrationCapacityReservation.registration_id,
        )
        .where(
            EventRegistrationCapacityReservation.event_id == event_id,
            EventRegistrationCapacityReservation.capacity_unit_id == capacity_unit_id,
            _occurrence_match(
                EventRegistrationCapacityReservation.occurrence_id,
                occurrence_id,
            ),
            EventRegistration.status.in_(CAPACITY_REGISTRATION_STATUSES),
        ),
    )
    return int(taken or 0)


async def _taken_legacy_seats(
    session: AsyncSession,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
) -> int:
    taken = await session.scalar(
        select(func.coalesce(func.sum(EventRegistration.seats_count), 0)).where(
            EventRegistration.event_id == event_id,
            _occurrence_match(EventRegistration.occurrence_id, occurrence_id),
            EventRegistration.status.in_(LEGACY_CAPACITY_STATUSES),
        ),
    )
    return int(taken or 0)


async def _enforce_capacity(
    session: AsyncSession,
    *,
    event: Event,
    occurrence: EventOccurrence | None,
    reservation_drafts: Sequence[_CapacityReservationDraft],
    legacy_seats_count: int,
) -> None:
    occurrence_id = occurrence.id if occurrence is not None else None
    requested_by_unit: dict[UUID, int] = defaultdict(int)
    unit_by_id: dict[UUID, EventCapacityUnit] = {}
    for draft in reservation_drafts:
        requested_by_unit[draft.capacity_unit.id] += draft.seats_count
        unit_by_id[draft.capacity_unit.id] = draft.capacity_unit

    for capacity_unit_id in sorted(requested_by_unit):
        capacity_unit = unit_by_id[capacity_unit_id]
        capacity = _effective_capacity(event, occurrence, capacity_unit)
        if capacity is None:
            continue

        taken = await _taken_capacity_unit_seats(
            session,
            event_id=event.id,
            occurrence_id=occurrence_id,
            capacity_unit_id=capacity_unit_id,
        )
        if taken + requested_by_unit[capacity_unit_id] > capacity:
            raise _capacity_unavailable("No seats available for this capacity unit")

    if legacy_seats_count <= 0:
        return

    capacity = _effective_capacity(event, occurrence)
    if capacity is None:
        return

    taken = await _taken_legacy_seats(
        session,
        event_id=event.id,
        occurrence_id=occurrence_id,
    )
    if taken + legacy_seats_count > capacity:
        raise _capacity_unavailable("No seats available for this event")


def _registration_status(
    event: Event,
    occurrence: EventOccurrence | None,
) -> tuple[str, str]:
    if event.registration_mode == PAID_REGISTRATION_MODE:
        return "pending", "pending"

    requires_approval = (
        occurrence.requires_approval
        if occurrence is not None and occurrence.requires_approval is not None
        else event.requires_approval
    )
    if requires_approval:
        return "pending", "not_required"
    return "confirmed", "not_required"


async def _create_registration(
    session: AsyncSession,
    *,
    current_user: AppUser,
    event: Event,
    occurrence: EventOccurrence | None,
    payload: RegisterEventRequest,
    prepared_selections: Sequence[_PreparedSelection],
    reservation_drafts: Sequence[_CapacityReservationDraft],
    seats_count: int,
) -> EventRegistration:
    now = _now()
    registration_status, payment_status = _registration_status(event, occurrence)
    registration = EventRegistration(
        event_id=event.id,
        occurrence_id=occurrence.id if occurrence is not None else None,
        user_id=current_user.id,
        status=registration_status,
        seats_count=seats_count,
        guest_names=payload.guest_names,
        comment=payload.comment,
        registered_at=now,
        confirmed_at=now if registration_status == "confirmed" else None,
        cancelled_at=None,
        payment_status=payment_status,
        payment_id=None,
    )
    session.add(registration)
    await session.flush()

    for selection in prepared_selections:
        option = selection.option
        session.add(
            EventRegistrationOptionSelection(
                registration_id=registration.id,
                option_id=option.id,
                title_snapshot=option.title,
                description_snapshot=option.description,
                option_type_snapshot=option.option_type,
                quantity=selection.quantity,
                unit_price_amount=option.price_amount,
                total_amount=option.price_amount * selection.quantity,
                currency=option.price_currency,
                counts_toward_capacity=(
                    False if option.is_donation else option.counts_toward_capacity
                ),
                seats_count=selection.seats_count,
                is_donation=option.is_donation,
            ),
        )

    for draft in reservation_drafts:
        session.add(
            EventRegistrationCapacityReservation(
                registration_id=registration.id,
                event_id=event.id,
                occurrence_id=occurrence.id if occurrence is not None else None,
                capacity_unit_id=draft.capacity_unit.id,
                option_id=draft.option.id,
                capacity_unit_key_snapshot=draft.capacity_unit.key,
                capacity_unit_title_snapshot=draft.capacity_unit.title,
                option_title_snapshot=draft.option.title,
                quantity=draft.quantity,
                seats_per_quantity=draft.seats_per_quantity,
                seats_count=draft.seats_count,
            ),
        )

    await session.flush()
    return registration


def _to_registration_response(
    registration: EventRegistration,
    event: Event,
    occurrence: EventOccurrence | None,
    selected_options: Sequence[EventRegistrationOptionSelection],
    capacity_reservations: Sequence[EventRegistrationCapacityReservation],
) -> EventRegistrationResponse:
    total_amount = (
        sum(option.total_amount for option in selected_options)
        if selected_options
        else None
    )
    total_currency = (
        selected_options[0].currency
        if selected_options
        else (event.price_currency if total_amount is not None else None)
    )

    return EventRegistrationResponse(
        id=registration.id,
        event_id=registration.event_id,
        occurrence_id=registration.occurrence_id,
        user_id=registration.user_id,
        status=registration.status,
        seats_count=registration.seats_count,
        guest_names=registration.guest_names,
        comment=registration.comment,
        registered_at=registration.registered_at,
        confirmed_at=registration.confirmed_at,
        cancelled_at=registration.cancelled_at,
        payment_status=registration.payment_status,
        payment_id=registration.payment_id,
        created_at=registration.created_at,
        updated_at=registration.updated_at,
        event=EventResponse.model_validate(event),
        occurrence=(
            EventOccurrenceResponse.model_validate(occurrence)
            if occurrence is not None
            else None
        ),
        selected_options=[
            RegistrationSelectedOptionResponse.model_validate(option)
            for option in selected_options
        ],
        capacity_reservations=[
            RegistrationCapacityReservationResponse.model_validate(reservation)
            for reservation in capacity_reservations
        ],
        total_amount=total_amount,
        total_currency=total_currency,
    )


async def _fetch_registration_responses(
    session: AsyncSession,
    *,
    user_id: UUID,
    member_community_ids: Sequence[UUID],
    registration_ids: Sequence[UUID] | None = None,
) -> list[EventRegistrationResponse]:
    query = (
        select(EventRegistration, Event, EventOccurrence)
        .join(Event, Event.id == EventRegistration.event_id)
        .outerjoin(EventOccurrence, EventOccurrence.id == EventRegistration.occurrence_id)
        .where(
            EventRegistration.user_id == user_id,
            _visible_event_filter(member_community_ids),
        )
        .order_by(
            EventRegistration.registered_at.desc(),
            EventRegistration.created_at.desc(),
            EventRegistration.id.desc(),
        )
    )
    if registration_ids is not None:
        query = query.where(EventRegistration.id.in_(list(registration_ids)))

    rows = (await session.execute(query)).all()
    if not rows:
        return []

    ordered_registration_ids = [registration.id for registration, _, _ in rows]
    selected_options = list(
        await session.scalars(
            select(EventRegistrationOptionSelection)
            .where(
                EventRegistrationOptionSelection.registration_id.in_(
                    ordered_registration_ids,
                ),
            )
            .order_by(
                EventRegistrationOptionSelection.created_at,
                EventRegistrationOptionSelection.id,
            ),
        ),
    )
    capacity_reservations = list(
        await session.scalars(
            select(EventRegistrationCapacityReservation)
            .where(
                EventRegistrationCapacityReservation.registration_id.in_(
                    ordered_registration_ids,
                ),
            )
            .order_by(
                EventRegistrationCapacityReservation.created_at,
                EventRegistrationCapacityReservation.id,
            ),
        ),
    )

    options_by_registration: dict[
        UUID,
        list[EventRegistrationOptionSelection],
    ] = defaultdict(list)
    for option in selected_options:
        options_by_registration[option.registration_id].append(option)

    reservations_by_registration: dict[
        UUID,
        list[EventRegistrationCapacityReservation],
    ] = defaultdict(list)
    for reservation in capacity_reservations:
        reservations_by_registration[reservation.registration_id].append(reservation)

    return [
        _to_registration_response(
            registration,
            event,
            occurrence,
            options_by_registration[registration.id],
            reservations_by_registration[registration.id],
        )
        for registration, event, occurrence in rows
    ]


async def _fetch_registration_response(
    session: AsyncSession,
    *,
    user_id: UUID,
    member_community_ids: Sequence[UUID],
    registration_id: UUID,
) -> EventRegistrationResponse:
    registrations = await _fetch_registration_responses(
        session,
        user_id=user_id,
        member_community_ids=member_community_ids,
        registration_ids=[registration_id],
    )
    if not registrations:
        raise _not_found()
    return registrations[0]


async def list_current_user_registrations(
    session: AsyncSession,
    current_user: AppUser,
) -> list[EventRegistrationResponse]:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    return await _fetch_registration_responses(
        session,
        user_id=current_user.id,
        member_community_ids=member_community_ids,
    )


async def register_current_user_for_event(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
    payload: RegisterEventRequest,
) -> EventRegistrationResponse:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )

    async with _transaction_scope(session):
        event = await _lock_visible_event(session, event_id, member_community_ids)
        if event.registration_mode not in INTERNAL_REGISTRATION_MODES:
            raise _validation_error(
                "Internal registration is not available for this event",
            )

        has_occurrences = await _event_has_occurrences(session, event.id)
        if _requires_occurrence(event, payload, has_occurrences=has_occurrences):
            raise _validation_error("occurrence_id is required for this event")

        occurrence = await _lock_occurrence(session, event, payload.occurrence_id)
        existing_registration = await _lock_existing_active_registration(
            session,
            event_id=event.id,
            user_id=current_user.id,
            occurrence_id=occurrence.id if occurrence is not None else None,
        )
        if existing_registration is not None:
            return await _fetch_registration_response(
                session,
                user_id=current_user.id,
                member_community_ids=member_community_ids,
                registration_id=existing_registration.id,
            )

        prepared_selections, reservation_drafts, seats_count, legacy_seats_count = (
            await _prepare_options(session, event, payload)
        )
        await _enforce_capacity(
            session,
            event=event,
            occurrence=occurrence,
            reservation_drafts=reservation_drafts,
            legacy_seats_count=legacy_seats_count,
        )

        registration = await _create_registration(
            session,
            current_user=current_user,
            event=event,
            occurrence=occurrence,
            payload=payload,
            prepared_selections=prepared_selections,
            reservation_drafts=reservation_drafts,
            seats_count=seats_count,
        )
        return await _fetch_registration_response(
            session,
            user_id=current_user.id,
            member_community_ids=member_community_ids,
            registration_id=registration.id,
        )


async def cancel_current_user_registration(
    session: AsyncSession,
    current_user: AppUser,
    registration_id: UUID,
) -> EventRegistrationResponse:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )

    async with _transaction_scope(session):
        registration = await session.scalar(
            select(EventRegistration).where(
                EventRegistration.id == registration_id,
                EventRegistration.user_id == current_user.id,
            ),
        )
        if registration is None:
            raise _not_found()

        await _lock_visible_event(session, registration.event_id, member_community_ids)

        registration = await session.scalar(
            select(EventRegistration)
            .where(
                EventRegistration.id == registration_id,
                EventRegistration.user_id == current_user.id,
            )
            .with_for_update(),
        )
        if registration is None:
            raise _not_found()

        if registration.status == "cancelled":
            return await _fetch_registration_response(
                session,
                user_id=current_user.id,
                member_community_ids=member_community_ids,
                registration_id=registration.id,
            )
        if registration.status not in CANCELLABLE_REGISTRATION_STATUSES:
            raise _state_conflict("Registration cannot be cancelled")

        now = _now()
        registration.status = "cancelled"
        registration.cancelled_at = now
        registration.updated_at = now
        await session.flush()

        return await _fetch_registration_response(
            session,
            user_id=current_user.id,
            member_community_ids=member_community_ids,
            registration_id=registration.id,
        )
