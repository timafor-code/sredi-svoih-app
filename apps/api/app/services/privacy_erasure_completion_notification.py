from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.db.models.core import (
    PrivacyDestructionEvidence,
    PrivacyErasureNotificationOutbox,
    PrivacyRequest,
)
from app.db.session import AsyncSessionLocal
from app.services.email_delivery import EmailSendResult
from app.services.privacy_erasure_email_service import (
    send_privacy_erasure_completed,
    send_privacy_erasure_completed_with_retention,
)
from app.services.privacy_erasure_notification_crypto import (
    EncryptedNotificationRecipient,
    PrivacyErasureNotificationCryptoError,
    decrypt_notification_recipient,
    load_notification_encryption_config,
)

DELIVERY_UNAVAILABLE = "privacy_erasure_notification_delivery_unavailable"
DELIVERY_WINDOW_EXPIRED = (
    "privacy_erasure_notification_delivery_window_expired"
)
NOTIFICATION_SKIPPED_NO_RECIPIENT = "skipped_no_recipient"


@dataclass(frozen=True)
class PrivacyErasureNotificationResult:
    result: str
    failure_code: str | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _send_completion_email(
    *,
    to_address: str,
    notification_kind: str,
    settings: Settings,
) -> EmailSendResult:
    if notification_kind == "completed_with_retention":
        return send_privacy_erasure_completed_with_retention(
            to_address=to_address,
            settings=settings,
        )
    return send_privacy_erasure_completed(
        to_address=to_address,
        settings=settings,
    )


async def deliver_privacy_erasure_completion_notification(
    request_id: UUID,
    *,
    session_factory: Any = AsyncSessionLocal,
    settings: Settings | None = None,
    email_sender: Callable[..., EmailSendResult] = _send_completion_email,
    now_provider: Callable[[], datetime] = _now,
) -> PrivacyErasureNotificationResult:
    resolved_settings = settings or get_settings()
    async with session_factory() as session:
        async with session.begin():
            outbox = await session.scalar(
                select(PrivacyErasureNotificationOutbox)
                .where(
                    PrivacyErasureNotificationOutbox.privacy_request_id
                    == request_id,
                )
                .with_for_update(),
            )
            if outbox is None:
                privacy_request = await session.get(PrivacyRequest, request_id)
                evidence = None
                if (
                    privacy_request is not None
                    and privacy_request.destruction_evidence_id is not None
                ):
                    evidence = await session.get(
                        PrivacyDestructionEvidence,
                        privacy_request.destruction_evidence_id,
                    )
                if (
                    privacy_request is not None
                    and privacy_request.completed_at is not None
                    and privacy_request.destruction_evidence_id is not None
                    and evidence is not None
                    and evidence.result_status
                    in {"completed", "completed_with_retention"}
                ):
                    if privacy_request.origin == "admin":
                        return PrivacyErasureNotificationResult(
                            NOTIFICATION_SKIPPED_NO_RECIPIENT,
                        )
                    return PrivacyErasureNotificationResult(
                        "legacy_notification_unavailable",
                    )
                return PrivacyErasureNotificationResult("not_created")

            privacy_request = await session.get(PrivacyRequest, request_id)
            evidence = await session.get(
                PrivacyDestructionEvidence,
                outbox.destruction_evidence_id,
            )
            if not _linked_completion_is_valid(
                privacy_request=privacy_request,
                evidence=evidence,
                outbox=outbox,
            ):
                return await _mark_failed(
                    outbox,
                    failure_code=DELIVERY_UNAVAILABLE,
                    now=now_provider(),
                )

            if outbox.status == "sent":
                return PrivacyErasureNotificationResult("already_sent")
            if outbox.status == "expired":
                return PrivacyErasureNotificationResult(
                    "expired",
                    outbox.failure_code,
                )

            now = now_provider()
            if now >= outbox.expires_at:
                outbox.status = "expired"
                outbox.recipient_ciphertext = None
                outbox.recipient_nonce = None
                outbox.last_attempt_at = now
                outbox.sent_at = None
                outbox.failure_code = DELIVERY_WINDOW_EXPIRED
                outbox.updated_at = now
                return PrivacyErasureNotificationResult(
                    "expired",
                    DELIVERY_WINDOW_EXPIRED,
                )

            try:
                config = load_notification_encryption_config(resolved_settings)
                if (
                    outbox.recipient_ciphertext is None
                    or outbox.recipient_nonce is None
                ):
                    raise PrivacyErasureNotificationCryptoError(
                        "privacy_erasure_notification_decryption_failed",
                    )
                recipient = decrypt_notification_recipient(
                    EncryptedNotificationRecipient(
                        ciphertext=outbox.recipient_ciphertext,
                        nonce=outbox.recipient_nonce,
                        key_id=outbox.encryption_key_id,
                    ),
                    outbox_id=outbox.id,
                    privacy_request_id=outbox.privacy_request_id,
                    destruction_evidence_id=outbox.destruction_evidence_id,
                    config=config,
                )
            except PrivacyErasureNotificationCryptoError as exc:
                return await _mark_failed(
                    outbox,
                    failure_code=exc.failure_code,
                    now=now,
                    count_attempt=True,
                )

            outbox.attempt_count += 1
            outbox.last_attempt_at = now
            outbox.updated_at = now
            try:
                delivery = await run_in_threadpool(
                    email_sender,
                    to_address=recipient,
                    notification_kind=outbox.notification_kind,
                    settings=resolved_settings,
                )
            except Exception:  # noqa: BLE001 - provider details must not escape.
                delivery = None
            if delivery is None or not delivery.sent:
                outbox.status = "failed"
                outbox.sent_at = None
                outbox.failure_code = DELIVERY_UNAVAILABLE
                return PrivacyErasureNotificationResult(
                    "retryable_failure",
                    DELIVERY_UNAVAILABLE,
                )

            outbox.status = "sent"
            outbox.sent_at = now
            outbox.failure_code = None
            outbox.recipient_ciphertext = None
            outbox.recipient_nonce = None
            outbox.updated_at = now
            return PrivacyErasureNotificationResult("sent")


def _linked_completion_is_valid(
    *,
    privacy_request: PrivacyRequest | None,
    evidence: PrivacyDestructionEvidence | None,
    outbox: PrivacyErasureNotificationOutbox,
) -> bool:
    return bool(
        privacy_request is not None
        and privacy_request.completed_at is not None
        and privacy_request.destruction_evidence_id == outbox.destruction_evidence_id
        and evidence is not None
        and evidence.result_status == outbox.notification_kind
    )


async def _mark_failed(
    outbox: PrivacyErasureNotificationOutbox,
    *,
    failure_code: str,
    now: datetime,
    count_attempt: bool = False,
) -> PrivacyErasureNotificationResult:
    if count_attempt:
        outbox.attempt_count += 1
    outbox.status = "failed"
    outbox.last_attempt_at = now
    outbox.sent_at = None
    outbox.failure_code = failure_code
    outbox.updated_at = now
    return PrivacyErasureNotificationResult("retryable_failure", failure_code)
