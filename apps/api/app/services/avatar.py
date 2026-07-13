from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import HTTPException, status as http_status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import get_settings
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import AppUser, CommunityMembership, Profile
from app.schemas.avatar import (
    ALLOWED_AVATAR_CONTENT_TYPES,
    AvatarConfirmRequest,
    AvatarDeleteResponse,
    AvatarReadUrlResponse,
    AvatarResponse,
    AvatarUploadUrlRequest,
    AvatarUploadUrlResponse,
    normalize_avatar_content_type,
)
from app.services.authorization import ACTIVE_STATUS
from app.storage.s3 import (
    AvatarObjectMetadata,
    AvatarObjectNotFoundError,
    AvatarStorageError,
    AvatarStorageUnavailableError,
    get_avatar_storage,
)

_PENDING_STATUS = "pending"
_ACTIVE_AVATAR_STATUS = "active"
_DELETED_STATUS = "deleted"
_MEMBER_VISIBLE_VALUES = frozenset({"members", "public"})
_RABBI_ONLY_VIEWER_ROLES = frozenset({"admin", "rabbi"})


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


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _not_found() -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", "Avatar not found")


def _unsupported_media_type() -> HTTPException:
    return _error(
        http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        "unsupported_media_type",
        "Unsupported avatar content type",
    )


def _payload_too_large() -> HTTPException:
    return _error(
        http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        "payload_too_large",
        "Avatar exceeds the configured size limit",
    )


def _invalid_upload() -> HTTPException:
    return _error(
        http_status.HTTP_400_BAD_REQUEST,
        "invalid_avatar_upload",
        "Uploaded avatar object is invalid",
    )


def _storage_unavailable() -> HTTPException:
    return _error(
        http_status.HTTP_503_SERVICE_UNAVAILABLE,
        "service_unavailable",
        "Avatar storage is unavailable",
    )


def _validate_declared_upload(payload: AvatarUploadUrlRequest) -> None:
    settings = get_settings()
    if payload.content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise _unsupported_media_type()
    if payload.size_bytes > settings.api_avatar_max_size_bytes:
        raise _payload_too_large()


def _normalized_storage_content_type(metadata: AvatarObjectMetadata) -> str | None:
    if metadata.content_type is None:
        return None
    return normalize_avatar_content_type(metadata.content_type.partition(";")[0])


def _validate_confirmed_metadata(metadata: AvatarObjectMetadata) -> str:
    settings = get_settings()
    actual_content_type = _normalized_storage_content_type(metadata)
    if actual_content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
        raise _unsupported_media_type()
    if metadata.content_length is None or metadata.content_length <= 0:
        raise _invalid_upload()
    if metadata.content_length > settings.api_avatar_max_size_bytes:
        raise _payload_too_large()
    return actual_content_type


def _avatar_response(
    avatar: ProfileAvatar,
    *,
    read_url: str,
    read_url_expires_at: datetime,
) -> AvatarResponse:
    if avatar.size_bytes is None or avatar.confirmed_at is None:
        raise RuntimeError("active avatar is missing confirmed metadata")
    return AvatarResponse(
        avatar_id=avatar.id,
        content_type=avatar.content_type,
        size_bytes=avatar.size_bytes,
        created_at=avatar.created_at,
        updated_at=avatar.updated_at,
        confirmed_at=avatar.confirmed_at,
        read_url=read_url,
        read_url_expires_at=read_url_expires_at,
    )


async def create_current_user_avatar_upload_url(
    session: AsyncSession,
    current_user: AppUser,
    payload: AvatarUploadUrlRequest,
) -> AvatarUploadUrlResponse:
    _validate_declared_upload(payload)
    storage = get_avatar_storage()
    avatar_id = uuid4()
    object_key = storage.avatar_object_key(user_id=current_user.id, avatar_id=avatar_id)

    try:
        async with _transaction_scope(session):
            profile = await session.scalar(
                select(Profile)
                .where(Profile.user_id == current_user.id)
                .with_for_update(),
            )
            if profile is None:
                raise _not_found()

            upload = await storage.presign_avatar_upload(
                user_id=current_user.id,
                avatar_id=avatar_id,
                content_type=payload.content_type,
            )
            session.add(
                ProfileAvatar(
                    id=avatar_id,
                    user_id=current_user.id,
                    object_key=object_key,
                    content_type=payload.content_type,
                    status=_PENDING_STATUS,
                ),
            )
            await session.flush()
    except AvatarStorageError as exc:
        raise _storage_unavailable() from exc

    return AvatarUploadUrlResponse(
        avatar_id=avatar_id,
        upload_url=upload.url,
        headers=upload.headers,
        expires_at=upload.expires_at,
        max_size_bytes=get_settings().api_avatar_max_size_bytes,
    )


