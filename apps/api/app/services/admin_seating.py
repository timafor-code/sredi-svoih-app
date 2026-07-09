from __future__ import annotations

import re
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status as http_status
from pydantic import ValidationError
from sqlalchemy import and_, delete, select
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
)
from app.db.models.seating import (
    EventSeatingAssignment,
    EventSeatingLayout,
    EventSeatingLayoutTemplate,
    EventSeatingTable,
    EventSeatingTableConnection,
)
from app.schemas.admin_seating import (
    AdminSeatingAssignmentEntryPayload,
    AdminSeatingAssignmentsPatchRequest,
    AdminSeatingAssignmentsSaveResponse,
    AdminSeatingConnectionPayload,
    AdminSeatingConnectionResponse,
    AdminSeatingLayoutEnvelopeResponse,
    AdminSeatingLayoutFromTemplateRequest,
    AdminSeatingLayoutPatchRequest,
    AdminSeatingLayoutRowResponse,
    AdminSeatingTablePayload,
    AdminSeatingTableResponse,
    AdminSeatingTemplateFromLayoutRequest,
    AdminSeatingTemplateResponse,
)
from app.services.admin_events import resolve_manageable_community_ids

SUPPORTED_TABLE_ANGLES = frozenset({0, 90, 180, 270})
SUPPORTED_LONG_SIDE_SEATS = frozenset({2, 3})
ACTIVE_ASSIGNMENT_REGISTRATION_STATUSES = frozenset(
    {"confirmed", "pending", "attended"},
)

_STABLE_SIDE_SEAT_RE = re.compile(r"^(.*):side:([ab]):(\d+)$")
_STABLE_END_SEAT_RE = re.compile(r"^(.*):end:([ab])$")
_LEGACY_SEAT_RE = re.compile(r"^(.*):(\d+)$")


@dataclass(frozen=True)
class _ResolvedSlot:
    event: Event
    occurrence: EventOccurrence | None
    capacity_unit: EventCapacityUnit

    @property
    def community_id(self) -> UUID:
        return self.event.community_id


@dataclass(frozen=True)
class _NormalizedAssignment:
    registration_id: UUID | None
    guest_index: int | None
    user_id: UUID | None
    seat_key: str | None
    guest_label: str | None
    guest_initials: str | None
    assignment_type: str


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


