from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_community import (
    AdminCommunityLocationCreateRequest,
    AdminCommunityLocationResponse,
    AdminCommunityLocationUpdateRequest,
    AdminCommunityResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_community as admin_community_service

router = APIRouter(prefix="/admin", tags=["admin-community"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/community", response_model=ApiResponse[AdminCommunityResponse])
async def get_admin_community(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
) -> ApiResponse[AdminCommunityResponse]:
    community = await admin_community_service.get_admin_community(
        session,
        current_user,
        community_id,
    )
    return ApiResponse[AdminCommunityResponse](
        data=AdminCommunityResponse.model_validate(community),
    )


@router.get(
    "/community-locations",
    response_model=ApiResponse[list[AdminCommunityLocationResponse]],
)
async def list_admin_community_locations(
    session: DbSession,
    current_user: CurrentUser,
    community_id: Annotated[UUID, Query()],
) -> ApiResponse[list[AdminCommunityLocationResponse]]:
    locations = await admin_community_service.list_admin_community_locations(
        session,
        current_user,
        community_id,
    )
    return ApiResponse[list[AdminCommunityLocationResponse]](
        data=[
            AdminCommunityLocationResponse.model_validate(location)
            for location in locations
        ],
    )


@router.post(
    "/community-locations",
    response_model=ApiResponse[AdminCommunityLocationResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_community_location(
    payload: AdminCommunityLocationCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminCommunityLocationResponse]:
    location = await admin_community_service.create_admin_community_location(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminCommunityLocationResponse](
        data=AdminCommunityLocationResponse.model_validate(location),
    )


@router.patch(
    "/community-locations/{location_id}",
    response_model=ApiResponse[AdminCommunityLocationResponse],
)
async def update_admin_community_location(
    location_id: UUID,
    payload: AdminCommunityLocationUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminCommunityLocationResponse]:
    location = await admin_community_service.update_admin_community_location(
        session,
        current_user,
        location_id,
        payload,
    )
    return ApiResponse[AdminCommunityLocationResponse](
        data=AdminCommunityLocationResponse.model_validate(location),
    )


@router.post(
    "/community-locations/{location_id}/archive",
    response_model=ApiResponse[AdminCommunityLocationResponse],
)
async def archive_admin_community_location(
    location_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminCommunityLocationResponse]:
    location = await admin_community_service.archive_admin_community_location(
        session,
        current_user,
        location_id,
    )
    return ApiResponse[AdminCommunityLocationResponse](
        data=AdminCommunityLocationResponse.model_validate(location),
    )
