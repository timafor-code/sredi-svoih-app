from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_events import (
    AdminEventCreateRequest,
    AdminEventResponse,
    AdminEventUpdateRequest,
)
from app.schemas.events import (
    ApiResponse,
    ListResponseMeta,
    PaginatedApiResponse,
    PaginationMeta,
)
from app.services import admin_events as admin_events_service
from app.services.admin_events import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(prefix="/admin", tags=["admin-events"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("/events", response_model=PaginatedApiResponse[AdminEventResponse])
async def list_admin_events(
    session: DbSession,
    current_user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> PaginatedApiResponse[AdminEventResponse]:
    events, next_cursor, has_more = await admin_events_service.list_admin_events(
        session,
        current_user,
        limit=limit,
        cursor=cursor,
    )
    return PaginatedApiResponse[AdminEventResponse](
        data=[AdminEventResponse.model_validate(event) for event in events],
        meta=ListResponseMeta(
            pagination=PaginationMeta(
                limit=limit,
                next_cursor=next_cursor,
                has_more=has_more,
            ),
        ),
    )


@router.post(
    "/events",
    response_model=ApiResponse[AdminEventResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_event(
    payload: AdminEventCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.create_admin_event(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.get("/events/{event_id}", response_model=ApiResponse[AdminEventResponse])
async def get_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.get_admin_event(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.patch("/events/{event_id}", response_model=ApiResponse[AdminEventResponse])
async def update_admin_event(
    event_id: UUID,
    payload: AdminEventUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.update_admin_event(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.post(
    "/events/{event_id}/publish",
    response_model=ApiResponse[AdminEventResponse],
)
async def publish_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "published",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.post(
    "/events/{event_id}/archive",
    response_model=ApiResponse[AdminEventResponse],
)
async def archive_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "archived",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))


@router.post(
    "/events/{event_id}/cancel",
    response_model=ApiResponse[AdminEventResponse],
)
async def cancel_admin_event(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventResponse]:
    event = await admin_events_service.transition_admin_event_status(
        session,
        current_user,
        event_id,
        "cancelled",
    )
    return ApiResponse[AdminEventResponse](data=AdminEventResponse.model_validate(event))
