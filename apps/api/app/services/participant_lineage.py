from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import (
    CommunityMembership,
    LegalAcceptance,
    LegalDocument,
    ParticipantLineageDeclaration,
)
from app.schemas.participant_profile import (
    ParticipantLineageDeclarationRequest,
    ParticipantLineageDeclarationResponse,
)
from app.services import web_participant_sessions
from app.services.authorization import ACTIVE_STATUS

DOCUMENT_TYPE = "special_category_consent"
EVIDENCE_VERSION = "participant-lineage-declaration-v1"

_IDENTITY_REQUIRED_DETAIL = {
    "code": "identity_required",
    "message": "Identity required",
}
_CONSENT_UNAVAILABLE_DETAIL = {
    "code": "validation_error",
    "message": "Legal document is not available",
}


def _now() -> datetime:
    return datetime.now(UTC)


def _identity_required() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=_IDENTITY_REQUIRED_DETAIL,
    )


def _consent_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=_CONSENT_UNAVAILABLE_DETAIL,
    )


def _empty_response() -> ParticipantLineageDeclarationResponse:
    return ParticipantLineageDeclarationResponse(state="none", values=[])


async def _resolve_user_id(session: AsyncSession, *, token: str | None) -> UUID | None:
    remembered = await web_participant_sessions.resolve(session, token=token)
    return remembered.user.id if remembered is not None else None


async def _active_community_id(session: AsyncSession, user_id: UUID) -> UUID | None:
    return await session.scalar(
        select(CommunityMembership.community_id)
        .where(
            CommunityMembership.user_id == user_id,
            CommunityMembership.status == ACTIVE_STATUS,
        )
        .order_by(CommunityMembership.created_at)
        .limit(1),
    )


async def get_declaration(
    session: AsyncSession,
    *,
    token: str | None,
) -> ParticipantLineageDeclarationResponse:
    user_id = await _resolve_user_id(session, token=token)
    if user_id is None:
        return _empty_response()
    row = await session.scalar(
        select(ParticipantLineageDeclaration).where(
            ParticipantLineageDeclaration.user_id == user_id,
        ),
    )
    if row is None:
        return _empty_response()
    return ParticipantLineageDeclarationResponse(
        state="declared",
        values=list(row.values),
        declared_at=row.declared_at,
        updated_at=row.updated_at,
    )


async def put_declaration(
    session: AsyncSession,
    *,
    token: str | None,
    payload: ParticipantLineageDeclarationRequest,
) -> ParticipantLineageDeclarationResponse:
    user_id = await _resolve_user_id(session, token=token)
    if user_id is None:
        raise _identity_required()

    now = _now()
    document = await session.scalar(
        select(LegalDocument).where(
            LegalDocument.id == payload.legal_acceptance.document_id,
            LegalDocument.document_type == DOCUMENT_TYPE,
        ),
    )
    if (
        document is None
        or document.content_hash != payload.legal_acceptance.content_hash
        or document.effective_at > now
        or (document.retired_at is not None and document.retired_at <= now)
    ):
        raise _consent_unavailable()

    community_id = await _active_community_id(session, user_id)

    acceptance = LegalAcceptance(
        user_id=user_id,
        registration_id=None,
        legal_document_id=document.id,
        accepted_at=now,
        acceptance_method="checkbox_plus_email_verification",
        source_channel="public_web",
        evidence_version=EVIDENCE_VERSION,
    )
    session.add(acceptance)
    await session.flush()

    row = await session.scalar(
        select(ParticipantLineageDeclaration).where(
            ParticipantLineageDeclaration.user_id == user_id,
        ),
    )
    if row is None:
        row = ParticipantLineageDeclaration(user_id=user_id, declared_at=now)
        session.add(row)
    row.community_id = community_id
    row.values = list(payload.values)
    row.consent_acceptance_id = acceptance.id
    row.source_channel = "public_web"
    row.updated_at = now

    await session.commit()
    return ParticipantLineageDeclarationResponse(
        state="declared",
        values=list(row.values),
        declared_at=row.declared_at,
        updated_at=row.updated_at,
    )


async def withdraw_declaration(session: AsyncSession, *, token: str | None) -> None:
    user_id = await _resolve_user_id(session, token=token)
    if user_id is None:
        raise _identity_required()
    await session.execute(
        delete(ParticipantLineageDeclaration).where(
            ParticipantLineageDeclaration.user_id == user_id,
        ),
    )
    await session.commit()
