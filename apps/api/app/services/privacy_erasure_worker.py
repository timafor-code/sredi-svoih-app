from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import logging
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import column, delete, func, or_, select, table, update
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models.auth import (
    AuthEmailVerificationCode,
    AuthSession,
    AuthSetPasswordCode,
    PasswordResetCode,
    PrivacyAccessCode,
    PrivacyAccessSession,
)
from app.db.models.avatar import ProfileAvatar
from app.db.models.core import (
    AdminFeedback,
    AppUser,
    CommunityMembership,
    DeviceToken,
    EventRegistration,
    Invite,
    LegalAcceptance,
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRequest,
    Profile,
    ProfileContactVisibility,
    PushNotificationDelivery,
    PushNotificationJob,
    SyncedContact,
    WebRegistrationIntent,
)
from app.db.models.seating import EventSeatingAssignment
from app.db.session import AsyncSessionLocal
from app.services.auth_tokens import hash_token
from app.services.privacy_erasure import (
    DELETION_PENDING_STATUS,
    has_retention_sensitive_registration_data,
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
from app.storage.s3 import get_avatar_storage

logger = logging.getLogger(__name__)

PRIVACY_ERASURE_EXECUTION_VERSION = "privacy-erasure-worker-v2"
MANUAL_REVIEW_FAILURE_CODE = "privacy_erasure_manual_review_required"
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

_PRAYER_ACTIVITY_LOGS = table(
    "prayer_activity_logs",
    column("user_id", PG_UUID(as_uuid=True)),
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
            if await has_retention_sensitive_registration_data(session, user.id):
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


async def _delete_rows(
    session: AsyncSession,
    model: Any,
    criterion: Any,
) -> bool:
    result = await session.execute(
        delete(model)
        .where(criterion)
        .execution_options(synchronize_session=False),
    )
    return bool(result.rowcount and result.rowcount > 0)


async def _delete_credentials_and_sessions(
    session: AsyncSession,
    user_id: UUID,
    categories: set[str],
) -> None:
    for model in (
        AuthEmailVerificationCode,
        PasswordResetCode,
        AuthSetPasswordCode,
        PrivacyAccessCode,
    ):
        if await _delete_rows(session, model, model.user_id == user_id):
            categories.add("credential")
    for model in (AuthSession, PrivacyAccessSession):
        if await _delete_rows(session, model, model.user_id == user_id):
            categories.add("session")


async def _delete_personal_surfaces(
    session: AsyncSession,
    user: AppUser,
    categories: set[str],
) -> None:
    if await _delete_rows(session, Profile, Profile.user_id == user.id):
        categories.update(("profile", "contact"))
    if await _delete_rows(
        session,
        ProfileContactVisibility,
        ProfileContactVisibility.user_id == user.id,
    ):
        categories.add("contact")
    if await _delete_rows(session, DeviceToken, DeviceToken.user_id == user.id):
        categories.add("device")
    if await _delete_rows(
        session,
        PushNotificationDelivery,
        PushNotificationDelivery.user_id == user.id,
    ):
        categories.add("device")
    if await _delete_rows(
        session,
        PushNotificationJob,
        PushNotificationJob.target_user_id == user.id,
    ):
        categories.add("device")
    if await _delete_rows(session, SyncedContact, SyncedContact.user_id == user.id):
        categories.add("synced_contact")

    if user.email is not None:
        result = await session.execute(
            update(Invite)
            .where(
                Invite.email.is_not(None),
                func.lower(Invite.email) == user.email.lower(),
            )
            .values(email=None)
            .execution_options(synchronize_session=False),
        )
        if result.rowcount and result.rowcount > 0:
            categories.add("contact")
    if user.phone is not None:
        result = await session.execute(
            update(Invite)
            .where(Invite.phone == user.phone)
            .values(phone=None)
            .execution_options(synchronize_session=False),
        )
        if result.rowcount and result.rowcount > 0:
            categories.add("contact")


async def _delete_registrations_and_memberships(
    session: AsyncSession,
    user_id: UUID,
    categories: set[str],
) -> None:
    if await _delete_rows(
        session,
        EventSeatingAssignment,
        EventSeatingAssignment.user_id == user_id,
    ):
        categories.add("registration")
    if await _delete_rows(
        session,
        LegalAcceptance,
        LegalAcceptance.user_id == user_id,
    ):
        categories.add("legal_acceptance")
    if await _delete_rows(
        session,
        EventRegistration,
        EventRegistration.user_id == user_id,
    ):
        categories.add("registration")
    if await _delete_rows(
        session,
        CommunityMembership,
        CommunityMembership.user_id == user_id,
    ):
        categories.add("membership")


async def _delete_web_registration_intents(
    session: AsyncSession,
    user: AppUser,
) -> bool:
    criteria = [WebRegistrationIntent.matched_user_id == user.id]
    if user.email is not None:
        criteria.append(
            func.lower(WebRegistrationIntent.email_normalized)
            == user.email.lower(),
        )
    if user.phone is not None:
        criteria.append(WebRegistrationIntent.phone_normalized == user.phone)
    return await _delete_rows(
        session,
        WebRegistrationIntent,
        or_(*criteria),
    )


async def _delete_content_graph(
    session: AsyncSession,
    *,
    user: AppUser,
    privacy_request: PrivacyRequest,
    now: datetime,
    avatar_keys: list[str],
    recipient: str,
    notification_config: PrivacyErasureNotificationEncryptionConfig,
) -> UUID:
    categories = {"account"}
    if user.email is not None or user.phone is not None:
        categories.add("contact")
    if user.password_hash is not None:
        categories.add("credential")
    await _delete_credentials_and_sessions(session, user.id, categories)
    await _delete_personal_surfaces(session, user, categories)
    await _delete_registrations_and_memberships(session, user.id, categories)

    prayer_result = await session.execute(
        delete(_PRAYER_ACTIVITY_LOGS).where(
            _PRAYER_ACTIVITY_LOGS.c.user_id == user.id,
        ),
    )
    if prayer_result.rowcount and prayer_result.rowcount > 0:
        categories.add("prayer_activity")

    if await _delete_rows(
        session,
        AdminFeedback,
        AdminFeedback.user_id == user.id,
    ):
        categories.add("feedback")
    if await _delete_web_registration_intents(session, user):
        categories.add("web_registration_intent")

    content_exists = await session.scalar(
        select(PrivacyRequest.id)
        .where(
            PrivacyRequest.user_id == user.id,
            or_(
                PrivacyRequest.message.is_not(None),
                PrivacyRequest.resolution_note.is_not(None),
            ),
        )
        .limit(1),
    )
    await session.execute(
        update(PrivacyRequest)
        .where(PrivacyRequest.user_id == user.id)
        .values(message=None, resolution_note=None)
        .execution_options(synchronize_session=False),
    )
    if content_exists is not None:
        categories.add("privacy_request_content")

    if await _delete_rows(
        session,
        ProfileAvatar,
        ProfileAvatar.user_id == user.id,
    ):
        categories.add("avatar")
    elif avatar_keys:
        categories.add("avatar")

    evidence = PrivacyDestructionEvidence(
        subject_ref_hash=hash_token(f"privacy-erasure-subject:{user.id}"),
        execution_version=PRIVACY_ERASURE_EXECUTION_VERSION,
        result_status="completed",
        completed_at=now,
        categories_deleted=sorted(categories),
        categories_retained=[],
        retention_until=None,
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

    deleted = await session.execute(
        delete(AppUser)
        .where(AppUser.id == user.id)
        .execution_options(synchronize_session=False),
    )
    if deleted.rowcount != 1:
        raise SQLAlchemyError("privacy erasure subject delete did not affect one row")
    return evidence.id


async def _execute(
    request_id: UUID,
    claimed: _ClaimedRequest,
    *,
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
            if await has_retention_sensitive_registration_data(session, user.id):
                privacy_request.failure_code = MANUAL_REVIEW_FAILURE_CODE
                privacy_request.updated_at = now_provider()
                return _result(
                    request_id,
                    "not_eligible",
                    failure_code=MANUAL_REVIEW_FAILURE_CODE,
                )

            avatar_keys = list(
                (
                    await session.scalars(
                        select(ProfileAvatar.object_key).where(
                            ProfileAvatar.user_id == user.id,
                        ),
                    )
                ).all(),
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
                recipient=claimed.recipient,
                notification_config=claimed.notification_config,
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
        execution_result = await _execute(
            request_id,
            claim,
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
