from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.auth import (
    AuthCodeConfirmResponse,
    AuthCodeRequestResponse,
    AuthTokenResponse,
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
    RequestEmailVerificationRequest,
    RequestPasswordResetRequest,
    RequestSetPasswordRequest,
)
from app.services.auth import (
    confirm_email_verification,
    confirm_password_reset,
    confirm_set_password,
    create_email_verification_code,
    create_password_reset_code,
    create_set_password_code,
    get_me_summary,
    login_password_user,
    logout_session,
    refresh_session,
    register_password_user,
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
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> LogoutResponse:
    return await logout_session(session, refresh_token=payload.refresh_token)


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
    return await confirm_email_verification(session, code=payload.code)


@router.post("/request-set-password", response_model=AuthCodeRequestResponse)
async def request_set_password(
    payload: RequestSetPasswordRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeRequestResponse:
    return await create_set_password_code(session, email=payload.email)


@router.post("/confirm-set-password", response_model=AuthCodeConfirmResponse)
async def confirm_set_password_endpoint(
    payload: ConfirmSetPasswordRequest,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthCodeConfirmResponse:
    return await confirm_set_password(
        session,
        code=payload.code,
        new_password=payload.new_password,
    )


@router.get("/me", response_model=MeResponse)
async def get_me(
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    return await get_me_summary(session, current_user=current_user)
