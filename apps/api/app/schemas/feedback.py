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


def _normalize_required_text(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("must not be empty")
    return normalized


class AdminFeedbackCreateRequest(BaseModel):
    community_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    section: str = Field(min_length=1, max_length=80)
    entity_type: str | None = Field(
        default=None,
        max_length=80,
        validation_alias=AliasChoices("entity_type", "entityType"),
    )
    entity_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("entity_id", "entityId"),
    )
    severity: Literal["note", "issue", "blocker", "idea"] = "note"
    message: str = Field(min_length=1, max_length=4000)
    user_agent: str | None = Field(
        default=None,
        max_length=500,
        validation_alias=AliasChoices("user_agent", "userAgent"),
    )
    url: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("section", "message")
    @classmethod
    def normalize_required_text_field(cls, value: str) -> str:
        return _normalize_required_text(value)

    @field_validator("entity_type", "user_agent", "url")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class AdminFeedbackResponse(BaseModel):
    id: UUID
    community_id: UUID
    user_id: UUID
    section: str
    entity_type: str | None
    entity_id: UUID | None
    severity: str
    message: str
    status: str
    user_agent: str | None
    url: str | None
    resolved_at: datetime | None
    resolved_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminFeedbackListResponse(BaseModel):
    items: list[AdminFeedbackResponse]
    total_count: int
    limit: int
    offset: int


class AdminFeedbackStatusUpdateRequest(BaseModel):
    status: Literal["open", "reviewed", "resolved", "closed"]

    model_config = ConfigDict(extra="forbid")
