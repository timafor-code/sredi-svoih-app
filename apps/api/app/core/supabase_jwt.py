from __future__ import annotations

from typing import Any
from uuid import UUID

import jwt
from jwt import PyJWTError

from app.core.config import get_settings

_JWT_ALGORITHM = "HS256"


class SupabaseJwtDecodeError(ValueError):
    """Raised when a Supabase access token cannot be trusted."""


def decode_supabase_access_token_subject(token: str) -> UUID:
    if not token:
        raise SupabaseJwtDecodeError("access token is required")

    settings = get_settings()
    signing_key = settings.supabase_jwt_signing_key
    if not signing_key:
        raise SupabaseJwtDecodeError("Supabase JWT secret is not configured")

    options = {
        "require": ["exp", "sub"],
        "verify_aud": bool(settings.supabase_jwt_audience),
        "verify_iss": bool(settings.supabase_jwt_issuer),
    }
    decode_kwargs: dict[str, Any] = {
        "algorithms": [_JWT_ALGORITHM],
        "options": options,
    }

    if settings.supabase_jwt_issuer:
        decode_kwargs["issuer"] = settings.supabase_jwt_issuer

    if settings.supabase_jwt_audience:
        decode_kwargs["audience"] = settings.supabase_jwt_audience

    try:
        payload = jwt.decode(token, signing_key, **decode_kwargs)
    except PyJWTError as exc:
        raise SupabaseJwtDecodeError("invalid Supabase access token") from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject.strip():
        raise SupabaseJwtDecodeError("invalid Supabase token subject")

    try:
        return UUID(subject)
    except ValueError as exc:
        raise SupabaseJwtDecodeError("invalid Supabase token subject") from exc
