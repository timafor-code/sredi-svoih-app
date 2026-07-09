from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import secrets
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.hashids import hash_invite_code
from app.db.models.core import AppUser, CommunityMembership, Invite
from app.schemas.admin_invites import (
    AdminInviteCreateRequest,
    AdminInviteCreateResponse,
    AdminInviteResponse,
)
from app.services.authorization import ACTIVE_STATUS

ADMIN_ROLE = "admin"
INVITE_ACTIVE_STATUS = "active"
INVITE_REVOKED_STATUS = "revoked"
INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
INVITE_CODE_LENGTH = 12
INVITE_CODE_MAX_ATTEMPTS = 5


@asynccontextmanager
async def _transaction_scope(session: AsyncSession) -> AsyncIterator[None]:
    if session.in_transaction():
        try:
            yield
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        return

    async with session.begin():
        yield


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _forbidden(message: str = "Admin invite permission required") -> HTTPException:
    return _error(http_status.HTTP_403_FORBIDDEN, "forbidden", message)


def _not_found(message: str = "Invite not found") -> HTTPException:
    return _error(http_status.HTTP_404_NOT_FOUND, "not_found", message)


def _conflict(message: str) -> HTTPException:
    return _error(http_status.HTTP_409_CONFLICT, "conflict", message)


async def _resolve_admin_community_ids(
    session: AsyncSession,
    current_user: AppUser,
) -> list[UUID]:
    community_ids = await session.scalars(
        select(CommunityMembership.community_id)
        .where(
            CommunityMembership.user_id == current_user.id,
            CommunityMembership.status == ACTIVE_STATUS,
            CommunityMembership.role == ADMIN_ROLE,
        )
        .order_by(CommunityMembership.community_id),
    )
    return list(community_ids)


def _require_admin_communities(community_ids: list[UUID]) -> None:
    if not community_ids:
        raise _forbidden()


def _require_admin_community(
    community_id: UUID,
    admin_community_ids: list[UUID],
) -> None:
    _require_admin_communities(admin_community_ids)
    if community_id not in set(admin_community_ids):
        raise _forbidden()


def _build_invite_code() -> str:
    raw_code = "".join(
        secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH)
    )
    return f"SS-{raw_code[:4]}-{raw_code[4:8]}-{raw_code[8:]}"


async def _create_unique_invite_code(session: AsyncSession) -> tuple[str, str]:
    for _ in range(INVITE_CODE_MAX_ATTEMPTS):
        code = _build_invite_code()
        code_hash = hash_invite_code(code)
        existing_invite_id = await session.scalar(
            select(Invite.id).where(Invite.code_hash == code_hash).limit(1),
        )
        if existing_invite_id is None:
            return code, code_hash

    raise _conflict("Could not generate a unique invite code")


def _invite_response(invite: Invite) -> AdminInviteResponse:
    return AdminInviteResponse(
        invite_id=invite.id,
        community_id=invite.community_id,
        role=invite.role,
        email=invite.email,
        phone=invite.phone,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
        expires_at=invite.expires_at,
        status=invite.status,
        created_by=invite.created_by,
        accepted_by=invite.accepted_by,
        accepted_at=invite.accepted_at,
        created_at=invite.created_at,
    )


def _created_invite_response(invite: Invite, *, code: str) -> AdminInviteCreateResponse:
    return AdminInviteCreateResponse(
        **_invite_response(invite).model_dump(),
        code=code,
    )


async def create_admin_invite(
    session: AsyncSession,
    current_user: AppUser,
    payload: AdminInviteCreateRequest,
) -> AdminInviteCreateResponse:
    try:
        async with _transaction_scope(session):
            admin_community_ids = await _resolve_admin_community_ids(
                session,
                current_user,
            )
            _require_admin_community(payload.community_id, admin_community_ids)

            code, code_hash = await _create_unique_invite_code(session)
            invite = Invite(
                community_id=payload.community_id,
                code_hash=code_hash,
                email=payload.email,
                phone=payload.phone,
                role=payload.role,
                max_uses=payload.max_uses,
                used_count=0,
                expires_at=payload.expires_at,
                created_by=current_user.id,
                status=INVITE_ACTIVE_STATUS,
            )
            session.add(invite)
            await session.flush()
            await session.refresh(invite)
            return _created_invite_response(invite, code=code)
    except IntegrityError as exc:
        await session.rollback()
        raise _conflict("Could not create invite") from exc


async def list_admin_invites(
    session: AsyncSession,
    current_user: AppUser,
    *,
    community_id: UUID,
) -> list[AdminInviteResponse]:
    admin_community_ids = await _resolve_admin_community_ids(session, current_user)
    _require_admin_community(community_id, admin_community_ids)

    invites = await session.scalars(
        select(Invite)
        .where(Invite.community_id == community_id)
        .order_by(Invite.created_at.desc(), Invite.id.desc()),
    )
    return [_invite_response(invite) for invite in invites]


async def revoke_admin_invite(
    session: AsyncSession,
    current_user: AppUser,
    invite_id: UUID,
) -> AdminInviteResponse:
    admin_community_ids = await _resolve_admin_community_ids(session, current_user)
    _require_admin_communities(admin_community_ids)

    async with _transaction_scope(session):
        invite = await session.scalar(
            select(Invite)
            .where(
                Invite.id == invite_id,
                Invite.community_id.in_(admin_community_ids),
            )
            .with_for_update(),
        )
        if invite is None:
            raise _not_found()

        invite.status = INVITE_REVOKED_STATUS
        await session.flush()
        await session.refresh(invite)
        return _invite_response(invite)
