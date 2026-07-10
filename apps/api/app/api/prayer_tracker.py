from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.prayer_tracker import (
    PrayerLogCreateRequest,
    PrayerLogDeleteResponse,
    PrayerLogResponse,
    PrayerSummaryResponse,
)
from app.services import prayer_tracker as prayer_tracker_service

router = APIRouter(prefix="/me", tags=["prayer-tracker"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _validate_date_range(from_date: date | None, to_date: date | None) -> None:
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "validation_error",
                "message": "from_date must be on or before to_date",
            },
        )


@router.get(
    "/prayer-logs",
    response_model=ApiResponse[list[PrayerLogResponse]],
)
async def list_prayer_logs(
    session: DbSession,
    current_user: CurrentUser,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> ApiResponse[list[PrayerLogResponse]]:
    _validate_date_range(from_date, to_date)
    prayer_logs = await prayer_tracker_service.list_current_user_prayer_logs(
        session,
        current_user,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )
    return ApiResponse[list[PrayerLogResponse]](
        data=[PrayerLogResponse.model_validate(prayer_log) for prayer_log in prayer_logs],
    )


@router.post(
    "/prayer-logs",
    response_model=ApiResponse[PrayerLogResponse],
)
async def upsert_prayer_log(
    payload: PrayerLogCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[PrayerLogResponse]:
    prayer_log = await prayer_tracker_service.upsert_current_user_prayer_log(
        session,
        current_user,
        payload,
    )
    return ApiResponse[PrayerLogResponse](
        data=PrayerLogResponse.model_validate(prayer_log),
    )


@router.delete(
    "/prayer-logs/{log_id}",
    response_model=ApiResponse[PrayerLogDeleteResponse],
)
async def delete_prayer_log(
    log_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[PrayerLogDeleteResponse]:
    deleted_log_id = await prayer_tracker_service.delete_current_user_prayer_log(
        session,
        current_user,
        log_id,
    )
    return ApiResponse[PrayerLogDeleteResponse](
        data=PrayerLogDeleteResponse(id=deleted_log_id, deleted=True),
    )


@router.get(
    "/prayer-summary",
    response_model=ApiResponse[PrayerSummaryResponse],
)
async def get_prayer_summary(
    session: DbSession,
    current_user: CurrentUser,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
) -> ApiResponse[PrayerSummaryResponse]:
    _validate_date_range(from_date, to_date)
    summary = await prayer_tracker_service.get_current_user_prayer_summary(
        session,
        current_user,
        from_date=from_date,
        to_date=to_date,
    )
    return ApiResponse[PrayerSummaryResponse](data=summary)
