from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
import re
from typing import Any
from uuid import UUID

from app.core.config import Settings
from app.storage.privacy_erasure_register import (
    PrivacyErasureRegisterStorageError,
)

REGISTER_FORMAT_VERSION = "privacy-erasure-register-v1"
MARKER_FORMAT_VERSION = "privacy-erasure-register-marker-v1"
SUBJECT_HASH_VERSION = "hmac-sha256-v1"

REGISTER_UNAVAILABLE = "privacy_erasure_restore_register_unavailable"
REGISTER_METADATA_INVALID = "privacy_erasure_restore_register_metadata_invalid"
REGISTER_VERSION_UNSUPPORTED = "privacy_erasure_restore_register_version_unsupported"
REGISTER_KEY_MISMATCH = "privacy_erasure_restore_register_key_mismatch"
REGISTER_MARKER_INVALID = "privacy_erasure_restore_register_marker_invalid"

_FINGERPRINT_MESSAGE = b"privacy-erasure-register-key-fingerprint:v1"
_SUBJECT_HASH_RE = re.compile(r"^hmac-sha256-v1:[0-9a-f]{64}$")
_FINGERPRINT_RE = re.compile(r"^hmac-sha256-v1:[0-9a-f]{64}$")
_MAX_OBJECT_BYTES = 4096


class PrivacyErasureRestoreRegisterError(Exception):
    failure_code = REGISTER_UNAVAILABLE


class PrivacyErasureRestoreRegisterUnavailable(
    PrivacyErasureRestoreRegisterError,
):
    failure_code = REGISTER_UNAVAILABLE


class PrivacyErasureRestoreRegisterMetadataInvalid(
    PrivacyErasureRestoreRegisterError,
):
    failure_code = REGISTER_METADATA_INVALID


class PrivacyErasureRestoreRegisterVersionUnsupported(
    PrivacyErasureRestoreRegisterError,
):
    failure_code = REGISTER_VERSION_UNSUPPORTED


class PrivacyErasureRestoreRegisterKeyMismatch(
    PrivacyErasureRestoreRegisterError,
):
    failure_code = REGISTER_KEY_MISMATCH


class PrivacyErasureRestoreRegisterMarkerInvalid(
    PrivacyErasureRestoreRegisterError,
):
    failure_code = REGISTER_MARKER_INVALID


@dataclass(frozen=True)
class RestoreRegisterMetadata:
    format_version: str
    marker_format_version: str
    subject_hash_version: str
    hash_key_fingerprint: str


@dataclass(frozen=True)
class RestoreRegisterMarker:
    format_version: str
    subject_ref_hash: str


@dataclass(frozen=True)
class RestoreRegisterSnapshot:
    metadata: RestoreRegisterMetadata
    subject_ref_hashes: frozenset[str]


def privacy_erasure_subject_ref_hash(user_id: UUID, settings: Settings) -> str:
    secret = _secret_bytes(settings)
    message = f"auth-token:privacy-erasure-subject:{user_id}".encode("utf-8")
    digest = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return f"{SUBJECT_HASH_VERSION}:{digest}"


def privacy_erasure_register_key_fingerprint(settings: Settings) -> str:
    digest = hmac.new(
        _secret_bytes(settings),
        _FINGERPRINT_MESSAGE,
        hashlib.sha256,
    ).hexdigest()
    return f"{SUBJECT_HASH_VERSION}:{digest}"


