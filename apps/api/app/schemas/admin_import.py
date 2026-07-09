from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from pydantic import model_validator

from app.schemas.admin_events import AdminEventResponse

AdminImportItemStatus = Literal["new", "linked", "ignored", "error"]
AdminEventKind = Literal[
    "single",
    "course",
    "sunday_school",
    "shabbat",
    "holiday",
    "announcement",
]
AdminEventVisibility = Literal["public", "members_only", "hidden"]
AdminEventStatus = Literal["draft", "published", "cancelled", "archived"]
AdminEventRegistrationMode = Literal[
    "none",
    "external_link",
    "internal_free",
    "internal_paid",
]


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


def _require_timezone(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("must be an ISO 8601 datetime with timezone")
    return value


class AdminImportRunCreateRequest(BaseModel):
    source_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("source_id", "sourceId"),
    )
    community_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    source_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("source_url", "sourceUrl"),
    )
    source_key: str = Field(
        default="sredi_svoih_events",
        min_length=2,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_]{1,63}$",
        validation_alias=AliasChoices("source_key", "sourceKey"),
    )
    source_title: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=AliasChoices("source_title", "sourceTitle"),
    )
    limit: int | None = Field(default=None, ge=1, le=100)
    assume_year: int | None = Field(
        default=None,
        ge=2000,
        le=2100,
        validation_alias=AliasChoices("assume_year", "assumeYear"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("source_url", "source_title")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("source_key")
    @classmethod
    def normalize_source_key(cls, value: str) -> str:
        return _normalize_required_text(value)


class AdminImportRunResponse(BaseModel):
    id: UUID
    source_id: UUID
    community_id: UUID
    source_key: str
    source_title: str
    source_url: str
    mode: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    found_count: int
    parsed_count: int | None
    created_count: int
    updated_count: int
    error: str | None
    summary: dict[str, Any]
    parser_metadata: dict[str, Any]
    debug_metadata: dict[str, Any]
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class AdminImportItemResponse(BaseModel):
    id: UUID
    run_id: UUID
    source_id: UUID
    community_id: UUID
    source_key: str
    source_title: str
    external_id: str | None
    source_url: str | None
    raw_payload: dict[str, Any]
    parsed_title: str | None
    parsed_starts_at: datetime | None
    parsed_location: str | None
    linked_event_id: UUID | None
    status: str
    error: str | None
    created_at: datetime
    updated_at: datetime


class AdminImportIgnoreRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminImportItemPublishRequest(BaseModel):
    event_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("event_id", "eventId"),
    )
    event_kind: AdminEventKind | None = Field(
        default=None,
        validation_alias=AliasChoices("event_kind", "eventKind"),
    )
    title: str | None = Field(default=None, min_length=1, max_length=240)
    subtitle: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)
    short_description: str | None = Field(
        default=None,
        max_length=500,
        validation_alias=AliasChoices("short_description", "shortDescription"),
    )
    starts_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("starts_at", "startsAt"),
    )
    ends_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("ends_at", "endsAt"),
    )
    is_permanent: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_permanent", "isPermanent"),
    )
    timezone: str | None = Field(default=None, min_length=1, max_length=120)
    location_name: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=AliasChoices("location_name", "locationName"),
    )
    address: str | None = Field(default=None, max_length=500)
    latitude: Decimal | None = Field(default=None, ge=Decimal("-90"), le=Decimal("90"))
    longitude: Decimal | None = Field(
        default=None,
        ge=Decimal("-180"),
        le=Decimal("180"),
    )
    image_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("image_url", "imageUrl"),
    )
    category: str | None = Field(default=None, min_length=1, max_length=64)
    audience: str | None = Field(default=None, max_length=120)
    visibility: AdminEventVisibility | None = None
    status: AdminEventStatus | None = None
    source_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("source_url", "sourceUrl"),
    )
    registration_mode: AdminEventRegistrationMode | None = Field(
        default=None,
        validation_alias=AliasChoices("registration_mode", "registrationMode"),
    )
    registration_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("registration_url", "registrationUrl"),
    )
    capacity: int | None = Field(default=None, gt=0)
    waitlist_enabled: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("waitlist_enabled", "waitlistEnabled"),
    )
    requires_approval: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("requires_approval", "requiresApproval"),
    )
    price_amount: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("price_amount", "priceAmount"),
    )
    price_currency: str | None = Field(
        default=None,
        max_length=16,
        validation_alias=AliasChoices("price_currency", "priceCurrency"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator(
        "subtitle",
        "description",
        "short_description",
        "timezone",
        "location_name",
        "address",
        "image_url",
        "category",
        "audience",
        "source_url",
        "registration_url",
        "price_currency",
    )
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("title")
    @classmethod
    def normalize_title_field(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_required_text(value)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)

    @model_validator(mode="after")
    def validate_date_order_when_complete(self) -> "AdminImportItemPublishRequest":
        if (
            self.starts_at is not None
            and self.ends_at is not None
            and self.ends_at <= self.starts_at
        ):
            raise ValueError("ends_at must be greater than starts_at")
        return self


class AdminImportPublishResponse(BaseModel):
    event: AdminEventResponse
    import_item: AdminImportItemResponse
    linked_event_id: UUID
    created: bool
