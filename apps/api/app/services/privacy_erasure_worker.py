from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.core import (
    AppUser,
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal
from app.services.privacy_erasure import DELETION_PENDING_STATUS
from app.services.privacy_erasure_deletion_manifest import (
    apply_privacy_erasure_deletion_manifest,
    collect_private_avatar_keys,
    delete_app_user_last,
)
from app.services.privacy_erasure_completion_notification import (
    DELIVERY_UNAVAILABLE,
    PrivacyErasureNotificationResult,
    deliver_privacy_erasure_completion_notification,
)
from app.services.privacy_erasure_notification_crypto import (
    PrivacyErasureNotificationCryptoError,
    PrivacyErasureNotificationEncryptionConfig,
    encrypt_notification_recipient,
    load_notification_encryption_config,
)
from app.services.privacy_erasure_retention import (
    RETAINED_FINANCIAL_CATEGORY,
    PrivacyErasureRetentionClassificationError,
    PrivacyErasureRetentionConfigurationError,
    PrivacyErasureRetentionPlan,
    create_retained_financial_evidence,
    plan_privacy_erasure_retention,
)
from app.services.privacy_erasure_restore_register import (
    REGISTER_UNAVAILABLE,
    ensure_restore_register_marker,
    privacy_erasure_subject_ref_hash,
)
from app.storage.privacy_erasure_register import (
    S3PrivacyErasureRegisterStorage,
)
from app.storage.s3 import get_avatar_storage

logger = logging.getLogger(__name__)

PRIVACY_ERASURE_EXECUTION_VERSION = "privacy-erasure-worker-v4"
MANUAL_REVIEW_FAILURE_CODE = "privacy_erasure_manual_review_required"
RETENTION_CONFIGURATION_FAILURE_CODE = (
    "privacy_erasure_retention_configuration_unavailable"
)
AVATAR_STORAGE_FAILURE_CODE = "privacy_erasure_avatar_storage_failed"
DATABASE_FAILURE_CODE = "privacy_erasure_database_failed"
SUBJECT_MISSING_FAILURE_CODE = "privacy_erasure_subject_missing"
SUBJECT_STATE_FAILURE_CODE = "privacy_erasure_subject_state_invalid"
NOTIFICATION_CONFIGURATION_FAILURE_CODE = (
    "privacy_erasure_notification_configuration_unavailable"
)
NOTIFICATION_RECIPIENT_MISSING_FAILURE_CODE = (
    "privacy_erasure_notification_recipient_missing"
)
NOTIFICATION_ENCRYPTION_FAILURE_CODE = (
    "privacy_erasure_notification_encryption_failed"
)
RESTORE_REGISTER_FAILURE_CODE = REGISTER_UNAVAILABLE
RETRYABLE_FAILURE_CODES = frozenset(
    {
        AVATAR_STORAGE_FAILURE_CODE,
        DATABASE_FAILURE_CODE,
        NOTIFICATION_CONFIGURATION_FAILURE_CODE,
        NOTIFICATION_ENCRYPTION_FAILURE_CODE,
        RESTORE_REGISTER_FAILURE_CODE,
        RETENTION_CONFIGURATION_FAILURE_CODE,
    },
)


@dataclass(frozen=True)
class PrivacyErasureWorkerResult:
    request_id: UUID
    result: str
    execution_version: str = PRIVACY_ERASURE_EXECUTION_VERSION
    destruction_evidence_id: UUID | None = None
    failure_code: str | None = None
    notification_result: str = "not_created"
    notification_failure_code: str | None = None


@dataclass(frozen=True)
class _ClaimedRequest:
    user_id: UUID
    recipient: str
    notification_config: PrivacyErasureNotificationEncryptionConfig


class _AvatarDeletionFailed(RuntimeError):
    pass


class _NotificationEncryptionFailed(RuntimeError):
    pass


class _RestoreRegisterFailed(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _result(
    request_id: UUID,
    result: str,
    *,
    evidence_id: UUID | None = None,
    failure_code: str | None = None,
    notification_result: str = "not_created",
    notification_failure_code: str | None = None,
) -> PrivacyErasureWorkerResult:
    return PrivacyErasureWorkerResult(
        request_id=request_id,
        result=result,
        destruction_evidence_id=evidence_id,
        failure_code=failure_code,
        notification_result=notification_result,
        notification_failure_code=notification_failure_code,
    )


async def _completed_result(
    session: AsyncSession,
    privacy_request: PrivacyRequest,
) -> PrivacyErasureWorkerResult | None:
    if (
        privacy_request.completed_at is None
        or privacy_request.destruction_evidence_id is None
    ):
        return None
    evidence = await session.get(
        PrivacyDestructionEvidence,
        privacy_request.destruction_evidence_id,
    )
    if evidence is None or evidence.result_status not in {
        "completed",
        "completed_with_retention",
    }:
        return None
    return _result(
        privacy_request.id,
        "already_completed",
        evidence_id=evidence.id,
    )


def _request_lifecycle_is_eligible(privacy_request: PrivacyRequest) -> bool:
    return (
        privacy_request.request_type == "deletion"
        and privacy_request.identity_verified_at is not None
        and privacy_request.processing_stopped_at is not None
        and privacy_request.cancelled_at is None
        and privacy_request.completed_at is None
        and privacy_request.destruction_evidence_id is None
    )


def _subject_lifecycle_is_eligible(user: AppUser) -> bool:
    return (
        user.status == DELETION_PENDING_STATUS
        and user.deletion_requested_at is not None
        and user.erased_at is None
    )


async def _claim(
    request_id: UUID,
    *,
    session_factory: Any,
    now_provider: Callable[[], datetime],
    settings: Settings,
) -> _ClaimedRequest | PrivacyErasureWorkerResult:
    async with session_factory() as session:
        async with session.begin():
            privacy_request = await session.scalar(
                select(PrivacyRequest)
                .where(PrivacyRequest.id == request_id)
                .with_for_update(),
            )
            if privacy_request is None:
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )

            completed = await _completed_result(session, privacy_request)
            if completed is not None:
                return completed

            now = now_provider()
            if privacy_request.user_id is None:
                privacy_request.failure_code = SUBJECT_MISSING_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_MISSING_FAILURE_CODE,
                )
            if not _request_lifecycle_is_eligible(privacy_request):
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )

            user = await session.scalar(
                select(AppUser)
                .where(AppUser.id == privacy_request.user_id)
                .with_for_update(),
            )
            if user is None:
                privacy_request.failure_code = SUBJECT_MISSING_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_MISSING_FAILURE_CODE,
                )
            if not _subject_lifecycle_is_eligible(user):
                privacy_request.failure_code = SUBJECT_STATE_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )
            try:
                await plan_privacy_erasure_retention(
                    session,
                    user.id,
                    settings=settings,
                )
            except PrivacyErasureRetentionConfigurationError:
                privacy_request.failure_code = RETENTION_CONFIGURATION_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "retryable_failure",
                    failure_code=RETENTION_CONFIGURATION_FAILURE_CODE,
                )
            except PrivacyErasureRetentionClassificationError:
                privacy_request.failure_code = MANUAL_REVIEW_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=MANUAL_REVIEW_FAILURE_CODE,
                )

            try:
                notification_config = load_notification_encryption_config(settings)
            except PrivacyErasureNotificationCryptoError:
                privacy_request.failure_code = NOTIFICATION_CONFIGURATION_FAILURE_CODE
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "retryable_failure",
                    failure_code=NOTIFICATION_CONFIGURATION_FAILURE_CODE,
                )
            if user.email is None or not user.email.strip():
                privacy_request.failure_code = (
                    NOTIFICATION_RECIPIENT_MISSING_FAILURE_CODE
                )
                privacy_request.updated_at = now
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=NOTIFICATION_RECIPIENT_MISSING_FAILURE_CODE,
                )

            if privacy_request.execution_started_at is None:
                privacy_request.execution_started_at = now
            privacy_request.failure_code = None
            privacy_request.updated_at = now
            return _ClaimedRequest(
                user_id=user.id,
                recipient=user.email,
                notification_config=notification_config,
            )


