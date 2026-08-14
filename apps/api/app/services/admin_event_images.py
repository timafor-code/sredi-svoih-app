from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
from io import BytesIO
from typing import BinaryIO
from urllib.parse import unquote, urlsplit
from uuid import UUID, uuid4
import warnings

from fastapi import HTTPException, status as http_status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, Event
from app.db.models.event_image import EventImage
from app.services import admin_events as admin_events_service
from app.storage.event_images import (
    EventImageStorageError,
    S3EventImageStorage,
    build_event_image_object_key,
    get_event_image_storage,
)

MAX_EVENT_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024
MAX_EVENT_IMAGE_PIXELS = 40_000_000
MAX_EVENT_IMAGE_LONGEST_SIDE = 2560
MAX_NORMALIZED_EVENT_IMAGE_BYTES = 5 * 1024 * 1024
NORMALIZED_EVENT_IMAGE_CONTENT_TYPE = "image/webp"
_READ_CHUNK_BYTES = 1024 * 1024
_WEBP_QUALITY_STEPS = (88, 84, 80, 76, 72, 68, 64, 60)
_FORMAT_CONTENT_TYPES = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}
STALE_EVENT_IMAGE_AGE = timedelta(hours=1)
STALE_EVENT_IMAGE_CLEANUP_LIMIT = 4

# Pillow emits a warning above this threshold and an error above twice the
# threshold. The explicit area check below keeps the exact project limit.
Image.MAX_IMAGE_PIXELS = MAX_EVENT_IMAGE_PIXELS


class EventImageNormalizationError(Exception):
    """Base class for safe image-normalization failures."""


class EventImageSourceTooLargeError(EventImageNormalizationError):
    """The caller supplied more source bytes than allowed."""


class EventImageUnsupportedError(EventImageNormalizationError):
    """The source is not an accepted single-frame raster image."""


class EventImageCorruptError(EventImageNormalizationError):
    """The accepted raster container cannot be decoded safely."""


class EventImageDecodedTooLargeError(EventImageNormalizationError):
    """The decoded raster exceeds the pixel-area limit."""


class EventImageOutputTooLargeError(EventImageNormalizationError):
    """Bounded encoding could not meet the normalized-output limit."""


@dataclass(frozen=True)
class NormalizedEventImage:
    content: bytes
    content_type: str
    size_bytes: int
    width: int
    height: int
    content_sha256: str


def normalize_event_image(
    source: BinaryIO,
    *,
    declared_content_type: str | None = None,
) -> NormalizedEventImage:
    source_bytes = _read_source_bytes(source)
    declared_type = _normalize_declared_content_type(declared_content_type)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(source_bytes)) as opened:
                detected_type = _FORMAT_CONTENT_TYPES.get(opened.format or "")
                if detected_type is None:
                    raise EventImageUnsupportedError(
                        "unsupported event image format",
                    )
                if declared_type is not None and declared_type != detected_type:
                    raise EventImageUnsupportedError(
                        "declared event image type does not match content",
                    )
                if bool(getattr(opened, "is_animated", False)) or int(
                    getattr(opened, "n_frames", 1),
                ) != 1:
                    raise EventImageUnsupportedError(
                        "animated event images are not supported",
                    )
                _enforce_pixel_limit(opened.width, opened.height)
                opened.load()
                oriented = ImageOps.exif_transpose(opened)
                _enforce_pixel_limit(oriented.width, oriented.height)
                normalized_pixels = _normalize_pixels(oriented)
    except EventImageNormalizationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise EventImageDecodedTooLargeError(
            "event image decoded dimensions exceed the limit",
        ) from exc
    except UnidentifiedImageError as exc:
        raise EventImageUnsupportedError("unsupported event image format") from exc
    except (OSError, SyntaxError, ValueError) as exc:
        raise EventImageCorruptError("event image cannot be decoded") from exc

    content = _encode_normalized_webp(normalized_pixels)
    return NormalizedEventImage(
        content=content,
        content_type=NORMALIZED_EVENT_IMAGE_CONTENT_TYPE,
        size_bytes=len(content),
        width=normalized_pixels.width,
        height=normalized_pixels.height,
        content_sha256=hashlib.sha256(content).hexdigest(),
    )


