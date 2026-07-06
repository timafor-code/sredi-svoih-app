from __future__ import annotations

from collections.abc import Collection
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.supabase_jwt import (
    SupabaseJwtDecodeError,
    decode_supabase_access_token_subject,
)
from app.core.tokens import AccessTokenDecodeError, decode_access_token_subject
from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventRegistration,
    Profile,
)
from app.db.session import get_db_session
from app.services import authorization as authorization_service
from app.services.authorization import CommunityRole

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Security(_bearer_scheme),
    ],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> AppUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise authorization_service.AuthenticationRequiredError()

    token = credentials.credentials
    try:
        user_id = decode_access_token_subject(token)
        return await authorization_service.require_active_user(session, user_id)
    except AccessTokenDecodeError:
        pass

    settings = get_settings()
    if not settings.migration_accept_supabase_jwt:
        raise authorization_service.AuthenticationRequiredError("Invalid access token")

    try:
        user_id = decode_supabase_access_token_subject(token)
    except SupabaseJwtDecodeError as exc:
        raise authorization_service.AuthenticationRequiredError(
            "Invalid access token",
        ) from exc

    return await authorization_service.require_active_user(session, user_id)


async def require_auth(
    current_user: Annotated[AppUser, Depends(get_current_user)],
) -> AppUser:
    return current_user


async def require_active_membership(
    community_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CommunityMembership:
    return await authorization_service.require_active_membership(
        session,
        current_user.id,
        community_id,
    )


async def require_community_role(
    community_id: UUID,
    allowed_roles: Collection[CommunityRole] | Collection[str] | str,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CommunityMembership:
    return await authorization_service.require_community_role(
        session,
        current_user.id,
        community_id,
        allowed_roles,
    )


async def require_admin(
    community_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CommunityMembership:
    return await require_community_role(
        community_id,
        authorization_service.ADMIN_ROLES,
        current_user,
        session,
    )


async def require_admin_or_event_manager(
    community_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CommunityMembership:
    return await require_community_role(
        community_id,
        authorization_service.EVENT_MANAGER_ROLES,
        current_user,
        session,
    )


async def can_manage_event(
    event_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> Event:
    return await authorization_service.can_manage_event(
        session,
        current_user.id,
        event_id,
    )


async def can_view_member_profile(
    profile_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> Profile:
    return await authorization_service.can_view_member_profile(
        session,
        current_user.id,
        profile_id,
    )


async def can_manage_registration(
    registration_id: UUID,
    current_user: Annotated[AppUser, Depends(require_auth)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> EventRegistration:
    return await authorization_service.can_manage_registration(
        session,
        current_user.id,
        registration_id,
    )
