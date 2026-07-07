from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from app.schemas.events import EventOccurrenceResponse, EventResponse


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class RegistrationOptionSelectionInput(BaseModel):
    option_id: UUID = Field(
        validation_alias=AliasChoices("option_id", "optionId"),
    )
    quantity: int = Field(ge=1, le=1000)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RegisterEventRequest(BaseModel):
    occurrence_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("occurrence_id", "occurrenceId"),
    )
    seats_count: int = Field(
        default=1,
        ge=1,
        le=1000,
        validation_alias=AliasChoices("seats_count", "seatsCount"),
    )
    guest_names: list[str] = Field(
        default_factory=list,
        max_length=100,
        validation_alias=AliasChoices("guest_names", "guestNames"),
    )
    comment: str | None = Field(default=None, max_length=2000)
    option_selections: list[RegistrationOptionSelectionInput] = Field(
        default_factory=list,
        max_length=100,
        validation_alias=AliasChoices("option_selections", "optionSelections"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("guest_names")
    @classmethod
    def normalize_guest_names(cls, value: list[str]) -> list[str]:
        return [
            normalized
            for item in value
            if (normalized := item.strip())
        ]


class RegistrationSelectedOptionResponse(BaseModel):
    id: UUID
    option_id: UUID | None
    title_snapshot: str
    description_snapshot: str | None
    option_type_snapshot: str
    quantity: int
    unit_price_amount: int
    total_amount: int
    currency: str
    counts_toward_capacity: bool
    seats_count: int
    is_donation: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RegistrationCapacityReservationResponse(BaseModel):
    id: UUID
    capacity_unit_id: UUID
    option_id: UUID | None
    capacity_unit_key_snapshot: str
    capacity_unit_title_snapshot: str
    option_title_snapshot: str | None
    quantity: int
    seats_per_quantity: int
    seats_count: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventRegistrationResponse(BaseModel):
    id: UUID
    event_id: UUID
    occurrence_id: UUID | None
    user_id: UUID
    status: str
    seats_count: int
    guest_names: list[Any]
    comment: str | None
    registered_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    payment_status: str
    payment_id: str | None
    created_at: datetime
    updated_at: datetime
    event: EventResponse
    occurrence: EventOccurrenceResponse | None
    selected_options: list[RegistrationSelectedOptionResponse]
    capacity_reservations: list[RegistrationCapacityReservationResponse]
    total_amount: int | None
    total_currency: str | None

    model_config = ConfigDict(from_attributes=True)
