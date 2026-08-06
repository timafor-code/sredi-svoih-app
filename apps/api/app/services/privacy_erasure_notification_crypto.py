from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import os
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import Settings

NOTIFICATION_KEY_UNAVAILABLE = "privacy_erasure_notification_key_unavailable"
NOTIFICATION_DECRYPTION_FAILED = "privacy_erasure_notification_decryption_failed"
_PROTOCOL = "privacy-erasure-notification-v1"
_NONCE_LENGTH = 12


class PrivacyErasureNotificationCryptoError(RuntimeError):
    def __init__(self, failure_code: str) -> None:
        super().__init__(failure_code)
        self.failure_code = failure_code


@dataclass(frozen=True)
class PrivacyErasureNotificationEncryptionConfig:
    key: bytes
    key_id: str
    delivery_window_hours: int


@dataclass(frozen=True)
class EncryptedNotificationRecipient:
    ciphertext: bytes
    nonce: bytes
    key_id: str


def load_notification_encryption_config(
    settings: Settings,
) -> PrivacyErasureNotificationEncryptionConfig:
    encoded_key = settings.api_privacy_erasure_notification_key_b64.strip()
    key_id = settings.api_privacy_erasure_notification_key_id.strip()
    delivery_window = settings.api_privacy_erasure_notification_delivery_window_hours
    if not encoded_key or not key_id or delivery_window is None:
        raise PrivacyErasureNotificationCryptoError(NOTIFICATION_KEY_UNAVAILABLE)
    try:
        key = base64.b64decode(encoded_key, validate=True)
    except (binascii.Error, ValueError):
        raise PrivacyErasureNotificationCryptoError(
            NOTIFICATION_KEY_UNAVAILABLE,
        ) from None
    if len(key) != 32:
        raise PrivacyErasureNotificationCryptoError(NOTIFICATION_KEY_UNAVAILABLE)
    return PrivacyErasureNotificationEncryptionConfig(
        key=key,
        key_id=key_id,
        delivery_window_hours=delivery_window,
    )


def encrypt_notification_recipient(
    recipient: str,
    *,
    outbox_id: UUID,
    privacy_request_id: UUID,
    destruction_evidence_id: UUID,
    config: PrivacyErasureNotificationEncryptionConfig,
) -> EncryptedNotificationRecipient:
    nonce = os.urandom(_NONCE_LENGTH)
    ciphertext = AESGCM(config.key).encrypt(
        nonce,
        recipient.encode("utf-8"),
        _aad(
            outbox_id=outbox_id,
            privacy_request_id=privacy_request_id,
            destruction_evidence_id=destruction_evidence_id,
            key_id=config.key_id,
        ),
    )
    return EncryptedNotificationRecipient(
        ciphertext=ciphertext,
        nonce=nonce,
        key_id=config.key_id,
    )


def decrypt_notification_recipient(
    encrypted: EncryptedNotificationRecipient,
    *,
    outbox_id: UUID,
    privacy_request_id: UUID,
    destruction_evidence_id: UUID,
    config: PrivacyErasureNotificationEncryptionConfig,
) -> str:
    if encrypted.key_id != config.key_id:
        raise PrivacyErasureNotificationCryptoError(NOTIFICATION_KEY_UNAVAILABLE)
    if len(encrypted.nonce) != _NONCE_LENGTH:
        raise PrivacyErasureNotificationCryptoError(NOTIFICATION_DECRYPTION_FAILED)
    try:
        plaintext = AESGCM(config.key).decrypt(
            encrypted.nonce,
            encrypted.ciphertext,
            _aad(
                outbox_id=outbox_id,
                privacy_request_id=privacy_request_id,
                destruction_evidence_id=destruction_evidence_id,
                key_id=encrypted.key_id,
            ),
        )
        return plaintext.decode("utf-8")
    except (InvalidTag, UnicodeDecodeError, ValueError):
        raise PrivacyErasureNotificationCryptoError(
            NOTIFICATION_DECRYPTION_FAILED,
        ) from None


def _aad(
    *,
    outbox_id: UUID,
    privacy_request_id: UUID,
    destruction_evidence_id: UUID,
    key_id: str,
) -> bytes:
    return ":".join(
        (
            _PROTOCOL,
            str(outbox_id),
            str(privacy_request_id),
            str(destruction_evidence_id),
            key_id,
        ),
    ).encode("utf-8")
