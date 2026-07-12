from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.community_contacts import (
    ProfileContactVisibilityResponse,
    ProfileContactVisibilityUpdateRequest,
    SyncedContactCreateRequest,
    SyncedContactDeleteResponse,
    SyncedContactResponse,
)
from app.schemas.device_tokens import DeviceTokenRegisterRequest, DeviceTokenResponse
from app.schemas.events import ApiResponse
from app.services import community_contacts as community_contacts_service
from app.services import device_tokens as device_tokens_service

router = APIRouter(prefix="/me", tags=["me"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/contact-visibility",
    response_model=ApiResponse[ProfileContactVisibilityResponse],
)
async def get_contact_visibility(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[ProfileContactVisibilityResponse]:
    visibility = await community_contacts_service.get_current_user_contact_visibility(
        session,
        current_user,
    )
    return ApiResponse[ProfileContactVisibilityResponse](
        data=ProfileContactVisibilityResponse.model_validate(visibility),
    )


@router.put(
    "/contact-visibility",
    response_model=ApiResponse[ProfileContactVisibilityResponse],
)
async def upsert_contact_visibility(
    payload: ProfileContactVisibilityUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[ProfileContactVisibilityResponse]:
    visibility = await community_contacts_service.upsert_current_user_contact_visibility(
        session,
        current_user,
        payload,
    )
    return ApiResponse[ProfileContactVisibilityResponse](
        data=ProfileContactVisibilityResponse.model_validate(visibility),
    )


@router.post(
    "/synced-contacts",
    response_model=ApiResponse[SyncedContactResponse],
    status_code=201,
)
async def create_synced_contact(
    payload: SyncedContactCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[SyncedContactResponse]:
    synced_contact = await community_contacts_service.create_current_user_synced_contact(
        session,
        current_user,
        payload,
    )
    return ApiResponse[SyncedContactResponse](
        data=SyncedContactResponse.model_validate(synced_contact),
    )


@router.delete(
    "/synced-contacts/{contact_id}",
    response_model=ApiResponse[SyncedContactDeleteResponse],
)
async def delete_synced_contact(
    contact_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[SyncedContactDeleteResponse]:
    deleted_contact_id = await community_contacts_service.delete_current_user_synced_contact(
        session,
        current_user,
        contact_id,
    )
    return ApiResponse[SyncedContactDeleteResponse](
        data=SyncedContactDeleteResponse(id=deleted_contact_id, deleted=True),
    )


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
