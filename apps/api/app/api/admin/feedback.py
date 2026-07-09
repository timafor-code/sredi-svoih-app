from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.feedback import AdminFeedbackCreateRequest, AdminFeedbackResponse
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
