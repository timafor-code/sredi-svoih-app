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
AdminEventOccurrenceStatus = Literal["active", "hidden", "cancelled", "archived"]
AdminEventOccurrenceRegistrationState = Literal[
    "open",
    "not_yet_open",
    "closed",
    "unavailable",
]
AdminEventParticipationOptionType = Literal[
    "participation",
    "meal",
    "package",
    "donation",
    "child",
    "family",
    "other",
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


class AdminEventCategoryCreateRequest(BaseModel):
    community_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    slug: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9_]{1,63}$")
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=1000)
    color: str = Field(default="#7B68EE", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field(default="*", min_length=1, max_length=64)
    sort_order: int = Field(
        default=100,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )
    is_active: bool = Field(
        default=True,
        validation_alias=AliasChoices("is_active", "isActive"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("description")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("slug", "title", "color", "icon")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)


class AdminEventCategoryUpdateRequest(BaseModel):
    slug: str | None = Field(
        default=None,
        min_length=2,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_]{1,63}$",
    )
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=1000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(default=None, min_length=1, max_length=64)
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )
    is_active: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_active", "isActive"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("slug", "title", "description", "color", "icon")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminEventCategoryResponse(BaseModel):
    id: UUID
    community_id: UUID
    slug: str
    title: str
    description: str | None
    color: str
    icon: str
    sort_order: int
    is_active: bool
    created_by: UUID | None
    updated_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminEventOccurrenceUpsertRequest(BaseModel):
    id: UUID | None = None
    title: str | None = Field(default=None, max_length=240)
    starts_at: datetime = Field(
        validation_alias=AliasChoices("starts_at", "startsAt"),
    )
    ends_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("ends_at", "endsAt"),
    )
    timezone: str = Field(default="Europe/Moscow", min_length=1, max_length=120)
    registration_opens_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("registration_opens_at", "registrationOpensAt"),
    )
    registration_closes_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "registration_closes_at",
            "registrationClosesAt",
        ),
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
    status: AdminEventOccurrenceStatus = "active"
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("title")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("timezone")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator(
        "starts_at",
        "ends_at",
        "registration_opens_at",
        "registration_closes_at",
    )
    @classmethod
    def require_timezone_field(cls, value: datetime | None) -> datetime | None:
        return _require_timezone(value)

    @model_validator(mode="after")
    def validate_occurrence_fields(self) -> "AdminEventOccurrenceUpsertRequest":
        if self.ends_at is not None and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be greater than starts_at")
        if (
            self.registration_opens_at is not None
            and self.registration_closes_at is not None
            and self.registration_closes_at <= self.registration_opens_at
        ):
            raise ValueError(
                "registration_closes_at must be greater than registration_opens_at",
            )
        return self


class AdminEventOccurrencesReplaceRequest(BaseModel):
    occurrences: list[AdminEventOccurrenceUpsertRequest]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminEventOccurrenceResponse(BaseModel):
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
    server_now: datetime | None = None
    is_registration_always_open: bool = False
    registration_state: AdminEventOccurrenceRegistrationState = "unavailable"
    registration_state_reason: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AdminOptionCapacityUnitMappingRequest(BaseModel):
    capacity_unit_id: UUID = Field(
        validation_alias=AliasChoices("capacity_unit_id", "capacityUnitId"),
    )
    seats_per_quantity: int = Field(
        default=1,
        gt=0,
        validation_alias=AliasChoices("seats_per_quantity", "seatsPerQuantity"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminOptionCapacityUnitMappingResponse(BaseModel):
    id: UUID
    event_id: UUID
    option_id: UUID
    capacity_unit_id: UUID
    seats_per_quantity: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminEventParticipationOptionUpsertRequest(BaseModel):
    id: UUID | None = None
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=1000)
    price_amount: int = Field(
        default=0,
        ge=0,
        validation_alias=AliasChoices("price_amount", "priceAmount"),
    )
    price_currency: str = Field(
        default="RUB",
        min_length=1,
        max_length=16,
        validation_alias=AliasChoices("price_currency", "priceCurrency"),
    )
    option_type: AdminEventParticipationOptionType = Field(
        default="participation",
        validation_alias=AliasChoices("option_type", "optionType"),
    )
    seat_limit: int | None = Field(
        default=None,
        gt=0,
        validation_alias=AliasChoices("seat_limit", "seatLimit"),
    )
    allow_quantity: bool = Field(
        default=False,
        validation_alias=AliasChoices("allow_quantity", "allowQuantity"),
    )
    min_quantity: int = Field(
        default=1,
        ge=1,
        validation_alias=AliasChoices("min_quantity", "minQuantity"),
    )
    max_quantity: int = Field(
        default=1,
        ge=1,
        validation_alias=AliasChoices("max_quantity", "maxQuantity"),
    )
    is_donation: bool = Field(
        default=False,
        validation_alias=AliasChoices("is_donation", "isDonation"),
    )
    counts_toward_capacity: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "counts_toward_capacity",
            "countsTowardCapacity",
        ),
    )
    group_key: str | None = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("group_key", "groupKey"),
    )
    conflicts_with: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("conflicts_with", "conflictsWith"),
    )
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )
    is_active: bool = Field(
        default=True,
        validation_alias=AliasChoices("is_active", "isActive"),
    )
    capacity_units: list[AdminOptionCapacityUnitMappingRequest] = Field(
        default_factory=list,
        validation_alias=AliasChoices("capacity_units", "capacityUnits"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("description", "group_key")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("title", "price_currency")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator("conflicts_with")
    @classmethod
    def normalize_conflicts_with(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            text = value.strip()
            if text:
                normalized.append(text)
        return normalized

    @model_validator(mode="after")
    def validate_option_fields(self) -> "AdminEventParticipationOptionUpsertRequest":
        if self.max_quantity < self.min_quantity:
            raise ValueError("max_quantity must be greater than or equal to min_quantity")
        if not self.allow_quantity and (
            self.min_quantity != 1 or self.max_quantity != 1
        ):
            raise ValueError(
                "min_quantity and max_quantity must both be 1 when quantity is disabled",
            )
        if (self.is_donation or not self.counts_toward_capacity) and self.capacity_units:
            raise ValueError(
                "donation and non-capacity options cannot use capacity units",
            )
        return self


class AdminEventParticipationOptionsReplaceRequest(BaseModel):
    participation_options: list[AdminEventParticipationOptionUpsertRequest] = Field(
        validation_alias=AliasChoices(
            "participation_options",
            "participationOptions",
        ),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminEventParticipationOptionResponse(BaseModel):
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
    conflicts_with: list[str]
    sort_order: int
    is_active: bool
    capacity_units: list[AdminOptionCapacityUnitMappingResponse] = Field(
        default_factory=list,
    )
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminEventCapacityUnitUpsertRequest(BaseModel):
    id: UUID | None = None
    key: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=1000)
    capacity: int | None = Field(default=None, gt=0)
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )
    is_active: bool = Field(
        default=True,
        validation_alias=AliasChoices("is_active", "isActive"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("description")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("key", "title")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)


class AdminEventCapacityUnitsReplaceRequest(BaseModel):
    capacity_units: list[AdminEventCapacityUnitUpsertRequest] = Field(
        validation_alias=AliasChoices("capacity_units", "capacityUnits"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminEventCapacityUnitResponse(BaseModel):
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
