from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
    PrivacyAccessCode,
    PrivacyAccessSession,
)
from app.db.models.core import (
    AppUser,
    Event,
    EventRegistration,
    EventRegistrationOptionSelection,
    PrivacyRequest,
    WebRegistrationIntent,
)
from app.schemas.privacy import PrivacyErasureLifecycleResponse
from app.services import registrations as registrations_service
from app.services.privacy_erasure_email_service import (
    PrivacyErasureEmailDeliveryError,
    send_privacy_erasure_accepted,
)

logger = logging.getLogger(__name__)

DELETION_PENDING_STATUS = "deletion_pending"
_FINANCIAL_PAYMENT_STATUSES = (
    "pending",
    "succeeded",
    "failed",
    "cancelled",
    "refunded",
    "paid",
)
_PENDING_WEB_INTENT_STATUS = "email_verification_required"


@dataclass(frozen=True)
class _ConfirmResult:
    response: PrivacyErasureLifecycleResponse
    notification_email: str | None


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


def _now() -> datetime:
    return datetime.now(UTC)


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _not_found() -> HTTPException:
    return _error(
        status.HTTP_404_NOT_FOUND,
        "not_found",
        "Privacy request not found",
    )


def _not_available() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "privacy_erasure_not_available",
        "Privacy erasure is not available for this request",
    )


def _already_started() -> HTTPException:
    return _error(
        status.HTTP_409_CONFLICT,
        "privacy_erasure_already_started",
        "Privacy erasure execution has already started",
    )


def _response(
    privacy_request: PrivacyRequest,
    *,
    state: str,
) -> PrivacyErasureLifecycleResponse:
    if privacy_request.processing_stopped_at is None:
        raise RuntimeError("privacy erasure lifecycle is missing processing stop")
    return PrivacyErasureLifecycleResponse(
        request_id=privacy_request.id,
        state=state,
        processing_stopped_at=privacy_request.processing_stopped_at,
        cancelled_at=privacy_request.cancelled_at,
    )


async def has_retention_sensitive_registration_data(
    session: AsyncSession,
    user_id: UUID,
) -> bool:
    registration_id = await session.scalar(
        select(EventRegistration.id)
        .join(Event, Event.id == EventRegistration.event_id)
        .outerjoin(
            EventRegistrationOptionSelection,
            EventRegistrationOptionSelection.registration_id
            == EventRegistration.id,
        )
        .where(
            EventRegistration.user_id == user_id,
            or_(
                Event.registration_mode
                != registrations_service.FREE_REGISTRATION_MODE,
                Event.price_amount > 0,
                EventRegistration.payment_id.is_not(None),
                EventRegistration.payment_status.in_(_FINANCIAL_PAYMENT_STATUSES),
                EventRegistrationOptionSelection.unit_price_amount > 0,
                EventRegistrationOptionSelection.total_amount > 0,
                EventRegistrationOptionSelection.is_donation.is_(True),
                EventRegistrationOptionSelection.option_type_snapshot == "donation",
            ),
        )
        .limit(1),
    )
    return registration_id is not None


