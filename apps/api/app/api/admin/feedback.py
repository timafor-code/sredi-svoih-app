from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.feedback import (
    AdminFeedbackCreateRequest,
    AdminFeedbackListResponse,
    AdminFeedbackResponse,
    AdminFeedbackStatusUpdateRequest,
)
from app.services import feedback as feedback_service

router = APIRouter(prefix="/admin", tags=["admin-feedback"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post(
    "/feedback",
    response_model=ApiResponse[AdminFeedbackResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_admin_feedback(
    payload: AdminFeedbackCreateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminFeedbackResponse]:
    feedback = await feedback_service.create_admin_feedback(
        session,
        current_user,
        payload,
    )
    return ApiResponse[AdminFeedbackResponse](
        data=AdminFeedbackResponse.model_validate(feedback),
    )


@router.get(
    "/feedback",
    response_model=ApiResponse[AdminFeedbackListResponse],
)
async def list_admin_feedback(
    session: DbSession,
    current_user: CurrentUser,
    feedback_status: Annotated[
        Literal["open", "reviewed", "resolved", "closed", "all"] | None,
        Query(alias="status"),
    ] = None,
    severity: Annotated[
        Literal["note", "issue", "blocker", "idea", "all"] | None,
        Query(),
    ] = None,
    section: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1)] = feedback_service.DEFAULT_PAGE_LIMIT,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApiResponse[AdminFeedbackListResponse]:
    items, total_count, normalized_limit, normalized_offset = (
        await feedback_service.list_admin_feedback(
            session,
            current_user,
            status=feedback_status,
            severity=severity,
            section=section,
            limit=limit,
            offset=offset,
        )
    )
    return ApiResponse[AdminFeedbackListResponse](
        data=AdminFeedbackListResponse(
            items=[AdminFeedbackResponse.model_validate(item) for item in items],
            total_count=total_count,
            limit=normalized_limit,
            offset=normalized_offset,
        ),
    )


@router.patch(
    "/feedback/{feedback_id}",
    response_model=ApiResponse[AdminFeedbackResponse],
)
async def update_admin_feedback_status(
    feedback_id: UUID,
    payload: AdminFeedbackStatusUpdateRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminFeedbackResponse]:
    feedback = await feedback_service.update_admin_feedback_status(
        session,
        current_user,
        feedback_id,
        payload,
    )
    return ApiResponse[AdminFeedbackResponse](
        data=AdminFeedbackResponse.model_validate(feedback),
    )
