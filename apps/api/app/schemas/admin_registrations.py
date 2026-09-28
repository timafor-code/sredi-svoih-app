from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.registrations import RegisterEventRequest
from app.schemas.web_registration import (
    normalize_email,
    normalize_international_phone,
    normalize_name,
)

RegistrationSourceChannel = Literal["mobile", "public_web", "admin"]
QuestionnaireFieldType = Literal[
    "short_text", "long_text", "single_select", "multi_select", "boolean"
]
QuestionnaireAnswerValue = str | bool | list[str] | None


class AdminExistingRegistrationParticipant(BaseModel):
    mode: Literal["existing"]
    user_id: UUID

    model_config = ConfigDict(extra="forbid")


class AdminNewRegistrationParticipant(BaseModel):
    mode: Literal["new"]
    full_name: str
    phone: str
    email: str | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        return normalize_name(value)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_international_phone(value)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_email(value)


AdminRegistrationParticipant = Annotated[
    AdminExistingRegistrationParticipant | AdminNewRegistrationParticipant,
    Field(discriminator="mode"),
]


class AdminCreateEventRegistrationRequest(RegisterEventRequest):
    participant: AdminRegistrationParticipant

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminRegistrationParticipantPickerResponse(BaseModel):
    """Minimal identity projection for the event-scoped Admin picker."""

    id: UUID
    display_name: str
    phone: str | None
    email: str | None


class AdminRegistrationQuestionnaireAnswerResponse(BaseModel):
    field_id: UUID
    field_key: str
    label: str
    field_type: QuestionnaireFieldType
    value_payload: QuestionnaireAnswerValue
    form_version: int
    form_status: Literal["published", "retired"]
    options: list["AdminRegistrationQuestionnaireOptionResponse"]


class AdminRegistrationQuestionnaireOptionResponse(BaseModel):
    value: str
    label: str


class AdminQuestionnaireSummaryOptionResponse(BaseModel):
    value: str | bool
    label: str
    count: int


class AdminQuestionnaireAnswerSummaryFieldResponse(BaseModel):
    field_id: UUID
    field_key: str
    label: str
    field_type: QuestionnaireFieldType
    form_version: int
    answered_count: int
    options: list[AdminQuestionnaireSummaryOptionResponse]


class AdminQuestionnaireAnswersSummaryResponse(BaseModel):
    event_id: UUID
    fields: list[AdminQuestionnaireAnswerSummaryFieldResponse]


class AdminRegistrationSelectedOptionResponse(BaseModel):
    id: UUID
    option_id: UUID | None
    title: str
    description: str | None
    option_type: str
    quantity: int
    unit_price_amount: int
    total_amount: int
    currency: str
    counts_toward_capacity: bool
    seats_count: int
    is_donation: bool
    created_at: datetime


class AdminEventRegistrationResponse(BaseModel):
    id: UUID
    event_id: UUID
    occurrence_id: UUID | None
    user_id: UUID
    participant_display_name: str
    email: str | None
    phone: str | None
    status: str
    source_channel: RegistrationSourceChannel
    seats_count: int
    guest_names: list[object]
    comment: str | None
    payment_status: str
    payment_id: str | None
    registered_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    occurrence_starts_at: datetime | None
    occurrence_ends_at: datetime | None
    occurrence_title: str | None
    selected_options: list[AdminRegistrationSelectedOptionResponse]
    answers: list[AdminRegistrationQuestionnaireAnswerResponse]
    total_amount: int | None
    created_at: datetime
    updated_at: datetime


class AdminRegistrationCapacityStatusCountsResponse(BaseModel):
    confirmed: int
    pending: int
    waitlisted: int
    cancelled: int
    rejected: int
    attended: int
    no_show: int


class AdminRegistrationCapacityOptionStatResponse(BaseModel):
    option_id: UUID | None
    title: str
    option_type: str
    registrations_count: int
    quantity: int
    seats_count: int
    is_donation: bool
    counts_toward_capacity: bool


class AdminRegistrationCapacityBucketOptionBreakdownResponse(BaseModel):
    option_id: UUID | None
    title: str
    registrations_count: int
    quantity: int
    seats_count: int
    is_donation: bool
    counts_toward_capacity: bool


class AdminRegistrationCapacityBucketResponse(BaseModel):
    capacity_unit_id: UUID
    key: str
    code: str
    title: str
    capacity: int | None
    effective_capacity: int | None
    occupied_seats: int
    remaining_seats: int | None
    free_seats: int | None
    effective_remaining_seats: int | None
    fill_percent: int | None
    effective_fill_percent: int | None
    effective_free_percent: int | None
    reservations_count: int
    option_titles: list[str]
    option_breakdown: list[AdminRegistrationCapacityBucketOptionBreakdownResponse]
    is_unlimited: bool
    uses_fallback_capacity: bool


class AdminRegistrationCapacityBucketAggregateResponse(BaseModel):
    occupied_seats: int
    known_capacity: int
    remaining_seats: int
    fill_percent: int | None
    free_percent: int | None
    limited_bucket_count: int
    has_unlimited_buckets: bool


class AdminRegistrationCapacityTotalsResponse(BaseModel):
    total_registrations: int
    total_registrations_count: int
    status_counts: AdminRegistrationCapacityStatusCountsResponse
    confirmed_count: int
    pending_count: int
    waitlisted_count: int
    cancelled_count: int
    rejected_count: int
    attended_count: int
    no_show_count: int
    active_registrations_count: int
    active_seats_count: int
    unique_registered_users_count: int
    unique_guests_count: int
    unique_people_count: int
    multi_meal_guests_count: int
    sponsors_donations_count: int
    donations_count: int
    donation_quantity: int
    donation_registrations_count: int
    capacity: int | None
    remaining_seats: int | None
    free_seats: int | None
    fill_percent: int | None
    free_percent: int | None


class AdminRegistrationCapacityAnalyticsResponse(BaseModel):
    event_id: UUID
    occurrence_id: UUID | None
    totals: AdminRegistrationCapacityTotalsResponse
    bucket_aggregate: AdminRegistrationCapacityBucketAggregateResponse
    buckets: list[AdminRegistrationCapacityBucketResponse]
    option_stats: list[AdminRegistrationCapacityOptionStatResponse]
    donation_options: list[AdminRegistrationCapacityOptionStatResponse]
