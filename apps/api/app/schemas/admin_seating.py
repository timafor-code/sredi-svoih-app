from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

TableEnd = Literal["a", "b"]
SeatingAssignmentType = Literal["guest", "reserve"]


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


def _normalize_required_text(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


def _normalize_end(value: object | None) -> object | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return value

    normalized = value.strip().lower()
    return normalized or None


class AdminSeatingTablePayload(BaseModel):
    client_table_id: str = Field(
        validation_alias=AliasChoices("client_table_id", "clientTableId", "id"),
    )
    cx: Decimal
    cy: Decimal
    w: Decimal = Field(gt=Decimal("0"))
    h: Decimal = Field(gt=Decimal("0"))
    angle: int = 0
    long_side_seats: int = Field(
        default=3,
        validation_alias=AliasChoices(
            "long_side_seats",
            "longSideSeats",
            "sideSeats",
        ),
    )
    is_rabbi_table: bool = Field(
        default=False,
        validation_alias=AliasChoices("is_rabbi_table", "isRabbiTable"),
    )
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("client_table_id")
    @classmethod
    def normalize_client_table_id(cls, value: str) -> str:
        return _normalize_required_text(value)


class AdminSeatingConnectionPayload(BaseModel):
    from_client_table_id: str = Field(
        validation_alias=AliasChoices(
            "from_client_table_id",
            "fromClientTableId",
            "aTableId",
        ),
    )
    from_end: TableEnd | None = Field(
        default=None,
        validation_alias=AliasChoices("from_end", "fromEnd", "aEnd"),
    )
    to_client_table_id: str = Field(
        validation_alias=AliasChoices(
            "to_client_table_id",
            "toClientTableId",
            "bTableId",
        ),
    )
    to_end: TableEnd | None = Field(
        default=None,
        validation_alias=AliasChoices("to_end", "toEnd", "bEnd"),
    )
    anchor_x: Decimal | None = Field(
        default=None,
        validation_alias=AliasChoices("anchor_x", "anchorX", "x"),
    )
    anchor_y: Decimal | None = Field(
        default=None,
        validation_alias=AliasChoices("anchor_y", "anchorY", "y"),
    )

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("from_client_table_id", "to_client_table_id")
    @classmethod
    def normalize_table_id(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator("from_end", "to_end", mode="before")
    @classmethod
    def normalize_connection_end(cls, value: object | None) -> object | None:
        return _normalize_end(value)


class AdminSeatingAssignmentEntryPayload(BaseModel):
    seat_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("seat_key", "seatKey"),
    )
    registration_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("registration_id", "registrationId"),
    )
    guest_index: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("guest_index", "guestIndex"),
    )
    assignment_type: SeatingAssignmentType = Field(
        default="guest",
        validation_alias=AliasChoices("assignment_type", "assignmentType", "type"),
    )
    guest_label: str | None = Field(
        default=None,
        validation_alias=AliasChoices("guest_label", "guestLabel", "name"),
    )
    guest_initials: str | None = Field(
        default=None,
        validation_alias=AliasChoices("guest_initials", "guestInitials", "initials"),
    )

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("seat_key", "guest_label", "guest_initials")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("assignment_type", mode="before")
    @classmethod
    def normalize_assignment_type(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value


class AdminSeatingTemplateFromLayoutRequest(BaseModel):
    layout_id: UUID = Field(
        validation_alias=AliasChoices("layout_id", "layoutId"),
    )
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminSeatingLayoutFromTemplateRequest(BaseModel):
    event_id: UUID = Field(validation_alias=AliasChoices("event_id", "eventId"))
    occurrence_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("occurrence_id", "occurrenceId"),
    )
    capacity_unit_id: UUID = Field(
        validation_alias=AliasChoices("capacity_unit_id", "capacityUnitId"),
    )
    template_id: UUID = Field(
        validation_alias=AliasChoices("template_id", "templateId"),
    )

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class AdminSeatingLayoutPatchRequest(BaseModel):
    event_id: UUID = Field(validation_alias=AliasChoices("event_id", "eventId"))
    occurrence_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("occurrence_id", "occurrenceId"),
    )
    capacity_unit_id: UUID = Field(
        validation_alias=AliasChoices("capacity_unit_id", "capacityUnitId"),
    )
    layout: str | None = Field(default=None, max_length=120)
    custom_tables: list[AdminSeatingTablePayload] = Field(
        default_factory=list,
        validation_alias=AliasChoices("custom_tables", "customTables", "tables"),
    )
    table_connections: list[AdminSeatingConnectionPayload] = Field(
        default_factory=list,
        validation_alias=AliasChoices(
            "table_connections",
            "tableConnections",
            "connections",
        ),
    )
    selected_table_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("selected_table_id", "selectedTableId"),
    )
    seating_done: bool = Field(
        default=False,
        validation_alias=AliasChoices("seating_done", "seatingDone"),
    )
    active_template_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("active_template_id", "activeTemplateId"),
    )
    reserve_ids: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("reserve_ids", "reserveIds"),
    )
    capacity: int | None = Field(default=None, ge=0)
    chairs: list[AdminSeatingAssignmentEntryPayload] = Field(default_factory=list)
    pool: list[AdminSeatingAssignmentEntryPayload] = Field(default_factory=list)

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    @field_validator("layout", "selected_table_id", "active_template_id")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminSeatingAssignmentsPatchRequest(BaseModel):
    event_id: UUID = Field(validation_alias=AliasChoices("event_id", "eventId"))
    occurrence_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("occurrence_id", "occurrenceId"),
    )
    capacity_unit_id: UUID = Field(
        validation_alias=AliasChoices("capacity_unit_id", "capacityUnitId"),
    )
    chairs: list[AdminSeatingAssignmentEntryPayload] = Field(default_factory=list)
    pool: list[AdminSeatingAssignmentEntryPayload] = Field(default_factory=list)
    reserve_ids: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("reserve_ids", "reserveIds"),
    )

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class AdminSeatingTemplateResponse(BaseModel):
    id: UUID
    community_id: UUID
    title: str
    description: str | None
    snapshot: dict[str, Any]
    is_builtin: bool
    is_active: bool
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminSeatingLayoutRowResponse(BaseModel):
    id: UUID
    community_id: UUID
    event_id: UUID
    occurrence_id: UUID | None
    capacity_unit_id: UUID
    template_id: UUID | None
    title: str | None
    capacity_limit_snapshot: int | None
    seating_done: bool
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminSeatingTableResponse(BaseModel):
    id: UUID
    layout_id: UUID
    client_table_id: str
    cx: Decimal
    cy: Decimal
    w: Decimal
    h: Decimal
    angle: int
    long_side_seats: int
    is_rabbi_table: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminSeatingConnectionResponse(BaseModel):
    id: UUID
    layout_id: UUID
    from_client_table_id: str
    from_end: str | None
    to_client_table_id: str
    to_end: str | None
    anchor_x: Decimal | None
    anchor_y: Decimal | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminSeatingAssignmentResponse(BaseModel):
    id: UUID
    layout_id: UUID
    registration_id: UUID | None
    guest_index: int | None
    user_id: UUID | None
    seat_key: str | None
    guest_label: str | None
    guest_initials: str | None
    assignment_type: str
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminSeatingLayoutEnvelopeResponse(BaseModel):
    layout: AdminSeatingLayoutRowResponse | None
    tables: list[AdminSeatingTableResponse] = Field(default_factory=list)
    connections: list[AdminSeatingConnectionResponse] = Field(default_factory=list)
    assignments: list[AdminSeatingAssignmentResponse] = Field(default_factory=list)


class AdminSeatingAssignmentsSaveResponse(BaseModel):
    layout_id: UUID
    placed_count: int
    pooled_count: int
    reserve_count: int
