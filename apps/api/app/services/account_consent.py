from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.core import AppUser, LegalAcceptance, LegalDocument
from app.schemas.auth import AccountConsentDocumentResponse, AccountConsentStatusResponse

_ACCOUNT_CONSENT_DOCUMENT_TYPE = "account_personal_data_consent"
_MOBILE_ACCOUNT_CONSENT_EVIDENCE_VERSION = "mobile-account-consent-reaccept-v1"


def _now() -> datetime:
    return datetime.now(UTC)


def _legal_documents_unavailable_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "legal_documents_unavailable",
            "message": "Required legal documents are temporarily unavailable",
        },
    )


def _legal_documents_changed_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "legal_documents_changed",
            "message": "Required legal documents have changed",
        },
    )


def _account_consent_required_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "account_consent_required",
            "message": "Current account consent acceptance is required",
        },
    )


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


def _is_valid_published_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


async def current_account_consent_document(
    session: AsyncSession,
    *,
    lock: bool,
) -> LegalDocument:
    query = select(LegalDocument).where(
        LegalDocument.document_type == _ACCOUNT_CONSENT_DOCUMENT_TYPE,
        LegalDocument.effective_at <= _now(),
        LegalDocument.retired_at.is_(None),
    )
    if lock:
        query = query.with_for_update(read=True)

    documents = list(await session.scalars(query))
    if len(documents) != 1 or not _is_valid_published_url(documents[0].published_url):
        raise _legal_documents_unavailable_error()
    return documents[0]


def _document_response(document: LegalDocument) -> AccountConsentDocumentResponse:
    return AccountConsentDocumentResponse(
        id=document.id,
        document_type="account_personal_data_consent",
        version=document.version,
        title=document.title,
        content_hash=document.content_hash,
        published_url=document.published_url,
    )


async def _has_accepted_document(
    session: AsyncSession,
    *,
    user_id,
    document_id,
) -> bool:
    acceptance_id = await session.scalar(
        select(LegalAcceptance.id)
        .where(
            LegalAcceptance.user_id == user_id,
            LegalAcceptance.legal_document_id == document_id,
        )
        .limit(1),
    )
    return acceptance_id is not None


async def get_account_consent_status(
    session: AsyncSession,
    *,
    current_user: AppUser,
) -> AccountConsentStatusResponse:
    document = await current_account_consent_document(session, lock=False)
    return AccountConsentStatusResponse(
        document=_document_response(document),
        accepted=await _has_accepted_document(
            session,
            user_id=current_user.id,
            document_id=document.id,
        ),
    )


async def accept_current_account_consent(
    session: AsyncSession,
    *,
    current_user: AppUser,
    document_id,
    content_hash: str,
) -> AccountConsentStatusResponse:
    async with _transaction_scope(session):
        document = await current_account_consent_document(session, lock=True)
        if document.id != document_id or document.content_hash != content_hash:
            raise _legal_documents_changed_error()

        # Serialize repeated submissions without making the document lock exclusive.
        await session.get(AppUser, current_user.id, with_for_update=True)
        accepted = await _has_accepted_document(
            session,
            user_id=current_user.id,
            document_id=document.id,
        )
        if not accepted:
            session.add(
                LegalAcceptance(
                    user_id=current_user.id,
                    registration_id=None,
                    legal_document_id=document.id,
                    accepted_at=_now(),
                    acceptance_method="checkbox",
                    source_channel="mobile",
                    evidence_version=_MOBILE_ACCOUNT_CONSENT_EVIDENCE_VERSION,
                ),
            )
            await session.flush()

    return AccountConsentStatusResponse(document=_document_response(document), accepted=True)


async def require_current_account_consent(
    session: AsyncSession,
    *,
    current_user: AppUser,
) -> None:
    """Fail closed while holding a shared lock through registration creation."""
    document = await current_account_consent_document(session, lock=True)
    if not await _has_accepted_document(
        session,
        user_id=current_user.id,
        document_id=document.id,
    ):
        raise _account_consent_required_error()
