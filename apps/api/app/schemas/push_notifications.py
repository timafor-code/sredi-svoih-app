from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


NotificationKind = Literal["event_created", "event_updated", "event_cancelled"]


class PushNotificationEnqueueRequest(BaseModel):
    occurrence_id: UUID | None = None
    notification_kind: NotificationKind
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=2000)
    data: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("title", "body")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized


class PushNotificationJobResponse(BaseModel):
    id: UUID
    community_id: UUID | None
    event_id: UUID | None
    occurrence_id: UUID | None
    notification_kind: str
    audience: str
    status: str
    queued_at: datetime
    processed_at: datetime | None
    created_at: datetime
    delivery_count: int
    queued_delivery_count: int
    sent_delivery_count: int
    failed_delivery_count: int
    skipped_delivery_count: int
    receipt_checked_delivery_count: int

    model_config = ConfigDict(extra="forbid")
