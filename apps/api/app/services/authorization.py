from __future__ import annotations

from collections.abc import Collection
from typing import Literal
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    AppUser,
    CommunityMembership,
    Event,
    EventRegistration,
    Profile,
)

CommunityRole = Literal["member", "rabbi", "event_manager", "admin"]

ACTIVE_STATUS = "active"
SUPPORTED_ROLES = frozenset({"member", "rabbi", "event_manager", "admin"})
ADMIN_ROLES = frozenset({"admin"})
EVENT_MANAGER_ROLES = frozenset({"admin", "event_manager"})
PROFILE_VIEWER_ROLES = frozenset({"admin", "event_manager", "rabbi"})


class AuthenticationRequiredError(HTTPException):
    def __init__(self, detail: str = "Authentication required") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class PermissionDeniedError(HTTPException):
    def __init__(self, detail: str = "Forbidden") -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


def _normalize_allowed_roles(
    allowed_roles: Collection[CommunityRole] | Collection[str] | str,
) -> frozenset[str]:
    roles = frozenset({allowed_roles} if isinstance(allowed_roles, str) else allowed_roles)

    if not roles:
        raise ValueError("allowed_roles must not be empty")

    unsupported_roles = roles - SUPPORTED_ROLES
    if unsupported_roles:
        unsupported = ", ".join(sorted(unsupported_roles))
        raise ValueError(f"unsupported community role: {unsupported}")

    return roles


async def require_active_user(session: AsyncSession, user_id: UUID) -> AppUser:
    user = await session.get(AppUser, user_id)
    if user is None or user.status != ACTIVE_STATUS:
        raise AuthenticationRequiredError()

    return user


async def require_active_membership(
    session: AsyncSession,
    user_id: UUID,
    community_id: UUID,
) -> CommunityMembership:
    membership = await session.scalar(
        select(CommunityMembership).where(
            CommunityMembership.user_id == user_id,
            CommunityMembership.community_id == community_id,
            CommunityMembership.status == ACTIVE_STATUS,
        ),
    )
    if membership is None:
        raise PermissionDeniedError()

    return membership


async def require_community_role(
    session: AsyncSession,
    user_id: UUID,
    community_id: UUID,
    allowed_roles: Collection[CommunityRole] | Collection[str] | str,
) -> CommunityMembership:
    roles = _normalize_allowed_roles(allowed_roles)
    membership = await require_active_membership(session, user_id, community_id)

    if membership.role not in roles:
        raise PermissionDeniedError()

    return membership


async def require_admin(
    session: AsyncSession,
    user_id: UUID,
    community_id: UUID,
) -> CommunityMembership:
    return await require_community_role(session, user_id, community_id, ADMIN_ROLES)


async def require_admin_or_event_manager(
    session: AsyncSession,
    user_id: UUID,
    community_id: UUID,
) -> CommunityMembership:
    return await require_community_role(
        session,
        user_id,
        community_id,
        EVENT_MANAGER_ROLES,
    )


async def can_manage_event(
    session: AsyncSession,
    user_id: UUID,
    event_id: UUID,
) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise PermissionDeniedError()

    await require_admin_or_event_manager(session, user_id, event.community_id)
    return event


async def can_view_member_profile(
    session: AsyncSession,
    user_id: UUID,
    profile_id: UUID,
) -> Profile:
    profile = await session.get(Profile, profile_id)
    if profile is None:
        raise PermissionDeniedError()

    if profile.user_id == user_id:
        return profile

    if profile.community_id is None:
        raise PermissionDeniedError()

    await require_community_role(
        session,
        user_id,
        profile.community_id,
        PROFILE_VIEWER_ROLES,
    )
    return profile


async def can_manage_registration(
    session: AsyncSession,
    user_id: UUID,
    registration_id: UUID,
) -> EventRegistration:
    registration = await session.get(EventRegistration, registration_id)
    if registration is None:
        raise PermissionDeniedError()

    event = await session.get(Event, registration.event_id)
    if event is None:
        raise PermissionDeniedError()

    await require_admin_or_event_manager(session, user_id, event.community_id)
    return registration