async def _revoke_credentials(
    session: AsyncSession,
    *,
    user_id: UUID,
    now: datetime,
) -> None:
    await session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now, updated_at=now)
        .execution_options(synchronize_session=False),
    )
    await session.execute(
        update(PrivacyAccessSession)
        .where(
            PrivacyAccessSession.user_id == user_id,
            PrivacyAccessSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .execution_options(synchronize_session=False),
    )
    for model in (
        AuthEmailVerificationCode,
        PasswordResetCode,
        AuthSetPasswordCode,
        PrivacyAccessCode,
    ):
        await session.execute(
            update(model)
            .where(model.user_id == user_id, model.consumed_at.is_(None))
            .values(consumed_at=now, updated_at=now)
            .execution_options(synchronize_session=False),
        )


async def _delete_pending_web_registration_intents(
    session: AsyncSession,
    *,
    canonical_email: str,
) -> None:
    await session.execute(
        delete(WebRegistrationIntent).where(
            WebRegistrationIntent.status == _PENDING_WEB_INTENT_STATUS,
            func.lower(WebRegistrationIntent.email_normalized)
            == canonical_email.lower(),
        ),
    )


async def _confirm_in_transaction(
    session: AsyncSession,
    *,
    request_id: UUID,
    user_id: UUID,
) -> _ConfirmResult:
    privacy_request = await session.scalar(
        select(PrivacyRequest)
        .where(
            PrivacyRequest.id == request_id,
            PrivacyRequest.user_id == user_id,
        )
        .with_for_update(),
    )
    if privacy_request is None:
        raise _not_found()
    if privacy_request.request_type != "deletion":
        raise _not_available()
    if privacy_request.execution_started_at is not None:
        raise _already_started()
    if privacy_request.completed_at is not None:
        raise _already_started()
    if privacy_request.cancelled_at is not None:
        raise _not_available()

    user = await session.scalar(
        select(AppUser).where(AppUser.id == user_id).with_for_update(),
    )
    if user is None or user.erased_at is not None or user.email is None:
        raise _not_found()

    if privacy_request.processing_stopped_at is not None:
        if (
            user.status != DELETION_PENDING_STATUS
            or not privacy_request.pre_deletion_user_status
        ):
            raise _not_available()
        return _ConfirmResult(
            response=_response(privacy_request, state=DELETION_PENDING_STATUS),
            notification_email=None,
        )

    if user.status == DELETION_PENDING_STATUS:
        raise _not_available()

    now = _now()
    privacy_request.pre_deletion_user_status = user.status
    if privacy_request.identity_verified_at is None:
        privacy_request.identity_verified_at = now
    privacy_request.processing_stopped_at = now
    privacy_request.failure_code = None
    privacy_request.updated_at = now

    user.status = DELETION_PENDING_STATUS
    user.auth_token_version += 1
    user.deletion_requested_at = now
    user.updated_at = now

    await _revoke_credentials(session, user_id=user.id, now=now)
    await _delete_pending_web_registration_intents(
        session,
        canonical_email=user.email,
    )
    await registrations_service.cancel_future_free_registrations_for_erasure(
        session,
        user_id=user.id,
        now=now,
    )
    await session.flush()
    return _ConfirmResult(
        response=_response(privacy_request, state=DELETION_PENDING_STATUS),
        notification_email=user.email,
    )


async def confirm_erasure(
    session: AsyncSession,
    *,
    request_id: UUID,
    user_id: UUID,
) -> PrivacyErasureLifecycleResponse:
    async with _transaction_scope(session):
        result = await _confirm_in_transaction(
            session,
            request_id=request_id,
            user_id=user_id,
        )

    if result.notification_email is not None:
        try:
            await run_in_threadpool(
                send_privacy_erasure_accepted,
                to_address=result.notification_email,
            )
        except PrivacyErasureEmailDeliveryError:
            logger.warning("Privacy erasure accepted email delivery failed")
    return result.response


async def cancel_erasure(
    session: AsyncSession,
    *,
    request_id: UUID,
    user_id: UUID,
) -> PrivacyErasureLifecycleResponse:
    async with _transaction_scope(session):
        privacy_request = await session.scalar(
            select(PrivacyRequest)
            .where(
                PrivacyRequest.id == request_id,
                PrivacyRequest.user_id == user_id,
            )
            .with_for_update(),
        )
        if privacy_request is None:
            raise _not_found()
        if privacy_request.request_type != "deletion":
            raise _not_available()
        if (
            privacy_request.execution_started_at is not None
            or privacy_request.completed_at is not None
        ):
            raise _already_started()
        if privacy_request.cancelled_at is not None:
            return _response(privacy_request, state="cancelled")
        if (
            privacy_request.processing_stopped_at is None
            or not privacy_request.pre_deletion_user_status
        ):
            raise _not_available()

        user = await session.scalar(
            select(AppUser).where(AppUser.id == user_id).with_for_update(),
        )
        if (
            user is None
            or user.erased_at is not None
            or user.status != DELETION_PENDING_STATUS
        ):
            raise _not_available()

        now = _now()
        user.status = privacy_request.pre_deletion_user_status
        user.deletion_requested_at = None
        user.updated_at = now
        privacy_request.cancelled_at = now
        privacy_request.status = "closed"
        privacy_request.failure_code = None
        privacy_request.updated_at = now
        await session.flush()
        return _response(privacy_request, state="cancelled")
