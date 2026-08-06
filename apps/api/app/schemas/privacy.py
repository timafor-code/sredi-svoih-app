from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

PrivacyRequestType = Literal["data_export", "deletion", "correction", "other"]
PrivacyRequestStatus = Literal["open", "reviewed", "resolved", "rejected", "closed"]
PrivacySessionScope = Literal["privacy_self_service"]
TERMINAL_PRIVACY_REQUEST_STATUSES = frozenset({"resolved", "rejected", "closed"})


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


class PrivacyAccessRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        from app.schemas.auth import normalize_email

        return normalize_email(value)


class PrivacyAccessAcceptedResponse(BaseModel):
    accepted: bool = True


class PrivacyAccessConfirmRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")

    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def normalize_email_field(cls, value: str) -> str:
        from app.schemas.auth import normalize_email

        return normalize_email(value)

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code_field(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class PrivacySessionResponse(BaseModel):
    privacy_session_token: str
    token_type: Literal["bearer"] = "bearer"
    scope: PrivacySessionScope = "privacy_self_service"
    expires_at: datetime


class PrivacyCategorySummary(BaseModel):
    code: str
    record_count: int = Field(ge=0)
    available_for_export: bool


class PrivacyExcludedCategory(BaseModel):
    code: str
    reason: str


class PrivacyDataSummaryResponse(BaseModel):
    generated_at: datetime
    categories: list[PrivacyCategorySummary]
    excluded_categories: list[PrivacyExcludedCategory]


class PrivacyDataExportRequest(BaseModel):
    format: Literal["json"]

    model_config = ConfigDict(extra="forbid")


class PrivacyDataExportResponse(BaseModel):
    export_version: Literal["privacy-self-service-v1"]
    generated_at: datetime
    included_categories: list[str]
    excluded_categories: list[PrivacyExcludedCategory]
    account: dict[str, Any]
    profile: dict[str, Any] | None
    memberships: list[dict[str, Any]]
    event_registrations: list[dict[str, Any]]
    registration_options: list[dict[str, Any]]
    legal_acceptances: list[dict[str, Any]]
    privacy_requests: list[dict[str, Any]]
    device_metadata: list[dict[str, Any]]
    synced_contacts_summary: dict[str, int]
    avatar_metadata: list[dict[str, Any]]


class AdminPrivacyRequestResponse(PrivacyRequestResponse):
    user_id: UUID | None
    resolved_by: UUID | None
    identity_verified_at: datetime | None
    processing_stopped_at: datetime | None
    execution_started_at: datetime | None
    completed_at: datetime | None
    due_at: datetime | None
    failure_code: str | None
    destruction_evidence_id: UUID | None
    cancelled_at: datetime | None


class PrivacyErasureConfirmRequest(BaseModel):
    confirmation: Literal["delete_my_data"]

    model_config = ConfigDict(extra="forbid")


class PrivacyErasureLifecycleResponse(BaseModel):
    request_id: UUID
    state: Literal["deletion_pending", "cancelled"]
    processing_stopped_at: datetime
    cancelled_at: datetime | None
    registrations_require_reregistration_after_cancel: Literal[True] = True


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
