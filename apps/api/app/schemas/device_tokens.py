from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class DeviceTokenRegisterRequest(BaseModel):
    expo_push_token: str = Field(
        min_length=1,
        max_length=400,
        validation_alias=AliasChoices("expo_push_token", "expoPushToken"),
    )
    platform: Literal["ios", "android", "web", "unknown"] = "unknown"
    device_id: str | None = Field(
        default=None,
        max_length=200,
        validation_alias=AliasChoices("device_id", "deviceId"),
    )
    app_version: str | None = Field(
        default=None,
        max_length=80,
        validation_alias=AliasChoices("app_version", "appVersion"),
    )
    build_version: str | None = Field(
        default=None,
        max_length=80,
        validation_alias=AliasChoices("build_version", "buildVersion"),
    )
    environment: Literal["development", "preview", "production", "unknown"] = (
        "development"
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("expo_push_token")
    @classmethod
    def normalize_expo_push_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized

    @field_validator("device_id", "app_version", "build_version")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class DeviceTokenResponse(BaseModel):
    id: UUID
    platform: str
    push_provider: str
    device_id: str | None
    app_version: str | None
    build_version: str | None
    environment: str
    is_active: bool
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
