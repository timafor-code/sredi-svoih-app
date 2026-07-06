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


def normalize_required_secret(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")

    return normalized


def normalize_required_token(value: str) -> str:
    return normalize_required_secret(value, "refresh_token")


def normalize_auth_code(value: str) -> str:
    return normalize_required_secret(value, "code")


def normalize_invite_code(value: str) -> str:
    return normalize_required_secret(value, "invite_code")


def normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


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


class RequestPasswordResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)


class ConfirmPasswordResetRequest(BaseModel):
    code: str = Field(min_length=16, max_length=512)
    new_password: str = Field(min_length=8, max_length=1024)

    model_config = ConfigDict(extra="forbid")

    @field_validator("code")
    @classmethod
    def normalize_code_field(cls, value: str) -> str:
        return normalize_auth_code(value)


class RequestEmailVerificationRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)


class ConfirmEmailVerificationRequest(BaseModel):
    code: str = Field(min_length=16, max_length=512)

    model_config = ConfigDict(extra="forbid")

    @field_validator("code")
    @classmethod
    def normalize_code_field(cls, value: str) -> str:
        return normalize_auth_code(value)


class RequestSetPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)


class ConfirmSetPasswordRequest(BaseModel):
    code: str = Field(min_length=16, max_length=512)
    new_password: str = Field(min_length=8, max_length=1024)

    model_config = ConfigDict(extra="forbid")

    @field_validator("code")
    @classmethod
    def normalize_code_field(cls, value: str) -> str:
        return normalize_auth_code(value)


class RegisterWithInviteProfileInput(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    first_name: str | None = Field(default=None, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    full_name: str | None = Field(default=None, max_length=240)
    city: str | None = Field(default=None, max_length=120)

    model_config = ConfigDict(extra="forbid")

    @field_validator("display_name", "first_name", "last_name", "full_name", "city")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)


class RegisterWithInviteRequest(BaseModel):
    invite_code: str = Field(min_length=1, max_length=512)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=1024)
    profile: RegisterWithInviteProfileInput | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("invite_code")
    @classmethod
    def normalize_invite_code_field(cls, value: str) -> str:
        return normalize_invite_code(value)

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        return normalize_email(value)


class AcceptInviteRequest(BaseModel):
    invite_code: str = Field(min_length=1, max_length=512)

    model_config = ConfigDict(extra="forbid")

    @field_validator("invite_code")
    @classmethod
    def normalize_invite_code_field(cls, value: str) -> str:
        return normalize_invite_code(value)


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


class CommunitySummary(BaseModel):
    id: UUID
    name: str
    city: str
    slug: str | None


class RegisterResponse(BaseModel):
    user: AppUserSummary
    profile: ProfileSummary | None


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AppUserSummary


class RegisterWithInviteResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: AppUserSummary
    profile: ProfileSummary
    membership: CommunityMembershipSummary
    community: CommunitySummary


class AcceptInviteResponse(BaseModel):
    membership: CommunityMembershipSummary
    community: CommunitySummary
    already_member: bool = False


class LogoutResponse(BaseModel):
    ok: bool = True


class AuthCodeRequestResponse(BaseModel):
    ok: bool = True


class AuthCodeConfirmResponse(BaseModel):
    ok: bool = True


class MeResponse(BaseModel):
    user: AppUserSummary
    profile: ProfileSummary | None
    memberships: list[CommunityMembershipSummary]
