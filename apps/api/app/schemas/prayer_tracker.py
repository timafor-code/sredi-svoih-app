from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

PrayerActivityType = Literal[
    "shacharit",
    "mincha",
    "maariv",
    "shema_morning",
    "shema_evening",
    "omer_count",
]

PRAYER_ACTIVITY_TYPES: tuple[PrayerActivityType, ...] = (
    "shacharit",
    "mincha",
    "maariv",
    "shema_morning",
    "shema_evening",
    "omer_count",
)

DEFAULT_TIMEZONE = "Europe/Moscow"
_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class PrayerLogCreateRequest(BaseModel):
    activity_type: PrayerActivityType
    activity_date: date | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    timezone: str = DEFAULT_TIMEZONE
    city: str | None = None
    hebrew_date: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")

    @field_validator("activity_date", mode="before")
    @classmethod
    def validate_explicit_activity_date(cls, value: object) -> object:
        if value is None:
            return value
        if not isinstance(value, str) or not _DATE_PATTERN.fullmatch(value):
            raise ValueError("must use YYYY-MM-DD format")
        return value

    @field_validator("started_at", "completed_at", mode="before")
    @classmethod
    def validate_timezone_aware_timestamp(cls, value: object) -> object:
        if value is None:
            return value
        if not isinstance(value, str):
            raise ValueError("must be an ISO 8601 timestamp with timezone")

        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("must be an ISO 8601 timestamp with timezone") from exc

        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("must include timezone information")
        return value

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")

        try:
            ZoneInfo(normalized)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("must be a known IANA timezone") from exc
        return normalized


class PrayerLogResponse(BaseModel):
    id: UUID
    user_id: UUID
    activity_type: PrayerActivityType
    activity_date: date
    started_at: datetime | None
    completed_at: datetime | None
    timezone: str
    city: str | None
    hebrew_date: dict[str, Any]
    metadata: dict[str, Any] = Field(validation_alias="metadata_json")
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PrayerLogDeleteResponse(BaseModel):
    id: UUID
    deleted: bool


class PrayerSummaryResponse(BaseModel):
    from_date: date | None
    to_date: date | None
    total_logs: int
    active_days: int
    counts_by_activity_type: dict[PrayerActivityType, int]
    first_activity_date: date | None
    last_activity_date: date | None
