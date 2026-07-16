from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


ProfileBirthTimeContext = Literal["before_sunset", "after_sunset", "unknown"]
ProfileTribeStatus = Literal["kohen", "levi", "israel"]
ProfileMaritalStatus = Literal[
    "single",
    "married",
    "divorced",
    "widowed",
    "other",
]
ProfileVisibility = Literal["rabbi_only", "members", "public"]

_OPTIONAL_TEXT_FIELDS = (
    "display_name",
    "first_name",
    "last_name",
    "full_name",
    "hebrew_name",
    "email",
    "phone",
    "city",
    "nusach",
    "about",
)


def _normalize_optional_text(value: object) -> object:
    if not isinstance(value, str):
        return value

    normalized = value.strip()
    return normalized or None


class CurrentUserProfileResponse(BaseModel):
    id: UUID
    user_id: UUID
    community_id: UUID | None
    display_name: str | None
    first_name: str | None
    last_name: str | None
    full_name: str | None
    hebrew_name: str | None
    email: str | None
    phone: str | None
    avatar_id: UUID | None
    avatar_url: str | None
    birth_date: date | None
    hebrew_birth_date: dict[str, Any] | None
    birth_time_context: ProfileBirthTimeContext
    nusach: str | None
    city: str | None
    tribe_status: ProfileTribeStatus | None
    marital_status: ProfileMaritalStatus | None
    about: str | None
    profile_visibility: ProfileVisibility
    birthday_visibility: ProfileVisibility
    phone_visibility: ProfileVisibility
    notification_preferences: dict[str, Any]
    onboarding_completed: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CurrentUserProfileUpdateRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=240)
    first_name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    full_name: str | None = Field(default=None, max_length=240)
    hebrew_name: str | None = Field(default=None, max_length=240)
    birth_date: date | None = None
    hebrew_birth_date: dict[str, Any] | None = None
    birth_time_context: ProfileBirthTimeContext = "unknown"
    nusach: str | None = Field(default=None, max_length=64)
    tribe_status: ProfileTribeStatus | None = None
    marital_status: ProfileMaritalStatus | None = None
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    city: str | None = Field(default=None, max_length=120)
    about: str | None = Field(default=None, max_length=200)
    profile_visibility: ProfileVisibility = "members"
    birthday_visibility: ProfileVisibility = "members"
    phone_visibility: ProfileVisibility = "rabbi_only"
    notification_preferences: dict[str, Any] = Field(default_factory=dict)
    onboarding_completed: bool = False

    model_config = ConfigDict(extra="forbid")

    @field_validator(*_OPTIONAL_TEXT_FIELDS, mode="before")
    @classmethod
    def normalize_optional_text_fields(
        cls,
        value: object,
        info: ValidationInfo,
    ) -> object:
        normalized = _normalize_optional_text(value)
        if normalized is None:
            return None
        if info.field_name == "email" and isinstance(normalized, str):
            return normalized.casefold()
        return normalized
