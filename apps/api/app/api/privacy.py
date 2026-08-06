from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.events import ApiResponse
from app.schemas.privacy import (
    PrivacyAccessAcceptedResponse,
    PrivacyAccessConfirmRequest,
    PrivacyAccessRequest,
    PrivacyDataExportRequest,
    PrivacyDataExportResponse,
    PrivacyDataSummaryResponse,
    PrivacyErasureConfirmRequest,
    PrivacyErasureLifecycleResponse,
    PrivacyRequestCreateRequest,
    PrivacyRequestResponse,
    PrivacySessionResponse,
)
from app.services import privacy as privacy_service
from app.services import privacy_access as privacy_access_service
from app.services import privacy_erasure as privacy_erasure_service

router = APIRouter(prefix="/privacy", tags=["privacy"])

CurrentUser = Annotated[AppUser, Depends(require_auth)]
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
PrivacyPrincipal = Annotated[
    privacy_access_service.PrivacySessionPrincipal,
    Depends(privacy_access_service.require_privacy_session),
]
PrivacyRequestActor = Annotated[
    privacy_access_service.PrivacyRequestActor,
    Depends(privacy_access_service.require_auth_or_privacy_session),
]


@router.post(
    "/access/request",
    response_model=ApiResponse[PrivacyAccessAcceptedResponse],
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_privacy_access(
    payload: PrivacyAccessRequest,
    background_tasks: BackgroundTasks,
    response: Response,
) -> ApiResponse[PrivacyAccessAcceptedResponse]:
    response.headers["Cache-Control"] = "no-store"
    background_tasks.add_task(
        privacy_access_service.process_privacy_access_request,
        normalized_email=payload.email,
    )
    return ApiResponse[PrivacyAccessAcceptedResponse](
        data=PrivacyAccessAcceptedResponse(),
    )


@router.post(
    "/access/confirm",
    response_model=ApiResponse[PrivacySessionResponse],
)
async def confirm_privacy_access(
    payload: PrivacyAccessConfirmRequest,
    session: DbSession,
    response: Response,
) -> ApiResponse[PrivacySessionResponse]:
    response.headers["Cache-Control"] = "no-store"
    result = await privacy_access_service.confirm_privacy_access(
        session,
        normalized_email=payload.email,
        code=payload.code,
    )
    return ApiResponse[PrivacySessionResponse](data=result)


@router.get(
    "/data-summary",
    response_model=ApiResponse[PrivacyDataSummaryResponse],
)
async def get_privacy_data_summary(
    session: DbSession,
    principal: PrivacyPrincipal,
    response: Response,
) -> ApiResponse[PrivacyDataSummaryResponse]:
    response.headers["Cache-Control"] = "no-store"
    result = await privacy_access_service.build_data_summary(
        session,
        principal.user_id,
    )
    return ApiResponse[PrivacyDataSummaryResponse](data=result)


@router.post(
    "/data-export",
    response_model=ApiResponse[PrivacyDataExportResponse],
)
async def export_privacy_data(
    payload: PrivacyDataExportRequest,
    session: DbSession,
    principal: PrivacyPrincipal,
    response: Response,
) -> ApiResponse[PrivacyDataExportResponse]:
    response.headers["Cache-Control"] = "no-store"
    result = await privacy_access_service.build_data_export(
        session,
        principal.user_id,
    )
    return ApiResponse[PrivacyDataExportResponse](data=result)


@router.post(
    "/requests",
    response_model=ApiResponse[PrivacyRequestResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_privacy_request(
    payload: PrivacyRequestCreateRequest,
    session: DbSession,
    actor: PrivacyRequestActor,
) -> ApiResponse[PrivacyRequestResponse]:
    privacy_request = await privacy_service.create_privacy_request(
        session,
        actor.user,
        payload,
        identity_verified=actor.via_privacy_session,
    )
    return ApiResponse[PrivacyRequestResponse](
        data=PrivacyRequestResponse.model_validate(privacy_request),
    )


@router.post(
    "/requests/{request_id}/confirm-erasure",
    response_model=ApiResponse[PrivacyErasureLifecycleResponse],
)
async def confirm_privacy_erasure(
    request_id: UUID,
    payload: PrivacyErasureConfirmRequest,
    session: DbSession,
    principal: PrivacyPrincipal,
    response: Response,
) -> ApiResponse[PrivacyErasureLifecycleResponse]:
    response.headers["Cache-Control"] = "no-store"
    result = await privacy_erasure_service.confirm_erasure(
        session,
        request_id=request_id,
        user_id=principal.user_id,
    )
    return ApiResponse[PrivacyErasureLifecycleResponse](data=result)


@router.post(
    "/requests/{request_id}/cancel-erasure",
    response_model=ApiResponse[PrivacyErasureLifecycleResponse],
)
async def cancel_privacy_erasure(
    request_id: UUID,
    session: DbSession,
    principal: PrivacyPrincipal,
    response: Response,
) -> ApiResponse[PrivacyErasureLifecycleResponse]:
    response.headers["Cache-Control"] = "no-store"
    result = await privacy_erasure_service.cancel_erasure(
        session,
        request_id=request_id,
        user_id=principal.user_id,
    )
    return ApiResponse[PrivacyErasureLifecycleResponse](data=result)


@router.get(
    "/requests",
    response_model=ApiResponse[list[PrivacyRequestResponse]],
)
async def list_my_privacy_requests(
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[list[PrivacyRequestResponse]]:
    privacy_requests = await privacy_service.list_current_user_privacy_requests(
        session,
        current_user,
    )
    return ApiResponse[list[PrivacyRequestResponse]](
        data=[
            PrivacyRequestResponse.model_validate(privacy_request)
            for privacy_request in privacy_requests
        ],
    )
