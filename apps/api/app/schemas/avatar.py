from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

ALLOWED_AVATAR_CONTENT_TYPES = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
    },
)


def normalize_avatar_content_type(value: str) -> str:
    normalized = value.strip().lower()
    if normalized == "image/jpg":
        normalized = "image/jpeg"
    return normalized


class AvatarUploadUrlRequest(BaseModel):
    content_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(gt=0)

    model_config = ConfigDict(extra="forbid")

    @field_validator("content_type")
    @classmethod
    def normalize_content_type(cls, value: str) -> str:
        return normalize_avatar_content_type(value)


class AvatarConfirmRequest(BaseModel):
    avatar_id: UUID

    model_config = ConfigDict(extra="forbid")


class AvatarUploadUrlResponse(BaseModel):
    avatar_id: UUID
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]
    expires_at: datetime
    max_size_bytes: int


class AvatarResponse(BaseModel):
    avatar_id: UUID
    content_type: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime
    read_url: str
    read_url_expires_at: datetime


class AvatarReadUrlResponse(BaseModel):
    avatar_id: UUID
    read_url: str
    expires_at: datetime


class AvatarDeleteResponse(BaseModel):
    avatar_id: UUID | None
    deleted: bool