def _read_source_bytes(source: BinaryIO) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = source.read(
            min(_READ_CHUNK_BYTES, MAX_EVENT_IMAGE_SOURCE_BYTES + 1 - total),
        )
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise EventImageCorruptError("event image source must contain bytes")
        total += len(chunk)
        if total > MAX_EVENT_IMAGE_SOURCE_BYTES:
            raise EventImageSourceTooLargeError(
                "event image source exceeds the byte limit",
            )
        chunks.append(chunk)
    if not chunks:
        raise EventImageCorruptError("event image source is empty")
    return b"".join(chunks)


def _normalize_declared_content_type(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.split(";", 1)[0].strip().lower()
    if normalized not in _FORMAT_CONTENT_TYPES.values():
        raise EventImageUnsupportedError("unsupported declared event image type")
    return normalized


def _enforce_pixel_limit(width: int, height: int) -> None:
    if width <= 0 or height <= 0 or width * height > MAX_EVENT_IMAGE_PIXELS:
        raise EventImageDecodedTooLargeError(
            "event image decoded dimensions exceed the limit",
        )


def _normalize_pixels(image: Image.Image) -> Image.Image:
    has_alpha = image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    )
    converted = image.convert("RGBA" if has_alpha else "RGB")

    longest_side = max(converted.size)
    if longest_side > MAX_EVENT_IMAGE_LONGEST_SIDE:
        scale = MAX_EVENT_IMAGE_LONGEST_SIDE / longest_side
        resized = converted.resize(
            (
                max(1, round(converted.width * scale)),
                max(1, round(converted.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
    else:
        resized = converted

    clean = Image.new(resized.mode, resized.size)
    clean.paste(resized)
    return clean


def _encode_normalized_webp(image: Image.Image) -> bytes:
    for quality in _WEBP_QUALITY_STEPS:
        output = BytesIO()
        try:
            image.save(
                output,
                format="WEBP",
                quality=quality,
                method=6,
                exact=True,
            )
        except OSError as exc:
            raise EventImageCorruptError(
                "event image cannot be normalized",
            ) from exc
        content = output.getvalue()
        if len(content) <= MAX_NORMALIZED_EVENT_IMAGE_BYTES:
            return content
    raise EventImageOutputTooLargeError(
        "normalized event image exceeds the byte limit",
    )


@asynccontextmanager
async def _transaction_scope(session: AsyncSession) -> AsyncIterator[None]:
    if session.in_transaction():
        try:
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        return

    async with session.begin():
        yield


def _now() -> datetime:
    return datetime.now(UTC)


def _event_image_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _too_large_error() -> HTTPException:
    return _event_image_error(
        http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        "event_image_too_large",
        "Event image exceeds allowed limits",
    )


def _unsupported_error() -> HTTPException:
    return _event_image_error(
        http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        "unsupported_event_image_type",
        "Event image type is not supported",
    )


def _invalid_error() -> HTTPException:
    return _event_image_error(
        http_status.HTTP_422_UNPROCESSABLE_ENTITY,
        "invalid_event_image",
        "Event image is invalid",
    )


def _storage_unavailable_error() -> HTTPException:
    return _event_image_error(
        http_status.HTTP_503_SERVICE_UNAVAILABLE,
        "event_image_storage_unavailable",
        "Event image storage is unavailable",
    )


async def authorize_admin_event_image_mutation(
    session: AsyncSession,
    current_user: AppUser,
    event_id: UUID,
) -> UUID:
    try:
        event = await admin_events_service.get_admin_event(
            session,
            current_user,
            event_id,
        )
        community_id = event.community_id
    except Exception:
        if session.in_transaction():
            await session.rollback()
        raise

    if session.in_transaction():
        await session.rollback()
    return community_id


async def upload_admin_event_image(
    session: AsyncSession,
    actor_user_id: UUID,
    event_id: UUID,
    *,
    community_id: UUID,
    source: BinaryIO,
    declared_content_type: str | None,
) -> Event:
    storage = get_event_image_storage()
    await _cleanup_stale_event_images(
        session,
        storage,
        event_id=event_id,
        community_id=community_id,
    )

    try:
        normalized = await asyncio.to_thread(
            normalize_event_image,
            source,
            declared_content_type=declared_content_type,
        )
    except (
        EventImageSourceTooLargeError,
        EventImageDecodedTooLargeError,
        EventImageOutputTooLargeError,
    ) as exc:
        raise _too_large_error() from exc
    except EventImageUnsupportedError as exc:
        raise _unsupported_error() from exc
    except EventImageCorruptError as exc:
        raise _invalid_error() from exc

    replay_event = await _same_content_event(
        session,
        actor_user_id,
        event_id=event_id,
        content_sha256=normalized.content_sha256,
    )
    if replay_event is not None:
        return replay_event

    image_id = uuid4()
    version_token = uuid4()
    object_key = build_event_image_object_key(
        community_id=community_id,
        event_id=event_id,
    )
    pending_image = EventImage(
        id=image_id,
        event_id=event_id,
        community_id=community_id,
        object_key=object_key,
        content_type=normalized.content_type,
        size_bytes=normalized.size_bytes,
        width=normalized.width,
        height=normalized.height,
        content_sha256=normalized.content_sha256,
        version_token=version_token,
        status="pending",
        created_by=actor_user_id,
    )
    async with _transaction_scope(session):
        session.add(pending_image)
        await session.flush()

    try:
        public_url = storage.public_url(
            object_key=object_key,
            version_token=version_token,
        )
    except EventImageStorageError as exc:
        await _mark_nonstored_image_deleted(session, image_id=image_id)
        raise _storage_unavailable_error() from exc

    try:
        stored = await storage.put_normalized_image(
            object_key=object_key,
            content=normalized.content,
        )
    except EventImageStorageError as exc:
        await _best_effort_delete_image_row(
            session,
            storage,
            image_id=image_id,
        )
        raise _storage_unavailable_error() from exc

    try:
        event, cleanup_image_id = await _activate_uploaded_image(
            session,
            actor_user_id,
            event_id=event_id,
            image_id=image_id,
            public_url=public_url,
            etag=stored.etag,
        )
    except Exception:
        if session.in_transaction():
            await session.rollback()
        await _best_effort_delete_image_row(
            session,
            storage,
            image_id=image_id,
        )
        raise

    if cleanup_image_id is not None:
        await _best_effort_delete_image_row(
            session,
            storage,
            image_id=cleanup_image_id,
        )
    return event


async def remove_admin_event_image(
    session: AsyncSession,
    actor_user_id: UUID,
    event_id: UUID,
    *,
    community_id: UUID,
) -> Event:
    storage = get_event_image_storage()
    await _cleanup_stale_event_images(
        session,
        storage,
        event_id=event_id,
        community_id=community_id,
    )

    cleanup_image_id: UUID | None = None
    async with _transaction_scope(session):
        manageable_community_ids = (
            await admin_events_service.resolve_manageable_community_ids_for_user(
                session,
                actor_user_id,
            )
        )
        event = await admin_events_service._lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )
        if event.image_url is None:
            await session.refresh(event)
            return event

        active_image = await _lock_active_image(session, event_id=event_id)
        if active_image is not None:
            _verify_image_matches_event(active_image, event)
            active_image.status = "delete_pending"
            active_image.updated_at = _now()
            cleanup_image_id = active_image.id

        now = _now()
        event.image_url = None
        event.manual_override = True
        event.updated_by = actor_user_id
        event.updated_at = now
        await session.flush()
        await session.refresh(event)

    if cleanup_image_id is not None:
        cleanup_succeeded = await _best_effort_delete_image_row(
            session,
            storage,
            image_id=cleanup_image_id,
        )
        if not cleanup_succeeded:
            raise _storage_unavailable_error()
    return event


async def delete_managed_event_image_for_event_deletion(
    session: AsyncSession,
    event: Event,
) -> None:
    """Delete managed objects before the locked event row is deleted.

    The caller owns the transaction and event row lock. Legacy/external URLs have
    no managed row, so they deliberately bypass object storage.
    """
    managed_images = list(
        await session.scalars(
            select(EventImage)
            .where(
                EventImage.event_id == event.id,
                EventImage.status != "deleted",
            )
            .order_by(EventImage.created_at, EventImage.id)
            .with_for_update(),
        ),
    )
    if not managed_images:
        return

    # Preserve the active object until pending cleanup has succeeded so a
    # failed deletion does not unnecessarily break the event's visible image.
    managed_images.sort(key=lambda image: image.status == "active")
    storage = get_event_image_storage()
    for image in managed_images:
        _verify_image_matches_event(image, event)
        if not await _delete_event_image_object(storage, image):
            raise _storage_unavailable_error()
    event.image_url = None
    await session.flush()


async def _same_content_event(
    session: AsyncSession,
    actor_user_id: UUID,
    *,
    event_id: UUID,
    content_sha256: str,
) -> Event | None:
    async with _transaction_scope(session):
        manageable_community_ids = (
            await admin_events_service.resolve_manageable_community_ids_for_user(
                session,
                actor_user_id,
            )
        )
        event = await admin_events_service._lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )
        active_image = await _lock_active_image(session, event_id=event_id)
        if (
            active_image is not None
            and active_image.content_sha256 == content_sha256
            and _url_references_object(event.image_url, active_image.object_key)
        ):
            await session.refresh(event)
            return event
    return None


async def _activate_uploaded_image(
    session: AsyncSession,
    actor_user_id: UUID,
    *,
    event_id: UUID,
    image_id: UUID,
    public_url: str,
    etag: str | None,
) -> tuple[Event, UUID | None]:
    cleanup_image_id: UUID | None = None
    async with _transaction_scope(session):
        manageable_community_ids = (
            await admin_events_service.resolve_manageable_community_ids_for_user(
                session,
                actor_user_id,
            )
        )
        event = await admin_events_service._lock_admin_event(
            session,
            event_id=event_id,
            manageable_community_ids=manageable_community_ids,
        )
        pending_image = await session.scalar(
            select(EventImage)
            .where(EventImage.id == image_id)
            .with_for_update(),
        )
        if pending_image is None or pending_image.status != "pending":
            raise RuntimeError("event image is not available for activation")
        _verify_image_matches_event(pending_image, event)

        active_image = await _lock_active_image(session, event_id=event_id)
        if (
            active_image is not None
            and active_image.content_sha256 == pending_image.content_sha256
            and _url_references_object(event.image_url, active_image.object_key)
        ):
            pending_image.etag = etag
            pending_image.status = "delete_pending"
            pending_image.updated_at = _now()
            cleanup_image_id = pending_image.id
            await session.flush()
            await session.refresh(event)
            return event, cleanup_image_id

        now = _now()
        if active_image is not None:
            _verify_image_matches_event(active_image, event)
            active_image.status = "delete_pending"
            active_image.updated_at = now
            cleanup_image_id = active_image.id
            await session.flush()

        pending_image.etag = etag
        pending_image.status = "active"
        pending_image.activated_at = now
        pending_image.updated_at = now
        event.image_url = public_url
        event.manual_override = True
        event.updated_by = actor_user_id
        event.updated_at = now
        await session.flush()
        await session.refresh(event)
        return event, cleanup_image_id


async def _lock_active_image(
    session: AsyncSession,
    *,
    event_id: UUID,
) -> EventImage | None:
    return await session.scalar(
        select(EventImage)
        .where(
            EventImage.event_id == event_id,
            EventImage.status == "active",
        )
        .with_for_update(),
    )


def _verify_image_matches_event(image: EventImage, event: Event) -> None:
    if image.event_id != event.id or image.community_id != event.community_id:
        raise RuntimeError("event image ownership mismatch")


def _url_references_object(image_url: str | None, object_key: str) -> bool:
    if image_url is None:
        return False
    try:
        path = unquote(urlsplit(image_url).path).rstrip("/")
    except ValueError:
        return False
    return path.endswith(f"/{object_key}")


async def _cleanup_stale_event_images(
    session: AsyncSession,
    storage: S3EventImageStorage,
    *,
    event_id: UUID,
    community_id: UUID,
) -> None:
    cutoff = _now() - STALE_EVENT_IMAGE_AGE
    candidate_ids = list(
        await session.scalars(
            select(EventImage.id)
            .where(
                EventImage.event_id == event_id,
                EventImage.community_id == community_id,
                EventImage.status.in_(("pending", "delete_pending")),
                EventImage.updated_at <= cutoff,
            )
            .order_by(EventImage.updated_at, EventImage.id)
            .limit(STALE_EVENT_IMAGE_CLEANUP_LIMIT),
        ),
    )
    if session.in_transaction():
        await session.rollback()

    for image_id in candidate_ids:
        await _best_effort_delete_image_row(
            session,
            storage,
            image_id=image_id,
        )


async def _best_effort_delete_image_row(
    session: AsyncSession,
    storage: S3EventImageStorage,
    *,
    image_id: UUID,
) -> bool:
    try:
        return await _delete_image_row_if_safe(
            session,
            storage,
            image_id=image_id,
        )
    except Exception:
        if session.in_transaction():
            await session.rollback()
        return False


async def _delete_image_row_if_safe(
    session: AsyncSession,
    storage: S3EventImageStorage,
    *,
    image_id: UUID,
) -> bool:
    image_identity = (
        await session.execute(
            select(EventImage.event_id, EventImage.community_id).where(
                EventImage.id == image_id,
            ),
        )
    ).one_or_none()
    if session.in_transaction():
        await session.rollback()
    if image_identity is None:
        return True

    event_id, community_id = image_identity
    async with _transaction_scope(session):
        event = await session.scalar(
            select(Event).where(Event.id == event_id).with_for_update(),
        )
        image = await session.scalar(
            select(EventImage)
            .where(EventImage.id == image_id)
            .with_for_update(),
        )
        if image is None:
            return True
        if event is None:
            return False
        if image.event_id != event.id or image.community_id != community_id:
            return False
        if image.status == "deleted":
            return True
        if image.status == "active" or _url_references_object(
            event.image_url,
            image.object_key,
        ):
            return False
        if image.status not in {"pending", "delete_pending"}:
            return False

        if not await _delete_event_image_object(storage, image):
            await session.flush()
            return False
        await session.flush()
        return True


async def _delete_event_image_object(
    storage: S3EventImageStorage,
    image: EventImage,
) -> bool:
    image.status = "delete_pending"
    image.updated_at = _now()
    try:
        await storage.delete_image(object_key=image.object_key)
    except EventImageStorageError:
        return False

    now = _now()
    image.status = "deleted"
    image.deleted_at = now
    image.updated_at = now
    return True


async def _mark_nonstored_image_deleted(
    session: AsyncSession,
    *,
    image_id: UUID,
) -> None:
    try:
        async with _transaction_scope(session):
            image = await session.scalar(
                select(EventImage)
                .where(EventImage.id == image_id)
                .with_for_update(),
            )
            if image is None or image.status not in {"pending", "delete_pending"}:
                return
            now = _now()
            image.status = "deleted"
            image.deleted_at = now
            image.updated_at = now
            await session.flush()
    except Exception:
        if session.in_transaction():
            await session.rollback()
