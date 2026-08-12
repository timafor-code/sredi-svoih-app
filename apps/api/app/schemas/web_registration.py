from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator


def normalize_email(value: str) -> str:
    value = value.strip()
    if len(value) > 254 or any(ch.isspace() or unicodedata.category(ch) == "Cc" for ch in value):
        raise ValueError("invalid email")
    if value.count("@") != 1:
        raise ValueError("invalid email")
    local, domain = value.rsplit("@", 1)
    if not local or len(local) > 64 or not domain or "." not in domain:
        raise ValueError("invalid email")
    try:
        ascii_domain = domain.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("invalid email") from exc
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+", local):
        raise ValueError("invalid email")
    if any(not label or label.startswith("-") or label.endswith("-") for label in ascii_domain.split(".")):
        raise ValueError("invalid email")
    return f"{local.lower()}@{ascii_domain}"


def normalize_international_phone(value: str) -> str:
    compact = re.sub(r"[\s()\-]", "", value.strip())
    if compact.startswith("00"):
        compact = "+" + compact[2:]
    elif re.fullmatch(r"8\d{10}", compact):
        compact = "+7" + compact[1:]
    elif re.fullmatch(r"7\d{10}", compact):
        compact = "+" + compact

    if not re.fullmatch(r"\+[1-9]\d{6,14}", compact):
        raise ValueError("invalid international phone")
    return compact


def normalize_name(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if not normalized or len(normalized) > 100:
        raise ValueError("invalid name")
    if any(unicodedata.category(ch).startswith("C") for ch in normalized):
        raise ValueError("invalid name")
    return normalized


class WebOptionSelection(BaseModel):
    option_id: UUID
    quantity: int = Field(ge=1, le=1000)
    model_config = ConfigDict(extra="forbid")


class WebLegalAcceptance(BaseModel):
    document_id: UUID
    content_hash: str = Field(min_length=1, max_length=200)
    model_config = ConfigDict(extra="forbid")


class WebQuestionnaireAnswer(BaseModel):
    field_id: UUID
    value: StrictStr | StrictBool | list[StrictStr]

    model_config = ConfigDict(extra="forbid")


class WebRegistrationIntentRequest(BaseModel):
    event_id: UUID
    occurrence_id: UUID | None = None
    first_name: str
    last_name: str
    phone: str
    email: str
    seats_count: int = Field(ge=1, le=1000)
    option_selections: list[WebOptionSelection] = Field(default_factory=list, max_length=100)
    questionnaire_form_id: UUID | None = None
    answers: list[WebQuestionnaireAnswer] = Field(default_factory=list, max_length=100)
    legal_acceptances: list[WebLegalAcceptance] = Field(min_length=1, max_length=20)
    account_choice: Literal["without_password", "create_account"]
    idempotency_key: str = Field(min_length=8, max_length=512)
    model_config = ConfigDict(extra="forbid")

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        return normalize_email(value)

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        return normalize_international_phone(value)

    @field_validator("first_name", "last_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_name(value)

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str) -> str:
        if not value.strip() or any(unicodedata.category(ch).startswith("C") for ch in value):
            raise ValueError("invalid idempotency key")
        return value


class WebRegistrationIntentCreated(BaseModel):
    flow_id: str
    next_step: Literal["confirm_email", "completed"] = "confirm_email"
    expires_at: datetime


class WebRegistrationResendResult(BaseModel):
    next_step: Literal["confirm_email"] = "confirm_email"
    expires_at: datetime


class WebRegistrationConfirmRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    model_config = ConfigDict(extra="forbid")


class WebRegistrationResult(BaseModel):
    id: UUID
    event_id: UUID
    occurrence_id: UUID | None
    status: Literal["confirmed", "pending", "waitlisted", "attended"]
    seats_count: int
    payment_status: Literal[
        "not_required",
        "pending",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
        "paid",
    ]
    total_amount: int | None = Field(default=None, ge=0)
    total_currency: str | None = None

    model_config = ConfigDict(from_attributes=True)


AccountNextStep = Literal["none", "set_password", "sign_in", "request_set_password"]


class WebRegistrationConfirmResult(BaseModel):
    intent_status: Literal["confirmed"] = "confirmed"
    registration: WebRegistrationResult
    account_next_step: AccountNextStep
    set_password_code: str | None = None
    set_password_expires_at: datetime | None = None


class WebRegistrationIntentStatus(BaseModel):
    state: Literal["email_verification_required", "confirmed", "not_available"]
    expires_at: datetime | None = None
    registration: WebRegistrationResult | None = None
    account_next_step: AccountNextStep | None = None
