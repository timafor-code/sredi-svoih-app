from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.core.config import get_settings
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.push_notifications import (
    PushNotificationEnqueueRequest,
    PushNotificationJobResponse,
)
from app.services import push_notifications as push_notifications_service

router = APIRouter(prefix="/admin", tags=["admin-push-notifications"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/events/{event_id}/push-notifications",
    response_model=ApiResponse[PushNotificationJobResponse],
    status_code=status.HTTP_201_CREATED,
)
async def enqueue_event_push_notification(
    event_id: UUID,
    payload: PushNotificationEnqueueRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[PushNotificationJobResponse]:
    job, counts = await push_notifications_service.enqueue_event_push_notification(
        session,
        current_user,
        event_id,
        payload,
        token_environment=get_settings().api_push_token_environment,
    )
    return ApiResponse[PushNotificationJobResponse](
        data=push_notifications_service.serialize_push_job(job, counts),
    )


@router.get(
    "/push-jobs",
    response_model=ApiResponse[list[PushNotificationJobResponse]],
)
async def list_push_notification_jobs(
    session: DbSession,
    current_user: CurrentUser,
    community_id: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ApiResponse[list[PushNotificationJobResponse]]:
    jobs = await push_notifications_service.list_push_notification_jobs(
        session,
        current_user,
        community_id=community_id,
        limit=limit,
    )
    return ApiResponse[list[PushNotificationJobResponse]](
        data=[
            push_notifications_service.serialize_push_job(job, counts)
            for job, counts in jobs
        ],
    )
