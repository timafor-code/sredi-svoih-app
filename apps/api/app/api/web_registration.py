from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import get_optional_current_user, require_auth
from app.core.config import get_settings
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.common import ApiResponse
from app.schemas.web_registration import (
    WebRegistrationConfirmRequest,
    WebRegistrationConfirmResult,
    WebRegistrationIntentCreated,
    WebRegistrationIntentRequest,
    WebRegistrationIntentStatus,
    WebRegistrationResendResult,
)
from app.schemas.participant_profile import (
    ParticipantLineageDeclarationRequest,
    ParticipantLineageDeclarationResponse,
)
from app.schemas.web_participant_sessions import (
    RememberedParticipantIdentity,
    WebParticipantSessionIssued,
    WebParticipantSessionResponse,
)
from app.services import participant_lineage
from app.services import web_registration as service
from app.services import web_participant_sessions
from app.services.authorization import AuthenticationRequiredError

router = APIRouter(prefix="/web", tags=["web-registration"])
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
OptionalCurrentUser = Annotated[AppUser | None, Depends(get_optional_current_user)]
CurrentUser = Annotated[AppUser, Depends(require_auth)]


def set_remembered_participant_cookie(response: Response, *, token: str, expires_at) -> None:
    settings = get_settings()
    response.set_cookie(
        key=web_participant_sessions.COOKIE_NAME,
        value=token,
        max_age=settings.api_web_participant_session_ttl_days * 24 * 60 * 60,
        expires=expires_at,
        path="/",
        domain=settings.api_web_participant_session_cookie_domain or None,
        secure=settings.web_participant_session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_remembered_participant_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=web_participant_sessions.COOKIE_NAME,
        path="/",
        domain=settings.api_web_participant_session_cookie_domain or None,
        secure=settings.web_participant_session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


@router.get("/participant-session", response_model=ApiResponse[WebParticipantSessionResponse])
async def get_participant_session(
    request: Request,
    session: DbSession,
) -> ApiResponse[WebParticipantSessionResponse]:
    participant = await web_participant_sessions.resolve(
        session,
        token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
    )
    if participant is None:
        return ApiResponse[WebParticipantSessionResponse](
            data=WebParticipantSessionResponse(state="anonymous"),
        )
    return ApiResponse[WebParticipantSessionResponse](
        data=WebParticipantSessionResponse(
            state="remembered",
            participant=RememberedParticipantIdentity(
                first_name=participant.first_name,
                last_name=participant.last_name,
                phone=participant.phone,
                email=participant.email,
            ),
        ),
    )


@router.post("/participant-session", response_model=ApiResponse[WebParticipantSessionIssued])
async def issue_participant_session(
    response: Response,
    session: DbSession,
    current_user: CurrentUser,
) -> ApiResponse[WebParticipantSessionIssued]:
    issued = await web_participant_sessions.issue(session, user=current_user)
    await session.commit()
    set_remembered_participant_cookie(response, token=issued.token, expires_at=issued.expires_at)
    return ApiResponse[WebParticipantSessionIssued](data=WebParticipantSessionIssued())


@router.delete("/participant-session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_participant_session(
    response: Response,
    request: Request,
    session: DbSession,
) -> Response:
    await web_participant_sessions.revoke_current(
        session,
        token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
    )
    clear_remembered_participant_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT, headers=dict(response.headers))


@router.get(
    "/participant-profile/lineage",
    response_model=ApiResponse[ParticipantLineageDeclarationResponse],
)
async def get_lineage_declaration(
    request: Request,
    session: DbSession,
) -> ApiResponse[ParticipantLineageDeclarationResponse]:
    result = await participant_lineage.get_declaration(
        session,
        token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
    )
    return ApiResponse[ParticipantLineageDeclarationResponse](data=result)


@router.put(
    "/participant-profile/lineage",
    response_model=ApiResponse[ParticipantLineageDeclarationResponse],
)
async def put_lineage_declaration(
    payload: ParticipantLineageDeclarationRequest,
    request: Request,
    session: DbSession,
) -> ApiResponse[ParticipantLineageDeclarationResponse]:
    result = await participant_lineage.put_declaration(
        session,
        token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
        payload=payload,
    )
    return ApiResponse[ParticipantLineageDeclarationResponse](data=result)


@router.delete("/participant-profile/lineage", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lineage_declaration(
    request: Request,
    session: DbSession,
) -> Response:
    await participant_lineage.withdraw_declaration(
        session,
        token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/registration-intents", response_model=ApiResponse[WebRegistrationIntentCreated], status_code=status.HTTP_201_CREATED)
async def create_registration_intent(
    payload: WebRegistrationIntentRequest,
    session: DbSession,
    request: Request,
    current_user: OptionalCurrentUser,
) -> ApiResponse[WebRegistrationIntentCreated]:
    if request.headers.get("authorization") and current_user is None:
        raise AuthenticationRequiredError("Invalid access token")
    if current_user is None:
        remembered = await web_participant_sessions.resolve(
            session,
            token=request.cookies.get(web_participant_sessions.COOKIE_NAME),
        )
        current_user = remembered.user if remembered is not None else None
    result = await service.create_intent(
        session,
        payload,
        request.client.host if request.client else None,
        current_user=current_user,
    )
    return ApiResponse[WebRegistrationIntentCreated](data=result)


@router.get("/registration-intents/{flow_id}/status", response_model=ApiResponse[WebRegistrationIntentStatus])
async def get_registration_intent_status(
    flow_id: str,
    session: DbSession,
) -> ApiResponse[WebRegistrationIntentStatus]:
    return ApiResponse[WebRegistrationIntentStatus](data=await service.get_intent_status(session, flow_id))


@router.post(
    "/registration-intents/{flow_id}/resend-code",
    response_model=ApiResponse[WebRegistrationResendResult],
)
async def resend_registration_code(
    flow_id: str,
    session: DbSession,
    request: Request,
) -> ApiResponse[WebRegistrationResendResult]:
    result = await service.resend_code(
        session,
        flow_id,
        request.client.host if request.client else None,
    )
    return ApiResponse[WebRegistrationResendResult](data=result)


@router.post(
    "/registration-intents/{flow_id}/confirm-email",
    response_model=ApiResponse[WebRegistrationConfirmResult],
)
async def confirm_registration_email(
    flow_id: str,
    payload: WebRegistrationConfirmRequest,
    session: DbSession,
    request: Request,
    response: Response,
) -> ApiResponse[WebRegistrationConfirmResult]:
    result, issued = await service.confirm_email_with_participant_session(
        session,
        flow_id,
        payload.code,
        request.client.host if request.client else None,
    )
    if issued is not None:
        set_remembered_participant_cookie(
            response,
            token=issued.token,
            expires_at=issued.expires_at,
        )
    return ApiResponse[WebRegistrationConfirmResult](data=result)
