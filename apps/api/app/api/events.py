from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import get_optional_current_user
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import (
    ApiResponse,
    EventCapacityUnitResponse,
    EventCategoryResponse,
    EventOccurrenceResponse,
    EventParticipationOptionResponse,
    EventResponse,
    ListResponseMeta,
    PaginatedApiResponse,
    PaginationMeta,
)
from app.services import events as events_service
from app.services.events import DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT

router = APIRouter(tags=["events"])

OptionalCurrentUser = Annotated[AppUser | None, Depends(get_optional_current_user)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _require_timezone(value: datetime | None, field_name: str) -> None:
    if value is not None and value.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} must be an ISO 8601 datetime with timezone",
        )


@router.get("/events", response_model=PaginatedApiResponse[EventResponse])
async def list_events(
    session: DbSession,
    current_user: OptionalCurrentUser,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_LIMIT)] = DEFAULT_PAGE_LIMIT,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    category: Annotated[str | None, Query(max_length=64)] = None,
    starts_after: Annotated[datetime | None, Query()] = None,
    starts_before: Annotated[datetime | None, Query()] = None,
) -> PaginatedApiResponse[EventResponse]:
    _require_timezone(starts_after, "starts_after")
    _require_timezone(starts_before, "starts_before")

    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    events, next_cursor, has_more = await events_service.list_visible_events(
        session,
        member_community_ids,
        limit=limit,
        cursor=cursor,
        category=category,
        starts_after=starts_after,
        starts_before=starts_before,
    )
    return PaginatedApiResponse[EventResponse](
        data=[EventResponse.model_validate(event) for event in events],
        meta=ListResponseMeta(
            pagination=PaginationMeta(
                limit=limit,
                next_cursor=next_cursor,
                has_more=has_more,
            ),
        ),
    )


@router.get("/events/{event_id}", response_model=ApiResponse[EventResponse])
async def get_event(
    event_id: UUID,
    session: DbSession,
    current_user: OptionalCurrentUser,
) -> ApiResponse[EventResponse]:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    event = await events_service.get_visible_event(
        session,
        event_id,
        member_community_ids,
    )
    return ApiResponse[EventResponse](data=EventResponse.model_validate(event))


@router.get(
    "/events/{event_id}/occurrences",
    response_model=ApiResponse[list[EventOccurrenceResponse]],
)
async def list_event_occurrences(
    event_id: UUID,
    session: DbSession,
    current_user: OptionalCurrentUser,
) -> ApiResponse[list[EventOccurrenceResponse]]:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    event = await events_service.get_visible_event(
        session,
        event_id,
        member_community_ids,
    )
    occurrences = await events_service.list_event_occurrences(session, event)
    return ApiResponse[list[EventOccurrenceResponse]](
        data=[
            EventOccurrenceResponse.model_validate(occurrence)
            for occurrence in occurrences
        ],
    )


@router.get(
    "/events/{event_id}/participation-options",
    response_model=ApiResponse[list[EventParticipationOptionResponse]],
)
async def list_event_participation_options(
    event_id: UUID,
    session: DbSession,
    current_user: OptionalCurrentUser,
) -> ApiResponse[list[EventParticipationOptionResponse]]:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    event = await events_service.get_visible_event(
        session,
        event_id,
        member_community_ids,
    )
    options = await events_service.list_event_participation_options(session, event)
    return ApiResponse[list[EventParticipationOptionResponse]](
        data=[
            EventParticipationOptionResponse.model_validate(option)
            for option in options
        ],
    )


@router.get(
    "/events/{event_id}/capacity-units",
    response_model=ApiResponse[list[EventCapacityUnitResponse]],
)
async def list_event_capacity_units(
    event_id: UUID,
    session: DbSession,
    current_user: OptionalCurrentUser,
) -> ApiResponse[list[EventCapacityUnitResponse]]:
    member_community_ids = await events_service.resolve_member_community_ids(
        session,
        current_user,
    )
    event = await events_service.get_visible_event(
        session,
        event_id,
        member_community_ids,
    )
    units = await events_service.list_event_capacity_units(session, event)
    return ApiResponse[list[EventCapacityUnitResponse]](
        data=[EventCapacityUnitResponse.model_validate(unit) for unit in units],
    )


@router.get(
    "/event-categories",
    response_model=ApiResponse[list[EventCategoryResponse]],
)
async def list_event_categories(
    session: DbSession,
) -> ApiResponse[list[EventCategoryResponse]]:
    categories = await events_service.list_active_event_categories(session)
    return ApiResponse[list[EventCategoryResponse]](
        data=[EventCategoryResponse.model_validate(category) for category in categories],
    )
