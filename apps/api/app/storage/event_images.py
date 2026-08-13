from __future__ import annotations

import asyncio
from dataclasses import dataclass
from ipaddress import ip_address
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings, get_settings
from app.storage.s3 import build_s3_client

_EVENT_IMAGE_CONTENT_TYPE = "image/webp"


class EventImageStorageError(Exception):
    """Base class for safe internal event-image storage failures."""


class EventImageStorageUnavailableError(EventImageStorageError):
    """Event-image storage is disabled or lacks backend configuration."""


class EventImageStorageOperationError(EventImageStorageError):
    """A provider operation failed without exposing provider details."""


@dataclass(frozen=True)
class StoredEventImage:
    etag: str | None


def build_event_image_object_key(
    *,
    community_id: UUID,
    event_id: UUID,
    object_id: UUID | None = None,
) -> str:
    opaque_id = object_id or uuid4()
    return (
        f"communities/{community_id}/events/{event_id}/"
        f"{opaque_id}.webp"
    )


def build_event_image_public_url(
    *,
    public_base_url: str,
    object_key: str,
    version_token: UUID,
) -> str:
    base_url = _validated_public_base_url(public_base_url)
    safe_key = _validated_object_key(object_key)
    parsed = urlsplit(base_url)
    path = f"{parsed.path.rstrip('/')}/{quote(safe_key, safe='/')}"
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            path,
            urlencode({"v": str(version_token)}),
            "",
        ),
    )


class S3EventImageStorage:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._client: Any | None = None

    async def put_normalized_image(
        self,
        *,
        object_key: str,
        content: bytes,
    ) -> StoredEventImage:
        return await asyncio.to_thread(
            self._put_normalized_image_sync,
            object_key=object_key,
            content=content,
        )

    async def delete_image(self, *, object_key: str) -> None:
        await asyncio.to_thread(self._delete_image_sync, object_key=object_key)

    def public_url(self, *, object_key: str, version_token: UUID) -> str:
        settings = self._require_settings(require_public_base_url=True)
        return build_event_image_public_url(
            public_base_url=settings.api_event_image_public_base_url,
            object_key=object_key,
            version_token=version_token,
        )

    def _put_normalized_image_sync(
        self,
        *,
        object_key: str,
        content: bytes,
    ) -> StoredEventImage:
        settings = self._require_settings()
        safe_key = _validated_object_key(object_key)
        if not content:
            raise EventImageStorageOperationError("event image content is empty")
        try:
            response = self._s3_client().put_object(
                Bucket=settings.api_object_storage_event_images_bucket,
                Key=safe_key,
                Body=content,
                ContentLength=len(content),
                ContentType=_EVENT_IMAGE_CONTENT_TYPE,
                CacheControl="public, max-age=31536000, immutable",
            )
        except (BotoCoreError, ClientError) as exc:
            raise EventImageStorageOperationError(
                "event image storage operation unavailable",
            ) from exc

        return StoredEventImage(etag=_normalize_etag(response.get("ETag")))

    def _delete_image_sync(self, *, object_key: str) -> None:
        settings = self._require_settings()
        safe_key = _validated_object_key(object_key)
        try:
            self._s3_client().delete_object(
                Bucket=settings.api_object_storage_event_images_bucket,
                Key=safe_key,
            )
        except (BotoCoreError, ClientError) as exc:
            raise EventImageStorageOperationError(
                "event image storage operation unavailable",
            ) from exc

    def _s3_client(self) -> Any:
        settings = self._require_settings()
        if self._client is None:
            self._client = build_s3_client(
                settings=settings,
                endpoint_url=settings.api_object_storage_endpoint_url,
            )
        return self._client

    def _require_settings(
        self,
        *,
        require_public_base_url: bool = False,
    ) -> Settings:
        settings = self._settings
        if not settings.api_object_storage_enabled:
            raise EventImageStorageUnavailableError("event image storage disabled")
        if (
            not settings.api_object_storage_endpoint_url.strip()
            or not settings.api_object_storage_region.strip()
            or not settings.api_object_storage_event_images_bucket.strip()
            or not settings.api_object_storage_access_key_id.strip()
            or not settings.api_object_storage_secret_access_key.strip()
        ):
            raise EventImageStorageUnavailableError(
                "event image storage not configured",
            )
        if require_public_base_url and not settings.api_event_image_public_base_url:
            raise EventImageStorageUnavailableError(
                "event image public base URL not configured",
            )
        return settings


def get_event_image_storage() -> S3EventImageStorage:
    return S3EventImageStorage()


def _validated_object_key(object_key: str) -> str:
    if (
        not object_key
        or object_key.startswith("/")
        or object_key.endswith("/")
        or "\\" in object_key
    ):
        raise EventImageStorageOperationError("invalid event image object key")
    segments = object_key.split("/")
    if any(not segment or segment in {".", ".."} for segment in segments):
        raise EventImageStorageOperationError("invalid event image object key")
    allowed = frozenset(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._/",
    )
    if any(character not in allowed for character in object_key):
        raise EventImageStorageOperationError("invalid event image object key")
    return object_key


def _validated_public_base_url(public_base_url: str) -> str:
    parsed = urlsplit(public_base_url.strip())
    if parsed.scheme not in {"http", "https"} or parsed.hostname is None:
        raise EventImageStorageOperationError("invalid event image public base URL")
    if parsed.username is not None or parsed.password is not None:
        raise EventImageStorageOperationError("invalid event image public base URL")
    if parsed.query or parsed.fragment:
        raise EventImageStorageOperationError("invalid event image public base URL")
    if any(segment in {".", ".."} for segment in parsed.path.split("/")):
        raise EventImageStorageOperationError("invalid event image public base URL")

    hostname = parsed.hostname.lower()
    address = None
    try:
        address = ip_address(hostname)
    except ValueError:
        pass
    is_loopback = hostname == "localhost" or bool(address and address.is_loopback)
    if parsed.scheme == "http" and not is_loopback:
        raise EventImageStorageOperationError("invalid event image public base URL")
    if address is not None and not address.is_global and not address.is_loopback:
        raise EventImageStorageOperationError("invalid event image public base URL")
    if address is None and (
        hostname in {"api-object-storage", "api_object_storage", "minio"}
        or hostname.endswith((".internal", ".local"))
        or ("." not in hostname and hostname != "localhost")
    ):
        raise EventImageStorageOperationError("invalid event image public base URL")

    try:
        parsed.port
    except ValueError as exc:
        raise EventImageStorageOperationError(
            "invalid event image public base URL",
        ) from exc

    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc,
            parsed.path.rstrip("/"),
            "",
            "",
        ),
    )


def _normalize_etag(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().strip('"')
    return normalized or None
