from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
from typing import Any
from uuid import UUID

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings, get_settings

_AVATAR_KEY_PREFIX = "avatars"
_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound"})


class AvatarStorageError(Exception):
    """Base class for safe avatar-storage failures."""


class AvatarStorageUnavailableError(AvatarStorageError):
    """Storage is disabled or missing required backend-only configuration."""


class AvatarObjectNotFoundError(AvatarStorageError):
    """The expected avatar object does not exist in private storage."""


class AvatarStorageOperationError(AvatarStorageError):
    """A storage operation failed without exposing provider details."""


@dataclass(frozen=True)
class PresignedAvatarUrl:
    url: str
    expires_at: datetime
    headers: dict[str, str]


@dataclass(frozen=True)
class AvatarObjectMetadata:
    content_type: str | None
    content_length: int | None
    etag: str | None


class S3AvatarStorage:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._internal_client: Any | None = None
        self._presign_client: Any | None = None

    def avatar_object_key(self, *, user_id: UUID, avatar_id: UUID) -> str:
        message = f"{user_id}:{avatar_id}".encode("utf-8")
        digest = hashlib.sha256(message).hexdigest()
        return f"{_AVATAR_KEY_PREFIX}/{avatar_id.hex[:2]}/{avatar_id.hex}/{digest[:32]}"

    async def presign_avatar_upload(
        self,
        *,
        object_key: str,
        content_type: str,
    ) -> PresignedAvatarUrl:
        return await asyncio.to_thread(
            self._presign_avatar_upload_sync,
            object_key=object_key,
            content_type=content_type,
        )

    async def head_avatar(
        self,
        *,
        object_key: str,
    ) -> AvatarObjectMetadata:
        return await asyncio.to_thread(
            self._head_avatar_sync,
            object_key=object_key,
        )

    async def presign_avatar_read(
        self,
        *,
        object_key: str,
    ) -> PresignedAvatarUrl:
        return await asyncio.to_thread(
            self._presign_avatar_read_sync,
            object_key=object_key,
        )

    async def delete_avatar(
        self,
        *,
        object_key: str,
    ) -> None:
        await asyncio.to_thread(
            self._delete_avatar_sync,
            object_key=object_key,
        )

    def _presign_avatar_upload_sync(
        self,
        *,
        object_key: str,
        content_type: str,
    ) -> PresignedAvatarUrl:
        settings = self._require_settings(require_public_endpoint=True)
        expires_in = settings.api_avatar_upload_url_ttl_seconds
        try:
            url = self._presign_s3_client().generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": settings.api_object_storage_bucket,
                    "Key": object_key,
                    "ContentType": content_type,
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT",
            )
        except (BotoCoreError, ClientError) as exc:
            raise AvatarStorageOperationError("avatar upload URL unavailable") from exc

        return PresignedAvatarUrl(
            url=url,
            expires_at=_expires_at(expires_in),
            headers={"Content-Type": content_type},
        )

    def _head_avatar_sync(
        self,
        *,
        object_key: str,
    ) -> AvatarObjectMetadata:
        settings = self._require_settings()
        try:
            response = self._internal_s3_client().head_object(
                Bucket=settings.api_object_storage_bucket,
                Key=object_key,
            )
        except ClientError as exc:
            if _is_not_found(exc):
                raise AvatarObjectNotFoundError("avatar object not found") from exc
            raise AvatarStorageOperationError("avatar object metadata unavailable") from exc
        except BotoCoreError as exc:
            raise AvatarStorageOperationError("avatar object metadata unavailable") from exc

        content_length = response.get("ContentLength")
        return AvatarObjectMetadata(
            content_type=response.get("ContentType"),
            content_length=content_length if isinstance(content_length, int) else None,
            etag=_normalize_etag(response.get("ETag")),
        )

    def _presign_avatar_read_sync(
        self,
        *,
        object_key: str,
    ) -> PresignedAvatarUrl:
        settings = self._require_settings(require_public_endpoint=True)
        expires_in = settings.api_avatar_read_url_ttl_seconds
        try:
            url = self._presign_s3_client().generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": settings.api_object_storage_bucket,
                    "Key": object_key,
                },
                ExpiresIn=expires_in,
                HttpMethod="GET",
            )
        except (BotoCoreError, ClientError) as exc:
            raise AvatarStorageOperationError("avatar read URL unavailable") from exc

        return PresignedAvatarUrl(url=url, expires_at=_expires_at(expires_in), headers={})

    def _delete_avatar_sync(
        self,
        *,
        object_key: str,
    ) -> None:
        settings = self._require_settings()
        try:
            self._internal_s3_client().delete_object(
                Bucket=settings.api_object_storage_bucket,
                Key=object_key,
            )
        except (BotoCoreError, ClientError) as exc:
            raise AvatarStorageOperationError("avatar object deletion unavailable") from exc

    def _internal_s3_client(self) -> Any:
        settings = self._require_settings()
        if self._internal_client is None:
            self._internal_client = self._build_s3_client(
                endpoint_url=settings.api_object_storage_endpoint_url,
            )
        return self._internal_client

    def _presign_s3_client(self) -> Any:
        settings = self._require_settings(require_public_endpoint=True)
        if self._presign_client is None:
            self._presign_client = self._build_s3_client(
                endpoint_url=settings.api_object_storage_public_endpoint_url,
            )
        return self._presign_client

    def _build_s3_client(self, *, endpoint_url: str) -> Any:
        settings = self._settings
        addressing_style = "path" if settings.api_object_storage_path_style else "auto"
        return boto3.session.Session().client(
            "s3",
            endpoint_url=endpoint_url.strip(),
            region_name=settings.api_object_storage_region,
            aws_access_key_id=settings.api_object_storage_access_key_id,
            aws_secret_access_key=settings.api_object_storage_secret_access_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": addressing_style},
            ),
        )

    def _require_settings(self, *, require_public_endpoint: bool = False) -> Settings:
        settings = self._settings
        if not settings.api_object_storage_enabled:
            raise AvatarStorageUnavailableError("avatar storage disabled")
        if (
            not settings.api_object_storage_endpoint_url.strip()
            or not settings.api_object_storage_region.strip()
            or not settings.api_object_storage_bucket.strip()
            or not settings.api_object_storage_access_key_id.strip()
            or not settings.api_object_storage_secret_access_key.strip()
        ):
            raise AvatarStorageUnavailableError("avatar storage not configured")
        if (
            require_public_endpoint
            and not settings.api_object_storage_public_endpoint_url.strip()
        ):
            raise AvatarStorageUnavailableError("avatar storage public endpoint not configured")
        return settings


def get_avatar_storage() -> S3AvatarStorage:
    return S3AvatarStorage()


def _expires_at(ttl_seconds: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=ttl_seconds)


def _normalize_etag(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().strip('"')
    return normalized or None


def _is_not_found(exc: ClientError) -> bool:
    response = exc.response
    error = response.get("Error", {})
    response_metadata = response.get("ResponseMetadata", {})
    return (
        str(error.get("Code")) in _NOT_FOUND_CODES
        or response_metadata.get("HTTPStatusCode") == 404
    )