def _forbidden(message: str = "Admin seating permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Seating resource not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _validation_error(message: str) -> HTTPException:
    return _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", message)


def _conflict(message: str) -> HTTPException:
    return _error(http_status.HTTP_409_CONFLICT, "conflict", message)


def _require_manageable_communities(community_ids: Sequence[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _occurrence_filter(column, occurrence_id: UUID | None):
    if occurrence_id is None:
        return column.is_(None)
    return column == occurrence_id


def _derive_capacity_snapshot(
    event: Event,
    occurrence: EventOccurrence | None,
    capacity_unit: EventCapacityUnit,
) -> int | None:
    if capacity_unit.capacity is not None:
        return capacity_unit.capacity
    if occurrence is not None and occurrence.capacity is not None:
        return occurrence.capacity
    return event.capacity


async def _manageable_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    community_ids = await resolve_manageable_community_ids(session, current_user)
    _require_manageable_communities(community_ids)
    return community_ids


async def _resolve_slot(
    session: AsyncSession,
    current_user: AppUser,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
    capacity_unit_id: UUID,
) -> _ResolvedSlot:
    manageable_community_ids = await _manageable_community_ids(session, current_user)

    event = await session.scalar(
        select(Event).where(
            Event.id == event_id,
            Event.community_id.in_(manageable_community_ids),
        ),
    )
    if event is None:
        raise _not_found("Event not found")

    occurrence: EventOccurrence | None = None
    if occurrence_id is not None:
        occurrence = await session.scalar(
            select(EventOccurrence).where(
                EventOccurrence.id == occurrence_id,
                EventOccurrence.event_id == event.id,
            ),
        )
        if occurrence is None:
            raise _not_found("Occurrence not found")

    capacity_unit = await session.scalar(
        select(EventCapacityUnit).where(
            EventCapacityUnit.id == capacity_unit_id,
            EventCapacityUnit.event_id == event.id,
        ),
    )
    if capacity_unit is None:
        raise _not_found("Capacity unit not found")

    return _ResolvedSlot(
        event=event,
        occurrence=occurrence,
        capacity_unit=capacity_unit,
    )


async def _get_layout_for_slot(
    session: AsyncSession,
    slot: _ResolvedSlot,
    *,
    for_update: bool = False,
) -> EventSeatingLayout | None:
    query = select(EventSeatingLayout).where(
        EventSeatingLayout.event_id == slot.event.id,
        EventSeatingLayout.capacity_unit_id == slot.capacity_unit.id,
        _occurrence_filter(EventSeatingLayout.occurrence_id, slot.occurrence.id if slot.occurrence else None),
    )
    if for_update:
        query = query.with_for_update()

    return await session.scalar(query)


async def _get_scoped_layout_by_id(
    session: AsyncSession,
    current_user: AppUser,
    layout_id: UUID,
    *,
    for_update: bool = False,
) -> EventSeatingLayout:
    manageable_community_ids = await _manageable_community_ids(session, current_user)
    query = select(EventSeatingLayout).where(
        EventSeatingLayout.id == layout_id,
        EventSeatingLayout.community_id.in_(manageable_community_ids),
    )
    if for_update:
        query = query.with_for_update()

    layout = await session.scalar(query)
    if layout is None:
        raise _not_found("Seating layout not found")
    return layout


async def _get_active_template(
    session: AsyncSession,
    current_user: AppUser,
    template_id: UUID,
    *,
    for_update: bool = False,
) -> EventSeatingLayoutTemplate:
    manageable_community_ids = await _manageable_community_ids(session, current_user)
    query = select(EventSeatingLayoutTemplate).where(
        EventSeatingLayoutTemplate.id == template_id,
        EventSeatingLayoutTemplate.community_id.in_(manageable_community_ids),
        EventSeatingLayoutTemplate.is_active.is_(True),
    )
    if for_update:
        query = query.with_for_update()

    template = await session.scalar(query)
    if template is None:
        raise _not_found("Seating template not found")
    return template


def _validate_tables(tables: Sequence[AdminSeatingTablePayload]) -> None:
    if not tables:
        raise _validation_error("A seating layout needs at least one table")

    seen_ids: set[str] = set()
    rabbi_count = 0
    for table in tables:
        if table.client_table_id in seen_ids:
            raise _validation_error("duplicate table id in payload")
        seen_ids.add(table.client_table_id)

        if table.w <= Decimal("0") or table.h <= Decimal("0"):
            raise _validation_error("table width and height must be positive")
        if table.angle not in SUPPORTED_TABLE_ANGLES:
            raise _validation_error("table angle must be one of 0/90/180/270")
        if table.long_side_seats not in SUPPORTED_LONG_SIDE_SEATS:
            raise _validation_error("table long_side_seats must be 2 or 3")
        if table.sort_order is not None and table.sort_order < 0:
            raise _validation_error("table sort_order must be non-negative")
        if table.is_rabbi_table:
            rabbi_count += 1

    if rabbi_count != 1:
        raise _validation_error(
            f"A seating layout must have exactly one rabbi table (found {rabbi_count})",
        )


def _validate_connections(
    tables: Sequence[AdminSeatingTablePayload],
    connections: Sequence[AdminSeatingConnectionPayload],
) -> None:
    table_ids = {table.client_table_id for table in tables}
    seen_keys: set[tuple[str, str | None, str, str | None]] = set()

    for connection in connections:
        if connection.from_client_table_id not in table_ids:
            raise _validation_error("connection references an unknown from table")
        if connection.to_client_table_id not in table_ids:
            raise _validation_error("connection references an unknown to table")
        if connection.from_client_table_id == connection.to_client_table_id:
            raise _validation_error("connection must reference two distinct tables")

        key = (
            connection.from_client_table_id,
            connection.from_end,
            connection.to_client_table_id,
            connection.to_end,
        )
        if key in seen_keys:
            raise _validation_error("duplicate table connection in payload")
        seen_keys.add(key)


def _validate_geometry(
    tables: Sequence[AdminSeatingTablePayload],
    connections: Sequence[AdminSeatingConnectionPayload],
) -> None:
    _validate_tables(tables)
    _validate_connections(tables, connections)


def _table_payload_from_snapshot(value: object) -> AdminSeatingTablePayload:
    if not isinstance(value, dict):
        raise _validation_error("Template snapshot tables must be objects")
    try:
        return AdminSeatingTablePayload.model_validate(value)
    except ValidationError as exc:
        raise _validation_error("Template snapshot has invalid table geometry") from exc


def _connection_payload_from_snapshot(value: object) -> AdminSeatingConnectionPayload:
    if not isinstance(value, dict):
        raise _validation_error("Template snapshot connections must be objects")
    try:
        return AdminSeatingConnectionPayload.model_validate(value)
    except ValidationError as exc:
        raise _validation_error("Template snapshot has invalid table connections") from exc


def _template_geometry(
    template: EventSeatingLayoutTemplate,
) -> tuple[list[AdminSeatingTablePayload], list[AdminSeatingConnectionPayload]]:
    snapshot = template.snapshot if isinstance(template.snapshot, dict) else {}
    raw_tables = snapshot.get("tables", [])
    raw_connections = snapshot.get("connections", [])

    if not isinstance(raw_tables, list):
        raise _validation_error("Template snapshot tables must be an array")
    if not isinstance(raw_connections, list):
        raise _validation_error("Template snapshot connections must be an array")

    tables = [_table_payload_from_snapshot(item) for item in raw_tables]
    connections = [_connection_payload_from_snapshot(item) for item in raw_connections]
    _validate_geometry(tables, connections)
    return tables, connections


async def _resolve_template_reference(
    session: AsyncSession,
    *,
    community_id: UUID,
    active_template_id: str | None,
) -> UUID | None:
    if active_template_id is None:
        return None

    try:
        template_id = UUID(active_template_id)
    except ValueError:
        return None

    found_id = await session.scalar(
        select(EventSeatingLayoutTemplate.id).where(
            EventSeatingLayoutTemplate.id == template_id,
            EventSeatingLayoutTemplate.community_id == community_id,
            EventSeatingLayoutTemplate.is_active.is_(True),
        ),
    )
    if found_id is None:
        raise _not_found("Seating template not found")
    return found_id


def _layout_row_response(layout: EventSeatingLayout) -> AdminSeatingLayoutRowResponse:
    return AdminSeatingLayoutRowResponse.model_validate(layout)


def _json_number(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


async def _layout_envelope_response(
    session: AsyncSession,
    layout: EventSeatingLayout | None,
) -> AdminSeatingLayoutEnvelopeResponse:
    if layout is None:
        return AdminSeatingLayoutEnvelopeResponse(layout=None)

    tables = list(
        await session.scalars(
            select(EventSeatingTable)
            .where(EventSeatingTable.layout_id == layout.id)
            .order_by(
                EventSeatingTable.sort_order,
                EventSeatingTable.created_at,
                EventSeatingTable.client_table_id,
            ),
        ),
    )
    connections = list(
        await session.scalars(
            select(EventSeatingTableConnection)
            .where(EventSeatingTableConnection.layout_id == layout.id)
            .order_by(
                EventSeatingTableConnection.created_at,
                EventSeatingTableConnection.id,
            ),
        ),
    )
    assignments = list(
        await session.scalars(
            select(EventSeatingAssignment)
            .where(EventSeatingAssignment.layout_id == layout.id)
            .order_by(
                EventSeatingAssignment.created_at,
                EventSeatingAssignment.id,
            ),
        ),
    )

    return AdminSeatingLayoutEnvelopeResponse(
        layout=_layout_row_response(layout),
        tables=[AdminSeatingTableResponse.model_validate(table) for table in tables],
        connections=[
            AdminSeatingConnectionResponse.model_validate(connection)
            for connection in connections
        ],
        assignments=[
            AdminSeatingAssignmentResponse.model_validate(assignment)
            for assignment in assignments
        ],
    )


async def list_admin_seating_templates(
    session: AsyncSession,
    current_user: AppUser,
) -> list[AdminSeatingTemplateResponse]:
    manageable_community_ids = await _manageable_community_ids(session, current_user)
    templates = list(
        await session.scalars(
            select(EventSeatingLayoutTemplate)
            .where(
                EventSeatingLayoutTemplate.community_id.in_(manageable_community_ids),
                EventSeatingLayoutTemplate.is_active.is_(True),
            )
            .order_by(
                EventSeatingLayoutTemplate.community_id,
                EventSeatingLayoutTemplate.is_builtin.desc(),
                EventSeatingLayoutTemplate.title,
                EventSeatingLayoutTemplate.created_at,
            ),
        ),
    )
    return [
        AdminSeatingTemplateResponse.model_validate(template)
        for template in templates
    ]


async def get_admin_seating_template(
    session: AsyncSession,
    current_user: AppUser,
    template_id: UUID,
) -> AdminSeatingTemplateResponse:
    template = await _get_active_template(session, current_user, template_id)
    return AdminSeatingTemplateResponse.model_validate(template)


def _snapshot_from_geometry_rows(
    tables: Sequence[EventSeatingTable],
    connections: Sequence[EventSeatingTableConnection],
) -> dict[str, object]:
    return {
        "version": 1,
        "canvas": {"width": 980, "height": 640},
        "tables": [
            {
                "id": table.client_table_id,
                "cx": _json_number(table.cx),
                "cy": _json_number(table.cy),
                "w": _json_number(table.w),
                "h": _json_number(table.h),
                "angle": table.angle,
                "sideSeats": table.long_side_seats,
                "isRabbiTable": table.is_rabbi_table,
            }
            for table in tables
        ],
        "connections": [
            {
                "aTableId": connection.from_client_table_id,
                "aEnd": connection.from_end,
                "bTableId": connection.to_client_table_id,
                "bEnd": connection.to_end,
                "x": _json_number(connection.anchor_x),
                "y": _json_number(connection.anchor_y),
            }
            for connection in connections
        ],
    }


async def create_admin_seating_template_from_layout(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminSeatingTemplateFromLayoutRequest,
) -> AdminSeatingTemplateResponse:
    async with _transaction_scope(session):
        layout = await _get_scoped_layout_by_id(
            session,
            current_user,
            payload.layout_id,
            for_update=True,
        )
        tables = list(
            await session.scalars(
                select(EventSeatingTable)
                .where(EventSeatingTable.layout_id == layout.id)
                .order_by(
                    EventSeatingTable.sort_order,
                    EventSeatingTable.created_at,
                    EventSeatingTable.client_table_id,
                ),
            ),
        )
        connections = list(
            await session.scalars(
                select(EventSeatingTableConnection)
                .where(EventSeatingTableConnection.layout_id == layout.id)
                .order_by(
                    EventSeatingTableConnection.created_at,
                    EventSeatingTableConnection.id,
                ),
            ),
        )
        template = EventSeatingLayoutTemplate(
            community_id=layout.community_id,
            title=payload.title,
            description=payload.description,
            snapshot=_snapshot_from_geometry_rows(tables, connections),
            is_builtin=False,
            is_active=True,
            created_by=current_user.id,
        )
        session.add(template)
        await session.flush()
        await session.refresh(template)
        return AdminSeatingTemplateResponse.model_validate(template)


async def delete_admin_seating_template(
    session: AsyncSession,
    current_user: AppUser,
    template_id: UUID,
) -> AdminSeatingTemplateResponse:
    async with _transaction_scope(session):
        template = await _get_active_template(
            session,
            current_user,
            template_id,
            for_update=True,
        )
        if template.is_builtin:
            raise _forbidden("Built-in seating templates cannot be deleted")

        template.is_active = False
        template.updated_at = _now()
        await session.flush()
        await session.refresh(template)
        return AdminSeatingTemplateResponse.model_validate(template)


async def get_admin_seating_layout(
    session: AsyncSession,
    current_user: AppUser,
    *,
    event_id: UUID,
    occurrence_id: UUID | None,
    capacity_unit_id: UUID,
) -> AdminSeatingLayoutEnvelopeResponse:
    slot = await _resolve_slot(
        session,
        current_user,
        event_id=event_id,
        occurrence_id=occurrence_id,
        capacity_unit_id=capacity_unit_id,
    )
    layout = await _get_layout_for_slot(session, slot)
    return await _layout_envelope_response(session, layout)


def _add_tables(
    session: AsyncSession,
    *,
    layout_id: UUID,
    tables: Sequence[AdminSeatingTablePayload],
) -> None:
    for index, table in enumerate(tables):
        session.add(
            EventSeatingTable(
                layout_id=layout_id,
                client_table_id=table.client_table_id,
                cx=table.cx,
                cy=table.cy,
                w=table.w,
                h=table.h,
                angle=table.angle,
                long_side_seats=table.long_side_seats,
                is_rabbi_table=table.is_rabbi_table,
                sort_order=table.sort_order if table.sort_order is not None else index,
            ),
        )


def _add_connections(
    session: AsyncSession,
    *,
    layout_id: UUID,
    connections: Sequence[AdminSeatingConnectionPayload],
) -> None:
    for connection in connections:
        session.add(
            EventSeatingTableConnection(
                layout_id=layout_id,
                from_client_table_id=connection.from_client_table_id,
                from_end=connection.from_end,
                to_client_table_id=connection.to_client_table_id,
                to_end=connection.to_end,
                anchor_x=connection.anchor_x,
                anchor_y=connection.anchor_y,
            ),
        )


async def create_admin_seating_layout_from_template(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminSeatingLayoutFromTemplateRequest,
) -> AdminSeatingLayoutRowResponse:
    async with _transaction_scope(session):
        slot = await _resolve_slot(
            session,
            current_user,
            event_id=payload.event_id,
            occurrence_id=payload.occurrence_id,
            capacity_unit_id=payload.capacity_unit_id,
        )
        template = await _get_active_template(session, current_user, payload.template_id)
        if template.community_id != slot.community_id:
            raise _not_found("Seating template not found")

        existing_layout = await _get_layout_for_slot(session, slot, for_update=True)
        if existing_layout is not None:
            raise _conflict("A seating layout already exists for this slot")

        tables, connections = _template_geometry(template)
        layout = EventSeatingLayout(
            community_id=slot.community_id,
            event_id=slot.event.id,
            occurrence_id=slot.occurrence.id if slot.occurrence else None,
            capacity_unit_id=slot.capacity_unit.id,
            template_id=template.id,
            capacity_limit_snapshot=_derive_capacity_snapshot(
                slot.event,
                slot.occurrence,
                slot.capacity_unit,
            ),
            seating_done=False,
            created_by=current_user.id,
        )
        session.add(layout)
        await session.flush()
        _add_tables(session, layout_id=layout.id, tables=tables)
        _add_connections(session, layout_id=layout.id, connections=connections)
        await session.flush()
        await session.refresh(layout)
        return _layout_row_response(layout)


async def save_admin_seating_layout(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminSeatingLayoutPatchRequest,
) -> AdminSeatingLayoutRowResponse:
    _validate_geometry(payload.custom_tables, payload.table_connections)

    async with _transaction_scope(session):
        slot = await _resolve_slot(
            session,
            current_user,
            event_id=payload.event_id,
            occurrence_id=payload.occurrence_id,
            capacity_unit_id=payload.capacity_unit_id,
        )
        template_id = await _resolve_template_reference(
            session,
            community_id=slot.community_id,
            active_template_id=payload.active_template_id,
        )
        layout = await _get_layout_for_slot(session, slot, for_update=True)
        now = _now()
        if layout is None:
            layout = EventSeatingLayout(
                community_id=slot.community_id,
                event_id=slot.event.id,
                occurrence_id=slot.occurrence.id if slot.occurrence else None,
                capacity_unit_id=slot.capacity_unit.id,
                created_by=current_user.id,
            )
            session.add(layout)
            await session.flush()

        layout.template_id = template_id
        layout.capacity_limit_snapshot = _derive_capacity_snapshot(
            slot.event,
            slot.occurrence,
            slot.capacity_unit,
        )
        layout.seating_done = payload.seating_done
        layout.updated_at = now

        await session.execute(
            delete(EventSeatingTableConnection).where(
                EventSeatingTableConnection.layout_id == layout.id,
            ),
        )
        await session.execute(
            delete(EventSeatingTable).where(EventSeatingTable.layout_id == layout.id),
        )
        _add_tables(session, layout_id=layout.id, tables=payload.custom_tables)
        await session.flush()
        _add_connections(
            session,
            layout_id=layout.id,
            connections=payload.table_connections,
        )
        await session.flush()
        await session.refresh(layout)
        return _layout_row_response(layout)


def _seat_key_parts(seat_key: str) -> tuple[str, str | None, int | None]:
    side_match = _STABLE_SIDE_SEAT_RE.match(seat_key)
    if side_match is not None:
        table_id, _, raw_slot = side_match.groups()
        return table_id, "side", int(raw_slot)

    end_match = _STABLE_END_SEAT_RE.match(seat_key)
    if end_match is not None:
        table_id, _ = end_match.groups()
        return table_id, "end", None

    legacy_match = _LEGACY_SEAT_RE.match(seat_key)
    if legacy_match is not None:
        table_id, raw_index = legacy_match.groups()
        return table_id, "legacy", int(raw_index)

    raise _validation_error("seat_key has unsupported format")


async def _layout_table_ids(session: AsyncSession, layout_id: UUID) -> dict[str, int]:
    tables = list(
        await session.scalars(
            select(EventSeatingTable).where(EventSeatingTable.layout_id == layout_id),
        ),
    )
    return {
        table.client_table_id: table.long_side_seats
        for table in tables
    }


def _validate_seat_key(
    seat_key: str,
    table_long_side_seats: dict[str, int],
) -> None:
    table_id, seat_kind, slot = _seat_key_parts(seat_key)
    if table_id not in table_long_side_seats:
        raise _validation_error("seat_key references an unknown table")
    if seat_kind == "side" and slot is not None:
        if slot < 0 or slot >= table_long_side_seats[table_id]:
            raise _validation_error("seat_key references an unknown side seat")


async def _registration_obligation_ids(
    session: AsyncSession,
    *,
    registration_ids: Sequence[UUID],
    event_id: UUID,
    occurrence_id: UUID | None,
    capacity_unit_id: UUID,
) -> set[UUID]:
    if not registration_ids:
        return set()

    reservation_ids = set(
        await session.scalars(
            select(EventRegistrationCapacityReservation.registration_id).where(
                EventRegistrationCapacityReservation.registration_id.in_(
                    registration_ids,
                ),
                EventRegistrationCapacityReservation.event_id == event_id,
                EventRegistrationCapacityReservation.capacity_unit_id == capacity_unit_id,
                _occurrence_filter(
                    EventRegistrationCapacityReservation.occurrence_id,
                    occurrence_id,
                ),
            ),
        ),
    )
    mapped_option_ids = set(
        await session.scalars(
            select(EventRegistrationOptionSelection.registration_id)
            .join(
                EventParticipationOptionCapacityUnit,
                and_(
                    EventParticipationOptionCapacityUnit.option_id
                    == EventRegistrationOptionSelection.option_id,
                    EventParticipationOptionCapacityUnit.event_id == event_id,
                    EventParticipationOptionCapacityUnit.capacity_unit_id
                    == capacity_unit_id,
                ),
            )
            .where(
                EventRegistrationOptionSelection.registration_id.in_(registration_ids),
                EventRegistrationOptionSelection.option_id.is_not(None),
                EventRegistrationOptionSelection.quantity > 0,
                EventRegistrationOptionSelection.is_donation.is_(False),
                EventRegistrationOptionSelection.counts_toward_capacity.is_(True),
            ),
        ),
    )
    return reservation_ids | mapped_option_ids


async def _registrations_by_id(
    session: AsyncSession,
    *,
    registration_ids: Sequence[UUID],
    event_id: UUID,
    occurrence_id: UUID | None,
) -> dict[UUID, EventRegistration]:
    if not registration_ids:
        return {}

    registrations = list(
        await session.scalars(
            select(EventRegistration).where(
                EventRegistration.id.in_(registration_ids),
                EventRegistration.event_id == event_id,
                _occurrence_filter(EventRegistration.occurrence_id, occurrence_id),
                EventRegistration.status.in_(ACTIVE_ASSIGNMENT_REGISTRATION_STATUSES),
            ),
        ),
    )
    return {
        registration.id: registration
        for registration in registrations
    }


async def _normalize_assignments(
    session: AsyncSession,
    *,
    payload: AdminSeatingAssignmentsPatchRequest,
    layout_id: UUID,
) -> list[_NormalizedAssignment]:
    table_long_side_seats = await _layout_table_ids(session, layout_id)
    if not table_long_side_seats:
        raise _validation_error("The seating layout has no tables")

    entries: list[tuple[AdminSeatingAssignmentEntryPayload, str | None]] = []
    for entry in payload.chairs:
        if entry.seat_key is None:
            raise _validation_error("chair assignments require seat_key")
        entries.append((entry, entry.seat_key))
    for entry in payload.pool:
        entries.append((entry, None))

    seen_seat_keys: set[str] = set()
    seen_guest_keys: set[tuple[UUID, int]] = set()
    registration_ids: set[UUID] = set()

    for entry, seat_key in entries:
        if seat_key is not None:
            if seat_key in seen_seat_keys:
                raise _validation_error("duplicate seat_key in assignments payload")
            _validate_seat_key(seat_key, table_long_side_seats)
            seen_seat_keys.add(seat_key)

        if entry.assignment_type == "reserve":
            if entry.registration_id is not None:
                raise _validation_error("A reserve assignment must not carry registration_id")
            continue

        if entry.registration_id is None:
            raise _validation_error("A guest assignment requires registration_id")
        registration_ids.add(entry.registration_id)
        if entry.guest_index is not None:
            guest_key = (entry.registration_id, entry.guest_index)
            if guest_key in seen_guest_keys:
                raise _validation_error("duplicate registration_id/guest_index assignment")
            seen_guest_keys.add(guest_key)

    registrations = await _registrations_by_id(
        session,
        registration_ids=list(registration_ids),
        event_id=payload.event_id,
        occurrence_id=payload.occurrence_id,
    )
    obligation_ids = await _registration_obligation_ids(
        session,
        registration_ids=list(registration_ids),
        event_id=payload.event_id,
        occurrence_id=payload.occurrence_id,
        capacity_unit_id=payload.capacity_unit_id,
    )

    normalized: list[_NormalizedAssignment] = []
    for entry, seat_key in entries:
        registration: EventRegistration | None = None
        if entry.assignment_type == "guest":
            registration = registrations.get(entry.registration_id)
            if registration is None or registration.id not in obligation_ids:
                raise _validation_error(
                    "Registration does not belong to this event/occurrence/capacity unit",
                )

        normalized.append(
            _NormalizedAssignment(
                registration_id=registration.id if registration else None,
                guest_index=entry.guest_index,
                user_id=registration.user_id if registration else None,
                seat_key=seat_key,
                guest_label=entry.guest_label,
                guest_initials=entry.guest_initials,
                assignment_type=entry.assignment_type,
            ),
        )

    return normalized


async def save_admin_seating_assignments(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminSeatingAssignmentsPatchRequest,
) -> AdminSeatingAssignmentsSaveResponse:
    async with _transaction_scope(session):
        slot = await _resolve_slot(
            session,
            current_user,
            event_id=payload.event_id,
            occurrence_id=payload.occurrence_id,
            capacity_unit_id=payload.capacity_unit_id,
        )
        layout = await _get_layout_for_slot(session, slot, for_update=True)
        if layout is None:
            raise _not_found("No seating layout for this slot; save the layout first")

        assignments = await _normalize_assignments(
            session,
            payload=payload,
            layout_id=layout.id,
        )

        await session.execute(
            delete(EventSeatingAssignment).where(
                EventSeatingAssignment.layout_id == layout.id,
            ),
        )
        for assignment in assignments:
            session.add(
                EventSeatingAssignment(
                    layout_id=layout.id,
                    registration_id=assignment.registration_id,
                    guest_index=assignment.guest_index,
                    user_id=assignment.user_id,
                    seat_key=assignment.seat_key,
                    guest_label=assignment.guest_label,
                    guest_initials=assignment.guest_initials,
                    assignment_type=assignment.assignment_type,
                    created_by=current_user.id,
                ),
            )

        await session.flush()
        placed_count = sum(1 for assignment in assignments if assignment.seat_key)
        pooled_count = len(assignments) - placed_count
        reserve_count = sum(
            1
            for assignment in assignments
            if assignment.assignment_type == "reserve"
        )
        return AdminSeatingAssignmentsSaveResponse(
            layout_id=layout.id,
            placed_count=placed_count,
            pooled_count=pooled_count,
            reserve_count=reserve_count,
        )
