from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class RememberedParticipantIdentity(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: str


class WebParticipantSessionResponse(BaseModel):
    state: Literal["anonymous", "remembered"]
    participant: RememberedParticipantIdentity | None = None


class WebParticipantSessionIssued(BaseModel):
    state: Literal["remembered"] = "remembered"
