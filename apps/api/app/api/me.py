from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.device_tokens import DeviceTokenRegisterRequest, DeviceTokenResponse
from app.schemas.events import ApiResponse
from app.services import device_tokens as device_tokens_service

router = APIRouter(prefix="/me", tags=["me"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/device-tokens",
    response_model=ApiResponse[DeviceTokenResponse],
)
async def register_device_token(
    payload: DeviceTokenRegisterRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[DeviceTokenResponse]:
    token = await device_tokens_service.register_device_token(
        session,
        current_user,
        payload,
    )
    return ApiResponse[DeviceTokenResponse](
        data=DeviceTokenResponse.model_validate(token),
    )


@router.delete(
    "/device-tokens/{token_id}",
    response_model=ApiResponse[DeviceTokenResponse],
)
async def deactivate_device_token(
    token_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[DeviceTokenResponse]:
    token = await device_tokens_service.deactivate_device_token(
        session,
        current_user,
        token_id,
    )
    return ApiResponse[DeviceTokenResponse](
        data=DeviceTokenResponse.model_validate(token),
    )
