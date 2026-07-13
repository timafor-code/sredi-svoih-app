from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.avatar import (
    AvatarConfirmRequest,
    AvatarDeleteResponse,
    AvatarReadUrlResponse,
    AvatarResponse,
    AvatarUploadUrlRequest,
    AvatarUploadUrlResponse,
)
from app.schemas.events import ApiResponse
from app.services import avatar as avatar_service

router = APIRouter(tags=["avatars"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/me/avatar/upload-url",
    response_model=ApiResponse[AvatarUploadUrlResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_avatar_upload_url(
    payload: AvatarUploadUrlRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AvatarUploadUrlResponse]:
    upload_url = await avatar_service.create_current_user_avatar_upload_url(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AvatarUploadUrlResponse](data=upload_url)


@router.post(
    "/me/avatar/confirm",
    response_model=ApiResponse[AvatarResponse],
)
async def confirm_avatar_upload(
    payload: AvatarConfirmRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AvatarResponse]:
    avatar = await avatar_service.confirm_current_user_avatar(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AvatarResponse](data=avatar)


@router.delete(
    "/me/avatar",
    response_model=ApiResponse[AvatarDeleteResponse],
)
async def delete_avatar(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AvatarDeleteResponse]:
    deleted = await avatar_service.delete_current_user_avatar(session, current_user)
    return ApiResponse[AvatarDeleteResponse](data=deleted)


@router.get(
    "/avatars/{avatar_id}",
    response_model=ApiResponse[AvatarReadUrlResponse],
)
async def get_avatar_read_url(
    avatar_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AvatarReadUrlResponse]:
    read_url = await avatar_service.get_authorized_avatar_read_url(
        session,
        current_user,
        avatar_id,
    )
    return ApiResponse[AvatarReadUrlResponse](data=read_url)
