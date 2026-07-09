from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

PrivacyRequestType = Literal["data_export", "deletion", "correction", "other"]
PrivacyRequestStatus = Literal["open", "reviewed", "resolved", "rejected", "closed"]


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class PrivacyRequestCreateRequest(BaseModel):
    request_type: PrivacyRequestType = Field(
        validation_alias=AliasChoices("request_type", "requestType"),
    )
    community_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("community_id", "communityId"),
    )
    message: str | None = Field(default=None, max_length=4000)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("message")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)


class PrivacyRequestResponse(BaseModel):
    id: UUID
    community_id: UUID | None
    request_type: str
    message: str | None
    status: str
    resolution_note: str | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPrivacyRequestResponse(PrivacyRequestResponse):
    user_id: UUID
    resolved_by: UUID | None


class AdminPrivacyRequestUpdateRequest(BaseModel):
    status: PrivacyRequestStatus | None = None
    resolution_note: str | None = Field(
        default=None,
        max_length=4000,
        validation_alias=AliasChoices("resolution_note", "resolutionNote"),
    )

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("resolution_note")
    @classmethod
    def normalize_optional_text_field(cls, value: str | None) -> str | None:
        return _normalize_optional_text(value)
