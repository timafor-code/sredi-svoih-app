from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator
from pydantic import model_validator

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


class AdminEventCreateRequest(BaseModel):
    community_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    event_kind: AdminEventKind = Field(
        default="single",
        validation_alias=AliasChoices("event_kind", "eventKind"),
    )
    title: str = Field(min_length=1, max_length=240)
    subtitle: str | None = Field(default=None, max_length=240)
    description: str | None = Field(default=None, max_length=10000)
    short_description: str | None = Field(
        default=None,
        max_length=500,
        validation_alias=AliasChoices("short_description", "shortDescription"),
    )
    starts_at: datetime = Field(
        validation_alias=AliasChoices("starts_at", "startsAt"),
    )
    ends_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("ends_at", "endsAt"),
    )
    is_permanent: bool = Field(
        default=False,
        validation_alias=AliasChoices("is_permanent", "isPermanent"),
    )
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=120)
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
    category: str = Field(default="community", min_length=1, max_length=64)
    audience: str | None = Field(default=None, max_length=120)
    visibility: AdminEventVisibility = "public"
    status: AdminEventStatus = "draft"
    source_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("source_url", "sourceUrl"),
    )
    registration_mode: AdminEventRegistrationMode = Field(
        default="none",
        validation_alias=AliasChoices("registration_mode", "registrationMode"),
    )
    registration_url: str | None = Field(
        default=None,
        max_length=2000,
        validation_alias=AliasChoices("registration_url", "registrationUrl"),
    )
    capacity: int | None = Field(default=None, gt=0)
    waitlist_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("waitlist_enabled", "waitlistEnabled"),
    )
    requires_approval: bool = Field(
        default=False,
        validation_alias=AliasChoices("requires_approval", "requiresApproval"),
    )
    price_amount: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("price_amount", "priceAmount"),
    )
    price_currency: str | None = Field(
        default="RUB",
        max_length=16,
        validation_alias=AliasChoices("price_currency", "priceCurrency"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator(
        "subtitle",
        "description",
        "short_description",
        "location_name",
        "address",
        "image_url",
        "audience",
        "source_url",
        "registration_url",
        "price_currency",
    )
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("title", "timezone", "category")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)

    @model_validator(mode="after")
    def validate_event_fields(self) -> "AdminEventCreateRequest":
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be greater than starts_at")
        if self.registration_mode == "external_link" and self.registration_url is None:
            raise ValueError("registration_url is required for external_link")
        if self.price_amount is not None and self.price_currency is None:
            self.price_currency = "RUB"
        return self


class AdminEventUpdateRequest(BaseModel):
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
    def validate_date_order_when_complete(self) -> "AdminEventUpdateRequest":
        if (
            self.starts_at is not None
            and self.ends_at is not None
            and self.ends_at <= self.starts_at
        ):
            raise ValueError("ends_at must be greater than starts_at")
        return self


class AdminEventResponse(BaseModel):
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
    source_type: str
    source_url: str | None
    source_external_id: str | None
    manual_override: bool
    registration_mode: str
    registration_url: str | None
    capacity: int | None
    waitlist_enabled: bool
    requires_approval: bool
    price_amount: int | None
    price_currency: str | None
    created_by: UUID | None
    updated_by: UUID | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
