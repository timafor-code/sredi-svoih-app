from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.privacy import PrivacyRequestCreateRequest, PrivacyRequestResponse
from app.services import privacy as privacy_service

router = APIRouter(prefix="/privacy", tags=["privacy"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/requests",
    response_model=ApiResponse[PrivacyRequestResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_privacy_request(
    payload: PrivacyRequestCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[PrivacyRequestResponse]:
    privacy_request = await privacy_service.create_privacy_request(
        session,
        current_user,
        payload,
    )
    return ApiResponse[PrivacyRequestResponse](
        data=PrivacyRequestResponse.model_validate(privacy_request),
    )


@router.get(
    "/requests",
    response_model=ApiResponse[list[PrivacyRequestResponse]],
)
async def list_my_privacy_requests(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[PrivacyRequestResponse]]:
    privacy_requests = await privacy_service.list_current_user_privacy_requests(
        session,
        current_user,
    )
    return ApiResponse[list[PrivacyRequestResponse]](
        data=[
            PrivacyRequestResponse.model_validate(privacy_request)
            for privacy_request in privacy_requests
        ],
    )
