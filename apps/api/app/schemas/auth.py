from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def normalize_email(value: str) -> str:
    normalized = value.strip().casefold()
    if not normalized:
        raise ValueError("email is required")
    if len(normalized) > 320:
        raise ValueError("email is too long")
    if "@" not in normalized:
        raise ValueError("email must contain @")

    local_part, _, domain_part = normalized.partition("@")
    if not local_part or not domain_part or "." not in domain_part:
        raise ValueError("email is invalid")

    return normalized


def normalize_required_token(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("refresh_token is required")

    return normalized


def normalize_device_name(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=1024)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)
    device_name: str | None = Field(default=None, max_length=120)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("device_name")
    @classmethod
    def normalize_device_name_field(cls, value: str | None) -> str | None:
        return normalize_device_name(value)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)

    model_config = ConfigDict(extra="forbid")

    @field_validator("refresh_token")
    @classmethod
    def normalize_refresh_token_field(cls, value: str) -> str:
        return normalize_required_token(value)


class LogoutRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=4096)

    model_config = ConfigDict(extra="forbid")

    @field_validator("refresh_token")
    @classmethod
    def normalize_refresh_token_field(cls, value: str) -> str:
        return normalize_required_token(value)


class AppUserSummary(BaseModel):
    id: UUID
    email: str | None
    phone: str | None
    status: str
    email_verified_at: datetime | None
    phone_verified_at: datetime | None
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProfileSummary(BaseModel):
    id: UUID
    user_id: UUID
    community_id: UUID | None
    display_name: str | None
    first_name: str | None
    last_name: str | None
    full_name: str | None
    avatar_url: str | None
    city: str | None
    onboarding_completed: bool
    created_at: datetime
    updated_at: datetime


class CommunityMembershipSummary(BaseModel):
    id: UUID
    community_id: UUID
    role: str
    status: str
    joined_at: datetime | None
    created_at: datetime


class RegisterResponse(BaseModel):
    user: AppUserSummary
    profile: ProfileSummary | None


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AppUserSummary


class LogoutResponse(BaseModel):
    ok: bool = True


class MeResponse(BaseModel):
    user: AppUserSummary
    profile: ProfileSummary | None
    memberships: list[CommunityMembershipSummary]
