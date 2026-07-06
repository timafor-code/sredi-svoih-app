from __future__ import annotations

import hashlib
import hmac

from app.core.config import get_settings

_HASH_VERSION = "hmac-sha256-v1"


def _hash_secret_bytes() -> bytes:
    secret = get_settings().api_token_hash_secret
    if not secret:
        raise RuntimeError("API_TOKEN_HASH_SECRET must be configured")

    return secret.encode("utf-8")


def _hmac_sha256(value: str, purpose: str) -> str:
    message = f"{purpose}:{value}".encode("utf-8")
    digest = hmac.new(_hash_secret_bytes(), message, hashlib.sha256).hexdigest()
    return f"{_HASH_VERSION}:{digest}"


def _normalize_required(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} must not be empty")

    return normalized


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


def hash_invite_code(invite_code: str) -> str:
    return _hmac_sha256(_normalize_required(invite_code, "invite_code"), "invite-code")


def hash_ip_optional(ip_address: str | None) -> str | None:
    normalized = _normalize_optional(ip_address)
    if normalized is None:
        return None

    return _hmac_sha256(normalized, "ip-address")


def hash_user_agent_optional(user_agent: str | None) -> str | None:
    normalized = _normalize_optional(user_agent)
    if normalized is None:
        return None

    return _hmac_sha256(normalized, "user-agent")