async def ensure_restore_register_marker(
    storage: Any,
    *,
    settings: Settings,
    subject_ref_hash: str,
) -> None:
    if not _SUBJECT_HASH_RE.fullmatch(subject_ref_hash):
        raise PrivacyErasureRestoreRegisterMarkerInvalid()
    metadata = _expected_metadata(settings)
    await _ensure_metadata(storage, settings=settings, expected=metadata)

    marker = RestoreRegisterMarker(
        format_version=MARKER_FORMAT_VERSION,
        subject_ref_hash=subject_ref_hash,
    )
    key = _marker_key(settings, subject_ref_hash)
    body = _canonical_json(
        {
            "format_version": marker.format_version,
            "subject_ref_hash": marker.subject_ref_hash,
        },
    )
    try:
        created = await storage.put_object_if_absent(key, body)
        if created:
            return
        existing = await storage.get_object(key)
    except PrivacyErasureRegisterStorageError:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    except Exception:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    if existing is None:
        raise PrivacyErasureRestoreRegisterUnavailable()
    parsed = _parse_marker(existing)
    if parsed != marker:
        raise PrivacyErasureRestoreRegisterMarkerInvalid()


async def load_restore_register(
    storage: Any,
    *,
    settings: Settings,
) -> RestoreRegisterSnapshot:
    metadata = await _load_and_validate_metadata(storage, settings=settings)
    marker_prefix = f"{_register_prefix(settings)}/markers/"
    try:
        keys = await storage.list_object_keys(marker_prefix)
    except PrivacyErasureRegisterStorageError:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    except Exception:
        raise PrivacyErasureRestoreRegisterUnavailable() from None

    subject_hashes: set[str] = set()
    for key in keys:
        if not isinstance(key, str) or not key.startswith(marker_prefix):
            raise PrivacyErasureRestoreRegisterMarkerInvalid()
        try:
            body = await storage.get_object(key)
        except PrivacyErasureRegisterStorageError:
            raise PrivacyErasureRestoreRegisterUnavailable() from None
        except Exception:
            raise PrivacyErasureRestoreRegisterUnavailable() from None
        if body is None:
            raise PrivacyErasureRestoreRegisterUnavailable()
        marker = _parse_marker(body)
        if key != _marker_key(settings, marker.subject_ref_hash):
            raise PrivacyErasureRestoreRegisterMarkerInvalid()
        if marker.subject_ref_hash in subject_hashes:
            raise PrivacyErasureRestoreRegisterMarkerInvalid()
        subject_hashes.add(marker.subject_ref_hash)
    return RestoreRegisterSnapshot(metadata, frozenset(subject_hashes))


async def _ensure_metadata(
    storage: Any,
    *,
    settings: Settings,
    expected: RestoreRegisterMetadata,
) -> None:
    key = _metadata_key(settings)
    try:
        existing = await storage.get_object(key)
        if existing is None:
            body = _metadata_body(expected)
            created = await storage.put_object_if_absent(key, body)
            if created:
                return
            existing = await storage.get_object(key)
    except PrivacyErasureRegisterStorageError:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    except Exception:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    if existing is None:
        raise PrivacyErasureRestoreRegisterUnavailable()
    _validate_metadata(_parse_metadata(existing), expected)


async def _load_and_validate_metadata(
    storage: Any,
    *,
    settings: Settings,
) -> RestoreRegisterMetadata:
    try:
        body = await storage.get_object(_metadata_key(settings))
    except PrivacyErasureRegisterStorageError:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    except Exception:
        raise PrivacyErasureRestoreRegisterUnavailable() from None
    if body is None:
        raise PrivacyErasureRestoreRegisterMetadataInvalid()
    metadata = _parse_metadata(body)
    _validate_metadata(metadata, _expected_metadata(settings))
    return metadata


def _validate_metadata(
    actual: RestoreRegisterMetadata,
    expected: RestoreRegisterMetadata,
) -> None:
    if (
        actual.format_version != REGISTER_FORMAT_VERSION
        or actual.marker_format_version != MARKER_FORMAT_VERSION
        or actual.subject_hash_version != SUBJECT_HASH_VERSION
    ):
        raise PrivacyErasureRestoreRegisterVersionUnsupported()
    if not _FINGERPRINT_RE.fullmatch(actual.hash_key_fingerprint):
        raise PrivacyErasureRestoreRegisterMetadataInvalid()
    if not hmac.compare_digest(
        actual.hash_key_fingerprint,
        expected.hash_key_fingerprint,
    ):
        raise PrivacyErasureRestoreRegisterKeyMismatch()


