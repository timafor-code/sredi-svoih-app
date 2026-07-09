from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.privacy import (
    AdminPrivacyRequestResponse,
    AdminPrivacyRequestUpdateRequest,
    PrivacyRequestStatus,
)
from app.services import privacy as privacy_service

router = APIRouter(prefix="/admin/privacy", tags=["admin-privacy"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/requests",
    response_model=ApiResponse[list[AdminPrivacyRequestResponse]],
)
async def list_admin_privacy_requests(
    session: DbSession,
    current_user: CurrentUser,
    status: Annotated[PrivacyRequestStatus | None, Query()] = None,
    community_id: Annotated[UUID | None, Query()] = None,
) -> ApiResponse[list[AdminPrivacyRequestResponse]]:
    privacy_requests = await privacy_service.list_admin_privacy_requests(
        session,
        current_user,
        status=status,
        community_id=community_id,
    )
    return ApiResponse[list[AdminPrivacyRequestResponse]](
        data=[
            AdminPrivacyRequestResponse.model_validate(privacy_request)
            for privacy_request in privacy_requests
        ],
    )


@router.patch(
    "/requests/{request_id}",
    response_model=ApiResponse[AdminPrivacyRequestResponse],
)
async def update_admin_privacy_request(
    request_id: UUID,
    payload: AdminPrivacyRequestUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminPrivacyRequestResponse]:
    privacy_request = await privacy_service.update_admin_privacy_request(
        session,
        current_user,
        request_id,
        payload,
    )
    return ApiResponse[AdminPrivacyRequestResponse](
        data=AdminPrivacyRequestResponse.model_validate(privacy_request),
    )
