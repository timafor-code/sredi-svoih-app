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


def _normalize_token(token: str) -> str:
    if not token:
        raise ValueError("token must not be empty")

    return token


def hash_token(token: str) -> str:
    message = f"auth-token:{_normalize_token(token)}".encode("utf-8")
    digest = hmac.new(_hash_secret_bytes(), message, hashlib.sha256).hexdigest()
    return f"{_HASH_VERSION}:{digest}"


def verify_token_hash(token: str, token_hash: str | None) -> bool:
    if not token or not token_hash:
        return False

    return hmac.compare_digest(hash_token(token), token_hash)
