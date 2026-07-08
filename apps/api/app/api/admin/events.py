from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.admin_events import (
    AdminEventCapacityUnitResponse,
    AdminEventCapacityUnitsReplaceRequest,
    AdminEventCategoryCreateRequest,
    AdminEventCategoryResponse,
    AdminEventCategoryUpdateRequest,
    AdminEventCreateRequest,
    AdminEventOccurrenceResponse,
    AdminEventOccurrencesReplaceRequest,
    AdminEventParticipationOptionResponse,
    AdminEventParticipationOptionsReplaceRequest,
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


@router.get(
    "/event-categories",
    response_model=ApiResponse[list[AdminEventCategoryResponse]],
)
async def list_admin_event_categories(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCategoryResponse]]:
    categories = await admin_events_service.list_admin_event_categories(
        session,
        current_user,
    )
    return ApiResponse[list[AdminEventCategoryResponse]](
        data=[
            AdminEventCategoryResponse.model_validate(category)
            for category in categories
        ],
    )


@router.post(
    "/event-categories",
    response_model=ApiResponse[AdminEventCategoryResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_event_category(
    payload: AdminEventCategoryCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventCategoryResponse]:
    category = await admin_events_service.create_admin_event_category(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminEventCategoryResponse](
        data=AdminEventCategoryResponse.model_validate(category),
    )


@router.patch(
    "/event-categories/{category_id}",
    response_model=ApiResponse[AdminEventCategoryResponse],
)
async def update_admin_event_category(
    category_id: UUID,
    payload: AdminEventCategoryUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventCategoryResponse]:
    category = await admin_events_service.update_admin_event_category(
        session,
        current_user,
        category_id,
        payload,
    )
    return ApiResponse[AdminEventCategoryResponse](
        data=AdminEventCategoryResponse.model_validate(category),
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


@router.get(
    "/events/{event_id}/occurrences",
    response_model=ApiResponse[list[AdminEventOccurrenceResponse]],
)
async def list_admin_event_occurrences(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventOccurrenceResponse]]:
    occurrences = await admin_events_service.list_admin_event_occurrences(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventOccurrenceResponse]](data=occurrences)


@router.put(
    "/events/{event_id}/occurrences",
    response_model=ApiResponse[list[AdminEventOccurrenceResponse]],
)
async def replace_admin_event_occurrences(
    event_id: UUID,
    payload: AdminEventOccurrencesReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventOccurrenceResponse]]:
    occurrences = await admin_events_service.replace_admin_event_occurrences(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventOccurrenceResponse]](data=occurrences)


@router.get(
    "/events/{event_id}/participation-options",
    response_model=ApiResponse[list[AdminEventParticipationOptionResponse]],
)
async def list_admin_event_participation_options(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventParticipationOptionResponse]]:
    options = await admin_events_service.list_admin_event_participation_options(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventParticipationOptionResponse]](data=options)


@router.put(
    "/events/{event_id}/participation-options",
    response_model=ApiResponse[list[AdminEventParticipationOptionResponse]],
)
async def replace_admin_event_participation_options(
    event_id: UUID,
    payload: AdminEventParticipationOptionsReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventParticipationOptionResponse]]:
    options = await admin_events_service.replace_admin_event_participation_options(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventParticipationOptionResponse]](data=options)


@router.get(
    "/events/{event_id}/capacity-units",
    response_model=ApiResponse[list[AdminEventCapacityUnitResponse]],
)
async def list_admin_event_capacity_units(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCapacityUnitResponse]]:
    units = await admin_events_service.list_admin_event_capacity_units(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[list[AdminEventCapacityUnitResponse]](
        data=[AdminEventCapacityUnitResponse.model_validate(unit) for unit in units],
    )


@router.put(
    "/events/{event_id}/capacity-units",
    response_model=ApiResponse[list[AdminEventCapacityUnitResponse]],
)
async def replace_admin_event_capacity_units(
    event_id: UUID,
    payload: AdminEventCapacityUnitsReplaceRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[AdminEventCapacityUnitResponse]]:
    units = await admin_events_service.replace_admin_event_capacity_units(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[list[AdminEventCapacityUnitResponse]](
        data=[AdminEventCapacityUnitResponse.model_validate(unit) for unit in units],
    )
