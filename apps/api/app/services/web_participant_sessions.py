from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models.core import AppUser, Profile, WebParticipantSession
from app.services.auth_tokens import hash_token, verify_token_hash

COOKIE_NAME = "sredi_web_participant_session"


@dataclass(frozen=True)
class IssuedWebParticipantSession:
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class RememberedParticipant:
    user: AppUser
    first_name: str
    last_name: str
    phone: str
    email: str


def _now() -> datetime:
    return datetime.now(UTC)


def _expiry(now: datetime) -> datetime:
    return now + timedelta(days=get_settings().api_web_participant_session_ttl_days)


def _is_available_user(user: AppUser | None) -> bool:
    return bool(
        user
        and user.status == "active"
        and user.deletion_requested_at is None
        and user.erased_at is None
    )


async def issue(
    session: AsyncSession,
    *,
    user: AppUser,
    now: datetime | None = None,
) -> IssuedWebParticipantSession:
    """Add a hash-only remembered-browser row to the caller's transaction."""
    issued_at = now or _now()
    token = secrets.token_urlsafe(32)
    row = WebParticipantSession(
        user_id=user.id,
        token_hash=hash_token(token),
        created_at=issued_at,
        expires_at=_expiry(issued_at),
    )
    session.add(row)
    await session.flush()
    return IssuedWebParticipantSession(token=token, expires_at=row.expires_at)


async def resolve(
    session: AsyncSession,
    *,
    token: str | None,
    update_last_used: bool = True,
) -> RememberedParticipant | None:
    if not token:
        return None
    try:
        token_hash = hash_token(token)
    except ValueError:
        return None

    now = _now()
    row = await session.scalar(
        select(WebParticipantSession).where(
            WebParticipantSession.token_hash == token_hash,
            WebParticipantSession.revoked_at.is_(None),
            WebParticipantSession.expires_at > now,
        ),
    )
    if row is None or not verify_token_hash(token, row.token_hash):
        return None

    user = await session.get(AppUser, row.user_id)
    if not _is_available_user(user):
        return None
    profile = await session.scalar(select(Profile).where(Profile.user_id == user.id))
    if (
        profile is None
        or not profile.first_name
        or not profile.last_name
        or not profile.phone
        or not user.email
    ):
        return None

    if update_last_used:
        row.last_used_at = now
        await session.commit()
    return RememberedParticipant(
        user=user,
        first_name=profile.first_name,
        last_name=profile.last_name,
        phone=profile.phone,
        email=user.email,
    )


async def revoke_current(
    session: AsyncSession,
    *,
    token: str | None,
) -> None:
    if token:
        try:
            token_hash = hash_token(token)
        except ValueError:
            token_hash = None
        if token_hash is not None:
            now = _now()
            await session.execute(
                update(WebParticipantSession)
                .where(
                    WebParticipantSession.token_hash == token_hash,
                    WebParticipantSession.revoked_at.is_(None),
                )
                .values(revoked_at=now)
                .execution_options(synchronize_session=False),
            )
    await session.commit()


async def revoke_all_for_user(
    session: AsyncSession,
    *,
    user_id: UUID,
    now: datetime | None = None,
) -> None:
    await session.execute(
        update(WebParticipantSession)
        .where(
            WebParticipantSession.user_id == user_id,
            WebParticipantSession.revoked_at.is_(None),
        )
        .values(revoked_at=now or _now())
        .execution_options(synchronize_session=False),
    )
