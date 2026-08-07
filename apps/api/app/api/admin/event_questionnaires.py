from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.event_questionnaires import (
    AdminEventQuestionnaireDraftRequest,
    AdminEventQuestionnaireResponse,
)
from app.schemas.events import ApiResponse
from app.services import event_questionnaires as questionnaire_service

router = APIRouter(prefix="/admin", tags=["admin-event-questionnaires"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get(
    "/events/{event_id}/web-questionnaire",
    response_model=ApiResponse[AdminEventQuestionnaireResponse],
)
async def get_admin_event_questionnaire(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventQuestionnaireResponse]:
    result = await questionnaire_service.get_admin_event_questionnaire(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[AdminEventQuestionnaireResponse](data=result)

@router.put(
    "/events/{event_id}/web-questionnaire/draft",
    response_model=ApiResponse[AdminEventQuestionnaireResponse],
)
async def put_admin_event_questionnaire_draft(
    event_id: UUID,
    payload: AdminEventQuestionnaireDraftRequest,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventQuestionnaireResponse]:
    result = await questionnaire_service.put_admin_event_questionnaire_draft(
        session,
        current_user,
        event_id,
        payload,
    )
    return ApiResponse[AdminEventQuestionnaireResponse](data=result)


@router.post(
    "/events/{event_id}/web-questionnaire/publish",
    response_model=ApiResponse[AdminEventQuestionnaireResponse],
)
async def publish_admin_event_questionnaire(
    event_id: UUID,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[AdminEventQuestionnaireResponse]:
    result = await questionnaire_service.publish_admin_event_questionnaire(
        session,
        current_user,
        event_id,
    )
    return ApiResponse[AdminEventQuestionnaireResponse](data=result)