async def _record_failure_code(
    request_id: UUID,
    failure_code: str,
    *,
    session_factory: Any,
    now_provider: Callable[[], datetime],
) -> None:
    try:
        async with session_factory() as session:
            async with session.begin():
                privacy_request = await session.scalar(
                    select(PrivacyRequest)
                    .where(PrivacyRequest.id == request_id)
                    .with_for_update(),
                )
                if (
                    privacy_request is not None
                    and privacy_request.completed_at is None
                    and privacy_request.cancelled_at is None
                ):
                    privacy_request.failure_code = failure_code
                    privacy_request.updated_at = now_provider()
    except Exception:
        logger.warning("Privacy erasure failure state could not be recorded")


async def _delete_content_graph(
    session: AsyncSession,
    *,
    user: AppUser,
    privacy_request: PrivacyRequest,
    now: datetime,
    avatar_keys: list[str],
    subject_ref_hash: str,
    recipient: str,
    notification_config: PrivacyErasureNotificationEncryptionConfig,
    retention_plan: PrivacyErasureRetentionPlan,
) -> UUID:
    manifest = await apply_privacy_erasure_deletion_manifest(
        session,
        user=user,
        avatar_keys=avatar_keys,
    )
    retention_until = await create_retained_financial_evidence(
        session,
        plan=retention_plan,
        subject_ref_hash=subject_ref_hash,
        completed_at=now,
    )
    categories_retained = (
        [RETAINED_FINANCIAL_CATEGORY] if retention_plan.has_retention else []
    )
    result_status = "completed_with_retention" if categories_retained else "completed"
    evidence = PrivacyDestructionEvidence(
        subject_ref_hash=subject_ref_hash,
        execution_version=PRIVACY_ERASURE_EXECUTION_VERSION,
        result_status=result_status,
        completed_at=now,
        categories_deleted=manifest.categories_deleted,
        categories_retained=categories_retained,
        retention_until=retention_until,
        created_at=now,
    )
    session.add(evidence)
    await session.flush()

    outbox_id = uuid4()
    try:
        encrypted_recipient = encrypt_notification_recipient(
            recipient,
            outbox_id=outbox_id,
            privacy_request_id=privacy_request.id,
            destruction_evidence_id=evidence.id,
            config=notification_config,
        )
    except Exception:  # noqa: BLE001 - crypto details must not escape.
        raise _NotificationEncryptionFailed() from None
    session.add(
        PrivacyErasureNotificationOutbox(
            id=outbox_id,
            privacy_request_id=privacy_request.id,
            destruction_evidence_id=evidence.id,
            notification_kind=evidence.result_status,
            status="pending",
            recipient_ciphertext=encrypted_recipient.ciphertext,
            recipient_nonce=encrypted_recipient.nonce,
            encryption_key_id=encrypted_recipient.key_id,
            attempt_count=0,
            expires_at=now
            + timedelta(hours=notification_config.delivery_window_hours),
            created_at=now,
            updated_at=now,
        ),
    )
    await session.flush()

    privacy_request.status = "resolved"
    privacy_request.resolved_at = now
    privacy_request.completed_at = now
    privacy_request.failure_code = None
    privacy_request.destruction_evidence_id = evidence.id
    privacy_request.message = None
    privacy_request.resolution_note = None
    privacy_request.updated_at = now
    await session.flush()

    await delete_app_user_last(session, user.id)
    return evidence.id


