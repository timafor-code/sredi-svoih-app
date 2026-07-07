from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.registrations import EventRegistrationResponse, RegisterEventRequest
from app.services import registrations as registrations_service

router = APIRouter(tags=["registrations"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/events/{event_id}/register",
    response_model=ApiResponse[EventRegistrationResponse],
)
async def register_for_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
    payload: RegisterEventRequest | None = None,
) -> ApiResponse[EventRegistrationResponse]:
    registration = await registrations_service.register_current_user_for_event(
        session,
        current_user,
        event_id,
        payload or RegisterEventRequest(),
    )
    return ApiResponse[EventRegistrationResponse](data=registration)


@router.post(
    "/registrations/{registration_id}/cancel",
    response_model=ApiResponse[EventRegistrationResponse],
)
async def cancel_registration(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[EventRegistrationResponse]:
    registration = await registrations_service.cancel_current_user_registration(
        session,
        current_user,
        registration_id,
    )
    return ApiResponse[EventRegistrationResponse](data=registration)


@router.get(
    "/me/registrations",
    response_model=ApiResponse[list[EventRegistrationResponse]],
)
async def list_my_registrations(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[EventRegistrationResponse]]:
    registrations = await registrations_service.list_current_user_registrations(
        session,
        current_user,
    )
    return ApiResponse[list[EventRegistrationResponse]](data=registrations)