async def confirm_current_user_avatar(
    session: AsyncSession,
    current_user: AppUser,
    payload: AvatarConfirmRequest,
) -> AvatarResponse:
    avatar = await session.scalar(
        select(ProfileAvatar).where(
            ProfileAvatar.id == payload.avatar_id,
            ProfileAvatar.user_id == current_user.id,
            ProfileAvatar.status == _PENDING_STATUS,
        ),
    )
    if avatar is None:
        raise _not_found()

    storage = get_avatar_storage()
    try:
        metadata = await storage.head_avatar(user_id=avatar.user_id, avatar_id=avatar.id)
    except AvatarObjectNotFoundError as exc:
        raise _not_found() from exc
    except (AvatarStorageUnavailableError, AvatarStorageError) as exc:
        raise _storage_unavailable() from exc

    try:
        actual_content_type = _validate_confirmed_metadata(metadata)
    except HTTPException:
        await _delete_rejected_upload(session, storage, avatar)
        raise

    previous_avatars: list[ProfileAvatar] = []
    async with _transaction_scope(session):
        avatar = await session.scalar(
            select(ProfileAvatar)
            .where(
                ProfileAvatar.id == payload.avatar_id,
                ProfileAvatar.user_id == current_user.id,
                ProfileAvatar.status == _PENDING_STATUS,
            )
            .with_for_update(),
        )
        if avatar is None:
            raise _not_found()

        profile = await session.scalar(
            select(Profile)
            .where(Profile.user_id == current_user.id)
            .with_for_update(),
        )
        if profile is None:
            raise _not_found()

        previous_avatars = list(
            await session.scalars(
                select(ProfileAvatar)
                .where(
                    ProfileAvatar.user_id == current_user.id,
                    ProfileAvatar.status == _ACTIVE_AVATAR_STATUS,
                    ProfileAvatar.deleted_at.is_(None),
                    ProfileAvatar.id != avatar.id,
                )
                .with_for_update(),
            ),
        )
        now = _now()
        await session.execute(
            update(ProfileAvatar)
            .where(
                ProfileAvatar.user_id == current_user.id,
                ProfileAvatar.status == _ACTIVE_AVATAR_STATUS,
                ProfileAvatar.id != avatar.id,
            )
            .values(status=_DELETED_STATUS, deleted_at=now, updated_at=now)
            .execution_options(synchronize_session=False),
        )
        avatar.content_type = actual_content_type
        avatar.size_bytes = metadata.content_length
        avatar.etag = metadata.etag
        avatar.status = _ACTIVE_AVATAR_STATUS
        avatar.confirmed_at = now
        avatar.deleted_at = None
        avatar.updated_at = now
        profile.avatar_id = avatar.id
        profile.avatar_url = None
        profile.updated_at = now
        await session.flush()

    try:
        for previous_avatar in previous_avatars:
            await storage.delete_avatar(
                user_id=previous_avatar.user_id,
                avatar_id=previous_avatar.id,
            )
        read_url = await storage.presign_avatar_read(
            user_id=avatar.user_id,
            avatar_id=avatar.id,
        )
    except AvatarStorageError as exc:
        raise _storage_unavailable() from exc

    return _avatar_response(
        avatar,
        read_url=read_url.url,
        read_url_expires_at=read_url.expires_at,
    )


