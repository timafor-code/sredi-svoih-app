from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

AdminInviteRole = Literal["member", "event_manager", "admin", "rabbi"]
AdminInviteStatus = Literal["active", "used", "expired", "revoked"]


class AdminInviteCreateRequest(BaseModel):
    community_id: UUID = Field(
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    role: AdminInviteRole = "member"
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    max_uses: int = Field(
        default=1,
        ge=1,
        le=1000,
        validation_alias=AliasChoices("max_uses", "maxUses"),
    )
    expires_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("expires_at", "expiresAt"),
    )

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            return normalized or "member"
        return value

    @field_validator("email", "phone", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @field_validator("expires_at")
    @classmethod
    def validate_expires_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expires_at must be an ISO 8601 datetime with timezone")
        if value <= datetime.now(UTC):
            raise ValueError("expires_at must be in the future")
        return value

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AdminInviteResponse(BaseModel):
    invite_id: UUID
    community_id: UUID
    role: AdminInviteRole
    email: str | None
    phone: str | None
    max_uses: int
    used_count: int
    expires_at: datetime | None
    status: AdminInviteStatus
    created_by: UUID | None
    accepted_by: UUID | None
    accepted_at: datetime | None
    created_at: datetime


class AdminInviteCreateResponse(AdminInviteResponse):
    code: str
