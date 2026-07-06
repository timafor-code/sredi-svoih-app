from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization import require_auth
from app.db.models.core import AppUser
from app.db.session import get_db_session
from app.schemas.auth import (
    AuthTokenResponse,
    LoginRequest,
    LogoutRequest,
    LogoutResponse,
    MeResponse,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
)
from app.services.auth import (
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


@router.get("/me", response_model=MeResponse)
async def get_me(
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    return await get_me_summary(session, current_user=current_user)
