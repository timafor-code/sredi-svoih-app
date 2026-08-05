from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.hashids import hash_ip_optional
from app.core.rate_limits import AuthEmailRateLimitConfig, InMemoryAuthEmailRateLimiter
from app.db.models.core import (
    AppUser,
    EventOccurrence,
    EventParticipationOption,
    LegalDocument,
    WebRegistrationIdentityConflict,
    WebRegistrationIntent,
)
from app.schemas.web_registration import (
    WebRegistrationIntentCreated,
    WebRegistrationIntentRequest,
    WebRegistrationIntentStatus,
)
from app.services import events as events_service
from app.services.auth_tokens import hash_token

EMAIL_REQUIRED = "email_verification_required"
FAILED = "failed"
_rate_limiter: InMemoryAuthEmailRateLimiter | None = None


def _now() -> datetime:
    return datetime.now(UTC)


def _error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error_code, "message": message})


def _limiter() -> InMemoryAuthEmailRateLimiter:
    global _rate_limiter
    settings = get_settings()
    if _rate_limiter is None:
        _rate_limiter = InMemoryAuthEmailRateLimiter(AuthEmailRateLimitConfig(
            window_seconds=settings.api_web_registration_rate_limit_window_seconds,
            max_attempts=settings.api_web_registration_rate_limit_max_attempts,
        ))
    return _rate_limiter


def _hash_dimension(purpose: str, value: str) -> str:
    return hash_token(f"web-registration:{purpose}:{value}")


def _apply_rate_limit(payload: WebRegistrationIntentRequest, ip: str | None) -> None:
    keys = [_hash_dimension("email", payload.email), _hash_dimension("phone", payload.phone)]
    ip_hash = hash_ip_optional(ip)
    if ip_hash:
        keys.append(_hash_dimension("ip", ip_hash))
    for key in keys:
        decision = _limiter().consume(key)
        if not decision.allowed:
            raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "rate_limited", "Too many requests")


def _idempotency_hash(key: str) -> str:
    return _hash_dimension("idempotency", key)


