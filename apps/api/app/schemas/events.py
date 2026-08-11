from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.common import (
    ApiResponse,
    DataT,
    ListResponseMeta,
    PaginatedApiResponse,
    PaginationMeta,
    ResponseMeta,
)
from app.schemas.event_questionnaires import WebEventQuestionnaireFieldResponse

__all__ = [
    "ApiResponse",
    "DataT",
    "ListResponseMeta",
    "PaginatedApiResponse",
    "PaginationMeta",
    "ResponseMeta",
    "EventCategoryResponse",
    "EventResponse",
    "EventOccurrenceResponse",
    "EventParticipationOptionResponse",
    "EventCapacityUnitResponse",
    "WebEventRegistrationFormResponse",
]

WebRegistrationState = Literal[
    "open",
    "not_yet_open",
    "closed",
    "full",
    "unavailable",
]
OccurrenceSelectionMode = Literal["none", "user_select", "nearest"]


def _require_timezone(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("must be an ISO 8601 datetime with timezone")
    return value


class EventCategoryResponse(BaseModel):
    id: UUID
    community_id: UUID
    slug: str
    title: str
    description: str | None
    color: str
    icon: str
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventResponse(BaseModel):
    id: UUID
    community_id: UUID
    event_kind: str
    title: str
    subtitle: str | None
    description: str | None
    short_description: str | None
    starts_at: datetime
    ends_at: datetime | None
    is_permanent: bool
    timezone: str | None
    location_name: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    image_url: str | None
    category: str
    audience: str | None
    visibility: str
    status: str
    source_url: str | None
    registration_mode: str
    registration_url: str | None
    capacity: int | None
    waitlist_enabled: bool
    requires_approval: bool
    price_amount: int | None
    price_currency: str | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventOccurrenceResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str | None
    starts_at: datetime
    ends_at: datetime | None
    timezone: str
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    capacity: int | None
    waitlist_enabled: bool | None
    requires_approval: bool | None
    status: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventParticipationOptionResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str
    description: str | None
    price_amount: int
    price_currency: str
    option_type: str
    seat_limit: int | None
    allow_quantity: bool
    min_quantity: int
    max_quantity: int
    is_donation: bool
    counts_toward_capacity: bool
    group_key: str | None
    conflicts_with: list[Any]
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventCapacityUnitResponse(BaseModel):
    id: UUID
    event_id: UUID
    key: str
    title: str
    description: str | None
    capacity: int | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WebRegistrationEventResponse(BaseModel):
    id: UUID
    title: str
    subtitle: str | None
    description: str | None
    short_description: str | None
    starts_at: datetime
    ends_at: datetime | None
    timezone: str | None
    location_name: str | None
    address: str | None
    image_url: str | None
    category: str
    capacity: int | None
    waitlist_enabled: bool
    requires_approval: bool

    model_config = ConfigDict(from_attributes=True)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)


class WebRegistrationOccurrenceResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str | None
    starts_at: datetime
    ends_at: datetime | None
    timezone: str
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    capacity: int | None
    waitlist_enabled: bool | None
    requires_approval: bool | None
    registration_state: WebRegistrationState

    @field_validator(
        "starts_at",
        "ends_at",
        "registration_opens_at",
        "registration_closes_at",
    )
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)


class WebRegistrationParticipationOptionResponse(BaseModel):
    id: UUID
    event_id: UUID
    title: str
    description: str | None
    price_amount: int
    price_currency: str
    option_type: str
    seat_limit: int | None
    allow_quantity: bool
    min_quantity: int
    max_quantity: int
    counts_toward_capacity: bool
    group_key: str | None
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class WebRegistrationLegalDocumentResponse(BaseModel):
    id: UUID
    document_type: Literal["event_registration_consent", "privacy_policy"]
    version: str
    title: str
    content_hash: str
    published_url: str
    effective_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("effective_at")
    @classmethod
    def require_timezone_field(cls, value: datetime) -> datetime:
        validated = _require_timezone(value)
        assert validated is not None
        return validated


class WebEventRegistrationFormResponse(BaseModel):
    canonical_public_path: str
    resolved_from_alias: bool
    event: WebRegistrationEventResponse
    registration_state: WebRegistrationState
    occurrence_selection_mode: OccurrenceSelectionMode
    default_occurrence_id: UUID | None
    next_registration_state_check_at: datetime | None
    occurrences: list[WebRegistrationOccurrenceResponse]
    participation_options: list[WebRegistrationParticipationOptionResponse]
    legal_documents: list[WebRegistrationLegalDocumentResponse]
    questionnaire_form_id: UUID | None
    questions: list[WebEventQuestionnaireFieldResponse]

    @field_validator("next_registration_state_check_at")
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)
