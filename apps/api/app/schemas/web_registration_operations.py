from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

IdentityConflictStatus = Literal["open", "resolved"]


class AdminWebRegistrationOperationsSummaryResponse(BaseModel):
    active_email_verification_intents: int
    open_identity_conflicts: int
    open_privacy_requests: int
    overdue_privacy_requests: int


class AdminWebRegistrationConflictResponse(BaseModel):
    id: UUID
    registration_intent_id: UUID
    category: str
    status: IdentityConflictStatus
    email_user_id: UUID | None
    phone_user_id: UUID | None
    event_id: UUID
    occurrence_id: UUID | None
    intent_status: str
    created_at: datetime
    resolved_at: datetime | None


class AdminWebRegistrationConflictUpdateRequest(BaseModel):
    status: IdentityConflictStatus

    model_config = ConfigDict(extra="forbid")