def _flow_id(idempotency_hash: str) -> str:
    secret = get_settings().api_token_hash_secret.encode("utf-8")
    digest = hmac.new(secret, f"web-flow:{idempotency_hash}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _fingerprint(payload: WebRegistrationIntentRequest) -> str:
    value = payload.model_dump(mode="json", exclude={"idempotency_key"})
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _validate_references(session: AsyncSession, payload: WebRegistrationIntentRequest) -> None:
    event = await events_service.get_visible_event(session, payload.event_id, [])
    if event.registration_mode not in ("internal_free", "internal_paid"):
        raise _error(status.HTTP_409_CONFLICT, "state_conflict", "Registration is not available")
    if payload.occurrence_id is not None:
        occurrence = await session.scalar(select(EventOccurrence).where(
            EventOccurrence.id == payload.occurrence_id,
            EventOccurrence.event_id == event.id,
            EventOccurrence.status == events_service.OCCURRENCE_VISIBLE_STATUS,
        ))
        if occurrence is None:
            raise _error(status.HTTP_404_NOT_FOUND, "not_found", "Occurrence not found")
        now = _now()
        if occurrence.registration_opens_at and now < occurrence.registration_opens_at:
            raise _error(status.HTTP_409_CONFLICT, "state_conflict", "Registration is not open yet")
        if occurrence.registration_closes_at and now > occurrence.registration_closes_at:
            raise _error(status.HTTP_409_CONFLICT, "state_conflict", "Registration is closed")
    option_ids = [item.option_id for item in payload.option_selections]
    if len(option_ids) != len(set(option_ids)):
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Duplicate participation option selection")
    if option_ids:
        options = list(await session.scalars(select(EventParticipationOption).where(EventParticipationOption.id.in_(option_ids))))
        by_id = {item.id: item for item in options}
        for selection in payload.option_selections:
            option = by_id.get(selection.option_id)
            if option is None or option.event_id != event.id or not option.is_active:
                raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Participation option is not available")
            if not option.allow_quantity and selection.quantity != 1:
                raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Invalid option quantity")
            if selection.quantity < option.min_quantity or selection.quantity > option.max_quantity:
                raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Invalid option quantity")
    document_ids = [item.document_id for item in payload.legal_acceptances]
    if len(document_ids) != len(set(document_ids)):
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Duplicate legal acceptance")
    documents = list(await session.scalars(select(LegalDocument).where(LegalDocument.id.in_(document_ids))))
    by_id = {item.id: item for item in documents}
    now = _now()
    for acceptance in payload.legal_acceptances:
        document = by_id.get(acceptance.document_id)
        if document is None or document.content_hash != acceptance.content_hash:
            raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Legal document is not available")
        if document.effective_at > now or (document.retired_at is not None and document.retired_at <= now):
            raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error", "Legal document is not available")


async def _identity_state(session: AsyncSession, payload: WebRegistrationIntentRequest):
    email_user = await session.scalar(select(AppUser).where(func.lower(AppUser.email) == payload.email))
    phone_user = await session.scalar(select(AppUser).where(AppUser.phone == payload.phone))
    deletion = any(user and (user.deletion_requested_at is not None or user.erased_at is not None or user.status == "deletion_pending") for user in (email_user, phone_user))
    if deletion:
        return FAILED, None, None
    if email_user and phone_user and email_user.id != phone_user.id:
        return FAILED, None, (email_user.id, phone_user.id)
    if phone_user and not email_user:
        return FAILED, None, None
    matched = email_user if email_user and (phone_user is None or phone_user.id == email_user.id) else None
    return EMAIL_REQUIRED, matched.id if matched else None, None


def _response(intent: WebRegistrationIntent, flow_id: str) -> WebRegistrationIntentCreated:
    return WebRegistrationIntentCreated(flow_id=flow_id, expires_at=intent.expires_at)


async def create_intent(session: AsyncSession, payload: WebRegistrationIntentRequest, ip: str | None) -> WebRegistrationIntentCreated:
    key_hash = _idempotency_hash(payload.idempotency_key)
    fingerprint = _fingerprint(payload)
    flow_id = _flow_id(key_hash)
    existing = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.idempotency_key_hash == key_hash))
    if existing is not None:
        if existing.request_fingerprint_hash != fingerprint:
            raise _error(status.HTTP_409_CONFLICT, "idempotency_conflict", "Idempotency key cannot be reused")
        if existing.expires_at <= _now():
            raise _error(status.HTTP_409_CONFLICT, "intent_not_available", "Registration intent is not available")
        return _response(existing, flow_id)

    _apply_rate_limit(payload, ip)
    await _validate_references(session, payload)
    intent_status, matched_user_id, conflict_users = await _identity_state(session, payload)
    now = _now()
    intent = WebRegistrationIntent(
        flow_token_hash=hash_token(flow_id), event_id=payload.event_id,
        occurrence_id=payload.occurrence_id, matched_user_id=matched_user_id,
        first_name=payload.first_name, last_name=payload.last_name,
        email_normalized=payload.email, phone_normalized=payload.phone,
        seats_count=payload.seats_count,
        option_payload=[item.model_dump(mode="json") for item in payload.option_selections],
        answer_payload=payload.answers or None,
        legal_acceptance_payload=[item.model_dump(mode="json") for item in payload.legal_acceptances],
        account_choice=payload.account_choice, status=intent_status,
        idempotency_key_hash=key_hash, request_fingerprint_hash=fingerprint,
        created_at=now, expires_at=now + timedelta(hours=get_settings().api_web_registration_intent_ttl_hours),
    )
    session.add(intent)
    try:
        await session.flush()
        if conflict_users:
            session.add(WebRegistrationIdentityConflict(
                registration_intent_id=intent.id, category="email_phone_different_users",
                email_user_id=conflict_users[0], phone_user_id=conflict_users[1], status="open",
            ))
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.idempotency_key_hash == key_hash))
        if existing is None:
            raise
        if existing.request_fingerprint_hash != fingerprint:
            raise _error(status.HTTP_409_CONFLICT, "idempotency_conflict", "Idempotency key cannot be reused")
        if existing.expires_at <= _now():
            raise _error(status.HTTP_409_CONFLICT, "intent_not_available", "Registration intent is not available")
        intent = existing
    return _response(intent, flow_id)


async def get_intent_status(session: AsyncSession, flow_id: str) -> WebRegistrationIntentStatus:
    if len(flow_id) < 32 or len(flow_id) > 128:
        return WebRegistrationIntentStatus(state="not_available")
    try:
        token_hash = hash_token(flow_id)
    except ValueError:
        return WebRegistrationIntentStatus(state="not_available")
    intent = await session.scalar(select(WebRegistrationIntent).where(WebRegistrationIntent.flow_token_hash == token_hash))
    if intent is None or intent.expires_at <= _now() or intent.status != EMAIL_REQUIRED:
        return WebRegistrationIntentStatus(state="not_available")
    return WebRegistrationIntentStatus(state=EMAIL_REQUIRED, expires_at=intent.expires_at)
