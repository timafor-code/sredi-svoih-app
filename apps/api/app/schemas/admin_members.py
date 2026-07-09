from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.schemas.admin_registrations import AdminRegistrationSelectedOptionResponse

AdminMemberMembershipRole = Literal["member", "rabbi", "event_manager", "admin"]
AdminMemberMembershipStatus = Literal["pending", "active", "suspended", "left"]
AdminMemberBirthTimeContext = Literal["before_sunset", "after_sunset", "unknown"]
AdminMemberTribeStatus = Literal["kohen", "levi", "israel"]
AdminMemberMaritalStatus = Literal[
    "single",
    "married",
    "divorced",
    "widowed",
    "other",
]


class AdminMemberListItemResponse(BaseModel):
    user_id: UUID
    display_name: str
    first_name: str | None
    last_name: str | None
    email: str | None
    phone: str | None
    avatar_url: str | None
    city: str | None
    birth_date: date | None
    hebrew_birth_date: dict[str, Any] | None
    nusach: str | None
    onboarding_completed: bool
    profile_created_at: datetime
    profile_updated_at: datetime
    membership_id: UUID | None
    community_id: UUID | None
    membership_role: str | None
    membership_status: str | None
    joined_at: datetime | None
    invited_by: UUID | None
    registrations_total: int
    registrations_upcoming: int
    registrations_past: int
    registrations_cancelled: int
    last_registration_at: datetime | None


class AdminMemberDetailResponse(AdminMemberListItemResponse):
    profile_community_id: UUID | None
    full_name: str | None
    hebrew_name: str | None
    birth_time_context: str
    tribe_status: str | None
    marital_status: str | None
    about: str | None
    profile_visibility: str
    birthday_visibility: str
    phone_visibility: str
    notification_preferences: dict[str, Any]
    membership_community_id: UUID | None
    membership_created_at: datetime | None


class AdminMemberRegistrationResponse(BaseModel):
    registration_id: UUID
    event_id: UUID
    event_title: str
    occurrence_id: UUID | None
    occurrence_title: str | None
    occurrence_starts_at: datetime | None
    occurrence_ends_at: datetime | None
    registration_status: str
    seats_count: int
    payment_status: str
    registered_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    selected_options: list[AdminRegistrationSelectedOptionResponse]


class AdminMemberProfileUpdateRequest(BaseModel):
    community_id: UUID = Field(
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    full_name: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=AliasChoices("full_name", "fullName"),
    )
    first_name: str | None = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("first_name", "firstName"),
    )
    last_name: str | None = Field(
        default=None,
        max_length=120,
        validation_alias=AliasChoices("last_name", "lastName"),
    )
    display_name: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=AliasChoices("display_name", "displayName"),
    )
    hebrew_name: str | None = Field(
        default=None,
        max_length=240,
        validation_alias=AliasChoices("hebrew_name", "hebrewName"),
    )
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    city: str | None = Field(default=None, max_length=120)
    birth_date: date | None = Field(
        default=None,
        validation_alias=AliasChoices("birth_date", "birthDate"),
    )
    hebrew_birth_date: dict[str, Any] | None = Field(
        default=None,
        validation_alias=AliasChoices("hebrew_birth_date", "hebrewBirthDate"),
    )
    birth_time_context: AdminMemberBirthTimeContext = Field(
        default="unknown",
        validation_alias=AliasChoices("birth_time_context", "birthTimeContext"),
    )
    nusach: str | None = Field(default=None, max_length=64)
    tribe_status: AdminMemberTribeStatus | None = Field(
        default=None,
        validation_alias=AliasChoices("tribe_status", "tribeStatus"),
    )
    marital_status: AdminMemberMaritalStatus | None = Field(
        default=None,
        validation_alias=AliasChoices("marital_status", "maritalStatus"),
    )
    about: str | None = Field(default=None, max_length=200)
    onboarding_completed: bool = Field(
        default=False,
        validation_alias=AliasChoices("onboarding_completed", "onboardingCompleted"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminMemberProfileUpdateResponse(BaseModel):
    user_id: UUID
    profile_community_id: UUID | None
    full_name: str | None
    first_name: str | None
    last_name: str | None
    display_name: str | None
    hebrew_name: str | None
    email: str | None
    phone: str | None
    city: str | None
    birth_date: date | None
    hebrew_birth_date: dict[str, Any] | None
    birth_time_context: str
    nusach: str | None
    tribe_status: str | None
    marital_status: str | None
    about: str | None
    onboarding_completed: bool
    profile_updated_at: datetime


class AdminMemberMembershipUpdateRequest(BaseModel):
    community_id: UUID = Field(
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    role: AdminMemberMembershipRole
    status: AdminMemberMembershipStatus

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminMemberMembershipResponse(BaseModel):
    membership_id: UUID
    community_id: UUID
    user_id: UUID
    membership_role: str
    membership_status: str
    joined_at: datetime | None
    invited_by: UUID | None
    created_at: datetime