async def _execute(
    request_id: UUID,
    claimed: _ClaimedRequest,
    *,
    subject_ref_hash: str,
    register_storage: Any,
    settings: Settings,
    session_factory: Any,
    storage_factory: Callable[[], Any],
    now_provider: Callable[[], datetime],
    after_storage: Callable[[AsyncSession], Awaitable[None]] | None,
    before_commit: Callable[[AsyncSession], Awaitable[None]] | None,
) -> PrivacyErasureWorkerResult:
    async with session_factory() as session:
        async with session.begin():
            privacy_request = await session.scalar(
                select(PrivacyRequest)
                .where(PrivacyRequest.id == request_id)
                .with_for_update(),
            )
            if privacy_request is None:
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )
            completed = await _completed_result(session, privacy_request)
            if completed is not None:
                return completed
            if (
                privacy_request.user_id != claimed.user_id
                or not _request_lifecycle_is_eligible(privacy_request)
                or privacy_request.execution_started_at is None
            ):
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )

            user = await session.scalar(
                select(AppUser)
                .where(AppUser.id == claimed.user_id)
                .with_for_update(),
            )
            if user is None:
                privacy_request.failure_code = SUBJECT_MISSING_FAILURE_CODE
                privacy_request.updated_at = now_provider()
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_MISSING_FAILURE_CODE,
                )
            if not _subject_lifecycle_is_eligible(user):
                privacy_request.failure_code = SUBJECT_STATE_FAILURE_CODE
                privacy_request.updated_at = now_provider()
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=SUBJECT_STATE_FAILURE_CODE,
                )
            try:
                retention_plan = await plan_privacy_erasure_retention(
                    session,
                    user.id,
                    settings=settings,
                )
            except PrivacyErasureRetentionConfigurationError:
                privacy_request.failure_code = RETENTION_CONFIGURATION_FAILURE_CODE
                privacy_request.updated_at = now_provider()
                return _result(
                    request_id,
                    "retryable_failure",
                    failure_code=RETENTION_CONFIGURATION_FAILURE_CODE,
                )
            except PrivacyErasureRetentionClassificationError:
                privacy_request.failure_code = MANUAL_REVIEW_FAILURE_CODE
                privacy_request.updated_at = now_provider()
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=MANUAL_REVIEW_FAILURE_CODE,
                )

            try:
                await ensure_restore_register_marker(
                    register_storage,
                    settings=settings,
                    subject_ref_hash=subject_ref_hash,
                )
            except Exception:  # noqa: BLE001 - provider details must not escape.
                raise _RestoreRegisterFailed() from None

            avatar_keys = await collect_private_avatar_keys(
                session,
                user.id,
            )
            if avatar_keys:
                storage = storage_factory()
                try:
                    for object_key in avatar_keys:
                        await storage.delete_avatar(object_key=object_key)
                except Exception:
                    raise _AvatarDeletionFailed() from None

            if after_storage is not None:
                await after_storage(session)
            now = now_provider()
            evidence_id = await _delete_content_graph(
                session,
                user=user,
                privacy_request=privacy_request,
                now=now,
                avatar_keys=avatar_keys,
                subject_ref_hash=subject_ref_hash,
                recipient=claimed.recipient,
                notification_config=claimed.notification_config,
                retention_plan=retention_plan,
            )
            if before_commit is not None:
                await before_commit(session)
            return _result(
                request_id,
                "completed",
                evidence_id=evidence_id,
            )


