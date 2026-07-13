from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SHA256_HEX_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_SYNCED_CONTACT_NAME_MAX_LENGTH = 200
_SYNCED_CONTACT_HASH_LENGTH = 64


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class CommunityContactResponse(BaseModel):
    id: UUID
    user_id: UUID
    community_id: UUID
    display_name: str
    first_name: str | None
    last_name: str | None
    avatar_url: str | None
    avatar_id: UUID | None
    phone: str | None
    email: str | None
    city: str | None
    hebrew_name: str | None
    birth_date: date | None
    hebrew_birth_date: dict[str, Any] | None
    role: str | None
    membership_status: str | None
    joined_at: datetime | None
    show_in_community_directory: bool
    share_phone: bool
    share_email: bool
    share_birth_date: bool
    share_hebrew_birth_date: bool
    share_city: bool
    share_hebrew_name: bool

    model_config = ConfigDict(from_attributes=True)


class ProfileContactVisibilityResponse(BaseModel):
    user_id: UUID
    show_in_community_directory: bool
    share_phone: bool
    share_email: bool
    share_birth_date: bool
    share_hebrew_birth_date: bool
    share_city: bool
    share_hebrew_name: bool
    birthday_reminders_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProfileContactVisibilityUpdateRequest(BaseModel):
    show_in_community_directory: StrictBool
    share_phone: StrictBool
    share_email: StrictBool
    share_birth_date: StrictBool
    share_hebrew_birth_date: StrictBool
    share_city: StrictBool
    share_hebrew_name: StrictBool
    birthday_reminders_enabled: StrictBool

    model_config = ConfigDict(extra="forbid")


class SyncedContactCreateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=_SYNCED_CONTACT_NAME_MAX_LENGTH)
    phone_hash: str | None = Field(
        default=None,
        min_length=_SYNCED_CONTACT_HASH_LENGTH,
        max_length=_SYNCED_CONTACT_HASH_LENGTH,
    )
    email_hash: str | None = Field(
        default=None,
        min_length=_SYNCED_CONTACT_HASH_LENGTH,
        max_length=_SYNCED_CONTACT_HASH_LENGTH,
    )
    birthday: date | None = None
    consented_at: datetime

    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)

    @field_validator("phone_hash", "email_hash", mode="before")
    @classmethod
    def normalize_sha256_hash(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("must be a SHA-256 hex digest")

        normalized = value.strip().lower()
        if not _SHA256_HEX_PATTERN.fullmatch(normalized):
            raise ValueError("must be exactly 64 hexadecimal characters")
        return normalized

    @field_validator("birthday", mode="before")
    @classmethod
    def validate_birthday(cls, value: object) -> object:
        if value is None:
            return value
        if not isinstance(value, str) or not _DATE_PATTERN.fullmatch(value):
            raise ValueError("must use YYYY-MM-DD format")
        return value

    @field_validator("consented_at", mode="before")
    @classmethod
    def validate_consented_at(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("must be an ISO 8601 timestamp with timezone")

        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("must be an ISO 8601 timestamp with timezone") from exc

        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("must include timezone information")
        return value

    @model_validator(mode="after")
    def require_meaningful_contact_data(self) -> SyncedContactCreateRequest:
        if self.phone_hash is None and self.email_hash is None and self.birthday is None:
            raise ValueError("at least one of phone_hash, email_hash, or birthday is required")
        return self


class SyncedContactResponse(BaseModel):
    id: UUID
    user_id: UUID
    name: str | None
    phone_hash: str | None
    email_hash: str | None
    birthday: date | None
    consented_at: datetime
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SyncedContactDeleteResponse(BaseModel):
    id: UUID
    deleted: bool
