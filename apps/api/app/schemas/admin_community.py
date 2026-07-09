from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


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


class AdminCommunityResponse(BaseModel):
    id: UUID
    name: str
    timezone: str | None
    website_url: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminCommunityLocationCreateRequest(BaseModel):
    community_id: UUID = Field(
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    title: str = Field(min_length=1, max_length=240)
    address: str = Field(min_length=1, max_length=500)
    is_default: bool = Field(
        default=False,
        validation_alias=AliasChoices("is_default", "isDefault"),
    )
    is_active: bool = Field(
        default=True,
        validation_alias=AliasChoices("is_active", "isActive"),
    )
    sort_order: int = Field(
        default=100,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("title", "address")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)


class AdminCommunityLocationUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    address: str | None = Field(default=None, max_length=500)
    is_default: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_default", "isDefault"),
    )
    is_active: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("is_active", "isActive"),
    )
    sort_order: int | None = Field(
        default=None,
        validation_alias=AliasChoices("sort_order", "sortOrder"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("title", "address")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminCommunityLocationResponse(BaseModel):
    id: UUID
    community_id: UUID
    title: str
    address: str
    is_default: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