async def execute_privacy_erasure_request(
    request_id: UUID,
    *,
    session_factory: Any = AsyncSessionLocal,
    storage_factory: Callable[[], Any] = get_avatar_storage,
    register_storage_factory: Callable[[], Any] | None = None,
    now_provider: Callable[[], datetime] = _now,
    after_storage: Callable[[AsyncSession], Awaitable[None]] | None = None,
    before_commit: Callable[[AsyncSession], Awaitable[None]] | None = None,
    settings: Settings | None = None,
    notification_delivery: Callable[..., Awaitable[PrivacyErasureNotificationResult]] = (
        deliver_privacy_erasure_completion_notification
    ),
    notification_email_sender: Callable[..., Any] | None = None,
) -> PrivacyErasureWorkerResult:
    resolved_settings = settings or get_settings()
    try:
        claim = await _claim(
            request_id,
            session_factory=session_factory,
            now_provider=now_provider,
            settings=resolved_settings,
        )
    except SQLAlchemyError:
        await _record_failure_code(
            request_id,
            DATABASE_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=DATABASE_FAILURE_CODE,
        )
    if isinstance(claim, PrivacyErasureWorkerResult):
        if claim.result == "already_completed":
            return await _attach_notification_result(
                claim,
                session_factory=session_factory,
                settings=resolved_settings,
                notification_delivery=notification_delivery,
                notification_email_sender=notification_email_sender,
                now_provider=now_provider,
            )
        return claim

    try:
        subject_ref_hash = privacy_erasure_subject_ref_hash(
            claim.user_id,
            resolved_settings,
        )
        register_storage = (
            register_storage_factory()
            if register_storage_factory is not None
            else S3PrivacyErasureRegisterStorage(resolved_settings)
        )
    except Exception:  # noqa: BLE001 - configuration details must not escape.
        await _record_failure_code(
            request_id,
            RESTORE_REGISTER_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=RESTORE_REGISTER_FAILURE_CODE,
        )

    try:
        execution_result = await _execute(
            request_id,
            claim,
            subject_ref_hash=subject_ref_hash,
            register_storage=register_storage,
            settings=resolved_settings,
            session_factory=session_factory,
            storage_factory=storage_factory,
            now_provider=now_provider,
            after_storage=after_storage,
            before_commit=before_commit,
        )
        del claim
        if execution_result.result == "completed":
            return await _attach_notification_result(
                execution_result,
                session_factory=session_factory,
                settings=resolved_settings,
                notification_delivery=notification_delivery,
                notification_email_sender=notification_email_sender,
                now_provider=now_provider,
            )
        return execution_result
    except _RestoreRegisterFailed:
        await _record_failure_code(
            request_id,
            RESTORE_REGISTER_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=RESTORE_REGISTER_FAILURE_CODE,
        )
    except _AvatarDeletionFailed:
        await _record_failure_code(
            request_id,
            AVATAR_STORAGE_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=AVATAR_STORAGE_FAILURE_CODE,
        )
    except _NotificationEncryptionFailed:
        await _record_failure_code(
            request_id,
            NOTIFICATION_ENCRYPTION_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=NOTIFICATION_ENCRYPTION_FAILURE_CODE,
        )
    except SQLAlchemyError:
        await _record_failure_code(
            request_id,
            DATABASE_FAILURE_CODE,
            session_factory=session_factory,
            now_provider=now_provider,
        )
        return _result(
            request_id,
            "retryable_failure",
            failure_code=DATABASE_FAILURE_CODE,
        )


async def _attach_notification_result(
    worker_result: PrivacyErasureWorkerResult,
    *,
    session_factory: Any,
    settings: Settings,
    notification_delivery: Callable[..., Awaitable[PrivacyErasureNotificationResult]],
    notification_email_sender: Callable[..., Any] | None,
    now_provider: Callable[[], datetime],
) -> PrivacyErasureWorkerResult:
    delivery_kwargs: dict[str, Any] = {
        "session_factory": session_factory,
        "settings": settings,
        "now_provider": now_provider,
    }
    if notification_email_sender is not None:
        delivery_kwargs["email_sender"] = notification_email_sender
    try:
        notification = await notification_delivery(
            worker_result.request_id,
            **delivery_kwargs,
        )
    except Exception:  # noqa: BLE001 - delivery/provider details must not escape.
        notification = PrivacyErasureNotificationResult(
            "retryable_failure",
            DELIVERY_UNAVAILABLE,
        )
    return _result(
        worker_result.request_id,
        worker_result.result,
        evidence_id=worker_result.destruction_evidence_id,
        failure_code=worker_result.failure_code,
        notification_result=notification.result,
        notification_failure_code=notification.failure_code,
    )
