from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID
import secrets

import jwt
from jwt import PyJWTError

from app.core.config import get_settings

_ACCESS_TOKEN_TYPE = "access"
_JWT_ALGORITHM = "HS256"
_REFRESH_TOKEN_BYTES = 48


class AccessTokenDecodeError(ValueError):
    """Raised when an access token cannot be trusted."""


def create_access_token(user_id: str | UUID, expires_delta: timedelta | None = None) -> str:
    subject = str(user_id).strip()
    if not subject:
        raise ValueError("user_id must not be empty")

    settings = get_settings()
    if not settings.api_jwt_secret:
        raise RuntimeError("API_JWT_SECRET must be configured")

    issued_at = datetime.now(UTC)
    ttl = expires_delta or timedelta(minutes=settings.api_access_token_ttl_minutes)
    expires_at = issued_at + ttl
    payload: dict[str, object] = {
        "sub": subject,
        "iat": issued_at,
        "exp": expires_at,
        "typ": _ACCESS_TOKEN_TYPE,
    }

    if settings.api_jwt_issuer:
        payload["iss"] = settings.api_jwt_issuer

    if settings.api_jwt_audience:
        payload["aud"] = settings.api_jwt_audience

    return jwt.encode(payload, settings.api_jwt_secret, algorithm=_JWT_ALGORITHM)


def decode_access_token_subject(token: str) -> UUID:
    if not token:
        raise AccessTokenDecodeError("access token is required")

    settings = get_settings()
    if not settings.api_jwt_secret:
        raise RuntimeError("API_JWT_SECRET must be configured")

    options = {
        "require": ["exp", "sub", "typ"],
        "verify_aud": bool(settings.api_jwt_audience),
        "verify_iss": bool(settings.api_jwt_issuer),
    }
    decode_kwargs: dict[str, Any] = {
        "algorithms": [_JWT_ALGORITHM],
        "options": options,
    }

    if settings.api_jwt_issuer:
        decode_kwargs["issuer"] = settings.api_jwt_issuer

    if settings.api_jwt_audience:
        decode_kwargs["audience"] = settings.api_jwt_audience

    try:
        payload = jwt.decode(token, settings.api_jwt_secret, **decode_kwargs)
    except PyJWTError as exc:
        raise AccessTokenDecodeError("invalid access token") from exc

    if payload.get("typ") != _ACCESS_TOKEN_TYPE:
        raise AccessTokenDecodeError("invalid token type")

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise AccessTokenDecodeError("invalid token subject")

    try:
        return UUID(subject)
    except ValueError as exc:
        raise AccessTokenDecodeError("invalid token subject") from exc


def create_refresh_token() -> str:
    return secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)
