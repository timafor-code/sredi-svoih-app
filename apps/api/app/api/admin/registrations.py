from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_registrations import (
    AdminEventRegistrationResponse,
    AdminRegistrationCapacityAnalyticsResponse,
)
from app.schemas.events import ApiResponse
from app.services import admin_registrations as admin_registrations_service
from app.services.admin_registrations import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin-registrations"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/events/{event_id}/registrations",
    response_model=ApiResponse[list[AdminEventRegistrationResponse]],
)
async def list_admin_event_registrations(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
    occurrence_id: Annotated[UUID | None, Query()] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[list[AdminEventRegistrationResponse]]:
    registrations = await admin_registrations_service.list_admin_event_registrations(
        session,
        current_user,
        event_id,
        occurrence_id=occurrence_id,
        status=status,
        search=search,
        limit=limit,
        offset=offset,
    )
    return ApiResponse[list[AdminEventRegistrationResponse]](data=registrations)


@router.get(
    "/events/{event_id}/registration-capacity",
    response_model=ApiResponse[AdminRegistrationCapacityAnalyticsResponse],
)
async def get_admin_registration_capacity(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
    occurrence_id: Annotated[UUID | None, Query()] = None,
) -> ApiResponse[AdminRegistrationCapacityAnalyticsResponse]:
    capacity = await admin_registrations_service.get_admin_registration_capacity(
        session,
        current_user,
        event_id,
        occurrence_id=occurrence_id,
    )
    return ApiResponse[AdminRegistrationCapacityAnalyticsResponse](data=capacity)


@router.post(
    "/registrations/{registration_id}/confirm",
    response_model=ApiResponse[AdminEventRegistrationResponse],
)
async def confirm_admin_registration(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventRegistrationResponse]:
    registration = await admin_registrations_service.transition_admin_registration_status(
        session,
        current_user,
        registration_id,
        "confirmed",
    )
    return ApiResponse[AdminEventRegistrationResponse](data=registration)


@router.post(
    "/registrations/{registration_id}/reject",
    response_model=ApiResponse[AdminEventRegistrationResponse],
)
async def reject_admin_registration(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventRegistrationResponse]:
    registration = await admin_registrations_service.transition_admin_registration_status(
        session,
        current_user,
        registration_id,
        "rejected",
    )
    return ApiResponse[AdminEventRegistrationResponse](data=registration)


@router.post(
    "/registrations/{registration_id}/waitlist",
    response_model=ApiResponse[AdminEventRegistrationResponse],
)
async def waitlist_admin_registration(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventRegistrationResponse]:
    registration = await admin_registrations_service.transition_admin_registration_status(
        session,
        current_user,
        registration_id,
        "waitlisted",
    )
    return ApiResponse[AdminEventRegistrationResponse](data=registration)


@router.post(
    "/registrations/{registration_id}/attended",
    response_model=ApiResponse[AdminEventRegistrationResponse],
)
async def mark_admin_registration_attended(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventRegistrationResponse]:
    registration = await admin_registrations_service.mark_admin_registration_attendance(
        session,
        current_user,
        registration_id,
        "attended",
    )
    return ApiResponse[AdminEventRegistrationResponse](data=registration)


@router.post(
    "/registrations/{registration_id}/no-show",
    response_model=ApiResponse[AdminEventRegistrationResponse],
)
async def mark_admin_registration_no_show(
    registration_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventRegistrationResponse]:
    registration = await admin_registrations_service.mark_admin_registration_attendance(
        session,
        current_user,
        registration_id,
        "no_show",
    )
    return ApiResponse[AdminEventRegistrationResponse](data=registration)
