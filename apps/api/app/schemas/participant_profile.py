from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.web_registration import WebLegalAcceptance

LineageValue = Literal[
    "maternal_grandmother",
    "maternal_grandfather",
    "paternal_grandmother",
    "paternal_grandfather",
    "father",
    "mother",
    "giyur",
    "unknown",
]


class ParticipantLineageDeclarationRequest(BaseModel):
    values: list[LineageValue] = Field(min_length=1, max_length=8)
    legal_acceptance: WebLegalAcceptance

    model_config = ConfigDict(extra="forbid")

    @field_validator("values")
    @classmethod
    def validate_values(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("duplicate lineage values")
        if "unknown" in value and len(value) > 1:
            raise ValueError("unknown cannot be combined with other values")
        return value


class ParticipantLineageDeclarationResponse(BaseModel):
    state: Literal["none", "declared"]
    values: list[LineageValue] = Field(default_factory=list)
    declared_at: datetime | None = None
    updated_at: datetime | None = None
