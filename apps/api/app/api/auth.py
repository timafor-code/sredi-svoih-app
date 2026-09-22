from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.core.hashids import hash_invite_code
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.auth import (
    AcceptInviteRequest,
    AcceptInviteResponse,
    AcceptAccountConsentRequest,
    AccountConsentStatusResponse,
    AuthCodeConfirmResponse,
    AuthCodeRequestResponse,
    AuthTokenResponse,
    ChangePasswordRequest,
    ConfirmEmailVerificationRequest,
    ConfirmPasswordResetRequest,
    ConfirmSetPasswordRequest,
    LoginRequest,
    LogoutRequest,
    LogoutResponse,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    RegisterWithInviteRequest,
    RegisterWithInviteResponse,
    RequestEmailVerificationRequest,
    RequestPasswordResetRequest,
    RequestSetPasswordRequest,
    SignupLegalDocumentsResponse,
)
from app.services.auth import (
    accept_invite_for_current_user,
    change_password,
    confirm_email_verification,
    confirm_password_reset,
    confirm_set_password,
    create_email_verification_code,
    create_password_reset_code,
    create_set_password_code,
    get_me_summary,
    get_signup_legal_documents,
    login_password_user,
    logout_session,
    refresh_session,
    register_password_user,
    register_password_user_with_invite,
)
from app.services import web_participant_sessions
from app.services.account_consent import (
    accept_current_account_consent,
    get_account_consent_status,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _request_ip(request: Request) -> str | None:
    if request.client is None:
        return None

    return request.client.host


def _request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegisterRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> RegisterResponse:
    return await register_password_user(
        session,
        email=payload.email,
        password=payload.password,
        legal_acceptances=payload.legal_acceptances,
    )


@router.get("/signup-legal-documents", response_model=SignupLegalDocumentsResponse)
async def signup_legal_documents(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SignupLegalDocumentsResponse:
    return await get_signup_legal_documents(session)


@router.get("/account-consent", response_model=AccountConsentStatusResponse)
async def account_consent_status(
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AccountConsentStatusResponse:
    return await get_account_consent_status(session, current_user=current_user)


@router.post("/account-consent/accept", response_model=AccountConsentStatusResponse)
async def accept_account_consent(
    payload: AcceptAccountConsentRequest,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AccountConsentStatusResponse:
    return await accept_current_account_consent(
        session,
        current_user=current_user,
        document_id=payload.document_id,
        content_hash=payload.content_hash,
    )


@router.post(
    "/register-with-invite",
    response_model=RegisterWithInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_with_invite(
    payload: RegisterWithInviteRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> RegisterWithInviteResponse:
    return await register_password_user_with_invite(
        session,
        invite_code_hash=hash_invite_code(payload.invite_code),
        email=payload.email,
        password=payload.password,
        profile=payload.profile,
        legal_acceptances=payload.legal_acceptances,
        ip_address=_request_ip(request),
        user_agent=_request_user_agent(request),
    )


@router.post("/accept-invite", response_model=AcceptInviteResponse)
async def accept_invite(
    payload: AcceptInviteRequest,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AcceptInviteResponse:
    return await accept_invite_for_current_user(
        session,
        invite_code_hash=hash_invite_code(payload.invite_code),
        current_user=current_user,
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthTokenResponse:
    return await login_password_user(
        session,
        email=payload.email,
        password=payload.password,
        device_name=payload.device_name,
        ip_address=_request_ip(request),
        user_agent=_request_user_agent(request),
    )


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthTokenResponse:
    return await refresh_session(
        session,
        refresh_token=payload.refresh_token,
        ip_address=_request_ip(request),
        user_agent=_request_user_agent(request),
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    payload: LogoutRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> LogoutResponse:
    result = await logout_session(session, refresh_token=payload.refresh_token)
    web_participant_sessions.clear_remembered_participant_cookie(response)
    return result


@router.post("/change-password", response_model=AuthCodeConfirmResponse)
async def change_password_endpoint(
    payload: ChangePasswordRequest,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeConfirmResponse:
    return await change_password(
        session,
        current_user=current_user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )


@router.post("/request-password-reset", response_model=AuthCodeRequestResponse)
async def request_password_reset(
    payload: RequestPasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeRequestResponse:
    return await create_password_reset_code(session, email=payload.email)


@router.post("/confirm-password-reset", response_model=AuthCodeConfirmResponse)
async def confirm_password_reset_endpoint(
    payload: ConfirmPasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeConfirmResponse:
    return await confirm_password_reset(
        session,
        email=payload.email,
        code=payload.code,
        new_password=payload.new_password,
    )


@router.post("/request-email-verification", response_model=AuthCodeRequestResponse)
async def request_email_verification(
    payload: RequestEmailVerificationRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeRequestResponse:
    return await create_email_verification_code(session, email=payload.email)


@router.post("/confirm-email-verification", response_model=AuthCodeConfirmResponse)
async def confirm_email_verification_endpoint(
    payload: ConfirmEmailVerificationRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeConfirmResponse:
    return await confirm_email_verification(
        session,
        email=payload.email,
        code=payload.code,
    )


@router.post("/request-set-password", response_model=AuthCodeRequestResponse)
async def request_set_password(
    payload: RequestSetPasswordRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeRequestResponse:
    return await create_set_password_code(session, email=payload.email)


@router.post("/confirm-set-password", response_model=AuthCodeConfirmResponse)
async def confirm_set_password_endpoint(
    payload: ConfirmSetPasswordRequest,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeConfirmResponse:
    result = await confirm_set_password(
        session,
        email=payload.email,
        code=payload.code,
        new_password=payload.new_password,
    )
    web_participant_sessions.clear_remembered_participant_cookie(response)
    return result


@router.get("/me", response_model=MeResponse)
async def get_me(
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    return await get_me_summary(session, current_user=current_user)
