from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

QuestionnaireFieldType = Literal[
    "short_text",
    "long_text",
    "single_select",
    "multi_select",
    "boolean",
]
QuestionnaireDataCategory = Literal["ordinary"]
QuestionnaireStatus = Literal["draft", "published", "retired"]

_TEXT_VALIDATION_KEYS = frozenset({"min_length", "max_length"})
_MULTI_SELECT_VALIDATION_KEYS = frozenset(
    {"min_selections", "max_selections"},
)
_FIELD_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_OPTION_VALUE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def _validate_plain_text(value: str, *, field_name: str, max_length: int) -> str:
    if any(unicodedata.category(ch).startswith("C") for ch in value):
        raise ValueError(f"{field_name} contains control characters")
    normalized = " ".join(value.strip().split())
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} is too long")
    if "<" in normalized or ">" in normalized:
        raise ValueError(f"{field_name} must be plain text")
    return normalized


class QuestionnaireOption(BaseModel):
    value: str
    label: str

    model_config = ConfigDict(extra="forbid")

    @field_validator("value")
    @classmethod
    def validate_value(cls, value: str) -> str:
        if not _OPTION_VALUE_PATTERN.fullmatch(value):
            raise ValueError("option value must be a stable technical identifier")
        return value

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        return _validate_plain_text(value, field_name="option label", max_length=200)


class AdminEventQuestionnaireField(BaseModel):
    field_key: str
    field_type: QuestionnaireFieldType
    label: str
    required: bool
    purpose: str
    retention_days: int = Field(gt=0, le=36500)
    options: list[QuestionnaireOption] = Field(default_factory=list, max_length=100)
    validation: dict[str, int] = Field(default_factory=dict)
    data_category: QuestionnaireDataCategory
    sort_order: int = Field(ge=0, le=100000)

    model_config = ConfigDict(extra="forbid")

    @field_validator("field_key")
    @classmethod
    def validate_field_key(cls, value: str) -> str:
        if not _FIELD_KEY_PATTERN.fullmatch(value):
            raise ValueError("field_key must be a lowercase technical identifier")
        return value

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        return _validate_plain_text(value, field_name="label", max_length=300)

    @field_validator("purpose")
    @classmethod
    def validate_purpose(cls, value: str) -> str:
        return _validate_plain_text(value, field_name="purpose", max_length=1000)

    @model_validator(mode="after")
    def validate_type_configuration(self) -> AdminEventQuestionnaireField:
        option_values = [option.value for option in self.options]
        if len(option_values) != len(set(option_values)):
            raise ValueError("option values must be unique")

        if self.field_type in {"single_select", "multi_select"}:
            if not self.options:
                raise ValueError("select fields require options")
        elif self.options:
            raise ValueError("options are not supported for this field type")

        if self.field_type in {"short_text", "long_text"}:
            allowed_keys = _TEXT_VALIDATION_KEYS
            lower_key = "min_length"
            upper_key = "max_length"
        elif self.field_type == "multi_select":
            allowed_keys = _MULTI_SELECT_VALIDATION_KEYS
            lower_key = "min_selections"
            upper_key = "max_selections"
        else:
            allowed_keys = frozenset()
            lower_key = None
            upper_key = None

        unsupported = set(self.validation) - allowed_keys
        if unsupported:
            raise ValueError("unsupported validation key")
        if any(
            type(value) is not int or value < 0 or value > 10000
            for value in self.validation.values()
        ):
            raise ValueError("validation values must be bounded non-negative integers")
        if lower_key and upper_key:
            lower = self.validation.get(lower_key)
            upper = self.validation.get(upper_key)
            if lower is not None and upper is not None and upper < lower:
                raise ValueError(f"{upper_key} must be greater than or equal to {lower_key}")
        if self.field_type == "multi_select":
            for key in ("min_selections", "max_selections"):
                value = self.validation.get(key)
                if value is not None and value > len(self.options):
                    raise ValueError(f"{key} must not exceed the option count")
        return self


class AdminEventQuestionnaireDraftRequest(BaseModel):
    purpose: str
    fields: list[AdminEventQuestionnaireField] = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")

    @field_validator("purpose")
    @classmethod
    def validate_purpose(cls, value: str) -> str:
        return _validate_plain_text(value, field_name="purpose", max_length=1000)

    @model_validator(mode="after")
    def validate_unique_fields(self) -> AdminEventQuestionnaireDraftRequest:
        field_keys = [field.field_key for field in self.fields]
        if len(field_keys) != len(set(field_keys)):
            raise ValueError("field_key must be unique inside a questionnaire")
        return self


class AdminEventQuestionnaireFieldResponse(AdminEventQuestionnaireField):
    id: UUID


class AdminEventQuestionnaireFormResponse(BaseModel):
    id: UUID
    event_id: UUID
    channel: Literal["web"]
    version: int
    purpose: str
    status: QuestionnaireStatus
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    fields: list[AdminEventQuestionnaireFieldResponse]


class AdminEventQuestionnaireResponse(BaseModel):
    event_id: UUID
    channel: Literal["web"] = "web"
    draft: AdminEventQuestionnaireFormResponse | None
    published: AdminEventQuestionnaireFormResponse | None


class WebEventQuestionnaireFieldResponse(BaseModel):
    id: UUID
    field_key: str
    field_type: QuestionnaireFieldType
    label: str
    required: bool
    purpose: str
    retention_days: int
    options: list[QuestionnaireOption]
    validation: dict[str, int]
    sort_order: int