def _parse_metadata(body: bytes) -> RestoreRegisterMetadata:
    value = _parse_json_object(body, metadata=True)
    expected_keys = {
        "format_version",
        "marker_format_version",
        "subject_hash_version",
        "hash_key_fingerprint",
    }
    if set(value) != expected_keys or not all(
        isinstance(value[key], str) for key in expected_keys
    ):
        raise PrivacyErasureRestoreRegisterMetadataInvalid()
    return RestoreRegisterMetadata(**value)


def _parse_marker(body: bytes) -> RestoreRegisterMarker:
    value = _parse_json_object(body, metadata=False)
    if set(value) != {"format_version", "subject_ref_hash"}:
        raise PrivacyErasureRestoreRegisterMarkerInvalid()
    if value.get("format_version") != MARKER_FORMAT_VERSION:
        raise PrivacyErasureRestoreRegisterMarkerInvalid()
    subject_ref_hash = value.get("subject_ref_hash")
    if not isinstance(subject_ref_hash, str) or not _SUBJECT_HASH_RE.fullmatch(
        subject_ref_hash,
    ):
        raise PrivacyErasureRestoreRegisterMarkerInvalid()
    return RestoreRegisterMarker(
        format_version=MARKER_FORMAT_VERSION,
        subject_ref_hash=subject_ref_hash,
    )


def _parse_json_object(body: bytes, *, metadata: bool) -> dict[str, Any]:
    error_type = (
        PrivacyErasureRestoreRegisterMetadataInvalid
        if metadata
        else PrivacyErasureRestoreRegisterMarkerInvalid
    )
    if not isinstance(body, bytes) or not body or len(body) > _MAX_OBJECT_BYTES:
        raise error_type()

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    try:
        decoded = body.decode("utf-8")
        value = json.loads(decoded, object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, ValueError, TypeError):
        raise error_type() from None
    if not isinstance(value, dict):
        raise error_type()
    return value


def _expected_metadata(settings: Settings) -> RestoreRegisterMetadata:
    return RestoreRegisterMetadata(
        format_version=REGISTER_FORMAT_VERSION,
        marker_format_version=MARKER_FORMAT_VERSION,
        subject_hash_version=SUBJECT_HASH_VERSION,
        hash_key_fingerprint=privacy_erasure_register_key_fingerprint(settings),
    )


def _metadata_body(metadata: RestoreRegisterMetadata) -> bytes:
    return _canonical_json(
        {
            "format_version": metadata.format_version,
            "hash_key_fingerprint": metadata.hash_key_fingerprint,
            "marker_format_version": metadata.marker_format_version,
            "subject_hash_version": metadata.subject_hash_version,
        },
    )


def _canonical_json(value: dict[str, str]) -> bytes:
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode(
        "utf-8",
    )


def _metadata_key(settings: Settings) -> str:
    return f"{_register_prefix(settings)}/metadata.json"


def _marker_key(settings: Settings, subject_ref_hash: str) -> str:
    digest = hashlib.sha256(subject_ref_hash.encode("ascii")).hexdigest()
    return f"{_register_prefix(settings)}/markers/{digest[:2]}/{digest}.json"


def _register_prefix(settings: Settings) -> str:
    prefix = settings.api_privacy_erasure_register_prefix.strip().strip("/")
    if (
        not prefix
        or "//" in prefix
        or any(part in {"", ".", ".."} for part in prefix.split("/"))
        or any(ord(character) < 0x21 or ord(character) > 0x7E for character in prefix)
    ):
        raise PrivacyErasureRestoreRegisterMetadataInvalid()
    return prefix


def _secret_bytes(settings: Settings) -> bytes:
    secret = settings.api_token_hash_secret
    if not secret:
        raise PrivacyErasureRestoreRegisterKeyMismatch()
    return secret.encode("utf-8")
