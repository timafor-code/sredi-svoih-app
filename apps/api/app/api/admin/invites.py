from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_invites import (
    AdminInviteCreateRequest,
    AdminInviteCreateResponse,
    AdminInviteResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_invites as admin_invites_service

router = APIRouter(prefix="/admin", tags=["admin-invites"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/invites",
    response_model=ApiResponse[AdminInviteCreateResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_invite(
    payload: AdminInviteCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminInviteCreateResponse]:
    invite = await admin_invites_service.create_admin_invite(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminInviteCreateResponse](data=invite)


@router.get(
    "/invites",
    response_model=ApiResponse[list[AdminInviteResponse]],
)
async def list_admin_invites(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
) -> ApiResponse[list[AdminInviteResponse]]:
    invites = await admin_invites_service.list_admin_invites(
        session,
        current_user,
        community_id=community_id,
    )
    return ApiResponse[list[AdminInviteResponse]](data=invites)


@router.post(
    "/invites/{invite_id}/revoke",
    response_model=ApiResponse[AdminInviteResponse],
)
async def revoke_admin_invite(
    invite_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminInviteResponse]:
    invite = await admin_invites_service.revoke_admin_invite(
        session,
        current_user,
        invite_id,
    )
    return ApiResponse[AdminInviteResponse](data=invite)
