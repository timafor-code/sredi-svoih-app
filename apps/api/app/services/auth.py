from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.hashids import hash_ip_optional, hash_user_agent_optional
from app.core.passwords import hash_password, verify_password
from app.core.tokens import create_access_token, create_refresh_token
from app.db.models.auth import AuthSession
from app.db.models.core import AppUser, CommunityMembership, Profile
from app.schemas.auth import (
    AppUserSummary,
    AuthTokenResponse,
    CommunityMembershipSummary,
    LogoutResponse,
    MeResponse,
    ProfileSummary,
    RegisterResponse,
    normalize_device_name,
    normalize_email,
)
from app.services import authorization as authorization_service
from app.services.auth_tokens import hash_token, verify_token_hash


class AuthConflictError(HTTPException):
    def __init__(self, detail: str = "Conflict") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _authentication_error(detail: str = "Invalid credentials") -> HTTPException:
    return authorization_service.AuthenticationRequiredError(detail)


def _now() -> datetime:
    return datetime.now(UTC)


def _access_token_ttl() -> timedelta:
    return timedelta(minutes=get_settings().api_access_token_ttl_minutes)


def _refresh_token_ttl() -> timedelta:
    return timedelta(days=get_settings().api_refresh_token_ttl_days)


def _issue_access_token(user_id: UUID) -> tuple[str, datetime]:
    ttl = _access_token_ttl()
    expires_at = _now() + ttl
    return create_access_token(user_id, expires_delta=ttl), expires_at


def _user_summary(user: AppUser) -> AppUserSummary:
    return AppUserSummary(
        id=user.id,
        email=user.email,
        phone=user.phone,
        status=user.status,
        email_verified_at=user.email_verified_at,
        phone_verified_at=user.phone_verified_at,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _profile_summary(profile: Profile | None) -> ProfileSummary | None:
    if profile is None:
        return None

    return ProfileSummary(
        id=profile.id,
        user_id=profile.user_id,
        community_id=profile.community_id,
        display_name=profile.display_name,
        first_name=profile.first_name,
        last_name=profile.last_name,
        full_name=profile.full_name,
        avatar_url=profile.avatar_url,
        city=profile.city,
        onboarding_completed=profile.onboarding_completed,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def _membership_summary(
    membership: CommunityMembership,
) -> CommunityMembershipSummary:
    return CommunityMembershipSummary(
        id=membership.id,
        community_id=membership.community_id,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        created_at=membership.created_at,
    )


def _token_response(user: AppUser, refresh_token: str) -> AuthTokenResponse:
    access_token, expires_at = _issue_access_token(user.id)
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=_user_summary(user),
    )


def _refresh_token_hash_or_auth_error(refresh_token: str) -> str:
    try:
        return hash_token(refresh_token)
    except ValueError as exc:
        raise _authentication_error("Invalid refresh token") from exc


async def _find_user_by_normalized_email(
    session: AsyncSession,
    email: str,
) -> AppUser | None:
    return await session.scalar(
        select(AppUser).where(
            AppUser.email.is_not(None),
            func.lower(AppUser.email) == email,
        ),
    )


def _new_refresh_session(
    user_id: UUID,
    refresh_token: str,
    *,
    now: datetime,
    device_name: str | None,
    ip_address: str | None,
    user_agent: str | None,
) -> AuthSession:
    return AuthSession(
        user_id=user_id,
        refresh_token_hash=hash_token(refresh_token),
        device_name=normalize_device_name(device_name),
        ip_hash=hash_ip_optional(ip_address),
        user_agent_hash=hash_user_agent_optional(user_agent),
        expires_at=now + _refresh_token_ttl(),
    )


async def register_password_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
) -> RegisterResponse:
    normalized_email = normalize_email(email)
    existing_user = await _find_user_by_normalized_email(session, normalized_email)
    if existing_user is not None:
        raise AuthConflictError("Email is already registered")

    user = AppUser(
        email=normalized_email,
        password_hash=hash_password(password),
        status=authorization_service.ACTIVE_STATUS,
    )
    session.add(user)

    try:
        await session.flush()
        profile = Profile(user_id=user.id)
        session.add(profile)
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AuthConflictError("Email is already registered") from exc

    await session.refresh(user)
    await session.refresh(profile)

    return RegisterResponse(
        user=_user_summary(user),
        profile=_profile_summary(profile),
    )


async def login_password_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    device_name: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuthTokenResponse:
    normalized_email = normalize_email(email)
    user = await _find_user_by_normalized_email(session, normalized_email)
    if (
        user is None
        or user.status != authorization_service.ACTIVE_STATUS
        or not verify_password(password, user.password_hash)
    ):
        raise _authentication_error("Invalid email or password")

    now = _now()
    refresh_token = create_refresh_token()
    session.add(
        _new_refresh_session(
            user.id,
            refresh_token,
            now=now,
            device_name=device_name,
            ip_address=ip_address,
            user_agent=user_agent,
        ),
    )
    user.last_login_at = now
    user.updated_at = now

    await session.commit()
    await session.refresh(user)

    return _token_response(user, refresh_token)


async def refresh_session(
    session: AsyncSession,
    *,
    refresh_token: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuthTokenResponse:
    refresh_token_hash = _refresh_token_hash_or_auth_error(refresh_token)
    now = _now()
    auth_session = await session.scalar(
        select(AuthSession)
        .where(
            AuthSession.refresh_token_hash == refresh_token_hash,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
        .with_for_update(),
    )
    if auth_session is None or not verify_token_hash(
        refresh_token,
        auth_session.refresh_token_hash,
    ):
        raise _authentication_error("Invalid refresh token")

    user = await session.get(AppUser, auth_session.user_id)
    if user is None or user.status != authorization_service.ACTIVE_STATUS:
        raise _authentication_error("Invalid refresh token")

    new_refresh_token = create_refresh_token()
    auth_session.revoked_at = now
    auth_session.updated_at = now
    session.add(
        _new_refresh_session(
            user.id,
            new_refresh_token,
            now=now,
            device_name=auth_session.device_name,
            ip_address=ip_address,
            user_agent=user_agent,
        ),
    )

    await session.commit()
    await session.refresh(user)

    return _token_response(user, new_refresh_token)


async def logout_session(
    session: AsyncSession,
    *,
    refresh_token: str,
) -> LogoutResponse:
    try:
        refresh_token_hash = hash_token(refresh_token)
    except ValueError:
        return LogoutResponse()

    auth_session = await session.scalar(
        select(AuthSession)
        .where(
            AuthSession.refresh_token_hash == refresh_token_hash,
            AuthSession.revoked_at.is_(None),
        )
        .with_for_update(),
    )
    if auth_session is not None and verify_token_hash(
        refresh_token,
        auth_session.refresh_token_hash,
    ):
        now = _now()
        auth_session.revoked_at = now
        auth_session.updated_at = now
        await session.commit()

    return LogoutResponse()


async def get_me_summary(
    session: AsyncSession,
    *,
    current_user: AppUser,
) -> MeResponse:
    profile = await session.scalar(
        select(Profile).where(Profile.user_id == current_user.id),
    )
    memberships = list(
        await session.scalars(
            select(CommunityMembership)
            .where(
                CommunityMembership.user_id == current_user.id,
                CommunityMembership.status == authorization_service.ACTIVE_STATUS,
            )
            .order_by(CommunityMembership.created_at),
        ),
    )

    return MeResponse(
        user=_user_summary(current_user),
        profile=_profile_summary(profile),
        memberships=[_membership_summary(membership) for membership in memberships],
    )
