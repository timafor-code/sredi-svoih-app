from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.common import ApiResponse
from app.schemas.web_registration import (
    WebRegistrationIntentCreated,
    WebRegistrationIntentRequest,
    WebRegistrationIntentStatus,
)
from app.services import web_registration as service

router = APIRouter(prefix="/web/registration-intents", tags=["web-registration"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("", response_model=ApiResponse[WebRegistrationIntentCreated], status_code=status.HTTP_201_CREATED)
async def create_registration_intent(
    payload: WebRegistrationIntentRequest,
    session: DbSession,
    request: Request,
) -> ApiResponse[WebRegistrationIntentCreated]:
    result = await service.create_intent(session, payload, request.client.host if request.client else None)
    return ApiResponse[WebRegistrationIntentCreated](data=result)


@router.get("/{flow_id}/status", response_model=ApiResponse[WebRegistrationIntentStatus])
async def get_registration_intent_status(
    flow_id: str,
    session: DbSession,
) -> ApiResponse[WebRegistrationIntentStatus]:
    return ApiResponse[WebRegistrationIntentStatus](data=await service.get_intent_status(session, flow_id))