async def delete_current_user_avatar(
    session: AsyncSession,
    current_user: AppUser,
) -> AvatarDeleteResponse:
    storage = get_avatar_storage()
    async with _transaction_scope(session):
        profile = await session.scalar(
            select(Profile)
            .where(Profile.user_id == current_user.id)
            .with_for_update(),
        )
        if profile is None:
            return AvatarDeleteResponse(avatar_id=None, deleted=False)

        if profile.avatar_id is None:
            if profile.avatar_url is not None:
                profile.avatar_url = None
                profile.updated_at = _now()
            return AvatarDeleteResponse(avatar_id=None, deleted=False)

        avatar = await session.scalar(
            select(ProfileAvatar)
            .where(
                ProfileAvatar.id == profile.avatar_id,
                ProfileAvatar.user_id == current_user.id,
                ProfileAvatar.status == _ACTIVE_AVATAR_STATUS,
                ProfileAvatar.deleted_at.is_(None),
            )
            .with_for_update(),
        )
        if avatar is None:
            profile.avatar_id = None
            profile.avatar_url = None
            profile.updated_at = _now()
            return AvatarDeleteResponse(avatar_id=None, deleted=False)

        try:
            await storage.delete_avatar(user_id=avatar.user_id, avatar_id=avatar.id)
        except AvatarStorageError as exc:
            raise _storage_unavailable() from exc

        now = _now()
        avatar_id = avatar.id
        avatar.status = _DELETED_STATUS
        avatar.deleted_at = now
        avatar.updated_at = now
        profile.avatar_id = None
        profile.avatar_url = None
        profile.updated_at = now
        await session.flush()

    return AvatarDeleteResponse(avatar_id=avatar_id, deleted=True)


async def get_authorized_avatar_read_url(
    session: AsyncSession,
    current_user: AppUser,
    avatar_id: UUID,
) -> AvatarReadUrlResponse:
    avatar, profile = await _active_avatar_with_profile(session, avatar_id)
    if avatar is None or profile is None:
        raise _not_found()
    if not await _can_read_avatar(session, current_user, avatar, profile):
        raise _not_found()

    storage = get_avatar_storage()
    try:
        read_url = await storage.presign_avatar_read(
            user_id=avatar.user_id,
            avatar_id=avatar.id,
        )
    except AvatarStorageError as exc:
        raise _storage_unavailable() from exc

    return AvatarReadUrlResponse(
        avatar_id=avatar.id,
        read_url=read_url.url,
        expires_at=read_url.expires_at,
    )


async def _delete_rejected_upload(
    session: AsyncSession,
    storage,
    avatar: ProfileAvatar,
) -> None:
    try:
        await storage.delete_avatar(user_id=avatar.user_id, avatar_id=avatar.id)
    except AvatarStorageError as exc:
        raise _storage_unavailable() from exc

    async with _transaction_scope(session):
        locked_avatar = await session.scalar(
            select(ProfileAvatar)
            .where(
                ProfileAvatar.id == avatar.id,
                ProfileAvatar.user_id == avatar.user_id,
                ProfileAvatar.status == _PENDING_STATUS,
            )
            .with_for_update(),
        )
        if locked_avatar is not None:
            now = _now()
            locked_avatar.status = _DELETED_STATUS
            locked_avatar.deleted_at = now
            locked_avatar.updated_at = now
            await session.flush()


async def _active_avatar_with_profile(
    session: AsyncSession,
    avatar_id: UUID,
) -> tuple[ProfileAvatar | None, Profile | None]:
    result = await session.execute(
        select(ProfileAvatar, Profile)
        .join(
            Profile,
            (Profile.user_id == ProfileAvatar.user_id)
            & (Profile.avatar_id == ProfileAvatar.id),
        )
        .where(
            ProfileAvatar.id == avatar_id,
            ProfileAvatar.status == _ACTIVE_AVATAR_STATUS,
            ProfileAvatar.confirmed_at.is_not(None),
            ProfileAvatar.deleted_at.is_(None),
        ),
    )
    row = result.first()
    if row is None:
        return None, None
    return row[0], row[1]


async def _can_read_avatar(
    session: AsyncSession,
    current_user: AppUser,
    avatar: ProfileAvatar,
    profile: Profile,
) -> bool:
    if avatar.user_id == current_user.id:
        return True

    viewer_membership = aliased(CommunityMembership)
    target_membership = aliased(CommunityMembership)
    roles = list(
        await session.scalars(
            select(viewer_membership.role)
            .join(
                target_membership,
                target_membership.community_id == viewer_membership.community_id,
            )
            .where(
                viewer_membership.user_id == current_user.id,
                viewer_membership.status == ACTIVE_STATUS,
                target_membership.user_id == avatar.user_id,
                target_membership.status == ACTIVE_STATUS,
            ),
        ),
    )
    if not roles:
        return False

    visibility = profile.profile_visibility or "members"
    if visibility in _MEMBER_VISIBLE_VALUES:
        return True
    if visibility == "rabbi_only":
        return any(role in _RABBI_ONLY_VIEWER_ROLES for role in roles)
    return False
