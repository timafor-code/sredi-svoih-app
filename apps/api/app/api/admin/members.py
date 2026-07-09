from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_members import (
    AdminMemberDetailResponse,
    AdminMemberListItemResponse,
    AdminMemberMembershipResponse,
    AdminMemberMembershipUpdateRequest,
    AdminMemberProfileUpdateRequest,
    AdminMemberProfileUpdateResponse,
    AdminMemberRegistrationResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_members as admin_members_service
from app.services.admin_members import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin-members"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/members",
    response_model=ApiResponse[list[AdminMemberListItemResponse]],
)
async def list_admin_members(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
    search: Annotated[str | None, Query(max_length=200)] = None,
    role: Annotated[str | None, Query(max_length=32)] = None,
    membership_status: Annotated[str | None, Query(max_length=32)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[list[AdminMemberListItemResponse]]:
    members = await admin_members_service.list_admin_members(
        session,
        current_user,
        community_id=community_id,
        search=search,
        role=role,
        membership_status=membership_status,
        limit=limit,
        offset=offset,
    )
    return ApiResponse[list[AdminMemberListItemResponse]](data=members)


@router.get(
    "/members/{user_id}",
    response_model=ApiResponse[AdminMemberDetailResponse],
)
async def get_admin_member(
    user_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
) -> ApiResponse[AdminMemberDetailResponse]:
    member = await admin_members_service.get_admin_member(
        session,
        current_user,
        user_id,
        community_id=community_id,
    )
    return ApiResponse[AdminMemberDetailResponse](data=member)


@router.get(
    "/members/{user_id}/registrations",
    response_model=ApiResponse[list[AdminMemberRegistrationResponse]],
)
async def list_admin_member_registrations(
    user_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
) -> ApiResponse[list[AdminMemberRegistrationResponse]]:
    registrations = await admin_members_service.list_admin_member_registrations(
        session,
        current_user,
        user_id,
        community_id=community_id,
    )
    return ApiResponse[list[AdminMemberRegistrationResponse]](data=registrations)


@router.patch(
    "/members/{user_id}/profile",
    response_model=ApiResponse[AdminMemberProfileUpdateResponse],
)
async def update_admin_member_profile(
    user_id: UUID,
    payload: AdminMemberProfileUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminMemberProfileUpdateResponse]:
    profile = await admin_members_service.update_admin_member_profile(
        session,
        current_user,
        user_id,
        payload,
    )
    return ApiResponse[AdminMemberProfileUpdateResponse](data=profile)


@router.patch(
    "/members/{user_id}/membership",
    response_model=ApiResponse[AdminMemberMembershipResponse],
)
async def update_admin_member_membership(
    user_id: UUID,
    payload: AdminMemberMembershipUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminMemberMembershipResponse]:
    membership = await admin_members_service.update_admin_member_membership(
        session,
        current_user,
        user_id,
        payload,
    )
    return ApiResponse[AdminMemberMembershipResponse](data=membership)
